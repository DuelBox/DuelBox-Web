import {
  GridCursor,
  Rng,
  SEAT_PALETTE,
  SeatFlip,
  seatView,
  set,
  toWorld,
  vec2,
} from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  CELL_COUNT,
  COLUMNS,
  ROWS,
  applyMove,
  bestMove,
  columnOf,
  createBoard,
  flipCount,
  hasLegalMove,
  isOver,
  otherOf,
  resetBoard,
  rowOf,
  tallyOf,
  winnerOf,
} from './rules.js';
import type { Board, BotDifficulty } from './rules.js';

/**
 * Board geometry in logical units. Exported because aiming at a square is not a rendering
 * question — the tests and any pointer-driven bot need the same mapping the game uses.
 */
export const BOARD_ORIGIN = 90;
export const BOARD_EXTENT = 720;
export const CELL_EXTENT = BOARD_EXTENT / COLUMNS;

const COLOUR_BACKGROUND = '#12161c';
const COLOUR_FELT = '#1d5c3a';
const COLOUR_GRID = '#14472c';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;
const COLOUR_P1_DEEP = SEAT_PALETTE.p1.deep;
const COLOUR_P2_DEEP = SEAT_PALETTE.p2.deep;

const PIECE_RADIUS = CELL_EXTENT * 0.38;
const PIECE_RING = 5;
const GRID_WIDTH = 3;
const HINT_RADIUS = 9;
const CURSOR_INSET = 7;
const CURSOR_WIDTH = 5;

/** Converted to whole steps before being counted, so a replay is exact. */
const THINK_SECONDS = 0.5;
const PASS_SECONDS = 0.9;
const SETTLE_SECONDS = 1.1;

/** The centre of a square, in logical units. */
export function cellCentre(out: Vec2, index: number): Vec2 {
  return set(
    out,
    BOARD_ORIGIN + (columnOf(index) + 0.5) * CELL_EXTENT,
    BOARD_ORIGIN + (rowOf(index) + 0.5) * CELL_EXTENT,
  );
}

/** The square a point falls in, or -1 if it is off the board. */
export function cellIndexAt(x: number, y: number): number {
  const localX = x - BOARD_ORIGIN;
  const localY = y - BOARD_ORIGIN;
  if (localX < 0 || localY < 0 || localX >= BOARD_EXTENT || localY >= BOARD_EXTENT) return -1;
  const column = Math.min(COLUMNS - 1, Math.floor(localX / CELL_EXTENT));
  const row = Math.min(ROWS - 1, Math.floor(localY / CELL_EXTENT));
  return row * COLUMNS + column;
}

export class ReversiGame implements Game {
  readonly #board: Board = createBoard();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #flip = new SeatFlip();
  readonly #cursor = new GridCursor({ columns: COLUMNS, rows: ROWS, startIndex: 27 });

