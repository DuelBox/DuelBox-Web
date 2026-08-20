import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  COURT_WIDTH,
  CRAB_RADIUS,
  FLOOR_Y,
  MAX_BALL_SPEED,
  MAX_RETURN_ANGLE,
  MIN_RALLY_SPEED,
  NET_HALF_WIDTH,
  NET_TOP,
  NET_X,
  SERVE_SECONDS,
  STRIKE_DECAY,
  TARGET_POINTS,
  botIntent,
  canReturn,
  createBotState,
  createGame,
  halfOf,
  jump,
  otherOf,
  predictX,
  resetBotState,
  resetGame,
  serve,
  steer,
  step,
  strike,
  touching,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;
const intent = { direction: 0, jump: false };

/** Runs the serve hang out so the rally is live. */
function goLive(game: Game, rng = new Rng(1)): void {
  for (let i = 0; i < 200 && game.phase !== 'rally'; i += 1) step(game, STEP, rng);
}

/** Plays a whole match between two tiers and returns the winner. */
function play(p1: BotDifficulty, p2: BotDifficulty, seed: number): SeatId | null {
  const rng = new Rng(seed);
  const game = createGame(rng);
  const botP1 = createBotState();
  const botP2 = createBotState();
  const a = { direction: 0, jump: false };
  const b = { direction: 0, jump: false };
  for (let i = 0; i < 60 * 240 && winnerOf(game) === null; i += 1) {
    botIntent(a, game, botP1, 'p1', BOT_PROFILES[p1], STEP, rng.float());
    botIntent(b, game, botP2, 'p2', BOT_PROFILES[p2], STEP, rng.float());
    steer(game, 'p1', a.direction, STEP);
    if (a.jump) jump(game, 'p1');
    steer(game, 'p2', b.direction, STEP);
    if (b.jump) jump(game, 'p2');
    step(game, STEP, rng);
  }
  return winnerOf(game);
}

describe('the court', () => {
  it('gives each seat its own half, and neither reaches the other', () => {
    const left = halfOf('p1');
    const right = halfOf('p2');
    expect(left.max).toBeLessThan(NET_X);
    expect(right.min).toBeGreaterThan(NET_X);
    expect(left.min).toBeGreaterThanOrEqual(CRAB_RADIUS);
    expect(right.max).toBeLessThanOrEqual(COURT_WIDTH - CRAB_RADIUS);
  });

  it('will not let a crab cross the net however long it holds a direction', () => {
    // The halves mean nothing if a crab can reach into the other one.
    const game = createGame(new Rng(1));
    for (let i = 0; i < 600; i += 1) steer(game, 'p1', 1, STEP);
    expect(game.p1.x).toBeLessThanOrEqual(halfOf('p1').max);
    for (let i = 0; i < 600; i += 1) steer(game, 'p2', -1, STEP);
    expect(game.p2.x).toBeGreaterThanOrEqual(halfOf('p2').min);
  });

  it('starts level, with p1 to serve', () => {
    const game = createGame(new Rng(1));
    expect(game.score).toEqual({ p1: 0, p2: 0 });
    expect(game.server).toBe('p1');
    expect(game.phase).toBe('serving');
  });

  it('resets in place', () => {
    const game = createGame(new Rng(1));
    game.score.p1 = 3;
    resetGame(game, new Rng(1));
    expect(game.score).toEqual({ p1: 0, p2: 0 });
    expect(game.phase).toBe('serving');
  });
});

describe('jumping', () => {
  it('leaves the floor', () => {
    const game = createGame(new Rng(1));
    expect(jump(game, 'p1')).toBe(true);
    expect(game.p1.vy).toBeLessThan(0);
  });

  it('is refused in the air, so a crab cannot climb', () => {
    const game = createGame(new Rng(1));
    jump(game, 'p1');
    step(game, STEP, new Rng(1));
    expect(jump(game, 'p1'), 'no second jump mid-air').toBe(false);
  });

  it('comes back down to the floor and stays there', () => {
    const game = createGame(new Rng(1));
    jump(game, 'p1');
    for (let i = 0; i < 300; i += 1) step(game, STEP, new Rng(1));
    expect(game.p1.y).toBe(FLOOR_Y);
    expect(game.p1.vy).toBe(0);
  });
});

