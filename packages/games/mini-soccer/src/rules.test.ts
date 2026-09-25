import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BALL_DRAG,
  BALL_DRAG_RATE,
  BALL_RADIUS,
  BOT_PROFILES,
  CELEBRATE_SECONDS,
  GOAL_HEIGHT,
  KICK_SPEED,
  MATCH_SECONDS,
  MAX_BALL_SPEED,
  PITCH_HEIGHT,
  PITCH_WIDTH,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  WALL,
  botHeading,
  createBotState,
  createGame,
  drive,
  contest,
  goalMouth,
  inGoal,
  kickOff,
  otherOf,
  resetBotState,
  resetGame,
  step,
  touching,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game, Mover } from './rules.js';

/** Far enough off the pitch that this player is touching nothing. */
const AWAY: Mover = { x: -5000, y: -5000, vx: 0, vy: 0 };

/**
 * A live position with the ball and the two players put exactly where a test wants them.
 *
 * The second player defaults to somewhere off the pitch, so a test about one body pressing
 * on the ball is about one body pressing on the ball.
 */
function placed(ball: Mover, p1: Mover, p2: Mover = AWAY): Game {
  const game = createGame(new Rng(1));
  Object.assign(game.ball, ball);
  Object.assign(game.p1, p1);
  Object.assign(game.p2, p2);
  game.phase = 'playing';
  return game;
}

const STEP = 1 / 60;
const heading = { x: 0, y: 0 };

/** Runs the kick-off pause out so the ball is live. */
function goLive(game: Game, rng = new Rng(1)): void {
  for (let i = 0; i < 200 && game.phase !== 'playing'; i += 1) step(game, STEP, rng);
}

function play(p1: BotDifficulty, p2: BotDifficulty, seed: number): Game {
  const rng = new Rng(seed);
  const game = createGame(rng);
  const botP1 = createBotState();
  const botP2 = createBotState();
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  for (let i = 0; i < 60 * 200 && winnerOf(game) === null; i += 1) {
    botHeading(a, game, botP1, 'p1', BOT_PROFILES[p1], STEP, rng.float());
    botHeading(b, game, botP2, 'p2', BOT_PROFILES[p2], STEP, rng.float());
    drive(game, 'p1', a.x, a.y, STEP);
    drive(game, 'p2', b.x, b.y, STEP);
    step(game, STEP, rng);
  }
  return game;
}

describe('the pitch', () => {
  it('puts a goal at each end, centred', () => {
    const left = goalMouth('p1');
    const right = goalMouth('p2');
    expect(left.x).toBeLessThan(right.x);
    expect(left.top).toBe(right.top);
    expect(left.bottom - left.top).toBe(GOAL_HEIGHT);
    expect((left.top + left.bottom) / 2).toBeCloseTo(PITCH_HEIGHT / 2, 6);
  });

  it('keeps a player inside the walls however long they run', () => {
    const game = createGame(new Rng(1));
    for (let i = 0; i < 600; i += 1) drive(game, 'p1', 1, 1, STEP);
    expect(game.p1.x).toBeLessThanOrEqual(PITCH_WIDTH - WALL - PLAYER_RADIUS + 1e-6);
    expect(game.p1.y).toBeLessThanOrEqual(PITCH_HEIGHT - WALL - PLAYER_RADIUS + 1e-6);
  });

  it('does not let a diagonal run faster than a straight one', () => {
    const straight = createGame(new Rng(1));
    const diagonal = createGame(new Rng(1));
    const from = straight.p1.x;
    for (let i = 0; i < 20; i += 1) {
      drive(straight, 'p1', 1, 0, STEP);
      drive(diagonal, 'p1', 1, 1, STEP);
    }
    const a = Math.hypot(straight.p1.x - from, straight.p1.y - PITCH_HEIGHT / 2);
    const b = Math.hypot(diagonal.p1.x - from, diagonal.p1.y - PITCH_HEIGHT / 2);
    expect(b).toBeCloseTo(a, 4);
  });

  it('stops a player dead when nothing is pressed', () => {
    // The kick takes some of the striker's motion, so a stale velocity would let a player
    // who has stopped keep striking as though they were running.
    const game = createGame(new Rng(1));
    drive(game, 'p1', 1, 0, STEP);
    expect(game.p1.vx).toBeGreaterThan(0);
    drive(game, 'p1', 0, 0, STEP);
    expect(game.p1.vx).toBe(0);
  });

  it('resets in place', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    game.score.p1 = 3;
    game.clock = 10;
    resetGame(game, rng);
    expect(game.score).toEqual({ p1: 0, p2: 0 });
    expect(game.clock).toBe(MATCH_SECONDS);
  });
});

