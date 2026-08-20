import type { Rng, SeatId } from '@duelbox/engine';
import { DEFAULT_SEARCH_NODES, SearchBudget, deepen } from '@duelbox/game-sdk';

/**
 * Ultimate Tic Tac Toe, as pure rules.
 *
 * Nine small boards in a three-by-three arrangement. Winning three small boards in a line
 * wins the match. The rule that makes it a game rather than nine games is this: **where
 * you place your mark decides which small board your opponent must play in next**. So
 * every move is two decisions at once — what it does here, and where it sends them.
 *
 * No rendering, no timing, no DOM.
 */

export const BOARD_SIZE = 3;
export const CELLS_PER_BOARD = BOARD_SIZE * BOARD_SIZE;
export const BOARD_COUNT = CELLS_PER_BOARD;
export const CELL_COUNT = BOARD_COUNT * CELLS_PER_BOARD;

export type Cell = SeatId | null;
/** A small board's result: a seat, 'draw' when full with no line, or null while live. */
export type BoardResult = SeatId | 'draw' | null;

export interface Game {
  /** Every cell of every small board, small board major. */
  readonly cells: Cell[];
  /** Each small board's result. */
  readonly boards: BoardResult[];
  /**
   * Which small board the next move must be played in, or -1 when it may be any.
   *
   * -1 happens when the sent-to board is already decided or full — otherwise a player
   * could be sent somewhere with no legal move and the game would deadlock.
   */
  sentTo: number;
}

export function createGame(): Game {
  return {
    cells: new Array<Cell>(CELL_COUNT).fill(null),
    boards: new Array<BoardResult>(BOARD_COUNT).fill(null),
    sentTo: -1,
  };
}

export function resetGame(game: Game): void {
  game.cells.fill(null);
  game.boards.fill(null);
  game.sentTo = -1;
}

export function cellIndex(board: number, cell: number): number {
  return board * CELLS_PER_BOARD + cell;
}

export function boardOf(index: number): number {
  return Math.floor(index / CELLS_PER_BOARD);
}

export function cellOf(index: number): number {
  return index % CELLS_PER_BOARD;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** The eight lines of a three-by-three grid. Shared by the small boards and the big one. */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** Who has a line in a nine-cell grid, or null. Works for cells and for board results. */
export function lineWinner(grid: readonly (SeatId | 'draw' | null)[], offset = 0): SeatId | null {
  for (const [a, b, c] of LINES) {
    const first = grid[offset + a];
    if (first === null || first === undefined || first === 'draw') continue;
    if (first === grid[offset + b] && first === grid[offset + c]) return first;
  }
  return null;
}

/** Whether every cell of a small board is taken. */
export function boardFull(game: Game, board: number): boolean {
  const base = board * CELLS_PER_BOARD;
  for (let i = 0; i < CELLS_PER_BOARD; i += 1) {
    if (game.cells[base + i] === null) return false;
  }
  return true;
}

/** Recompute one small board's result after a move in it. */
function settleBoard(game: Game, board: number): void {
  if (game.boards[board] !== null) return;
  const won = lineWinner(game.cells, board * CELLS_PER_BOARD);
  if (won !== null) {
    game.boards[board] = won;
    return;
  }
  if (boardFull(game, board)) game.boards[board] = 'draw';
}

/** A small board is playable while it has no result and is not full. */
export function boardPlayable(game: Game, board: number): boolean {
  if (board < 0 || board >= BOARD_COUNT) return false;
  return game.boards[board] === null && !boardFull(game, board);
}

export function isLegalMove(game: Game, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return false;
  if (game.cells[index] !== null) return false;
  const board = boardOf(index);
  if (!boardPlayable(game, board)) return false;
  // -1 means the sent-to board was unplayable, so any playable board will do.
  if (game.sentTo >= 0 && board !== game.sentTo) return false;
  return true;
}

export function legalMoves(out: number[], game: Game): number {
  let count = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (isLegalMove(game, index)) out[count++] = index;
  }
  return count;
}

/**
 * Play a move.
 *
 * Returns false for an illegal one, so a caller cannot mistake a refusal for a move that
 * happened to change nothing visible.
 */
export function applyMove(game: Game, index: number, seat: SeatId): boolean {
  if (!isLegalMove(game, index)) return false;
  game.cells[index] = seat;
  settleBoard(game, boardOf(index));

  // The cell played decides the board the opponent must play in — unless that board is
  // decided or full, in which case they may play anywhere. Without that escape a player
  // could be sent somewhere with no legal move and the game would deadlock.
  const next = cellOf(index);
  game.sentTo = boardPlayable(game, next) ? next : -1;
  return true;
}

/** Who has won the match, 'draw', or null while it is live. */
export function winnerOf(game: Game): SeatId | 'draw' | null {
  const won = lineWinner(game.boards);
  if (won !== null) return won;
  // No line: the match ends when no small board is still playable.
  for (let board = 0; board < BOARD_COUNT; board += 1) {
    if (boardPlayable(game, board)) return null;
  }
  // Decided on count, which is the natural tie-break when no line exists.
  let p1 = 0;
  let p2 = 0;
  for (const result of game.boards) {
    if (result === 'p1') p1 += 1;
    else if (result === 'p2') p2 += 1;
  }
  if (p1 === p2) return 'draw';
  return p1 > p2 ? 'p1' : 'p2';
}

