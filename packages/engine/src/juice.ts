/**
 * Juice primitives: screen shake, hit-stop, and flash.
 *
 * These three effects account for most of the felt gap between a prototype and a
 * shipped game. They are built once here and reused everywhere, each driven by a
 * single 0..1 intensity so a game says "how hard" and nothing else.
 *
 * They are strictly presentation. Not one of them touches the simulation: shake
 * produces a render offset, flash an overlay opacity, hit-stop a *presentation*
 * time scale that slows tweens and particles — never the fixed step. The board a
 * game simulates is byte-identical whether or not any of these are running, which
 * is what keeps a cross-device match honest (rule 8) and is proven by a test that
 * steps the same simulation with and without juice and compares.
 *
 * They are deterministic. Shake draws its direction from the seeded {@link Rng},
 * so two devices given the same seed and the same triggers shake through the same
 * offsets. Nothing here reads a wall clock; everything advances on the fixed delta.
 *
 * They compose safely. Firing an effect while it is already running saturates
 * rather than stacks, so the offset is bounded by a fixed amplitude however many
 * hits land at once — a gameplay-relevant element is never shaken out of reach.
 *
 * Under reduced motion the two *moving* effects (shake, and the shove hit-stop can
 * imply) stop moving and hand back a non-motion `cue` in their place, so the moment
 * still reads — as a border pulse or a flash the renderer chooses — rather than
 * vanishing. Flash is itself a non-motion cue and stays.
 */

import type { Rng } from './rng.js';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, received ${String(value)}`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number, received ${String(value)}`);
  }
}

export interface ScreenShakeOptions {
  /**
   * Largest render offset, in LOGICAL units, at full trauma. The offset never
   * exceeds this whatever the trauma, so a game element can be shaken but never
   * pushed further than the game allows for.
   */
  readonly maxAmplitudeLogical: number;
  /** Seconds a single full-trauma hit takes to decay to still. */
  readonly decaySeconds: number;
}

/**
 * A render offset that jitters and decays.
 *
 * `add(intensity)` raises the trauma; trauma decays to zero over `decaySeconds`
 * and the offset is `maxAmplitude * trauma^2 * noise`, so a small hit barely
 * registers and a big one is felt without ever leaving the arena. Squaring trauma
 * is the standard trick that makes the tail fall away smoothly instead of clipping.
 *
 * The offset is what the renderer adds to its transform. It is never added to a
 * body: the simulation does not know shake exists.
 */
export class ScreenShake {
  readonly #rng: Rng;
  readonly #maxAmplitude: number;
  readonly #decaySeconds: number;

  #trauma = 0;
  #offsetX = 0;
  #offsetY = 0;
  #reducedMotion = false;

  constructor(rng: Rng, options: ScreenShakeOptions) {
    assertPositiveFinite(options.maxAmplitudeLogical, 'maxAmplitudeLogical');
    assertPositiveFinite(options.decaySeconds, 'decaySeconds');
    this.#rng = rng;
    this.#maxAmplitude = options.maxAmplitudeLogical;
    this.#decaySeconds = options.decaySeconds;
  }

  /** Current trauma in [0, 1]. Also the non-motion cue level under reduced motion. */
  get trauma(): number {
    return this.#trauma;
  }

  /**
   * A non-motion signal in [0, 1] the renderer can show instead of movement — a
   * border pulse, an edge flash. Equal to trauma, and available whether or not
   * reduced motion is on, so the cue is consistent across preferences.
   */
  get cue(): number {
    return this.#trauma;
  }

  /** Render offset X in logical units. Always 0 under reduced motion. */
  get offsetX(): number {
    return this.#offsetX;
  }

  /** Render offset Y in logical units. Always 0 under reduced motion. */
  get offsetY(): number {
    return this.#offsetY;
  }

  get reducedMotion(): boolean {
    return this.#reducedMotion;
  }

  /**
   * Add a hit of the given intensity. Simultaneous hits saturate at full trauma
   * rather than summing past it, so the offset stays bounded by the max amplitude.
   */
  add(intensity: number): void {
    this.#trauma = clamp01(this.#trauma + clamp01(intensity));
  }

  /**
   * Switch the non-motion presentation. Motion stops immediately (the offset is
   * zeroed) but trauma keeps decaying, so `cue` still falls away naturally.
   */
  setReducedMotion(reduced: boolean): void {
    this.#reducedMotion = reduced;
    if (reduced) {
      this.#offsetX = 0;
      this.#offsetY = 0;
    }
  }

