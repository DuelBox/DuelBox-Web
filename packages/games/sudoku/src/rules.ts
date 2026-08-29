import type { Rng, SeatId } from '@duelbox/engine';
import { DEFAULT_SEARCH_NODES, SearchBudget, resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Sudoku, as a duel — pure rules.
 *
 * No rendering, no timing, no DOM. The game, the bot and the balance harness all drive
 * this module, so what a harness measures is what a player feels.
 *
 * Sudoku is a solitaire, and the two obvious ways to seat a second person at one fail in
 * opposite directions: two people filling the same grid cooperatively is not a duel, and
 * two people filling separate grids is two solitaires with a shared timer. What makes this
 * one two-player is that **every square is owned by whoever answered it**, and a wrong
 * answer does not merely fail — the correct digit goes in anyway and the square belongs to
 * the other seat. The grid is a board being divided rather than a puzzle being finished.
 *
 * Four rules do the whole job:
 *
 * 1. **You answer one empty square a turn, and it is always answered.** Right, and it is
 *    yours; wrong, and it is theirs. The grid never holds a false digit, so every deduction
 *    anybody makes from it stays sound — and the number of squares left falls by exactly
 *    one every turn whatever happens, which is where termination comes from. It is
 *    arithmetic, not a hope.
 * 2. **A digit already in the square's row, column or box is refused**, not counted wrong.
 *    An accepted answer is always a genuine candidate, so a square with one candidate left
 *    cannot be got wrong by anybody.
 * 3. **Your answer sends the other seat to its row and column.** They must answer inside
 *    that cross. This is what makes the game interactive rather than parallel: you choose
 *    not only what you take but what they are left facing. If the cross has nothing empty
 *    in it they may answer anywhere.
 * 4. **You score lines, not squares.** Each of the twenty-seven units — nine rows, nine
 *    columns, nine boxes — goes to whoever owns more of its answered squares, and a level
 *    unit goes to whoever owns its **head**, the first square in it that was not a given.
 *    Most units wins.
 *
 * Rule 4 is the one that took the most measuring, and {@link unitLeader} records why:
 * counting squares cannot decide a match between two players who do not make mistakes, and
 * counting units cannot either until a level unit has somewhere to go.
 */

/** The grid is nine by nine, in three-by-three boxes. Nothing here is in pixels. */
export const SIZE = 9;
export const BOX = 3;
export const CELL_COUNT = SIZE * SIZE;
/** Nine rows, nine columns, nine boxes: the units the match is scored over. */
export const UNIT_COUNT = 27;

/** Every digit as a bit, so a candidate set is one integer. */
const ALL_DIGITS = 0b1_1111_1111;

/**
 * How many squares the puzzle leaves empty, and therefore how many turns a match runs.
 *
 * Even on purpose: both seats must answer the same number of squares, or the opener wins
 * matches by arithmetic. 54 is 27 answers each, and about 80 seconds of play.
 */
export const TARGET_BLANKS = 54;

/** What a square is, once it has a digit in it. */
export const EMPTY = 0;
export const GIVEN = 1;
export const CLAIMED_P1 = 2;
export const CLAIMED_P2 = 3;

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function rowOf(index: number): number {
  return (index / SIZE) | 0;
}

export function columnOf(index: number): number {
  return index % SIZE;
}

export function boxOf(index: number): number {
  return ((rowOf(index) / BOX) | 0) * BOX + ((columnOf(index) / BOX) | 0);
}

export function indexOf(column: number, row: number): number {
  return row * SIZE + column;
}

/** The three units a square belongs to: its row, then its column, then its box. */
export function rowUnit(index: number): number {
  return rowOf(index);
}

export function columnUnit(index: number): number {
  return SIZE + columnOf(index);
}

export function boxUnit(index: number): number {
  return SIZE * 2 + boxOf(index);
}

function bitOf(digit: number): number {
  return 1 << (digit - 1);
}

/** Population count of a nine-bit candidate set. */
function popcount(mask: number): number {
  let m = mask - ((mask >> 1) & 0x5555_5555);
  m = (m & 0x3333_3333) + ((m >> 2) & 0x3333_3333);
  return (((m + (m >> 4)) & 0x0f0f_0f0f) * 0x0101_0101) >> 24;
}

/** The lowest digit in a candidate set, or 0 for the empty set. */
function firstDigit(mask: number): number {
  return 32 - Math.clz32(mask & -mask);
}

/**
 * The nine squares of every unit, flattened.
 *
 * Built once at module load rather than computed per lookup: the bot walks all twenty-seven
 * units several times a turn, and the arithmetic for a box index is the fiddliest in the
 * file.
 */
const UNIT_CELLS: readonly number[] = (() => {
  const cells: number[] = new Array<number>(UNIT_COUNT * SIZE).fill(0);
  for (let k = 0; k < SIZE; k += 1) {
    for (let unit = 0; unit < SIZE; unit += 1) {
      cells[unit * SIZE + k] = indexOf(k, unit);
      cells[(SIZE + unit) * SIZE + k] = indexOf(unit, k);
      const row = ((unit / BOX) | 0) * BOX + ((k / BOX) | 0);
      const column = (unit % BOX) * BOX + (k % BOX);
      cells[(SIZE * 2 + unit) * SIZE + k] = indexOf(column, row);
    }
  }
  return cells;
})();

/** The `k`th square of a unit, in reading order. */
export function unitCell(unit: number, k: number): number {
  return UNIT_CELLS[unit * SIZE + k] as number;
}

/* ------------------------------------------------------------------------------------ *
 * Candidate arithmetic
 *
 * One set of used-digit masks, shared by everything in this file that needs to know what a
 * square may hold. Module-level so that nothing on a per-step path allocates; the cost is
 * that a caller must not hold a mask across a call that reloads them, which is why every
 * routine below either reloads first or copies what it needs out.
 * ------------------------------------------------------------------------------------ */

const rowUsed = new Int32Array(SIZE);
const colUsed = new Int32Array(SIZE);
const boxUsed = new Int32Array(SIZE);

/** Add a digit's bit to the three units a square belongs to. */
function markUsed(index: number, bit: number): void {
  const row = rowOf(index);
  const column = columnOf(index);
  const box = boxOf(index);
  rowUsed[row] = (rowUsed[row] as number) | bit;
  colUsed[column] = (colUsed[column] as number) | bit;
  boxUsed[box] = (boxUsed[box] as number) | bit;
}

/** Take it away again. */
function unmarkUsed(index: number, bit: number): void {
  const row = rowOf(index);
  const column = columnOf(index);
  const box = boxOf(index);
  rowUsed[row] = (rowUsed[row] as number) & ~bit;
  colUsed[column] = (colUsed[column] as number) & ~bit;
  boxUsed[box] = (boxUsed[box] as number) & ~bit;
}

function loadUsed(cells: readonly number[]): void {
  rowUsed.fill(0);
  colUsed.fill(0);
  boxUsed.fill(0);
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const digit = cells[index] as number;
    if (digit === 0) continue;
    markUsed(index, bitOf(digit));
  }
}