export interface Tally {
  readonly p1: number;
  readonly p2: number;
}

/** Small boards won, which is what the shell's HUD shows. */
export function tallyOf(game: Game): Tally {
  let p1 = 0;
  let p2 = 0;
  for (const result of game.boards) {
    if (result === 'p1') p1 += 1;
    else if (result === 'p2') p2 += 1;
  }
  return { p1, p2 };
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export const BLUNDER_CHANCE: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 0.55,
  normal: 0.2,
  hard: 0,
});

export const SEARCH_DEPTH: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 1,
  normal: 3,
  hard: 5,
});

/** Corners and the centre are worth more, on a small board and on the big one alike. */
const CELL_VALUE: readonly number[] = [3, 2, 3, 2, 4, 2, 3, 2, 3];

/**
 * Score a position from `seat`'s point of view.
 *
 * A won small board is worth far more than the cells inside it, and **sending the
 * opponent to a board where they may play anywhere is a real cost** — that freedom is
 * usually worth more than whatever the move gained.
 */
export function evaluate(game: Game, seat: SeatId): number {
  const other = otherOf(seat);
  let score = 0;

  for (let board = 0; board < BOARD_COUNT; board += 1) {
    const result = game.boards[board];
    const weight = CELL_VALUE[board] ?? 1;
    if (result === seat) score += weight * 25;
    else if (result === other) score -= weight * 25;
    else if (result === null) {
      // Cells inside a live board are worth a little.
      const base = board * CELLS_PER_BOARD;
      for (let i = 0; i < CELLS_PER_BOARD; i += 1) {
        const cell = game.cells[base + i];
        const value = CELL_VALUE[i] ?? 1;
        if (cell === seat) score += value;
        else if (cell === other) score -= value;
      }
    }
  }

  // A free choice for whoever moves next.
  if (game.sentTo < 0) score -= 12;
  return score;
}

/** One game state per ply, reused across the search so no node allocates. */
const searchStates: Game[] = Array.from({ length: 8 }, () => createGame());
const moveBuffers: number[][] = Array.from({ length: 8 }, () =>
  new Array<number>(CELL_COUNT).fill(0),
);

function copyInto(target: Game, source: Game): void {
  for (let i = 0; i < CELL_COUNT; i += 1) target.cells[i] = source.cells[i] ?? null;
  for (let i = 0; i < BOARD_COUNT; i += 1) target.boards[i] = source.boards[i] ?? null;
  target.sentTo = source.sentTo;
}

function search(
  game: Game,
  toMove: SeatId,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  budget: SearchBudget,
): number {
  // Charged on every node, leaves included: leaves are the overwhelming majority of the
  // work, and charging only internal nodes puts the ceiling above the thing it limits.
  if (!budget.spend()) return evaluate(game, toMove);
  const decided = winnerOf(game);
  if (decided !== null) {
    if (decided === 'draw') return 0;
    return decided === toMove ? 10_000 - ply : -(10_000 - ply);
  }
  if (depth === 0) return evaluate(game, toMove);

  const buffer = moveBuffers[ply] ?? [];
  const count = legalMoves(buffer, game);
  if (count === 0) return evaluate(game, toMove);

  const next = searchStates[ply] ?? game;
  let best = -Infinity;
  for (let i = 0; i < count; i += 1) {
    copyInto(next, game);
    applyMove(next, buffer[i] as number, toMove);
    const score = -search(next, otherOf(toMove), depth - 1, ply + 1, -beta, -alpha, budget);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * The move a bot plays, or -1 when it has none.
 *
 * Every tier sees exactly the board a human sees. Difficulty is search depth and blunder
 * rate, never extra information.
 */
export function bestMove(game: Game, seat: SeatId, rng: Rng, difficulty: BotDifficulty): number {
  const buffer = moveBuffers[0] ?? [];
  const count = legalMoves(buffer, game);
  if (count === 0) return -1;

  if (rng.bool(BLUNDER_CHANCE[difficulty])) return buffer[rng.int(0, count)] as number;

  const candidates = buffer.slice(0, count);
  const next = searchStates[0] ?? game;
  const budget = new SearchBudget(DEFAULT_SEARCH_NODES);

  /** One full sweep at a fixed depth, or null when the budget ran out part-way. */
  const sweep = (depth: number): number | null => {
    let best = candidates[0] as number;
    let bestScore = -Infinity;
    for (const move of candidates) {
      copyInto(next, game);
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

  // Iterative deepening under a node budget rather than one sweep at a fixed depth. The
  // single sweep took 27 ms on a development machine — well over a 60 Hz frame, and several
  // frames on a phone. Deepening is what makes running out safe: the best move from the
  // last depth that finished is already in hand.
  const found = deepen(budget, SEARCH_DEPTH[difficulty], sweep);
  return found >= 0 ? found : (candidates[0] as number);
}
