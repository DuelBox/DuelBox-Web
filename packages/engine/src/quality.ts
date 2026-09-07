/**
 * Adaptive quality scaling from a frame-time monitor.
 *
 * One quality setting cannot serve a flagship phone and a sub-$150 Android. This
 * watches how long frames are taking and steps *presentation* quality down when the
 * device falls behind, and back up when it has headroom — so quality degrades
 * before the frame rate does, rather than the other way round.
 *
 * It reads no clock. The host measures each frame's duration (with `performance`,
 * which only the host may touch) and hands it in through {@link AdaptiveQuality.sample};
 * the monitor keeps a rolling window and decides. Deciding on real elapsed seconds
 * accumulated from those very samples — not a wall clock — keeps it deterministic and
 * testable: feed it a scripted sequence of frame times and it steps predictably.
 *
 * Crucially it never touches anything the simulation reads. It outputs a particle
 * scale, a device-pixel-ratio cap, and an effects flag — all presentation. A match
 * steps byte-for-byte identically at every quality level, which a test pins down by
 * running a simulation while quality churns and comparing the output.
 */

export interface QualityLevel {
  /** Multiplier a particle system applies to its emission counts, in [0, 1]. */
  readonly particleScale: number;
  /** Ceiling on device pixel ratio the renderer honours at this level. */
  readonly dprCap: number;
  /** Whether non-essential effects (extra flashes, trails) run at this level. */
  readonly effectsEnabled: boolean;
}

/** The default ladder, best first. Each step down is cheaper to render. */
export const DEFAULT_QUALITY_LEVELS: readonly QualityLevel[] = Object.freeze([
  Object.freeze({ particleScale: 1, dprCap: 2, effectsEnabled: true }),
  Object.freeze({ particleScale: 0.6, dprCap: 1.5, effectsEnabled: true }),
  Object.freeze({ particleScale: 0.3, dprCap: 1, effectsEnabled: false }),
]);

export interface AdaptiveQualityOptions {
  /** Target frame time in seconds. Default 1/60. */
  readonly budgetSeconds?: number;
  /** Rolling window length in frames the average is taken over. Default 30. */
  readonly windowFrames?: number;
  /** Seconds the windowed average must stay over budget before stepping down. Default 2. */
  readonly degradeAfterSeconds?: number;
  /** Seconds comfortably under budget before stepping back up. Default 4 (hysteresis). */
  readonly upgradeAfterSeconds?: number;
  /** Average must fall below budget * this to count as comfortable. Default 0.75. */
  readonly recoverFactor?: number;
  /** The quality ladder, best first. Defaults to {@link DEFAULT_QUALITY_LEVELS}. */
  readonly levels?: readonly QualityLevel[];
}

