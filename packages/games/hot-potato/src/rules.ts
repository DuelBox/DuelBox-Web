import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Hot Potato, as pure rules.
 *
 * A potato is thrown back and forth on a fuse. Whoever is holding it when the fuse runs
 * out loses the round. You throw by tapping while the marker crosses your target band —
 * miss the band and the potato stays with you, and the fuse keeps burning.
 *
 * The band **narrows every throw**. That is the whole game: it starts easy enough that
 * anyone can play, and by the fifth or sixth exchange it is genuinely hard, so a round
 * ends because the players run out of skill rather than because a timer ran out on its
 * own.
 *
 * What difficulty actually means here is not the band's width but
 * `transit = 2 * band / sweep` — how long the marker spends inside it. Band and sweep both
 * push that down, so they are budgeted together and the window has a floor a person can
 * still act inside: see {@link MIN_BAND} and {@link HUMAN_REACTION_SECONDS}.
 *
 * No rendering, no timing, no DOM.
 */

/** Rounds to win a match. */
export const TARGET_ROUNDS = 3;

/** How long a fuse burns, in seconds. */
export const FUSE_SECONDS = 12;

/**
 * How fast the marker sweeps, in bars per second. It speeds up as the fuse burns.
 *
 * The top of the range was 1.9 until #2507. Sweep and band shrank the acting window on two
 * axes at once — see {@link MIN_BAND} — and 1.9 was chosen without anyone multiplying the
 * two together. It is now the second half of a budget rather than a free number: raising it
 * widens {@link MIN_BAND} in step, because the floor is derived from it.
 */
export const BASE_SWEEP = 0.85;
export const MAX_SWEEP = 1.25;

/** Half-width of the target band, as a fraction of the bar, at the first throw. */
export const START_BAND = 0.3;
/** How much of the band survives each throw. */
export const BAND_DECAY = 0.86;

/**
 * Simple visual reaction time for a person, in seconds.
 *
 * The reference the difficulty ramp is capped against, per CLAUDE.md rule 6: a bot may
 * never be given speed or reaction a human cannot have, so the game may never ramp into a
 * regime where only a machine can play. ~0.25 s is the standard figure for reacting to an
 * unanticipated visual stimulus, and it is deliberately the *conservative* model here —
 * this bar is a predictable, constant-speed target, so a person timing the marker's
 * arrival does better than their raw reaction time. Capping at the conservative number
 * means the cap is never the thing that makes the game unplayable.
 */
export const HUMAN_REACTION_SECONDS = 0.25;

/**
 * The narrowest the acting window is ever allowed to get, in seconds of marker travel.
 *
 * This, not the band width, is what difficulty actually means in this game: a band is only
 * hard in proportion to how fast the marker crosses it.
 */
export const MIN_TRANSIT_SECONDS = HUMAN_REACTION_SECONDS;

/**
 * The band never shrinks below this, or nobody — person or bot — could throw at all.
 *
 * **Derived, not chosen** (#2507). It used to be a flat 0.055, picked on its own, and the
 * arithmetic nobody did was `transit = 2 * band / sweep`: at 0.055 and the top sweep the
 * marker crossed the whole band in **0.058 s**, a quarter of the way to a human reaction.
 * Because band decayed *and* sweep climbed, the window shrank on two axes at once and the
 * game left human-playable territory after the first throw. Measured against the old
 * numbers, at MAX_SWEEP = 1.9:
 *
 * | throw | band | human transit | easy | normal | hard |
 * |---|---|---|---|---|---|
 * | 0 | 0.300 | 0.316 s | lands | lands | lands |
 * | 3 | 0.191 | 0.201 s | acts, never lands | lands | lands |
 * | 5 | 0.141 | 0.149 s | cannot act | cannot act | lands |
 * | 6 | 0.121 | 0.128 s | cannot act | cannot act | cannot act |
 *
 * From the sixth throw no tier could act at all, so `easy` and `hard` became the same
 * opponent and the round fell to whoever happened to be holding it.
 *
 * That last clause is also where this game's seat lean came from, which nobody had connected
 * to the ramp: seat one throws first, so the parity of the exchange decided who was holding
 * it when the window shut. Seat one took **95.0 / 91.5 / 63.5%** of decided equal-tier
 * matches at easy / normal / hard over 200 seeds; with the floor in place it takes
 * **49.5 / 50.0 / 53.5%**.
 *
 * Deriving the floor from
 * {@link MIN_TRANSIT_SECONDS} and {@link MAX_SWEEP} instead ties the two axes together:
 * 2 * MIN_BAND / MAX_SWEEP is exactly {@link MIN_TRANSIT_SECONDS}, whatever either is set
 * to, so the compounding cannot come back by someone raising the sweep.
 */