/** Which digits a square may still hold, given the masks currently loaded. */
function freeAt(index: number): number {
  const used =
    (rowUsed[rowOf(index)] as number) |
    (colUsed[columnOf(index)] as number) |
    (boxUsed[boxOf(index)] as number);
  return ALL_DIGITS & ~used;
}

/**
 * Which digits a square may hold, as a bit set. Zero for a square that is already filled.
 *
 * Deliberately something a player is shown: it is a fact about digits already on the grid,
 * not a fact about the answer, and reading it off by eye is bookkeeping rather than skill —
 * the same argument Reversi makes for drawing a dot on every legal square. What is left
 * unsaid, and is the actual game, is *which* of the squares available to you is the one to
 * take, and what taking it leaves the other seat.
 */
export function candidateMask(cells: readonly number[], index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return 0;
  if ((cells[index] as number) !== 0) return 0;
  loadUsed(cells);
  return freeAt(index);
}

export function candidateCount(cells: readonly number[], index: number): number {
  return popcount(candidateMask(cells, index));
}

/** Whether a digit may be entered here at all. A conflicting digit is not a wrong answer. */
export function isLegalDigit(cells: readonly number[], index: number, digit: number): boolean {
  if (!Number.isInteger(digit) || digit < 1 || digit > SIZE) return false;
  return (candidateMask(cells, index) & bitOf(digit)) !== 0;
}

/* ------------------------------------------------------------------------------------ *
 * The solver, used only to build a puzzle
 * ------------------------------------------------------------------------------------ */

const solveGrid: number[] = new Array<number>(CELL_COUNT).fill(0);
/** Digit orders for the generator, one nine-slot run per recursion depth. */
const digitOrder: number[] = new Array<number>(CELL_COUNT * SIZE).fill(0);

function place(index: number, digit: number): void {
  solveGrid[index] = digit;
  markUsed(index, bitOf(digit));
}

function unplace(index: number, digit: number): void {
  solveGrid[index] = 0;
  unmarkUsed(index, bitOf(digit));
}

/**
 * How many solutions the loaded grid has, counted up to `limit`.
 *
 * Most-constrained square first, which is what makes this fast enough to run eighty-one
 * times inside one `init`: a square with a single candidate is taken without branching, and
 * a square with none fails the whole subtree at once.
 */
function search(limit: number): number {
  let best = -1;
  let bestMask = 0;
  let bestCount = SIZE + 1;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if ((solveGrid[index] as number) !== 0) continue;
    const mask = freeAt(index);
    const count = popcount(mask);
    if (count === 0) return 0;
    if (count < bestCount) {
      best = index;
      bestMask = mask;
      bestCount = count;
      if (count === 1) break;
    }
  }
  if (best < 0) return 1;

  let found = 0;
  let mask = bestMask;
  while (mask !== 0) {
    const digit = firstDigit(mask);
    mask &= mask - 1;
    place(best, digit);
    found += search(limit - found);
    unplace(best, digit);
    if (found >= limit) break;
  }
  return found;
}