describe('the ball', () => {
  it('slows down and settles rather than rolling for ever', () => {
    // A simulation that only ever adds energy never settles. Crabby Volley paid for this
    // lesson; the drag here is why a loose ball comes to rest.
    expect(BALL_DRAG).toBeLessThan(1);
    const rng = new Rng(1);
    const game = createGame(rng);
    goLive(game, rng);
    // In open space, away from both players and from either end. The first version of
    // this sent the ball at 500 down the centre line — straight into the goal mouth, so
    // it scored, reset, and the test measured a ball sitting still on the spot. It passed
    // with the drag removed entirely.
    game.p1.x = 120;
    game.p1.y = 60;
    game.p2.x = 880;
    game.p2.y = 60;
    game.ball.x = PITCH_WIDTH / 2;
    game.ball.y = PITCH_HEIGHT / 2;
    game.ball.vx = 200;
    game.ball.vy = 0;
    for (let i = 0; i < 60; i += 1) step(game, STEP, rng);
    expect(game.phase, 'nothing was scored').toBe('playing');
    expect(Math.hypot(game.ball.vx, game.ball.vy), 'a second on, it has slowed').toBeLessThan(120);
  });

  it('does not roll further just because the step is smaller', () => {
    // Drag as a per-second decay, so the frame rate cannot change the game.
    const roll = (dt: number): number => {
      const rng = new Rng(1);
      const game = createGame(rng);
      goLive(game, rng);
      game.p1.y = 40;
      game.p2.y = 40;
      game.ball.x = PITCH_WIDTH / 2;
      game.ball.y = PITCH_HEIGHT - WALL - BALL_RADIUS - 1;
      game.ball.vx = 400;
      game.ball.vy = 0;
      const start = game.ball.x;
      const steps = Math.round(1.5 / dt);
      for (let i = 0; i < steps; i += 1) step(game, dt, rng);
      return game.ball.x - start;
    };
    // **To nine decimals, not to one per cent.** The note that used to stand here said a
    // first-order integrator cannot agree exactly across step sizes and that demanding it
    // does tests the arithmetic rather than the property. That was wrong, and the one per
    // cent band it justified was hiding a real 0.72% disagreement at 60 Hz. The decay was
    // never first-order — it is a per-second power and is exact at any step size. Only the
    // *travel* was: `v · dt` is a rectangle rule under a falling curve. Move the ball by
    // `(v_before - v_after) / BALL_DRAG_RATE` instead and the terms telescope, so the four
    // rates agree to floating point and there is nothing left for a tolerance to excuse.
    const reference = roll(1 / 60);
    for (const hz of [90, 120, 240]) {
      expect(roll(1 / hz), `${hz} Hz agrees with 60 Hz`).toBeCloseTo(reference, 9);
    }
  });

  it('rolls exactly as far as the closed-form law says', () => {
    // The defect issue #2465 is about, in the form that bites: the decay was already
    // step-size exact, but the position was a rectangle rule, so the pitch disagreed with
    // its own distance law by `dt · BALL_DRAG_RATE / 2` — 0.72% at 60 Hz, and *short*
    // rather than long, because the decay here is applied before the move rather than
    // after.
    //
    // Nothing stops this ball outright, so the law is the limit: a loose ball rolls
    // `v₀ / BALL_DRAG_RATE` in total. Forty seconds of it, because the tail is what is
    // being measured — at ten seconds the ball is still carrying 0.034 units a second and
    // still has 0.039 units to run, which is eight orders of magnitude above the tolerance
    // and would fail this as though the integrator were wrong. By forty the remainder is
    // 2e-13.
    //
    // This game's bot does not read the law — it leads the ball by a flat number of seconds
    // (`profile.lead`), a deliberately human guess that is 13% away from the exact integral
    // at `hard` and would still be after any change here. So no tier was handicapped the
    // way Soccer Pool's was. The test is what keeps the law honest for whoever reads it
    // next.
    for (const speed of [200, 400, 600]) {
      const rng = new Rng(1);
      const game = createGame(rng);
      goLive(game, rng);
      game.p1.x = 40;
      game.p1.y = 600;
      game.p2.x = 960;
      game.p2.y = 600;
      game.ball.x = 100;
      game.ball.y = WALL + BALL_RADIUS + 4;
      game.ball.vx = speed;
      game.ball.vy = 0;
      const start = game.ball.x;
      for (let i = 0; i < 60 * 40; i += 1) {
        // Held off the ball, so nothing kicks it and the roll stays free.
        game.p1.x = 40;
        game.p1.y = 600;
        game.p2.x = 960;
        game.p2.y = 600;
        step(game, STEP, rng);
      }
      expect(game.ball.x - start, `a ball at ${speed} rolls v / BALL_DRAG_RATE`).toBeCloseTo(
        speed / BALL_DRAG_RATE,
        9,
      );
    }
  });

  it('bounces off the side rails but not off the goal mouth', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    goLive(game, rng);
    game.p1.y = 40;
    game.p2.y = 40;
    // Level with the mouth: it should pass through rather than bounce.
    game.ball.x = WALL + BALL_RADIUS + 4;
    game.ball.y = PITCH_HEIGHT / 2;
    game.ball.vx = -300;
    const result = step(game, STEP, rng);
    expect(result, 'through the mouth is a goal, not a bounce').toBe('goal');
  });

  it('is capped, so a rally cannot accelerate away', () => {
    const game = placed(
      { x: 500, y: 300, vx: 5000, vy: 5000 },
      { x: 440, y: 300, vx: 3000, vy: 0 },
    );
    contest(game);
    expect(Math.hypot(game.ball.vx, game.ball.vy)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-9);
  });
});

