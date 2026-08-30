import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BAND_DECAY,
  BASE_SWEEP,
  BOT_PROFILES,
  FLIGHT_SECONDS,
  FUSE_SECONDS,
  HUMAN_REACTION_SECONDS,
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
  transitSeconds,
  tryThrow,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

/** Puts the marker exactly on the band, so a throw is bound to land. */
function aimAtBand(game: Game): void {
  game.marker = game.bandCentre;
}

const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

/**
 * Puts a lone bot in front of the band it would face after `throws` throws, sweeping at
 * `MAX_SWEEP` — the fastest the marker ever moves, at the end of a fuse — and reports
 * whether it ever acts, and whether a throw ever goes.
 *
 * `roll` is 1 so `freeze` never blocks: this measures what a tier *can* do, not how often
 * it chooses to. Four seconds is several passes of the marker at any sweep in the game.
 */
function facesBandAfter(
  tier: BotDifficulty,
  throws: number,
): { readonly acted: boolean; readonly thrown: boolean } {
  const rng = new Rng(9);
  const game = createGame(rng);
  game.band = bandAfter(throws);
  game.bandCentre = 0.5;
  game.marker = 0;
  const bot = createBotState();
  let acted = false;
  for (let i = 0; i < 60 * 4; i += 1) {
    if (botThrows(game, bot, BOT_PROFILES[tier], 'p1', STEP, 1)) {
      acted = true;
      if (tryThrow(game, 'p1', rng) === 'thrown') return { acted, thrown: true };
    }
    game.marker = (game.marker + MAX_SWEEP * STEP) % 1;
  }
  return { acted, thrown: false };
}

/** How often a tier got a throw away, split by how far into the ramp the round was. */
interface ActionRate {
  /** Steps spent holding the potato, by throw index. */
  readonly holding: number[];
  /** Throws that went, by throw index. */
  readonly thrown: number[];
}

function createActionRate(): ActionRate {
  return { holding: [], thrown: [] };
}

/** Throws per thousand steps of holding it, over throw indices `from` and later. */
function ratePerThousand(rate: ActionRate, from: number): number {
  let holding = 0;
  let thrown = 0;
  for (let i = from; i < rate.holding.length; i += 1) {
    holding += rate.holding[i] ?? 0;
    thrown += rate.thrown[i] ?? 0;
  }
  return holding === 0 ? 0 : (1000 * thrown) / holding;
}