describe('the serve', () => {
  it('hangs before it is released', () => {
    const game = createGame(new Rng(1));
    const before = { ...game.ball };
    for (let i = 0; i < Math.floor((SERVE_SECONDS / STEP) / 2); i += 1) step(game, STEP, new Rng(1));
    expect(game.phase).toBe('serving');
    expect(game.ball.x, 'still hanging').toBe(before.x);
  });

  it('goes over the net into the receiver half', () => {
    // Dropping it straight down on the server's own head was the first version, and it
    // was quietly fatal: whoever served first lost 0-5 every time, at every tier.
    const rng = new Rng(3);
    const game = createGame(rng);
    goLive(game, rng);
    let crossed = false;
    for (let i = 0; i < 240 && !crossed; i += 1) {
      step(game, STEP, rng);
      if (game.ball.x > NET_X) crossed = true;
    }
    expect(crossed, "p1's serve reaches p2's half").toBe(true);
  });

  it('is served by whoever lost the point', () => {
    const game = createGame(new Rng(1));
    // Clear of p1's crab, which starts in the middle of its half — a ball landing on top
    // of a crab is returned rather than scored, and the first fixture dropped it on one.
    game.ball.x = 90;
    game.ball.y = FLOOR_Y - BALL_RADIUS;
    game.ball.vx = 0;
    game.phase = 'rally';
    step(game, STEP, new Rng(1));
    expect(game.scorer, 'it landed on p1 side').toBe('p2');
    expect(game.server, 'and p1 serves next').toBe('p1');
  });
});

describe('striking', () => {
  it('sends the ball straight up when hit with the middle', () => {
    // The paddle model: where on the crab it lands decides where it goes.
    const ball = { x: 300, y: 400, vx: 0, vy: 400 };
    const crab = { x: 300, y: 460, vy: 0 };
    strike(ball, crab, 0);
    expect(Math.abs(ball.vx), 'no sideways from a centred hit').toBeLessThan(1);
    expect(ball.vy, 'and it goes up').toBeLessThan(0);
  });

  it('sends it sideways when hit with the edge', () => {
    const left = { x: 240, y: 400, vx: 0, vy: 400 };
    const right = { x: 360, y: 400, vx: 0, vy: 400 };
    const crab = { x: 300, y: 460, vy: 0 };
    strike(left, crab, 0);
    strike(right, crab, 0);
    expect(left.vx, 'hit on its left, it goes left').toBeLessThan(0);
    expect(right.vx).toBeGreaterThan(0);
  });

  it('never turns a return further than its limit', () => {
    const ball = { x: 100, y: 400, vx: 0, vy: 400 };
    const crab = { x: 300, y: 460, vy: 0 };
    strike(ball, crab, 400);
    const angle = Math.atan2(ball.vx, -ball.vy);
    expect(Math.abs(angle)).toBeLessThanOrEqual(MAX_RETURN_ANGLE + 1e-9);
  });

  it('always leaves upward, whatever it arrived doing', () => {
    const ball = { x: 300, y: 400, vx: 0, vy: -600 };
    const crab = { x: 300, y: 460, vy: 0 };
    strike(ball, crab, 0);
    expect(ball.vy).toBeLessThan(0);
  });

  it('loses energy, so a rally is finite', () => {
    // Without this the rally is a perpetual motion machine: two competent players kept
    // the ball up for four hundred seconds.
    const ball = { x: 300, y: 400, vx: 0, vy: 700 };
    const crab = { x: 300, y: 460, vy: 0 };
    const before = Math.hypot(ball.vx, ball.vy);
    strike(ball, crab, 0);
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThan(before);
    expect(STRIKE_DECAY).toBeLessThan(1);
  });

  it('is capped, so a rally cannot accelerate away', () => {
    const ball = { x: 300, y: 400, vx: 3000, vy: 3000 };
    const crab = { x: 300, y: 460, vy: -700 };
    strike(ball, crab, 900);
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-9);
  });

  it('pushes the ball clear, so it cannot be struck twice from inside', () => {
    const ball = { x: 300, y: 455, vx: 0, vy: 100 };
    const crab = { x: 300, y: 460, vy: 0 };
    strike(ball, crab, 0);
    expect(touching(ball, crab), 'clear of the crab').toBe(false);
  });

  it('handles a ball exactly on the crab centre without dividing by zero', () => {
    const ball = { x: 300, y: 460, vx: 0, vy: 0 };
    const crab = { x: 300, y: 460, vy: 0 };
    strike(ball, crab, 0);
    expect(Number.isFinite(ball.vx)).toBe(true);
    expect(Number.isFinite(ball.vy)).toBe(true);
    expect(Number.isFinite(ball.x)).toBe(true);
  });

  it('refuses to return a dead ball', () => {
    // A ball with no energy left rests *on* a crab and is struck again every step — a few
    // units up, a few down, for ever, with the crab holding it off the floor. Two equal
    // bots produced rallies of a hundred and fifty seconds.
    expect(canReturn({ x: 0, y: 0, vx: 0, vy: MIN_RALLY_SPEED * 3 })).toBe(true);
    expect(canReturn({ x: 0, y: 0, vx: 0, vy: 10 })).toBe(false);
  });
});