describe('the contest for the ball', () => {
  it('sends the ball away from the player who ran into it', () => {
    const game = placed({ x: 520, y: 300, vx: 0, vy: 0 }, { x: 480, y: 300, vx: 0, vy: 0 });
    expect(contest(game), 'somebody was on it').toBe(true);
    expect(game.ball.vx, 'struck from the left, it goes right').toBeGreaterThan(0);
    expect(Math.abs(game.ball.vy)).toBeLessThan(1);
  });

  it('reports nothing when nobody is near it', () => {
    const game = placed({ x: 500, y: 300, vx: 0, vy: 0 }, AWAY);
    expect(contest(game)).toBe(false);
    expect(game.ball.vx).toBe(0);
  });

  it('takes some of the striker own motion, so the approach matters', () => {
    // Running onto a ball has to be different from standing in front of one, or there is
    // no skill in the approach.
    const still = placed({ x: 520, y: 300, vx: 0, vy: 0 }, { x: 480, y: 300, vx: 0, vy: 0 });
    const running = placed({ x: 520, y: 300, vx: 0, vy: 0 }, { x: 480, y: 300, vx: 400, vy: 0 });
    contest(still);
    contest(running);
    expect(running.ball.vx).toBeGreaterThan(still.ball.vx);
    expect(still.ball.vx).toBeCloseTo(KICK_SPEED, 0);
  });

  it('pushes the ball clear, so it is not struck every step', () => {
    const game = placed({ x: 500, y: 300, vx: 0, vy: 0 }, { x: 495, y: 300, vx: 0, vy: 0 });
    contest(game);
    expect(touching(game.ball, game.p1)).toBe(false);
  });

  it('handles a ball exactly on the player without dividing by zero', () => {
    // No line between the centres to leave along, so a still player presses nothing and a
    // moving one carries it forward. Answering "rightwards" — which is what this used to do
    // for both seats — is a seat advantage parked on a case that is only unreachable today.
    const still = placed({ x: 500, y: 300, vx: 0, vy: 0 }, { x: 500, y: 300, vx: 0, vy: 0 });
    expect(contest(still)).toBe(false);
    expect(still.ball.vx).toBe(0);

    const running = placed({ x: 500, y: 300, vx: 0, vy: 0 }, { x: 500, y: 300, vx: 0, vy: -60 });
    expect(contest(running)).toBe(true);
    expect(running.ball.vy).toBeLessThan(0);
    expect(Number.isFinite(running.ball.x) && Number.isFinite(running.ball.y)).toBe(true);
  });

  it('gives the ball to the player pressing hardest, not to seat one', () => {
    // The bug this replaced: `if (touching p1) … else if (touching p2)`. Seat two is deep
    // on the ball here and seat one is barely brushing it, and the ball must go seat one's
    // way — to the left — rather than seat two's.
    const game = placed(
      { x: 500, y: 300, vx: 0, vy: 0 },
      { x: 434, y: 300, vx: 0, vy: 0 },
      { x: 540, y: 300, vx: 0, vy: 0 },
    );
    contest(game);
    expect(game.ball.vx, 'pushed back the way the deeper body is facing').toBeLessThan(0);
  });

  it('holds a ball squeezed from exactly opposite sides', () => {
    // Two equal presses cancel, so the ball stays where it is and nobody has a free kick.
    // The old rule launched it at full pace in seat one's direction.
    const game = placed(
      { x: 500, y: 300, vx: 0, vy: 0 },
      { x: 460, y: 300, vx: 0, vy: 0 },
      { x: 540, y: 300, vx: 0, vy: 0 },
    );
    expect(contest(game), 'both of them are on it').toBe(true);
    expect(game.ball.vx).toBe(0);
    expect(game.ball.vy).toBe(0);
    expect(game.ball.x).toBe(500);
  });
});