function playOut(
  p1: BotDifficulty,
  p2: BotDifficulty,
  seed: number,
  rates?: Readonly<Record<BotDifficulty, ActionRate>>,
): Game {
  const rng = new Rng(seed);
  const game = createGame(rng);
  const botP1 = createBotState();
  const botP2 = createBotState();
  for (let i = 0; i < 60 * 400 && winnerOf(game) === null; i += 1) {
    if (rates !== undefined && game.phase === 'holding') {
      const rate = rates[game.holder === 'p1' ? p1 : p2];
      rate.holding[game.throws] = (rate.holding[game.throws] ?? 0) + 1;
    }
    for (const [seat, tier, bot] of [
      ['p1', p1, botP1],
      ['p2', p2, botP2],
    ] as const) {
      if (!botThrows(game, bot, BOT_PROFILES[tier], seat, STEP, rng.float())) continue;
      const at = game.throws;
      if (tryThrow(game, seat, rng) === 'thrown' && rates !== undefined) {
        const rate = rates[tier];
        rate.thrown[at] = (rate.thrown[at] ?? 0) + 1;
      }
    }
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
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].reaction, tier).toBeGreaterThan(0.05);
    }
  });

  it('never ramps past what a person can act inside', () => {
    // CLAUDE.md rule 6, stated as arithmetic rather than as a claim. The narrowest window
    // the game can produce is the floor band swept at the top speed, and it must still be
    // at least one simple visual reaction long — otherwise the game would be asking a
    // machine to play it, whatever the bot profiles said.
    expect(transitSeconds(MIN_BAND, MAX_SWEEP)).toBeGreaterThanOrEqual(HUMAN_REACTION_SECONDS);
    // And every tier's own window is at least as forgiving as the person's, because `aim`
    // scales the band and no tier's reaction was shortened to reach it.
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(
        transitSeconds(MIN_BAND * profile.aim, MAX_SWEEP),
        `${tier} cannot act at the floor`,
      ).toBeGreaterThan(profile.reaction);
    }
  });

  it('can still act at every point in the ramp, at the fastest the marker ever moves', () => {
    // #2507. The window a player has to act in is `transit = 2 * band * aim / sweep`, and
    // `band` and `sweep` used to shrink it on two axes at once: band decayed 0.86 a throw
    // towards 0.055 while sweep climbed towards 1.9. Measured against the old numbers, at
    // MAX_SWEEP:
    //
    //   throw | band   | easy transit | normal | hard
    //       6 | 0.1214 |     0.192 s  | 0.141  | 0.102
    //       7 | 0.1044 |     0.165 s  | 0.121  | 0.088
    //
    // Every one of those is below its tier's reaction (0.30 / 0.18 / 0.13), so from throw
    // six for easy and throw seven for normal and hard, no bot could act at all — this
    // whole assertion failed for every tier from index 6 onwards. Past that point `easy`
    // and `hard` were the same opponent and the round was decided by who happened to be
    // holding it, which is the difficulty a player chose quietly expiring.
    for (let throws = 0; throws <= 12; throws += 1) {
      for (const tier of TIERS) {
        const outcome = facesBandAfter(tier, throws);
        expect(outcome.acted, `${tier} never acts at throw ${String(throws)}`).toBe(true);
        expect(outcome.thrown, `${tier} never lands a throw at throw ${String(throws)}`).toBe(true);
      }
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

  it('keeps the tiers apart in the last third of a round, not just the first', () => {
    // A win rate cannot see this and #2504 paid for the lesson, so it is measured directly:
    // throws that went, per thousand steps of holding the potato, split by how far into the
    // ramp the round was. Before #2507 every tier's rate fell to **zero** from throw six or
    // seven, so `easy` and `hard` became literally the same opponent and the round was
    // decided by who happened to be holding it when the window shut.
    //
    // Measured over 240 matches across four pairings, throws 6 and later:
    //   easy 3.3 · normal 10.3 · hard 29.8 throws per 1000 holding steps.
    const rates = {
      easy: createActionRate(),
      normal: createActionRate(),
      hard: createActionRate(),
    } as const;
    for (let i = 0; i < 24; i += 1) {
      playOut('easy', 'hard', 3000 + i, rates);
      playOut('normal', 'normal', 4000 + i, rates);
      playOut('easy', 'normal', 5000 + i, rates);
      playOut('hard', 'hard', 6000 + i, rates);
    }

    const late = { easy: 0, normal: 0, hard: 0 };
    for (const tier of TIERS) {
      late[tier] = ratePerThousand(rates[tier], 6);
      expect(late[tier], `${tier} never acts late in a round`).toBeGreaterThan(0);
    }
    expect(late.hard, 'hard is still the strongest late').toBeGreaterThan(late.normal * 1.5);
    expect(late.normal, 'normal is still ahead of easy late').toBeGreaterThan(late.easy * 1.5);
  });

  it('beats the weaker tier over a series', { timeout: 240_000 }, () => {
    let wins = 0;
    const games = 16;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const finished = playOut(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 800 + i);
      if (winnerOf(finished) === (hardIsP1 ? 'p1' : 'p2')) wins += 1;
    }
    // Measured over forty matches a pairing, after #2507: hard beats easy 95%, hard beats
    // normal 90%, normal beats easy 80%. It was 100% and 88% before, but that ladder was
    // bought by the ramp closing the window on both seats rather than by either playing
    // better — see the note on BOT_PROFILES.
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
