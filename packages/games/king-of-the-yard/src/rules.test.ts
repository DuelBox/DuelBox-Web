import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILES,
  CROWN_DRAG,
  CROWN_RADIUS,
  LOOSE_SECONDS,
  PLAYER_RADIUS,
  SPEED,
  STEAL_COOLDOWN,
  TARGET_SECONDS,
  WALL,
  YARD_HEIGHT,
  YARD_WIDTH,
  botHeading,
  createBotState,
  createGame,
  distanceBetween,
  dropCrown,
  move,
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

/** Runs the loose-crown delay out. */
function settle(game: Game, rng = new Rng(1)): void {
  for (let i = 0; i < Math.ceil(LOOSE_SECONDS / STEP) + 2; i += 1) step(game, STEP, rng);
}

function play(p1: BotDifficulty, p2: BotDifficulty, seed: number): Game {
  const rng = new Rng(seed);
  const game = createGame(rng);
  const botP1 = createBotState();
  const botP2 = createBotState();
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  for (let i = 0; i < 60 * 300 && winnerOf(game) === null; i += 1) {
    botHeading(a, game, botP1, 'p1', BOT_PROFILES[p1], STEP, rng.float());
    botHeading(b, game, botP2, 'p2', BOT_PROFILES[p2], STEP, rng.float());
    move(game, 'p1', a.x, a.y, STEP);
    move(game, 'p2', b.x, b.y, STEP);
    step(game, STEP, rng);
  }
  return game;
}

describe('the yard', () => {
  it('starts both players inside the walls with the crown loose', () => {
    const game = createGame(new Rng(1));
    expect(game.wearer).toBeNull();
    expect(game.p1.x).toBeGreaterThan(WALL);
    expect(game.p2.x).toBeLessThan(YARD_WIDTH - WALL);
    expect(game.worn).toEqual({ p1: 0, p2: 0 });
  });

  it('keeps a player inside the walls however long they run', () => {
    const game = createGame(new Rng(1));
    for (let i = 0; i < 600; i += 1) move(game, 'p1', 1, 1, STEP);
    expect(game.p1.x).toBeLessThanOrEqual(YARD_WIDTH - WALL - PLAYER_RADIUS + 1e-6);
    expect(game.p1.y).toBeLessThanOrEqual(YARD_HEIGHT - WALL - PLAYER_RADIUS + 1e-6);
    for (let i = 0; i < 600; i += 1) move(game, 'p1', -1, -1, STEP);
    expect(game.p1.x).toBeGreaterThanOrEqual(WALL + PLAYER_RADIUS - 1e-6);
  });

  it('does not let a diagonal run faster than a straight one', () => {
    const straight = createGame(new Rng(1));
    const diagonal = createGame(new Rng(1));
    for (let i = 0; i < 30; i += 1) {
      move(straight, 'p1', 1, 0, STEP);
      move(diagonal, 'p1', 1, 1, STEP);
    }
    const a = distanceBetween(straight.p1, { x: YARD_WIDTH * 0.25, y: YARD_HEIGHT * 0.5 });
    const b = distanceBetween(diagonal.p1, { x: YARD_WIDTH * 0.25, y: YARD_HEIGHT * 0.5 });
    expect(b).toBeCloseTo(a, 4);
  });

  it('resets in place', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    game.worn.p1 = 9;
    resetGame(game, rng);
    expect(game.worn).toEqual({ p1: 0, p2: 0 });
    expect(game.wearer).toBeNull();
  });
});

