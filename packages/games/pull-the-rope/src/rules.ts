import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Pull the Rope, as pure rules: the marker on the rope, the two stamina reserves, and
 * the three moves a step is made of.
 *
 * No rendering, no wall clock, no DOM. The game, the bot and the balance harness all
 * drive this same file, so what the harness measures is what the player feels.
 *
 * Every distance is a logical unit measured along the rope and every rate is per second.
 * `position` is signed: positive is ground held by p1, who sits at the bottom of the
 * horizontal split the manifest declares.
 */

export interface RopeState {
  /** Offset of the marker from the centre, positive toward p1, clamped to the win line. */
  position: number;
  p1Stamina: number;
  p2Stamina: number;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** How far from the centre the marker has to be dragged for that seat to win. */
export const WIN_DISTANCE = 380;

/**
 * The rope is marked off into ten equal takes per side and the tally counts the ones a
 * seat has taken, so the scoreboard reads in whole marks the players can see on the rope
 * rather than in a fractional distance that changes every step.
 */
export const MARKS_TO_WIN = 10;

export const MARK_SPACING = WIN_DISTANCE / MARKS_TO_WIN;

export const STAMINA_MAX = 1;

/** Ground one tap takes at full stamina. Identical for every seat, human or bot. */
export const PULL_STRENGTH = 26;

/** Stamina one tap costs, whatever that tap achieves. */
export const PULL_COST = 0.085;

/** Stamina returned per second, to both seats, whether they are pulling or not. */
export const RECOVER_RATE = 0.28;

/** Share of {@link PULL_STRENGTH} a tap still lands on a wholly empty reserve. */
export const EXHAUSTED_PULL = 0.12;

/** Rate the marker drifts back to the centre, so a lead has to be held, not just won. */
export const DECAY_RATE = 0.12;

/**
 * Taps per second a seat can keep up without ever draining, which is also the pace that
 * takes the most ground per second.
 *
 * Mashing above this empties the reserve, and an empty reserve pulls at
 * {@link EXHAUSTED_PULL}: mashing only catches a paced seat at this rate divided by that
 * share, some twenty-seven clean taps a second, which no hand delivers on any screen.
 * That is what keeps the match off whoever happens to have the more responsive device —
 * every device can pace.
 */
export const SUSTAINED_TAP_RATE = RECOVER_RATE / PULL_COST;

interface BotProfile {
  /** Mean taps per second. */
  readonly tapsPerSecond: number;
  /** Fraction the cadence wanders by each step, so a bot never taps like a metronome. */
  readonly jitter: number;
}

/**
 * Difficulty is cadence and consistency and nothing else. Every tier pulls with the same
 * {@link PULL_STRENGTH}, pays the same stamina, paces off the same threshold, and reads
 * only its own reserve — which is drawn on the board the player is looking at.
 *
 * No tier out-taps {@link SUSTAINED_TAP_RATE}, so a player who paces well always has
 * headroom over the hardest bot.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ tapsPerSecond: 1.8, jitter: 0.6 }),
  normal: Object.freeze({ tapsPerSecond: 2.6, jitter: 0.32 }),
  hard: Object.freeze({ tapsPerSecond: 3.0, jitter: 0.14 }),
});

/** Reserve a bot eases off below, and the share of its cadence it keeps while resting. */
const REST_BELOW = 0.35;
const REST_CADENCE = 0.15;

/**
 * Tally and condition for {@link winnerOf}, at module scope because the game asks who has
 * won from inside its fixed-step update, which may not allocate.
 */
const winTally = { p1: 0, p2: 0 };
const winCondition: WinCondition = { kind: 'first-to', target: MARKS_TO_WIN };

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function createState(): RopeState {
  return { position: 0, p1Stamina: STAMINA_MAX, p2Stamina: STAMINA_MAX };
}

export function staminaOf(state: Readonly<RopeState>, seat: SeatId): number {
  return seat === 'p1' ? state.p1Stamina : state.p2Stamina;
}

function setStamina(state: RopeState, seat: SeatId, value: number): void {
  const held = clamp(value, 0, STAMINA_MAX);
  if (seat === 'p1') state.p1Stamina = held;
  else state.p2Stamina = held;
}

/** What a tap is worth at a given reserve: full at rest, {@link EXHAUSTED_PULL} at empty. */
export function pullFactor(stamina: number): number {
  const share = clamp(stamina, 0, STAMINA_MAX) / STAMINA_MAX;
  return EXHAUSTED_PULL + (1 - EXHAUSTED_PULL) * share;
}

/**
 * One tap by one seat: drag the marker that seat's way and spend the reserve.
 *
 * Returns the ground the tap was worth, which the juice layer sizes its tug from. The
 * marker itself may have moved less, because it stops at the win line.
 */
export function pull(state: RopeState, seat: SeatId, strength: number): number {
  if (!Number.isFinite(strength) || strength <= 0) return 0;
  const effective = strength * pullFactor(staminaOf(state, seat));
  setStamina(state, seat, staminaOf(state, seat) - PULL_COST);
  const towards = seat === 'p1' ? effective : -effective;
  state.position = clamp(state.position + towards, -WIN_DISTANCE, WIN_DISTANCE);
  return effective;
}

/** Hand both seats their breath back. Neither reserve ever passes {@link STAMINA_MAX}. */
export function recover(state: RopeState, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const gain = RECOVER_RATE * dt;
  setStamina(state, 'p1', state.p1Stamina + gain);
  setStamina(state, 'p2', state.p2Stamina + gain);
}

/**
 * Let the marker slide back toward the centre.
 *
 * Exponential in dt rather than a fixed step off the position, so two steps of h and one
 * step of 2h land on identical numbers and a 144 Hz laptop plays the same match as a
 * 60 Hz phone. It also means the drift can never carry the marker past the centre.
 */
export function decay(state: RopeState, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  state.position *= Math.exp(-DECAY_RATE * dt);
}

/**
 * Whole marks of rope that seat currently holds, in [0, {@link MARKS_TO_WIN}].
 *
 * The innermost mark either side is dead ground: a marker that never left the middle of
 * the rope has taken nothing, which is what makes an untouched rope a draw on time
 * rather than a win for whichever seat nudged it last.
 */
export function marksHeld(
  state: Readonly<RopeState>,
  seat: SeatId,
  winDistance: number = WIN_DISTANCE,
): number {
  if (!Number.isFinite(winDistance) || winDistance <= 0) return 0;
  const held = seat === 'p1' ? state.position : -state.position;
  if (!(held > 0)) return 0;
  const marks = Math.floor((held / winDistance) * MARKS_TO_WIN);
  return marks > MARKS_TO_WIN ? MARKS_TO_WIN : marks;
}

/**
 * The seat that has dragged the marker the whole way to its line, or null.
 *
 * Decided by the SDK's resolve() over the same mark tally the game scores with, so the
 * rules and the scoreboard cannot drift apart.
 */
export function winnerOf(
  state: Readonly<RopeState>,
  winDistance: number = WIN_DISTANCE,
): SeatId | null {
  winTally.p1 = marksHeld(state, 'p1', winDistance);
  winTally.p2 = marksHeld(state, 'p2', winDistance);
  const outcome = resolve(winCondition, winTally);
  // The marker is a single scalar, so both seats can never hold marks at the same time
  // and resolve has no way to report a draw here.
  return outcome === 'draw' ? null : outcome;
}

/**
 * What a bot seat taps this step: {@link PULL_STRENGTH} on a tap, zero otherwise.
 *
 * The cadence is drawn per step rather than scheduled, so the bot has no timer of its
 * own to keep in sync and the whole decision is a function of the state and the seeded
 * generator. It reads its own reserve and nothing else — no opponent state, no marker
 * position, no privileged physics — and its taps are worth exactly what a player's are.
 */
export function botPull(
  state: Readonly<RopeState>,
  seat: SeatId,
  difficulty: BotDifficulty,
  rng: Rng,
  dt: number,
): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  const profile = BOT_PROFILES[difficulty];
  let rate = profile.tapsPerSecond * (1 + (rng.float() * 2 - 1) * profile.jitter);
  if (staminaOf(state, seat) < REST_BELOW) rate *= REST_CADENCE;
  return rng.bool(rate * dt) ? PULL_STRENGTH : 0;
}
