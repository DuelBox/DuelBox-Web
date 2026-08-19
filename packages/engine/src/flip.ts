/**
 * The half-turn the play area makes when the turn changes.
 *
 * Two people sit on opposite sides of one device. When it becomes the other player's
 * move the board turns to face them, so each person reads it upright — the single most
 * distinctive thing about playing a turn-based game this way, and the thing that makes
 * a shared phone feel like a board on a table rather than a screen one of them is
 * holding sideways.
 *
 * It is a pure tween over the fixed timestep: no wall clock, no timers, no DOM. Two
 * devices stepping the same match rotate through the same angles on the same steps.
 *
 * The one rule that matters for correctness is that **input ownership changes at a
 * single instant, never continuously**. Interpolating the input mapping through the
 * turn would mean a tap halfway through landed in a seat neither player intended, and
 * whose it was would depend on frame timing. Here the settled orientation holds until
 * the flip completes, and input is suppressed while it runs.
 */

const HALF_TURN = Math.PI;

/** Long enough to read as a turn of the board, short enough not to be a wait. */
const DEFAULT_DURATION_SECONDS = 0.36;

export interface SeatFlipOptions {
  /** Seconds for a half turn. Zero means every flip is instant. */
  readonly durationSeconds?: number;
  /** Orientation to start settled in. */
  readonly rotated?: boolean;
}

export class SeatFlip {
  readonly #durationSeconds: number;
  /** The settled orientation. Input is mapped by this, and it never changes mid-flip. */
  #rotated: boolean;
  /** Where the tween is heading. Equal to `#rotated` when nothing is running. */
  #target: boolean;
  /** Seconds elapsed in the running flip; zero when settled. */
  #elapsed = 0;

  constructor(options?: SeatFlipOptions) {
    const duration = options?.durationSeconds ?? DEFAULT_DURATION_SECONDS;
    if (!Number.isFinite(duration) || duration < 0) {
      throw new RangeError(
        `durationSeconds must be a non-negative number, received ${String(duration)}`,
      );
    }
    this.#durationSeconds = duration;
    this.#rotated = options?.rotated ?? false;
    this.#target = this.#rotated;
  }

  /**
   * The orientation input is mapped by. Holds its old value for the whole flip and
   * changes exactly once, on the step the flip completes.
   */
  get rotated(): boolean {
    return this.#rotated;
  }

  get isFlipping(): boolean {
    return this.#rotated !== this.#target;
  }

  /** How far through the running flip, in [0, 1]. Zero when settled. */
  get progress(): number {
    if (!this.isFlipping) return 0;
    if (this.#durationSeconds === 0) return 1;
    return Math.min(1, this.#elapsed / this.#durationSeconds);
  }

  /**
   * Current rotation in radians, in [0, π]. This is the only value the renderer needs;
   * it is eased, so the board slows into its new orientation rather than stopping dead.
   */
  get angle(): number {
    const settled = this.#rotated ? HALF_TURN : 0;
    if (!this.isFlipping) return settled;
    const eased = smootherstep(this.progress);
    // Always travels the same direction for a given pair of orientations, so a flip
    // and its reverse are mirror images rather than one of them going the long way.
    return this.#rotated ? HALF_TURN * (1 - eased) : HALF_TURN * eased;
  }

  /**
   * Whether a game should accept input this step.
   *
   * False through the whole flip: the board is moving and a tap on it would land
   * somewhere the player did not aim.
   */
  get acceptsInput(): boolean {
    return !this.isFlipping;
  }

  /**
   * Aim at an orientation. Re-aiming at the orientation already settled in cancels a
   * running flip and returns immediately, so a turn that is undone does not leave the
   * board rotating towards a seat that no longer has the move.
   */
  retarget(rotated: boolean): void {
    if (rotated === this.#target) return;
    if (rotated === this.#rotated) {
      // Reversing mid-flip: drop back to settled rather than tweening backwards from
      // a partial angle, which would take a different time than a fresh flip.
      this.#target = this.#rotated;
      this.#elapsed = 0;
      return;
    }
    this.#target = rotated;
    this.#elapsed = 0;
    if (this.#durationSeconds === 0) this.#settle();
  }

  /** Jump to an orientation with no tween. Used for reduced motion and on a reset. */
  snap(rotated: boolean): void {
    this.#rotated = rotated;
    this.#target = rotated;
    this.#elapsed = 0;
  }

  /** Advance by one fixed simulation step. */
  step(fixedDeltaSeconds: number): void {
    if (!Number.isFinite(fixedDeltaSeconds) || fixedDeltaSeconds < 0) {
      throw new RangeError(
        `fixedDeltaSeconds must be a non-negative number, received ${String(fixedDeltaSeconds)}`,
      );
    }
    if (!this.isFlipping) return;
    this.#elapsed += fixedDeltaSeconds;
    if (this.#elapsed >= this.#durationSeconds) this.#settle();
  }

  #settle(): void {
    this.#rotated = this.#target;
    this.#elapsed = 0;
  }
}

/** Smootherstep: zero first and second derivative at both ends, so the turn has no kick. */
function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
