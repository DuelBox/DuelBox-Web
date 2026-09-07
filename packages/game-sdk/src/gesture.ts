import type { SeatInput } from './contract.js';

/**
 * The gestures every aim, charge and hold game reproduced by hand, defined once.
 *
 * `docs/input-idiom.md` establishes that one mechanism has been rewritten in seven game
 * packages under ten private field names — `#dragOrigin`, `#armed`, `#pointerAiming`,
 * `#drawSteps`, `stick.down` — and that each was a shipped bug the first time. Three facts
 * caused most of them, and this module is where they are handled once so no game handles
 * them again:
 *
 * 1. **Most taps arrive with press and release on one step.** A recogniser that treats the
 *    release as the `else` of the press only ever sees deliberate holds.
 * 2. **The pointer is `null` on the release step.** Anything a release needs — the aim
 *    vector, the drag origin — must be *carried*, never re-read from `input.pointer`.
 * 3. **`holdSeconds` is 0 on the release step.** A "released after holding for t" rule reads
 *    `holdSecondsAtRelease` (#2475) or accumulates t itself.
 *
 * Every recogniser here reads only the documented `SeatInput` view, so it is fed the same
 * way whether a seat is a thumb, half a keyboard, or a gamepad (#130) — the reason
 * `hold-to-act` (#1754) "works identically across all three input families" is that it never
 * learns which one it is looking at.
 *
 * **Per seat, and allocation-free.** A game constructs one recogniser per seat and calls
 * `sample()` once per `update()`; nothing here allocates after construction, so a game's
 * hot path stays inside rule 5. Results are read back through getters and stable per-step
 * flags rather than a fresh object each step.
 */

/** A recogniser that consumes one seat's input for the step about to run. */
interface SeatGesture {
  /** Fold this step's input into the gesture. Call once per `update()`, per seat. */
  sample(input: SeatInput, fixedDeltaSeconds: number): void;
  /** Forget any gesture in progress. Called on a round boundary or a hard reset. */
  reset(): void;
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/** Configuration for {@link DragAim}. All distances are logical units (rule 8). */
export interface DragAimOptions {
  /**
   * The largest power a drag can express. A drag longer than this clamps here rather than
   * growing without bound, so the guide line and the shot both have a known ceiling.
   *
   * `docs/input-idiom.md` caps the useful drag at about a third of the short side for the
   * mouse-does-not-re-clutch reason; a game passes that number here.
   */
  readonly maxPower: number;
  /**
   * The radius, around the drag origin, inside which a release **cancels** instead of firing.
   *
   * This is `docs/input-idiom.md`'s mandatory cancel for the aim idiom: "a press-and-release
   * inside the tap radius sets no aim and must cancel, not fire a zero-power shot", and
   * "dragging back inside the deadzone and lifting must abandon the shot". Expressed as a
   * bare number here and sized by the game as a multiple of `envelopeFor(logical)` so it can
   * never be finer than the position lattice.
   */
  readonly deadzone: number;
}

/**
 * The result of the step a {@link DragAim} resolves on, valid only while `fired` or
 * `cancelled` is set. Read it, do not keep it: the same object is rewritten each step.
 */
export interface DragAimResult {
  /** True for exactly the release step on which a shot was taken. */
  fired: boolean;
  /** True for exactly the step on which the aim was abandoned — a deadzone release or a
      `pointerCancelled`. Mutually exclusive with `fired`. */
  cancelled: boolean;
  /** Unit aim direction at the moment of firing; both components 0 when not firing. */
  dirX: number;
  dirY: number;
  /** Power in [0, maxPower] at the moment of firing; 0 when not firing. */
  power: number;
}

/**
 * Drag-to-aim, for pool, mini-golf, carrom, cornhole, darts, archery — every aim-and-release
 * game (#126).
 *
 * Press begins the aim and commits nothing; drag sets a vector from the origin and a power
 * that is the vector's length clamped to `maxPower`; release fires with the vector the aim
 * carried, because `input.pointer` is gone by then. A release that never left the deadzone,
 * or a `pointerCancelled`, abandons the shot — the "return to the origin cancels" acceptance
 * criterion, and the cancel the parity doc makes mandatory for this idiom.
 *
 * The **anchor** is the drag origin — the point the press went down. A game that anchors to
 * the aimed object instead (the idiom's default) drives this with the object's position as
 * the origin by calling {@link setAnchor} on the press step; left alone, the origin is the
 * press point, which is the on-screen-pad case.
 */
export class DragAim implements SeatGesture {
  #maxPower: number;
  #deadzone: number;
  #active = false;
  #originX = 0;
  #originY = 0;
  #vecX = 0;
  #vecY = 0;
  #magnitude = 0;
  readonly #result: DragAimResult = {
    fired: false,
    cancelled: false,
    dirX: 0,
    dirY: 0,
    power: 0,
  };

