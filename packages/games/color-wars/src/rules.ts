import type { Rng, SeatId } from '@duelbox/engine';
import { DEFAULT_SEARCH_NODES, SearchBudget, deepen } from '@duelbox/game-sdk';

/**
 * Colour Wars, as pure rules.
 *
 * A grid of cells. On your turn you add a dot to a cell that is empty or already yours.
 * A cell holding as many dots as it has neighbours is **unstable**: it bursts, sending one
 * dot into each neighbour and turning every one of them your colour. Those neighbours may
 * burst in turn, and a single dot placed in the right corner can take half the board.
 *
 * The whole game is in that cascade. Corners burst at two dots, edges at three, the middle
 * at four — so a corner is the cheapest place to build a threat and the middle is the most
 * expensive, which is the opposite of most board games and is what makes this one feel
 * different to play.
 *
 * No rendering, no timing, no DOM.
 */

export const COLUMNS = 6;
export const ROWS = 6;
export const CELL_COUNT = COLUMNS * ROWS;

export interface Cell {
  /** Who owns this cell, or null when it is empty. */
  owner: SeatId | null;
  /** How many dots it holds. Zero exactly when it is unowned. */
  dots: number;
}

export interface Game {
  readonly cells: Cell[];
  toMove: SeatId;
  /**
   * Moves each seat has made.
   *
   * A seat with no cells has only lost if it has *had* a turn — otherwise the game would
   * end the instant the first player places their first dot, with the second player
   * declared beaten before they had touched anything.
   */
  readonly moves: { p1: number; p2: number };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function columnOf(index: number): number {
  return index % COLUMNS;
}

export function rowOf(index: number): number {
  return Math.floor(index / COLUMNS);
}

export function indexOf(column: number, row: number): number {
  return row * COLUMNS + column;
}

/**
 * How many dots a cell holds before it bursts: the number of orthogonal neighbours.
 *
 * Two in a corner, three on an edge, four in the middle. This single fact is the game's
 * entire geometry, so it is computed rather than tabled.
 */
export function capacityOf(index: number): number {
  const column = columnOf(index);
  const row = rowOf(index);
  let count = 0;
  if (column > 0) count += 1;
  if (column < COLUMNS - 1) count += 1;
  if (row > 0) count += 1;
  if (row < ROWS - 1) count += 1;
  return count;
}

/** Writes the orthogonal neighbours of `index` into `out`, returning how many. */
export function neighboursOf(out: number[], index: number): number {
  const column = columnOf(index);
  const row = rowOf(index);
  let count = 0;
  if (column > 0) out[count++] = index - 1;
  if (column < COLUMNS - 1) out[count++] = index + 1;
  if (row > 0) out[count++] = index - COLUMNS;
  if (row < ROWS - 1) out[count++] = index + COLUMNS;
  return count;
}

export function createGame(): Game {
  return {
    cells: Array.from({ length: CELL_COUNT }, () => ({ owner: null, dots: 0 })),
    toMove: 'p1',
    moves: { p1: 0, p2: 0 },
  };
}

export function resetGame(game: Game): void {
  for (const cell of game.cells) {
    cell.owner = null;
    cell.dots = 0;
  }
  game.toMove = 'p1';
  game.moves.p1 = 0;
  game.moves.p2 = 0;
}

/** You may play into a cell that is empty or already yours, and nowhere else. */
export function isLegalMove(game: Readonly<Game>, index: number, seat: SeatId): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return false;
  const cell = game.cells[index];
  if (cell === undefined) return false;
  return cell.owner === null || cell.owner === seat;
}

export function legalMoves(out: number[], game: Readonly<Game>, seat: SeatId): number {
  let count = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (isLegalMove(game, index, seat)) out[count++] = index;
  }
  return count;
}

/**
 * A cascade cannot run forever, but it can run a very long time, so it is bounded.
 *
 * The bound is generous — far beyond anything a real position produces — and exists only
 * so a pathological board cannot hang the simulation. A cascade that reaches it has
 * already decided the game, because the only way to keep bursting is to own everything.
 */
export const MAX_BURSTS = CELL_COUNT * 64;

/** Scratch used by the cascade, so a move allocates nothing. */
const burstQueue: number[] = new Array<number>(CELL_COUNT * 4).fill(0);
const neighbourScratch: number[] = new Array<number>(4).fill(0);

/**
 * Play a dot into `index`.
 *
 * Returns the number of bursts the move set off, or -1 when the move was illegal — so a
 * refusal is never mistaken for a move that simply cascaded nowhere.
 */