describe('the net', () => {
  it('bounces the ball back on the side it hit', () => {
    const game = createGame(new Rng(1));
    game.phase = 'rally';
    game.ball.x = NET_X - NET_HALF_WIDTH - BALL_RADIUS + 2;
    game.ball.y = NET_TOP + 60;
    game.ball.vx = 300;
    game.ball.vy = 0;
    step(game, STEP, new Rng(1));
    expect(game.ball.vx, 'sent back to the side it came from').toBeLessThan(0);
  });

  it('bounces the ball off the top rather than letting it through', () => {
    // A ball landing exactly on the net falling through it looks like a bug, however rare.
    const game = createGame(new Rng(1));
    game.phase = 'rally';
    game.ball.x = NET_X;
    game.ball.y = NET_TOP - BALL_RADIUS - 2;
    game.ball.vx = 0;
    game.ball.vy = 300;
    step(game, STEP, new Rng(1));
    expect(game.ball.vy, 'sent back up').toBeLessThan(0);
    expect(game.ball.y).toBeLessThan(NET_TOP);
  });
});

describe('scoring', () => {
  it('gives the point to the other seat when the ball lands', () => {
    const game = createGame(new Rng(1));
    game.phase = 'rally';
    game.ball.x = 200;
    game.ball.y = FLOOR_Y;
    expect(step(game, STEP, new Rng(1))).toBe('point');
    expect(game.score.p2, 'it landed on p1 side').toBe(1);
  });

  it('is won at the target', () => {
    const game = createGame(new Rng(1));
    expect(winnerOf(game)).toBeNull();
    game.score.p1 = TARGET_POINTS;
    expect(winnerOf(game)).toBe('p1');
  });

  it('pauses after a point, then serves again', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    game.phase = 'rally';
    game.ball.x = 200;
    game.ball.y = FLOOR_Y;
    step(game, STEP, rng);
    expect(game.phase).toBe('point');
    for (let i = 0; i < Math.ceil(SERVE_SECONDS / STEP) + 2; i += 1) step(game, STEP, rng);
    expect(game.phase).toBe('serving');
  });
});

