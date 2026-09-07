import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
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
import type { BotDifficulty, Game, Phase } from './rules.js';

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

/* ------------------------------------------------------------------------------------ */
/* The half-turn                                                                         */
/* ------------------------------------------------------------------------------------ */

const PHASES: readonly Phase[] = ['holding', 'flying', 'settling'];

/**
 * The board seen from the other chair.
 *
 * There is nothing geometric to reflect: one bar, read the same way up by both seats, and
 * the only seat-owned things in the whole state are who is holding it, who was caught, and
 * the two round counts. So the half-turn is exactly "relabel p1 as p2" - which makes any
 * failure of this test a pure seat bias with nowhere to hide.
 */
function mirrorInto(from: Readonly<Game>, to: Game): void {
  to.phase = from.phase;
  to.holder = otherOf(from.holder);
  to.fuse = from.fuse;
  to.flight = from.flight;
  to.settle = from.settle;
  to.marker = from.marker;
  to.band = from.band;
  to.bandCentre = from.bandCentre;
  to.throws = from.throws;
  to.caught = from.caught === null ? null : otherOf(from.caught);
  to.rounds.p1 = from.rounds.p2;
  to.rounds.p2 = from.rounds.p1;
}

/**
 * Everything a step can touch, to nine places.
 *
 * Printed rather than compared numerically so a signed zero from one seat and a plain zero
 * from the other cannot pass: `(-0).toFixed(9)` and `(0).toFixed(9)` are different strings.
 */
function describeGame(game: Readonly<Game>): string {
  const nine = (value: number): string => value.toFixed(9);
  return [
    game.phase,
    game.holder,
    nine(game.fuse),
    nine(game.flight),
    nine(game.settle),
    nine(game.marker),
    nine(game.band),
    nine(game.bandCentre),
    String(game.throws),
    String(game.caught),
    String(game.rounds.p1),
    String(game.rounds.p2),
  ].join('/');
}

/**
 * An arbitrary but legal board.
 *
 * The fuse, the flight and the settle are whole numbers of fixed steps, so each of them
 * reaches its threshold **exactly** rather than approximately - a fuse that expires on the
 * same step as a flight lands is the case that decides who is caught, and it happens here
 * by construction. The marker is placed on the band edge as often as it is placed at
 * random, because `distance <= game.band` is the other threshold the game turns on.
 */
function scramble(game: Game, rng: Rng): void {
  game.phase = PHASES[rng.int(0, PHASES.length)] as Phase;
  game.holder = rng.bool(0.5) ? 'p1' : 'p2';
  game.fuse = rng.int(0, 30) * STEP;
  game.flight = rng.int(0, 30) * STEP;
  game.settle = rng.int(0, 30) * STEP;
  game.throws = rng.int(0, 12);
  game.band = bandAfter(game.throws);
  game.bandCentre = placeBand(rng, game.band);
  const roll = rng.float();
  if (roll < 0.25) game.marker = game.bandCentre;
  else if (roll < 0.5) game.marker = (game.bandCentre + game.band) % 1;
  else if (roll < 0.75) game.marker = (game.bandCentre - game.band + 1) % 1;
  else game.marker = rng.float();
  game.caught = rng.bool(0.3) ? null : rng.bool(0.5) ? 'p1' : 'p2';
  game.rounds.p1 = rng.int(0, TARGET_ROUNDS);
  game.rounds.p2 = rng.int(0, TARGET_ROUNDS);
}