export function applyMove(game: Game, index: number, seat: SeatId): number {
  if (!isLegalMove(game, index, seat)) return -1;

  const other = otherOf(seat);
  const first = game.cells[index];
  if (first === undefined) return -1;
  first.owner = seat;
  first.dots += 1;

  let head = 0;
  let tail = 0;
  if (first.dots >= capacityOf(index)) burstQueue[tail++] = index;

  let bursts = 0;
  while (head < tail && bursts < MAX_BURSTS) {
    const at = burstQueue[head++] as number;
    const cell = game.cells[at];
    if (cell === undefined) continue;
    const capacity = capacityOf(at);
    if (cell.dots < capacity) continue;

    // The cell empties completely rather than keeping the remainder: a burst is the cell
    // spending everything it had, and leaving a dot behind would let one cell burst over
    // and over from a single placement.
    cell.dots -= capacity;
    if (cell.dots === 0) cell.owner = null;
    bursts += 1;

    const count = neighboursOf(neighbourScratch, at);
    for (let i = 0; i < count; i += 1) {
      const neighbour = neighbourScratch[i] as number;
      const target = game.cells[neighbour];
      if (target === undefined) continue;
      target.owner = seat;
      target.dots += 1;
      if (target.dots >= capacityOf(neighbour)) {
        if (tail < burstQueue.length) burstQueue[tail++] = neighbour;
      }
    }

    // Once the opponent has been wiped out the cascade has nothing left to decide, and
    // letting it run on is how a won position turns into a very long loop.
    //
    // The condition has to include *that the opponent has had a turn*. Checking only
    // "one seat owns everything" stopped every early cascade dead, because at the start
    // of a game the mover is the only seat on the board at all — a corner burst would
    // fire once and refuse to carry on into the neighbour it had just primed.
    if (game.moves[other] > 0 && countFor(game, other) === 0) break;
    // The queue is a ring in all but name; wrapping keeps a long cascade inside it.
    if (tail >= burstQueue.length) {
      // Re-queue whatever is still unstable and start again from the front.
      tail = 0;
      for (let cellIndex = 0; cellIndex < CELL_COUNT; cellIndex += 1) {
        const candidate = game.cells[cellIndex];
        if (candidate !== undefined && candidate.dots >= capacityOf(cellIndex)) {
          burstQueue[tail++] = cellIndex;
        }
      }
      head = 0;
      if (tail === 0) break;
    }
  }

  if (seat === 'p1') game.moves.p1 += 1;
  else game.moves.p2 += 1;
  game.toMove = otherOf(seat);
  return bursts;
}

/** How many cells a seat holds. */
export function countFor(game: Readonly<Game>, seat: SeatId): number {
  let count = 0;
  for (const cell of game.cells) {
    if (cell.owner === seat) count += 1;
  }
  return count;
}

/** The seat owning every occupied cell, or null when both are still on the board. */
export function ownerOfAll(game: Readonly<Game>): SeatId | null {
  let seen: SeatId | null = null;
  for (const cell of game.cells) {
    if (cell.owner === null) continue;
    if (seen === null) seen = cell.owner;
    else if (seen !== cell.owner) return null;
  }
  return seen;
}

export interface Tally {
  readonly p1: number;
  readonly p2: number;
}

/** Cells held, which is what the shell's HUD shows. */
export function tallyOf(game: Readonly<Game>): Tally {
  let p1 = 0;
  let p2 = 0;
  for (const cell of game.cells) {
    if (cell.owner === 'p1') p1 += 1;
    else if (cell.owner === 'p2') p2 += 1;
  }
  return { p1, p2 };
}

/**
 * Who has won, or null while the game is live.
 *
 * A seat is only out once it has had a turn. Without that the game would end on the very
 * first move, with the second player beaten before touching anything.
 */
export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  if (game.moves.p1 === 0 || game.moves.p2 === 0) return null;
  const { p1, p2 } = tallyOf(game);
  if (p1 === 0 && p2 === 0) return 'draw';
  if (p1 === 0) return 'p2';
  if (p2 === 0) return 'p1';
  return null;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export const BLUNDER_CHANCE: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 0.6,
  normal: 0.2,
  hard: 0,
});

/** How many plies each tier looks ahead. */
export const SEARCH_DEPTH: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 1,
  normal: 2,
  hard: 3,
});