describe('the bot', () => {
  it('predicts where the ball comes down, not where it is in a fixed time', () => {
    // A fixed horizon has the bot standing where the ball will be *after* it has gone by.
    const ball = { x: 300, y: 120, vx: 200, vy: 0 };
    const near = predictX(ball, 0.15);
    const far = predictX(ball, 2);
    expect(far, 'a longer horizon reaches further down the flight').toBeGreaterThan(near);
  });

  it('runs the same physics the simulation does, so the net turns it back', () => {
    const ball = { x: NET_X - 60, y: NET_TOP + 80, vx: 600, vy: 0 };
    expect(predictX(ball, 1.5), 'it cannot pass through the net').toBeLessThan(NET_X);
  });

  it('commits to a misjudgement instead of re-rolling it every step', () => {
    // A fresh random offset sixty times a second averages to zero, so the crab hovers on
    // exactly the right spot however large its supposed error. The tiers meant nothing.
    const game = createGame(new Rng(1));
    game.phase = 'rally';
    game.ball.vx = 300;
    const bot = createBotState();
    botIntent(intent, game, bot, 'p1', BOT_PROFILES.easy, STEP, 0.05);
    const first = bot.offset;
    botIntent(intent, game, bot, 'p1', BOT_PROFILES.easy, STEP, 0.95);
    expect(bot.offset, 'the same approach, the same judgement').toBe(first);

    game.ball.vx = -300;
    botIntent(intent, game, bot, 'p1', BOT_PROFILES.easy, STEP, 0.95);
    expect(bot.offset, 'a new approach, a new judgement').not.toBe(first);
  });

  it('holds its target between decisions', () => {
    const game = createGame(new Rng(1));
    game.phase = 'rally';
    const bot = createBotState();
    botIntent(intent, game, bot, 'p1', BOT_PROFILES.easy, STEP, 0.5);
    const target = bot.target;
    game.ball.x += 300;
    botIntent(intent, game, bot, 'p1', BOT_PROFILES.easy, STEP, 0.5);
    expect(bot.target, 'it has not looked again yet').toBe(target);
  });

  it('never reacts faster than a person', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      expect(BOT_PROFILES[tier].reaction, tier).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('stays inside its own half', () => {
    const rng = new Rng(9);
    const game = createGame(rng);
    const bot = createBotState();
    for (let i = 0; i < 60 * 60; i += 1) {
      botIntent(intent, game, bot, 'p2', BOT_PROFILES.hard, STEP, rng.float());
      steer(game, 'p2', intent.direction, STEP);
      if (intent.jump) jump(game, 'p2');
      step(game, STEP, rng);
      expect(game.p2.x).toBeGreaterThanOrEqual(halfOf('p2').min - 1e-6);
    }
  });

  it('clears its state on reset', () => {
    const bot = createBotState();
    bot.offset = 50;
    bot.target = 300;
    resetBotState(bot);
    expect(bot.offset).toBe(0);
    expect(bot.target).toBe(0);
  });

  it('declares its tiers in a sensible order', () => {
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.slop).toBeGreaterThan(BOT_PROFILES.hard.slop);
    // Jumping *more* is worse, which is not a typo: a crab in the air returns the ball
    // more steeply and keeps a rally alive, so jumping at everything is a novice's habit.
    expect(BOT_PROFILES.easy.jumpRate).toBeGreaterThan(BOT_PROFILES.hard.jumpRate);
  });

  it('beats the weaker tier over a series', { timeout: 240_000 }, () => {
    let wins = 0;
    const games = 20;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const winner = play(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 3000 + i);
      if (winner === (hardIsP1 ? 'p1' : 'p2')) wins += 1;
    }
    // Measured at about 68% over forty games. Twenty is enough to catch an inversion,
    // which is what this is for — the tiers were inverted twice while I built them.
    expect(wins, `hard won ${String(wins)} of ${String(games)}`).toBeGreaterThan(games * 0.55);
  });
});

describe('a whole match', () => {
  it('always finishes', { timeout: 240_000 }, () => {
    for (const seed of [11, 22, 33]) {
      expect(play('normal', 'normal', seed), `seed ${String(seed)}`).not.toBeNull();
    }
  });

  it('replays identically from the same seed', { timeout: 120_000 }, () => {
    const trace = (): string => {
      const rng = new Rng(77);
      const game = createGame(rng);
      const bot = createBotState();
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        botIntent(intent, game, bot, 'p1', BOT_PROFILES.normal, STEP, rng.float());
        steer(game, 'p1', intent.direction, STEP);
        step(game, STEP, rng);
        if (i % 30 === 0) out.push(`${Math.round(game.ball.x)},${Math.round(game.ball.y)}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('has two seats', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('serves within the court', () => {
    const rng = new Rng(5);
    const game = createGame(rng);
    serve(game, rng);
    expect(game.ball.x).toBeGreaterThan(0);
    expect(game.ball.x).toBeLessThan(COURT_WIDTH);
  });
});
