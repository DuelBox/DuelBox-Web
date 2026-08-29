import { describe, expect, it } from 'vitest';
import { Rng, envelopeFor } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BASELINE_P1,
  BASELINE_P2,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  CENTRE_Y,
  CURVE,
  HEALTH,
  LANE_MAX,
  LANE_MIN,
  MATCH_SECONDS,
  MAX_BALLS,
  MOVE_DEADZONE,
  MOVE_SPEED,
  STAGES,
  THROWER_RADIUS,
  WALL_HEALTH,
  WALL_SPANS,
  WALL_Y,
  activeBalls,
  ballAge,
  ballCrossing,
  baselineOf,
  blockedByWall,
  botCommand,
  chooseSpot,
  createBotState,
  createCommand,
  createGame,
  firingSign,
  flightTo,
  launchY,
  otherOf,
  predictAtY,
  predictLanding,
  resetGame,
  stageFor,
  step,
  throwerOf,
  wantsRelease,
  winnerOf,
} from './rules.js';
import type { Ball, BotDifficulty, Command, Game, Stage, Thrower } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];

function still(): Command {
  return { dir: 0, release: false };
}

/** Run `steps` fixed steps with fixed commands. */
function run(game: Game, steps: number, p1: Command = still(), p2: Command = still()): void {
  for (let i = 0; i < steps; i += 1) step(game, STEP, p1, p2);
}

/** Pack a snowball to `seconds` and let it go, walking in `dir` as it leaves. */
function throwOne(game: Game, seat: SeatId, seconds: number, dir = 0): void {
  const other = otherOf(seat);
  const walk: Record<SeatId, Command> = {
    p1: { dir: seat === 'p1' ? dir : 0, release: false },
    p2: { dir: seat === 'p2' ? dir : 0, release: false },
  };
  // Stepped until the pack clock has actually passed the mark rather than for a computed
  // number of frames: `ready` is a sum of fixed steps, so it lands a hair under n·dt.
  let guard = 0;
  while (throwerOf(game, seat).ready < seconds) {
    step(game, STEP, walk.p1, walk.p2);
    guard += 1;
    expect(guard, 'never reached that size').toBeLessThan(600);
  }
  const go: Record<SeatId, Command> = {
    p1: { ...walk.p1, release: seat === 'p1' },
    p2: { ...walk.p2, release: seat === 'p2' },
  };
  step(game, STEP, go.p1, go.p2);
  void other;
}

function firstBall(game: Game): Ball {
  const found = game.balls.find((ball) => ball.active);
  expect(found, 'expected a snowball in the air').toBeDefined();
  return found as Ball;
}

/* ------------------------------------------------------------------------------------ */

describe('the field', () => {
  it('is unchanged by the half-turn that separates the two seats', () => {
    // Everything either seat can see must map onto itself when the board is turned over.
    // A game whose geometry fails this cannot be fair however well its bot is tuned.
    expect(BASELINE_P1 + BASELINE_P2).toBe(BOARD_HEIGHT);
    expect(LANE_MIN + LANE_MAX).toBe(BOARD_WIDTH);
    expect(WALL_Y).toBe(CENTRE_Y);
    expect(WALL_Y * 2).toBe(BOARD_HEIGHT);
    const mirrored = WALL_SPANS.map((span) => ({
      x1: BOARD_WIDTH - span.x2,
      x2: BOARD_WIDTH - span.x1,
    })).reverse();
    expect(mirrored).toEqual(WALL_SPANS.map((span) => ({ x1: span.x1, x2: span.x2 })));
  });

  it('gives both seats the identical throw', () => {
    for (let stage = 0; stage < STAGES.length; stage += 1) {
      const p1 = flightTo('p1', stage, baselineOf('p2'));
      const p2 = flightTo('p2', stage, baselineOf('p1'));
      expect(p2).toBeCloseTo(p1, 12);
      expect(launchY('p1', stage) - BASELINE_P1).toBeCloseTo(
        BASELINE_P2 - launchY('p2', stage),
        12,
      );
    }
  });

  it('leaves lanes a boulder can only just use', () => {
    // The widest ball is 88 units across and the narrowest lane is 100, so the ice filters
    // by size as well as blocking. If a future change closes that, the boulder becomes a
    // ball that can only be thrown down the middle.
    const widest = (STAGES[STAGES.length - 1] as Stage).radius * 2;
    const lanes = [
      (WALL_SPANS[0] as { x1: number }).x1,
      (WALL_SPANS[1] as { x1: number }).x1 - (WALL_SPANS[0] as { x2: number }).x2,
      BOARD_WIDTH - (WALL_SPANS[1] as { x2: number }).x2,
    ];
    for (const lane of lanes) expect(lane).toBeGreaterThan(widest);
  });

  it('measures its deadzone in precision envelopes rather than units', () => {
    expect(MOVE_DEADZONE).toBe(4 * envelopeFor({ width: BOARD_WIDTH, height: BOARD_HEIGHT }));
  });
});