describe('the crown', () => {
  it('cannot be picked up until it has settled', () => {
    const game = createGame(new Rng(1));
    game.p1.x = game.crown.x;
    game.p1.y = game.crown.y;
    step(game, STEP, new Rng(1));
    expect(game.wearer, 'it is still settling').toBeNull();
  });

  it('goes to whoever reaches it', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.p2.x = game.crown.x;
    game.p2.y = game.crown.y;
    step(game, STEP, rng);
    expect(game.wearer).toBe('p2');
  });

  it('goes to the closer player when both arrive at once', () => {
    // "A tie goes to nobody" was the first rule and it deadlocked the whole game: the two
    // start symmetric, the crown drops on the centre line, and two bots of the same tier
    // move identically — so they arrived together on every step and nobody ever picked it
    // up. Measured, normal against normal spent three hundred seconds untouched.
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.p1.x = game.crown.x + 5;
    game.p1.y = game.crown.y;
    game.p2.x = game.crown.x - 20;
    game.p2.y = game.crown.y;
    step(game, STEP, rng);
    expect(game.wearer, 'the closer one').toBe('p1');
  });

  it('breaks an exact tie in favour of whoever has worn it less', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.p1.x = game.crown.x - 10;
    game.p1.y = game.crown.y;
    game.p2.x = game.crown.x + 10;
    game.p2.y = game.crown.y;
    game.worn.p1 = 5;
    game.worn.p2 = 1;
    step(game, STEP, rng);
    expect(game.wearer, 'the seat that is behind').toBe('p2');
  });

  it('breaks a total tie the same way every replay', () => {
    // Something has to decide, and whatever it is must replay identically.
    const pick = (): SeatId | null => {
      const rng = new Rng(7);
      const game = createGame(rng);
      settle(game, rng);
      game.p1.x = game.crown.x - 10;
      game.p1.y = game.crown.y;
      game.p2.x = game.crown.x + 10;
      game.p2.y = game.crown.y;
      step(game, STEP, rng);
      return game.wearer;
    };
    expect(pick()).toBe(pick());
  });

  it('rides on its wearer', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.p1.x = game.crown.x;
    game.p1.y = game.crown.y;
    step(game, STEP, rng);
    expect(game.wearer).toBe('p1');
    for (let i = 0; i < 30; i += 1) {
      move(game, 'p1', 1, 0, STEP);
      step(game, STEP, rng);
    }
    expect(game.crown.x, 'anything asking where it is gets one answer').toBe(game.p1.x);
  });
});

describe('stealing', () => {
  it('takes the crown on a touch', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.wearer = 'p1';
    game.cooldown = 0;
    game.p2.x = game.p1.x;
    game.p2.y = game.p1.y;
    expect(step(game, STEP, rng)).toBe('stolen');
    expect(game.wearer).toBe('p2');
  });

  it('will not change hands again until the cooldown has run', () => {
    // Two circles that overlap stay overlapping for many steps; without this the crown
    // flips every step while they touch, which reads as the game having a seizure.
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.wearer = 'p1';
    game.cooldown = 0;
    game.p2.x = game.p1.x;
    game.p2.y = game.p1.y;
    step(game, STEP, rng);
    expect(game.wearer).toBe('p2');
    expect(game.cooldown).toBeCloseTo(STEAL_COOLDOWN, 6);
    step(game, STEP, rng);
    expect(game.wearer, 'not straight back').toBe('p2');
  });

  it('slows the wearer down', () => {
    // Without this the game has no tension: whoever takes it first runs away with it, and
    // a chase nobody can win is not a chase.
    const rng = new Rng(1);
    const bare = createGame(rng);
    const crowned = createGame(rng);
    crowned.wearer = 'p1';
    for (let i = 0; i < 30; i += 1) {
      move(bare, 'p1', 1, 0, STEP);
      move(crowned, 'p1', 1, 0, STEP);
    }
    expect(crowned.p1.x).toBeLessThan(bare.p1.x);
    expect(CROWN_DRAG).toBeLessThan(1);
    expect(SPEED * CROWN_DRAG).toBeLessThan(SPEED);
  });

  it('banks time only for the wearer', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.wearer = 'p1';
    game.cooldown = STEAL_COOLDOWN;
    for (let i = 0; i < 60; i += 1) step(game, STEP, rng);
    expect(game.worn.p1).toBeGreaterThan(0.9);
    expect(game.worn.p2).toBe(0);
  });
});

describe('winning', () => {
  it('is undecided at the start', () => {
    expect(winnerOf(createGame(new Rng(1)))).toBeNull();
  });

  it('is won at the target', () => {
    const game = createGame(new Rng(1));
    game.worn.p2 = TARGET_SECONDS;
    expect(winnerOf(game)).toBe('p2');
  });

  it('has two seats', () => {
    expect(otherOf('p1')).toBe('p2');
  });
});

