/**
 * Easing curves, and a scalar tween that runs on the fixed timestep (#113).
 *
 * `flip.ts` is the worked example this library is generalised from: a value that leaves one
 * setting, eases to another over a stated number of seconds, and arrives exactly on it. That
 * class stepped its own elapsed time, clamped its own progress and carried a private copy of
 * smootherstep, and every game that wanted anything else was going to write the same three
 * things again. This is those three things, once.
 *
 * ## Everything here is driven by the fixed step and never by wall time
 *
 * A {@link Tween} is advanced by handing it the delta `FixedLoop` handed the game. It reads
 * no clock, keeps no timer and touches nothing outside itself, so two devices stepping the
 * same match read the same value on the same step — which is the whole reason the flip could
 * be trusted with input ownership and the reason this can be trusted with anything a replay
 * or a lockstep trace passes over.
 *
 * ## Rule 5, which decided the shape
 *
 * No per-frame allocations in engine or game update paths. A tween library that hands out a
 * fresh object, or builds a closure to carry `from` and `to` into an interpolator, is the
 * wrong library for this engine: at sixty steps a second with a dozen tweens in flight that
 * is tens of thousands of objects a minute for values that are three numbers and a function
 * pointer. So, following `vec2.ts` and the input system:
 *
 *   - an {@link Easing} is a plain `(t: number) => number`, called by reference — the curve
 *     handed to the constructor is the function invoked, never a wrapper built around it;
 *   - {@link Tween} pre-allocates its whole state in the constructor and mutates it in place;
 *   - every per-step and per-event entry point takes positional numbers, never an options
 *     bag, exactly as `AudioSystem.play` does and for the same reason. The one options
 *     object in this module is `TweenOptions`, and it is read once, at construction.
 *
 * Only `value`, `progress` and the other getters cross the boundary, and every one of them
 * is a number, so nothing allocated inside a step can outlive it.
 *
 * ## Reduced motion is read at draw time and never at step time
 *
 * {@link Tween.step} takes a delta and nothing else. There is deliberately no way to tell a
 * tween about a device preference while it is running, because a preference that reached the
 * stepping would change how many steps a value takes to arrive, and rule 8 would go with it —
 * `flip.ts` sets out at length what that costs, and it is not a hypothetical: forty-two games
 * gate `update()` on a flip's duration.
 *
 * The preference enters at the other end, through {@link Tween.valueFor}, which answers with
 * the destination the instant a run begins. The argument is a {@link MotionPreference}, which
 * a `Renderer` satisfies structurally — so in practice a game writes `tween.valueFor(renderer)`
 * inside `render()`, the only place it holds one. That is not a convenience: `update()` is
 * never handed a renderer, so the preference is unreachable from the one place it must not be.
 *
 * ## The one thing #113 asks for that is deliberately absent
 *
 * Its actions are "Standard easing set", "Chainable sequences with cancellation" and a
 * reduced-motion switch. The easing set is above, cancellation is {@link Tween.cancel}, and
 * the switch is `valueFor`. **There is no sequence type, and this is where that is written
 * down rather than left for somebody to discover from the absence.**
 *
 * A chain is a list, and a list is an allocation. Rule 5 forbids per-frame allocations in
 * engine and game update paths, so a sequence that survives it would have to pre-allocate its
 * links at construction and step an index — which is a fixed-length array of tweens and a
 * cursor, i.e. eight lines inside the game that needs one, written against what that game
 * actually sequences. Building it here instead means guessing at the shape (does a link
 * repeat? does it hold at the end? does a retarget mid-chain restart it?), and every guess is
 * engine code that reaches every game's chunk through the barrel whether or not it is called.
 * The honest position is that the first game to want one builds it, and the second one moves
 * it here with two callers to design against. #113 should be closed listing this as not met,
 * not silently.
 */

/**
 * A normalised curve: takes progress in [0, 1] and returns eased progress.
 *
 * Every curve here answers 0 at 0 and 1 at 1 exactly, so a tween lands on its destination
 * rather than near it. Values in between are otherwise unconstrained — {@link easeOutBack}
 * deliberately leaves [0, 1] and comes back.
 *
 * Inputs are not clamped, matching `vec2.lerp`, which says the same of its `t`. {@link Tween}
 * clamps before it calls, so a curve only ever sees the range it was written for.
 */
export type Easing = (t: number) => number;

/**
 * The one thing a drawn value needs to know about the device.
 *
 * Declared as an optional field so that anything satisfies it structurally, and in
 * particular so that `Renderer` does — the field is optional there too, for the reason
 * `GameContext.reducedMotion` gives: the interface is implemented by hand in more than fifty
 * game test doubles, and a required member is a breaking change to all of them at once.
 * Absent means false, which is the answer a device with no preference set gives and the one a
 * test double should get for nothing.
 */