describe('the three sizes', () => {
  it('are bigger, slower and heavier in step', () => {
    for (let i = 1; i < STAGES.length; i += 1) {
      const small = STAGES[i - 1] as Stage;
      const big = STAGES[i] as Stage;
      expect(big.windUp).toBeGreaterThan(small.windUp);
      expect(big.radius).toBeGreaterThan(small.radius);
      expect(big.damage).toBeGreaterThan(small.damage);
      expect(big.speed).toBeLessThan(small.speed);
    }
  });

  it('are worth about the same per second, so the choice is never throughput', () => {
    const rates = STAGES.map((size) => size.damage / size.windUp);
    expect(Math.max(...rates) / Math.min(...rates)).toBeLessThan(1.15);
  });

  it('cannot be thrown faster than about twice a second, which is what keeps a thumb level', () => {
    // `docs/input-idiom.md`: a game is same-input-class-only when winning needs more than
    // about two committing presses a second. The smallest size is the ceiling here.
    expect(1 / (STAGES[0] as Stage).windUp).toBeLessThan(2);
  });

  it('name the size a pack time has reached', () => {
    expect(stageFor(0)).toBe(-1);
    for (let i = 0; i < STAGES.length; i += 1) {
      const size = STAGES[i] as Stage;
      expect(stageFor(size.windUp - 1e-9)).toBe(i - 1);
      expect(stageFor(size.windUp)).toBe(i);
    }
    expect(stageFor(99)).toBe(STAGES.length - 1);
  });
});

describe('packing and letting go', () => {
  it('throws nothing before the first size, and does not lose the packing', () => {
    const game = createGame();
    run(game, 10);
    const before = game.p1.ready;
    step(game, STEP, { dir: 0, release: true }, still());
    expect(activeBalls(game)).toBe(0);
    expect(game.p1.throws).toBe(0);
    // A lift that throws nothing must not reset the clock: a pointer has to let go to
    // signal anything at all, so charging it for that would make the finger the poorer
    // instrument. See the note at the head of rules.ts.
    expect(game.p1.ready).toBeGreaterThan(before);
  });

  it('throws the largest size packed, and resets the packing', () => {
    for (let stage = 0; stage < STAGES.length; stage += 1) {
      const game = createGame();
      throwOne(game, 'p1', (STAGES[stage] as Stage).windUp);
      expect(activeBalls(game)).toBe(1);
      expect(firstBall(game).stage).toBe(stage);
      expect(game.p1.throws).toBe(1);
      expect(game.p1.ready).toBeLessThan((STAGES[0] as Stage).windUp);
    }
  });

  it('leans on the direction walked the step before, not the step of the release', () => {
    // The pointer is already null on the step that reports `actionReleased`
    // (`docs/input-idiom.md`, fact 2), so a lean read on the release step is zero for a
    // finger and non-zero for a key. Carrying the previous step's direction is what makes
    // the two instruments throw the same snowball, and this is the check that it does.
    const withPointer = createGame();
    const withKeys = createGame();
    const walk: Command = { dir: 1, release: false };
    for (let i = 0; i < 40; i += 1) {
      step(withPointer, STEP, walk, still());
      step(withKeys, STEP, walk, still());
    }
    // A finger lifts: no pointer this step, so no direction either.
    step(withPointer, STEP, { dir: 0, release: true }, still());
    // A key is let go while the walk key is still down.
    step(withKeys, STEP, { dir: 1, release: true }, still());
    expect(firstBall(withPointer).ax).toBe(CURVE);
    expect(firstBall(withKeys).ax).toBe(CURVE);
  });

  it('leaves the snowball from where the thrower stood, not from where it arrives', () => {
    const game = createGame();
    run(game, 40, { dir: 1, release: false }, still());
    const before = game.p1.x;
    step(game, STEP, { dir: 1, release: true }, still());
    // The launch point is the start-of-step position, which is what the bot can see and
    // therefore what it must be able to aim from.
    expect(firstBall(game).prevX).toBe(before);
  });
});

