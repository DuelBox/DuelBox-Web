import type { Rng, SeatId } from '@duelbox/engine';
import { DEFAULT_SEARCH_NODES, SearchBudget, deepen } from '@duelbox/game-sdk';

/**
 * Reversi, as pure rules.
 *
 * No rendering, no timing, no DOM. The game, the bot and any future balance harness drive
 * this module, so what a harness measures is what a player feels.
 *
 * A move is legal only where it *flanks*: placing a piece must sandwich an unbroken run of
 * the opponent's pieces against one of your own, in at least one of eight directions.
 * Every flanked run flips. That single rule produces the game's whole character — a board
 * can swing completely in one move, so counting pieces mid-game tells you very little.
 */

export const COLUMNS = 8;
export const ROWS = 8;
export const CELL_COUNT = COLUMNS * ROWS;

export type Cell = SeatId | null;
export type Board = Cell[];

/** The eight directions a run can be flanked in, as (column, row) steps. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export function indexOf(column: number, row: number): number {
  return row * COLUMNS + column;
}

export function columnOf(index: number): number {
  return index % COLUMNS;
}

export function rowOf(index: number): number {
  return Math.floor(index / COLUMNS);
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function createBoard(): Board {
  const board: Board = new Array<Cell>(CELL_COUNT).fill(null);
  resetBoard(board);
  return board;
}

/**
 * Reset in place, so a rematch allocates nothing.
 *
 * The opening four are diagonal by rule, not by choice: p1 on one diagonal, p2 on the
 * other. Getting this the wrong way round is a classic bug — it makes the first move's
 * options mirror-image and quietly changes every opening.
 */
export function resetBoard(board: Board): void {
  board.fill(null);
  board[indexOf(3, 3)] = 'p2';
  board[indexOf(4, 4)] = 'p2';
  board[indexOf(3, 4)] = 'p1';
  board[indexOf(4, 3)] = 'p1';
}

/**
 * How many pieces a move would flip in one direction, or 0 if it flanks nothing.
 *
 * A run counts only when it is unbroken opponent pieces terminated by one of the mover's
 * own. Running off the board, or reaching an empty square, flanks nothing.
 */
export function runLength(
  board: Board,
  index: number,
  seat: SeatId,
  dx: number,
  dy: number,
): number {
  const other = otherOf(seat);
  let column = columnOf(index) + dx;
  let row = rowOf(index) + dy;
  let run = 0;

  while (column >= 0 && column < COLUMNS && row >= 0 && row < ROWS) {
    const cell = board[indexOf(column, row)];
    if (cell === other) {
      run += 1;
    } else if (cell === seat) {
      // Terminated by our own piece: the run in between is flanked.
      return run;
    } else {
      // An empty square breaks the run.
      return 0;
    }
    column += dx;
    row += dy;
  }
  // Ran off the edge without being terminated.
  return 0;
}

/** How many pieces a move would flip in total. Zero means the move is illegal. */
export function flipCount(board: Board, index: number, seat: SeatId): number {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return 0;
  if (board[index] !== null) return 0;
  let total = 0;
  for (const [dx, dy] of DIRECTIONS) total += runLength(board, index, seat, dx, dy);
  return total;
}

export function isLegalMove(board: Board, index: number, seat: SeatId): boolean {
  return flipCount(board, index, seat) > 0;
}

/**
 * Every square `seat` may play.
 *
 * Written into a caller-supplied array and returning the count, because this runs at
 * every node of the bot's search and returning a fresh array there would allocate per
 * node.
 */
export function legalMoves(out: number[], board: Board, seat: SeatId): number {
  let count = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (flipCount(board, index, seat) > 0) out[count++] = index;
  }
  return count;
}

export function hasLegalMove(board: Board, seat: SeatId): boolean {
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (flipCount(board, index, seat) > 0) return true;
  }
  return false;
}

