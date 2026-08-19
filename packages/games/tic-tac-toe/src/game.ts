import { Rng, otherSeat, set, toWorld, vec2 } from '@duelbox/engine';
import type { LogicalSize, SeatId, Vec2 } from '@duelbox/engine';
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
const COLOUR_P1 = '#4cc9f0';
const COLOUR_P2 = '#f7b267';
const COLOUR_STRIKE = '#f4f4f5';
const COLOUR_TEXT = '#e6e9ef';

const GRID_WIDTH = 8;
const MARK_RADIUS = 66;
const MARK_WIDTH = 14;
/** Half-diagonal of the cross, as a fraction of the circle's radius. */
const CROSS_REACH = 0.78;
const STRIKE_WIDTH = 16;
const STRIKE_OVERHANG = 46;

const GLYPH_RADIUS = 26;
const GLYPH_WIDTH = 7;
const SCORE_Y = 62;
const SCORE_SIZE = 44;
const STATUS_Y = 838;
const STATUS_SIZE = 40;
const STATUS_GLYPH_X = 150;
const STATUS_TEXT_X = 200;
const SCORE_P1_GLYPH_X = 330;
const SCORE_P1_TEXT_X = 372;
const SCORE_P2_GLYPH_X = 500;
const SCORE_P2_TEXT_X = 542;

const LABEL_TO_PLAY = 'to play';
const LABEL_THINKING = 'thinking';
const LABEL_ROUND_WON = 'wins the round';
const LABEL_ROUND_DRAWN = 'round drawn';
const LABEL_MATCH_WON = 'wins the match';
const LABEL_MATCH_DRAWN = 'match drawn';

/** Round counts never exceed MAX_ROUNDS, so no score needs a string built per frame. */
const COUNT_LABELS: readonly string[] = ['0', '1', '2', '3', '4', '5'];

function countLabel(count: number): string {
  const label = COUNT_LABELS[count];
  return label === undefined ? '' : label;
}

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
  #sharedScreen = false;
  #localSeat: SeatId = 'p1';
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
    this.#sharedScreen = context.presentation === 'shared-screen';
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
    if (!seatInput.actionPressed) return;
    const pointer = seatInput.pointer;
    if (pointer === null) return;
    // The board is drawn under the active seat's rotation, so a device-space tap has to
    // be turned into board space before it names a cell.
    toWorld(this.#pointerWorld, pointer.x, pointer.y, this.#logical, this.#isRotated());
    const cell = cellIndexAt(this.#pointerWorld.x, this.#pointerWorld.y);
    if (cell < 0) return;
    if (!applyMove(this.#board, cell, active)) return;
    this.#settleMove();
  }

  render(renderer: Renderer): void {
    renderer.clear(COLOUR_BACKGROUND);
    renderer.pushSeatRotation(this.#isRotated());
    this.#drawGrid(renderer);
    this.#drawMarks(renderer);
    if (this.#hasStrike) this.#drawStrike(renderer);
    this.#drawScore(renderer);
    this.#drawStatus(renderer);
    renderer.popSeatRotation();
  }

  // The shell stops stepping a paused match, so a board with no continuous state has
  // nothing of its own to suspend or restart.
  onPause(): void {}

  onResume(): void {}

  getScore(): MatchScore {
    return { p1: this.#tally.p1, p2: this.#tally.p2, winner: this.#matchWinner };
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

  #isRotated(): boolean {
    return this.#sharedScreen && this.#active !== this.#localSeat;
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

  #drawScore(renderer: Renderer): void {
    this.#drawMark(renderer, 'p1', SCORE_P1_GLYPH_X, SCORE_Y, GLYPH_RADIUS, GLYPH_WIDTH);
    renderer.text(countLabel(this.#tally.p1), SCORE_P1_TEXT_X, SCORE_Y, SCORE_SIZE, COLOUR_TEXT);
    this.#drawMark(renderer, 'p2', SCORE_P2_GLYPH_X, SCORE_Y, GLYPH_RADIUS, GLYPH_WIDTH);
    renderer.text(countLabel(this.#tally.p2), SCORE_P2_TEXT_X, SCORE_Y, SCORE_SIZE, COLOUR_TEXT);
  }

  #drawStatus(renderer: Renderer): void {
    let seat: SeatId | null = null;
    let label = LABEL_MATCH_DRAWN;

    if (this.#matchWinner !== null) {
      if (this.#matchWinner !== 'draw') {
        seat = this.#matchWinner;
        label = LABEL_MATCH_WON;
      }
    } else if (this.#roundOutcome !== null) {
      if (this.#roundOutcome === 'draw') {
        label = LABEL_ROUND_DRAWN;
      } else {
        seat = this.#roundOutcome;
        label = LABEL_ROUND_WON;
      }
    } else {
      seat = this.#active;
      const difficulty = this.#active === 'p1' ? this.#botP1 : this.#botP2;
      label = difficulty === null ? LABEL_TO_PLAY : LABEL_THINKING;
    }

    if (seat !== null) {
      this.#drawMark(renderer, seat, STATUS_GLYPH_X, STATUS_Y, GLYPH_RADIUS, GLYPH_WIDTH);
    }
    renderer.text(label, STATUS_TEXT_X, STATUS_Y, STATUS_SIZE, COLOUR_TEXT);
  }
}