const DEFAULT_BUDGET = 1 / 60;

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, received ${String(value)}`);
  }
}

export class AdaptiveQuality {
  readonly #levels: readonly QualityLevel[];
  readonly #budget: number;
  readonly #degradeAfter: number;
  readonly #upgradeAfter: number;
  readonly #recoverFactor: number;

  readonly #window: Float64Array;
  #windowIndex = 0;
  #windowFilled = 0;
  #windowSum = 0;

  #level = 0;
  #overBudgetSeconds = 0;
  #underBudgetSeconds = 0;

  constructor(options?: AdaptiveQualityOptions) {
    const budget = options?.budgetSeconds ?? DEFAULT_BUDGET;
    const windowFrames = options?.windowFrames ?? 30;
    const degradeAfter = options?.degradeAfterSeconds ?? 2;
    const upgradeAfter = options?.upgradeAfterSeconds ?? 4;
    const recoverFactor = options?.recoverFactor ?? 0.75;
    assertPositiveFinite(budget, 'budgetSeconds');
    assertPositiveFinite(degradeAfter, 'degradeAfterSeconds');
    assertPositiveFinite(upgradeAfter, 'upgradeAfterSeconds');
    if (!Number.isInteger(windowFrames) || windowFrames <= 0) {
      throw new RangeError(`windowFrames must be a positive integer, received ${String(windowFrames)}`);
    }
    if (!(recoverFactor > 0) || recoverFactor > 1) {
      throw new RangeError(`recoverFactor must be in (0, 1], received ${String(recoverFactor)}`);
    }
    const levels = options?.levels ?? DEFAULT_QUALITY_LEVELS;
    if (levels.length === 0) {
      throw new RangeError('AdaptiveQuality needs at least one quality level');
    }
    this.#levels = levels;
    this.#budget = budget;
    this.#degradeAfter = degradeAfter;
    this.#upgradeAfter = upgradeAfter;
    this.#recoverFactor = recoverFactor;
    this.#window = new Float64Array(windowFrames);
  }

  /** Current level index; 0 is the best. */
  get level(): number {
    return this.#level;
  }

  get levelCount(): number {
    return this.#levels.length;
  }

  get budgetSeconds(): number {
    return this.#budget;
  }

  get particleScale(): number {
    return this.#levels[this.#level]!.particleScale;
  }

  get dprCap(): number {
    return this.#levels[this.#level]!.dprCap;
  }

  get effectsEnabled(): boolean {
    return this.#levels[this.#level]!.effectsEnabled;
  }

  /** Windowed average frame time in seconds, or 0 before the first sample. */
  get averageFrameSeconds(): number {
    return this.#windowFilled === 0 ? 0 : this.#windowSum / this.#windowFilled;
  }

  /**
   * Feed one frame's measured duration. Updates the rolling average and may step the
   * quality level down (sustained over budget) or up (sustained comfortably under).
   * Allocation-free.
   */
  sample(frameTimeSeconds: number): void {
    if (!Number.isFinite(frameTimeSeconds) || frameTimeSeconds < 0) {
      throw new RangeError(
        `frameTimeSeconds must be a non-negative number, received ${String(frameTimeSeconds)}`,
      );
    }
    // Slide the ring buffer, maintaining the running sum in O(1).
    if (this.#windowFilled === this.#window.length) {
      this.#windowSum -= this.#window[this.#windowIndex]!;
    } else {
      this.#windowFilled += 1;
    }
    this.#window[this.#windowIndex] = frameTimeSeconds;
    this.#windowSum += frameTimeSeconds;
    this.#windowIndex = (this.#windowIndex + 1) % this.#window.length;

    const avg = this.#windowSum / this.#windowFilled;
    if (avg > this.#budget) {
      this.#overBudgetSeconds += frameTimeSeconds;
      this.#underBudgetSeconds = 0;
      if (this.#overBudgetSeconds >= this.#degradeAfter && this.#level < this.#levels.length - 1) {
        this.#level += 1;
        this.#overBudgetSeconds = 0;
      }
    } else {
      this.#overBudgetSeconds = 0;
      if (avg < this.#budget * this.#recoverFactor) {
        this.#underBudgetSeconds += frameTimeSeconds;
        if (this.#underBudgetSeconds >= this.#upgradeAfter && this.#level > 0) {
          this.#level -= 1;
          this.#underBudgetSeconds = 0;
        }
      } else {
        this.#underBudgetSeconds = 0;
      }
    }
  }

  /** Force a level, e.g. a host override or a user setting. Clears the sustained timers. */
  forceLevel(level: number): void {
    if (!Number.isInteger(level) || level < 0 || level >= this.#levels.length) {
      throw new RangeError(`level must be an integer in [0, ${this.#levels.length - 1}]`);
    }
    this.#level = level;
    this.#overBudgetSeconds = 0;
    this.#underBudgetSeconds = 0;
  }

  /** Back to the best level with an empty window. */
  reset(): void {
    this.#level = 0;
    this.#overBudgetSeconds = 0;
    this.#underBudgetSeconds = 0;
    this.#windowIndex = 0;
    this.#windowFilled = 0;
    this.#windowSum = 0;
    this.#window.fill(0);
  }
}