export interface MotionPreference {
  readonly reducedMotion?: boolean;
}

/** No easing at all. Constant rate, and a corner at both ends. */
export function linear(t: number): number {
  return t;
}

/** Cubic with zero first derivative at both ends: the cheapest curve that does not kick. */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Quintic with zero first *and second* derivative at both ends.
 *
 * The curve `SeatFlip` turns the board with. Slower to leave and slower to arrive than
 * smoothstep, which is what makes a half-turn read as a board being turned rather than a
 * picture being animated.
 */
export function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function easeInQuad(t: number): number {
  return t * t;
}

export function easeOutQuad(t: number): number {
  return t * (2 - t);
}

export function easeInOutQuad(t: number): number {
  if (t < 0.5) return 2 * t * t;
  const u = -2 * t + 2;
  return 1 - (u * u) / 2;
}

export function easeInCubic(t: number): number {
  return t * t * t;
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeInOutCubic(t: number): number {
  if (t < 0.5) return 4 * t * t * t;
  const u = -2 * t + 2;
  return 1 - (u * u * u) / 2;
}

/** Overshoot on the back of {@link easeOutBack}, in units of the travel. The usual value. */
const BACK_OVERSHOOT = 1.70158;

/**
 * Runs past the destination and settles back onto it.
 *
 * The one curve here that leaves [0, 1], and the reason {@link Tween} does not clamp its
 * output: a piece landing on a board wants to arrive a little too far and settle, and a
 * clamp would flatten exactly that. It still answers 0 at 0 and 1 at 1 exactly.
 *
 * Written as `1 + u³ + k·u²·t` rather than the usual `1 + (k+1)·u³ + k·u²`, which is the same
 * polynomial and is *not* the same in floating point: the textbook form leaves
 * `1 - (k + 1) + k` at t = 0, and the two roundings of k do not cancel, so it answers
 * 2.2e-16 instead of zero. Factoring the `u + 1` out makes the t = 0 term vanish outright.
 * The endpoint test found this on its first run.
 */
export function easeOutBack(t: number): number {
  const u = t - 1;
  return 1 + u * u * u + BACK_OVERSHOOT * u * u * t;
}

export interface TweenOptions {
  /** Seconds a run takes. Zero means every run settles on the step it starts. */
  readonly durationSeconds?: number;
  /** Curve. Defaults to {@link smoothstep}. */
  readonly easing?: Easing;
  /** The value to sit at before anything is started. */
  readonly value?: number;
}

const DEFAULT_DURATION_SECONDS = 0.25;

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, received ${String(value)}`);
  }
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number, received ${String(value)}`);
  }
}

/**
 * One scalar travelling from one value to another over the fixed timestep.
 *
 * Scalar rather than vector on purpose. Two tweens describe a point, and they cost two
 * numbers more than a tween that owned a `Vec2` would — but a vector tween would have to hand
 * back a vector, and either it allocates one per read or it hands out a mutable field that the
 * caller can write through, which is the bug `vec2.ts` avoids by making the caller own every
 * out parameter. A number cannot be aliased.
 *
 * The duration is fixed at construction, as `SeatFlip`'s is. A game that needs two speeds
 * builds two tweens; a duration that can change between runs is a duration a replay cannot
 * reconstruct from the construction site.
 */
export class Tween {
  readonly durationSeconds: number;
  readonly #easing: Easing;
  /** Where the running run started. Equal to `#to` when nothing is running. */
  #from: number;
  /** Where it is heading, and the settled value whenever `#running` is false. */
  #to: number;
  /** Seconds elapsed in the running run; zero when settled. */
  #elapsed = 0;
  #running = false;

  constructor(options?: TweenOptions) {
    const duration = options?.durationSeconds ?? DEFAULT_DURATION_SECONDS;
    assertNonNegative(duration, 'durationSeconds');
    const start = options?.value ?? 0;
    assertFinite(start, 'value');
    this.durationSeconds = duration;
    this.#easing = options?.easing ?? smoothstep;
    this.#from = start;
    this.#to = start;
  }

  /** Where a running run started, or the settled value when nothing is running. */
  get from(): number {
    return this.#from;
  }

  /** The destination. This is what a settled tween reads, and what reduced motion reads. */
  get to(): number {
    return this.#to;
  }

  get running(): boolean {
    return this.#running;
  }

  /** True whenever the tween is sitting on {@link Tween.to}. */
  get settled(): boolean {
    return !this.#running;
  }

