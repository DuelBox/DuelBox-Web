import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Hot Potato, as pure rules.
 *
 * A potato is thrown back and forth on a fuse. Whoever is holding it when the fuse runs
 * out loses the round. You throw by tapping while the marker crosses your target band —
 * miss the band and the potato stays with you, and the fuse keeps burning.
 *
 * The band **narrows every throw**. That is the whole game: it starts easy enough that
 * anyone can play, and by the eighth or ninth exchange it is genuinely hard, so a round
 * ends because the players run out of skill rather than because a timer ran out on its
 * own.
 *
 * No rendering, no timing, no DOM.
 */

/** Rounds to win a match. */
export const TARGET_ROUNDS = 3;

/** How long a fuse burns, in seconds. */
export const FUSE_SECONDS = 12;

/** How fast the marker sweeps, in bands per second. It speeds up as the fuse burns. */
export const BASE_SWEEP = 0.85;
export const MAX_SWEEP = 1.9;

/** Half-width of the target band, as a fraction of the sweep, at the first throw. */
export const START_BAND = 0.3;
/** How much of the band survives each throw. */
export const BAND_DECAY = 0.86;
/** The band never shrinks below this, or nobody could ever throw at all. */
export const MIN_BAND = 0.055;

/** How long the potato is in the air between hands. */
export const FLIGHT_SECONDS = 0.35;

/** How long the round result is held so both players see who was caught. */
export const SETTLE_SECONDS = 1.4;

export type Phase =
  /** The marker is sweeping and the holder may throw. */
  | 'holding'
  /** The potato is between hands; neither player may act. */
  | 'flying'
  /** The fuse ran out. */
  | 'settling';

export interface Game {
  phase: Phase;
  /** Who is holding the potato. */
  holder: SeatId;
  /** Seconds left on the fuse. */
  fuse: number;
  /** Seconds left of the current flight. */
  flight: number;
  /** Seconds left of the round pause. */
  settle: number;
  /**
   * Where the marker is, in [0, 1), sweeping upwards and wrapping.
   *
   * One dimension, not two: the marker is a position on a bar and the target is a band on
   * that bar, so the whole skill is *when*, never *where*.
   */
  marker: number;
  /** Half-width of the target band, which shrinks with every throw. */
  band: number;
  /** Where the band sits on the bar. */
  bandCentre: number;
  /** Throws made this round, which is what shrinks the band. */
  throws: number;
  /** Who was caught holding it last, for the renderer. */
  caught: SeatId | null;
  rounds: { p1: number; p2: number };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function createGame(rng: Rng): Game {
  const game: Game = {
    phase: 'holding',
    holder: 'p1',
    fuse: FUSE_SECONDS,
    flight: 0,
    settle: 0,
    marker: 0,
    band: START_BAND,
    bandCentre: 0.5,
    throws: 0,
    caught: null,
    rounds: { p1: 0, p2: 0 },
  };
  resetGame(game, rng);
  return game;
}

export function resetGame(game: Game, rng: Rng): void {
  game.rounds.p1 = 0;
  game.rounds.p2 = 0;
  game.caught = null;
  startRound(game, 'p1', rng);
}

export function startRound(game: Game, holder: SeatId, rng: Rng): void {
  game.phase = 'holding';
  game.holder = holder;
  game.fuse = FUSE_SECONDS;
  game.flight = 0;
  game.settle = 0;
  game.marker = 0;
  game.band = START_BAND;
  game.bandCentre = placeBand(rng, START_BAND);
  game.throws = 0;
}

/**
 * Where the next band sits.
 *
 * Kept away from the wrap point, so a band never straddles the end of the bar. A band that
 * wrapped would be two bands to look at and one to hit, which is a puzzle rather than a
 * test of timing.
 */
export function placeBand(rng: Rng, band: number): number {
  // The margin is the band's own width, so the band is fully on the bar however wide it
  // is. A fixed margin was the first version and it did not survive its own test: at full
  // width the band ran off the end of the bar and wrapped.
  const margin = Math.min(band, 0.45);
  return margin + rng.float() * (1 - margin * 2);
}

/** How fast the marker sweeps right now: faster as the fuse burns down. */
export function sweepAt(fuse: number): number {
  const burnt = 1 - Math.max(0, Math.min(1, fuse / FUSE_SECONDS));
  return BASE_SWEEP + (MAX_SWEEP - BASE_SWEEP) * burnt;
}

/** How wide the band is after `throws` throws. */
export function bandAfter(throws: number): number {
  return Math.max(MIN_BAND, START_BAND * Math.pow(BAND_DECAY, throws));
}

/** Whether the marker is inside the band right now. */
export function onTarget(game: Readonly<Game>): boolean {
  const gap = Math.abs(game.marker - game.bandCentre);
  // The bar wraps, so the far way round may be closer.
  const distance = Math.min(gap, 1 - gap);
  return distance <= game.band;
}

export type ThrowResult = 'thrown' | 'missed' | 'refused';

/**
 * Try to throw.
 *
 * Three outcomes, all distinct: it went, it missed, or it was not this player's to throw.
 * A miss is not a refusal — a miss costs you the fuse you burn recovering, and telling a
 * caller the difference is the whole reason this returns a word rather than a boolean.
 */
export function tryThrow(game: Game, seat: SeatId, rng: Rng): ThrowResult {
  if (game.phase !== 'holding') return 'refused';
  if (game.holder !== seat) return 'refused';
  if (!onTarget(game)) return 'missed';

  game.throws += 1;
  game.band = bandAfter(game.throws);
  game.bandCentre = placeBand(rng, game.band);
  game.phase = 'flying';
  game.flight = FLIGHT_SECONDS;
  return 'thrown';
}

export type StepResult = 'playing' | 'caught';

/**
 * Advance one fixed step.
 *
 * **The fuse burns through the flight as well as the hold.** A throw is not a rest: if it
 * were, a player could keep themselves safe by throwing constantly, and the potato would
 * spend the fuse in the air rather than in anybody's hands.
 */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  if (game.phase === 'settling') {
    game.settle -= fixedDeltaSeconds;
    if (game.settle <= 0 && winnerOf(game) === null) {
      // Whoever was caught starts the next round, which gives them the throw first.
      startRound(game, game.caught ?? 'p1', rng);
    }
    return 'playing';
  }