describe('the flight', () => {
  it('agrees exactly with the closed form the bot aims by', () => {
    // The lesson of commit b4af006, in this game's terms. `stepBalls` integrates
    // `x += vx·dt + ½·ax·dt²` and then `vx += ax·dt`; `predictAtY` solves the same
    // parabola in closed form. Written in the other order the step lands a whole `a·dt²`
    // rather than half of one and the bot aims at a board the game is not playing.
    for (const seat of SEATS) {
      for (let stage = 0; stage < STAGES.length; stage += 1) {
        for (const lean of [-1, 0, 1]) {
          for (const startX of [LANE_MIN, 200, 300, 431, LANE_MAX]) {
            const game = createGame();
            const thrower = throwerOf(game, seat);
            thrower.x = startX;
            thrower.prevX = startX;
            thrower.lean = lean;
            thrower.ready = (STAGES[stage] as Stage).windUp;
            const go: Command = { dir: 0, release: true };
            step(game, STEP, seat === 'p1' ? go : still(), seat === 'p2' ? go : still());
            const ball = firstBall(game);
            // The walls and the far thrower would eat it; take them off the board.
            for (const wall of game.walls) wall.chips = 0;
            throwerOf(game, otherOf(seat)).x = LANE_MIN;

            let worst = 0;
            for (let i = 0; i < 200 && ball.active; i += 1) {
              const predicted = predictAtY(seat, startX, stage, lean, ball.y);
              if (!Number.isNaN(predicted)) worst = Math.max(worst, Math.abs(predicted - ball.x));
              step(game, STEP, still(), still());
            }
            expect(
              worst,
              `${seat} stage ${String(stage)} lean ${String(lean)} from ${String(startX)}`,
            ).toBeLessThan(1e-9);
          }
        }
      }
    }
  });

  it('hooks the way it is leaning, and further the longer it is in the air', () => {
    for (let stage = 0; stage < STAGES.length; stage += 1) {
      const drift = predictLanding('p1', 300, stage, 1) - 300;
      expect(drift).toBeGreaterThan(0);
      expect(predictLanding('p1', 300, stage, -1) - 300).toBeCloseTo(-drift, 9);
      expect(predictLanding('p1', 300, stage, 0)).toBe(300);
      if (stage > 0) {
        expect(drift).toBeGreaterThan(predictLanding('p1', 300, stage - 1, 1) - 300);
      }
    }
  });

  it('is barely bent at the ice and well bent by the far line', () => {
    // Threading a gap and arriving on a target are two different problems. If the hook were
    // most of the way done by the wall line, the lean would be one decision rather than two.
    for (let stage = 0; stage < STAGES.length; stage += 1) {
      const atWall = Math.abs(predictAtY('p1', 300, stage, 1, WALL_Y) - 300);
      const atLine = Math.abs(predictLanding('p1', 300, stage, 1) - 300);
      expect(atWall).toBeLessThan(atLine / 3);
    }
  });
});

describe('collision', () => {
  it('never lets a snowball pass through the ice', () => {
    // Swept, not sampled. The fastest ball covers 24.7 units a step against a wall with no
    // thickness at all, so a static test at the ends of the step would miss it outright.
    for (const seat of SEATS) {
      for (let stage = 0; stage < STAGES.length; stage += 1) {
        const wall = WALL_SPANS[0] as { x1: number; x2: number };
        const startX = Math.round((wall.x1 + wall.x2) / 2);
        const game = createGame();
        const thrower = throwerOf(game, seat);
        thrower.x = startX;
        thrower.prevX = startX;
        thrower.ready = (STAGES[stage] as Stage).windUp;
        const go: Command = { dir: 0, release: true };
        step(game, STEP, seat === 'p1' ? go : still(), seat === 'p2' ? go : still());
        run(game, 240);
        expect(activeBalls(game), `${seat} stage ${String(stage)}`).toBe(0);
        expect(game.walls[0]?.chips).toBe(WALL_HEALTH - (STAGES[stage] as Stage).damage);
        expect(throwerOf(game, otherOf(seat)).health).toBe(HEALTH);
      }
    }
  });

  it('still stops a snowball moving several times faster than any this game throws', () => {
    // The engine's own regression fires at 5000 units a second; this is the same claim
    // made through this game's step, in case a future speed change outruns the geometry.
    const game = createGame();
    const wall = WALL_SPANS[1] as { x1: number; x2: number };
    const ball = game.balls[0] as Ball;
    ball.active = true;
    ball.owner = 'p1';
    ball.stage = 0;
    ball.x = (wall.x1 + wall.x2) / 2;
    ball.y = BASELINE_P1;
    ball.prevX = ball.x;
    ball.prevY = ball.y;
    ball.vx = 0;
    ball.vy = -5000;
    ball.ax = 0;
    // Eighty-three units a step against a line with no thickness: four steps is the whole
    // trip from the baseline to the ice, and it must not arrive on the far side of it.
    for (let i = 0; i < 10; i += 1) step(game, STEP, still(), still());
    expect(ball.active).toBe(false);
    expect(game.walls[1]?.chips).toBe(WALL_HEALTH - 1);
  });

  it('hits a thrower that is walking into the throw within one step', () => {
    // The target moves too, so the sweep is against the ball's displacement *relative* to
    // it. A stationary test misses a pair converging inside a single step.
    const game = createGame();
    for (const wall of game.walls) wall.chips = 0;
    const ball = game.balls[0] as Ball;
    const size = STAGES[0] as Stage;
    ball.active = true;
    ball.owner = 'p2';
    ball.stage = 0;
    ball.y = BASELINE_P1 - size.speed * STEP - THROWER_RADIUS - size.radius + 1;
    ball.x = 300 + MOVE_SPEED * STEP;
    ball.prevX = ball.x;
    ball.prevY = ball.y;
    ball.vx = 0;
    ball.vy = size.speed;
    ball.ax = 0;
    game.p1.x = 300;
    game.p1.prevX = 300;
    step(game, STEP, { dir: 1, release: false }, still());
    expect(ball.active).toBe(false);
    expect(game.p1.health).toBe(HEALTH - size.damage);
  });

  it('breaks the ice down and then throws through where it stood', () => {
    const game = createGame();
    const wall = WALL_SPANS[0] as { x1: number; x2: number };
    const startX = Math.round((wall.x1 + wall.x2) / 2);
    game.p1.x = startX;
    game.p1.prevX = startX;
    game.p2.x = startX;
    game.p2.prevX = startX;
    let guard = 0;
    while ((game.walls[0]?.chips ?? 0) > 0) {
      throwOne(game, 'p1', (STAGES[0] as Stage).windUp);
      run(game, 60);
      guard += 1;
      expect(guard, 'the ice never came down').toBeLessThan(20);
    }
    expect(game.p2.health).toBe(HEALTH);
    throwOne(game, 'p1', (STAGES[0] as Stage).windUp);
    run(game, 60);
    expect(game.p2.health).toBe(HEALTH - (STAGES[0] as Stage).damage);
  });
});

