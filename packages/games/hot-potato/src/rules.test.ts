import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BAND_DECAY,
  BASE_SWEEP,
  BOT_PROFILES,
  FLIGHT_SECONDS,
  FUSE_SECONDS,
  MAX_SWEEP,
  MIN_BAND,
  SETTLE_SECONDS,
  START_BAND,
  TARGET_ROUNDS,
  bandAfter,
  botThrows,
  createBotState,
  createGame,
  onTarget,
  otherOf,
  placeBand,
  resetBotState,
  resetGame,
  startRound,
  step,
  sweepAt,
  tryThrow,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

/** Puts the marker exactly on the band, so a throw is bound to land. */
function aimAtBand(game: Game): void {
  game.marker = game.bandCentre;
}

function playOut(p1: BotDifficulty, p2: BotDifficulty, seed: number): Game {
  const rng = new Rng(seed);
  const game = createGame(rng);
  const botP1 = createBotState();
  const botP2 = createBotState();
  for (let i = 0; i < 60 * 400 && winnerOf(game) === null; i += 1) {
    if (botThrows(game, botP1, BOT_PROFILES[p1], 'p1', STEP, rng.float()))
      tryThrow(game, 'p1', rng);
    if (botThrows(game, botP2, BOT_PROFILES[p2], 'p2', STEP, rng.float()))
      tryThrow(game, 'p2', rng);
    step(game, STEP, rng);
  }
  return game;
}