  constructor(options: DragAimOptions) {
    this.#maxPower = Math.max(0, options.maxPower);
    this.#deadzone = Math.max(0, options.deadzone);
  }

  /** True between a press and its release: a guide line should be drawn. */
  get active(): boolean {
    return this.#active;
  }

  /** The origin the current vector is measured from, in logical units. */
  get originX(): number {
    return this.#originX;
  }
  get originY(): number {
    return this.#originY;
  }

  /** The current aim vector (current point minus origin), in logical units. */
  get vectorX(): number {
    return this.#vecX;
  }
  get vectorY(): number {
    return this.#vecY;
  }

  /** The current drag length, before the power clamp. */
  get magnitude(): number {
    return this.#magnitude;
  }

  /** The current power: the drag length clamped to `maxPower`. Zero inside the deadzone. */
  get power(): number {
    if (this.#magnitude <= this.#deadzone) return 0;
    return Math.min(this.#magnitude, this.#maxPower);
  }

  /**
   * Power as a fraction of `maxPower`, in [0, 1] — the aim-preview value for a charge bar.
   * Zero when `maxPower` is zero rather than dividing by it.
   */
  get powerFraction(): number {
    if (this.#maxPower <= 0) return 0;
    return this.power / this.#maxPower;
  }

  /** What happened this step. Meaningful only when `result.fired` or `result.cancelled`. */
  get result(): Readonly<DragAimResult> {
    return this.#result;
  }

  /**
   * Anchor the aim to a point other than the press point — the aimed object, per the idiom.
   * Call on the press step (when {@link result}.fired is about to be false and `active` has
   * just turned true); the vector is then measured from `x,y` rather than from the finger.
   */
  setAnchor(x: number, y: number): void {
    this.#originX = x;
    this.#originY = y;
    this.#recompute(this.#lastX, this.#lastY);
  }

  #lastX = 0;
  #lastY = 0;

  #recompute(pointerX: number, pointerY: number): void {
    this.#lastX = pointerX;
    this.#lastY = pointerY;
    this.#vecX = pointerX - this.#originX;
    this.#vecY = pointerY - this.#originY;
    this.#magnitude = Math.hypot(this.#vecX, this.#vecY);
  }

  sample(input: SeatInput, _fixedDeltaSeconds: number): void {
    this.#result.fired = false;
    this.#result.cancelled = false;

    // A cancel abandons whatever is in progress and never fires — checked first so a
    // release delivered on the same step (it never is, but the guard is cheap) loses.
    if (input.pointerCancelled) {
      if (this.#active) this.#result.cancelled = true;
      this.#end();
      return;
    }

    const pointer = input.pointer;
    if (input.actionPressed && pointer !== null) {
      // Press: begin. Origin is the press point until a game re-anchors it this same step.
      this.#active = true;
      this.#originX = pointer.x;
      this.#originY = pointer.y;
      this.#recompute(pointer.x, pointer.y);
      return;
    }

    if (this.#active && pointer !== null) {
      // Drag: re-aim. The pointer is live, so read it.
      this.#recompute(pointer.x, pointer.y);
    }

    if (input.actionReleased && this.#active) {
      // Release: fire the carried aim, or cancel if it never left the deadzone. The pointer
      // is null now, so nothing here reads it — the vector was carried from the last drag.
      if (this.#magnitude <= this.#deadzone) {
        this.#result.cancelled = true;
      } else {
        const power = Math.min(this.#magnitude, this.#maxPower);
        const inv = this.#magnitude > 0 ? 1 / this.#magnitude : 0;
        this.#result.fired = true;
        this.#result.dirX = this.#vecX * inv;
        this.#result.dirY = this.#vecY * inv;
        this.#result.power = power;
      }
      this.#end();
    }
  }

  #end(): void {
    this.#active = false;
    this.#vecX = 0;
    this.#vecY = 0;
    this.#magnitude = 0;
  }

  reset(): void {
    this.#end();
    this.#result.fired = false;
    this.#result.cancelled = false;
    this.#originX = 0;
    this.#originY = 0;
  }
}

/** The three things a press can turn out to be. */
export type PressKind = 'tap' | 'hold' | 'charge';

/** Configuration for {@link PressGesture}. All thresholds are seconds. */
export interface PressGestureOptions {
  /**
   * A press let go at or before this many seconds is a **tap**; longer is a **hold**. The
   * boundary is resolved at whole-step granularity — see the note on the class.
   */
  readonly tapMaxSeconds: number;
  /**
   * The hold at which a **charge** is full. `charge` climbs from 0 at `tapMaxSeconds` to 1
   * here and clamps; a game that wants a bare hold with no ramp sets this equal to
   * `tapMaxSeconds`.
   */
  readonly chargeFullSeconds: number;
}

/**
 * Tap / hold / charge recognition (#127).
 *
 * Distinguishes a quick tap from a deliberate hold from a held charge, using the seat's
 * `holdSeconds` while held and `holdSecondsAtRelease` on the step it is let go — the two
 * fields that already carry an accurate whole-step total, so the "hold duration accurate
 * within one frame" criterion is met by construction.
 *
 * ## Whole-step granularity, and the tie policy
 *
 * The issue's second criterion asks for "sub-frame timestamps for tie resolution", and this
 * recogniser deliberately does **not** provide them. The engine resolves input on the step
 * boundary (`InputManager.beginStep`); a hold is therefore a whole number of fixed steps and
 * a sub-frame wall-clock timestamp cannot be reconstructed from it without reintroducing the
 * `Date`/`performance` reads lint bans across `packages/`. Mixing a wall clock into a
 * fixed-step duration is exactly what would make two devices disagree about the same match
 * (rule 8).
 *
 * Reaction ties are already resolved elsewhere and correctly: **#132 settles simultaneous
 * inputs on their source timestamps at the moment they are committed**, before they reach
 * the fixed step, which is the layer where a sub-frame ordering is still meaningful. This
 * recogniser reports the whole-step duration and leaves tie-breaking to that layer. The
 * charge/hold boundary here is a *classification*, not a race, so whole-step resolution is
 * the right precision for it.
 */
export class PressGesture implements SeatGesture {
  #tapMax: number;
  #chargeFull: number;
  #held = false;
  #heldSeconds = 0;
  #justPressed = false;
  #released = false;
  #kind: PressKind | null = null;
  #releaseSeconds = 0;

  constructor(options: PressGestureOptions) {
    this.#tapMax = Math.max(0, options.tapMaxSeconds);
    // Charge cannot saturate before a hold has even begun.
    this.#chargeFull = Math.max(this.#tapMax, options.chargeFullSeconds);
  }

  /** True while the action is down. */
  get held(): boolean {
    return this.#held;
  }

  /** True for exactly the step the action first read as down. */
  get justPressed(): boolean {
    return this.#justPressed;
  }

  /** Seconds held so far while the action is down; the total on the release step. */
  get heldSeconds(): number {
    return this.#heldSeconds;
  }

  /**
   * Charge fraction in [0, 1]: 0 up to `tapMaxSeconds`, then climbing to 1 at
   * `chargeFullSeconds`. Live while held and frozen at the released value on the release
   * step, so a charge-shot game reads the same number whether it fires on hold or on release.
   */
  get charge(): number {
    const span = this.#chargeFull - this.#tapMax;
    if (span <= 0) return this.#heldSeconds >= this.#tapMax ? 1 : 0;
    return clamp((this.#heldSeconds - this.#tapMax) / span, 0, 1);
  }

  /** True for exactly the step the action is let go. Never true on a cancel. */
  get released(): boolean {
    return this.#released;
  }

  /**
   * What the press that just ended was — 'tap', 'hold' or 'charge' — valid only on the step
   * {@link released} is true, and null otherwise.
   *
   * 'charge' rather than 'hold' once the hold reached `chargeFullSeconds`; a game that does
   * not distinguish them treats both the same.
   */
  get kind(): PressKind | null {
    return this.#released ? this.#kind : null;
  }

  /** The hold duration of the press that just ended, valid on the release step only. */
  get releaseSeconds(): number {
    return this.#released ? this.#releaseSeconds : 0;
  }

  sample(input: SeatInput, _fixedDeltaSeconds: number): void {
    this.#justPressed = false;
    this.#released = false;
    this.#kind = null;
    this.#releaseSeconds = 0;

    if (input.pointerCancelled) {
      // A cancel is not a release: the press is abandoned and classified as nothing.
      this.#held = false;
      this.#heldSeconds = 0;
      return;
    }

    if (input.actionPressed) this.#justPressed = true;

    if (input.actionReleased) {
      // `holdSecondsAtRelease` is the whole-step total; `holdSeconds` is 0 here by design.
      const total = input.holdSecondsAtRelease;
      this.#heldSeconds = total;
      this.#released = true;
      this.#kind =
        total <= this.#tapMax ? 'tap' : total >= this.#chargeFull ? 'charge' : 'hold';
      this.#releaseSeconds = total;
      this.#held = false;
      // Leave heldSeconds readable for this step, then it is stale until the next press.
      return;
    }

    this.#held = input.actionHeld;
    // While held, holdSeconds carries the running total (0 on the press step, which is
    // correct: a press that has lasted no steps yet has charged nothing).
    this.#heldSeconds = input.actionHeld ? input.holdSeconds : 0;
  }

  reset(): void {
    this.#held = false;
    this.#heldSeconds = 0;
    this.#justPressed = false;
    this.#released = false;
    this.#kind = null;
    this.#releaseSeconds = 0;
  }
}

/** Configuration for {@link HoldToAct}. */
export interface HoldToActOptions {
  /**
   * Seconds of holding *inside a constraint window* before the release constraint is
   * considered failed — the grace before "you held through the curve" bites. A game that
   * wants any hold in the window to count sets this to 0.
   */
  readonly graceSeconds: number;
}

/**
 * Hold-to-act with a release constraint (#1754) — the Slot Cars pattern: hold to accelerate,
 * and release before the curve or fail.
 *
 * A game samples this every step with whether the seat is *currently inside a constraint
 * window* (only the game knows where its curves are). While the action is held and the
 * window is active, penalty time accrues; a game reads `overHeld` to know the constraint has
 * been broken and `penaltySeconds` for how badly.
 *
 * The hold duration is accumulated here from the fixed delta rather than read from
 * `holdSeconds`, so it is exact to within one step (the acceptance criterion) and independent
 * of the view's zeroing on the press and release steps. Because it reads only
 * `actionHeld`/`actionReleased`, the identical logic runs on touch, keyboard and gamepad —
 * the second acceptance criterion — with no branch on the source.
 */
export class HoldToAct implements SeatGesture {
  #grace: number;
  #held = false;
  #holdSeconds = 0;
  #penaltySeconds = 0;
  #released = false;
  #releaseSeconds = 0;

  constructor(options: HoldToActOptions) {
    this.#grace = Math.max(0, options.graceSeconds);
  }

  /** True while the action is held. */
  get held(): boolean {
    return this.#held;
  }

  /** Seconds the current hold has lasted, exact to one step. Total on the release step. */
  get holdSeconds(): number {
    return this.#holdSeconds;
  }

  /** Seconds spent holding inside the constraint window this hold — the penalty accrued. */
  get penaltySeconds(): number {
    return this.#penaltySeconds;
  }

  /** True once the penalty has exceeded the grace: the release constraint has been broken. */
  get overHeld(): boolean {
    return this.#penaltySeconds > this.#grace;
  }

  /** True for exactly the step the hold ends by a deliberate release (never on a cancel). */
  get released(): boolean {
    return this.#released;
  }

  /** The hold's total duration, valid on the {@link released} step only. */
  get releaseSeconds(): number {
    return this.#released ? this.#releaseSeconds : 0;
  }

  /**
   * @param input the seat view for this step
   * @param inConstraint whether the seat is inside a penalise-while-held window right now
   * @param fixedDeltaSeconds the loop's fixed step, for exact accumulation
   */
  sample(input: SeatInput, fixedDeltaSeconds: number, inConstraint = false): void {
    this.#released = false;
    this.#releaseSeconds = 0;
    const delta = Number.isFinite(fixedDeltaSeconds) && fixedDeltaSeconds > 0 ? fixedDeltaSeconds : 0;

    if (input.pointerCancelled) {
      this.#end();
      return;
    }

    if (input.actionReleased) {
      this.#released = true;
      this.#releaseSeconds = this.#holdSeconds;
      this.#end();
      return;
    }

    if (input.actionHeld) {
      this.#held = true;
      this.#holdSeconds += delta;
      if (inConstraint) this.#penaltySeconds += delta;
    } else {
      this.#end();
    }
  }

  #end(): void {
    this.#held = false;
    this.#holdSeconds = 0;
    this.#penaltySeconds = 0;
  }

  reset(): void {
    this.#end();
    this.#released = false;
    this.#releaseSeconds = 0;
  }
}
