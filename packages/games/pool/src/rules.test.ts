import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BALLS_PER_SIDE,
  BALL_RADIUS,
  BOT_PROFILES,
  CUSHION,
  POCKETS,
  STALEMATE_SHOTS,
  STOP_SPEED,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  blackBall,
  blocked,
  botAim,
  createGame,
  cueBall,
  normaliseAngle,
  onBlack,
  onTable,
  otherOf,
  remaining,
  replaceCue,
  resetGame,
  settleShot,
  step,
  strike,
  tableIsStill,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

/** Runs the table until it stops, returning everything potted. */
function settle(game: Game, maxSteps = 60 * 40): number[] {
  const potted: number[] = [];
  for (let i = 0; i < maxSteps; i += 1) {
    const result = step(game, STEP);
    potted.push(...result.potted);
    if (result.settled) break;
  }
  return potted;
}

/** A table with only the balls named, so a test can state its own position. */
function bare(...kept: number[]): Game {
  const game = createGame();
  for (let i = 0; i < game.balls.length; i += 1) {
    if (!kept.includes(i)) {
      const b = game.balls[i];
      if (b !== undefined) b.potted = true;
    }
  }
  return game;
}

describe('the rack', () => {
  it('has a cue ball, seven a side and a black', () => {
    const game = createGame();
    expect(game.balls.length).toBe(1 + BALLS_PER_SIDE * 2 + 1);
    expect(remaining(game, 'p1')).toBe(BALLS_PER_SIDE);
    expect(remaining(game, 'p2')).toBe(BALLS_PER_SIDE);
    expect(blackBall(game)).toBeDefined();
    expect(cueBall(game).kind).toBe('cue');
  });

  it('puts every ball on the table', () => {
    const game = createGame();
    for (const b of game.balls) {
      expect(b.x).toBeGreaterThan(CUSHION);
      expect(b.x).toBeLessThan(TABLE_WIDTH - CUSHION);
      expect(b.y).toBeGreaterThan(CUSHION);
      expect(b.y).toBeLessThan(TABLE_HEIGHT - CUSHION);
    }
  });

  it('racks without any two balls overlapping', () => {
    const game = createGame();
    for (let i = 0; i < game.balls.length; i += 1) {
      for (let j = i + 1; j < game.balls.length; j += 1) {
        const a = game.balls[i];
        const b = game.balls[j];
        if (a === undefined || b === undefined) continue;
        expect(
          Math.hypot(b.x - a.x, b.y - a.y),
          `balls ${String(i)} and ${String(j)} overlap`,
        ).toBeGreaterThanOrEqual(BALL_RADIUS * 2 - 1e-6);
      }
    }
  });

  it('is the same rack every time, because an opening both players know is the game', () => {
    const a = createGame();
    const b = createGame();
    expect(a.balls.map((x) => `${String(x.x)},${String(x.y)},${x.kind}`)).toEqual(
      b.balls.map((x) => `${String(x.x)},${String(x.y)},${x.kind}`),
    );
  });

  it('starts over on reset', () => {
    const game = createGame();
    strike(game, 0, 1);
    settle(game);
    resetGame(game);
    expect(game.phase).toBe('aiming');
    expect(remaining(game, 'p1')).toBe(BALLS_PER_SIDE);
    expect(tableIsStill(game)).toBe(true);
  });
});

describe('striking', () => {
  it('sends the cue ball off at the angle given', () => {
    const game = createGame();
    expect(strike(game, 0, 1)).toBe(true);
    expect(cueBall(game).vx).toBeGreaterThan(0);
    expect(Math.abs(cueBall(game).vy)).toBeLessThan(1e-9);
    expect(game.phase).toBe('rolling');
  });

  it('refuses while the table is rolling', () => {
    const game = createGame();
    strike(game, 0, 1);
    expect(strike(game, 1, 1)).toBe(false);
  });

  it('refuses a shot with no power', () => {
    const game = createGame();
    expect(strike(game, 0, 0)).toBe(false);
    expect(game.phase, 'and the turn is not spent').toBe('aiming');
  });

  it('clamps power above one', () => {
    const game = createGame();
    strike(game, 0, 4);
    const fast = Math.hypot(cueBall(game).vx, cueBall(game).vy);
    resetGame(game);
    strike(game, 0, 1);
    expect(Math.hypot(cueBall(game).vx, cueBall(game).vy)).toBeCloseTo(fast, 5);
  });
});

