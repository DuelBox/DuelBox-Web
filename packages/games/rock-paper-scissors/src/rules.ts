import type { SeatId } from '@duelbox/engine';

/**
 * Rock Paper Scissors, as pure rules.
 *
 * The only genuinely *simultaneous* game in the catalogue so far, and that is what makes
 * it interesting to build. Everything else here is turn-based or has each seat acting on
 * its own half; this has both players committing at the same instant to the same
 * decision, which is exactly the case the SDK's `resolveSimultaneous` exists for.
 *
 * No rendering, no timing, no DOM.
 */

export type Throw = 'rock' | 'paper' | 'scissors';

export const THROWS: readonly Throw[] = ['rock', 'paper', 'scissors'];

/** What each throw beats. The whole game, as one table. */
const BEATS: Readonly<Record<Throw, Throw>> = Object.freeze({
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
});

export function beats(a: Throw, b: Throw): boolean {
  return BEATS[a] === b;
}

/** Rounds a seat must win to take the match. */
export const ROUNDS_TO_WIN = 3;

/**
 * How long a round's window lasts, in seconds.
 *
 * The observed rules say "press before the hand stops", so a round is a window rather
 * than a prompt: both players may commit at any point, and the window closing is what
 * resolves it.
 */
export const WINDOW_SECONDS = 2.2;

/**
 * Tolerance for calling two commits simultaneous, in seconds.
 *
 * Matches the SDK's default. Eight milliseconds is about half a frame — below it, no
 * honest claim of "first" can be made, and across two devices the difference would be
 * network jitter rather than reflex.
 */
export const SIMULTANEOUS_TOLERANCE = 0.008;

export type RoundOutcome = SeatId | 'draw';

/**
 * Who wins a round.
 *
 * A seat that did not commit before the window closed loses to one that did; if neither
 * committed, the round is a draw and nobody scores. Committing the same throw is a draw
 * too — the ordinary one.
 *
 * Note what this deliberately does **not** consider: *when* each seat committed. Speed
 * decides nothing here, only the choice does. That matters for cross-device fairness —
 * if being 30ms faster won a round, the player with the better connection would win the
 * match, and no amount of timestamp reconciliation would fix it.
 */
export function resolveRound(a: Throw | null, b: Throw | null): RoundOutcome {
  if (a === null && b === null) return 'draw';
  if (a === null) return 'p2';
  if (b === null) return 'p1';
  if (a === b) return 'draw';
  return beats(a, b) ? 'p1' : 'p2';
}

export interface Tally {
  readonly p1: number;
  readonly p2: number;
}

export function winnerOf(tally: Tally): SeatId | 'draw' | null {
  const p1Won = tally.p1 >= ROUNDS_TO_WIN;
  const p2Won = tally.p2 >= ROUNDS_TO_WIN;
  // Both cannot reach the target: a round awards at most one point. The check is here so
  // the rule is explicit rather than assumed by whoever changes the scoring later.
  if (p1Won && p2Won) return 'draw';
  if (p1Won) return 'p1';
  if (p2Won) return 'p2';
  return null;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * How much of its decision comes from reading the opponent's habits rather than from
   * chance. Zero is pure chance; one always plays the counter to their likeliest throw.
   */
  readonly reading: number;
  /** Seconds the bot waits before committing, as a fraction of the window. */
  readonly commitAt: number;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reading: 0, commitAt: 0.7 },
  normal: { reading: 0.45, commitAt: 0.55 },
  hard: { reading: 0.8, commitAt: 0.45 },
});

/**
 * What the bot has seen the human throw.
 *
 * Counts only — it cannot see the current round's choice, which is the thing that would
 * make it unbeatable and would feel like cheating. A human watching their opponent across
 * a table has exactly this information: what they have tended to do so far.
 */
export interface BotMemory {
  readonly counts: Record<Throw, number>;
}

export function createMemory(): BotMemory {
  return { counts: { rock: 0, paper: 0, scissors: 0 } };
}

export function resetMemory(memory: BotMemory): void {
  memory.counts.rock = 0;
  memory.counts.paper = 0;
  memory.counts.scissors = 0;
}

export function remember(memory: BotMemory, thrown: Throw): void {
  memory.counts[thrown] += 1;
}

/** The throw `target` is most likely to make, from what has been seen. Null if nothing has. */
export function likeliestThrow(memory: BotMemory): Throw | null {
  let best: Throw | null = null;
  let bestCount = 0;
  for (const option of THROWS) {
    const count = memory.counts[option];
    if (count > bestCount) {
      bestCount = count;
      best = option;
    }
  }
  return best;
}

/** What beats `throwToBeat`. */
export function counterTo(throwToBeat: Throw): Throw {
  for (const option of THROWS) {
    if (beats(option, throwToBeat)) return option;
  }
  // Unreachable: every throw is beaten by exactly one other.
  return 'rock';
}

/**
 * The bot's throw.
 *
 * `roll` is a value in [0, 1) from the seeded RNG, passed in rather than drawn here so
 * this stays a pure function and a replay is exact.
 *
 * It reads habits and plays the counter, at a strength set by difficulty — the same thing
 * a person does across a table. It never sees the current round's choice, so it has no
 * information a human lacks (CLAUDE.md rule 6).
 */
export function botThrow(memory: BotMemory, profile: BotProfile, roll: number): Throw {
  const likely = likeliestThrow(memory);
  if (likely !== null && roll < profile.reading) return counterTo(likely);
  // Otherwise chance, which is also the correct strategy against a perfect opponent.
  const index = Math.floor(
    ((roll - (likely === null ? 0 : profile.reading)) /
      (1 - (likely === null ? 0 : profile.reading))) *
      THROWS.length,
  );
  return THROWS[Math.min(THROWS.length - 1, Math.max(0, index))] ?? 'rock';
}