/**
 * Play a move, flipping every flanked run.
 *
 * Returns the number of pieces flipped, or -1 for an illegal move — distinct from 0,
 * because a legal move always flips at least one piece, so 0 could only ever mean
 * "refused" and a caller must not confuse the two.
 */
export function applyMove(board: Board, index: number, seat: SeatId): number {
  if (!isLegalMove(board, index, seat)) return -1;
  board[index] = seat;

  let flipped = 0;
  for (const [dx, dy] of DIRECTIONS) {
    const run = runLength(board, index, seat, dx, dy);
    let column = columnOf(index) + dx;
    let row = rowOf(index) + dy;
    for (let i = 0; i < run; i += 1) {
      board[indexOf(column, row)] = seat;
      column += dx;
      row += dy;
      flipped += 1;
    }
  }
  return flipped;
}

export interface Tally {
  readonly p1: number;
  readonly p2: number;
}

export function tallyOf(board: Board): Tally {
  let p1 = 0;
  let p2 = 0;
  for (const cell of board) {
    if (cell === 'p1') p1 += 1;
    else if (cell === 'p2') p2 += 1;
  }
  return { p1, p2 };
}

/**
 * Whether the game is over.
 *
 * Not "the board is full". A game ends when *neither* seat can move, which happens well
 * before a full board when one colour has been wiped out or both are blocked. Treating a
 * full board as the only end condition is the bug that leaves a game unable to finish.
 */
export function isOver(board: Board): boolean {
  return !hasLegalMove(board, 'p1') && !hasLegalMove(board, 'p2');
}

export function winnerOf(board: Board): SeatId | 'draw' | null {
  if (!isOver(board)) return null;
  const { p1, p2 } = tallyOf(board);
  if (p1 === p2) return 'draw';
  return p1 > p2 ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** How often each tier plays at random instead of the move it found. */
export const BLUNDER_CHANCE: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 0.55,
  normal: 0.18,
  hard: 0,
});

/** How deep each tier searches. Depth is reliability, not extra information. */
export const SEARCH_DEPTH: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 1,
  normal: 2,
  hard: 4,
});

/**
 * What each square is worth.
 *
 * Corners cannot ever be flipped — nothing can flank them — so they are the only truly
 * permanent squares on the board, and the squares diagonally adjacent are the worst
 * because playing one hands a corner over. Piece *count* is nearly worthless before the
 * endgame, which is why this table exists rather than a simple tally.
 */
/* The 8x8 shape below is the documentation: corners are the only permanent squares on
   the board, and the ones diagonally adjacent are the worst because playing one hands a
   corner over. Flattened into a paragraph none of that is visible, hence the directive. */
// prettier-ignore
const SQUARE_VALUE: readonly number[] = [
  120, -20,  20,   5,   5,  20, -20, 120,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
   20,  -5,  15,   3,   3,  15,  -5,  20,
    5,  -5,   3,   3,   3,   3,  -5,   5,
    5,  -5,   3,   3,   3,   3,  -5,   5,
   20,  -5,  15,   3,   3,  15,  -5,  20,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
  120, -20,  20,   5,   5,  20, -20, 120,
];

/** Positional score from `seat`'s point of view. */
export function evaluate(board: Board, seat: SeatId): number {
  const other = otherOf(seat);
  let score = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const cell = board[index];
    const value = SQUARE_VALUE[index] ?? 0;
    if (cell === seat) score += value;
    else if (cell === other) score -= value;
  }
  // Mobility: having moves your opponent does not is worth real material here, because a
  // player with no move must pass and hand the initiative over.
  const mine = countMoves(board, seat);
  const theirs = countMoves(board, other);
  return score + (mine - theirs) * 10;
}

function countMoves(board: Board, seat: SeatId): number {
  let count = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (flipCount(board, index, seat) > 0) count += 1;
  }
  return count;
}

