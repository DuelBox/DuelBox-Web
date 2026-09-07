import type { Easing, MotionPreference } from './tween.js';
import { easeInQuad, easeOutCubic } from './tween.js';
import type { Renderer } from './renderer.js';

/**
 * Screen shake, hit-stop and flash: the three pieces of impact feedback every action game
 * wants, built on the tween library and constrained by the two rules that matter (#114).
 *
 * ## What hit-stop can and cannot be here, which is the whole design
 *
 * Hit-stop, as the term is normally used, freezes the world for a few frames at the moment of
 * contact so the hit reads as a hit. The obvious implementation is to stop stepping the
 * simulation. It is worth writing down carefully why that is not what this module does,
 * because the usual one-line answer — "it would break determinism" — is **wrong**, and a
 * reader who believes it will reject the right fix for the wrong reason.
 *
 * A freeze counted in simulation *steps*, triggered by a simulation event, is perfectly
 * deterministic. `FixedLoop` never lets wall time into a step; a game that set
 * `#frozenSteps = 5` inside `update()` and returned early for the next five would freeze on
 * the same five steps on a 60 Hz phone and a 144 Hz laptop, and the loop's spiral-of-death
 * guard only ever discards time, never invents it, so both devices stay on whole-step
 * boundaries either way. Two clients replaying the same inputs would agree exactly. So it is
 * not determinism that rules it out. Three other things do, and each of them alone is enough:
 *
 * 1. **It could never be switched off, so it could never be juice.** `GameContext.reducedMotion`
 *    may change what is drawn and nothing else. A freeze inside `update()` is a change to how
 *    many steps the match takes; honouring the preference by removing it would mean a player
 *    with reduced motion set played a *different match* — different ball positions, different
 *    outcomes, and every replay and lockstep trace mismatched against a player without it.
 *    So the preference could not reach it, and #175 could never turn it off. An effect that
 *    exists to add feel and cannot be turned off is not an effect, it is a rule.
 * 2. **It is not local, and juice must be.** Two people share one device. A freeze stops both
 *    seats: the player who was hit loses five steps of their own defence because the player
 *    who landed the hit earned a flourish. That is a balance decision — it belongs in a game's
 *    rules, gets a spec, and goes through `pnpm balance:audit` — and it must not arrive as a
 *    side effect of a library called "juice".
 * 3. **A library cannot police the trigger.** The freeze above is deterministic *only* because
 *    the trigger came from the simulation. A game that started one from something it noticed
 *    while drawing — an overlap in interpolated positions, a particle crossing a line — would
 *    diverge on the first frame the two devices rendered at different rates, and nothing in a
 *    shared class can tell the two cases apart.
 *
 * So {@link HitStop} freezes the **drawing** and lets the world run underneath. While it
 * holds, the game returns from `render()` without drawing anything; the canvas keeps the last
 * frame it was given, because nothing cleared it. The simulation is untouched, the preference
 * can switch it off, and one seat's hit costs the other seat nothing.
 *
 * **The honest cost, stated rather than hidden:** the world does not wait, so when the hold
 * ends the picture jumps forward by however long it lasted. That is why {@link HitStop} caps
 * a hold at {@link MAX_HOLD_SECONDS} — about seven steps at sixty hertz — and why the cap is
 * not configurable. Within that, the jump reads as the snap of an impact; much beyond it, it
 * reads as a dropped frame, which is a different thing and not a good one. A version with no
 * jump is possible — draw at a time that lags simulation time and catches up afterwards — but
 * it needs a history of past states to interpolate between, which no game in this repository
 * keeps, so it is not offered rather than half-offered.
 *
 * ## Reduced motion is here from the first line, not added afterwards
 *
 * #175 is open because effects like these did not exist, so there has been nothing to switch
 * off. Each of the three arrives with its answer already decided, and each one keeps saying
 * what it was saying:
 *
 *   - **Shake** is a transform, so it is switched off where the engine already switches
 *     transforms off: `Canvas2DRenderer.pushShake` zeroes the displacement under reduced
 *     motion exactly as `pushRotation` snaps a part-way board to its resting angle. The shake
 *     class itself is never told, exactly as `SeatFlip` is never told, so a preference changed
 *     mid-match is followed in both directions rather than frozen at whatever `init` saw.
 *     What the shake was saying — *that was a hit, and this is how hard* — is carried by
 *     {@link Shake.intensity}, which is unconditional and is meant to be drawn.
 *   - **Flash** is a level, not a transform, so the renderer cannot filter it and
 *     {@link Flash.levelFor} does. With motion it is a pulse that falls away; without, it is a
 *     steady mark held for the identical window. Same colour, same duration, same meaning, no
 *     ramp — rule 7's argument applied to time instead of colour.
 *   - **Hit-stop** is a decision, and {@link HitStop.holdingFor} answers false under reduced
 *     motion, because the catch-up jump on release is precisely the sudden movement the
 *     preference is asking not to be shown.
 *
 * {@link Impact} exists so that the motion channel cannot be raised on its own: one
 * `strike()` raises all three, so a game that shakes on a hit has already flashed on it, and
 * the player with motion switched off is still told.
 *
 * ## Rule 5
 *
 * Everything here follows `tween.ts` and `vec2.ts`: state pre-allocated in the constructor,
 * positional numbers on every per-step and per-event entry point, and nothing but primitives
 * crossing the boundary. There is no randomness — the shake is a fixed pair of sinusoids, not
 * noise — both because `Math.random` is banned and because drawing must never advance the
 * match's seeded `Rng`: a picture that consumed random numbers would change the simulation
 * every time a frame was drawn.
 */