describe('scoring and the end of a match', () => {
  it('is won by taking the other seat to nothing', () => {
    const game = createGame();
    game.p2.health = 1;
    game.p1.x = 300;
    game.p1.prevX = 300;
    game.p2.x = 300;
    game.p2.prevX = 300;
    for (const wall of game.walls) wall.chips = 0;
    throwOne(game, 'p1', (STAGES[0] as Stage).windUp);
    run(game, 60);
    expect(game.p2.health).toBe(0);
    expect(winnerOf(game)).toBe('p1');
  });

  it('calls a double knockout a draw rather than a win for whoever was checked first', () => {
    const game = createGame();
    game.p1.health = 1;
    game.p2.health = 1;
    for (const wall of game.walls) wall.chips = 0;
    for (const seat of SEATS) {
      const thrower = throwerOf(game, seat);
      thrower.x = 300;
      thrower.prevX = 300;
      thrower.ready = (STAGES[0] as Stage).windUp;
    }
    step(game, STEP, { dir: 0, release: true }, { dir: 0, release: true });
    run(game, 120);
    expect(game.p1.health).toBe(0);
    expect(game.p2.health).toBe(0);
    expect(winnerOf(game)).toBe('draw');
  });

  it('settles the whistle on health, then on throws landed, then a draw', () => {
    const level = createGame();
    level.clock = STEP / 2;
    step(level, STEP, still(), still());
    expect(winnerOf(level)).toBe('draw');

    const onHealth = createGame();
    onHealth.clock = STEP / 2;
    onHealth.p2.health = HEALTH - 1;
    step(onHealth, STEP, still(), still());
    expect(winnerOf(onHealth)).toBe('p1');

    const onHits = createGame();
    onHits.clock = STEP / 2;
    // Level on health — four ones against two twos — and separated by how often each
    // player actually connected. That is the resolution the primary score does not have.
    onHits.p1.hits = 4;
    onHits.p2.hits = 2;
    step(onHits, STEP, still(), still());
    expect(winnerOf(onHits)).toBe('p1');
  });

  it('ends even when neither player ever throws — with no step cap at all', () => {
    // No ceiling on the loop on purpose: a match that could not finish would hang the
    // suite rather than pass quietly. `roundSeconds` ends nothing, so the clock is here.
    const game = createGame();
    let steps = 0;
    while (winnerOf(game) === null) {
      step(game, STEP, still(), still());
      steps += 1;
    }
    expect(winnerOf(game)).toBe('draw');
    expect(steps).toBeGreaterThan(MATCH_SECONDS * 60 - 2);
    expect(steps).toBeLessThan(MATCH_SECONDS * 60 + 2);
  });

  it('stops simulating once it is over', () => {
    const game = createGame();
    game.p2.health = 0;
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('p1');
    const clock = game.clock;
    run(game, 60, { dir: 1, release: true }, { dir: -1, release: true });
    expect(game.clock).toBe(clock);
    expect(game.p1.x).toBe(300);
    expect(activeBalls(game)).toBe(0);
  });

  it('is level again after a reset', () => {
    const game = createGame();
    game.p1.health = 2;
    game.p2.health = 3;
    game.clock = 1;
    (game.walls[0] as { chips: number }).chips = 0;
    resetGame(game);
    expect(game.p1.health).toBe(HEALTH);
    expect(game.p2.health).toBe(HEALTH);
    expect(game.clock).toBe(MATCH_SECONDS);
    expect(game.walls.every((wall) => wall.chips === WALL_HEALTH)).toBe(true);
    expect(winnerOf(game)).toBeNull();
  });
});

