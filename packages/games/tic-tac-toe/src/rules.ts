import { otherSeat } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * The rules of noughts and crosses, with nothing else in them.
 *
 * No rendering, no timing, no DOM: the game, the bot and the balance harness all read
 * the position through these functions, so there is exactly one definition of what a
 * legal move is and what a won board looks like.
 */

/** A seat owns the square, or nobody does. */
export type Cell = 'p1' | 'p2' | null;

/** Nine cells, row-major: index = row * 3 + column. */
export type Board = readonly Cell[];

export const BOARD_COLUMNS = 3;
export const CELL_COUNT = 9;

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * How often each tier throws the position away and plays at random.
 *
 * A bot that solves the game every time is unbeatable and therefore not fun, and a bot
 * that peeks at hidden state or moves faster than a hand can is worse. The tiers differ
 * only in how often perfect play is abandoned, so every bot is beatable by playing well.
 */
export const BLUNDER_CHANCE: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 0.45,
  normal: 0.15,
  hard: 0,
});

/** The eight lines, flattened to triples of cell indices. */
const LINES: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 3, 6, 1, 4, 7, 2, 5, 8, 0, 4, 8, 2, 4, 6,
];

const LINE_COUNT = 8;

/** A won position scores this much, less the ply it took, so a quicker win ranks higher. */
const WIN_SCORE = 10;

/** Below every reachable score, so the first legal move at a node always replaces it. */
const SCORE_FLOOR = -(WIN_SCORE + 1);

/**
 * One board reused by the whole minimax recursion, mutated and undone per node.
 *
 * Module scope rather than a parameter because {@link bestMove} is called from the
 * game's fixed-step update, which may not allocate: a per-call working board would be
 * a per-step allocation. Nothing here is re-entrant, and nothing needs to be — a step
 * runs to completion before the next one starts.
 */
const searchBoard: Cell[] = createBoard();

/** Scratch for the blunder draw, sized for a full board so it never has to grow. */
const blunderMoves: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/** Reads through `noUncheckedIndexedAccess`; an out-of-range index reads as empty. */
function at(board: Board, index: number): Cell {
  const cell = board[index];
  return cell === undefined ? null : cell;
}

/** Cell index of one slot of one line, or -1 if the triple is out of range. */
function lineCell(triple: number, slot: number): number {
  const index = LINES[triple * 3 + slot];
  return index === undefined ? -1 : index;
}

/** The seat holding all three cells of `triple`, or null. */
function lineOwner(board: Board, triple: number): SeatId | null {
  const first = at(board, lineCell(triple, 0));
  if (first === null) return null;
  if (at(board, lineCell(triple, 1)) !== first) return null;
  if (at(board, lineCell(triple, 2)) !== first) return null;
  return first;
}

/** Ordinal of the first completed line, or -1 while none is complete. */
function completedLine(board: Board): number {
  for (let triple = 0; triple < LINE_COUNT; triple += 1) {
    if (lineOwner(board, triple) !== null) return triple;
  }
  return -1;
}

export function createBoard(): Cell[] {
  return [null, null, null, null, null, null, null, null, null];
}

/**
 * Writes the indices of the empty cells into `out` and returns how many it wrote.
 *
 * The count is the return value rather than `out.length` so that one buffer can serve
 * every call without ever being resized: entries at and beyond the returned count are
 * left over from an earlier call and must not be read. `out` must hold
 * {@link CELL_COUNT} entries.
 */
export function legalMoves(board: Board, out: number[]): number {
  let count = 0;
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (at(board, i) !== null) continue;
    out[count] = i;
    count += 1;
  }
  return count;
}

/**
 * Claims a cell for a seat. Returns false and leaves the board untouched when the index
 * is not a cell or the cell is already taken, so a caller may offer any tap at all.
 */
export function applyMove(board: Cell[], index: number, seat: SeatId): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return false;
  if (board[index] !== null) return false;
  board[index] = seat;
  return true;
}

/** The seat holding a line, 'draw' once the board is full without one, else null. */
export function winnerOf(board: Board): SeatId | 'draw' | null {
  for (let triple = 0; triple < LINE_COUNT; triple += 1) {
    const owner = lineOwner(board, triple);
    if (owner !== null) return owner;
  }
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (at(board, i) === null) return null;
  }
  return 'draw';
}

/**
 * The three cell indices of the completed line, for a render to strike through.
 *
 * Allocates, which is why it is called when the position changes rather than per frame.
 * The fixed-step simulation uses {@link winningLineInto} instead.
 */
export function winningLine(board: Board): readonly number[] | null {
  const triple = completedLine(board);
  if (triple < 0) return null;
  return [lineCell(triple, 0), lineCell(triple, 1), lineCell(triple, 2)];
}

/**
 * {@link winningLine} without the allocation: writes the three indices into `out` and
 * returns whether there was a line to write. `out` must hold three entries.
 */
export function winningLineInto(board: Board, out: number[]): boolean {
  const triple = completedLine(board);
  if (triple < 0) return false;
  out[0] = lineCell(triple, 0);
  out[1] = lineCell(triple, 1);
  out[2] = lineCell(triple, 2);
  return true;
}

/**
 * Exact minimax over {@link searchBoard}, scored from the point of view of `toMove`.
 *
 * The window is alpha-beta, which only ever prunes branches whose value cannot change
 * the choice made above them, so the answer is the same one an exhaustive search gives.
 * `depth` is the ply from the root and biases the score towards winning sooner and
 * losing later, which is what makes the bot finish a won game instead of shuffling.
 */
function search(toMove: SeatId, depth: number, alpha: number, beta: number): number {
  const outcome = winnerOf(searchBoard);
  if (outcome === 'draw') return 0;
  // Only the seat that has just moved can have completed a line, so a decided position
  // is always a loss for the seat about to move.
  if (outcome !== null) return depth - WIN_SCORE;

  let best = SCORE_FLOOR;
  let lower = alpha;
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (searchBoard[i] !== null) continue;
    searchBoard[i] = toMove;
    const score = -search(otherSeat(toMove), depth + 1, -beta, -lower);
    searchBoard[i] = null;
    if (score > best) best = score;
    if (best > lower) lower = best;
    if (lower >= beta) break;
  }
  return best;
}

/**
 * The move `seat` should play, or -1 on a board with no empty cell.
 *
 * With probability `blunderChance` a uniformly random legal move is played instead of
 * the solved one; otherwise the position is solved exactly. Ties are broken by the
 * lowest cell index, so the same board and the same generator state always give the
 * same move.
 */
export function bestMove(board: Board, seat: SeatId, rng: Rng, blunderChance: number): number {
  const count = legalMoves(board, blunderMoves);
  // Drawn before the search rather than inside it, so the search never touches the
  // generator and the move depends only on the state the caller handed in.
  const blunder = rng.bool(blunderChance);
  if (count === 0) return -1;
  if (blunder) {
    const pick = blunderMoves[rng.int(0, count)];
    return pick === undefined ? -1 : pick;
  }

  for (let i = 0; i < CELL_COUNT; i += 1) {
    searchBoard[i] = at(board, i);
  }

  let bestIndex = -1;
  let bestScore = SCORE_FLOOR;
  const opponent = otherSeat(seat);
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (searchBoard[i] !== null) continue;
    searchBoard[i] = seat;
    const score = -search(opponent, 1, -Infinity, -bestScore);
    searchBoard[i] = null;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}