/**
 * How many ways this grid can be completed, counted up to `limit` and no further.
 *
 * Capped because the only question ever asked of it is "exactly one?", and a grid with a
 * hole in it has astronomically many completions.
 *
 * It assumes the digits already standing are consistent with each other, which everything
 * in this package guarantees: a given comes from a solved grid and an answer is refused
 * unless it is a genuine candidate. A grid holding two of the same digit in one unit is
 * reported by the count only when that duplication starves some empty square.
 */
export function countSolutions(cells: readonly number[], limit = 2): number {
  for (let index = 0; index < CELL_COUNT; index += 1) solveGrid[index] = cells[index] as number;
  loadUsed(solveGrid);
  return search(limit);
}

/** Fill the loaded grid completely, trying digits in a seeded order. */
function fill(rng: Rng, depth: number): boolean {
  let best = -1;
  let bestMask = 0;
  let bestCount = SIZE + 1;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if ((solveGrid[index] as number) !== 0) continue;
    const mask = freeAt(index);
    const count = popcount(mask);
    if (count === 0) return false;
    if (count < bestCount) {
      best = index;
      bestMask = mask;
      bestCount = count;
      if (count === 1) break;
    }
  }
  if (best < 0) return true;

  const base = depth * SIZE;
  let count = 0;
  let mask = bestMask;
  while (mask !== 0) {
    digitOrder[base + count] = firstDigit(mask);
    count += 1;
    mask &= mask - 1;
  }
  for (let i = count - 1; i > 0; i -= 1) {
    const j = rng.int(0, i + 1);
    const held = digitOrder[base + i] as number;
    digitOrder[base + i] = digitOrder[base + j] as number;
    digitOrder[base + j] = held;
  }

  for (let i = 0; i < count; i += 1) {
    const digit = digitOrder[base + i] as number;
    place(best, digit);
    if (fill(rng, depth + 1)) return true;
    unplace(best, digit);
  }
  return false;
}

/** A complete, valid grid drawn from the seeded generator. */
export function solvedGrid(rng: Rng, out: number[]): void {
  for (let index = 0; index < CELL_COUNT; index += 1) solveGrid[index] = 0;
  loadUsed(solveGrid);
  fill(rng, 0);
  for (let index = 0; index < CELL_COUNT; index += 1) out[index] = solveGrid[index] as number;
}

/** Removal order for the digger, shuffled per puzzle. */
const digOrder: number[] = Array.from({ length: CELL_COUNT }, (_unused, index) => index);

export interface Puzzle {
  /** The grid as the players first see it: a digit for a given, 0 for a square to answer. */
  readonly givens: number[];
  readonly solution: number[];
  readonly blanks: number;
}

/**
 * A puzzle with exactly one solution, from a seed and nothing else.
 *
 * Uniqueness is not decoration. The whole scoring rule is "does this digit match the
 * answer", so with two answers a player could deduce a digit soundly and still be told they
 * were wrong. Every removal is therefore kept only if the grid still has exactly one
 * completion, which is checked rather than assumed — and checked cheaply enough (about
 * 0.2 ms for a whole puzzle, measured) to run inside `init`.
 *
 * The blank count is forced to the target's parity. A digger that cannot reach the target
 * stops where it can, and one given goes back if that left the wrong parity, so both seats
 * always answer the same number of squares.
 */
export function generatePuzzle(rng: Rng, targetBlanks: number = TARGET_BLANKS): Puzzle {
  const solution = new Array<number>(CELL_COUNT).fill(0);
  solvedGrid(rng, solution);

  const givens = solution.slice();
  for (let index = 0; index < CELL_COUNT; index += 1) digOrder[index] = index;
  rng.shuffle(digOrder);

  let blanks = 0;
  let lastRemoved = -1;
  for (const index of digOrder) {
    if (blanks >= targetBlanks) break;
    const held = givens[index] as number;
    givens[index] = 0;
    if (countSolutions(givens, 2) === 1) {
      blanks += 1;
      lastRemoved = index;
    } else {
      givens[index] = held;
    }
  }

  if (blanks % 2 !== targetBlanks % 2 && lastRemoved >= 0) {
    givens[lastRemoved] = solution[lastRemoved] as number;
    blanks -= 1;
  }

  return { givens, solution, blanks };
}

/* ------------------------------------------------------------------------------------ *
 * The match
 * ------------------------------------------------------------------------------------ */