describe('the bot', () => {
  it('runs for the crown when nobody has it', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.crown.x = WALL + CROWN_RADIUS;
    game.crown.y = game.p1.y;
    const bot = createBotState();
    botHeading(heading, game, bot, 'p1', { reaction: 0.1, wobble: 0, lead: 0 }, STEP, 0.5);
    expect(heading.x, 'it heads left, toward the crown').toBeLessThan(0);
  });

  it('runs away when it is wearing it', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    game.wearer = 'p1';
    game.p2.x = WALL + PLAYER_RADIUS;
    game.p2.y = WALL + PLAYER_RADIUS;
    const bot = createBotState();
    botHeading(heading, game, bot, 'p1', { reaction: 0.1, wobble: 0, lead: 0 }, STEP, 0.5);
    expect(heading.x, 'away from the chaser in the top-left').toBeGreaterThan(0);
    expect(heading.y).toBeGreaterThan(0);
  });

  it('commits to a heading between decisions', () => {
    // Re-choosing every step averages the wobble to zero and makes the tiers meaningless,
    // which is a mistake this codebase has now made in three separate games.
    const rng = new Rng(1);
    const game = createGame(rng);
    settle(game, rng);
    const bot = createBotState();
    const profile = { reaction: 0.5, wobble: 1.2, lead: 0 };
    botHeading(heading, game, bot, 'p1', profile, STEP, 0.1);
    const first = { x: heading.x, y: heading.y };
    game.crown.x = YARD_WIDTH - WALL;
    botHeading(heading, game, bot, 'p1', profile, STEP, 0.9);
    expect(heading.x, 'it has not looked again yet').toBe(first.x);
  });

  it('never reacts faster than a person', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      expect(BOT_PROFILES[tier].reaction, tier).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('leads its target more, and wobbles less, as the tier rises', () => {
    // Chasing where somebody *is* means always arriving where they were.
    expect(BOT_PROFILES.hard.lead).toBeGreaterThan(BOT_PROFILES.easy.lead);
    expect(BOT_PROFILES.hard.wobble).toBeLessThan(BOT_PROFILES.easy.wobble);
    expect(BOT_PROFILES.hard.reaction).toBeLessThan(BOT_PROFILES.easy.reaction);
  });

  it('clears its state on reset', () => {
    const bot = createBotState();
    bot.headingX = 1;
    bot.judgement.remaining = 5;
    bot.judgement.decided = true;
    resetBotState(bot);
    expect(bot.headingX).toBe(0);
    expect(bot.judgement.remaining).toBe(0);
    expect(bot.judgement.decided).toBe(false);
  });

  it('beats the weaker tier over a series', { timeout: 240_000 }, () => {
    let wins = 0;
    const games = 12;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const finished = play(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 900 + i);
      if (winnerOf(finished) === (hardIsP1 ? 'p1' : 'p2')) wins += 1;
    }
    // Measured at 100% against easy and 90% against normal over thirty matches.
    expect(wins, `hard won ${String(wins)} of ${String(games)}`).toBeGreaterThan(games * 0.7);
  });
});

describe('a whole match', () => {
  it('always finishes', { timeout: 240_000 }, () => {
    for (const seed of [11, 22, 33]) {
      expect(winnerOf(play('normal', 'normal', seed)), `seed ${String(seed)}`).not.toBeNull();
    }
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const rng = new Rng(44);
      const game = createGame(rng);
      const bot = createBotState();
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        botHeading(heading, game, bot, 'p1', BOT_PROFILES.normal, STEP, rng.float());
        move(game, 'p1', heading.x, heading.y, STEP);
        step(game, STEP, rng);
        if (i % 30 === 0) out.push(`${String(Math.round(game.p1.x))},${game.wearer ?? '-'}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('drops the crown inside the yard', () => {
    const rng = new Rng(3);
    const game = createGame(rng);
    for (let i = 0; i < 200; i += 1) {
      dropCrown(game, rng);
      expect(game.crown.y).toBeGreaterThanOrEqual(WALL);
      expect(game.crown.y).toBeLessThanOrEqual(YARD_HEIGHT - WALL);
      expect(touching(game.crown, game.crown, 1), 'sanity').toBe(true);
    }
  });
});
