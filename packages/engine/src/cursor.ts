/**
 * A keyboard cursor over a grid.
 *
 * Turn-based games are the ones a keyboard player is most likely to reach for and the
 * ones most likely to have been built pointer-first: a tap names a square directly, so
 * there is nothing to move, and the keyboard quietly ends up with no way in at all. That
 * is not a fallback being imperfect, it is a game a player cannot play.
 *
 * Shared rather than per-game because three games need it today and the hundred still to
 * come will need the same thing — and because "which square is selected" must behave
 * identically everywhere or learning one game teaches you nothing about the next.
 *
 * Two details carry most of the value:
 *
 * **It stays invisible until a key is used.** A touch player must never see a highlight
 * they did not summon, and a game must not have to ask what kind of device it is on
 * (CLAUDE.md rule 10) to decide. Pressing a direction wakes it; that is the only trigger.
 *
 * **It moves in the device's frame, and maps that onto the board.** A direction key is
 * absolute in device space: `input.ts` hands every seat a vector where +y is *down the
 * device*, whichever side of it the player sits. When a board is drawn half a turn round
 * to face the far seat, "down the device" is *up* that board, so the vector has to be
 * turned before it becomes a row and a column — exactly the mapping `toWorld` applies to
 * a pointer on the same board. The caller says whether the board is drawn rotated and the
 * cursor does the turn, so no game repeats the reasoning and no game gets it backwards.
 *
 * This is one rotation, not two. The flip rotates the *drawing*; this rotates the
 * *input* into the drawing's coordinates. Both are needed, and they are the same half
 * turn — which is why every call site passes the same boolean here that it passes to
 * `toWorld` for its pointer (#2521). A board drawn upright on a far seat's half of the
 * device, as Sea Battle's placing boards and Penalty Kicks' selectors are, passes `false`
 * to both, and its cursor moves the way the arrow on the key points.
 */

/** How long a held direction waits before it starts repeating, in seconds. */
const REPEAT_DELAY_SECONDS = 0.4;
/** How long between repeats once it has started. */
const REPEAT_INTERVAL_SECONDS = 0.12;
/** Below this a direction is noise, not intent. */
const DEAD_ZONE = 0.5;

export interface GridCursorOptions {
  readonly columns: number;
  readonly rows: number;
  /** Where the cursor sits before it is first moved. Defaults to the middle. */
  readonly startIndex?: number;
  /** Whether moving off an edge comes back on the far side. Defaults to false. */
  readonly wrap?: boolean;
}

export class GridCursor {
  readonly columns: number;
  readonly rows: number;
  readonly #wrap: boolean;
  readonly #startIndex: number;

  #index: number;
  /** False until a direction is pressed, so a touch player never sees a stray highlight. */
  #visible = false;
  /** Direction held on the previous step, for edge detection. */
  #heldX = 0;
  #heldY = 0;
  /** Seconds until the held direction repeats; zero when nothing is held. */
  #repeatIn = 0;

  constructor(options: GridCursorOptions) {
    const { columns, rows } = options;
    if (!Number.isInteger(columns) || columns < 1) {
      throw new RangeError(`columns must be a positive integer, received ${String(columns)}`);
    }
    if (!Number.isInteger(rows) || rows < 1) {
      throw new RangeError(`rows must be a positive integer, received ${String(rows)}`);
    }
    this.columns = columns;
    this.rows = rows;
    this.#wrap = options.wrap ?? false;
    const middle = Math.floor((rows * columns) / 2);
    const start = options.startIndex ?? middle;
    if (!Number.isInteger(start) || start < 0 || start >= rows * columns) {
      throw new RangeError(`startIndex must be inside the grid, received ${String(start)}`);
    }
    this.#startIndex = start;
    this.#index = start;
  }

  /** The selected cell, as an index into a row-major grid. */
  get index(): number {
    return this.#index;
  }

  get column(): number {
    return this.#index % this.columns;
  }

  get row(): number {
    return Math.floor(this.#index / this.columns);
  }

  /**
   * Whether the cursor should be drawn.
   *
   * False until a direction has been pressed. A game asks this rather than deciding for
   * itself, so a player who has only ever tapped never sees a highlight.
   */
  get visible(): boolean {
    return this.#visible;
  }

  /** Put the cursor back where it started and hide it again. */
  reset(): void {
    this.#index = this.#startIndex;
    this.#visible = false;
    this.#heldX = 0;
    this.#heldY = 0;
    this.#repeatIn = 0;
  }

  /** Move it somewhere directly, without making it visible. */
  moveTo(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.rows * this.columns) {
      throw new RangeError(`index must be inside the grid, received ${String(index)}`);
    }
    this.#index = index;
  }

  /**
   * Advance by one fixed step.
   *
   * `moveX`/`moveY` are the seat's direction vector in *device* orientation, as the input
   * system hands it over: +y is down the device. `rotated` says whether the board this
   * cursor sits on is drawn half a turn round — the same flag the caller gives `toWorld`
   * for a pointer on that board — and when it is, both axes are turned so a press moves
   * the on-screen highlight the way the arrow on the key points.
   *
   * Returns true if the cursor moved this step, so a caller can play a tick.
   */
  step(moveX: number, moveY: number, fixedDeltaSeconds: number, rotated = false): boolean {
    if (!Number.isFinite(fixedDeltaSeconds) || fixedDeltaSeconds < 0) {
      throw new RangeError(
        `fixedDeltaSeconds must be a non-negative number, received ${String(fixedDeltaSeconds)}`,
      );
    }
    // Quantised to one of nine directions before anything else: a grid has no use for
    // the magnitude, and quantising here means a thumbstick and a key behave the same.
    const x = quantise(moveX);
    const y = quantise(moveY);

    if (x === 0 && y === 0) {
      this.#heldX = 0;
      this.#heldY = 0;
      this.#repeatIn = 0;
      return false;
    }

    const changed = x !== this.#heldX || y !== this.#heldY;
    this.#heldX = x;
    this.#heldY = y;

    if (changed) {
      // A fresh press moves immediately and then waits, so a tap is one cell and a hold
      // travels — the behaviour every text cursor has and nobody has to be taught.
      this.#repeatIn = REPEAT_DELAY_SECONDS;
      return this.#apply(x, y, rotated);
    }

    this.#repeatIn -= fixedDeltaSeconds;
    if (this.#repeatIn > 0) return false;
    this.#repeatIn = REPEAT_INTERVAL_SECONDS;
    return this.#apply(x, y, rotated);
  }

  #apply(x: number, y: number, rotated: boolean): boolean {
    this.#visible = true;
    // The board is drawn half a turn round, so a device-frame direction turns with it:
    // the same half turn `toWorld` gives a pointer, applied to a key.
    const dx = rotated ? -x : x;
    const dy = rotated ? -y : y;

    let column = this.column + dx;
    let row = this.row + dy;

    if (this.#wrap) {
      column = ((column % this.columns) + this.columns) % this.columns;
      row = ((row % this.rows) + this.rows) % this.rows;
    } else {
      column = clamp(column, 0, this.columns - 1);
      row = clamp(row, 0, this.rows - 1);
    }

    const next = row * this.columns + column;
    if (next === this.#index) return false;
    this.#index = next;
    return true;
  }
}

function quantise(value: number): number {
  if (value > DEAD_ZONE) return 1;
  if (value < -DEAD_ZONE) return -1;
  return 0;
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}