describe('the half-turn', () => {
  it('steps a mirrored board to the mirror of the stepped board', () => {
    const rng = new Rng(20260829);
    const game = createGame(new Rng(1));
    const other = createGame(new Rng(1));
    const expected = createGame(new Rng(1));
    for (let trial = 0; trial < 600; trial += 1) {
      scramble(game, rng);
      mirrorInto(game, other);
      const seed = trial * 131 + 7;
      const mine = step(game, STEP, new Rng(seed));
      const theirs = step(other, STEP, new Rng(seed));
      expect(theirs, `trial ${String(trial)}`).toBe(mine);
      mirrorInto(game, expected);
      expect(describeGame(other), `trial ${String(trial)}`).toBe(describeGame(expected));
    }
  });

  it('answers a mirrored throw identically', () => {
    const rng = new Rng(4242);
    const game = createGame(new Rng(1));
    const other = createGame(new Rng(1));
    const expected = createGame(new Rng(1));
    for (let trial = 0; trial < 600; trial += 1) {
      scramble(game, rng);
      mirrorInto(game, other);
      const seed = trial * 977 + 3;
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const mine = tryThrow(game, seat, new Rng(seed));
        const theirs = tryThrow(other, otherOf(seat), new Rng(seed));
        expect(theirs, `trial ${String(trial)} ${seat}`).toBe(mine);
        mirrorInto(game, expected);
        expect(describeGame(other), `trial ${String(trial)} ${seat}`).toBe(describeGame(expected));
      }
    }
  });

  it('makes a bot decide the mirrored thing on a mirrored board', () => {
    const rng = new Rng(31337);
    const game = createGame(new Rng(1));
    const other = createGame(new Rng(1));
    for (const tier of Object.keys(BOT_PROFILES) as BotDifficulty[]) {
      for (let trial = 0; trial < 400; trial += 1) {
        scramble(game, rng);
        mirrorInto(game, other);
        // One roll to both seats: the stream must be handed out by role, not by seat.
        const roll = rng.float();
        const watched = rng.int(0, 30) * STEP;
        for (const seat of ['p1', 'p2'] as SeatId[]) {
          const here = createBotState();
          const there = createBotState();
          here.watched = watched;
          there.watched = watched;
          const mine = botThrows(game, here, BOT_PROFILES[tier], seat, STEP, roll);
          const theirs = botThrows(other, there, BOT_PROFILES[tier], otherOf(seat), STEP, roll);
          expect(theirs, `${tier} trial ${String(trial)} ${seat}`).toBe(mine);
          expect(there.watched, `${tier} trial ${String(trial)} ${seat} watch`).toBe(here.watched);
        }
      }
    }
  });

  it('plays a whole match to the mirrored result when the other seat opens', () => {
    for (const tier of Object.keys(BOT_PROFILES) as BotDifficulty[]) {
      for (let s = 0; s < 25; s += 1) {
        const seed = 1000003 + s * 7919;
        const forward = playRules(seed, 'p1', tier);
        const backward = playRules(seed, 'p2', tier);
        const where = `${tier} seed ${String(seed)}`;
        expect(forward.winner, `${where} decided nothing`).not.toBeNull();
        expect(backward.winner, where).toBe(forward.winner === 'p1' ? 'p2' : 'p1');
        expect(backward.p1, where).toBe(forward.p2);
        expect(backward.p2, where).toBe(forward.p1);
        expect(backward.steps, where).toBe(forward.steps);
      }
    }
  });
});

interface Played {
  readonly winner: SeatId | null;
  readonly p1: number;
  readonly p2: number;
  readonly steps: number;
}

/**
 * Two bots of one tier, driven straight from the rules with the roll handed out **by
 * role**: the holder draws first.
 *
 * Only the holder can throw, so only the holder's roll can ever matter - but the other
 * seat drawing one first still shifts every number the holder sees, which is how a seed
 * and its mirror became two different matches.
 */
function playRules(seed: number, opener: SeatId, tier: BotDifficulty): Played {
  const rng = new Rng(seed);
  const game = createGame(rng, opener);
  const bots = { p1: createBotState(), p2: createBotState() };
  const profile = BOT_PROFILES[tier];
  for (let i = 0; i < 60 * 600; i += 1) {
    for (const seat of [game.holder, otherOf(game.holder)]) {
      if (botThrows(game, bots[seat], profile, seat, STEP, rng.float())) tryThrow(game, seat, rng);
    }
    step(game, STEP, rng);
    const winner = winnerOf(game);
    if (winner !== null) {
      return { winner, p1: game.rounds.p1, p2: game.rounds.p2, steps: i + 1 };
    }
  }
  return { winner: null, p1: game.rounds.p1, p2: game.rounds.p2, steps: 60 * 600 };
}