describe('scoring', () => {
  it('knows a ball in a goal mouth', () => {
    expect(inGoal({ x: WALL, y: PITCH_HEIGHT / 2, vx: 0, vy: 0 }, 'p1')).toBe(true);
    expect(inGoal({ x: WALL, y: WALL + 5, vx: 0, vy: 0 }, 'p1'), 'above the mouth').toBe(false);
    expect(inGoal({ x: PITCH_WIDTH / 2, y: PITCH_HEIGHT / 2, vx: 0, vy: 0 }, 'p1')).toBe(false);
  });

  it('credits the goal to the other seat', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    goLive(game, rng);
    game.p1.y = 40;
    game.p2.y = 40;
    game.ball.x = WALL + BALL_RADIUS - 2;
    game.ball.y = PITCH_HEIGHT / 2;
    expect(step(game, STEP, rng)).toBe('goal');
    expect(game.score.p2, 'into p1 goal is p2 point').toBe(1);
    expect(game.scorer).toBe('p2');
  });

  it('holds the celebration, then kicks off again', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    goLive(game, rng);
    game.p1.y = 40;
    game.p2.y = 40;
    game.ball.x = WALL + BALL_RADIUS - 2;
    game.ball.y = PITCH_HEIGHT / 2;
    step(game, STEP, rng);
    expect(game.phase).toBe('celebrating');
    for (let i = 0; i < Math.ceil(CELEBRATE_SECONDS / STEP) + 2; i += 1) step(game, STEP, rng);
    expect(game.phase).toBe('kickoff');
    expect(game.ball.x).toBeCloseTo(PITCH_WIDTH / 2, 6);
  });

  it('stops the clock during a celebration, so a goal does not cost time', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    goLive(game, rng);
    game.phase = 'celebrating';
    game.hold = 1;
    const before = game.clock;
    step(game, STEP, rng);
    expect(game.clock).toBe(before);
  });

  it('is won by whoever has more when the whistle goes', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    goLive(game, rng);
    game.score.p1 = 2;
    game.score.p2 = 1;
    game.clock = STEP / 2;
    expect(step(game, STEP, rng)).toBe('over');
    expect(winnerOf(game)).toBe('p1');
  });

  it('is a draw on level terms', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    goLive(game, rng);
    game.clock = STEP / 2;
    step(game, STEP, rng);
    expect(winnerOf(game)).toBe('draw');
  });

  it('nudges the kick-off, so an opening is not a fixed opening', () => {
    const rng = new Rng(9);
    const a = createGame(rng);
    kickOff(a, rng);
    const first = a.ball.vy;
    kickOff(a, rng);
    expect(a.ball.vy).not.toBe(first);
  });
});

