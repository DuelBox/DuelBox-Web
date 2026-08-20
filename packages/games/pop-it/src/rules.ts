import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Pop It, as pure rules.
 *
 * Rows of bubbles. On your turn you press down **any number of bubbles in one row, so long
 * as they are next to each other**. The player who presses the last bubble on the board
 * loses.
 *
 * That last sentence is what makes it interesting. Losing by moving last is *misère* play,
 * and it inverts the endgame: for most of the match you want to take the last bubble of a
 * row, and at the very end you want to leave exactly one for your opponent. A player who
 * has not noticed will win the whole board and lose the game on the final press.
 *
 * Popping from the middle of a row **splits it in two**, and the two halves are then
 * independent — which is why the position is a bag of segment lengths rather than a set of
 * rows, and why the game is much deeper than it looks.
 *
 * No rendering, no timing, no DOM.
 */

/** Bubbles per row, from the top. A rounded sheet rather than a rectangle. */
export const ROW_SIZES: readonly number[] = Object.freeze([3, 4, 5, 4, 3]);
export const ROW_COUNT = ROW_SIZES.length;
export const BUBBLE_COUNT = ROW_SIZES.reduce((total, size) => total + size, 0);
export const WIDEST_ROW = Math.max(...ROW_SIZES);

/** Index of the first bubble of a row in the flat array. */
export function rowStart(row: number): number {
  let start = 0;
  for (let i = 0; i < row; i += 1) start += ROW_SIZES[i] ?? 0;
  return start;
}

export function sizeOf(row: number): number {
  return ROW_SIZES[row] ?? 0;
}

export interface Game {
  /** True where a bubble has been pressed. Flat, row by row. */
  readonly popped: boolean[];
  toMove: SeatId;
  /** Bubbles each seat has pressed, which is what the HUD shows. */
  readonly pressed: { p1: number; p2: number };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function createGame(): Game {
  return {
    popped: new Array<boolean>(BUBBLE_COUNT).fill(false),
    toMove: 'p1',
    pressed: { p1: 0, p2: 0 },
  };
}

export function resetGame(game: Game): void {
  game.popped.fill(false);
  game.toMove = 'p1';
  game.pressed.p1 = 0;
  game.pressed.p2 = 0;
}

/** Whether every bubble from `from` to `to` inclusive, in `row`, is still up. */
export function isLegalMove(game: Readonly<Game>, row: number, from: number, to: number): boolean {
  if (!Number.isInteger(row) || row < 0 || row >= ROW_COUNT) return false;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  const size = sizeOf(row);
  if (from < 0 || to >= size || from > to) return false;
  const start = rowStart(row);
  for (let i = from; i <= to; i += 1) {
    if (game.popped[start + i] === true) return false;
  }
  return true;
}

/**
 * Press a run of bubbles.
 *
 * Returns how many went down, or -1 for an illegal move — so a refusal is never mistaken
 * for a press that happened to change nothing.
 */
export function applyMove(game: Game, row: number, from: number, to: number): number {
  if (!isLegalMove(game, row, from, to)) return -1;
  const start = rowStart(row);
  let count = 0;
  for (let i = from; i <= to; i += 1) {
    game.popped[start + i] = true;
    count += 1;
  }
  if (game.toMove === 'p1') game.pressed.p1 += count;
  else game.pressed.p2 += count;
  game.toMove = otherOf(game.toMove);
  return count;
}

export function bubblesLeft(game: Readonly<Game>): number {
  let left = 0;
  for (const popped of game.popped) {
    if (!popped) left += 1;
  }
  return left;
}

/**
 * Who has won, or null while bubbles remain.
 *
 * **The player who presses the last bubble loses**, so the winner is whoever is now to
 * move — they are the one who did *not* just press.
 */
export function winnerOf(game: Readonly<Game>): SeatId | null {
  if (bubblesLeft(game) > 0) return null;
  return game.toMove;
}

/**
 * The position as a bag of unbroken runs.
 *
 * Two positions with the same runs are the same game however they were reached, which is
 * what makes an exact solver possible at all — and it is why a run in the middle of a row
 * splitting into two matters so much.
 */
export function segmentsOf(game: Readonly<Game>, out: number[]): number {
  let count = 0;
  for (let row = 0; row < ROW_COUNT; row += 1) {
    const start = rowStart(row);
    const size = sizeOf(row);
    let run = 0;
    for (let i = 0; i < size; i += 1) {
      if (game.popped[start + i] === true) {
        if (run > 0) out[count++] = run;
        run = 0;
      } else {
        run += 1;
      }
    }
    if (run > 0) out[count++] = run;
  }
  return count;
}

export interface Move {
  readonly row: number;
  readonly from: number;
  readonly to: number;
}

/** Every legal move, written into `out`. */
export function legalMoves(out: Move[], game: Readonly<Game>): number {
  let count = 0;
  for (let row = 0; row < ROW_COUNT; row += 1) {
    const start = rowStart(row);
    const size = sizeOf(row);
    for (let from = 0; from < size; from += 1) {
      if (game.popped[start + from] === true) continue;
      for (let to = from; to < size; to += 1) {
        if (game.popped[start + to] === true) break;
        out[count++] = { row, from, to };
      }
    }
  }
  return count;
}

const segmentScratch: number[] = new Array<number>(BUBBLE_COUNT).fill(0);

/**
 * Whether the player to move **wins with perfect play**, from a bag of runs.
 *
 * Solved exactly rather than approximated. The state space is small once positions are
 * reduced to sorted runs, and the answer is then a fact about the game rather than an
 * opinion about it — which is what lets the hard tier be genuinely unbeatable and lets a
 * test say so.
 *
 * Misère, so the base case is inverted: **with nothing left, the player to move has
 * already won**, because their opponent pressed the last bubble.
 */
const solved = new Map<string, boolean>();

export function winsFromSegments(segments: readonly number[]): boolean {
  if (segments.length === 0) return true;
  const key = segments
    .slice()
    .sort((a, b) => a - b)
    .join(',');
  const known = solved.get(key);
  if (known !== undefined) return known;

  // Guard against the recursion re-entering the same position through a cycle. It cannot
  // — every move removes at least one bubble — but a wrong answer cached here would be
  // very hard to find, so the key is only written once the answer is real.
  let wins = false;
  const rest = segments.slice().sort((a, b) => a - b);
  // `break outer` is what ends the search, so the loop needs no second exit condition.
  outer: for (let index = 0; index < rest.length; index += 1) {
    const length = rest[index] as number;
    for (let from = 0; from < length; from += 1) {
      for (let to = from; to < length; to += 1) {
        const next: number[] = [];
        for (let i = 0; i < rest.length; i += 1) {
          if (i !== index) next.push(rest[i] as number);
        }
        // The left remainder of a split.
        //
        // Curiously, dropping it changes no verdict at all for any position up to three
        // runs of seven — I checked, while trying to work out why a mutation of this line
        // failed no test. Every split successor turns out to be worth the same as the
        // right-hand part alone. It is kept because it is what the game actually does,
        // and because that coincidence is a property of these sizes rather than a rule.
        if (from > 0) next.push(from);
        const tail = length - to - 1;
        if (tail > 0) next.push(tail);
        if (!winsFromSegments(next)) {
          wins = true;
          break outer;
        }
      }
    }
  }
  solved.set(key, wins);
  return wins;
}

/** Whether the seat to move wins this position with perfect play. */
export function winsFromHere(game: Readonly<Game>): boolean {
  const count = segmentsOf(game, segmentScratch);
  return winsFromSegments(segmentScratch.slice(0, count));
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export const BLUNDER_CHANCE: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 0.7,
  normal: 0.25,
  hard: 0,
});