export interface MatchState {
  /** 0 for a square still to answer, otherwise the digit standing in it. */
  readonly cells: number[];
  /** EMPTY, GIVEN, CLAIMED_P1 or CLAIMED_P2 — who owns each square. */
  readonly owner: number[];
  /** The answer. Never handed to a bot; see {@link chooseMove}. */
  readonly solution: number[];
  /**
   * Each unit's head square: the first square in it, in reading order, that was not a
   * given. Fixed for the whole match, so a player can see from the first turn which squares
   * decide a level line. -1 for a unit with no square to answer at all.
   */
  readonly head: number[];
  active: SeatId;
  /** The square whose row and column the mover is confined to. */
  anchor: number;
  /** True when the mover may answer anywhere, because the cross has nothing empty in it. */
  wideOpen: boolean;
  blanks: number;
  /** Units led — the score. */
  p1: number;
  p2: number;
  /** Squares taken. Reported for the players; it cannot decide a match on its own. */
  squaresP1: number;
  squaresP2: number;
  /** The last answer, kept for the reveal. `lastDigit` is 0 when the turn was let go. */
  lastCell: number;
  lastDigit: number;
  lastCorrect: boolean;
}

/**
 * A fresh match from a seed.
 *
 * The opening anchor is drawn from the generator rather than left open, so **the first turn
 * has the same shape as every other one**. Leaving it open gave the opener the only turn in
 * the match with the whole grid to choose from, and that is worth a different amount to a
 * careless player than to a careful one — measured over 400 matches, both seat orders, at
 * 54 blanks:
 *
 * | opener's share of decided | free first turn | seeded anchor |
 * |---|---|---|
 * | easy v easy | 44.8% | **46.4%** |
 * | normal v normal | 46.4% | **49.2%** |
 * | hard v hard | 52.0% | **52.4%** |
 *
 * Seeding it pulls the weakest pairing towards the middle without touching the strongest,
 * which is what you want from a fix: the asymmetry it removed was one that only mattered to
 * the player least able to use it.
 */
export function createMatch(
  rng: Rng,
  openingSeat: SeatId = 'p1',
  targetBlanks: number = TARGET_BLANKS,
): MatchState {
  const { givens, solution, blanks } = generatePuzzle(rng, targetBlanks);
  const owner = new Array<number>(CELL_COUNT).fill(EMPTY);
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if ((givens[index] as number) !== 0) owner[index] = GIVEN;
  }

  const head = new Array<number>(UNIT_COUNT).fill(-1);
  for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
    for (let k = 0; k < SIZE; k += 1) {
      const cell = unitCell(unit, k);
      if ((owner[cell] as number) === EMPTY) {
        head[unit] = cell;
        break;
      }
    }
  }

  const state: MatchState = {
    cells: givens,
    owner,
    solution,
    head,
    active: openingSeat,
    anchor: rng.int(0, CELL_COUNT),
    wideOpen: true,
    blanks,
    p1: 0,
    p2: 0,
    squaresP1: 0,
    squaresP2: 0,
    lastCell: -1,
    lastDigit: 0,
    lastCorrect: false,
  };
  state.wideOpen = !crossHasEmpty(state.cells, state.anchor);
  return state;
}

/** Whether the cross through the anchor still holds a square to answer. */
export function crossHasEmpty(cells: readonly number[], anchor: number): boolean {
  if (anchor < 0) return false;
  const row = rowOf(anchor);
  const column = columnOf(anchor);
  for (let k = 0; k < SIZE; k += 1) {
    if ((cells[indexOf(k, row)] as number) === 0) return true;
    if ((cells[indexOf(column, k)] as number) === 0) return true;
  }
  return false;
}

/** Whether a square lies in the cross through the anchor. */
export function inCross(index: number, anchor: number): boolean {
  return rowOf(index) === rowOf(anchor) || columnOf(index) === columnOf(anchor);
}

/** Whether the mover may answer this square this turn. */
export function isAllowed(state: MatchState, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return false;
  if ((state.cells[index] as number) !== 0) return false;
  if (state.wideOpen) return true;
  return inCross(index, state.anchor);
}

/**
 * Every square the mover may answer, written into a caller-supplied array.
 *
 * Written in rather than returned, because this runs on the simulation path and a fresh
 * array there would allocate every turn.
 */
export function allowedCells(out: number[], state: MatchState): number {
  let count = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (isAllowed(state, index)) out[count++] = index;
  }
  return count;
}

export type EntryResult = 'refused' | 'claimed' | 'conceded';

/**
 * Fill a square and hand it to somebody.
 *
 * The correct digit always goes in, whoever gets the square, so the grid stays a sound
 * sudoku for the rest of the match.
 */
function settle(state: MatchState, index: number, digit: number, correct: boolean): EntryResult {
  const mover = state.active;
  const taker = correct ? mover : otherOf(mover);
  state.cells[index] = state.solution[index] as number;
  state.owner[index] = taker === 'p1' ? CLAIMED_P1 : CLAIMED_P2;
  if (taker === 'p1') state.squaresP1 += 1;
  else state.squaresP2 += 1;
  state.p1 = unitsLedBy(state, 'p1');
  state.p2 = unitsLedBy(state, 'p2');
  state.blanks -= 1;
  state.anchor = index;
  state.wideOpen = !crossHasEmpty(state.cells, index);
  state.lastCell = index;
  state.lastDigit = digit;
  state.lastCorrect = correct;
  state.active = otherOf(mover);
  return correct ? 'claimed' : 'conceded';
}

