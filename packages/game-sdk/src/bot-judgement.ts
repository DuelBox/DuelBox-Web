/**
 * A judgement a bot commits to, and the reaction time it takes to make one.
 *
 * **This exists because the same bug has been written three times.** Road Dodge, Crabby
 * Volley and King of the Yard each shipped a first draft whose difficulty tiers did
 * nothing, and each for the same reason: the bot drew a fresh random error on every step.
 * A fresh error sixty times a second **averages to zero**, so the bot hovered on exactly
 * the right answer however large its supposed inaccuracy, and every tier played the same.
 *
 * The measurements are worth keeping, because they are what the argument rests on:
 *
 * - Road Dodge swept its per-step mistake rate from 0 to 0.5 and survival moved by 0.00s.
 * - Crabby Volley swept every bot lever against a fixed opponent and got noise between
 *   33% and 67%, with the baseline scoring 58% against *itself*.
 * - King of the Yard's tiers were indistinguishable until the heading was held.
 *
 * A person misjudges something and then **acts on that misjudgement** until the situation
 * changes. They also take a moment to notice that it has. Those two facts are all this is,
 * and having them in one place means the next game gets them for free rather than
 * rediscovering them by measurement.
 *
 * Nothing here reads a clock or allocates: it is driven by the fixed delta like the rest
 * of the simulation, so a replay is exact.
 */

/** A judgement held between decisions. */
export interface Judgement {
  /** Seconds until it looks again. */
  remaining: number;
  /** Whatever the game last decided. Games store their own shape here. */
  value: number;
  /** True once a first decision has been made, so `value` is meaningful. */
  decided: boolean;
}

export function createJudgement(): Judgement {
  return { remaining: 0, value: 0, decided: false };
}

export function resetJudgement(judgement: Judgement): void {
  judgement.remaining = 0;
  judgement.value = 0;
  judgement.decided = false;
}

/**
 * Advance a judgement, and say whether it is time to make a new one.
 *
 * Call once per step. When it returns true the caller decides afresh and stores the answer
 * with {@link commit}; when it returns false the caller uses what it already had.
 *
 * The reaction time is given to {@link commit}, not to this, because it is a floor on how
 * often the bot may *think* rather than a delay before it acts: a bot that has already
 * decided keeps acting on that decision the whole time.
 */
export function shouldDecide(judgement: Judgement, fixedDeltaSeconds: number): boolean {
  if (!judgement.decided) return true;
  judgement.remaining -= fixedDeltaSeconds;
  if (judgement.remaining > 0) return false;
  // Clamped at zero rather than left negative, so a long step cannot bank credit towards
  // the next decision and let a slow bot react twice in quick succession.
  judgement.remaining = 0;
  return true;
}

/** Store a decision, and start the clock until the next one. */
export function commit(judgement: Judgement, value: number, reactionSeconds: number): number {
  judgement.value = value;
  judgement.decided = true;
  judgement.remaining = Math.max(0, reactionSeconds);
  return value;
}

/**
 * Force a fresh decision on the next step, whatever the reaction time says.
 *
 * For the moments a person would obviously look again — a new rally, a new approach, a
 * ball that has changed direction. Without it a bot with a long reaction time keeps acting
 * on a judgement about a situation that no longer exists.
 */
export function invalidate(judgement: Judgement): void {
  judgement.decided = false;
  judgement.remaining = 0;
}

/**
 * A symmetric error drawn once and held, in the caller's own units.
 *
 * `roll` is a seeded value in [0, 1). Never call this per step with a fresh roll — that is
 * the whole mistake this file exists to prevent.
 */
export function misjudgement(roll: number, spread: number): number {
  return (roll - 0.5) * 2 * spread;
}
