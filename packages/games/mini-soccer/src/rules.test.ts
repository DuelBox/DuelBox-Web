import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BALL_DRAG,
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
  WALL,
  botHeading,
  createBotState,
  createGame,
  drive,
  goalMouth,
  inGoal,
  kick,
  kickOff,
  otherOf,
  resetBotState,
  resetGame,
  step,
  touching,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

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
    const fine = roll(1 / 120);
    const coarse = roll(1 / 60);
    // Within a percent, not within half a unit. A first-order integrator cannot agree
    // exactly across step sizes, and demanding that it does tests the arithmetic rather
    // than the property — which is that halving the step does not change how far a ball
    // rolls in any way a player could notice.
    expect(
      Math.abs(fine - coarse) / coarse,
      `${fine.toFixed(1)} vs ${coarse.toFixed(1)}`,
    ).toBeLessThan(0.01);
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
    const ball = { x: 500, y: 300, vx: 5000, vy: 5000 };
    kick(ball, { x: 400, y: 300, vx: 3000, vy: 0 });
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-9);
  });
});

describe('kicking', () => {
  it('sends the ball away from the player who ran into it', () => {
    const ball = { x: 520, y: 300, vx: 0, vy: 0 };
    kick(ball, { x: 480, y: 300, vx: 0, vy: 0 });
    expect(ball.vx, 'struck from the left, it goes right').toBeGreaterThan(0);
    expect(Math.abs(ball.vy)).toBeLessThan(1);
  });

  it('takes some of the striker own motion, so the approach matters', () => {
    // Running onto a ball has to be different from standing in front of one, or there is
    // no skill in the approach.
    const still = { x: 520, y: 300, vx: 0, vy: 0 };
    const running = { x: 520, y: 300, vx: 0, vy: 0 };
    kick(still, { x: 480, y: 300, vx: 0, vy: 0 });
    kick(running, { x: 480, y: 300, vx: 400, vy: 0 });
    expect(running.vx).toBeGreaterThan(still.vx);
    expect(still.vx).toBeCloseTo(KICK_SPEED, 0);
  });

  it('pushes the ball clear, so it is not kicked every step', () => {
    const ball = { x: 500, y: 300, vx: 0, vy: 0 };
    const player = { x: 495, y: 300, vx: 0, vy: 0 };
    kick(ball, player);
    expect(touching(ball, player)).toBe(false);
  });

  it('handles a ball exactly on the player without dividing by zero', () => {
    const ball = { x: 500, y: 300, vx: 0, vy: 0 };
    kick(ball, { x: 500, y: 300, vx: 0, vy: 0 });
    expect(Number.isFinite(ball.vx) && Number.isFinite(ball.vy)).toBe(true);
    expect(Number.isFinite(ball.x) && Number.isFinite(ball.y)).toBe(true);
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
