/**
 * Input-to-simulation latency, measured rather than assumed (#133).
 *
 * A reaction game is unfair if one input path reaches the simulation slower than another, and
 * `docs/input-parity.md` can only rule on that if it is a number. This is the meter that
 * produces the number: the shell timestamps a DOM event as it arrives and timestamps the step
 * that first consumes the latched input, and the gap between them is the latency that family
 * paid on that press.
 *
 * ## Why the wall clock is injected
 *
 * Latency is a wall-clock quantity — the whole point is the milliseconds between a real event
 * and the step that reads it — but reading `performance.now()` here would violate the same
 * lint rule the whole engine lives under. So the shell passes the timestamps in (from
 * `performance.now()`, beside `browserClock`), exactly as it passes the frame delta into the
 * loop. This keeps the arithmetic testable with plain numbers and the engine free of the
 * device. It never feeds the simulation: a measurement that changed the step would make two
 * devices disagree about the match (rule 8), so nothing here is read by any `update`.
 *
 * ## The measure
 *
 * For each family, {@link markEvent} keeps the *earliest* un-consumed event time — the press
 * that has been waiting longest — and {@link consume}, called once per step with that step's
 * start time, records `stepStart - eventTime` and clears it. So a burst of three keydowns
 * between two steps reports one sample, the latency the first of them paid, which is the
 * worst case and the honest one.
 *
 * Allocation-free after construction: the stats are running totals mutated in place.
 */

export type InputFamily = 'keyboard' | 'pointer' | 'gamepad';

export const INPUT_FAMILIES: readonly InputFamily[] = ['keyboard', 'pointer', 'gamepad'];

/** A read-out of one family's latency so far, in milliseconds. */
export interface LatencyStats {
  /** How many events have been measured. */
  readonly samples: number;
  /** Mean event-to-step latency. 0 when there are no samples. */
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  /** The most recent sample, for a live read-out. */
  readonly lastMs: number;
}

interface RunningStats {
  samples: number;
  sumMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
  /** The earliest event time not yet consumed by a step, or -1 for none pending. */
  pendingMs: number;
}

function createStats(): RunningStats {
  return { samples: 0, sumMs: 0, minMs: 0, maxMs: 0, lastMs: 0, pendingMs: -1 };
}

const EMPTY: LatencyStats = { samples: 0, meanMs: 0, minMs: 0, maxMs: 0, lastMs: 0 };

export class LatencyMeter {
  readonly #byFamily: Record<InputFamily, RunningStats> = {
    keyboard: createStats(),
    pointer: createStats(),
    gamepad: createStats(),
  };

  /**
   * Record that an input of `family` arrived at `atMs` (a `performance.now()` reading).
   *
   * Keeps the earliest pending time, so a step consuming several events of one family
   * attributes the latency of the one that waited longest.
   */
  markEvent(family: InputFamily, atMs: number): void {
    if (!Number.isFinite(atMs)) return;
    const stats = this.#byFamily[family];
    if (stats.pendingMs < 0 || atMs < stats.pendingMs) stats.pendingMs = atMs;
  }

  /**
   * Close the window: for every family with a pending event, record how long it waited for
   * this step. Call once per step, with the wall-clock time the step began consuming input.
   */
  consume(stepStartMs: number): void {
    if (!Number.isFinite(stepStartMs)) return;
    for (const family of INPUT_FAMILIES) {
      const stats = this.#byFamily[family];
      if (stats.pendingMs < 0) continue;
      let latency = stepStartMs - stats.pendingMs;
      // A clock quirk (or an event timestamped slightly after the step read) cannot make an
      // input arrive before it happened; floor at zero rather than record a negative latency.
      if (latency < 0) latency = 0;
      stats.samples += 1;
      stats.sumMs += latency;
      stats.lastMs = latency;
      if (stats.samples === 1) {
        stats.minMs = latency;
        stats.maxMs = latency;
      } else {
        if (latency < stats.minMs) stats.minMs = latency;
        if (latency > stats.maxMs) stats.maxMs = latency;
      }
      stats.pendingMs = -1;
    }
  }

  /** The latency read-out for one family. */
  stats(family: InputFamily): LatencyStats {
    const s = this.#byFamily[family];
    if (s.samples === 0) return EMPTY;
    return {
      samples: s.samples,
      meanMs: s.sumMs / s.samples,
      minMs: s.minMs,
      maxMs: s.maxMs,
      lastMs: s.lastMs,
    };
  }

  /** Whether any family has an event still waiting for a step to consume it. */
  get hasPending(): boolean {
    for (const family of INPUT_FAMILIES) {
      if (this.#byFamily[family].pendingMs >= 0) return true;
    }
    return false;
  }

  /** Forget every sample and pending event — a fresh match, a new baseline run. */
  reset(): void {
    for (const family of INPUT_FAMILIES) {
      const s = this.#byFamily[family];
      s.samples = 0;
      s.sumMs = 0;
      s.minMs = 0;
      s.maxMs = 0;
      s.lastMs = 0;
      s.pendingMs = -1;
    }
  }
}