/**
 * Answer a square.
 *
 * `refused` means nothing happened at all — the square is filled, or outside the cross, or
 * the digit already appears in the square's row, column or box. A refusal costs no turn,
 * exactly as an illegal square costs no turn in Reversi.
 */
export function applyEntry(state: MatchState, index: number, digit: number): EntryResult {
  if (state.blanks === 0) return 'refused';
  if (!isAllowed(state, index)) return 'refused';
  if (!Number.isInteger(digit) || digit < 1 || digit > SIZE) return 'refused';
  loadUsed(state.cells);
  if ((freeAt(index) & bitOf(digit)) === 0) return 'refused';
  return settle(state, index, digit, digit === state.solution[index]);
}

/**
 * Let the turn go without answering.
 *
 * The square is revealed and goes to the other seat, exactly as a wrong answer does.
 * Anything softer would break the arithmetic the match terminates on: a turn that fills no
 * square is a turn two idle players could take for ever.
 */
export function applyForfeit(state: MatchState, index: number): EntryResult {
  if (state.blanks === 0) return 'refused';
  if (!isAllowed(state, index)) return 'refused';
  return settle(state, index, 0, false);
}

export interface Move {
  cell: number;
  digit: number;
}

export function createMove(): Move {
  return { cell: -1, digit: 0 };
}

/**
 * Some answer certain to be accepted, for a forfeit or a bot with no opinion.
 *
 * One always exists while a square is left, because the grid never holds a false digit and
 * therefore every empty square still has at least one candidate.
 */
export function forcedMove(out: Move, state: MatchState): boolean {
  if (state.blanks === 0) return false;
  loadUsed(state.cells);
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (!isAllowed(state, index)) continue;
    const mask = freeAt(index);
    if (mask === 0) continue;
    out.cell = index;
    out.digit = firstDigit(mask);
    return true;
  }
  return false;
}

export function isOver(state: MatchState): boolean {
  return state.blanks === 0;
}

/**
 * Who holds a unit: whoever owns more of its answered squares, and if they are level,
 * whoever owns its head.
 *
 * The level rule is not a tiebreak bolted on afterwards, it is what makes the match
 * decidable, and getting there took three attempts.
 *
 * **Squares cannot decide it.** Each seat answers exactly half of them, so with `k1` and
 * `k2` right answers the totals are `k1 + (T - k2)` and `k2 + (T - k1)`, and the difference
 * is exactly `2(k1 - k2)`. Level on squares therefore *means* level on right answers, and
 * every tiebreak phrased in terms of accuracy is arithmetically incapable of separating
 * anybody. Two `hard` bots, which answer everything correctly, finish 27–27 every time.
 *
 * **Per-unit margins cannot decide it either**, for the same reason one step along: the
 * margins over all twenty-seven units add up to three times the square difference, so when
 * squares are level the two seats' margin totals are equal too. Only a *sign* escapes that,
 * which is why the score is units led rather than anything additive.
 *
 * **A level unit still had to go somewhere.** Left to nobody, two `hard` bots drew 27% of
 * their matches. Three ways of resolving it, 500 matches a tier, both seat orders:
 *
 * | | `easy` opener | `normal` opener | `hard` opener | draws at `hard` |
 * |---|---|---|---|---|
 * | level unit goes to nobody | 45.1% | 47.2% | 58.8% | **27.2%** |
 * | to whoever answered its **last** square | 43.6% | 44.8% | **41.6%** | 0% |
 * | to whoever owns its **head** (shipped) | **44.8%** | **46.4%** | **52.0%** | 0% |
 *
 * The last-square rule ends every match too, and hands the seat that moves last a tempo
 * advantage worth eight points: the final answers of a match close several units at once
 * and pay nothing for where they send the opponent. The head is a fixed square, known from
 * the first turn, so it carries no tempo at all — and twenty-seven is odd, so with every
 * unit belonging to somebody a finished match cannot be level.
 */
export function unitLeader(state: MatchState, unit: number): SeatId | null {
  let p1 = 0;
  let p2 = 0;
  for (let k = 0; k < SIZE; k += 1) {
    const owner = state.owner[unitCell(unit, k)] as number;
    if (owner === CLAIMED_P1) p1 += 1;
    else if (owner === CLAIMED_P2) p2 += 1;
  }
  if (p1 !== p2) return p1 > p2 ? 'p1' : 'p2';
  const head = state.head[unit] as number;
  if (head < 0) return null;
  const owner = state.owner[head] as number;
  if (owner === CLAIMED_P1) return 'p1';
  if (owner === CLAIMED_P2) return 'p2';
  return null;
}

export function unitsLedBy(state: MatchState, seat: SeatId): number {
  let count = 0;
  for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
    if (unitLeader(state, unit) === seat) count += 1;
  }
  return count;
}

/** Whether a square is the head of any of the three units it belongs to. */
export function isHead(state: MatchState, index: number): boolean {
  return (
    (state.head[rowUnit(index)] as number) === index ||
    (state.head[columnUnit(index)] as number) === index ||
    (state.head[boxUnit(index)] as number) === index
  );
}

