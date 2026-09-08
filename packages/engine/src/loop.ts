/**
 * Fixed-timestep simulation loop.
 *
 * Simulation advances in whole steps of a constant duration so that a match plays
 * identically on a 60 Hz phone and a 144 Hz laptop; rendering interpolates between
 * the last two steps using `alpha`.
 */

import type { GamepadSnapshot } from './gamepad.js';

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

/**
 * The browser adapter for {@link GamepadManager}'s injected source (#130).
 *
 * `navigator.getGamepads` is the one device API gamepad support needs, and this is the only
 * place it is read — alongside `browserClock`, in the file lint exempts from the device-global
 * ban, so the engine's `gamepad.ts` and every test of it stay `navigator`-free. It maps the
 * live `Gamepad` objects to the plain snapshots the manager consumes.
 *
 * ## Allocation, said honestly (rule 5)
 *
 * This runs once per fixed step. Everything *this* function owns is reused: one snapshot
 * per pad slot, kept across calls and mutated in place, its `axes` and `buttons` arrays
 * grown once to the pad's size and overwritten thereafter, and one result array whose
 * length is set rather than rebuilt. The first draft mapped, sliced and re-mapped on every
 * call — five allocations a step per pad, forever, on the path rule 5 exists for.
 *
 * What it cannot reuse is the platform's own answer. `navigator.getGamepads()` returns a
 * fresh array in every engine, and on Chromium each `Gamepad` in it is a new object with
 * new `axes` and `buttons` arrays as well — a snapshot by specification, not a live handle.
 * That is a platform call, like `getBoundingClientRect`, and it sits on the far side of the
 * line rule 5 draws: the rule is about *our* per-frame allocations in engine and game code,
 * and a browser API that hands over a copy is a cost of asking the browser, not of how we
 * asked. It is named here so nobody measures this path, sees the browser's array, and goes
 * looking for it in `gamepad.ts`. In a browser with no pads plugged in the returned array is
 * empty or all-null, and this touches nothing at all.
 *
 * Returns an empty array where the API is absent (older engines, a locked-down context) rather
 * than throwing, so a host can poll unconditionally and simply see no pads.
 */
export function browserGamepadSource(): () => (GamepadSnapshot | null)[] {
  const scope = globalThis;
  if (typeof scope.navigator === 'undefined' || typeof scope.navigator.getGamepads !== 'function') {
    return () => [];
  }
  const getGamepads = scope.navigator.getGamepads.bind(scope.navigator);
  interface Slot {
    index: number;
    id: string;
    connected: boolean;
    axes: number[];
    buttons: boolean[];
  }
  const slots: (Slot | null)[] = [];
  const out: (GamepadSnapshot | null)[] = [];
  return () => {
    const pads = getGamepads();
    out.length = pads.length;
    for (let i = 0; i < pads.length; i += 1) {
      const pad = pads[i];
      if (pad === null || pad === undefined) {
        out[i] = null;
        continue;
      }
      let slot = slots[i];
      if (slot === undefined || slot === null) {
        slot = { index: pad.index, id: pad.id, connected: false, axes: [], buttons: [] };
        slots[i] = slot;
      }
      slot.index = pad.index;
      // A string assignment shares the browser's string; nothing is copied.
      slot.id = pad.id;
      slot.connected = pad.connected;
      const axes = slot.axes;
      axes.length = pad.axes.length;
      for (let a = 0; a < pad.axes.length; a += 1) axes[a] = pad.axes[a] ?? 0;
      const buttons = slot.buttons;
      buttons.length = pad.buttons.length;
      for (let b = 0; b < pad.buttons.length; b += 1) buttons[b] = pad.buttons[b]?.pressed === true;
      out[i] = slot;
    }
    return out;
  };
}

export class RunLoop {
  readonly #loop: FixedLoop;
  readonly #clock: Clock;
  #running = false;
  #handle = 0;
  #lastTimeMs = 0;
  /** Assist-mode speed (#179): wall-clock time is scaled by this before it feeds the loop. */
  #timeScale = 1;

  readonly #tick = (timeMs: number): void => {
    if (!this.#running) return;
    let delta = (timeMs - this.#lastTimeMs) / 1000;
    this.#lastTimeMs = timeMs;
    if (!Number.isFinite(delta) || delta < 0) {
      delta = 0;
    } else if (delta > MAX_FRAME_SECONDS) {
      // A backgrounded tab returns with a gap of many seconds; clamp it so the match
      // does not fast-forward through the time it spent hidden. Clamped before scaling, so
      // the assist multiplier acts on the honest frame time rather than the clamped ceiling.
      delta = MAX_FRAME_SECONDS;
    }
    // Assist mode scales how much wall-clock time reaches the fixed loop, never the step
    // size (#179). At half speed the loop runs half as many steps this second, each one the
    // identical `stepSeconds` update it always was — so the simulation, its seeded RNG and
    // its step order are untouched and the match plays slowed, not changed. Rendering is
    // unscaled: `render` still runs every frame, interpolating with `alpha`, so slow motion
    // stays smooth rather than stepping.
    this.#loop.advance(delta * this.#timeScale);
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

  /** The assist-mode speed currently in effect; 1 is full speed. */
  get timeScale(): number {
    return this.#timeScale;
  }

  /**
   * Set the assist-mode speed multiplier (#179).
   *
   * Applies from the next frame on and can be changed mid-match, because it touches only how
   * fast wall-clock time is fed in, not any simulation state — no reset, no lost carry. A
   * value that is not a positive finite number is ignored rather than allowed to stall or
   * reverse the loop; the presentation layer clamps it to a sane range before it gets here.
   */
  setTimeScale(scale: number): void {
    if (Number.isFinite(scale) && scale > 0) this.#timeScale = scale;
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
