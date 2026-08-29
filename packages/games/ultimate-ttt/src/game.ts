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
import type {
  Game as GameContract,
  GameContext,
  InputState,
  MatchScore,
  Renderer,
} from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOARD_COUNT,
  BOARD_SIZE,
  CELLS_PER_BOARD,
  applyMove,
  bestMove,
  boardOf,
  boardPlayable,
  cellIndex,
  createGame,
  otherOf,
  resetGame,
  tallyOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

/** Board geometry in logical units. Exported because aiming is not a rendering question. */
export const GRID_ORIGIN = 60;
export const GRID_EXTENT = 780;
/** One small board, including the gap that separates it from its neighbours. */
export const BOARD_PITCH = GRID_EXTENT / BOARD_SIZE;
export const BOARD_GAP = 14;
export const BOARD_EXTENT = BOARD_PITCH - BOARD_GAP;
export const CELL_EXTENT = BOARD_EXTENT / BOARD_SIZE;

const COLOUR_BACKGROUND = '#12161c';
const COLOUR_GRID = '#39424f';
const COLOUR_BOARD_LIVE = '#181e26';
const COLOUR_BOARD_DEAD = '#101419';
const COLOUR_SENT = '#2a3644';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;

const MARK_RADIUS = CELL_EXTENT * 0.3;
const MARK_WIDTH = 6;
const BIG_MARK_WIDTH = 14;
const CURSOR_INSET = 4;
const CURSOR_WIDTH = 4;

/** Converted to whole steps before being counted, so a replay is exact. */
const THINK_SECONDS = 0.55;
const SETTLE_SECONDS = 1.2;

/** Top-left of a small board, in logical units. */
export function boardOrigin(out: Vec2, board: number): Vec2 {
  return set(
    out,
    GRID_ORIGIN + (board % BOARD_SIZE) * BOARD_PITCH,
    GRID_ORIGIN + Math.floor(board / BOARD_SIZE) * BOARD_PITCH,
  );
}

/** The centre of one cell of one small board. */
export function cellCentre(out: Vec2, board: number, cell: number): Vec2 {
  boardOrigin(out, board);
  return set(
    out,
    out.x + ((cell % BOARD_SIZE) + 0.5) * CELL_EXTENT,
    out.y + (Math.floor(cell / BOARD_SIZE) + 0.5) * CELL_EXTENT,
  );
}

/** The cell index a point falls in, or -1. */
export function indexAt(x: number, y: number): number {
  const localX = x - GRID_ORIGIN;
  const localY = y - GRID_ORIGIN;
  if (localX < 0 || localY < 0 || localX >= GRID_EXTENT || localY >= GRID_EXTENT) return -1;
  const boardColumn = Math.min(BOARD_SIZE - 1, Math.floor(localX / BOARD_PITCH));
  const boardRow = Math.min(BOARD_SIZE - 1, Math.floor(localY / BOARD_PITCH));
  const insideX = localX - boardColumn * BOARD_PITCH;
  const insideY = localY - boardRow * BOARD_PITCH;
  // A tap in the gap between small boards belongs to neither.
  if (insideX >= BOARD_EXTENT || insideY >= BOARD_EXTENT) return -1;
  const cellColumn = Math.min(BOARD_SIZE - 1, Math.floor(insideX / CELL_EXTENT));
  const cellRow = Math.min(BOARD_SIZE - 1, Math.floor(insideY / CELL_EXTENT));
  return cellIndex(boardRow * BOARD_SIZE + boardColumn, cellRow * BOARD_SIZE + cellColumn);
}

export class UltimateTicTacToeGame implements GameContract {
  readonly #game: Game = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #flip = new SeatFlip();
  /** Nine by nine: the cursor walks the whole grid, ignoring small-board boundaries. */
  readonly #cursor = new GridCursor({ columns: 9, rows: 9, startIndex: 40 });

  #rng = new Rng(1);
  #active: SeatId = 'p1';
  #localSeat: SeatId = 'p1';
  #presentation: Presentation = 'shared-screen';
  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;
  #matchWinner: SeatId | 'draw' | null = null;

  #stepsPerSecond = 0;
  #thinkSteps = -1;
  #settleSteps = 0;