const MATCH_END: WinCondition = { kind: 'highest-when-time-expires' };

/**
 * Most units wins.
 *
 * Squares remain as a tiebreak for the pathological grid where some unit has no square to
 * answer at all and the twenty-seven cannot be shared out oddly. It has never fired in
 * measurement; it is there so that "the match cannot end in an undefined state" is true by
 * construction rather than by luck.
 */
export function winnerOf(state: MatchState): SeatId | 'draw' | null {
  if (!isOver(state)) return null;
  const outcome = resolve(MATCH_END, { p1: state.p1, p2: state.p2 }, { timeExpired: true });
  if (outcome !== 'draw') return outcome;
  if (state.squaresP1 === state.squaresP2) return 'draw';
  return state.squaresP1 > state.squaresP2 ? 'p1' : 'p2';
}

/* ------------------------------------------------------------------------------------ *
 * The bot
 * ------------------------------------------------------------------------------------ */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Whether it spots a digit that has only one home left in a row, column or box. */
  readonly hiddenSingles: boolean;
  /** Whether it disproves a candidate by pushing it until the grid contradicts itself. */
  readonly contradiction: boolean;
  /** How often it answers a square it had already judged was not the best one. */
  readonly slip: number;
}

/**
 * Three tiers on two honest axes: how deep the deduction goes, and how often it settles for
 * a square it knows is not the best one. Neither is information, speed or physics a person
 * could not have. Every tier plays for the same thing — units — so the ladder is skill at
 * reading the grid, not a different game per tier.
 *
 * A third axis was written, measured and deleted. `examine` capped how many of the squares
 * a tier looked at — three, for `easy` — which reads like a hurried player and is not: the
 * mover faces the whole grid whenever the cross runs dry and eight or nine squares
 * otherwise, so a fixed sample of three is a far worse sample in the wide positions than in
 * the narrow ones, and the two seats do not get equal shares of each. Over 400 matches at
 * 54 blanks, both seat orders:
 *
 * | `easy` | opener's share of decided |
 * |---|---|
 * | examine 3, slip 0.30 | **42.6%** |
 * | examine 3, slip 0 | 45.9% |
 * | every square, slip 0.50 | **48.0%** |
 * | every square, slip 0 | 49.6% |
 *
 * The tier is exactly as weak either way; only one of the two spellings is weak in a way
 * that does not depend on which seat you are sitting in.
 */
export const BOT_PROFILE: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { hiddenSingles: false, contradiction: false, slip: 0.18 },
  normal: { hiddenSingles: true, contradiction: false, slip: 0.15 },
  hard: { hiddenSingles: true, contradiction: true, slip: 0 },
});

/** How many squares the hardest tier is willing to disprove candidates on in one turn. */
const CONTRADICTION_CELLS = 6;

const candidates: number[] = new Array<number>(CELL_COUNT).fill(0);
const pool: number[] = new Array<number>(CELL_COUNT).fill(0);
const tryGrid: number[] = new Array<number>(CELL_COUNT).fill(0);

function computeCandidates(cells: readonly number[]): void {
  loadUsed(cells);
  for (let index = 0; index < CELL_COUNT; index += 1) {
    candidates[index] = (cells[index] as number) === 0 ? freeAt(index) : 0;
  }
}

/**
 * A digit with only one home left in a unit belongs there, whatever else that square could
 * have held. The first technique a person learns after "what is left in this square", and
 * the one that separates the middle tier from the weakest.
 */
function applyHiddenSingles(): void {
  for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
    for (let digit = 1; digit <= SIZE; digit += 1) {
      const bit = bitOf(digit);
      let where = -1;
      let count = 0;
      for (let k = 0; k < SIZE; k += 1) {
        const index = unitCell(unit, k);
        if (((candidates[index] as number) & bit) === 0) continue;
        where = index;
        count += 1;
        if (count > 1) break;
      }
      if (count === 1 && where >= 0) candidates[where] = bit;
    }
  }
}

function placeInTry(index: number, digit: number): void {
  tryGrid[index] = digit;
  markUsed(index, bitOf(digit));
}

/**
 * Whether putting `digit` in `index` forces the grid into a position that cannot be
 * completed — a square with nothing left to put in it, or a digit with nowhere left to go
 * in some unit.
 *
 * Propagation only: it fills in what is forced and looks for the wreck. It never branches,
 * so it can only ever answer "this digit is impossible", never "this digit is right" —
 * which is the shape of the technique a person uses at the board, and the reason it cannot
 * quietly become a solver reading out the answer.
 *
 * Out of budget it returns false: unproven, not disproven. The caller keeps the candidate.
 */
