import {
  GridCursor,
  Rng,
  SEAT_PALETTE,
  SeatFlip,
  otherSeat,
  seatView,
  set,
  toWorld,
  vec2,
} from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId, Vec2 } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type {
  Game,
  GameContext,
  InputState,
  MatchScore,
  Renderer,
  WinCondition,
} from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BLUNDER_CHANCE,
  BOARD_COLUMNS,
  CELL_COUNT,
  applyMove,
  bestMove,
  createBoard,
  winnerOf,
  winningLineInto,
} from './rules.js';
import type { BotDifficulty, Cell } from './rules.js';

/**
 * Board geometry in logical units. Exported because aiming at a cell is not a rendering
 * question: a pointer-driven bot and the tests need the same mapping the game uses.
 */
export const BOARD_ORIGIN = 120;
export const BOARD_EXTENT = 660;
export const CELL_EXTENT = BOARD_EXTENT / BOARD_COLUMNS;

/** Best of five: three round wins takes the match, five rounds settle it either way. */
const ROUNDS_TO_WIN = 3;
const MAX_ROUNDS = 5;

/**
 * Both delays are converted to whole simulation steps before they are counted down, so
 * a replay of the same inputs produces the same match on any machine.
 */
const THINK_SECONDS = 0.45;
const SETTLE_SECONDS = 0.9;

const COLOUR_BACKGROUND = '#12161c';
const COLOUR_GRID = '#5a6472';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;
const COLOUR_STRIKE = '#f4f4f5';

const GRID_WIDTH = 8;
/** The keyboard cursor sits inside its cell so it never touches the grid lines. */
const CURSOR_INSET = 10;
const CURSOR_WIDTH = 6;
const MARK_RADIUS = 66;
const MARK_WIDTH = 14;
/** Half-diagonal of the cross, as a fraction of the circle's radius. */
const CROSS_REACH = 0.78;
const STRIKE_WIDTH = 16;
const STRIKE_OVERHANG = 46;

/** Centre of a cell in logical units. Writes into `out` and allocates nothing. */
export function cellCentre(out: Vec2, index: number): Vec2 {
  const column = index % BOARD_COLUMNS;
  const row = Math.floor(index / BOARD_COLUMNS);
  return set(
    out,
    BOARD_ORIGIN + (column + 0.5) * CELL_EXTENT,
    BOARD_ORIGIN + (row + 0.5) * CELL_EXTENT,
  );
}

/** Cell a point in board space falls in, or -1 when it misses the board entirely. */
export function cellIndexAt(x: number, y: number): number {
  const localX = x - BOARD_ORIGIN;
  const localY = y - BOARD_ORIGIN;
  if (localX < 0 || localY < 0 || localX >= BOARD_EXTENT || localY >= BOARD_EXTENT) return -1;
  const column = Math.floor(localX / CELL_EXTENT);
  const row = Math.floor(localY / CELL_EXTENT);
  return row * BOARD_COLUMNS + column;
}

export class TicTacToeGame implements Game {
  readonly #board: Cell[] = createBoard();
  readonly #tally = { p1: 0, p2: 0 };
  readonly #condition: WinCondition = { kind: 'first-to', target: ROUNDS_TO_WIN };
  readonly #options = { timeExpired: false };
  readonly #strikeLine: number[] = [0, 0, 0];
  readonly #pointerWorld: Vec2 = vec2();
  /** Render-only scratch. Written during render(), never read by the simulation. */
  readonly #scratchA: Vec2 = vec2();
  readonly #scratchB: Vec2 = vec2();

  #rng: Rng = new Rng(0);
  #logical: LogicalSize = manifest.logical;
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  /**
   * The board turning to face whoever has the move.
   *
   * It steps on the fixed timestep like everything else, so two devices rotate through
   * the same angles on the same steps. Reduced motion is handled by the renderer, not
   * here — the flip must still *step* identically everywhere or the two would disagree
   * about when input reopens.
   */
  readonly #flip = new SeatFlip();
  /**
   * The keyboard's way onto the board.
   *
   * Without it this game is pointer-only: a tap names a square directly, so there was
   * nothing for a keyboard to move and two people sharing a laptop could not play at all.
   */
  readonly #cursor = new GridCursor({ columns: BOARD_COLUMNS, rows: BOARD_COLUMNS });
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;