describe('the round', () => {
  it('starts with p1 holding a full fuse', () => {
    const game = createGame(new Rng(1));
    expect(game.holder).toBe('p1');
    expect(game.fuse).toBe(FUSE_SECONDS);
    expect(game.phase).toBe('holding');
    expect(game.band).toBe(START_BAND);
  });

  it('resets in place', () => {
    const game = createGame(new Rng(1));
    game.rounds.p1 = 2;
    resetGame(game, new Rng(1));
    expect(game.rounds).toEqual({ p1: 0, p2: 0 });
    expect(game.fuse).toBe(FUSE_SECONDS);
  });

  it('sweeps the marker and wraps it', () => {
    const game = createGame(new Rng(1));
    for (let i = 0; i < 60 * 5; i += 1) step(game, STEP, new Rng(1));
    expect(game.marker).toBeGreaterThanOrEqual(0);
    expect(game.marker).toBeLessThan(1);
  });

  it('sweeps faster as the fuse burns', () => {
    expect(sweepAt(FUSE_SECONDS)).toBeCloseTo(BASE_SWEEP, 6);
    expect(sweepAt(0)).toBeCloseTo(MAX_SWEEP, 6);
    expect(sweepAt(FUSE_SECONDS / 2)).toBeGreaterThan(BASE_SWEEP);
    expect(sweepAt(FUSE_SECONDS / 2)).toBeLessThan(MAX_SWEEP);
  });

  it('never puts a band across the wrap point', () => {
    // A band that wrapped would be two bands to look at and one to hit, which is a puzzle
    // rather than a test of timing.
    const rng = new Rng(3);
    for (const band of [START_BAND, START_BAND / 2, MIN_BAND]) {
      for (let i = 0; i < 200; i += 1) {
        const centre = placeBand(rng, band);
        expect(centre - band, `band ${String(band)}`).toBeGreaterThanOrEqual(0);
        expect(centre + band).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('throwing', () => {
  it('is refused when it is not your potato', () => {
    // Three outcomes, all distinct: it went, it missed, or it was not yours to throw.
    const game = createGame(new Rng(1));
    aimAtBand(game);
    expect(tryThrow(game, 'p2', new Rng(1))).toBe('refused');
  });

  it('misses when the marker is outside the band', () => {
    const game = createGame(new Rng(1));
    game.marker = (game.bandCentre + 0.4) % 1;
    expect(onTarget(game)).toBe(false);
    expect(tryThrow(game, 'p1', new Rng(1)), 'a miss is not a refusal').toBe('missed');
    expect(game.phase, 'and the potato stays put').toBe('holding');
  });

  it('goes when the marker is inside the band', () => {
    const game = createGame(new Rng(1));
    aimAtBand(game);
    expect(tryThrow(game, 'p1', new Rng(1))).toBe('thrown');
    expect(game.phase).toBe('flying');
  });

  it('is refused while the potato is in the air', () => {
    const game = createGame(new Rng(1));
    aimAtBand(game);
    tryThrow(game, 'p1', new Rng(1));
    expect(tryThrow(game, 'p1', new Rng(1))).toBe('refused');
  });

  it('hands over once the flight lands', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    aimAtBand(game);
    tryThrow(game, 'p1', rng);
    for (let i = 0; i < Math.ceil(FLIGHT_SECONDS / STEP) + 2; i += 1) step(game, STEP, rng);
    expect(game.holder).toBe('p2');
    expect(game.phase).toBe('holding');
  });

  it('narrows the band every throw, down to a floor', () => {
    // The whole game: it starts easy enough for anyone and ends genuinely hard, so a round
    // ends because the players ran out of skill rather than because a timer ran out.
    expect(bandAfter(0)).toBe(START_BAND);
    expect(bandAfter(1)).toBeCloseTo(START_BAND * BAND_DECAY, 9);
    expect(bandAfter(3)).toBeLessThan(bandAfter(2));
    expect(bandAfter(200), 'never impossible').toBe(MIN_BAND);
  });

  it('actually narrows the game band on a throw, not just in the formula', () => {
    // `bandAfter` being right proves nothing if `tryThrow` never calls it — removing the
    // call failed no test until this one existed.
    const rng = new Rng(5);
    const game = createGame(rng);
    const before = game.band;
    aimAtBand(game);
    expect(tryThrow(game, 'p1', rng)).toBe('thrown');
    expect(game.band, 'the next throw is harder').toBeLessThan(before);
    expect(game.band).toBeCloseTo(bandAfter(1), 9);
  });

  it('moves the band after a throw, so it is never the same twice', () => {
    const rng = new Rng(7);
    const game = createGame(rng);
    aimAtBand(game);
    const before = game.bandCentre;
    tryThrow(game, 'p1', rng);
    expect(game.bandCentre).not.toBe(before);
  });
});

describe('the fuse', () => {
  it('burns through a flight as well as a hold', () => {
    // A throw is not a rest. If it were, a player could keep themselves safe by throwing
    // constantly and the potato would spend the fuse in the air rather than in hands.
    const rng = new Rng(1);
    const game = createGame(rng);
    aimAtBand(game);
    tryThrow(game, 'p1', rng);
    const before = game.fuse;
    step(game, STEP, rng);
    expect(game.fuse).toBeLessThan(before);
  });

  it('catches whoever is holding it when it runs out', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    game.fuse = STEP / 2;
    expect(step(game, STEP, rng)).toBe('caught');
    expect(game.caught).toBe('p1');
    expect(game.rounds.p2, 'the other seat takes the round').toBe(1);
  });

  it('catches the receiver when it runs out mid-flight', () => {
    // They were about to hold it, and the alternative punishes a player for a throw that
    // had already left their hands.
    const rng = new Rng(1);
    const game = createGame(rng);
    aimAtBand(game);
    tryThrow(game, 'p1', rng);
    game.fuse = STEP / 2;
    step(game, STEP, rng);
    expect(game.caught, 'the receiver is caught').toBe('p2');
  });

  it('pauses after a catch, then starts the next round', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    game.fuse = STEP / 2;
    step(game, STEP, rng);
    expect(game.phase).toBe('settling');
    for (let i = 0; i < Math.ceil(SETTLE_SECONDS / STEP) + 2; i += 1) step(game, STEP, rng);
    expect(game.phase).toBe('holding');
    // Near full rather than exactly full: the loop runs a couple of steps past the
    // restart, and those burn fuse like any other.
    expect(game.fuse).toBeGreaterThan(FUSE_SECONDS - 0.2);
  });

  it('gives the next round to whoever was caught', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    game.fuse = STEP / 2;
    step(game, STEP, rng);
    for (let i = 0; i < Math.ceil(SETTLE_SECONDS / STEP) + 2; i += 1) step(game, STEP, rng);
    expect(game.holder, 'the caught seat throws first next').toBe('p1');
  });
});

describe('winning', () => {
  it('is undecided at the start', () => {
    expect(winnerOf(createGame(new Rng(1)))).toBeNull();
  });

  it('is won at the target', () => {
    const game = createGame(new Rng(1));
    game.rounds.p1 = TARGET_ROUNDS;
    expect(winnerOf(game)).toBe('p1');
  });

  it('has two seats', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the bot', () => {
  it('does nothing when it is not holding the potato', () => {
    const game = createGame(new Rng(1));
    const bot = createBotState();
    aimAtBand(game);
    expect(botThrows(game, bot, BOT_PROFILES.hard, 'p2', STEP, 0)).toBe(false);
  });

  it('waits its reaction time before throwing', () => {
    const game = createGame(new Rng(1));
    const bot = createBotState();
    aimAtBand(game);
    const profile = BOT_PROFILES.hard;
    expect(botThrows(game, bot, profile, 'p1', STEP, 0.9), 'not on the first step').toBe(false);
    let threw = false;
    for (let i = 0; i < 60 && !threw; i += 1) {
      threw = botThrows(game, bot, profile, 'p1', STEP, 0.9);
    }
    expect(threw).toBe(true);
    expect(bot.watched).toBeGreaterThanOrEqual(profile.reaction);
  });

  it('forgets what it was watching once the marker leaves', () => {
    const game = createGame(new Rng(1));
    const bot = createBotState();
    aimAtBand(game);
    botThrows(game, bot, BOT_PROFILES.hard, 'p1', STEP, 0.9);
    expect(bot.watched).toBeGreaterThan(0);
    game.marker = (game.bandCentre + 0.4) % 1;
    botThrows(game, bot, BOT_PROFILES.hard, 'p1', STEP, 0.9);
    expect(bot.watched).toBe(0);
  });

  it('never reacts faster than a person', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      expect(BOT_PROFILES[tier].reaction, tier).toBeGreaterThan(0.05);
    }
  });

  it('aims tighter as the tier rises', () => {
    // Below 1 it aims for the middle of the band and lands; above 1 it grabs at the edge
    // and misses. This is the whole skill.
    expect(BOT_PROFILES.hard.aim).toBeLessThan(BOT_PROFILES.normal.aim);
    expect(BOT_PROFILES.normal.aim).toBeLessThan(BOT_PROFILES.easy.aim);
    expect(BOT_PROFILES.hard.aim, 'even the best one commits inside the band').toBeLessThan(1);
  });

  it('clears its state on reset', () => {
    const bot = createBotState();
    bot.watched = 0.4;
    resetBotState(bot);
    expect(bot.watched).toBe(0);
  });

  it('beats the weaker tier over a series', { timeout: 240_000 }, () => {
    let wins = 0;
    const games = 16;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const finished = playOut(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 800 + i);
      if (winnerOf(finished) === (hardIsP1 ? 'p1' : 'p2')) wins += 1;
    }
    // Measured at 100% against easy and 88% against normal over forty matches. The first
    // hard tier beat normal 100% too, which is a wall rather than an opponent.
    expect(wins, `hard won ${String(wins)} of ${String(games)}`).toBeGreaterThan(games * 0.6);
  });
});

describe('a whole match', () => {
  it('always finishes', { timeout: 240_000 }, () => {
    for (const seed of [11, 22, 33]) {
      expect(winnerOf(playOut('normal', 'normal', seed)), `seed ${String(seed)}`).not.toBeNull();
    }
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const rng = new Rng(55);
      const game = createGame(rng);
      const bot = createBotState();
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        if (botThrows(game, bot, BOT_PROFILES.normal, game.holder, STEP, rng.float())) {
          tryThrow(game, game.holder, rng);
        }
        step(game, STEP, rng);
        if (i % 30 === 0) out.push(`${game.holder}${String(Math.round(game.marker * 100))}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts a round with a fresh band and no throws', () => {
    const rng = new Rng(1);
    const game = createGame(rng);
    game.throws = 5;
    game.band = MIN_BAND;
    startRound(game, 'p2', rng);
    expect(game.throws).toBe(0);
    expect(game.band).toBe(START_BAND);
    expect(game.holder).toBe('p2');
  });
});
