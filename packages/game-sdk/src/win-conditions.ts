import type { SeatId } from '@duelbox/engine';

/**
 * The win conditions observed across the whole catalog. Games declare which one applies
 * rather than writing their own comparison, so "first to seven" means the same thing in
 * every game and draws are never left undefined.
 */

export type WinCondition =
  /** First seat to reach `target` points. */
  | { readonly kind: 'first-to'; readonly target: number }
  /** First seat to lead by `margin`, with an optional floor before the lead counts. */
  | { readonly kind: 'lead-by'; readonly margin: number; readonly minimum?: number }
  /** Highest score when the clock expires. */
  | { readonly kind: 'highest-when-time-expires' }
  /** First seat to reduce the other's health to zero. */
  | { readonly kind: 'reduce-to-zero' }
  /** Last seat still alive. */
  | { readonly kind: 'last-standing' };

export type Outcome = SeatId | 'draw' | null;

export interface Tally {
  readonly p1: number;
  readonly p2: number;
}

/**
 * The fallback for an absent `eliminated` list.
 *
 * `?? []` here built a throwaway array on *every* call, and a real-time game that judges
 * its match every step calls this every step — 60 dead arrays a second per match, which is
 * exactly what rule 5 forbids. Hoisted and frozen so every call shares one object and
 * nobody can mutate the shared instance. Games should not have to work around the SDK by
 * judging only on steps that can decide the match.
 */
const NO_ELIMINATIONS: readonly SeatId[] = Object.freeze([]);

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, received ${String(value)}`);
  }
}

/**
 * Decide the outcome of a match, or null while it is still running.
 *
 * `timeExpired` and `eliminated` are only consulted by the conditions that need them, so
 * a caller may pass defaults for the rest.
 */
export function resolve(
  condition: WinCondition,
  tally: Tally,
  options?: { readonly timeExpired?: boolean; readonly eliminated?: readonly SeatId[] },
): Outcome {
  assertFinite(tally.p1, 'tally.p1');
  assertFinite(tally.p2, 'tally.p2');
  const timeExpired = options?.timeExpired ?? false;
  const eliminated = options?.eliminated ?? NO_ELIMINATIONS;

  switch (condition.kind) {
    case 'first-to': {
      if (condition.target <= 0) throw new RangeError('first-to target must be positive');
      const p1Reached = tally.p1 >= condition.target;
      const p2Reached = tally.p2 >= condition.target;
      // Both can cross in the same step in a simultaneous-action game; that is a draw,
      // not a win for whichever seat the code happened to check first.
      if (p1Reached && p2Reached) return tally.p1 === tally.p2 ? 'draw' : higher(tally);
      if (p1Reached) return 'p1';
      if (p2Reached) return 'p2';
      return timeExpired ? settleOnTime(tally) : null;
    }

    case 'lead-by': {
      if (condition.margin <= 0) throw new RangeError('lead-by margin must be positive');
      const minimum = condition.minimum ?? 0;
      const lead = tally.p1 - tally.p2;
      const bothPastFloor = tally.p1 >= minimum || tally.p2 >= minimum;
      if (bothPastFloor && lead >= condition.margin) return 'p1';
      if (bothPastFloor && -lead >= condition.margin) return 'p2';
      return timeExpired ? settleOnTime(tally) : null;
    }

    case 'highest-when-time-expires':
      return timeExpired ? settleOnTime(tally) : null;

    case 'reduce-to-zero': {
      // Health is carried in the tally: a seat at or below zero has lost.
      const p1Dead = tally.p1 <= 0;
      const p2Dead = tally.p2 <= 0;
      if (p1Dead && p2Dead) return 'draw';
      if (p1Dead) return 'p2';
      if (p2Dead) return 'p1';
      return timeExpired ? settleOnTime(tally) : null;
    }

    case 'last-standing': {
      const p1Out = eliminated.includes('p1');
      const p2Out = eliminated.includes('p2');
      if (p1Out && p2Out) return 'draw';
      if (p1Out) return 'p2';
      if (p2Out) return 'p1';
      return timeExpired ? settleOnTime(tally) : null;
    }
  }
}

function higher(tally: Tally): SeatId {
  return tally.p1 > tally.p2 ? 'p1' : 'p2';
}

function settleOnTime(tally: Tally): Outcome {
  if (tally.p1 === tally.p2) return 'draw';
  return higher(tally);
}

/**
 * Resolve two inputs that landed in the same step.
 *
 * Reaction games are decided in tens of milliseconds and the two seats may be on
 * different devices, so ordering by arrival would hand the win to whoever had the better
 * connection. Times are compared at the source, and anything inside the measurement
 * tolerance is a genuine draw rather than an arbitrary pick.
 */
export function resolveSimultaneous(
  p1TimeSeconds: number,
  p2TimeSeconds: number,
  toleranceSeconds = 0.008,
): Outcome {
  assertFinite(p1TimeSeconds, 'p1TimeSeconds');
  assertFinite(p2TimeSeconds, 'p2TimeSeconds');
  if (toleranceSeconds < 0) throw new RangeError('toleranceSeconds must not be negative');
  const gap = p1TimeSeconds - p2TimeSeconds;
  if (Math.abs(gap) <= toleranceSeconds) return 'draw';
  return gap < 0 ? 'p1' : 'p2';
}