  init(context: GameContext): void {
    this.#rng = context.rng;
    this.#localSeat = context.localSeat;
    this.#presentation = context.presentation;
    this.#botP1 = context.botDifficulty('p1');
    this.#botP2 = context.botDifficulty('p2');
    this.#matchWinner = null;
    resetGame(this.#game);
    this.#active = 'p1';
    this.#thinkSteps = -1;
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
      if (this.#settleSteps === 0) this.#matchWinner = winnerOf(this.#game);
      return;
    }
    if (winnerOf(this.#game) !== null) {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
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
      this.#play(bestMove(this.#game, active, this.#rng, difficulty), active);
      return;
    }

    const seatInput = input.seat(active);
    if (!this.#flip.acceptsInput) return;

    this.#cursor.step(seatInput.move.x, seatInput.move.y, fixedDeltaSeconds, this.#flip.rotated);

    if (!seatInput.actionPressed) return;

    let index = this.#gridToIndex(this.#cursor.index);
    const pointer = seatInput.pointer;
    if (pointer !== null) {
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const tapped = indexAt(this.#pointerWorld.x, this.#pointerWorld.y);
      if (tapped < 0) return;
      index = tapped;
      this.#cursor.moveTo(this.#indexToGrid(tapped));
    }

    this.#play(index, active);
  }

  // The contract's signature, declared so `game.render(renderer, alpha)` type-checks
  // against the class as well as against `Game`. This game does not interpolate
  // between fixed steps, so the implementation below ignores alpha.
  render(renderer: Renderer, alpha: number): void;
  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawBoards(renderer);
    this.#drawCursor(renderer);
    this.#drawMarks(renderer);
    this.#drawBoardResults(renderer);
    renderer.popSeatRotation();
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    const { p1, p2 } = tallyOf(this.#game);
    return { p1, p2, winner: this.#matchWinner };
  }

  getActiveSeat(): SeatId {
    return this.#active;
  }

  destroy(): void {
    resetGame(this.#game);
  }

  /** Read-only views for the tests and the harness. */
  get activeSeat(): SeatId {
    return this.#active;
  }

  cellAt(index: number): SeatId | null {
    return this.#game.cells[index] ?? null;
  }

  boardResult(board: number): SeatId | 'draw' | null {
    return this.#game.boards[board] ?? null;
  }

  get sentTo(): number {
    return this.#game.sentTo;
  }

  /**
   * The cursor walks a flat nine-by-nine grid, which is what a player sees; the rules
   * index by small board. These two convert between them, and are the only place that
   * conversion happens.
   */
  #gridToIndex(grid: number): number {
    const column = grid % 9;
    const row = Math.floor(grid / 9);
    const board = Math.floor(row / BOARD_SIZE) * BOARD_SIZE + Math.floor(column / BOARD_SIZE);
    const cell = (row % BOARD_SIZE) * BOARD_SIZE + (column % BOARD_SIZE);
    return cellIndex(board, cell);
  }

  #indexToGrid(index: number): number {
    const board = boardOf(index);
    const cell = index % CELLS_PER_BOARD;
    const row = Math.floor(board / BOARD_SIZE) * BOARD_SIZE + Math.floor(cell / BOARD_SIZE);
    const column = (board % BOARD_SIZE) * BOARD_SIZE + (cell % BOARD_SIZE);
    return row * 9 + column;
  }

  #play(index: number, seat: SeatId): void {
    if (index < 0) return;
    if (!applyMove(this.#game, index, seat)) return;
    this.#thinkSteps = -1;
    this.#active = otherOf(seat);
    if (winnerOf(this.#game) !== null) this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
  }

  /** The orientation the board should be in, which the flip tweens towards. */
  #shouldRotate(): boolean {
    return seatView(this.#active, this.#presentation, this.#localSeat).rotated;
  }

  #stepsFor(seconds: number): number {
    const steps = Math.round(seconds * this.#stepsPerSecond);
    return steps < 1 ? 1 : steps;
  }

  /**
   * The nine small boards, with the one you must play in lit.
   *
   * That highlight is the game's most important piece of feedback: without it a player
   * has to work out where they are allowed to move from the previous move's cell, every
   * single turn, which is bookkeeping rather than thinking.
   */
  #drawBoards(renderer: Renderer): void {
    for (let board = 0; board < BOARD_COUNT; board += 1) {
      boardOrigin(this.#scratch, board);
      const playable = boardPlayable(this.#game, board);
      const mustPlayHere =
        this.#matchWinner === null &&
        playable &&
        (this.#game.sentTo === board || this.#game.sentTo < 0);
      renderer.rect(
        this.#scratch.x,
        this.#scratch.y,
        BOARD_EXTENT,
        BOARD_EXTENT,
        mustPlayHere ? COLOUR_SENT : playable ? COLOUR_BOARD_LIVE : COLOUR_BOARD_DEAD,
      );
      for (let i = 1; i < BOARD_SIZE; i += 1) {
        const at = i * CELL_EXTENT;
        renderer.line(
          this.#scratch.x + at,
          this.#scratch.y,
          this.#scratch.x + at,
          this.#scratch.y + BOARD_EXTENT,
          2,
          COLOUR_GRID,
        );
        renderer.line(
          this.#scratch.x,
          this.#scratch.y + at,
          this.#scratch.x + BOARD_EXTENT,
          this.#scratch.y + at,
          2,
          COLOUR_GRID,
        );
      }
    }
  }

  #drawCursor(renderer: Renderer): void {
    if (!this.#cursor.visible) return;
    if (this.#matchWinner !== null) return;
    const index = this.#gridToIndex(this.#cursor.index);
    const board = boardOf(index);
    const cell = index % CELLS_PER_BOARD;
    cellCentre(this.#scratch, board, cell);
    renderer.strokeRect(
      this.#scratch.x - CELL_EXTENT / 2 + CURSOR_INSET,
      this.#scratch.y - CELL_EXTENT / 2 + CURSOR_INSET,
      CELL_EXTENT - CURSOR_INSET * 2,
      CELL_EXTENT - CURSOR_INSET * 2,
      CURSOR_WIDTH,
      this.#active === 'p1' ? COLOUR_P1 : COLOUR_P2,
    );
  }

  #drawMarks(renderer: Renderer): void {
    for (let board = 0; board < BOARD_COUNT; board += 1) {
      for (let cell = 0; cell < CELLS_PER_BOARD; cell += 1) {
        const owner = this.#game.cells[cellIndex(board, cell)];
        if (owner === null || owner === undefined) continue;
        cellCentre(this.#scratch, board, cell);
        this.#drawMark(renderer, owner, this.#scratch.x, this.#scratch.y, MARK_RADIUS, MARK_WIDTH);
      }
    }
  }

  /** A won small board gets one large mark over it, so the big grid reads at a glance. */
  #drawBoardResults(renderer: Renderer): void {
    for (let board = 0; board < BOARD_COUNT; board += 1) {
      const result = this.#game.boards[board];
      if (result === null || result === undefined || result === 'draw') continue;
      boardOrigin(this.#scratch, board);
      this.#drawMark(
        renderer,
        result,
        this.#scratch.x + BOARD_EXTENT / 2,
        this.#scratch.y + BOARD_EXTENT / 2,
        BOARD_EXTENT * 0.34,
        BIG_MARK_WIDTH,
      );
    }
  }

  /**
   * p1 is a ring, p2 is a cross.
   *
   * Shape as well as colour, so the two are separable in greyscale — and here it matters
   * doubly, because a small mark and a large mark of the same seat must read as the same
   * player at two very different sizes.
   */
  #drawMark(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    radius: number,
    width: number,
  ): void {
    const colour = seat === 'p1' ? COLOUR_P1 : COLOUR_P2;
    if (seat === 'p1') {
      renderer.strokeCircle(x, y, radius, width, colour);
      return;
    }
    const reach = radius * 0.78;
    renderer.line(x - reach, y - reach, x + reach, y + reach, width, colour);
    renderer.line(x + reach, y - reach, x - reach, y + reach, width, colour);
  }
}

export default {
  manifest,
  create: (): GameContract => new UltimateTicTacToeGame(),
};