export const MIN_BAND = (MIN_TRANSIT_SECONDS * MAX_SWEEP) / 2;

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

/**
 * How long the marker spends inside a window of half-width `half`, in seconds.
 *
 * The unit difficulty is really measured in. A player's window is the band itself; a bot's
 * is `band * profile.aim`, because that is the slice of the band it trusts itself to hit.
 */
export function transitSeconds(half: number, sweep: number): number {
  return (2 * half) / sweep;
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
  /**
   * Seconds of reaction between the marker entering its window and the tap.
   *
   * A cost, not a gift: the bot has to *stay* inside its window this long before it commits,
   * so a shorter reaction is a better player. It is never lowered to rescue a bot from a
   * window that has closed — CLAUDE.md rule 6 — which is why the window has a floor instead.
   */
  readonly reaction: number;
  /**
   * Chance of letting a whole pass of the marker go by without throwing.
   *
   * Hesitation: the player was not ready, or second-guessed the moment, and waits for the
   * marker to come round again. Rolled **once**, when the marker enters the window, and held
   * until it leaves — a fresh roll every step is worth nothing at all, which is what this
   * was before #2507 and why the tiers had nothing left to tell them apart once the window
   * stopped closing.
   */
  readonly freeze: number;
}

/**
 * Measured over forty matches a pairing: **hard beats easy 95%, hard beats normal 90%, and
 * normal beats easy 80%.** Per-tier throw rates over throws six and later, across 240
 * matches: **easy 3.3, normal 10.3, hard 29.8** throws per thousand steps of holding it.
 *
 * The first hard tier beat normal **100%** of the time, which is a wall rather than an
 * opponent — the same objection I raised against Cornhole's first bot, and it applies just
 * as well here. It now misses sometimes.
 *
 * `freeze` was 0.25 / 0.07 / 0.02 and did nothing at all, because it was drawn afresh every
 * step: the chance of never throwing across a k-step window is freeze^k, so normal's 7% was
 * one in fourteen million. The old ladder — hard over normal at 88% — was therefore not
 * bought by these numbers but by the ramp closing the window entirely (#2507): the tiers
 * separated by *which of them was still holding it* when the game became unplayable for
 * both. Once the window has a human-playable floor, that separator is gone, and the tiers
 * have to be told apart by something a person also does. Hesitating and letting the marker
 * go round again is that thing, so `freeze` is now a real per-pass roll and is sized to do
 * real work.
 *
 * Nothing here is a speed or an information advantage: every tier watches the same marker on
 * the same bar, and the only knob that could give one an edge a person lacks — `reaction` —
 * is a cost that was not touched.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { aim: 1.5, reaction: 0.3, freeze: 0.8 },
  normal: { aim: 1.1, reaction: 0.18, freeze: 0.55 },
  hard: { aim: 0.8, reaction: 0.13, freeze: 0.05 },
});

/** What a bot remembers about the pass of the marker it is currently watching. */
export interface BotState {
  /** Seconds it has been watching the marker inside its window. */
  watched: number;
  /**
   * Whether it will take this pass at all, decided once when the marker enters the window
   * and held until the marker leaves it.
   */
  commits: boolean;
}

export function createBotState(): BotState {
  return { watched: 0, commits: false };
}

export function resetBotState(bot: BotState): void {
  bot.watched = 0;
  bot.commits = false;
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
    resetBotState(bot);
    return false;
  }
  const gap = Math.abs(game.marker - game.bandCentre);
  const distance = Math.min(gap, 1 - gap);
  const window = game.band * profile.aim;
  if (distance > window) {
    resetBotState(bot);
    return false;
  }
  // Whether to take this pass is decided once, on the step the marker enters the window,
  // and held until it leaves. Drawn afresh every step it was worth nothing: over the k steps
  // a window lasts the chance of never throwing is freeze^k, so `normal`'s nominal 7% was
  // one in fourteen million across a six-step window. That is the mistake
  // `@duelbox/game-sdk`'s bot-judgement module exists to prevent, reached by another route —
  // and it is why, once #2507 stopped the window closing, the tiers had nothing left to tell
  // them apart.
  if (bot.watched === 0) bot.commits = roll >= profile.freeze;
  bot.watched += fixedDeltaSeconds;
  if (bot.watched < profile.reaction) return false;
  return bot.commits;
}
