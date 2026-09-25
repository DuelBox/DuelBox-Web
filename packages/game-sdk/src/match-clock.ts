import { isSimulating, type MatchPhase } from './match.js';

/**
 * The round/match clock every timed game shares.
 *
 * `roundSeconds` has sat in every manifest since the schema was written and ended nothing —
 * the only reader was a catalogue card printing "about 5 min", and two games shipped unable
 * to finish because of it (HANDOFF). This is the clock those games were missing.
 *
 * It is a value, advanced by the host from the same fixed delta that drives the simulation,
 * so a phone and a laptop count the identical match (CLAUDE.md rule 8). It never reads a
 * wall clock and allocates only on an advance that actually moves — a paused clock returns
 * its own reference, exactly as {@link reduce} does, so a caller can tell nothing happened
 * without a deep compare.
 *
 * **It advances only while the match is playing.** The host's `onTick` fires in the
 * countdown too, so the clock asks {@link isSimulating} rather than trusting that every tick
 * is a played second: a count-in must not burn the round's time, and a pause must not either.
 * That is the whole of "pausing does not consume time" — there is no separate timer to keep
 * in step, because the clock *is* the step count.
 */

export interface MatchClock {
  /** Seconds simulated while the match was playing. Counts up from zero. */
  readonly elapsed: number;
  /**
   * The round's time limit in seconds, or null for a clock that only counts up.
   *
   * Null is the default and the inert state: a game that declares no limit gets a
   * stopwatch that never expires and never ends a round, so wiring the clock into the
   * shell cannot end a match the game did not ask to be timed.
   */
  readonly limit: number | null;
  /**
   * Seconds-of-remaining at which {@link clockWarning} starts returning true, or null for
   * no warning. Only meaningful alongside a `limit`.
   */
  readonly warnAt: number | null;
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number, received ${String(value)}`);
  }
}

/**
 * A fresh clock. With no limit it is a stopwatch; with one it counts a round down.
 *
 * `warnSeconds` is the remaining-time threshold for the near-expiry warning the HUD shows
 * and #149 asks for; it is ignored without a limit, because there is nothing to be near the
 * end of.
 */
export function createClock(limitSeconds?: number | null, warnSeconds?: number): MatchClock {
  const limit = limitSeconds ?? null;
  if (limit !== null) assertNonNegative(limit, 'limitSeconds');
  let warnAt: number | null = null;
  if (limit !== null && warnSeconds !== undefined) {
    assertNonNegative(warnSeconds, 'warnSeconds');
    // A warning threshold past the whole limit would fire from the first second, which is
    // not a warning; clamped so it can never exceed the time there is.
    warnAt = Math.min(warnSeconds, limit);
  }
  return { elapsed: 0, limit, warnAt };
}

/**
 * Advance the clock by one fixed step, but only if the match is playing.
 *
 * Returns the same reference when the phase is not `playing`, so a countdown or a pause
 * moves nothing — the property the "advances only while playing" test rests on.
 */
export function advanceClock(
  clock: MatchClock,
  phase: MatchPhase,
  deltaSeconds: number,
): MatchClock {
  if (!isSimulating(phase)) return clock;
  assertNonNegative(deltaSeconds, 'deltaSeconds');
  if (deltaSeconds === 0) return clock;
  return { ...clock, elapsed: clock.elapsed + deltaSeconds };
}

/** Seconds simulated so far, counting up. */
export function clockElapsed(clock: MatchClock): number {
  return clock.elapsed;
}

/**
 * Seconds left before the limit, clamped at zero, or null for a limitless clock.
 *
 * Clamped rather than left negative so a long final step cannot show the HUD a time below
 * zero; the overshoot is dropped, as the countdown drops its own.
 */
export function clockRemaining(clock: MatchClock): number | null {
  if (clock.limit === null) return null;
  return Math.max(0, clock.limit - clock.elapsed);
}

/** Whether a limited clock has run out. Always false for a limitless one. */
export function clockExpired(clock: MatchClock): boolean {
  return clock.limit !== null && clock.elapsed >= clock.limit;
}

/**
 * Whether the clock is inside its warning band and not yet expired.
 *
 * The near-expiry cue is drawn on this rather than on a raw time so a game or the HUD never
 * has to reimplement "when is it nearly over"; false once expired, because the warning is
 * over too.
 */
export function clockWarning(clock: MatchClock): boolean {
  if (clock.limit === null || clock.warnAt === null) return false;
  if (clockExpired(clock)) return false;
  const remaining = clockRemaining(clock);
  return remaining !== null && remaining <= clock.warnAt;
}

/** A clock back at zero, keeping its limit and warning threshold. For a rematch or a new round. */
export function resetClock(clock: MatchClock): MatchClock {
  if (clock.elapsed === 0) return clock;
  return { ...clock, elapsed: 0 };
}

/**
 * `m:ss` for the HUD, from a whole or fractional number of seconds.
 *
 * Ceiling, so a clock reading 0.4s left still shows "0:01" until the second it truly ends —
 * a display that reaches 0:00 while the round is still live reads as a stopped clock.
 */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes)}:${rest < 10 ? '0' : ''}${String(rest)}`;
}