function contradicts(
  cells: readonly number[],
  index: number,
  digit: number,
  budget: SearchBudget,
): boolean {
  for (let i = 0; i < CELL_COUNT; i += 1) tryGrid[i] = cells[i] as number;
  loadUsed(tryGrid);
  placeInTry(index, digit);

  for (;;) {
    if (!budget.spend()) return false;
    let progress = false;

    for (let i = 0; i < CELL_COUNT; i += 1) {
      if ((tryGrid[i] as number) !== 0) continue;
      const mask = freeAt(i);
      if (mask === 0) return true;
      if (popcount(mask) === 1) {
        placeInTry(i, firstDigit(mask));
        progress = true;
      }
    }

    for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
      for (let d = 1; d <= SIZE; d += 1) {
        const bit = bitOf(d);
        let where = -1;
        let count = 0;
        let taken = false;
        for (let k = 0; k < SIZE; k += 1) {
          const cell = unitCell(unit, k);
          const held = tryGrid[cell] as number;
          if (held === d) {
            taken = true;
            break;
          }
          if (held !== 0) continue;
          if ((freeAt(cell) & bit) === 0) continue;
          where = cell;
          count += 1;
        }
        if (taken) continue;
        if (count === 0) return true;
        if (count === 1 && where >= 0) {
          placeInTry(where, d);
          progress = true;
        }
      }
    }

    if (!progress) return false;
  }
}

/* The mover's count, the other seat's, how many squares are still to answer, and who owns
   the head, for each of the twenty-seven units. Reloaded once a turn; nothing allocates. */
const unitMine = new Int32Array(UNIT_COUNT);
const unitTheirs = new Int32Array(UNIT_COUNT);
const unitLeft = new Int32Array(UNIT_COUNT);
const unitHead = new Int32Array(UNIT_COUNT);

function loadUnits(owner: readonly number[], head: readonly number[], seat: SeatId): void {
  const mine = seat === 'p1' ? CLAIMED_P1 : CLAIMED_P2;
  const theirs = seat === 'p1' ? CLAIMED_P2 : CLAIMED_P1;
  for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
    let a = 0;
    let b = 0;
    let left = 0;
    for (let k = 0; k < SIZE; k += 1) {
      const held = owner[unitCell(unit, k)] as number;
      if (held === mine) a += 1;
      else if (held === theirs) b += 1;
      else if (held === EMPTY) left += 1;
    }
    unitMine[unit] = a;
    unitTheirs[unit] = b;
    unitLeft[unit] = left;
    const at = head[unit] as number;
    const held = at < 0 ? EMPTY : (owner[at] as number);
    unitHead[unit] = held === mine ? 1 : held === theirs ? -1 : 0;
  }
}

/** Who a unit would belong to if it stopped here: +1 mine, -1 theirs, 0 nobody yet. */
function projectedLead(mine: number, theirs: number, head: number): number {
  if (mine > theirs) return 1;
  if (mine < theirs) return -1;
  return head;
}

/** What taking one more square in a unit is worth, from the point of view of the taker. */
function unitGain(unit: number, takingHead: boolean): number {
  const mine = unitMine[unit] as number;
  const theirs = unitTheirs[unit] as number;
  const left = unitLeft[unit] as number;
  const head = unitHead[unit] as number;
  const before = projectedLead(mine, theirs, head);
  const after = projectedLead(mine + 1, theirs, takingHead ? 1 : head);
  let gain = (after - before) * 4;
  // A lead the other seat can no longer overturn is worth more than one they can.
  if (mine + 1 - theirs > left - 1) gain += 3;
  return gain;
}

/**
 * What a square is worth as territory: the three units it belongs to, added up.
 *
 * This is what the whole ladder is about at the top, where both seats answer everything
 * correctly and the match is decided entirely by *which* squares each of them took.
 */
function territoryValue(head: readonly number[], cell: number): number {
  const row = rowUnit(cell);
  const column = columnUnit(cell);
  const box = boxUnit(cell);
  return (
    unitGain(row, (head[row] as number) === cell) +
    unitGain(column, (head[column] as number) === cell) +
    unitGain(box, (head[box] as number) === cell)
  );
}

/** Weight of a square from the point of view of the seat being sent to it. */
function sendWeight(count: number): number {
  if (count === 1) return 12;
  if (count === 2) return 5;
  if (count === 3) return 2;
  return 1;
}

/**
 * How good the cross through `cell` would be for the other seat. Lower is better for us.
 *
 * Read off the candidate table as it stands, which slightly overstates how easy the cross
 * will be, because our own answer will have gone in by then. That is the approximation a
 * person makes at the board too, and it is worth far less than redoing the whole table once
 * per candidate square.
 */
function sendCost(cell: number): number {
  const row = rowOf(cell);
  const column = columnOf(cell);
  let cost = 0;
  let open = 0;
  for (let k = 0; k < SIZE; k += 1) {
    const across = indexOf(k, row);
    if (across !== cell && (candidates[across] as number) !== 0) {
      cost += sendWeight(popcount(candidates[across] as number));
      open += 1;
    }
    const down = indexOf(column, k);
    if (down !== cell && (candidates[down] as number) !== 0) {
      cost += sendWeight(popcount(candidates[down] as number));
      open += 1;
    }
  }
  // An empty cross is the worst thing we can do: it lets them answer anywhere on the grid.
  if (open === 0) return 1000;
  return cost;
}

