import { Rng, SEAT_PALETTE, SeatFlip, otherSeat, seatView, toWorld, vec2 } from '@duelbox/engine';
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
  CELL_COUNT,
  COLUMNS,
  LINE_LENGTH,
  ROWS,
  applyDrop,
  bestColumn,
  createBoard,
  dropRow,
  winnerOf,
  winningCellsInto,
} from './rules.js';
import type { BotDifficulty, Cell } from './rules.js';

/**
 * Board geometry in logical units. Exported because aiming at a column is not a
 * rendering question: the tests and any pointer-driven harness need the same mapping
 * the game itself uses.
 */
export const CELL_EXTENT = 105;
export const BOARD_WIDTH = CELL_EXTENT * COLUMNS;
export const BOARD_HEIGHT = CELL_EXTENT * ROWS;
export const BOARD_ORIGIN_X = (manifest.logical.width - BOARD_WIDTH) / 2;
export const BOARD_ORIGIN_Y = 210;

/** Where the disc waiting to be dropped sits: half a cell above the top of the stack. */
export const HOVER_Y = BOARD_ORIGIN_Y - CELL_EXTENT / 2;

/** Column the hover starts on. The centre is the strongest opening, so it is the default. */
const CENTRE_COLUMN = 3;

/** Best of three: two round wins takes the match, three rounds settle it either way. */
const ROUNDS_TO_WIN = 2;
const MAX_ROUNDS = 3;

/**
 * Every delay is converted to whole simulation steps before it is counted down, so a
 * replay of the same inputs produces the same match on any machine.
 */
const THINK_SECONDS = 0.5;
const DROP_SECONDS = 0.25;
const SETTLE_SECONDS = 1;

/** Movement axis past which a keyboard nudge counts, so a resting axis never drifts. */
const MOVE_DEADZONE = 0.5;

const COLOUR_BACKGROUND = '#12161c';
const COLOUR_PANEL = '#243347';
const COLOUR_HOLE = '#0d1218';
const COLOUR_RIM = '#3b4d68';
const COLOUR_P1 = SEAT_PALETTE.p1.base;
const COLOUR_P2 = SEAT_PALETTE.p2.base;
const COLOUR_GUIDE = 'rgba(230, 233, 239, 0.34)';
const COLOUR_HIGHLIGHT = '#f4f4f5';

const DISC_RADIUS = 42;
const RING_WIDTH = 13;
const HOLE_RADIUS = 46;
const RIM_WIDTH = 3;
const GUIDE_WIDTH = 5;
const HIGHLIGHT_WIDTH = 6;

/** Centre of a column in logical units. */
export function columnCentreX(col: number): number {
  return BOARD_ORIGIN_X + (col + 0.5) * CELL_EXTENT;
}

/** Centre of a row in logical units. Row 0 is the top one. */
export function rowCentreY(row: number): number {
  return BOARD_ORIGIN_Y + (row + 0.5) * CELL_EXTENT;
}

/**
 * Column a point in board space falls in, or -1 when it misses the board sideways.
 *
 * Only x is consulted: the row is never chosen by the player, so a tap anywhere up or
 * down the column — including above the board, where the waiting disc sits — aims at
 * the same column.
 */
export function columnAt(x: number): number {
  const local = x - BOARD_ORIGIN_X;
  if (local < 0 || local >= BOARD_WIDTH) return -1;
  return Math.floor(local / CELL_EXTENT);
}

interface MutableScore {
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
}

export class DropFourGame implements Game {
  readonly #board: Cell[] = createBoard();
  readonly #condition: WinCondition = { kind: 'first-to', target: ROUNDS_TO_WIN };
  readonly #options = { timeExpired: false };
  /** Doubles as the tally handed to resolve(): round wins are the score. */
  readonly #score: MutableScore = { p1: 0, p2: 0, winner: null };
  readonly #lineCells: number[] = [0, 0, 0, 0];
  readonly #pointerWorld: Vec2 = vec2();

  #rng: Rng = new Rng(0);
  #logical: LogicalSize = manifest.logical;
  #presentation: Presentation = 'shared-screen';
  #localSeat: SeatId = 'p1';
  /**
   * The board turning to face whoever has the move.
   *
   * Steps on the fixed timestep like everything else, so two devices rotate through the
   * same angles on the same steps. Reduced motion is the renderer's business, not this
   * one's — the flip must still step identically everywhere or two devices would
   * disagree about when input reopens.
   */
  readonly #flip = new SeatFlip();

  #botP1: BotDifficulty | null = null;
  #botP2: BotDifficulty | null = null;

  #startingSeat: SeatId = 'p1';
  #active: SeatId = 'p1';
  #roundOutcome: SeatId | 'draw' | null = null;
  #hasLine = false;
  #roundsPlayed = 0;