  #startingSeat: SeatId = 'p1';
  #active: SeatId = 'p1';
  #roundOutcome: SeatId | 'draw' | null = null;
  #matchWinner: SeatId | 'draw' | null = null;
  #hasStrike = false;
  #roundsPlayed = 0;

  /** Negative until the turn's delay has been sized in steps. */
  #thinkSteps = -1;
  #settleSteps = 0;
  #stepsPerSecond = 0;

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#logical = context.manifest.logical;
    this.#presentation = context.presentation;
    this.#localSeat = context.localSeat;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');

    this.#tally.p1 = 0;
    this.#tally.p2 = 0;
    this.#options.timeExpired = false;
    this.#matchWinner = null;
    this.#roundsPlayed = 0;
    this.#startingSeat = 'p1';
    this.#settleSteps = 0;
    this.#stepsPerSecond = 0;
    this.#resetRound('p1');
  }

  update(fixedDeltaSeconds: number, input: InputState): void {
    if (this.#stepsPerSecond === 0 && fixedDeltaSeconds > 0) {
      this.#stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    }
    this.#flip.retarget(this.#shouldRotate());
    this.#flip.step(fixedDeltaSeconds);
    if (this.#matchWinner !== null) return;

    if (this.#settleSteps > 0) {
      this.#settleSteps -= 1;
      if (this.#settleSteps === 0) {
        this.#startingSeat = otherSeat(this.#startingSeat);
        this.#resetRound(this.#startingSeat);
      }
      return;
    }

    const active = this.#active;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      const move = bestMove(this.#board, active, this.#rng, BLUNDER_CHANCE[difficulty]);
      if (move >= 0 && applyMove(this.#board, move, active)) this.#settleMove();
      return;
    }

    const seatInput = input.seat(active);
    // Nothing is accepted while the board is part-way round: the cell under a finger is
    // moving, so a tap would name one the player did not mean.
    if (!this.#flip.acceptsInput) return;

    // The keyboard moves a cursor; the pointer names a square outright. Both feed the
    // same move, and using one never locks out the other.
    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);

    if (!seatInput.actionPressed) return;

    let cell = this.#cursor.index;
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      // The board is drawn under the active seat's rotation, so a device-space tap has to
      // be turned into board space before it names a cell. The *settled* orientation,
      // which is the one on screen whenever input is open.
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const tapped = cellIndexAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped < 0) return;
      cell = tapped;
      // Leave the cursor where the finger went, so switching to keys carries on from
      // there rather than jumping back to wherever it last was.
      this.#cursor.moveTo(tapped);
    }

    if (!applyMove(this.#board, cell, active)) return;
    this.#settleMove();
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawGrid(renderer);
    this.#drawCursor(renderer);
    this.#drawMarks(renderer);
    if (this.#hasStrike) this.#drawStrike(renderer);
    renderer.popSeatRotation();
  }

  // The shell stops stepping a paused match, so a board with no continuous state has
  // nothing of its own to suspend or restart.
  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    return { p1: this.#tally.p1, p2: this.#tally.p2, winner: this.#matchWinner };
  }

  /** Whose turn it is. The shell's HUD draws the turn indicator from this. */
  getActiveSeat(): SeatId {
    return this.#active;
  }

  destroy(): void {
    this.#resetRound('p1');
    this.#tally.p1 = 0;
    this.#tally.p2 = 0;
    this.#matchWinner = null;
    this.#roundsPlayed = 0;
    this.#settleSteps = 0;
  }

  /** Seat whose turn it is. Read-only view for the HUD, the harness and the tests. */
  get activeSeat(): SeatId {
    return this.#active;
  }

  /** Outcome of the round on the board, or null while it is still being played. */
  get roundOutcome(): SeatId | 'draw' | null {
    return this.#roundOutcome;
  }

  cellAt(index: number): Cell {
    const cell = this.#board[index];
    return cell === undefined ? null : cell;
  }

  /** The orientation the board should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    // `seatView` is the one definition of when a seat reads the board upside down.
    // Three games had reimplemented the same expression, which is three chances to
    // disagree the day single-seat presentation gains a wrinkle.
    return seatView(this.#active, this.#presentation, this.#localSeat).rotated;
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  #resetRound(first: SeatId): void {
    for (let i = 0; i < CELL_COUNT; i += 1) {
      this.#board[i] = null;
    }
    this.#roundOutcome = null;
    this.#hasStrike = false;
    this.#active = first;
    this.#thinkSteps = -1;
  }

  #settleMove(): void {
    const outcome = winnerOf(this.#board);
    if (outcome === null) {
      this.#active = otherSeat(this.#active);
      this.#thinkSteps = -1;
      return;
    }

    this.#roundOutcome = outcome;
    this.#hasStrike = winningLineInto(this.#board, this.#strikeLine);
    if (outcome === 'p1') this.#tally.p1 += 1;
    else if (outcome === 'p2') this.#tally.p2 += 1;
    this.#roundsPlayed += 1;
    this.#options.timeExpired = this.#roundsPlayed >= MAX_ROUNDS;
    this.#matchWinner = resolve(this.#condition, this.#tally, this.#options);
    if (this.#matchWinner === null) this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
  }

  /** Only once a key has been used, so a player who taps never sees a stray highlight. */
  #drawCursor(renderer: Renderer): void {
    if (!this.#cursor.visible) return;
    if (this.#matchWinner !== null) return;
    const column = this.#cursor.column;
    const row = this.#cursor.row;
    renderer.strokeRect(
      BOARD_ORIGIN + column * CELL_EXTENT + CURSOR_INSET,
      BOARD_ORIGIN + row * CELL_EXTENT + CURSOR_INSET,
      CELL_EXTENT - CURSOR_INSET * 2,
      CELL_EXTENT - CURSOR_INSET * 2,
      CURSOR_WIDTH,
      this.#active === 'p1' ? COLOUR_P1 : COLOUR_P2,
    );
  }

  #drawGrid(renderer: Renderer): void {
    const end = BOARD_ORIGIN + BOARD_EXTENT;
    for (let i = 1; i < BOARD_COLUMNS; i += 1) {
      const offset = BOARD_ORIGIN + i * CELL_EXTENT;
      renderer.line(offset, BOARD_ORIGIN, offset, end, GRID_WIDTH, COLOUR_GRID);
      renderer.line(BOARD_ORIGIN, offset, end, offset, GRID_WIDTH, COLOUR_GRID);
    }
  }

  #drawMarks(renderer: Renderer): void {
    for (let i = 0; i < CELL_COUNT; i += 1) {
      const cell = this.#board[i];
      if (cell == null) continue;
      cellCentre(this.#scratchA, i);
      this.#drawMark(renderer, cell, this.#scratchA.x, this.#scratchA.y, MARK_RADIUS, MARK_WIDTH);
    }
  }

  /**
   * A ring for p1 and a cross for p2. The shapes carry the ownership on their own, so
   * the board stays readable in greyscale and to a colour-blind player.
   */
  #drawMark(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    radius: number,
    width: number,
  ): void {
    if (seat === 'p1') {
      renderer.strokeCircle(x, y, radius, width, COLOUR_P1);
      return;
    }
    const reach = radius * CROSS_REACH;
    renderer.line(x - reach, y - reach, x + reach, y + reach, width, COLOUR_P2);
    renderer.line(x + reach, y - reach, x - reach, y + reach, width, COLOUR_P2);
  }

  #drawStrike(renderer: Renderer): void {
    const first = this.#strikeLine[0];
    const last = this.#strikeLine[2];
    if (first === undefined || last === undefined) return;
    cellCentre(this.#scratchA, first);
    cellCentre(this.#scratchB, last);
    const dx = this.#scratchB.x - this.#scratchA.x;
    const dy = this.#scratchB.y - this.#scratchA.y;
    const span = Math.sqrt(dx * dx + dy * dy);
    const overhangX = span === 0 ? 0 : (dx / span) * STRIKE_OVERHANG;
    const overhangY = span === 0 ? 0 : (dy / span) * STRIKE_OVERHANG;
    renderer.line(
      this.#scratchA.x - overhangX,
      this.#scratchA.y - overhangY,
      this.#scratchB.x + overhangX,
      this.#scratchB.y + overhangY,
      STRIKE_WIDTH,
      COLOUR_STRIKE,
    );
  }
}
