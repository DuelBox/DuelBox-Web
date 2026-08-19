import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Mancala (Kalah), as pure rules.
 *
 * No rendering, no timing, no DOM. The game, the bot and any future balance harness drive
 * this module.
 *
 * Twelve pits and two stores. A turn takes every stone from one of your own pits and sows
 * them one at a time counter-clockwise, dropping one in your own store as you pass it and
 * skipping your opponent's. Two rules give the game its shape: ending in your own store
 * grants **another turn**, and ending in an empty pit on your own side **captures** it
 * along with everything directly opposite.
 */

/** Pits per side. Six is the standard board. */
export const PITS_PER_SIDE = 6;
/** Stones each pit starts with. */
export const STONES_PER_PIT = 4;

/**
 * The board as one ring of fourteen, so sowing is a single modular walk.
 *
 * 0-5 are p1's pits, 6 is p1's store, 7-12 are p2's pits, 13 is p2's store. Laying it out
 * this way is what lets `sow` be a loop with one skip rather than a pile of special cases.
 */
export const P1_STORE = PITS_PER_SIDE;
export const P2_STORE = PITS_PER_SIDE * 2 + 1;
export const SLOT_COUNT = PITS_PER_SIDE * 2 + 2;

export type Board = number[];

export function createBoard(): Board {
  const board: Board = new Array<number>(SLOT_COUNT).fill(0);
  resetBoard(board);
  return board;
}

/** Reset in place, so a rematch allocates nothing. */
export function resetBoard(board: Board): void {
  board.fill(STONES_PER_PIT);
  board[P1_STORE] = 0;
  board[P2_STORE] = 0;
}

export function storeOf(seat: SeatId): number {
  return seat === 'p1' ? P1_STORE : P2_STORE;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** The first pit index belonging to a seat. */
export function firstPitOf(seat: SeatId): number {
  return seat === 'p1' ? 0 : PITS_PER_SIDE + 1;
}

export function ownsPit(seat: SeatId, slot: number): boolean {
  const first = firstPitOf(seat);
  return slot >= first && slot < first + PITS_PER_SIDE;
}

/**
 * The pit directly across the board from `slot`.
 *
 * The two rows face each other, so opposite pairs sum to a constant. Deriving it rather
 * than tabulating it means a board with a different number of pits still works.
 */
export function oppositeOf(slot: number): number {
  return PITS_PER_SIDE * 2 - slot;
}

export function isLegalMove(board: Board, slot: number, seat: SeatId): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) return false;
  if (!ownsPit(seat, slot)) return false;
  return (board[slot] ?? 0) > 0;
}

export function legalMoves(out: number[], board: Board, seat: SeatId): number {
  let count = 0;
  const first = firstPitOf(seat);
  for (let i = 0; i < PITS_PER_SIDE; i += 1) {
    if ((board[first + i] ?? 0) > 0) out[count++] = first + i;
  }
  return count;
}

export function hasLegalMove(board: Board, seat: SeatId): boolean {
  const first = firstPitOf(seat);
  for (let i = 0; i < PITS_PER_SIDE; i += 1) {
    if ((board[first + i] ?? 0) > 0) return true;
  }
  return false;
}

export interface SowResult {
  /** True when the last stone landed in the sower's own store: they go again. */
  readonly extraTurn: boolean;
  /** Stones captured, or 0. */
  readonly captured: number;
  /** Where the last stone landed, for the renderer to animate towards. */
  readonly lastSlot: number;
}

const REFUSED: SowResult = { extraTurn: false, captured: 0, lastSlot: -1 };

/**
 * Sow one pit.
 *
 * Returns `lastSlot: -1` for a refused move, distinct from any legal outcome, so a caller
 * cannot mistake a refusal for a move that happened to end unremarkably.
 */
export function sow(board: Board, slot: number, seat: SeatId): SowResult {
  if (!isLegalMove(board, slot, seat)) return REFUSED;

  let stones = board[slot] ?? 0;
  board[slot] = 0;
  const ownStore = storeOf(seat);
  const theirStore = storeOf(otherOf(seat));

  let at = slot;
  while (stones > 0) {
    at = (at + 1) % SLOT_COUNT;
    // Your opponent's store is skipped entirely — you never add to their score.
    if (at === theirStore) continue;
    board[at] = (board[at] ?? 0) + 1;
    stones -= 1;
  }

  if (at === ownStore) return { extraTurn: true, captured: 0, lastSlot: at };

  // A capture: the last stone lands in a pit of your own that was empty before it
  // arrived — so it holds exactly one now — and the pit opposite is not empty.
  if (ownsPit(seat, at) && board[at] === 1) {
    const opposite = oppositeOf(at);
    const taken = board[opposite] ?? 0;
    if (taken > 0) {
      board[opposite] = 0;
      board[at] = 0;
      board[ownStore] = (board[ownStore] ?? 0) + taken + 1;
      return { extraTurn: false, captured: taken + 1, lastSlot: at };
    }
  }

  return { extraTurn: false, captured: 0, lastSlot: at };
}