  #hoverColumn = CENTRE_COLUMN;
  /** A pointer is down and a drop is waiting on the lift that commits it. */
  #armed = false;
  /** Last movement direction read from the axes, so a held key nudges once, not per step. */
  #moveLatch = 0;

  #dropColumn = 0;
  #dropRow = 0;
  #dropSeat: SeatId = 'p1';
  #dropSteps = 0;
  #dropTotalSteps = 0;

  /** Negative until the turn's thinking delay has been sized in steps. */
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

    this.#score.p1 = 0;
    this.#score.p2 = 0;
    this.#score.winner = null;
    this.#options.timeExpired = false;
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

    // The falling disc is counted down before the match-over test, so the drop that
    // decides a match still lands rather than freezing in mid-air.
    if (this.#dropSteps > 0) {
      this.#dropSteps -= 1;
      if (this.#dropSteps === 0 && this.#roundOutcome !== null && this.#score.winner === null) {
        this.#settleSteps = this.#stepsFor(SETTLE_SECONDS);
      }
      return;
    }

    if (this.#score.winner !== null) return;

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
      const column = bestColumn(this.#board, active, this.#rng, difficulty);
      if (column >= 0) {
        this.#hoverColumn = column;
        this.#drop(column, active);
      }
      return;
    }

    const seatInput = input.seat(active);
    const pointer = seatInput.pointer;
    // Nothing is accepted while the board is part-way round: the column under a finger
    // is moving, so a gesture would name one the player did not mean.
    if (pointer !== null && this.#flip.acceptsInput) {
      // The board is drawn under the active seat's rotation, so a device-space pointer
      // has to be turned into board space before it names a column. The *settled*
      // orientation, which is the one on screen whenever input is open.
      toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#flip.rotated);
      const column = columnAt(this.#pointerWorld.x);
      // Arming only over a column is what stops a tap on the chrome either side of the
      // board from dropping a disc; a drag that starts on the board keeps its aim.
      if (column >= 0) {
        this.#hoverColumn = column;
        this.#armed = true;
      }
      return;
    }

    if (this.#armed) {
      this.#armed = false;
      // Lifting the finger is what commits the drop, so a player can slide along the
      // columns and see where the disc will land before letting go of it.
      if (seatInput.actionReleased) this.#drop(this.#hoverColumn, active);
      return;
    }

    const axis = seatInput.move.x;
    const direction = axis < -MOVE_DEADZONE ? -1 : axis > MOVE_DEADZONE ? 1 : 0;
    if (direction !== 0 && direction !== this.#moveLatch) {
      const next = this.#hoverColumn + direction;
      if (next >= 0 && next < COLUMNS) this.#hoverColumn = next;
    }
    this.#moveLatch = direction;
    if (seatInput.actionPressed) this.#drop(this.#hoverColumn, active);
  }

  render(renderer: Renderer, alpha: number): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushRotation(this.#flip.angle);
    this.#drawBoard(renderer);
    this.#drawHover(renderer);
    this.#drawFalling(renderer, alpha);
    this.#drawHighlight(renderer);
    renderer.popSeatRotation();
  }

  /** A gesture interrupted by a pause must not commit a drop when play resumes. */
  onPause(): void {
    this.#armed = false;
    this.#moveLatch = 0;
  }

  // The shell stops stepping a paused match, and a board has no continuous state of its
  // own, so there is nothing to restart on the way back in.
  onResume(): void {}

  getScore(): MatchScore {
    return this.#score;
  }

  /** Whose turn it is. The shell's HUD draws the turn indicator from this. */
  getActiveSeat(): SeatId {
    return this.#active;
  }

  destroy(): void {
    this.#resetRound('p1');
    this.#score.p1 = 0;
    this.#score.p2 = 0;
    this.#score.winner = null;
    this.#options.timeExpired = false;
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

  /** Column the waiting disc is over. */
  get hoverColumn(): number {
    return this.#hoverColumn;
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
    this.#hasLine = false;
    this.#active = first;
    this.#thinkSteps = -1;
    this.#hoverColumn = CENTRE_COLUMN;
    this.#armed = false;
    this.#moveLatch = 0;
    this.#dropSteps = 0;
    this.#dropTotalSteps = 0;
  }

  /**
   * Places a disc immediately and starts the animation that shows it falling.
   *
   * The simulation never waits for the picture: the board, the turn and the round
   * outcome are all settled on this step, and {@link DropFourGame.render} is the only
   * thing that treats the disc as still in the air.
   */
  #drop(column: number, seat: SeatId): void {
    const row = applyDrop(this.#board, column, seat);
    // A full column is not a move, so the turn stays where it is and the seat may
    // simply drop somewhere else.
    if (row < 0) return;

    this.#dropColumn = column;
    this.#dropRow = row;
    this.#dropSeat = seat;
    this.#dropTotalSteps = this.#stepsFor(DROP_SECONDS);
    this.#dropSteps = this.#dropTotalSteps;
    this.#moveLatch = 0;

    const outcome = winnerOf(this.#board);
    if (outcome === null) {
      this.#active = otherSeat(seat);
      this.#thinkSteps = -1;
      return;
    }

    this.#roundOutcome = outcome;
    this.#hasLine = winningCellsInto(this.#board, this.#lineCells);
    if (outcome === 'p1') this.#score.p1 += 1;
    else if (outcome === 'p2') this.#score.p2 += 1;
    this.#roundsPlayed += 1;
    this.#options.timeExpired = this.#roundsPlayed >= MAX_ROUNDS;
    this.#score.winner = resolve(this.#condition, this.#score, this.#options);
  }

  #drawBoard(renderer: Renderer): void {
    renderer.rect(BOARD_ORIGIN_X, BOARD_ORIGIN_Y, BOARD_WIDTH, BOARD_HEIGHT, COLOUR_PANEL);
    const falling = this.#dropSteps > 0 ? this.#dropRow * COLUMNS + this.#dropColumn : -1;
    for (let row = 0; row < ROWS; row += 1) {
      const y = rowCentreY(row);
      for (let col = 0; col < COLUMNS; col += 1) {
        const x = columnCentreX(col);
        renderer.circle(x, y, HOLE_RADIUS, COLOUR_HOLE);
        renderer.strokeCircle(x, y, HOLE_RADIUS, RIM_WIDTH, COLOUR_RIM);
        const index = row * COLUMNS + col;
        const cell = this.#board[index];
        if (cell == null || index === falling) continue;
        this.#drawDisc(renderer, cell, x, y, DISC_RADIUS, RING_WIDTH);
      }
    }
  }

  #drawHover(renderer: Renderer): void {
    if (this.#roundOutcome !== null || this.#dropSteps > 0) return;
    const difficulty = this.#active === 'p1' ? this.#botP1 : this.#botP2;
    if (difficulty !== null) return;

    const column = this.#hoverColumn;
    const x = columnCentreX(column);
    renderer.line(x, HOVER_Y + DISC_RADIUS, x, BOARD_ORIGIN_Y, GUIDE_WIDTH, COLOUR_GUIDE);
    this.#drawDisc(renderer, this.#active, x, HOVER_Y, DISC_RADIUS, RING_WIDTH);
    const landing = dropRow(this.#board, column);
    if (landing < 0) return;
    // Marking the cell the disc will reach, rather than only the column, is what makes
    // the aim readable without colour.
    renderer.strokeCircle(x, rowCentreY(landing), HOLE_RADIUS - 8, GUIDE_WIDTH, COLOUR_GUIDE);
  }

  #drawFalling(renderer: Renderer, alpha: number): void {
    const total = this.#dropTotalSteps;
    if (this.#dropSteps <= 0 || total <= 0) return;
    let travelled = (total - this.#dropSteps + alpha) / total;
    if (travelled < 0) travelled = 0;
    else if (travelled > 1) travelled = 1;
    // Free fall: distance grows with the square of the time, so the disc accelerates
    // into the stack instead of sliding down at a constant rate.
    const fall = travelled * travelled;
    const toY = rowCentreY(this.#dropRow);
    const y = HOVER_Y + (toY - HOVER_Y) * fall;
    const x = columnCentreX(this.#dropColumn);
    this.#drawDisc(renderer, this.#dropSeat, x, y, DISC_RADIUS, RING_WIDTH);
  }

  #drawHighlight(renderer: Renderer): void {
    if (!this.#hasLine || this.#dropSteps > 0) return;
    for (let i = 0; i < LINE_LENGTH; i += 1) {
      const index = this.#lineCells[i];
      if (index === undefined) continue;
      const x = columnCentreX(index % COLUMNS);
      const y = rowCentreY(Math.floor(index / COLUMNS));
      renderer.strokeCircle(x, y, HOLE_RADIUS + 4, HIGHLIGHT_WIDTH, COLOUR_HIGHLIGHT);
    }
  }

  /**
   * A filled disc for p1 and a ring for p2. The shapes carry the ownership on their
   * own, so the board stays readable in greyscale and to a colour-blind player.
   */
  #drawDisc(
    renderer: Renderer,
    seat: SeatId,
    x: number,
    y: number,
    radius: number,
    ringWidth: number,
  ): void {
    if (seat === 'p1') {
      renderer.circle(x, y, radius, COLOUR_P1);
      return;
    }
    renderer.strokeCircle(x, y, radius - ringWidth / 2, ringWidth, COLOUR_P2);
  }
}