  #rng = new Rng(1);
  #active: SeatId = 'p1';
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #passSteps = 0;
  #settleSteps = 0;

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    resetBoard(this.#board);
    this.#active = 'p1';
    this.#thinkSteps = -1;
    this.#passSteps = 0;
    this.#settleSteps = 0;
    this.#cursor.reset();
    this.#flip.snap(this.#shouldRotate());
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
      if (this.#settleSteps === 0) this.#matchWinner = winnerOf(this.#board);
      return;
    }

    // A seat with no legal move must pass, which is a real position in Reversi rather
    // than an error. Held for a beat so the other player can see it happen — a turn that
    // silently bounces back looks like the game ignored their opponent.
    if (!hasLegalMove(this.#board, this.#active)) {
      if (isOver(this.#board)) {
        this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
        return;
      }
      if (this.#passSteps === 0) this.#passSteps = this.#stepsFor(PASS_SECONDS);
      this.#passSteps -= 1;
      if (this.#passSteps === 0) {
        this.#active = otherOf(this.#active);
        this.#thinkSteps = -1;
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
      this.#thinkSteps = -1;
      this.#play(bestMove(this.#board, active, this.#rng, difficulty), active);
      return;
    }

    const seatInput = input.seat(active);
    // Nothing is accepted while the board is part-way round: the square under a finger is
    // moving, so a tap would name one the player did not mean.
    if (!this.#flip.acceptsInput) return;

    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);

    if (!seatInput.actionPressed) return;

    let cell = this.#cursor.index;
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const tapped = cellIndexAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped < 0) return;
      cell = tapped;
      this.#cursor.moveTo(tapped);
    }

    this.#play(cell, active);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawFelt(renderer);
    this.#drawHints(renderer);
    this.#drawCursor(renderer);
    this.#drawPieces(renderer);
    renderer.popSeatRotation();
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    const { p1, p2 } = tallyOf(this.#board);
    return { p1, p2, winner: this.#matchWinner };
  }

  getActiveSeat(): SeatId {
    return this.#active;
  }

  destroy(): void {
    resetBoard(this.#board);
  }

  /** Read-only views for the tests and the harness. */
  get activeSeat(): SeatId {
    return this.#active;
  }

  cellAt(index: number): SeatId | null {
    return this.#board[index] ?? null;
  }

  get cursorIndex(): number {
    return this.#cursor.index;
  }

  #play(cell: number, seat: SeatId): void {
    if (cell < 0) return;
    if (applyMove(this.#board, cell, seat) < 0) return;
    this.#thinkSteps = -1;
    this.#passSteps = 0;
    // The turn always passes — unlike Dots and Boxes, a Reversi move never grants
    // another. The *next* seat may have to pass, which the loop above handles.
    this.#active = otherOf(seat);
    if (isOver(this.#board)) this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
  }

  /** The orientation the board should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatView(this.#active, this.#presentation, this.#localSeat).rotated;
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  #drawFelt(renderer: Renderer): void {
    renderer.rect(BOARD_ORIGIN, BOARD_ORIGIN, BOARD_EXTENT, BOARD_EXTENT, COLOUR_FELT);
    for (let i = 1; i < COLUMNS; i += 1) {
      const at = BOARD_ORIGIN + i * CELL_EXTENT;
      renderer.line(at, BOARD_ORIGIN, at, BOARD_ORIGIN + BOARD_EXTENT, GRID_WIDTH, COLOUR_GRID);
      renderer.line(BOARD_ORIGIN, at, BOARD_ORIGIN + BOARD_EXTENT, at, GRID_WIDTH, COLOUR_GRID);
    }
  }

  /**
   * A dot on every square the active seat may play.
   *
   * Not a hint in the sense of advice — in Reversi, which squares are legal is a fact
   * about the position that a player is entitled to see, and working it out by eye in
   * eight directions is bookkeeping rather than skill. Every physical set makes it
   * obvious too, because you can see which runs you would flank.
   */
  #drawHints(renderer: Renderer): void {
    if (this.#matchWinner !== null) return;
    const colour = this.#active === 'p1' ? COLOUR_P1 : COLOUR_P2;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if (flipCount(this.#board, index, this.#active) === 0) continue;
      cellCentre(this.#scratch, index);
      renderer.circle(this.#scratch.x, this.#scratch.y, HINT_RADIUS, colour);
    }
  }

  /** Only once a key has been used, so a player who taps never sees a stray highlight. */
  #drawCursor(renderer: Renderer): void {
    if (!this.#cursor.visible) return;
    if (this.#matchWinner !== null) return;
    renderer.strokeRect(
      BOARD_ORIGIN + this.#cursor.column * CELL_EXTENT + CURSOR_INSET,
      BOARD_ORIGIN + this.#cursor.row * CELL_EXTENT + CURSOR_INSET,
      CELL_EXTENT - CURSOR_INSET * 2,
      CELL_EXTENT - CURSOR_INSET * 2,
      CURSOR_WIDTH,
      this.#active === 'p1' ? COLOUR_P1 : COLOUR_P2,
    );
  }

  #drawPieces(renderer: Renderer): void {
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const cell = this.#board[index];
      if (cell === null || cell === undefined) continue;
      cellCentre(this.#scratch, index);
      const fill = cell === 'p1' ? COLOUR_P1 : COLOUR_P2;
      const ring = cell === 'p1' ? COLOUR_P1_DEEP : COLOUR_P2_DEEP;
      renderer.circle(this.#scratch.x, this.#scratch.y, PIECE_RADIUS, fill);
      renderer.strokeCircle(this.#scratch.x, this.#scratch.y, PIECE_RADIUS - 2, PIECE_RING, ring);
      // Colour is never the only signal: p1's piece carries a centre dot, p2's a ring, so
      // the two are separable in greyscale and to a colour-blind player.
      if (cell === 'p1') {
        renderer.circle(this.#scratch.x, this.#scratch.y, PIECE_RADIUS * 0.3, ring);
      } else {
        renderer.strokeCircle(this.#scratch.x, this.#scratch.y, PIECE_RADIUS * 0.5, 4, ring);
      }
    }
  }
}

export default {
  manifest,
  create: (): Game => new ReversiGame(),
};