/**
 * Whether the game has ended, which is when either side's pits are all empty.
 *
 * Not "all pits empty": one side emptying ends it, and the other side then sweeps its
 * remaining stones into its own store. Missing that sweep is the classic Mancala bug —
 * the game ends with stones stranded on the board and the score is simply wrong.
 */
export function isOver(board: Board): boolean {
  return !hasLegalMove(board, 'p1') || !hasLegalMove(board, 'p2');
}

/**
 * Sweep every remaining stone into its owner's store.
 *
 * Idempotent, so calling it twice is harmless — which matters because the end of a game
 * can be reached from more than one path.
 */
export function sweepRemaining(board: Board): void {
  for (const seat of ['p1', 'p2'] as const) {
    const first = firstPitOf(seat);
    const store = storeOf(seat);
    for (let i = 0; i < PITS_PER_SIDE; i += 1) {
      board[store] = (board[store] ?? 0) + (board[first + i] ?? 0);
      board[first + i] = 0;
    }
  }
}

export interface Tally {
  readonly p1: number;
  readonly p2: number;
}

export function tallyOf(board: Board): Tally {
  return { p1: board[P1_STORE] ?? 0, p2: board[P2_STORE] ?? 0 };
}

/** Total stones on the board. Constant for a whole game — nothing is created or lost. */
export function totalStones(board: Board): number {
  let total = 0;
  for (const count of board) total += count;
  return total;
}

export function winnerOf(board: Board): SeatId | 'draw' | null {
  if (!isOver(board)) return null;
  const { p1, p2 } = tallyOf(board);
  if (p1 === p2) return 'draw';
  return p1 > p2 ? 'p1' : 'p2';
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
  hard: 6,
});

/** Store difference from `seat`'s point of view, which is the only thing that decides it. */
export function evaluate(board: Board, seat: SeatId): number {
  const mine = board[storeOf(seat)] ?? 0;
  const theirs = board[storeOf(otherOf(seat))] ?? 0;
  // Stones still in your own pits are worth something — they are yours to sow, and yours
  // to sweep if the game ends — but far less than a stone banked.
  let mineOnBoard = 0;
  let theirsOnBoard = 0;
  const myFirst = firstPitOf(seat);
  const theirFirst = firstPitOf(otherOf(seat));
  for (let i = 0; i < PITS_PER_SIDE; i += 1) {
    mineOnBoard += board[myFirst + i] ?? 0;
    theirsOnBoard += board[theirFirst + i] ?? 0;
  }
  return (mine - theirs) * 4 + (mineOnBoard - theirsOnBoard);
}

/** One board per ply, reused across the search so no node allocates. */
const searchBoards: Board[] = Array.from({ length: 10 }, () =>
  new Array<number>(SLOT_COUNT).fill(0),
);
const moveBuffers: number[][] = Array.from({ length: 10 }, () =>
  new Array<number>(PITS_PER_SIDE).fill(0),
);

function copyInto(target: Board, source: Board): void {
  for (let i = 0; i < SLOT_COUNT; i += 1) target[i] = source[i] ?? 0;
}

/**
 * Negamax with an alpha-beta window.
 *
 * The extra turn makes this different from most board searches: a move that ends in your
 * own store does **not** hand over, so the search recurses with the *same* seat to move
 * and the sign unflipped. Treating an extra turn as a normal move is the bug that makes a
 * Mancala bot blind to the chains that decide the game.
 */
function search(
  board: Board,
  toMove: SeatId,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
): number {
  if (depth === 0 || isOver(board)) return evaluate(board, toMove);

  const buffer = moveBuffers[ply] ?? [];
  const count = legalMoves(buffer, board, toMove);
  if (count === 0) return evaluate(board, toMove);

  const next = searchBoards[ply] ?? board;
  let best = -Infinity;
  for (let i = 0; i < count; i += 1) {
    copyInto(next, board);
    const result = sow(next, buffer[i] as number, toMove);
    const score = result.extraTurn
      ? // Same seat again: not a sign flip, and not a wasted ply either.
        search(next, toMove, depth - 1, ply + 1, alpha, beta)
      : -search(next, otherOf(toMove), depth - 1, ply + 1, -beta, -alpha);
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
export function bestMove(board: Board, seat: SeatId, rng: Rng, difficulty: BotDifficulty): number {
  const buffer = moveBuffers[0] ?? [];
  const count = legalMoves(buffer, board, seat);
  if (count === 0) return -1;

  if (rng.bool(BLUNDER_CHANCE[difficulty])) return buffer[rng.int(0, count)] as number;

  const depth = SEARCH_DEPTH[difficulty];
  const candidates = buffer.slice(0, count);
  const next = searchBoards[0] ?? board;
  let best = candidates[0] as number;
  let bestScore = -Infinity;

  for (const move of candidates) {
    copyInto(next, board);
    const result = sow(next, move, seat);
    const score = result.extraTurn
      ? search(next, seat, depth - 1, 1, -Infinity, Infinity)
      : -search(next, otherOf(seat), depth - 1, 1, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}
