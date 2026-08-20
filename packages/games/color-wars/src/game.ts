import { GridCursor, Rng, SEAT_PALETTE, SeatFlip, seatView, set, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, Presentation, SeatId, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, MatchScore, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  CELL_COUNT,
  COLUMNS,
  ROWS,
  applyMove,
  bestMove,
  capacityOf,
  columnOf,
  createGame,
  isLegalMove,
  resetGame,
  rowOf,
  tallyOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

/**
 * Colour Wars — a grid, and a cascade.
 *
 * Add a dot to a cell that is empty or yours. A cell holding as many dots as it has
 * neighbours bursts, sending one into each and turning them your colour; they may burst in
 * turn. A single dot in the right corner can take half the board.
 */

export const BOARD_ORIGIN = 90;
export const BOARD_EXTENT = 720;
export const CELL_EXTENT = BOARD_EXTENT / COLUMNS;

const COLOUR_BACKGROUND = '#10141d';
const COLOUR_CELL = '#1a2130';
const COLOUR_GRID = 'rgba(233, 240, 252, 0.12)';
const COLOUR_INK = '#0b1220';

const DOT_RADIUS = CELL_EXTENT * 0.115;
const DOT_SPREAD = CELL_EXTENT * 0.2;
const CURSOR_INSET = 6;
const CURSOR_WIDTH = 5;

/** Converted to whole steps before being counted, so a replay is exact. */
const THINK_SECONDS = 0.45;
const SETTLE_SECONDS = 1.1;

/** The centre of a cell, in logical units. */
export function cellCentre(out: Vec2, index: number): Vec2 {
  return set(
    out,
    BOARD_ORIGIN + (columnOf(index) + 0.5) * CELL_EXTENT,
    BOARD_ORIGIN + (rowOf(index) + 0.5) * CELL_EXTENT,
  );
}

/** The cell a point falls in, or -1 when it is off the board. */
export function cellIndexAt(x: number, y: number): number {
  const localX = x - BOARD_ORIGIN;
  const localY = y - BOARD_ORIGIN;
  if (localX < 0 || localY < 0 || localX >= BOARD_EXTENT || localY >= BOARD_EXTENT) return -1;
  const column = Math.min(COLUMNS - 1, Math.floor(localX / CELL_EXTENT));
  const row = Math.min(ROWS - 1, Math.floor(localY / CELL_EXTENT));
  return row * COLUMNS + column;
}

export class ColorWarsGame implements Game {
  readonly #position: Position = createGame();
  readonly #logical: LogicalSize = manifest.logical;
  readonly #pointerWorld = vec2();
  readonly #scratch = vec2();
  readonly #flip = new SeatFlip();
  readonly #cursor = new GridCursor({
    columns: COLUMNS,
    rows: ROWS,
    startIndex: Math.floor(CELL_COUNT / 2),
  });

  #rng = new Rng(1);
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
    resetGame(this.#position);
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
      if (this.#settleSteps === 0) this.#matchWinner = winnerOf(this.#position);
      return;
    }
    if (winnerOf(this.#position) !== null) {
      this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      return;
    }

    const active = this.#position.toMove;
    const difficulty = active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) {
      if (this.#thinkSteps < 0) this.#thinkSteps = this.#stepsFor(THINK_SECONDS);
      if (this.#thinkSteps > 0) {
        this.#thinkSteps -= 1;
        return;
      }
      this.#thinkSteps = -1;
      const move = bestMove(this.#position, active, this.#rng, difficulty);
      if (move >= 0) {
        this.#cursor.moveTo(move);
        applyMove(this.#position, move, active);
      }
      return;
    }

    const seatInput = input.seat(active);
    // Nothing is accepted while the board is part-way round: the cell under a finger is
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
    applyMove(this.#position, cell, active);
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawGrid(renderer);
    this.#drawCursor(renderer);
    this.#drawDots(renderer);
    renderer.popSeatRotation();
  }

  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    const { p1, p2 } = tallyOf(this.#position);
    return { p1, p2, winner: this.#matchWinner };
  }

  getActiveSeat(): SeatId {
    return this.#position.toMove;
  }

  destroy(): void {
    resetGame(this.#position);
    this.#matchWinner = null;
  }

  /** Read-only views for the tests and the harness. */
  get position(): Readonly<Position> {
    return this.#position;
  }

  get cursorCell(): number {
    return this.#cursor.index;
  }

  #stepsFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * (this.#stepsPerSecond || 60)));
  }

  #shouldRotate(): boolean {
    return seatView(this.#position.toMove, this.#presentation, this.#localSeat).rotated;
  }

  #drawGrid(renderer: Renderer): void {
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const x = BOARD_ORIGIN + columnOf(index) * CELL_EXTENT;
      const y = BOARD_ORIGIN + rowOf(index) * CELL_EXTENT;
      renderer.rect(x + 2, y + 2, CELL_EXTENT - 4, CELL_EXTENT - 4, COLOUR_CELL);
      renderer.strokeRect(x + 2, y + 2, CELL_EXTENT - 4, CELL_EXTENT - 4, 2, COLOUR_GRID);
    }
  }

  #drawCursor(renderer: Renderer): void {
    if (!this.#cursor.visible) return;
    const index = this.#cursor.index;
    const legal = isLegalMove(this.#position, index, this.#position.toMove);
    renderer.strokeRect(
      BOARD_ORIGIN + this.#cursor.column * CELL_EXTENT + CURSOR_INSET,
      BOARD_ORIGIN + this.#cursor.row * CELL_EXTENT + CURSOR_INSET,
      CELL_EXTENT - CURSOR_INSET * 2,
      CELL_EXTENT - CURSOR_INSET * 2,
      CURSOR_WIDTH,
      // Dimmed on a cell you cannot play, so the refusal is explained before it happens
      // rather than after.
      legal ? SEAT_PALETTE[this.#position.toMove].base : COLOUR_GRID,
    );
  }

  /**
   * Dots, arranged so their count is readable at a glance, and **a primed cell is ringed**.
   *
   * Knowing which cells are one dot from bursting is the whole game, and counting three
   * dots against four across a six-by-six grid under time pressure is exactly the kind of
   * thing a player should not have to do. The ring says it directly, in shape — rule 7 —
   * so it survives greyscale as well as the two seat colours do.
   */
  #drawDots(renderer: Renderer): void {
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const cell = this.#position.cells[index];
      if (cell === undefined || cell.owner === null || cell.dots === 0) continue;
      cellCentre(this.#scratch, index);
      const x = this.#scratch.x;
      const y = this.#scratch.y;
      const palette = SEAT_PALETTE[cell.owner];

      if (cell.dots >= capacityOf(index) - 1) {
        renderer.strokeCircle(x, y, CELL_EXTENT * 0.38, 4, palette.tint);
      }

      // Up to four dots: one centred, otherwise spread on a small diamond.
      if (cell.dots === 1) {
        this.#drawDot(renderer, cell.owner, x, y);
      } else if (cell.dots === 2) {
        this.#drawDot(renderer, cell.owner, x - DOT_SPREAD, y);
        this.#drawDot(renderer, cell.owner, x + DOT_SPREAD, y);
      } else if (cell.dots === 3) {
        this.#drawDot(renderer, cell.owner, x, y - DOT_SPREAD);
        this.#drawDot(renderer, cell.owner, x - DOT_SPREAD, y + DOT_SPREAD * 0.7);
        this.#drawDot(renderer, cell.owner, x + DOT_SPREAD, y + DOT_SPREAD * 0.7);
      } else {
        this.#drawDot(renderer, cell.owner, x - DOT_SPREAD, y - DOT_SPREAD);
        this.#drawDot(renderer, cell.owner, x + DOT_SPREAD, y - DOT_SPREAD);
        this.#drawDot(renderer, cell.owner, x - DOT_SPREAD, y + DOT_SPREAD);
        this.#drawDot(renderer, cell.owner, x + DOT_SPREAD, y + DOT_SPREAD);
      }
    }
  }

  /** p1's dots are round, p2's are square. Rule 7, again. */
  #drawDot(renderer: Renderer, seat: SeatId, x: number, y: number): void {
    const palette = SEAT_PALETTE[seat];
    if (seat === 'p1') {
      renderer.circle(x, y, DOT_RADIUS, palette.base);
      renderer.strokeCircle(x, y, DOT_RADIUS - 1.5, 3, COLOUR_INK);
      return;
    }
    renderer.rect(x - DOT_RADIUS, y - DOT_RADIUS, DOT_RADIUS * 2, DOT_RADIUS * 2, palette.base);
    renderer.strokeRect(
      x - DOT_RADIUS + 1.5,
      y - DOT_RADIUS + 1.5,
      DOT_RADIUS * 2 - 3,
      DOT_RADIUS * 2 - 3,
      3,
      COLOUR_INK,
    );
  }
}

const gameModule = {
  manifest,
  create: (): Game => new ColorWarsGame(),
};

export default gameModule;