/** One board per ply, reused across the whole search so no node allocates. */
const searchBoards: Board[] = Array.from({ length: 8 }, () =>
  new Array<Cell>(CELL_COUNT).fill(null),
);
const moveBuffers: number[][] = Array.from({ length: 8 }, () =>
  new Array<number>(CELL_COUNT).fill(0),
);

function copyInto(target: Board, source: Board): void {
  for (let i = 0; i < CELL_COUNT; i += 1) target[i] = source[i] ?? null;
}

/**
 * Negamax with an alpha-beta window, scored from `toMove`'s point of view.
 *
 * A pass — a seat with no legal move — is a real position in Reversi rather than an
 * error, so it recurses with the turn handed over and the depth unchanged. Two passes in
 * a row is the end of the game.
 */
function search(
  board: Board,
  toMove: SeatId,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  budget: SearchBudget,
): number {
  // Charged before the leaf check, not after. Charging only internal nodes left the leaves
  // — which are the overwhelming majority of the work, and all of the evaluation — free,
  // so a depth-four sweep counted about 1,100 nodes while actually visiting 11,000. The
  // ceiling sat above the thing it was meant to limit and nothing changed.
  //
  // Out of budget: hand back a static score rather than a lie. The caller throws the whole
  // depth away, so this value is never what a move is chosen on.
  if (!budget.spend()) return evaluate(board, toMove);
  if (depth === 0) return evaluate(board, toMove);

  const buffer = moveBuffers[ply] ?? [];
  const count = legalMoves(buffer, board, toMove);

  if (count === 0) {
    if (!hasLegalMove(board, otherOf(toMove))) {
      // Neither can move: the game is over, so score the finished position decisively.
      const { p1, p2 } = tallyOf(board);
      const mine = toMove === 'p1' ? p1 : p2;
      const theirs = toMove === 'p1' ? p2 : p1;
      return (mine - theirs) * 1000;
    }
    return -search(board, otherOf(toMove), depth, ply, -beta, -alpha, budget);
  }

  const next = searchBoards[ply] ?? board;
  let best = -Infinity;
  for (let i = 0; i < count; i += 1) {
    copyInto(next, board);
    applyMove(next, buffer[i] as number, toMove);
    const score = -search(next, otherOf(toMove), depth - 1, ply + 1, -beta, -alpha, budget);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * The move a bot plays, or -1 when it has none and must pass.
 *
 * Every tier sees exactly the board a human sees — CLAUDE.md rule 6. Difficulty is search
 * depth and blunder rate, never extra information.
 */
export function bestMove(board: Board, seat: SeatId, rng: Rng, difficulty: BotDifficulty): number {
  const buffer = moveBuffers[0] ?? [];
  const count = legalMoves(buffer, board, seat);
  if (count === 0) return -1;

  if (rng.bool(BLUNDER_CHANCE[difficulty])) {
    return buffer[rng.int(0, count)] as number;
  }

  const candidates = buffer.slice(0, count);
  const next = searchBoards[0] ?? board;
  const budget = new SearchBudget(DEFAULT_SEARCH_NODES);

  /**
   * One full sweep at a fixed depth, or null when the budget ran out part-way.
   *
   * A partial depth is thrown away rather than trusted: half a ply is not an opinion, it
   * is whichever moves happened to be generated first.
   */
  const sweep = (depth: number): number | null => {
    let best = candidates[0] as number;
    let bestScore = -Infinity;
    for (const move of candidates) {
      copyInto(next, board);
      applyMove(next, move, seat);
      const score = -search(next, otherOf(seat), depth - 1, 1, -Infinity, Infinity, budget);
      if (budget.exhausted) return null;
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  };

  // Iterative deepening under a node budget rather than a single sweep at a fixed depth.
  // The single sweep took 31.5 ms on a development machine — twice a 60 Hz frame, and
  // several frames on a phone. Deepening is what makes running out of budget safe: the
  // best move from the last depth that finished is already in hand.
  const found = deepen(budget, SEARCH_DEPTH[difficulty], sweep);
  return found >= 0 ? found : (candidates[0] as number);
}
