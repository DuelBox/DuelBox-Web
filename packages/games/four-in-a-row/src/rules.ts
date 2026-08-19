import { otherSeat } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * The rules of Drop Four, with nothing else in them.
 *
 * No rendering, no timing, no DOM: the game, the bot and the balance harness all read
 * the position through these functions, so there is exactly one definition of what a
 * legal drop is and what four in a row looks like.
 */

/** A seat owns the cell, or nobody does. */
export type Cell = 'p1' | 'p2' | null;

/**
 * Forty-two cells, row-major: index = row * {@link COLUMNS} + column.
 *
 * ROW 0 IS THE TOP and row 5 is the floor, so gravity runs towards increasing row —
 * the same direction the renderer's y axis runs, which is why nothing has to be
 * flipped between the rules and the picture.
 */
export type Board = readonly Cell[];

export const COLUMNS = 7;
export const ROWS = 6;
export const CELL_COUNT = COLUMNS * ROWS;

/** Discs in a row that win. */
export const LINE_LENGTH = 4;

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * How many plies each tier looks ahead.
 *
 * Difficulty is only ever how far the bot sees and how often it throws the position
 * away: no tier reads anything a player at the other end of the board cannot read, and
 * none of them gets an extra move or a faster one.
 */
export const SEARCH_DEPTH: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 2,
  normal: 4,
  hard: 6,
});

/** How often a tier abandons its search and drops into a uniformly random column. */
export const BLUNDER_CHANCE: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 0.3,
  normal: 0,
  hard: 0,
});

/**
 * The four line directions as (rowStep, columnStep) pairs, flattened.
 *
 * Each is scanned in one sense only — right, down, down-right, down-left — because a
 * line and its reverse are the same four cells.
 */
const DIRECTIONS: readonly number[] = [0, 1, 1, 0, 1, 1, 1, -1];

const DIRECTION_COUNT = 4;

/** A won position scores this much, less the ply it took, so a quicker win ranks higher. */
const WIN_SCORE = 1_000_000;

/** Below every reachable score, so the first legal move at a node always replaces it. */
const SCORE_FLOOR = -(WIN_SCORE + 1);

/**
 * Centre-out column order. The middle column takes part in more of the sixty-nine
 * possible lines than any other, so trying it first makes alpha-beta cut far more of
 * the tree — and it is also the tie-break, so an even position is played centrally.
 */
const MOVE_ORDER: readonly number[] = [3, 2, 4, 1, 5, 0, 6];

/** Lines a disc in this column can take part in, which is what makes the centre worth more. */
const CENTRE_WEIGHT: readonly number[] = [1, 2, 4, 6, 4, 2, 1];

const WINDOW_TWO = 8;
const WINDOW_THREE = 60;

/**
 * An opponent three is scored heavier than one of the bot's own, so a bot choosing
 * between extending its own three and blocking the other's blocks: a threat left
 * standing becomes a loss one ply later, while an extension is still only a threat.
 */
const WINDOW_THREE_AGAINST = 80;

/** Only reachable when the caller evaluates a position that is already decided. */
const WINDOW_LINE = 2000;

/**
 * One board reused by the whole search, mutated and undone per node, with the stack
 * height of each column carried alongside so a drop and its undo are both O(1).
 *
 * Module scope rather than a parameter because {@link bestColumn} is called from the
 * game's fixed-step update, which may not allocate: a per-call working board would be
 * a per-step allocation. Nothing here is re-entrant, and nothing needs to be — a step
 * runs to completion before the next one starts.
 */
const searchBoard: Cell[] = createBoard();
const searchHeights: number[] = [0, 0, 0, 0, 0, 0, 0];

/** Scratch for {@link winnerOf}, so deciding a position allocates nothing. */
const scanCells: number[] = [0, 0, 0, 0];

/** Scratch for the blunder draw, sized for every column so it never has to grow. */
const blunderColumns: number[] = [0, 0, 0, 0, 0, 0, 0];

/** Reads through `noUncheckedIndexedAccess`; an out-of-range index reads as empty. */
function cellOf(board: Board, index: number): Cell {
  const cell = board[index];
  return cell === undefined ? null : cell;
}