/**
 * Score a position from `seat`'s point of view.
 *
 * Cells and dots both count, but the interesting term is the third: **a cell one dot from
 * bursting next to an enemy cell is a threat**, and a cell that is one dot from bursting
 * *beside* an enemy threat is a liability. That is the whole tactical texture of the game,
 * and a bot that only counts dots plays it like a filling exercise.
 */
export function evaluate(game: Readonly<Game>, seat: SeatId): number {
  let score = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const cell = game.cells[index];
    if (cell === undefined || cell.owner === null) continue;
    const sign = cell.owner === seat ? 1 : -1;
    score += sign * (3 + cell.dots);

    const capacity = capacityOf(index);
    // A corner is the cheapest place to build a threat, so holding one is worth something
    // on its own.
    if (capacity === 2) score += sign * 2;

    if (cell.dots === capacity - 1) {
      // Primed. Worth more next to an enemy cell, and dangerous next to an enemy prime.
      const count = neighboursOf(neighbourScratch, index);
      for (let i = 0; i < count; i += 1) {
        const neighbour = game.cells[neighbourScratch[i] as number];
        if (neighbour === undefined || neighbour.owner === null) continue;
        if (neighbour.owner === cell.owner) continue;
        const enemyCapacity = capacityOf(neighbourScratch[i] as number);
        score += sign * (neighbour.dots === enemyCapacity - 1 ? -3 : 4);
      }
    }
  }
  return score;
}

/** One position per ply, reused so the search allocates nothing. */
const SEARCH_PLIES = 6;
const searchStates: Game[] = Array.from({ length: SEARCH_PLIES }, () => createGame());
const moveBuffers: number[][] = Array.from({ length: SEARCH_PLIES }, () =>
  new Array<number>(CELL_COUNT).fill(0),
);

function copyInto(target: Game, source: Readonly<Game>): void {
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const from = source.cells[i];
    const to = target.cells[i];
    if (from === undefined || to === undefined) continue;
    to.owner = from.owner;
    to.dots = from.dots;
  }
  target.toMove = source.toMove;
  target.moves.p1 = source.moves.p1;
  target.moves.p2 = source.moves.p2;
}

function search(
  game: Game,
  seat: SeatId,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  budget: SearchBudget,
): number {
  // Charged on every node, leaves included: leaves are the overwhelming majority of the
  // work, and charging only internal nodes puts the ceiling above the thing it limits.
  if (!budget.spend()) return evaluate(game, seat);
  const decided = winnerOf(game);
  if (decided !== null) {
    if (decided === 'draw') return 0;
    return decided === seat ? 10_000 - ply : -(10_000 - ply);
  }
  if (depth === 0 || ply >= SEARCH_PLIES - 1) return evaluate(game, seat);

  const buffer = moveBuffers[ply] ?? [];
  const count = legalMoves(buffer, game, game.toMove);
  if (count === 0) return evaluate(game, seat);

  const next = searchStates[ply] ?? game;
  const maximising = game.toMove === seat;
  let best = maximising ? -Infinity : Infinity;
  for (let i = 0; i < count; i += 1) {
    copyInto(next, game);
    applyMove(next, buffer[i] as number, next.toMove);
    const score = search(next, seat, depth - 1, ply + 1, alpha, beta, budget);
    if (maximising) {
      if (score > best) best = score;
      if (best > alpha) alpha = best;
    } else {
      if (score < best) best = score;
      if (best < beta) beta = best;
    }
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
export function bestMove(
  game: Readonly<Game>,
  seat: SeatId,
  rng: Rng,
  difficulty: BotDifficulty,
): number {
  const buffer = moveBuffers[0] ?? [];
  const count = legalMoves(buffer, game, seat);
  if (count === 0) return -1;

  if (rng.bool(BLUNDER_CHANCE[difficulty])) return buffer[rng.int(0, count)] as number;

  const next = searchStates[0] ?? createGame();
  const budget = new SearchBudget(DEFAULT_SEARCH_NODES);

  /** One full sweep at a fixed depth, or null when the budget ran out part-way. */
  const sweep = (depth: number): number | null => {
    let best = buffer[0] as number;
    let bestScore = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const move = buffer[i] as number;
      copyInto(next, game);
      applyMove(next, move, seat);
      const score = search(next, seat, depth - 1, 1, -Infinity, Infinity, budget);
      if (budget.exhausted) return null;
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  };

  // Iterative deepening under a node budget rather than one sweep at a fixed depth.
  const found = deepen(budget, SEARCH_DEPTH[difficulty], sweep);
  return found >= 0 ? found : (buffer[0] as number);
}
