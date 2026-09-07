/**
 * Tween and easing library, driven by the fixed simulation step.
 *
 * Both UI juice and in-game presentation want to interpolate a value from one
 * number to another over a short span of time. Two competing implementations is
 * one too many, so every animation in the product runs through here.
 *
 * Everything is deterministic: a tween is advanced by the same fixed delta the
 * loop hands every other system, never by a wall clock, so two devices stepping
 * the same match interpolate through the same numbers on the same steps. Nothing
 * here reads `Date`, `performance`, or any timer.
 *
 * A running tween allocates nothing: the config is captured once at construction
 * and `step()` only moves a cursor. Reduced motion resolves a tween to its end
 * value immediately (see {@link Tween.settle} and the `reducedMotion` option), so
 * a player who has asked for stillness sees the settled state and never the sweep.
 *
 * These interpolate presentation values — a flash's opacity, a HUD number sliding
 * into place. They are not the place for simulation state: a value the match
 * depends on is stepped by the game itself, on the fixed timestep, so both devices
 * agree. A tween is a picture.
 */

/** Maps normalised time `t` in [0, 1] to eased progress in [0, 1]. Endpoints are fixed: ease(0) === 0, ease(1) === 1. */
export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;

export const quadIn: Easing = (t) => t * t;
export const quadOut: Easing = (t) => t * (2 - t);
export const quadInOut: Easing = (t) =>
  t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2;

export const cubicIn: Easing = (t) => t * t * t;
export const cubicOut: Easing = (t) => {
  const u = 1 - t;
  return 1 - u * u * u;
};
export const cubicInOut: Easing = (t) => {
  if (t < 0.5) return 4 * t * t * t;
  const u = -2 * t + 2;
  return 1 - (u * u * u) / 2;
};

export const quartIn: Easing = (t) => t * t * t * t;
export const quartOut: Easing = (t) => {
  const u = 1 - t;
  return 1 - u * u * u * u;
};
export const quartInOut: Easing = (t) => {
  if (t < 0.5) return 8 * t * t * t * t;
  const u = -2 * t + 2;
  return 1 - (u * u * u * u) / 2;
};

/** Zero first and second derivative at both ends: no kick starting or stopping. Same curve the seat flip uses. */
export const smootherstep: Easing = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** The standard set, keyed by name, for a config that names its curve as data. */
export const EASINGS = {
  linear,
  quadIn,
  quadOut,
  quadInOut,
  cubicIn,
  cubicOut,
  cubicInOut,
  quartIn,
  quartOut,
  quartInOut,
  smootherstep,
} as const;

export type EasingName = keyof typeof EASINGS;