function directionRow(direction: number): number {
  const step = DIRECTIONS[direction * 2];
  return step === undefined ? 0 : step;
}

function directionColumn(direction: number): number {
  const step = DIRECTIONS[direction * 2 + 1];
  return step === undefined ? 0 : step;
}

export function createBoard(): Cell[] {
  const board: Cell[] = [];
  for (let i = 0; i < CELL_COUNT; i += 1) board.push(null);
  return board;
}

/**
 * Discs stacked in `col`, counted up from the floor and stopping at the first gap.
 *
 * An out-of-range or non-integer column reads as full, so a caller asking "is there
 * room?" is refused a nonsense column exactly as it is refused a stacked one.
 */
export function columnHeight(board: Board, col: number): number {
  if (!Number.isInteger(col) || col < 0 || col >= COLUMNS) return ROWS;
  let height = 0;
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (cellOf(board, row * COLUMNS + col) === null) break;
    height += 1;
  }
  return height;
}

/** The row a disc dropped into `col` would come to rest in, or -1 when it cannot be played. */
export function dropRow(board: Board, col: number): number {
  const height = columnHeight(board, col);
  return height >= ROWS ? -1 : ROWS - 1 - height;
}

/**
 * Drops a disc for `seat` and returns the row it landed in, or -1 without touching the
 * board when the column is full or is not a column at all — so a caller may offer any
 * tap at all.
 */
export function applyDrop(board: Cell[], col: number, seat: SeatId): number {
  const row = dropRow(board, col);
  if (row < 0) return -1;
  board[row * COLUMNS + col] = seat;
  return row;
}

/**
 * Writes the playable columns into `out` and returns how many it wrote.
 *
 * The count is the return value rather than `out.length` so that one buffer can serve
 * every call without ever being resized: entries at and beyond the returned count are
 * left over from an earlier call and must not be read. `out` must hold
 * {@link COLUMNS} entries.
 */
export function legalColumns(board: Board, out: number[]): number {
  let count = 0;
  for (let col = 0; col < COLUMNS; col += 1) {
    if (dropRow(board, col) < 0) continue;
    out[count] = col;
    count += 1;
  }
  return count;
}

/**
 * Finds the first complete line, writes its four cell indices into `out` and returns
 * the seat holding it, or null. `out` must hold {@link LINE_LENGTH} entries and is
 * left untouched when there is no line.
 *
 * Scanning is row-major from the top-left, directions in the order they are declared,
 * so the same board always reports the same line.
 */
function findLine(board: Board, out: number[]): SeatId | null {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLUMNS; col += 1) {
      const seat = cellOf(board, row * COLUMNS + col);
      if (seat === null) continue;
      for (let d = 0; d < DIRECTION_COUNT; d += 1) {
        const rowStep = directionRow(d);
        const colStep = directionColumn(d);
        const endRow = row + rowStep * (LINE_LENGTH - 1);
        const endCol = col + colStep * (LINE_LENGTH - 1);
        // The window is a straight run, so checking only its far end keeps every cell
        // between the two ends on the board as well.
        if (endRow < 0 || endRow >= ROWS || endCol < 0 || endCol >= COLUMNS) continue;
        let matched = true;
        for (let step = 1; step < LINE_LENGTH; step += 1) {
          const index = (row + rowStep * step) * COLUMNS + (col + colStep * step);
          if (cellOf(board, index) !== seat) {
            matched = false;
            break;
          }
        }
        if (!matched) continue;
        for (let step = 0; step < LINE_LENGTH; step += 1) {
          out[step] = (row + rowStep * step) * COLUMNS + (col + colStep * step);
        }
        return seat;
      }
    }
  }
  return null;
}

/**
 * The seat holding a line, 'draw' once no column can be played without one, else null.
 *
 * A draw is defined as "no line and no legal move" rather than "every cell filled", so
 * it is the same question the game asks when it decides whether the round is over.
 */