  game.fuse -= fixedDeltaSeconds;
  game.marker = (game.marker + sweepAt(game.fuse) * fixedDeltaSeconds) % 1;

  if (game.phase === 'flying') {
    game.flight -= fixedDeltaSeconds;
    if (game.flight <= 0) {
      game.holder = otherOf(game.holder);
      game.phase = 'holding';
    }
  }

  if (game.fuse <= 0) {
    // Caught in the air counts against whoever it is flying *to*: they were about to hold
    // it, and the alternative punishes a player for a throw that had already left.
    const caught = game.phase === 'flying' ? otherOf(game.holder) : game.holder;
    game.caught = caught;
    const winner = otherOf(caught);
    if (winner === 'p1') game.rounds.p1 += 1;
    else game.rounds.p2 += 1;
    game.phase = 'settling';
    game.settle = SETTLE_SECONDS;
    game.fuse = 0;
    return 'caught';
  }
  return 'playing';
}

export function winnerOf(game: Readonly<Game>): SeatId | null {
  if (game.rounds.p1 >= TARGET_ROUNDS) return 'p1';
  if (game.rounds.p2 >= TARGET_ROUNDS) return 'p2';
  return null;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * How much of the band it is willing to use, from the centre out.
   *
   * Below 1 it aims for the middle and is therefore safe; above 1 it would throw outside
   * the band and miss. This is the whole skill: a good player commits early enough to land
   * inside a narrow band, a poor one is late and clips the edge.
   */
  readonly aim: number;
  /** Seconds of reaction between the marker entering its window and the tap. */
  readonly reaction: number;
  /** Chance per attempt of simply not throwing at all. */
  readonly freeze: number;
}

/**
 * Measured over forty matches a pairing: hard beats normal 88%, and both beat easy.
 *
 * The first hard tier beat normal **100%** of the time, which is a wall rather than an
 * opponent — the same objection I raised against Cornhole's first bot, and it applies just
 * as well here. It now misses sometimes.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { aim: 1.5, reaction: 0.3, freeze: 0.25 },
  normal: { aim: 1.1, reaction: 0.18, freeze: 0.07 },
  hard: { aim: 0.8, reaction: 0.13, freeze: 0.02 },
});

/** What a bot remembers: only how long it has been watching the marker approach. */
export interface BotState {
  watched: number;
}

export function createBotState(): BotState {
  return { watched: 0 };
}

export function resetBotState(bot: BotState): void {
  bot.watched = 0;
}

/**
 * Whether the bot taps this step.
 *
 * It sees the marker and the band, exactly as a person does, and it has a reaction time it
 * cannot beat. `aim` decides how tight a slice of the band it trusts itself to hit: a bot
 * that waits for the middle throws later but lands, and one that grabs at the edge throws
 * sooner and misses.
 */
export function botThrows(
  game: Readonly<Game>,
  bot: BotState,
  profile: BotProfile,
  seat: SeatId,
  fixedDeltaSeconds: number,
  roll: number,
): boolean {
  if (game.phase !== 'holding' || game.holder !== seat) {
    bot.watched = 0;
    return false;
  }
  const gap = Math.abs(game.marker - game.bandCentre);
  const distance = Math.min(gap, 1 - gap);
  const window = game.band * profile.aim;
  if (distance > window) {
    bot.watched = 0;
    return false;
  }
  bot.watched += fixedDeltaSeconds;
  if (bot.watched < profile.reaction) return false;
  return roll >= profile.freeze;
}