describe('the table', () => {
  it('comes to rest rather than rolling for ever', () => {
    const game = createGame();
    strike(game, 0.3, 1);
    settle(game);
    expect(tableIsStill(game), 'every ball stopped').toBe(true);
  });

  it('slows a ball down', () => {
    const game = bare(0);
    game.phase = 'rolling';
    const cue = cueBall(game);
    cue.x = TABLE_WIDTH / 2;
    cue.y = TABLE_HEIGHT / 2;
    cue.vx = 400;
    cue.vy = 0;
    for (let i = 0; i < 30; i += 1) step(game, STEP);
    expect(Math.hypot(cue.vx, cue.vy), 'half a second on').toBeLessThan(200);
  });

  it('bounces off a cushion', () => {
    const game = bare(0);
    game.phase = 'rolling';
    const cue = cueBall(game);
    // A quarter of the way along, not the middle: the middle of the top rail is a pocket,
    // and the first version of this test rolled the ball straight into it and then asked
    // why it had not bounced.
    cue.x = TABLE_WIDTH * 0.3;
    cue.y = TABLE_HEIGHT / 2;
    cue.vx = 0;
    cue.vy = -700;
    for (let i = 0; i < 40; i += 1) step(game, STEP);
    expect(cue.vy, 'it came back down').toBeGreaterThan(0);
    expect(cue.y).toBeGreaterThan(CUSHION);
  });

  it('keeps every ball inside the cushions', () => {
    const game = createGame();
    strike(game, 0.7, 1);
    for (let i = 0; i < 60 * 30; i += 1) {
      step(game, STEP);
      for (const b of game.balls) {
        if (b.potted) continue;
        expect(b.x).toBeGreaterThanOrEqual(CUSHION + BALL_RADIUS - 1e-6);
        expect(b.x).toBeLessThanOrEqual(TABLE_WIDTH - CUSHION - BALL_RADIUS + 1e-6);
        expect(b.y).toBeGreaterThanOrEqual(CUSHION + BALL_RADIUS - 1e-6);
        expect(b.y).toBeLessThanOrEqual(TABLE_HEIGHT - CUSHION - BALL_RADIUS + 1e-6);
      }
      if (tableIsStill(game)) break;
    }
  });

  it('never leaves two balls inside one another once the table settles', () => {
    // Two overlapping balls swap velocities every frame and buzz in place. The positional
    // push exists to stop that, and this is the assertion that holds it.
    const game = createGame();
    strike(game, 0.05, 1);
    settle(game);
    for (let i = 0; i < game.balls.length; i += 1) {
      for (let j = i + 1; j < game.balls.length; j += 1) {
        const a = game.balls[i];
        const b = game.balls[j];
        if (a === undefined || b === undefined || a.potted || b.potted) continue;
        expect(
          Math.hypot(b.x - a.x, b.y - a.y),
          `balls ${String(i)} and ${String(j)} ended up overlapping`,
        ).toBeGreaterThan(BALL_RADIUS * 2 - 0.5);
      }
    }
  });

  it('leaves two balls that are already moving apart alone', () => {
    // A pair can still be touching on the step after they collide. Striking them again
    // there applies the impulse the wrong way and pulls them back together — a sticky
    // collision that quietly adds energy. Nothing else in this file notices, because the
    // positional push separates them anyway; only their velocities give it away.
    const game = bare(0, 1);
    game.phase = 'rolling';
    const a = game.balls[0];
    const b = game.balls[1];
    if (a === undefined || b === undefined) throw new Error('no fixture');

    // Overlapping by enough that they are *still* overlapping after the step moves them:
    // at 300 units a second each travels five units a frame, so starting a hair apart put
    // them clear before contacts were ever resolved and the test proved nothing.
    a.x = TABLE_WIDTH / 2 - 9;
    a.y = TABLE_HEIGHT / 2;
    b.x = TABLE_WIDTH / 2 + 9;
    b.y = TABLE_HEIGHT / 2;
    a.vx = -300;
    a.vy = 0;
    b.vx = 300;
    b.vy = 0;

    step(game, STEP);
    expect(a.vx, 'the left ball is still going left').toBeLessThan(0);
    expect(b.vx, 'the right ball is still going right').toBeGreaterThan(0);
  });

  it('replays identically from the same opening shot', () => {
    const trace = (): string => {
      const game = createGame();
      strike(game, 0.11, 0.9);
      settle(game);
      return game.balls.map((b) => `${b.x.toFixed(6)},${b.y.toFixed(6)}`).join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('agrees at two step sizes', () => {
    // Rule 8: a phone and a laptop must step the identical match, so the drag has to be a
    // per-second decay rather than a per-step multiply.
    const restingX = (dt: number): number => {
      const game = bare(0);
      game.phase = 'rolling';
      const cue = cueBall(game);
      cue.x = CUSHION + BALL_RADIUS + 10;
      cue.y = TABLE_HEIGHT / 2;
      cue.vx = 500;
      cue.vy = 0;
      for (let i = 0; i < Math.round(4 / dt); i += 1) step(game, dt);
      return cue.x;
    };
    const a = restingX(1 / 60);
    const b = restingX(1 / 120);
    expect(Math.abs(a - b) / Math.abs(a), 'within one per cent').toBeLessThan(0.01);
  });

  it('does nothing while nobody has struck', () => {
    const game = createGame();
    const before = game.balls.map((b) => b.x);
    step(game, STEP);
    expect(game.balls.map((b) => b.x)).toEqual(before);
  });
});

describe('potting', () => {
  it('pots a ball rolled into a pocket', () => {
    const game = bare(0);
    game.phase = 'rolling';
    const cue = cueBall(game);
    const [px, py] = POCKETS[0] as readonly [number, number];
    cue.x = px + 120;
    cue.y = py + 60;
    const angle = Math.atan2(py - cue.y, px - cue.x);
    cue.vx = Math.cos(angle) * 600;
    cue.vy = Math.sin(angle) * 600;
    settle(game);
    expect(cue.potted).toBe(true);
  });

  it('leaves a potted ball off the table for good', () => {
    const game = bare(0);
    game.phase = 'rolling';
    const cue = cueBall(game);
    cue.potted = true;
    const before = { x: cue.x, y: cue.y };
    for (let i = 0; i < 60; i += 1) step(game, STEP);
    expect(cue.x).toBe(before.x);
    expect(cue.y).toBe(before.y);
  });

  it('stops a ball below the crawl speed', () => {
    const game = bare(0);
    game.phase = 'rolling';
    const cue = cueBall(game);
    cue.x = TABLE_WIDTH / 2;
    cue.y = TABLE_HEIGHT / 2;
    cue.vx = STOP_SPEED * 0.5;
    cue.vy = 0;
    step(game, STEP);
    expect(cue.vx).toBe(0);
  });
});

describe('what a shot means', () => {
  function pottedIndex(game: Game, kind: 'cue' | 'p1' | 'p2' | 'black'): number {
    return game.balls.findIndex((b) => b.kind === kind);
  }

  it('buys another shot when you pot your own', () => {
    const game = createGame();
    const index = pottedIndex(game, 'p1');
    const b = game.balls[index];
    if (b !== undefined) b.potted = true;
    const outcome = settleShot(game, [index]);
    expect(outcome.next).toBe('p1');
    expect(outcome.winner).toBeNull();
  });

  it('passes the turn when you pot nothing', () => {
    const game = createGame();
    expect(settleShot(game, []).next).toBe('p2');
  });

  it('passes the turn when you pot the other side', () => {
    const game = createGame();
    const index = pottedIndex(game, 'p2');
    const b = game.balls[index];
    if (b !== undefined) b.potted = true;
    expect(settleShot(game, [index]).next).toBe('p2');
  });

  it('fouls and passes the turn when the cue ball goes down', () => {
    const game = createGame();
    const cue = cueBall(game);
    cue.potted = true;
    const outcome = settleShot(game, [0]);
    expect(outcome.fouled).toBe(true);
    expect(outcome.next).toBe('p2');
    expect(cue.potted, 'and the cue ball is back on the table').toBe(false);
  });

  it('loses the game if the black goes down early', () => {
    const game = createGame();
    const index = pottedIndex(game, 'black');
    const b = game.balls[index];
    if (b !== undefined) b.potted = true;
    expect(settleShot(game, [index]).winner, 'p1 potted it with seven still up').toBe('p2');
  });

  it('wins the game when the black goes down last', () => {
    const game = createGame();
    for (const b of game.balls) {
      if (b.kind === 'p1') b.potted = true;
    }
    const index = game.balls.findIndex((b) => b.kind === 'black');
    const black = game.balls[index];
    if (black !== undefined) black.potted = true;
    expect(onBlack(game, 'p1')).toBe(true);
    expect(settleShot(game, [index]).winner).toBe('p1');
  });

  it('does not let one stroke clear the last colour and the black', () => {
    // The player was not on the black when they struck, so it is not a legal finish.
    const game = createGame();
    for (const b of game.balls) {
      if (b.kind === 'p1') b.potted = true;
    }
    const last = game.balls.find((b) => b.kind === 'p1');
    if (last === undefined) throw new Error('no fixture');
    const lastIndex = game.balls.indexOf(last);
    const blackIndex = game.balls.findIndex((b) => b.kind === 'black');
    const black = game.balls[blackIndex];
    if (black !== undefined) black.potted = true;

    expect(settleShot(game, [lastIndex, blackIndex]).winner, 'the other player takes it').toBe(
      'p2',
    );
  });

  it('loses the game if the black goes down on a foul', () => {
    const game = createGame();
    for (const b of game.balls) {
      if (b.kind === 'p1') b.potted = true;
    }
    const blackIndex = game.balls.findIndex((b) => b.kind === 'black');
    const black = game.balls[blackIndex];
    if (black !== undefined) black.potted = true;
    cueBall(game).potted = true;
    expect(settleShot(game, [blackIndex, 0]).winner).toBe('p2');
  });
});

describe('a frame that cannot be won', () => {
  /**
   * Pool can reach a position neither player can clear, and nothing else would ever end
   * such a frame: `roundSeconds` is only used to print "about 5 min" on a catalogue card,
   * so an unwinnable position is an unwinnable *match*. Two `easy` bots proved it — forty
   * frames, not one of them finished, over a thousand shots each.
   */
  it('is called after twenty shots with nothing potted', () => {
    const game = createGame();
    let outcome = settleShot(game, []);
    for (let i = 1; i < STALEMATE_SHOTS; i += 1) {
      expect(outcome.winner, `still live after ${String(i)} dry shots`).toBeNull();
      game.seat = outcome.next;
      outcome = settleShot(game, []);
    }
    expect(outcome.winner, 'and then it is called').not.toBeNull();
  });

  it('gives it to whoever has potted more', () => {
    const game = createGame();
    for (const b of game.balls) {
      if (b.kind === 'p1') b.potted = true;
    }
    game.dryShots = STALEMATE_SHOTS - 1;
    expect(settleShot(game, []).winner).toBe('p1');
  });

  it('calls it a draw when the two are level', () => {
    const game = createGame();
    game.dryShots = STALEMATE_SHOTS - 1;
    expect(settleShot(game, []).winner, 'nothing potted either side').toBe('draw');
  });

  it('forgets the dry run the moment something goes down', () => {
    const game = createGame();
    game.dryShots = STALEMATE_SHOTS - 1;
    const index = game.balls.findIndex((b) => b.kind === 'p1');
    const b = game.balls[index];
    if (b !== undefined) b.potted = true;
    expect(settleShot(game, [index]).winner).toBeNull();
    expect(game.dryShots, 'the count starts again').toBe(0);
  });
});

describe('replacing the cue ball', () => {
  it('puts it back on the baulk line', () => {
    const game = createGame();
    const cue = cueBall(game);
    cue.potted = true;
    cue.x = 0;
    replaceCue(game);
    expect(cue.potted).toBe(false);
    expect(cue.x).toBeGreaterThan(CUSHION);
  });

  it('does not put it inside another ball', () => {
    const game = createGame();
    const cue = cueBall(game);
    // Park a colour exactly on the spot.
    const other = game.balls[1];
    if (other === undefined) throw new Error('no fixture');
    other.x = TABLE_WIDTH * 0.26;
    other.y = TABLE_HEIGHT / 2;
    cue.potted = true;
    replaceCue(game);
    expect(Math.hypot(other.x - cue.x, other.y - cue.y)).toBeGreaterThan(BALL_RADIUS * 2);
  });
});

describe('the bot', () => {
  const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('aims a shot with usable power', () => {
    for (const difficulty of DIFFICULTIES) {
      const game = createGame();
      const aim = botAim(game, difficulty, 0.5);
      expect(Number.isFinite(aim.angle)).toBe(true);
      expect(aim.power).toBeGreaterThan(0);
      expect(aim.power).toBeLessThanOrEqual(1);
    }
  });

  it('aims at the black once its colours are gone', () => {
    const game = createGame();
    for (const b of game.balls) {
      if (b.kind === 'p1') b.potted = true;
    }
    const black = blackBall(game);
    if (black === undefined) throw new Error('no fixture');
    black.x = TABLE_WIDTH * 0.7;
    black.y = TABLE_HEIGHT / 2;
    const cue = cueBall(game);
    cue.x = TABLE_WIDTH * 0.3;
    cue.y = TABLE_HEIGHT / 2;
    const aim = botAim(game, 'hard', 0.5);
    // Straight down the table, give or take the ghost-ball offset.
    expect(Math.abs(normaliseAngle(aim.angle))).toBeLessThan(0.5);
  });

  it('takes a straight pot when there is one', () => {
    // Cue, target and corner pocket on one line, so the correct shot has no cut at all.
    // The first version of this put both balls at y = 34, which is *inside* the top rail
    // and not a position a ball can occupy — and the bot rightly preferred a cut into the
    // middle pocket, which the test then called a failure.
    const game = bare(0);
    game.phase = 'aiming';
    const [px, py] = POCKETS[2] as readonly [number, number];
    const target = game.balls[1];
    if (target === undefined) throw new Error('no fixture');
    target.potted = false;
    target.x = 866;
    target.y = 134;
    const toPocket = Math.atan2(py - target.y, px - target.x);
    const cue = cueBall(game);
    cue.x = target.x - Math.cos(toPocket) * 200;
    cue.y = target.y - Math.sin(toPocket) * 200;

    const aim = botAim(game, 'hard', 0.5);
    expect(
      Math.abs(normaliseAngle(aim.angle - toPocket)),
      'it lines the cue up with the pocket, so the cut is nothing',
    ).toBeLessThan(0.05);
  });

  it('will not shoot through another ball', () => {
    // A ball parked on the line makes that pot impossible, and firing at it anyway is how
    // a frame grinds to a halt — thirty of forty `hard` frames never ended before this.
    const game = bare(0, 1, 2);
    game.phase = 'aiming';
    const [px, py] = POCKETS[2] as readonly [number, number];
    const target = game.balls[1];
    const blocker = game.balls[2];
    if (target === undefined || blocker === undefined) throw new Error('no fixture');
    target.potted = false;
    target.x = 866;
    target.y = 134;
    const toPocket = Math.atan2(py - target.y, px - target.x);
    const cue = cueBall(game);
    cue.x = target.x - Math.cos(toPocket) * 200;
    cue.y = target.y - Math.sin(toPocket) * 200;

    const ghostX = target.x - Math.cos(toPocket) * BALL_RADIUS * 2;
    const ghostY = target.y - Math.sin(toPocket) * BALL_RADIUS * 2;
    expect(blocked(game, cue, target, ghostX, ghostY), 'nothing in the way yet').toBe(false);

    // Park the blocker exactly half way along the cue's path.
    blocker.potted = false;
    blocker.x = (cue.x + ghostX) / 2;
    blocker.y = (cue.y + ghostY) / 2;
    expect(blocked(game, cue, target, ghostX, ghostY), 'now there is').toBe(true);
  });

  it('knows what is on the table and what is buried in a cushion', () => {
    expect(onTable(TABLE_WIDTH / 2, TABLE_HEIGHT / 2)).toBe(true);
    expect(onTable(TABLE_WIDTH / 2, CUSHION), 'a contact point inside the rail').toBe(false);
    expect(onTable(-10, TABLE_HEIGHT / 2)).toBe(false);
  });

  it('is steadier the harder it is', () => {
    expect(BOT_PROFILES.easy.spread).toBeGreaterThan(BOT_PROFILES.normal.spread);
    expect(BOT_PROFILES.normal.spread).toBeGreaterThan(BOT_PROFILES.hard.spread);
  });

  it('draws its error once for the shot, not per step', () => {
    // A per-step error averages to zero and every tier plays the same. Two different rolls
    // must give two different angles, and the same roll the same angle.
    const game = createGame();
    expect(botAim(game, 'easy', 0.1).angle).not.toBe(botAim(game, 'easy', 0.9).angle);
    expect(botAim(game, 'easy', 0.4).angle).toBe(botAim(game, 'easy', 0.4).angle);
  });

  it('pots more of its own the harder it is', () => {
    // A full solo frame a tier: shoot until the table settles, count what went down.
    const pottedFor = (difficulty: BotDifficulty): number => {
      let total = 0;
      const frames = 40;
      for (let seed = 0; seed < frames; seed += 1) {
        const game = createGame();
        const rng = new Rng(seed * 7919 + 3);
        for (let shot = 0; shot < 14; shot += 1) {
          if (game.phase !== 'aiming') break;
          const aim = botAim(game, difficulty, rng.float());
          if (!strike(game, aim.angle, aim.power)) break;
          const potted = settle(game);
          for (const index of potted) {
            const b = game.balls[index];
            if (b !== undefined && b.kind === 'p1') total += 1;
          }
          if (cueBall(game).potted) replaceCue(game);
          game.phase = 'aiming';
        }
      }
      return total / frames;
    };

    const easy = pottedFor('easy');
    const hard = pottedFor('hard');
    expect(hard, `hard ${String(hard)} beats easy ${String(easy)}`).toBeGreaterThan(easy);
  });
});

describe('angles', () => {
  it('normalises into a half-turn either side', () => {
    expect(normaliseAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(normaliseAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 6);
    expect(normaliseAngle(0.4)).toBeCloseTo(0.4, 6);
  });
});

describe('seats', () => {
  it('has two', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});