export function winnerOf(board: Board): SeatId | 'draw' | null {
  const owner = findLine(board, scanCells);
  if (owner !== null) return owner;
  for (let col = 0; col < COLUMNS; col += 1) {
    if (dropRow(board, col) >= 0) return null;
  }
  return 'draw';
}

/**
 * The four cell indices of the completed line, for a render to highlight.
 *
 * Allocates, which is why it is called when the position changes rather than per frame.
 * The fixed-step simulation uses {@link winningCellsInto} instead.
 */
export function winningCells(board: Board): readonly number[] | null {
  const cells: number[] = [0, 0, 0, 0];
  return findLine(board, cells) === null ? null : cells;
}

/**
 * {@link winningCells} without the allocation: writes the four indices into `out` and
 * returns whether there was a line to write. `out` must hold {@link LINE_LENGTH} entries.
 */
export function winningCellsInto(board: Board, out: number[]): boolean {
  return findLine(board, out) !== null;
}

/** Drops a disc on {@link searchBoard}, returning the row, or -1 when the column is full. */
function pushDisc(col: number, seat: SeatId): number {
  const height = searchHeights[col] ?? ROWS;
  if (height >= ROWS) return -1;
  const row = ROWS - 1 - height;
  searchBoard[row * COLUMNS + col] = seat;
  searchHeights[col] = height + 1;
  return row;
}

/** Undoes the last {@link pushDisc} on that column. */
function popDisc(col: number): void {
  const height = searchHeights[col] ?? 0;
  if (height <= 0) return;
  searchBoard[(ROWS - height) * COLUMNS + col] = null;
  searchHeights[col] = height - 1;
}

/** Cells matching `seat` walking out of (row, col) along one direction, excluding it. */
function runFrom(row: number, col: number, rowStep: number, colStep: number, seat: SeatId): number {
  let run = 0;
  let r = row + rowStep;
  let c = col + colStep;
  while (r >= 0 && r < ROWS && c >= 0 && c < COLUMNS) {
    if (searchBoard[r * COLUMNS + c] !== seat) break;
    run += 1;
    r += rowStep;
    c += colStep;
  }
  return run;
}

/**
 * Whether the disc just dropped at (row, col) completes a line on {@link searchBoard}.
 *
 * Only lines through that one cell can be new, so the search never rescans the board.
 */
function completesLine(row: number, col: number, seat: SeatId): boolean {
  for (let d = 0; d < DIRECTION_COUNT; d += 1) {
    const rowStep = directionRow(d);
    const colStep = directionColumn(d);
    const forward = runFrom(row, col, rowStep, colStep, seat);
    const backward = runFrom(row, col, -rowStep, -colStep, seat);
    if (1 + forward + backward >= LINE_LENGTH) return true;
  }
  return false;
}

/** Value of the four-cell window anchored at (row, col), or 0 when it runs off the board. */
function windowScore(
  row: number,
  col: number,
  direction: number,
  seat: SeatId,
  opponent: SeatId,
): number {
  const rowStep = directionRow(direction);
  const colStep = directionColumn(direction);
  const endRow = row + rowStep * (LINE_LENGTH - 1);
  const endCol = col + colStep * (LINE_LENGTH - 1);
  if (endRow < 0 || endRow >= ROWS || endCol < 0 || endCol >= COLUMNS) return 0;

  let mine = 0;
  let theirs = 0;
  for (let step = 0; step < LINE_LENGTH; step += 1) {
    const cell = searchBoard[(row + rowStep * step) * COLUMNS + (col + colStep * step)];
    if (cell === seat) mine += 1;
    else if (cell === opponent) theirs += 1;
  }

  // A window holding both seats can never be completed by either, so it is worth
  // nothing to either — counting it would reward filling dead space.
  if (mine > 0 && theirs > 0) return 0;
  if (mine >= LINE_LENGTH) return WINDOW_LINE;
  if (mine === LINE_LENGTH - 1) return WINDOW_THREE;
  if (mine === LINE_LENGTH - 2) return WINDOW_TWO;
  if (theirs >= LINE_LENGTH) return -WINDOW_LINE;
  if (theirs === LINE_LENGTH - 1) return -WINDOW_THREE_AGAINST;
  if (theirs === LINE_LENGTH - 2) return -WINDOW_TWO;
  return 0;
}