describe('the simulation itself', () => {
  it('walks nobody faster than the walking speed, whatever it is asked for', () => {
    const game = createGame();
    for (const dir of [-1, 1]) {
      resetGame(game);
      const before = game.p1.x;
      step(game, STEP, { dir, release: false }, still());
      expect(Math.abs(game.p1.x - before)).toBeCloseTo(MOVE_SPEED * STEP, 12);
    }
  });

  it('keeps both throwers inside their lane', () => {
    const game = createGame();
    run(game, 600, { dir: -1, release: false }, { dir: 1, release: false });
    expect(game.p1.x).toBe(LANE_MIN);
    expect(game.p2.x).toBe(LANE_MAX);
  });

  it('is a plain value graph that survives a round trip through JSON', () => {
    const game = createGame();
    const rng = new Rng(9);
    const cmd = { p1: createCommand(), p2: createCommand() };
    const state = { p1: createBotState(), p2: createBotState() };
    for (let i = 0; i < 900; i += 1) {
      for (const seat of SEATS) {
        botCommand(game, seat, 'normal', state[seat], rng, STEP, cmd[seat]);
      }
      step(game, STEP, cmd.p1, cmd.p2);
    }
    const copy = JSON.parse(JSON.stringify(game)) as Game;
    expect(copy).toEqual(game);
    // And it restores exactly: two continuations from the same position must agree.
    const plain = { dir: 1, release: true } as Command;
    for (let i = 0; i < 300; i += 1) {
      step(game, STEP, plain, plain);
      step(copy, STEP, plain, plain);
    }
    expect(copy).toEqual(game);
  });

  it('replays an input trace to the identical final state', () => {
    const script = new Rng(4242);
    const trace: [Command, Command][] = [];
    for (let i = 0; i < 2000; i += 1) {
      trace.push([
        { dir: script.int(-1, 2), release: script.bool(0.02) },
        { dir: script.int(-1, 2), release: script.bool(0.02) },
      ]);
    }
    const once = createGame();
    const twice = createGame();
    for (const [a, b] of trace) step(once, STEP, a, b);
    for (const [a, b] of trace) step(twice, STEP, a, b);
    expect(twice).toEqual(once);
    expect(once.p1.throws + once.p2.throws).toBeGreaterThan(10);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Half-turn covariance — the regression test for the two bugs that cost the most         */
/* ------------------------------------------------------------------------------------ */

/**
 * The board turned over, with the seats changing places.
 *
 * Two separate defects made this false and each was worth double figures of win rate to
 * seat one: a dodge that broke its tie in board coordinates rather than in the seat's own
 * frame, and a reaction threshold compared against a ball age recovered from an
 * asymmetrically accumulated position. Neither showed up in any other test, because a game
 * that is wrong in exactly the same way for both seats is still self-consistent.
 */
function mirror(game: Game): Game {
  const out = createGame();
  out.clock = game.clock;
  out.winner = game.winner === 'p1' ? 'p2' : game.winner === 'p2' ? 'p1' : game.winner;
  const pairs: readonly (readonly [Thrower, Thrower])[] = [
    [game.p1, out.p2],
    [game.p2, out.p1],
  ];
  for (const [from, to] of pairs) {
    to.x = BOARD_WIDTH - from.x;
    to.prevX = BOARD_WIDTH - from.prevX;
    to.dir = -from.dir;
    to.lean = -from.lean;
    to.ready = from.ready;
    to.health = from.health;
    to.hits = from.hits;
    to.throws = from.throws;
    to.flash = from.flash;
  }
  for (let i = 0; i < game.walls.length; i += 1) {
    const target = out.walls[game.walls.length - 1 - i];
    const source = game.walls[i];
    if (target !== undefined && source !== undefined) target.chips = source.chips;
  }
  for (let i = 0; i < game.balls.length; i += 1) {
    const from = game.balls[i];
    const to = out.balls[i];
    if (from === undefined || to === undefined) continue;
    to.active = from.active;
    to.owner = otherOf(from.owner);
    to.stage = from.stage;
    to.x = BOARD_WIDTH - from.x;
    to.y = BOARD_HEIGHT - from.y;
    to.prevX = BOARD_WIDTH - from.prevX;
    to.prevY = BOARD_HEIGHT - from.prevY;
    to.vx = -from.vx;
    to.vy = -from.vy;
    to.ax = -from.ax;
    to.age = from.age;
  }
  return out;
}

/** Slot order is an implementation detail; the set of snowballs in the air is not. */
function describe1(game: Game): string {
  const seat = (t: Thrower): string =>
    [t.x, t.prevX, t.dir, t.lean, t.ready, t.health, t.hits, t.throws, t.flash]
      .map((v) => (typeof v === 'number' ? v.toFixed(6) : String(v)))
      .join('/');
  return JSON.stringify([
    seat(game.p1),
    seat(game.p2),
    game.walls.map((w) => w.chips),
    game.clock.toFixed(6),
    String(game.winner),
    game.balls
      .filter((b) => b.active)
      .map(
        (b) =>
          `${b.owner}|${String(b.stage)}|${b.x.toFixed(6)}|${b.y.toFixed(6)}|` +
          `${b.vx.toFixed(6)}|${b.vy.toFixed(6)}|${b.ax.toFixed(6)}|${b.age.toFixed(6)}`,
      )
      .sort(),
  ]);
}

function scramble(game: Game, rng: Rng): void {
  game.p1.x = LANE_MIN + rng.int(0, 127) * 4;
  game.p1.prevX = game.p1.x;
  game.p2.x = LANE_MIN + rng.int(0, 127) * 4;
  game.p2.prevX = game.p2.x;
  game.p1.ready = rng.float() * 2.5;
  game.p2.ready = rng.float() * 2.5;
  game.p1.lean = rng.int(-1, 2);
  game.p2.lean = rng.int(-1, 2);
  game.p1.dir = rng.int(-1, 2);
  game.p2.dir = rng.int(-1, 2);
  for (const wall of game.walls) wall.chips = rng.int(0, WALL_HEALTH + 1);
  const live = rng.int(0, 5);
  for (let i = 0; i < live; i += 1) {
    const ball = game.balls[i];
    if (ball === undefined) continue;
    const owner: SeatId = rng.bool() ? 'p1' : 'p2';
    const stage = rng.int(0, STAGES.length);
    const size = STAGES[stage] as Stage;
    const lean = rng.int(-1, 2);
    const age = rng.float() * 0.6;
    ball.active = true;
    ball.owner = owner;
    ball.stage = stage;
    ball.y = launchY(owner, stage) + firingSign(owner) * size.speed * age;
    ball.x = LANE_MIN + rng.int(0, 127) * 4 + 0.5 * lean * CURVE * age * age;
    ball.prevX = ball.x;
    ball.prevY = ball.y;
    ball.vx = lean * CURVE * age;
    ball.vy = firingSign(owner) * size.speed;
    ball.ax = lean * CURVE;
    ball.age = age;
  }
}

describe('the half-turn', () => {
  it('steps a mirrored board to the mirror of the stepped board', () => {
    const rng = new Rng(4242);
    for (let trial = 0; trial < 500; trial += 1) {
      const game = createGame();
      scramble(game, rng);
      const other = mirror(game);
      const a: Command = { dir: rng.int(-1, 2), release: rng.bool(0.3) };
      const b: Command = { dir: rng.int(-1, 2), release: rng.bool(0.3) };
      step(game, STEP, a, b);
      step(other, STEP, { dir: -b.dir, release: b.release }, { dir: -a.dir, release: a.release });
      expect(describe1(other), `trial ${String(trial)}`).toBe(describe1(mirror(game)));
    }
  });

  it('makes a bot want the mirrored thing on a mirrored board', () => {
    const rng = new Rng(99);
    for (const tier of Object.keys(BOT_PROFILES) as BotDifficulty[]) {
      const profile = BOT_PROFILES[tier];
      for (let trial = 0; trial < 400; trial += 1) {
        const game = createGame();
        scramble(game, rng);
        const other = mirror(game);
        const here = createBotState();
        const there = createBotState();
        here.capStage = rng.int(0, STAGES.length);
        there.capStage = here.capStage;
        here.blundering = rng.bool(0.2);
        there.blundering = here.blundering;
        expect(chooseSpot(game, 'p1', profile, here)).toBeCloseTo(
          BOARD_WIDTH - chooseSpot(other, 'p2', profile, there),
          9,
        );
        expect(wantsRelease(game, 'p1', profile, here)).toBe(
          wantsRelease(other, 'p2', profile, there),
        );
      }
    }
  });

  it('gives two mirror-image snowballs the identical age', () => {
    // The regression that mattered most: age used to be recovered from position, and the
    // two seats accumulate position from opposite ends of the board, so mirror images
    // differed in the last bits — enough to land on opposite sides of a reaction threshold
    // that falls on a whole frame. Counting from zero is what makes them equal.
    const game = createGame();
    for (const wall of game.walls) wall.chips = 0;
    for (const seat of SEATS) {
      const thrower = throwerOf(game, seat);
      thrower.x = 300;
      thrower.prevX = 300;
      thrower.ready = (STAGES[0] as Stage).windUp;
    }
    step(game, STEP, { dir: 0, release: true }, { dir: 0, release: true });
    for (let i = 0; i < 12; i += 1) {
      const ages = game.balls.filter((b) => b.active).map((b) => ballAge(b));
      expect(ages.length).toBe(2);
      expect(ages[0]).toBe(ages[1]);
      step(game, STEP, still(), still());
    }
  });
});

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                                */
/* ------------------------------------------------------------------------------------ */

interface Outcome {
  winner: SeatId | 'draw' | null;
  steps: number;
  throws: number;
  hits: number;
  peak: number;
}

function playBots(
  seed: number,
  p1: BotDifficulty,
  p2: BotDifficulty,
  reversePoll = false,
): Outcome {
  const game = createGame();
  const source = new Rng(seed);
  const rng: Record<SeatId, Rng> = {
    p1: new Rng(source.next() | 0),
    p2: new Rng(source.next() | 0),
  };
  const state = { p1: createBotState(), p2: createBotState() };
  const cmd = { p1: createCommand(), p2: createCommand() };
  const tier: Record<SeatId, BotDifficulty> = { p1, p2 };
  const order: SeatId[] = reversePoll ? ['p2', 'p1'] : ['p1', 'p2'];
  let peak = 0;
  let steps = 0;
  while (winnerOf(game) === null) {
    for (const seat of order) {
      botCommand(game, seat, tier[seat], state[seat], rng[seat], STEP, cmd[seat]);
    }
    step(game, STEP, cmd.p1, cmd.p2);
    peak = Math.max(peak, activeBalls(game));
    steps += 1;
  }
  return {
    winner: winnerOf(game),
    steps,
    throws: game.p1.throws + game.p2.throws,
    hits: game.p1.hits + game.p2.hits,
    peak,
  };
}

describe('the bot', () => {
  it('draws exactly the same number of values whatever it can see', () => {
    // A count that depended on the board would make one seat's play a function of the
    // other's, which is how Fruit Duel grew a seat bias out of arithmetic. Checked over a
    // whole match rather than over one decision, because what varies with the board is not
    // only the draws per decision but how many decisions there are.
    for (const tier of Object.keys(BOT_PROFILES) as BotDifficulty[]) {
      const busy = createGame();
      scramble(busy, new Rng(7));
      const quiet = createGame();
      const finals: string[] = [];
      for (const board of [busy, quiet]) {
        const rng = new Rng(11);
        const state = createBotState();
        const out = createCommand();
        botCommand(board, 'p1', tier, state, rng, STEP, out);
        // The first call always decides, so exactly one decision's worth has been drawn.
        const counter = new Rng(11);
        for (let i = 0; i < BOT_DRAWS_PER_DECISION; i += 1) counter.float();
        expect(counter.save(), tier).toEqual(rng.save());
        // And over a whole match the two boards must still be at the same point, which is
        // what says the decision *count* is a function of the stream and nothing else.
        for (let i = 0; i < 1800; i += 1) {
          botCommand(board, 'p1', tier, state, rng, STEP, out);
          step(board, STEP, out, still());
        }
        finals.push(JSON.stringify(rng.save()));
      }
      expect(finals[1], tier).toBe(finals[0]);
    }
  });

  it('plays a bit-identical match whichever seat is polled first', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const forwards = playBots(seed * 613, 'hard', 'hard');
      const backwards = playBots(seed * 613, 'hard', 'hard', true);
      expect(backwards).toEqual(forwards);
    }
  });

  it('never walks faster than a person can, and never leaves its lane', () => {
    const game = createGame();
    const rng = new Rng(5);
    const state = { p1: createBotState(), p2: createBotState() };
    const cmd = { p1: createCommand(), p2: createCommand() };
    for (let i = 0; i < 3600 && winnerOf(game) === null; i += 1) {
      const before = { p1: game.p1.x, p2: game.p2.x };
      for (const seat of SEATS) {
        botCommand(game, seat, 'hard', state[seat], rng, STEP, cmd[seat]);
        expect(Math.abs(cmd[seat].dir)).toBeLessThanOrEqual(1);
        expect(Number.isInteger(cmd[seat].dir)).toBe(true);
      }
      step(game, STEP, cmd.p1, cmd.p2);
      for (const seat of SEATS) {
        const thrower = throwerOf(game, seat);
        expect(Math.abs(thrower.x - before[seat])).toBeLessThanOrEqual(MOVE_SPEED * STEP + 1e-9);
        expect(thrower.x).toBeGreaterThanOrEqual(LANE_MIN);
        expect(thrower.x).toBeLessThanOrEqual(LANE_MAX);
      }
    }
  });

  it('lets go eventually, however hopeless the board looks', () => {
    // A real-time bot that only throws when a shot lines up can wait for an alignment that
    // never comes; Cup Pong's needle bot swept for ever on the second seed it ever saw.
    // `patience` is a countdown, and a countdown cannot fail to expire.
    const game = createGame();
    // Ice everywhere in front of it and the other player parked in a corner.
    game.p1.x = (WALL_SPANS[0] as { x1: number; x2: number }).x1 + 20;
    game.p1.prevX = game.p1.x;
    game.p2.x = LANE_MAX;
    game.p2.prevX = LANE_MAX;
    const state = createBotState();
    const out = createCommand();
    const rng = new Rng(3);
    let released = 0;
    for (let i = 0; i < 60 * 20; i += 1) {
      botCommand(game, 'p1', 'hard', state, rng, STEP, out);
      step(game, STEP, out, still());
      if (game.p1.throws > released) released = game.p1.throws;
    }
    expect(released).toBeGreaterThan(4);
  });

  it('reads only what is drawn on the board', () => {
    // The two things a bot extrapolates are a snowball's path and whether the ice is in the
    // way, and both are on the screen: the ball, its hook tick, and the walls' blocks.
    const game = createGame();
    const ball = game.balls[0] as Ball;
    ball.active = true;
    ball.owner = 'p2';
    ball.stage = 0;
    ball.x = 200;
    ball.y = 400;
    ball.prevX = 200;
    ball.prevY = 400;
    ball.vx = 60;
    ball.vy = (STAGES[0] as Stage).speed;
    ball.ax = CURVE;
    ball.age = 0.1;
    const time = (BASELINE_P1 - 400) / ball.vy;
    expect(ballCrossing(ball, BASELINE_P1)).toBeCloseTo(
      200 + 60 * time + 0.5 * CURVE * time * time,
      9,
    );
    expect(blockedByWall(game, 'p1', 170, 0, 0)).toBe(true);
    expect(blockedByWall(game, 'p1', 300, 0, 0)).toBe(false);
    (game.walls[0] as { chips: number }).chips = 0;
    expect(blockedByWall(game, 'p1', 170, 0, 0)).toBe(false);
  });

  it('never fills the pool of snowballs, so no throw is ever silently swallowed', () => {
    for (const tier of Object.keys(BOT_PROFILES) as BotDifficulty[]) {
      for (let seed = 1; seed <= 12; seed += 1) {
        expect(playBots(seed * 977, tier, tier).peak, tier).toBeLessThan(MAX_BALLS);
      }
    }
  });

  it('finishes every match at every pairing, well inside the clock', () => {
    const tiers = Object.keys(BOT_PROFILES) as BotDifficulty[];
    for (const a of tiers) {
      for (const b of tiers) {
        for (let seed = 1; seed <= 6; seed += 1) {
          const out = playBots(seed * 313, a, b);
          expect(out.winner, `${a} v ${b}`).not.toBeNull();
          expect(out.steps).toBeLessThan(MATCH_SECONDS * 60);
        }
      }
    }
  });

  it('is a ladder: the stronger tier wins more, from either seat', () => {
    // The numbers in SPEC.md come from a thousand seeds a pairing; this is the cheap
    // version that fails if the ordering ever inverts.
    const seeds = 90;
    const share = (a: BotDifficulty, b: BotDifficulty): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 1; seed <= seeds; seed += 1) {
        for (const swapped of [false, true]) {
          const out = swapped ? playBots(seed * 7919, b, a) : playBots(seed * 7919, a, b);
          if (out.winner === null || out.winner === 'draw') continue;
          decided += 1;
          const aWon = swapped ? out.winner === 'p2' : out.winner === 'p1';
          if (aWon) wins += 1;
        }
      }
      return (100 * wins) / decided;
    };
    const hardOverNormal = share('hard', 'normal');
    const normalOverEasy = share('normal', 'easy');
    const hardOverEasy = share('hard', 'easy');
    expect(normalOverEasy).toBeGreaterThan(62);
    expect(hardOverNormal).toBeGreaterThan(70);
    expect(hardOverEasy).toBeGreaterThan(hardOverNormal);
    expect(hardOverEasy).toBeLessThan(99.5);
  });

  it('gives neither seat an advantage at equal strength', () => {
    for (const tier of Object.keys(BOT_PROFILES) as BotDifficulty[]) {
      let p1 = 0;
      let decided = 0;
      for (let seed = 1; seed <= 150; seed += 1) {
        const out = playBots(seed * 7919, tier, tier);
        if (out.winner === null || out.winner === 'draw') continue;
        decided += 1;
        if (out.winner === 'p1') p1 += 1;
      }
      const share = (100 * p1) / decided;
      // Three independent thousand-seed samples put every tier inside 48–53%; this band is
      // what 150 seeds can actually resolve.
      expect(share, `${tier} seat-one share ${share.toFixed(1)}%`).toBeGreaterThan(38);
      expect(share, `${tier} seat-one share ${share.toFixed(1)}%`).toBeLessThan(62);
    }
  });

  it('lands fewer of its throws the better its opponent is at getting out of the way', () => {
    const rate = (a: BotDifficulty, b: BotDifficulty): number => {
      let hits = 0;
      let throws = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const out = playBots(seed * 7919, a, b);
        hits += out.hits;
        throws += out.throws;
      }
      return (100 * hits) / throws;
    };
    expect(rate('easy', 'easy')).toBeGreaterThan(rate('normal', 'normal'));
    expect(rate('normal', 'normal')).toBeGreaterThan(rate('hard', 'hard'));
  });
});