  /** Advance by one fixed step. Draws two seeded samples per step while shaking. Allocates nothing. */
  step(fixedDeltaSeconds: number): void {
    assertNonNegativeFinite(fixedDeltaSeconds, 'fixedDeltaSeconds');
    if (this.#trauma > 0) {
      const decay = fixedDeltaSeconds / this.#decaySeconds;
      this.#trauma = this.#trauma > decay ? this.#trauma - decay : 0;
    }
    if (this.#reducedMotion || this.#trauma === 0) {
      this.#offsetX = 0;
      this.#offsetY = 0;
      return;
    }
    // Squared trauma: the tail eases out rather than clipping to zero.
    const amplitude = this.#maxAmplitude * this.#trauma * this.#trauma;
    // float() is [0,1); map to [-1, 1). Two independent draws keep x and y uncorrelated.
    this.#offsetX = amplitude * (this.#rng.float() * 2 - 1);
    this.#offsetY = amplitude * (this.#rng.float() * 2 - 1);
  }

  /** Clear all shake at once. */
  reset(): void {
    this.#trauma = 0;
    this.#offsetX = 0;
    this.#offsetY = 0;
  }
}

export interface HitStopOptions {
  /** Seconds a full-intensity hit holds presentation still. */
  readonly maxHoldSeconds: number;
}

/**
 * A brief hold on *presentation* time after an impact.
 *
 * Classic hit-stop freezes the whole game for a few frames; that would desync a
 * cross-device match and is forbidden here. This hit-stop instead reports a
 * presentation time scale in {0, 1}: while it holds, the renderer advances its
 * tweens, particles and shake by `dt * timeScale` (i.e. not at all), but the
 * fixed simulation steps on exactly as it always does. The impact reads as a
 * held frame without a single simulation step being skipped or repeated.
 *
 * Simultaneous hits take the longer hold rather than summing, so a flurry does
 * not freeze the screen for a second.
 */
export class HitStop {
  readonly #maxHold: number;
  #remaining = 0;

  constructor(options: HitStopOptions) {
    assertPositiveFinite(options.maxHoldSeconds, 'maxHoldSeconds');
    this.#maxHold = options.maxHoldSeconds;
  }

  /** True while presentation is held. */
  get frozen(): boolean {
    return this.#remaining > 0;
  }

  /** Seconds of hold left. */
  get remainingSeconds(): number {
    return this.#remaining;
  }

  /**
   * Presentation time scale in {0, 1}: 0 while frozen, 1 otherwise. Multiply a
   * presentation dt by this; never a simulation dt.
   */
  get timeScale(): number {
    return this.#remaining > 0 ? 0 : 1;
  }

  /** Trigger a hold of `intensity` * maxHold seconds. Takes the longer of the two if already held. */
  add(intensity: number): void {
    const hold = clamp01(intensity) * this.#maxHold;
    if (hold > this.#remaining) this.#remaining = hold;
  }

  /** Advance by one fixed step. Allocates nothing. */
  step(fixedDeltaSeconds: number): void {
    assertNonNegativeFinite(fixedDeltaSeconds, 'fixedDeltaSeconds');
    if (this.#remaining > 0) {
      this.#remaining =
        this.#remaining > fixedDeltaSeconds ? this.#remaining - fixedDeltaSeconds : 0;
    }
  }

  reset(): void {
    this.#remaining = 0;
  }
}

export interface FlashOptions {
  /** Seconds a full-intensity flash takes to fade to nothing. */
  readonly fadeSeconds: number;
}

/**
 * A screen-wide overlay opacity that spikes and fades.
 *
 * `alpha` is what the renderer paints the overlay at — 0 is invisible, 1 is a
 * full wash of whatever colour the renderer chooses. A flash is not motion, so
 * it is left on under reduced motion, where it doubles as the non-motion cue a
 * shake hands off to.
 *
 * Simultaneous flashes take the brighter rather than summing past full, so the
 * overlay never blows past opaque.
 */
export class Flash {
  readonly #fadeSeconds: number;
  #alpha = 0;

  constructor(options: FlashOptions) {
    assertPositiveFinite(options.fadeSeconds, 'fadeSeconds');
    this.#fadeSeconds = options.fadeSeconds;
  }

  /** Overlay opacity in [0, 1]. */
  get alpha(): number {
    return this.#alpha;
  }

  /** Flash at `intensity`. Takes the brighter of the two if one is already fading. */
  add(intensity: number): void {
    const a = clamp01(intensity);
    if (a > this.#alpha) this.#alpha = a;
  }

  /** Advance by one fixed step. Allocates nothing. */
  step(fixedDeltaSeconds: number): void {
    assertNonNegativeFinite(fixedDeltaSeconds, 'fixedDeltaSeconds');
    if (this.#alpha > 0) {
      const fade = fixedDeltaSeconds / this.#fadeSeconds;
      this.#alpha = this.#alpha > fade ? this.#alpha - fade : 0;
    }
  }

  reset(): void {
    this.#alpha = 0;
  }
}