/**
 * Heuristic value of {@link searchBoard} from `seat`'s point of view; positive is good
 * for `seat`.
 *
 * Two things decide it: how central the seat's discs are, since a central disc takes
 * part in more lines than an edge one, and how many four-cell windows each side still
 * has to itself.
 */
function evaluate(seat: SeatId): number {
  const opponent = otherSeat(seat);
  let score = 0;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLUMNS; col += 1) {
      const cell = searchBoard[row * COLUMNS + col];
      const weight = CENTRE_WEIGHT[col] ?? 0;
      if (cell === seat) score += weight;
      else if (cell === opponent) score -= weight;
      for (let d = 0; d < DIRECTION_COUNT; d += 1) {
        score += windowScore(row, col, d, seat, opponent);
      }
    }
  }
  return score;
}

/**
 * Negamax over {@link searchBoard} with an alpha-beta window, scored from the point of
 * view of `toMove`.
 *
 * The window only ever prunes branches whose value cannot change the choice made above
 * them, so the answer is the one an exhaustive search of the same depth gives. `ply` is
 * the distance from the root and biases a win towards happening sooner and a loss
 * towards later, which is what makes the bot finish a won game instead of shuffling.
 */
function search(toMove: SeatId, depth: number, ply: number, alpha: number, beta: number): number {
  const opponent = otherSeat(toMove);
  let best = SCORE_FLOOR;
  let lower = alpha;
  let moves = 0;

  for (let i = 0; i < COLUMNS; i += 1) {
    const col = MOVE_ORDER[i] ?? i;
    const row = pushDisc(col, toMove);
    if (row < 0) continue;
    moves += 1;

    let score: number;
    if (completesLine(row, col, toMove)) score = WIN_SCORE - ply;
    else if (depth <= 1) score = evaluate(toMove);
    else score = -search(opponent, depth - 1, ply + 1, -beta, -lower);

    popDisc(col);
    if (score > best) best = score;
    if (best > lower) lower = best;
    if (lower >= beta) break;
  }

  // No column left to play and no line: the board filled up, which is a draw.
  return moves === 0 ? 0 : best;
}

/**
 * The column `seat` should drop into, or -1 on a board with no playable column.
 *
 * With the tier's blunder chance a uniformly random legal column is played instead of
 * the searched one; otherwise the position is searched to the tier's depth. Ties break
 * towards the centre, so the same board and the same generator state always give the
 * same column.
 */
export function bestColumn(
  board: Board,
  seat: SeatId,
  rng: Rng,
  difficulty: BotDifficulty,
): number {
  const count = legalColumns(board, blunderColumns);
  // Drawn before the search rather than inside it, so the search never touches the
  // generator and the move depends only on the state the caller handed in.
  const blunder = rng.bool(BLUNDER_CHANCE[difficulty]);
  if (count === 0) return -1;
  if (blunder) {
    const pick = blunderColumns[rng.int(0, count)];
    return pick === undefined ? -1 : pick;
  }

  for (let i = 0; i < CELL_COUNT; i += 1) {
    searchBoard[i] = cellOf(board, i);
  }
  for (let col = 0; col < COLUMNS; col += 1) {
    searchHeights[col] = columnHeight(board, col);
  }

  const depth = SEARCH_DEPTH[difficulty];
  const opponent = otherSeat(seat);
  let bestIndex = -1;
  let bestScore = SCORE_FLOOR;

  for (let i = 0; i < COLUMNS; i += 1) {
    const col = MOVE_ORDER[i] ?? i;
    const row = pushDisc(col, seat);
    if (row < 0) continue;

    let score: number;
    if (completesLine(row, col, seat)) score = WIN_SCORE;
    else if (depth <= 1) score = evaluate(seat);
    else score = -search(opponent, depth - 1, 1, -Infinity, -bestScore);

    popDisc(col);
    if (bestIndex < 0 || score > bestScore) {
      bestScore = score;
      bestIndex = col;
    }
  }
  return bestIndex;
}