describe('the bot', () => {
  it('runs towards the ball', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    goLive(game, rng);
    game.ball.x = PITCH_WIDTH - 120;
    game.ball.y = PITCH_HEIGHT / 2;
    const bot = createBotState();
    botHeading(
      heading,
      game,
      bot,
      'p1',
      { reaction: 0.1, wobble: 0, lead: 0, approach: 0 },
      STEP,
      0.5,
    );
    expect(heading.x, 'the ball is to the right').toBeGreaterThan(0);
  });

  it('gets behind the ball rather than charging it', () => {
    // Running straight at the ball knocks it away from the goal as often as towards it,
    // because a kick leaves along the line between the two centres.
    const rng = new Rng(1);
    const game = createGame(rng);
    goLive(game, rng);
    game.ball.x = PITCH_WIDTH / 2;
    game.ball.y = PITCH_HEIGHT / 2;
    game.p1.x = PITCH_WIDTH / 2;
    game.p1.y = PITCH_HEIGHT / 2 - 200;

    const charging = createBotState();
    const positioning = createBotState();
    botHeading(
      heading,
      game,
      charging,
      'p1',
      { reaction: 0.1, wobble: 0, lead: 0, approach: 0 },
      STEP,
      0.5,
    );
    const chargeX = heading.x;
    botHeading(
      heading,
      game,
      positioning,
      'p1',
      { reaction: 0.1, wobble: 0, lead: 0, approach: 120 },
      STEP,
      0.5,
    );
    expect(heading.x, 'it aims behind the ball, away from the goal it attacks').toBeLessThan(
      chargeX,
    );
  });

  it('commits to a heading between decisions', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    goLive(game, rng);
    const bot = createBotState();
    const profile = { reaction: 0.5, wobble: 1.2, lead: 0, approach: 0 };
    botHeading(heading, game, bot, 'p1', profile, STEP, 0.1);
    const first = heading.x;
    game.ball.x = 100;
    botHeading(heading, game, bot, 'p1', profile, STEP, 0.9);
    expect(heading.x, 'it has not looked again yet').toBe(first);
  });

  it('never reacts faster than a person', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      expect(BOT_PROFILES[tier].reaction, tier).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('positions better and wobbles less as the tier rises', () => {
    expect(BOT_PROFILES.hard.approach).toBeGreaterThan(BOT_PROFILES.easy.approach);
    expect(BOT_PROFILES.hard.wobble).toBeLessThan(BOT_PROFILES.easy.wobble);
    expect(BOT_PROFILES.hard.reaction).toBeLessThan(BOT_PROFILES.easy.reaction);
  });

  it('is not so positionally perfect that nobody can score', () => {
    // With `approach: 58` and almost no wobble the hard tier became an emergent perfect
    // defender: two of them produced 0.3 goals a match. A tier nobody can score against is
    // a wall rather than an opponent.
    expect(BOT_PROFILES.hard.approach).toBeLessThan(50);
    expect(BOT_PROFILES.hard.wobble).toBeGreaterThan(0.1);
  });

  it('clears its state on reset', () => {
    const bot = createBotState();
    bot.headingX = 1;
    bot.sinceDecision = 5;
    resetBotState(bot);
    expect(bot.headingX).toBe(0);
    expect(bot.sinceDecision).toBe(0);
  });

  it('beats the weaker tier over a series', { timeout: 240_000 }, () => {
    let wins = 0;
    let losses = 0;
    const games = 12;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const finished = play(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 500 + i);
      const winner = winnerOf(finished);
      const hard = hardIsP1 ? 'p1' : 'p2';
      if (winner === hard) wins += 1;
      else if (winner !== 'draw' && winner !== null) losses += 1;
    }
    // Measured at 12 wins and 3 draws in 16, with 4.4 goals a match. Draws are real
    // outcomes here, so the check is that it does not *lose*.
    expect(
      wins,
      `hard won ${String(wins)}, lost ${String(losses)} of ${String(games)}`,
    ).toBeGreaterThan(losses);
  });

  it('produces matches with goals in them', { timeout: 240_000 }, () => {
    let goals = 0;
    for (let seed = 0; seed < 6; seed += 1) {
      const finished = play('normal', 'normal', 600 + seed);
      goals += finished.score.p1 + finished.score.p2;
    }
    expect(goals, 'a goalless league is not a game').toBeGreaterThan(6);
  });
});