export interface TweenOptions {
  readonly from: number;
  readonly to: number;
  /** Seconds the tween takes. Zero settles on the first step. */
  readonly durationSeconds: number;
  /** Defaults to {@link linear}. */
  readonly easing?: Easing;
  /** When true the tween is born already settled at `to`; reduced-motion callers pass this. */
  readonly reducedMotion?: boolean;
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number, received ${String(value)}`);
  }
}

/**
 * A single scalar interpolation from `from` to `to`.
 *
 * `step(dt)` advances it; `value` reads the current number; `done` reports whether
 * it has arrived. Cancelling freezes the value where it stands — a consistent state
 * a caller can keep reading — and marks it done so a driver stops advancing it.
 */
export class Tween {
  readonly #from: number;
  readonly #to: number;
  readonly #durationSeconds: number;
  readonly #easing: Easing;

  #elapsed = 0;
  #value: number;
  #done: boolean;
  #cancelled = false;

  constructor(options: TweenOptions) {
    assertNonNegativeFinite(options.durationSeconds, 'durationSeconds');
    if (!Number.isFinite(options.from) || !Number.isFinite(options.to)) {
      throw new RangeError('Tween from/to must be finite numbers');
    }
    this.#from = options.from;
    this.#to = options.to;
    this.#durationSeconds = options.durationSeconds;
    this.#easing = options.easing ?? linear;
    if (options.reducedMotion === true || options.durationSeconds === 0) {
      this.#value = options.to;
      this.#done = true;
    } else {
      this.#value = options.from;
      this.#done = false;
    }
  }

  /** The end value, whatever the current progress. */
  get finalValue(): number {
    return this.#to;
  }

  get value(): number {
    return this.#value;
  }

  /** True once the tween has reached its end, or has been cancelled. */
  get done(): boolean {
    return this.#done;
  }

  /** True only if {@link Tween.cancel} was called; distinguishes a stop from a natural finish. */
  get cancelled(): boolean {
    return this.#cancelled;
  }

  /** Normalised progress in [0, 1] before easing. 1 once done. */
  get progress(): number {
    if (this.#done) return 1;
    if (this.#durationSeconds === 0) return 1;
    const p = this.#elapsed / this.#durationSeconds;
    return p > 1 ? 1 : p;
  }

  /** Advance by one fixed step. A finished or cancelled tween ignores further steps. Allocates nothing. */
  step(fixedDeltaSeconds: number): void {
    assertNonNegativeFinite(fixedDeltaSeconds, 'fixedDeltaSeconds');
    if (this.#done) return;
    this.#elapsed += fixedDeltaSeconds;
    if (this.#elapsed >= this.#durationSeconds) {
      this.#value = this.#to;
      this.#done = true;
      return;
    }
    const t = this.#easing(this.#elapsed / this.#durationSeconds);
    this.#value = this.#from + (this.#to - this.#from) * t;
  }

  /** Jump to the end value now. Used for reduced motion and for skipping an animation. */
  settle(): void {
    this.#value = this.#to;
    this.#done = true;
  }

  /**
   * Stop where it stands. The value is left exactly as it is — a consistent,
   * readable state — and `done` becomes true so a driver stops advancing it.
   */
  cancel(): void {
    this.#done = true;
    this.#cancelled = true;
  }

  /** Return to the start, ready to run again. Clears a cancel. */
  reset(): void {
    this.#elapsed = 0;
    this.#value = this.#from;
    this.#done = this.#durationSeconds === 0;
    if (this.#done) this.#value = this.#to;
    this.#cancelled = false;
  }
}

/** One entry in a {@link TweenSequence}: a tween segment, or a hold that keeps the value still. */
export type SequenceStep =
  | {
      readonly kind: 'to';
      readonly to: number;
      readonly durationSeconds: number;
      readonly easing?: Easing;
    }
  | { readonly kind: 'delay'; readonly durationSeconds: number };

export interface TweenSequenceOptions {
  /** The value the sequence holds before its first segment runs. */
  readonly from: number;
  readonly steps: readonly SequenceStep[];
  readonly reducedMotion?: boolean;
}

interface CompiledSegment {
  readonly isDelay: boolean;
  readonly from: number;
  readonly to: number;
  readonly durationSeconds: number;
  readonly easing: Easing;
}

/**
 * A chain of tween segments and delays over a single scalar.
 *
 * Built once from a data description, then advanced with {@link TweenSequence.step}.
 * The segment list is allocated in the constructor; stepping only moves a cursor and
 * touches no heap, so a sequence is safe to advance every frame.
 *
 * Cancelling freezes the current value and stops the chain. Reduced motion resolves
 * the whole chain to its final value at once.
 */
export class TweenSequence {
  readonly #segments: CompiledSegment[];
  /** Total duration of every segment, precomputed so `progress`/`settle` need no walk. */
  readonly #totalSeconds: number;
  readonly #finalValue: number;

  #index = 0;
  #elapsedInSegment = 0;
  #value: number;
  #done: boolean;
  #cancelled = false;

  constructor(options: TweenSequenceOptions) {
    if (!Number.isFinite(options.from)) {
      throw new RangeError('TweenSequence from must be a finite number');
    }
    const segments: CompiledSegment[] = [];
    let cursor = options.from;
    let total = 0;
    for (const step of options.steps) {
      assertNonNegativeFinite(step.durationSeconds, 'step.durationSeconds');
      if (step.kind === 'delay') {
        segments.push({
          isDelay: true,
          from: cursor,
          to: cursor,
          durationSeconds: step.durationSeconds,
          easing: linear,
        });
      } else {
        if (!Number.isFinite(step.to)) {
          throw new RangeError('TweenSequence step.to must be a finite number');
        }
        segments.push({
          isDelay: false,
          from: cursor,
          to: step.to,
          durationSeconds: step.durationSeconds,
          easing: step.easing ?? linear,
        });
        cursor = step.to;
      }
      total += step.durationSeconds;
    }
    this.#segments = segments;
    this.#totalSeconds = total;
    this.#finalValue = cursor;
    this.#value = options.from;
    this.#done = segments.length === 0;

    if (options.reducedMotion === true) {
      this.settle();
    } else {
      // Zero-duration leading segments resolve on construction so the first read is honest.
      this.#skipCompletedSegments();
    }
  }

  get value(): number {
    return this.#value;
  }

  get done(): boolean {
    return this.#done;
  }

  get cancelled(): boolean {
    return this.#cancelled;
  }

  get finalValue(): number {
    return this.#finalValue;
  }

  get durationSeconds(): number {
    return this.#totalSeconds;
  }

  /** Index of the segment currently running; equal to the segment count once done. */
  get segmentIndex(): number {
    return this.#index;
  }

  /** Advance the whole chain by one fixed step. Allocates nothing. */
  step(fixedDeltaSeconds: number): void {
    assertNonNegativeFinite(fixedDeltaSeconds, 'fixedDeltaSeconds');
    if (this.#done) return;
    let remaining = fixedDeltaSeconds;
    // A single frame can spill across more than one short segment; drain it whole.
    while (remaining > 0 && this.#index < this.#segments.length) {
      const seg = this.#segments[this.#index]!;
      const left = seg.durationSeconds - this.#elapsedInSegment;
      if (remaining >= left) {
        remaining -= left;
        this.#value = seg.to;
        this.#index += 1;
        this.#elapsedInSegment = 0;
      } else {
        this.#elapsedInSegment += remaining;
        remaining = 0;
        this.#applyCurrent(seg);
      }
    }
    if (this.#index >= this.#segments.length) {
      this.#value = this.#finalValue;
      this.#done = true;
    }
  }

  /** Resolve the whole chain to its final value now. */
  settle(): void {
    this.#index = this.#segments.length;
    this.#elapsedInSegment = 0;
    this.#value = this.#finalValue;
    this.#done = true;
  }

  /** Freeze the value where it stands and stop the chain. */
  cancel(): void {
    this.#done = true;
    this.#cancelled = true;
  }

  /** Return to the start, ready to run again. Clears a cancel. */
  reset(): void {
    this.#index = 0;
    this.#elapsedInSegment = 0;
    this.#done = this.#segments.length === 0;
    this.#cancelled = false;
    this.#value = this.#segments.length === 0 ? this.#finalValue : this.#segments[0]!.from;
    this.#skipCompletedSegments();
  }

  #applyCurrent(seg: CompiledSegment): void {
    if (seg.isDelay || seg.durationSeconds === 0) {
      this.#value = seg.to;
      return;
    }
    const t = seg.easing(this.#elapsedInSegment / seg.durationSeconds);
    this.#value = seg.from + (seg.to - seg.from) * t;
  }

  #skipCompletedSegments(): void {
    while (
      this.#index < this.#segments.length &&
      this.#segments[this.#index]!.durationSeconds === 0
    ) {
      this.#value = this.#segments[this.#index]!.to;
      this.#index += 1;
    }
    if (this.#index >= this.#segments.length) {
      this.#value = this.#finalValue;
      this.#done = true;
    }
  }
}
