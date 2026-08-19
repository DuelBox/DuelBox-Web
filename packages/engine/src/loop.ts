/**
 * Fixed-timestep simulation loop.
 *
 * Simulation advances in whole steps of a constant duration so that a match plays
 * identically on a 60 Hz phone and a 144 Hz laptop; rendering interpolates between
 * the last two steps using `alpha`.
 */

const DEFAULT_STEPS_PER_SECOND = 60;
const DEFAULT_MAX_STEPS_PER_FRAME = 5;

/** Largest double strictly below 1 — alpha is contracted to [0, 1). */
const ALPHA_MAX = 0.9999999999999999;

/** Longest single frame RunLoop will hand to the simulation, in seconds. */
const MAX_FRAME_SECONDS = 0.25;

export interface LoopCallbacks {
  update(fixedDeltaSeconds: number): void;
  render(alpha: number): void;
}

export interface LoopOptions {
  stepsPerSecond?: number;
  maxStepsPerFrame?: number;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, received ${String(value)}`);
  }
}

export class FixedLoop {
  /** Duration of one simulation step, in seconds. */
  readonly stepSeconds: number;

  readonly #callbacks: LoopCallbacks;
  readonly #maxStepsPerFrame: number;
  /** Unsimulated time carried between frames, in seconds; always < stepSeconds on exit. */
  #accumulator = 0;
  #totalSteps = 0;
  /** Set between steps to abandon the rest of the current frame's step budget. */
  #stopRequested = false;

  constructor(callbacks: LoopCallbacks, options?: LoopOptions) {
    const stepsPerSecond = options?.stepsPerSecond ?? DEFAULT_STEPS_PER_SECOND;
    const maxStepsPerFrame = options?.maxStepsPerFrame ?? DEFAULT_MAX_STEPS_PER_FRAME;
    assertPositiveFinite(stepsPerSecond, 'stepsPerSecond');
    assertPositiveFinite(maxStepsPerFrame, 'maxStepsPerFrame');
    this.#callbacks = callbacks;
    this.#maxStepsPerFrame = maxStepsPerFrame;
    this.stepSeconds = 1 / stepsPerSecond;
  }

  /** Total update() calls since construction or the last reset(). */
  get totalSteps(): number {
    return this.#totalSteps;
  }

  /** True while a stop has been requested and not yet cleared. */
  get stopRequested(): boolean {
    return this.#stopRequested;
  }

  /**
   * Abandon the rest of this frame's step budget, checked between steps.
   *
   * A game that ends a match inside update() must not have further steps run against
   * the finished state: those would move bodies after the winning goal, and in a
   * cross-device match the two clients could disagree on how many ran. Carried time is
   * kept, so resuming continues from the same point rather than losing a fraction of a step.
   */
  requestStop(): void {
    this.#stopRequested = true;
  }

  /** Clear a pending stop so the loop can run again. */
  clearStopRequest(): void {
    this.#stopRequested = false;
  }

  /**
   * Consume one frame of wall-clock time: run whole simulation steps, then render.
   * Pure with respect to time — the caller supplies the delta, so this is the
   * testable core. Allocates nothing.
   */
  advance(frameDeltaSeconds: number): void {
    let delta = frameDeltaSeconds;
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    this.#accumulator += delta;

    let stepsThisFrame = 0;
    while (
      !this.#stopRequested &&
      this.#accumulator >= this.stepSeconds &&
      stepsThisFrame < this.#maxStepsPerFrame
    ) {
      this.#accumulator -= this.stepSeconds;
      stepsThisFrame += 1;
      this.#totalSteps += 1;
      this.#callbacks.update(this.stepSeconds);
    }

    // A stop leaves carried time intact, so the guard below must not treat it as a hitch.
    if (!this.#stopRequested && this.#accumulator >= this.stepSeconds) {
      // Spiral-of-death guard. A frame that owes more than maxStepsPerFrame steps has
      // its unprocessed remainder discarded rather than carried forward. The trade-off
      // is deliberate: simulation time falls behind wall-clock time during a hitch (the
      // match briefly runs in slow motion) instead of every frame owing more steps than
      // the last until the tab locks up. Time is only ever dropped, never invented, so
      // both devices in a cross-device match stay on whole-step boundaries.
      this.#accumulator = 0;
    }

    let alpha = this.#accumulator / this.stepSeconds;
    if (alpha < 0) alpha = 0;
    else if (alpha > ALPHA_MAX) alpha = ALPHA_MAX;
    this.#callbacks.render(alpha);
  }

  /** Drop carried time and the step count. Used on match start and on resume. */
  reset(): void {
    this.#accumulator = 0;
    this.#totalSteps = 0;
    this.#stopRequested = false;
  }
}

export interface Clock {
  /** Monotonic time in milliseconds. */
  now(): number;
  /** Run `callback` on the next frame; returns a handle for cancel(). */
  schedule(callback: (timeMs: number) => void): number;
  cancel(handle: number): void;
}

export function browserClock(): Clock {
  const scope = globalThis;
  if (typeof scope.performance === 'undefined' || typeof scope.performance.now !== 'function') {
    throw new Error('browserClock requires performance.now(); none is available in this runtime');
  }
  if (
    typeof scope.requestAnimationFrame !== 'function' ||
    typeof scope.cancelAnimationFrame !== 'function'
  ) {
    throw new Error(
      'browserClock requires requestAnimationFrame/cancelAnimationFrame; none are available in this runtime',
    );
  }
  // Bound once: these throw if invoked detached from their global.
  const nowMs = scope.performance.now.bind(scope.performance);
  const requestFrame = scope.requestAnimationFrame.bind(scope);
  const cancelFrame = scope.cancelAnimationFrame.bind(scope);
  return {
    now(): number {
      return nowMs();
    },
    schedule(callback: (timeMs: number) => void): number {
      return requestFrame(callback);
    },
    cancel(handle: number): void {
      cancelFrame(handle);
    },
  };
}

/** Drives a FixedLoop from a Clock. Owns all wall-clock concerns. */
export class RunLoop {
  readonly #loop: FixedLoop;
  readonly #clock: Clock;
  #running = false;
  #handle = 0;
  #lastTimeMs = 0;

  readonly #tick = (timeMs: number): void => {
    if (!this.#running) return;
    let delta = (timeMs - this.#lastTimeMs) / 1000;
    this.#lastTimeMs = timeMs;
    if (!Number.isFinite(delta) || delta < 0) {
      delta = 0;
    } else if (delta > MAX_FRAME_SECONDS) {
      // A backgrounded tab returns with a gap of many seconds; clamp it so the match
      // does not fast-forward through the time it spent hidden.
      delta = MAX_FRAME_SECONDS;
    }
    this.#loop.advance(delta);
    // Re-checked because update() or render() may have called stop(). Flow analysis
    // cannot see through the callback, hence the disable rather than a redundant guard.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.#running) this.#handle = this.#clock.schedule(this.#tick);
  };

  constructor(loop: FixedLoop, clock: Clock) {
    this.#loop = loop;
    this.#clock = clock;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) return;
    this.#loop.clearStopRequest();
    this.#running = true;
    this.#lastTimeMs = this.#clock.now();
    this.#handle = this.#clock.schedule(this.#tick);
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    // Takes effect between steps, so stopping from inside update() does not leave the
    // rest of this frame's budget to run against an already-finished match.
    this.#loop.requestStop();
    this.#clock.cancel(this.#handle);
    this.#handle = 0;
  }
}