const moveScratch: Move[] = new Array<Move>(BUBBLE_COUNT * WIDEST_ROW);
const afterScratch: number[] = new Array<number>(BUBBLE_COUNT).fill(0);
/** One reused board, so trying a move costs no allocation. */
const trialGame: Game = createGame();

/** The runs left after playing `move` in `game`, written into `afterScratch`. */
function segmentsAfter(game: Readonly<Game>, move: Move): number[] {
  for (let i = 0; i < BUBBLE_COUNT; i += 1) trialGame.popped[i] = game.popped[i] ?? false;
  const start = rowStart(move.row);
  for (let i = move.from; i <= move.to; i += 1) trialGame.popped[start + i] = true;
  const count = segmentsOf(trialGame, afterScratch);
  return afterScratch.slice(0, count);
}

/**
 * The move a bot plays, or null when the board is empty.
 *
 * `hard` plays perfectly: it looks for a move leaving the opponent in a losing position
 * and takes it. When no such move exists it is already beaten, and plays the smallest
 * press — which keeps the game going and gives a human room to err.
 *
 * Every tier sees exactly the board a human sees. Difficulty is the blunder rate alone,
 * because there is nothing to hide: the whole position is in front of both players, so
 * search depth is not an honest dial here the way it is on a hidden-depth board.
 */
export function bestMove(game: Readonly<Game>, rng: Rng, difficulty: BotDifficulty): Move | null {
  const count = legalMoves(moveScratch, game);
  if (count === 0) return null;
  if (rng.bool(BLUNDER_CHANCE[difficulty])) return moveScratch[rng.int(0, count)] ?? null;

  let fallback: Move | null = moveScratch[0] ?? null;
  let fallbackSize = fallback === null ? Infinity : fallback.to - fallback.from;
  for (let i = 0; i < count; i += 1) {
    const move = moveScratch[i];
    if (move === undefined) continue;
    if (!winsFromSegments(segmentsAfter(game, move))) return move;
    const size = move.to - move.from;
    if (size < fallbackSize) {
      fallback = move;
      fallbackSize = size;
    }
  }
  return fallback;
}