/** The squares the mover may answer, derived from the visible grid alone, into `pool`. */
function botAllowed(cells: readonly number[], anchor: number): number {
  const wide = !crossHasEmpty(cells, anchor);
  let count = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if ((cells[index] as number) !== 0) continue;
    if (!wide && !inCross(index, anchor)) continue;
    pool[count++] = index;
  }
  return count;
}

/**
 * Narrow the candidate sets of the few most promising squares by disproving digits.
 *
 * Only the few: the point of the technique is to turn a two-way guess into a certainty, and
 * a square with seven candidates is not going to become one. Bounded by the SDK's node
 * budget so a turn costs the same on a phone as on a laptop.
 */
function refineByContradiction(cells: readonly number[], count: number): void {
  let smallest = SIZE + 1;
  for (let i = 0; i < count; i += 1) {
    const size = popcount(candidates[pool[i] as number] as number);
    if (size > 1 && size < smallest) smallest = size;
  }
  if (smallest > SIZE) return;

  const budget = new SearchBudget(DEFAULT_SEARCH_NODES);
  let tested = 0;
  for (let i = 0; i < count && tested < CONTRADICTION_CELLS; i += 1) {
    const cell = pool[i] as number;
    const mask = candidates[cell] as number;
    const size = popcount(mask);
    if (size <= 1 || size > smallest + 1) continue;
    tested += 1;

    let reduced = mask;
    let walk = mask;
    while (walk !== 0) {
      const digit = firstDigit(walk);
      walk &= walk - 1;
      if (popcount(reduced) <= 1) break;
      if (contradicts(cells, cell, digit, budget)) reduced &= ~bitOf(digit);
    }
    if (reduced !== 0) candidates[cell] = reduced;
  }
}

/**
 * The square and digit a bot answers with.
 *
 * The arguments are the grid, who owns what, where each unit's head is, which seat is to
 * move, and the square the mover is confined to. **There is no sixth source of truth**, and
 * specifically the solution is not among them. Rule 6 says a bot may not have information a
 * human cannot get, and in this game the information that matters is one array; passing the
 * whole `MatchState` would have left it a property access away in every tier for ever, so
 * it is not passed. Everything below is deduction from digits already on the grid and
 * squares already coloured — exactly what the person opposite is working from.
 *
 * It shows in the measurement, which is the point. On the weakest tier this bot answers
 * about 89% of its squares correctly and on the strongest about 100%, and the strongest
 * gets to 100% by deduction on a grid that a puzzle of this difficulty makes tractable, not
 * by reading anything: set it a harder puzzle and the number falls.
 *
 * Returns false only when there is nothing at all to answer.
 */
export function chooseMove(
  out: Move,
  cells: readonly number[],
  owner: readonly number[],
  head: readonly number[],
  seat: SeatId,
  anchor: number,
  rng: Rng,
  difficulty: BotDifficulty,
): boolean {
  const profile = BOT_PROFILE[difficulty];

  const count = botAllowed(cells, anchor);
  if (count === 0) {
    out.cell = -1;
    out.digit = 0;
    return false;
  }

  computeCandidates(cells);
  if (profile.hiddenSingles) applyHiddenSingles();
  loadUnits(owner, head, seat);

  // Shuffled so that equally good squares are not always resolved in favour of the top-left
  // of the grid, which would have the two seats playing mirror-image openings.
  for (let i = 0; i < count; i += 1) {
    const j = i + rng.int(0, count - i);
    const held = pool[i] as number;
    pool[i] = pool[j] as number;
    pool[j] = held;
  }

  if (profile.contradiction) refineByContradiction(cells, count);

  let chosen = pool[0] as number;
  let chosenCount = SIZE + 1;
  let chosenValue = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i += 1) {
    const cell = pool[i] as number;
    const size = popcount(candidates[cell] as number);
    if (size === 0) continue;
    // Certainty first, always: a square you are sure of is worth more than any position.
    // Among the squares it is equally sure of, it takes the one that wins the most ground
    // and leaves the other seat the least.
    const value = territoryValue(head, cell) * 4 - sendCost(cell);
    if (size < chosenCount || (size === chosenCount && value > chosenValue)) {
      chosen = cell;
      chosenCount = size;
      chosenValue = value;
    }
  }

  // Drawn whether or not it is used, so the number of values a turn costs does not depend
  // on the position — the failure that couples two seats sharing one generator.
  const alternative = pool[rng.int(0, count)] as number;
  if (rng.bool(profile.slip)) chosen = alternative;

  let mask = candidates[chosen] as number;
  if (mask === 0) {
    loadUsed(cells);
    mask = freeAt(chosen);
  }
  const size = popcount(mask);
  const wanted = size > 1 ? rng.int(0, size) : 0;
  let digit = firstDigit(mask);
  let walk = mask;
  for (let i = 0; i < wanted && walk !== 0; i += 1) {
    walk &= walk - 1;
    digit = firstDigit(walk);
  }

  out.cell = chosen;
  out.digit = digit;
  return digit > 0;
}