  /**
   * How far through the running run, in [0, 1]. One when settled.
   *
   * Linear, before the curve. A game that wants the eased number wants {@link Tween.value}.
   */
  get progress(): number {
    if (!this.#running) return 1;
    if (this.durationSeconds === 0) return 1;
    const t = this.#elapsed / this.durationSeconds;
    return t < 1 ? t : 1;
  }

  /**
   * The eased value, right now.
   *
   * Unconditional, on every device, exactly as `SeatFlip.angle` is: a player who has asked
   * for reduced motion is served by {@link Tween.valueFor}, downstream of here. Leaving this
   * one unfiltered is what lets the same tween drive a value that is a picture on one device
   * and, if a game ever needs it to be, a simulation value on all of them.
   */
  get value(): number {
    if (!this.#running) return this.#to;
    const from = this.#from;
    return from + (this.#to - from) * this.#easing(this.progress);
  }

  /**
   * The value to draw, given what the device has asked for.
   *
   * Under reduced motion this is {@link Tween.to} from the instant a run starts — the tween
   * still steps, and still takes exactly as long to settle, but the picture is already there.
   * That is the accessibility contract stated the only way it can be honoured without moving
   * the simulation: what is drawn changes, what is stepped does not.
   *
   * Which means the destination has to be a state that reads correctly on its own. A tween
   * whose `to` is halfway through a wind-up, with the rest of the gesture carried by a second
   * tween, will simply cut to the wind-up and sit there. Aim a tween at somewhere worth
   * arriving.
   */
  valueFor(motion: MotionPreference): number {
    return motion.reducedMotion === true ? this.#to : this.value;
  }

  /**
   * Start a fresh run from `from` to `to`, whatever was happening before.
   *
   * Positional numbers, not an options object: this is called on an event — a hit, a piece
   * landing, a turn changing — and an options bag would allocate at every one of them.
   */
  restart(from: number, to: number): void {
    assertFinite(from, 'from');
    assertFinite(to, 'to');
    this.#from = from;
    this.#to = to;
    this.#elapsed = 0;
    this.#running = this.durationSeconds > 0 && from !== to;
  }

  /**
   * Aim at a new destination, starting from wherever the value is now.
   *
   * Re-aiming at the destination already in hand does nothing, so a repeated call in an
   * `update()` does not restart the run sixty times a second and freeze the value at its
   * first eased sample — the mistake this method exists to make impossible. Aiming somewhere
   * new mid-run starts a full-length run from the current value, so the tween never jumps.
   */
  retarget(to: number): void {
    assertFinite(to, 'to');
    if (to === this.#to) return;
    this.restart(this.value, to);
  }

  /**
   * Sit on a value with no run at all.
   *
   * For a reset — a game laying out a fresh round — and for nothing else. **Not for reduced
   * motion**, and neither is a `durationSeconds` of zero, for the reason `SeatFlip.snap` sets
   * out: both of them move the value on a different step than a tweened run would, and if
   * anything in the simulation is reading it, two devices with different accessibility
   * settings stop stepping the same match. {@link Tween.valueFor} is the one that is safe,
   * because it changes only what the caller draws.
   */
  snap(value: number): void {
    assertFinite(value, 'value');
    this.#from = value;
    this.#to = value;
    this.#elapsed = 0;
    this.#running = false;
  }

  /**
   * Stop where the value stands, and stay there (#113).
   *
   * The acceptance line is "cancelling a tween mid-flight leaves a consistent state", and
   * this is the whole of what that means here: the run ends, `value` keeps the number it was
   * reading on the step it was cancelled, `settled` becomes true, `to` becomes that same
   * number, and stepping it afterwards does nothing. There is no half-cancelled state to
   * observe, because there is no state but those four fields.
   *
   * Mechanically this is {@link Tween.snap} aimed at the value in hand, and it exists as its
   * own name rather than as advice to write `snap(tween.value)` because `snap`'s docstring
   * rules itself out for anything but a reset, in as many words. A game stopping a gesture
   * that has been interrupted — a piece caught mid-flight, a menu dismissed while it was
   * still opening — would read that and conclude the library had nothing for it.
   *
   * Like `snap`, it moves the value on a step a tweened run would not have, so it is for
   * something the player did rather than for a device preference: cancel on an interruption
   * both devices see, never on a setting only one of them has.
   */
  cancel(): void {
    this.snap(this.value);
  }

  /**
   * Advance by one fixed simulation step.
   *
   * Takes the delta and nothing else. There is no second argument, and there is deliberately
   * no way to add one: see the note at the top of this file.
   */
  step(fixedDeltaSeconds: number): void {
    assertNonNegative(fixedDeltaSeconds, 'fixedDeltaSeconds');
    if (!this.#running) return;
    this.#elapsed += fixedDeltaSeconds;
    if (this.#elapsed >= this.durationSeconds) {
      this.#from = this.#to;
      this.#elapsed = 0;
      this.#running = false;
    }
  }
}