describe('a whole match', () => {
  it('always ends on the whistle', { timeout: 240_000 }, () => {
    for (const seed of [11, 22]) {
      const finished = play('normal', 'normal', seed);
      expect(winnerOf(finished), `seed ${String(seed)}`).not.toBeNull();
      expect(finished.clock).toBe(0);
    }
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const rng = new Rng(31);
      const game = createGame(rng);
      const bot = createBotState();
      const out: string[] = [];
      for (let i = 0; i < 60 * 40; i += 1) {
        botHeading(heading, game, bot, 'p1', BOT_PROFILES.normal, STEP, rng.float());
        drive(game, 'p1', heading.x, heading.y, STEP);
        step(game, STEP, rng);
        if (i % 30 === 0)
          out.push(`${String(Math.round(game.ball.x))},${String(Math.round(game.ball.y))}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('has two seats', () => {
    expect(otherOf('p1')).toBe('p2');
  });

  it('never loses the ball off the pitch', { timeout: 240_000 }, () => {
    // The one thing a physics game must never do.
    const rng = new Rng(77);
    const game = createGame(rng);
    const bot = createBotState();
    for (let i = 0; i < 60 * 120 && winnerOf(game) === null; i += 1) {
      botHeading(heading, game, bot, 'p2', BOT_PROFILES.hard, STEP, rng.float());
      drive(game, 'p2', heading.x, heading.y, STEP);
      step(game, STEP, rng);
      expect(Number.isFinite(game.ball.x) && Number.isFinite(game.ball.y)).toBe(true);
      expect(game.ball.x).toBeGreaterThan(-60);
      expect(game.ball.x).toBeLessThan(PITCH_WIDTH + 60);
      expect(game.ball.y).toBeGreaterThanOrEqual(0);
      expect(game.ball.y).toBeLessThanOrEqual(PITCH_HEIGHT);
    }
  });
});

/**
 * The mirror test: turn the pitch through 180 degrees, swap the seats, and nothing changes.
 *
 * The pitch is its own half-turn image — the two goal mouths are the same size and the same
 * height, the walls are symmetric, and the two kick-off marks are reflections. So for every
 * position there is a mirrored position, and every rule here has to send one to the other.
 * The rule that did not was the contest for the ball: `if (touching p1) … else if
 * (touching p2)`, which is not a rule about football at all, it is a rule about which seat
 * was named first in the source. It cost seat two **25 points of win rate on `normal` and
 * 25 on `hard`**, and no amount of sampling `easy` — where it measured a clean 50% because
 * the tier is too clumsy to contest anything — would ever have found it.
 *
 * {@link contest} is asserted **exactly**, which it can be: coordinates are drawn on a
 * quarter-unit grid so `PITCH_WIDTH - x` loses no bits, every quantity in it is built from
 * differences of mirrored coordinates, and negation and addition of negations are exact in
 * IEEE arithmetic. A whole `step` has to allow a few ulps, because the drag integral and the
 * trigonometry in the bot do not commute with the mirror to the last bit — but the discrete
 * half of it, the phase, the result and the score, is asserted exactly.
 */
describe('the mirror', () => {
  /** Positions are drawn on this grid, so a half-turn of the pitch loses no bits. */
  const GRID = 4;
  const REACH = PLAYER_RADIUS + BALL_RADIUS;

  function turned(mover: Readonly<Mover>): Mover {
    return {
      x: PITCH_WIDTH - mover.x,
      y: PITCH_HEIGHT - mover.y,
      vx: -mover.vx,
      vy: -mover.vy,
    };
  }

  /** The same position turned through 180 degrees, with the two seats exchanged with it. */
  function halfTurn(game: Readonly<Game>): Game {
    const other = createGame(new Rng(1));
    Object.assign(other.ball, turned(game.ball));
    Object.assign(other.p1, turned(game.p2));
    Object.assign(other.p2, turned(game.p1));
    other.phase = game.phase;
    other.clock = game.clock;
    other.hold = game.hold;
    other.scorer = game.scorer === null ? null : otherOf(game.scorer);
    other.score.p1 = game.score.p2;
    other.score.p2 = game.score.p1;
    return other;
  }

  function onGrid(rng: Rng, high: number): number {
    return rng.int(0, high * GRID + 1) / GRID;
  }

  /**
   * A position nobody designed: a ball anywhere, moving any way, and two players who are
   * usually — deliberately — right on top of it.
   *
   * Two players landing on the ball at once is the case the whole bug lived in, and dropping
   * three bodies uniformly on a pitch this size would set it up about once in a thousand. So
   * two thirds of these put a player within reach of the ball on purpose.
   */
  function randomPosition(rng: Rng): Game {
    const game = createGame(new Rng(1));
    game.phase = 'playing';
    game.ball.x = onGrid(rng, PITCH_WIDTH);
    game.ball.y = onGrid(rng, PITCH_HEIGHT);
    game.ball.vx = rng.int(-900 * GRID, 900 * GRID + 1) / GRID;
    game.ball.vy = rng.int(-900 * GRID, 900 * GRID + 1) / GRID;
    for (const player of [game.p1, game.p2]) {
      if (rng.int(0, 12) === 0) {
        // Dead centre on the ball: no line between the centres, and the one case where a
        // fixed fallback direction would be a seat advantage nothing else could see.
        player.x = game.ball.x;
        player.y = game.ball.y;
      } else if (rng.int(0, 3) === 0) {
        player.x = onGrid(rng, PITCH_WIDTH);
        player.y = onGrid(rng, PITCH_HEIGHT);
      } else {
        const near = Math.round(REACH * 1.2) * GRID;
        player.x = game.ball.x + rng.int(-near, near + 1) / GRID;
        player.y = game.ball.y + rng.int(-near, near + 1) / GRID;
      }
      player.vx = rng.int(-PLAYER_SPEED * GRID, PLAYER_SPEED * GRID + 1) / GRID;
      player.vy = rng.int(-PLAYER_SPEED * GRID, PLAYER_SPEED * GRID + 1) / GRID;
    }
    return game;
  }

  it('resolves a contest into the mirror of the contest, exactly', () => {
    const rng = new Rng(20260829);
    let contested = 0;
    for (let trial = 0; trial < 600; trial += 1) {
      const position = randomPosition(rng);
      const mirrored = halfTurn(position);
      const touched = contest(position);
      expect(contest(mirrored), `trial ${String(trial)}`).toBe(touched);
      if (touched) contested += 1;
      const expected = turned(position.ball);
      // Velocity is exact under the mirror; the clearing step adds to a mirrored coordinate
      // rather than mirroring a sum, which is the one place a bit can be lost.
      expect(mirrored.ball.vx, `trial ${String(trial)}`).toBe(expected.vx);
      expect(mirrored.ball.vy, `trial ${String(trial)}`).toBe(expected.vy);
      expect(mirrored.ball.x).toBeCloseTo(expected.x, 9);
      expect(mirrored.ball.y).toBeCloseTo(expected.y, 9);
    }
    expect(
      contested,
      'the sweep has to actually reach the ball to be testing anything',
    ).toBeGreaterThan(300);
  });

  it('steps a mirrored position into the mirror of the step', () => {
    const rng = new Rng(777);
    let goals = 0;
    for (let trial = 0; trial < 600; trial += 1) {
      const position = randomPosition(rng);
      const mirrored = halfTurn(position);
      const result = step(position, STEP, new Rng(5));
      expect(step(mirrored, STEP, new Rng(5)), `trial ${String(trial)}`).toBe(result);
      if (result === 'goal') goals += 1;
      const expected = halfTurn(position);
      expect(mirrored.score.p1, `trial ${String(trial)}`).toBe(expected.score.p1);
      expect(mirrored.score.p2).toBe(expected.score.p2);
      expect(mirrored.scorer).toBe(expected.scorer);
      expect(mirrored.phase).toBe(expected.phase);
      expect(mirrored.ball.x).toBeCloseTo(expected.ball.x, 8);
      expect(mirrored.ball.y).toBeCloseTo(expected.ball.y, 8);
      expect(mirrored.ball.vx).toBeCloseTo(expected.ball.vx, 8);
      expect(mirrored.ball.vy).toBeCloseTo(expected.ball.vy, 8);
    }
    expect(
      goals,
      'and it has to score some of them, or the goal check is untested',
    ).toBeGreaterThan(5);
  });

  it('sends the bot the mirrored way, on every decision and every tier', () => {
    // The bot's misjudgement is drawn once a reaction interval and held, so the same roll
    // has to mean the same mistake from either chair. Under a half-turn it does: the aim
    // turns by pi and a wobble of `w` is still a wobble of `w`.
    const rng = new Rng(31415);
    const heads = { x: 0, y: 0 };
    const mirroredHeads = { x: 0, y: 0 };
    for (let trial = 0; trial < 300; trial += 1) {
      const position = randomPosition(rng);
      const mirrored = halfTurn(position);
      for (const difficulty of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
        const roll = rng.float();
        botHeading(heads, position, createBotState(), 'p1', BOT_PROFILES[difficulty], STEP, roll);
        botHeading(
          mirroredHeads,
          mirrored,
          createBotState(),
          'p2',
          BOT_PROFILES[difficulty],
          STEP,
          roll,
        );
        expect(mirroredHeads.x, `trial ${String(trial)} ${difficulty}`).toBeCloseTo(-heads.x, 9);
        expect(mirroredHeads.y).toBeCloseTo(-heads.y, 9);
      }
    }
  });

  it('drives a seat the mirrored way', () => {
    const rng = new Rng(2718);
    for (let trial = 0; trial < 300; trial += 1) {
      const position = randomPosition(rng);
      const mirrored = halfTurn(position);
      const dx = rng.int(-100, 101) / 10;
      const dy = rng.int(-100, 101) / 10;
      drive(position, 'p1', dx, dy, STEP);
      drive(mirrored, 'p2', -dx, -dy, STEP);
      expect(mirrored.p2.x, `trial ${String(trial)}`).toBeCloseTo(PITCH_WIDTH - position.p1.x, 9);
      expect(mirrored.p2.y).toBeCloseTo(PITCH_HEIGHT - position.p1.y, 9);
    }
  });

  it('knows a goal in either mouth the same way', () => {
    const rng = new Rng(1618);
    for (let trial = 0; trial < 400; trial += 1) {
      const ball: Mover = {
        x: onGrid(rng, PITCH_WIDTH),
        y: onGrid(rng, PITCH_HEIGHT),
        vx: 0,
        vy: 0,
      };
      expect(inGoal(turned(ball), 'p2'), `trial ${String(trial)}`).toBe(inGoal(ball, 'p1'));
    }
  });
});