const TAU = Math.PI * 2;

/**
 * The two rates the shake oscillates at, in hertz.
 *
 * Both are comfortably under the thirty hertz that a sixty hertz simulation can represent, so
 * the displacement is a shake rather than an aliasing artefact that changes character with the
 * step rate. They are coprime, so the two axes do not retrace the same short figure — over the
 * fraction of a second a shake lasts, the path never repeats and it reads as noise without
 * anybody having to draw any.
 */
const SHAKE_X_HZ = 13;
const SHAKE_Y_HZ = 17;

/**
 * How bright the steady mark is that stands in for a flash when motion is off.
 *
 * Half. A pulse starts at full and falls away, so over the same window it delivers roughly
 * half its peak; matching that keeps the substitute as prominent as the thing it replaces
 * without being a brighter interruption than the effect it is sparing the player.
 */
const STEADY_LEVEL = 0.5;

/**
 * The longest the picture may be held. Seven steps at sixty hertz.
 *
 * Not configurable, and the note at the top of this file is why: the world keeps running
 * under a hold, so every held second is a second of movement that arrives at once when it
 * ends. This is the length at which that still reads as impact.
 */
export const MAX_HOLD_SECONDS = 0.12;

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number, received ${String(value)}`);
  }
}

export interface ShakeOptions {
  /**
   * Envelope applied to the fraction of the shake still to run, so the peak displacement
   * falls from the magnitude to nothing. Defaults to {@link easeInQuad}, which dies away
   * quickly and then tails off — a hit that is over rather than a wobble that subsides.
   */
  readonly decay?: Easing;
}

/**
 * A displacement that dies away, in logical units.
 *
 * Logical, never pixels: rule 8. A shake of `0.02 * logical.width` looks the same on a phone
 * and a 4K monitor, and a shake written in pixels would be a different gesture on each.
 */
export class Shake {
  readonly #decay: Easing;
  /** Peak displacement of the running shake, in logical units; zero when nothing runs. */
  #magnitude = 0;
  #durationSeconds = 0;
  #elapsed = 0;

  constructor(options?: ShakeOptions) {
    this.#decay = options?.decay ?? easeInQuad;
  }

  get active(): boolean {
    return this.#elapsed < this.#durationSeconds;
  }

  /**
   * How hard the shake is hitting right now, in [0, 1]. Zero when nothing runs.
   *
   * **This is the information, and it is not motion.** Draw something from it — a rim that
   * thickens, a piece that brightens, a bar that jumps — and the player who has motion
   * switched off is told what the shake was telling everybody else. A game that reads only
   * the offsets below has built a signal that one of its players cannot receive.
   */
  get intensity(): number {
    if (!this.active) return 0;
    return this.#decay(1 - this.#elapsed / this.#durationSeconds);
  }

  /**
   * Horizontal displacement in logical units, in [-magnitude, magnitude].
   *
   * Unconditional, on every device, exactly as `SeatFlip.angle` is. The player who asked for
   * reduced motion is served downstream by `Canvas2DRenderer.pushShake`, which is handed this
   * and draws nothing with it — one mechanism for the preference, live, and reaching a game
   * that never mentions it. Use {@link applyShake} rather than reading these by hand.
   */
  get offsetX(): number {
    return this.#magnitude * this.intensity * Math.sin(TAU * SHAKE_X_HZ * this.#elapsed);
  }

  get offsetY(): number {
    return this.#magnitude * this.intensity * Math.sin(TAU * SHAKE_Y_HZ * this.#elapsed);
  }

  /**
   * Start a shake, unless a stronger one is already running.
   *
   * The strongest wins outright rather than the two adding up. Three hits in quick succession
   * are three reasons to shake, not three shakes to perform, and a library that summed them
   * would turn a busy moment into something nobody designed and some players cannot look at.
   * Comparison is against the *current* amplitude, so a small kick lands once the big one has
   * decayed past it, which is the behaviour a rally of small impacts wants.
   */
  kick(magnitude: number, seconds: number): void {
    assertNonNegative(magnitude, 'magnitude');
    assertNonNegative(seconds, 'seconds');
    if (magnitude <= this.#magnitude * this.intensity) return;
    this.#magnitude = magnitude;
    this.#durationSeconds = seconds;
    this.#elapsed = 0;
  }

  /** Advance by one fixed simulation step. Takes the delta and nothing else. */
  step(fixedDeltaSeconds: number): void {
    assertNonNegative(fixedDeltaSeconds, 'fixedDeltaSeconds');
    if (!this.active) return;
    this.#elapsed += fixedDeltaSeconds;
    // Compared against the field rather than re-read from `active`: the getter was narrowed
    // by the guard above and the typed lint holds it there through the mutation.
    if (this.#elapsed >= this.#durationSeconds) this.clear();
  }

  /** Stop dead. For a round reset, not for a preference. */
  clear(): void {
    this.#magnitude = 0;
    this.#durationSeconds = 0;
    this.#elapsed = 0;
  }
}

export interface FlashOptions {
  /**
   * Envelope applied to the fraction still to run. Defaults to {@link easeOutCubic}, which
   * holds near full for most of the window and then goes — a flash that is seen rather than
   * a glow that fades.
   */
  readonly decay?: Easing;
}

/**
 * A level in [0, 1] that a game paints something with: a rim, a tint, a highlight.
 *
 * The engine does not draw it, on purpose. A full-screen white pulse is the wrong shape for a
 * device two people are sharing and it is a photosensitivity hazard besides; what suits one
 * game is a rim on the struck half and what suits another is the piece itself brightening.
 * The library owns the timing, which is the part that has to be identical everywhere and has
 * to answer to the preference; the picture stays with the game.
 */
export class Flash {
  readonly #decay: Easing;
  #durationSeconds = 0;
  #elapsed = 0;

  constructor(options?: FlashOptions) {
    this.#decay = options?.decay ?? easeOutCubic;
  }

  get active(): boolean {
    return this.#elapsed < this.#durationSeconds;
  }

  /** The pulse: full at the start, nothing at the end. Unconditional, on every device. */
  get intensity(): number {
    if (!this.active) return 0;
    return this.#decay(1 - this.#elapsed / this.#durationSeconds);
  }

  /**
   * The non-motion form: a constant level held for exactly the window the pulse would have
   * occupied, then nothing.
   *
   * Constant is the point. It appears once and disappears once, so there is no ramp and no
   * flicker, and it occupies the same span of steps as the pulse so the two are
   * interchangeable — a game draws whichever it is given and never lays out for two shapes.
   */
  get steady(): number {
    return this.active ? STEADY_LEVEL : 0;
  }

  /** Whichever of the two the device has asked for. This is what a game draws. */
  levelFor(motion: MotionPreference): number {
    return motion.reducedMotion === true ? this.steady : this.intensity;
  }

  /**
   * Raise a flash. One that would not outlast the flash already running is ignored; a longer
   * one takes over from full, so a second hit re-lights rather than fading out on schedule.
   */
  raise(seconds: number): void {
    assertNonNegative(seconds, 'seconds');
    const remaining = this.active ? this.#durationSeconds - this.#elapsed : 0;
    if (seconds <= remaining) return;
    this.#durationSeconds = seconds;
    this.#elapsed = 0;
  }

  step(fixedDeltaSeconds: number): void {
    assertNonNegative(fixedDeltaSeconds, 'fixedDeltaSeconds');
    if (!this.active) return;
    this.#elapsed += fixedDeltaSeconds;
    // Compared against the field rather than re-read from `active`: the getter was narrowed
    // by the guard above and the typed lint holds it there through the mutation.
    if (this.#elapsed >= this.#durationSeconds) this.clear();
  }

  clear(): void {
    this.#durationSeconds = 0;
    this.#elapsed = 0;
  }
}

/**
 * A hold on the picture, counted on the fixed timestep and capped at {@link MAX_HOLD_SECONDS}.
 *
 * Read it at the top of `render()` and return without drawing while it holds. The simulation
 * is not consulted and is not affected; see the note at the top of this file for the whole
 * argument, including why a version that stops the world is deterministic and still wrong.
 */
export class HitStop {
  #remaining = 0;

  /** True while the picture should be held. Unconditional — {@link HitStop.holdingFor} filters. */
  get holding(): boolean {
    return this.#remaining > 0;
  }

  get remainingSeconds(): number {
    return this.#remaining;
  }

  /**
   * Whether to hold this frame, given what the device has asked for.
   *
   * False under reduced motion, always. A hold that ends throws the whole world forward by
   * however long it lasted, and that jump is the sudden movement the preference exists to
   * avoid — so the effect is not merely reduced, it is declined. Nothing is lost by declining
   * it: {@link Impact.strike} raises the flash on the same call, and the flash's steady form
   * covers the same window.
   */
  holdingFor(motion: MotionPreference): boolean {
    return motion.reducedMotion === true ? false : this.holding;
  }

  /** Hold for `seconds`, clamped to the cap, extending rather than shortening a running hold. */
  hold(seconds: number): void {
    assertNonNegative(seconds, 'seconds');
    const capped = seconds > MAX_HOLD_SECONDS ? MAX_HOLD_SECONDS : seconds;
    if (capped > this.#remaining) this.#remaining = capped;
  }

  step(fixedDeltaSeconds: number): void {
    assertNonNegative(fixedDeltaSeconds, 'fixedDeltaSeconds');
    if (this.#remaining === 0) return;
    this.#remaining -= fixedDeltaSeconds;
    if (this.#remaining < 0) this.#remaining = 0;
  }

  clear(): void {
    this.#remaining = 0;
  }
}

export interface ImpactOptions {
  /** Seconds to hold the picture per strike. Clamped to {@link MAX_HOLD_SECONDS}. */
  readonly holdSeconds?: number;
  readonly shake?: ShakeOptions;
  readonly flash?: FlashOptions;
}

/** Three steps at sixty hertz: long enough to register, short enough that the catch-up snaps. */
const DEFAULT_HOLD_SECONDS = 0.05;

/**
 * The three primitives raised together, so that the one a player may not be shown is never
 * the only one raised.
 *
 * This is rule 7's structure rather than its letter. Colour is never the only signal because
 * a player may not be able to receive colour; motion must never be the only signal because a
 * player may have asked not to receive motion. A `strike()` raises the shake, the flash and
 * the hold at once, so the shake cannot be the only thing carrying the news — and a game that
 * wants only one of them reaches for that one class directly, which is a visible decision
 * rather than an omission.
 */
export class Impact {
  readonly shake: Shake;
  readonly flash: Flash;
  readonly hitStop: HitStop;
  readonly #holdSeconds: number;

  constructor(options?: ImpactOptions) {
    const hold = options?.holdSeconds ?? DEFAULT_HOLD_SECONDS;
    assertNonNegative(hold, 'holdSeconds');
    this.#holdSeconds = hold;
    this.shake = new Shake(options?.shake);
    this.flash = new Flash(options?.flash);
    this.hitStop = new HitStop();
  }

  get active(): boolean {
    return this.shake.active || this.flash.active || this.hitStop.holding;
  }

  /**
   * Something was hit. `magnitude` is the peak shake in logical units; `seconds` is how long
   * the shake and the flash last.
   */
  strike(magnitude: number, seconds: number): void {
    this.shake.kick(magnitude, seconds);
    this.flash.raise(seconds);
    this.hitStop.hold(this.#holdSeconds);
  }

  step(fixedDeltaSeconds: number): void {
    this.shake.step(fixedDeltaSeconds);
    this.flash.step(fixedDeltaSeconds);
    this.hitStop.step(fixedDeltaSeconds);
  }

  clear(): void {
    this.shake.clear();
    this.flash.clear();
    this.hitStop.clear();
  }
}

/**
 * Displace everything drawn until the matching {@link releaseShake} by the shake's offset.
 *
 * A free function rather than something a game calls on the renderer, because `pushShake` is
 * optional on {@link Renderer} — required members would break the fifty-odd hand-written
 * renderers in the games' tests all at once, which is the reason `GameContext.reducedMotion`
 * is optional too. Handling that here means one `?.` in the engine instead of two in every
 * game, and it means the pair stays balanced: a renderer that implements neither no-ops both.
 *
 * The preference is applied by the renderer, not here. Call this after `clear()` and before
 * the world, so the background stays put and the play area moves against it.
 */
export function applyShake(renderer: Renderer, shake: Shake): void {
  renderer.pushShake?.(shake.offsetX, shake.offsetY);
}

/** Undo the most recent {@link applyShake}. Pair them exactly, including when nothing shook. */
export function releaseShake(renderer: Renderer): void {
  renderer.popShake?.();
}
