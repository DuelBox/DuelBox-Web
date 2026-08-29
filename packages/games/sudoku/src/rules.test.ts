import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILE,
  CELL_COUNT,
  CLAIMED_P1,
  CLAIMED_P2,
  EMPTY,
  GIVEN,
  SIZE,
  TARGET_BLANKS,
  UNIT_COUNT,
  allowedCells,
  applyEntry,
  applyForfeit,
  boxOf,
  boxUnit,
  candidateCount,
  candidateMask,
  chooseMove,
  columnOf,
  columnUnit,
  countSolutions,
  createMatch,
  createMove,
  crossHasEmpty,
  forcedMove,
  generatePuzzle,
  inCross,
  indexOf,
  isAllowed,
  isHead,
  isLegalDigit,
  isOver,
  otherOf,
  rowOf,
  rowUnit,
  solvedGrid,
  unitCell,
  unitLeader,
  unitsLedBy,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, MatchState } from './rules.js';

/**
 * Whole matches are cheap here — a puzzle costs about 0.2 ms to build and a match about
 * 3 ms to play — but the strength series play several hundred of them, and this suite has
 * to pass on a CI runner several times slower than a development machine.
 */
const SERIES_TIMEOUT_MS = 120_000;

interface Played {
  readonly turns: number;
  readonly right: Record<SeatId, number>;
  readonly answered: Record<SeatId, number>;
}

/** Plays a whole match between two bots through the rules alone. */
function playOut(
  state: MatchState,
  p1: BotDifficulty,
  p2: BotDifficulty,
  seed: number,
  onMove?: (seat: SeatId, cell: number, digit: number) => void,
): Played {
  const move = createMove();
  const streams: Record<SeatId, Rng> = { p1: new Rng(seed * 31 + 7), p2: new Rng(seed * 97 + 13) };
  const right: Record<SeatId, number> = { p1: 0, p2: 0 };
  const answered: Record<SeatId, number> = { p1: 0, p2: 0 };
  let turns = 0;
  // No ceiling on the loop beyond a sanity bound far above any legal match: a rule change
  // that stopped the grid filling should fail loudly rather than quietly stop early.
  while (!isOver(state) && turns < CELL_COUNT * 4) {
    const seat = state.active;
    const tier = seat === 'p1' ? p1 : p2;
    const found = chooseMove(
      move,
      state.cells,
      state.owner,
      state.head,
      seat,
      state.anchor,
      streams[seat],
      tier,
    );
    expect(found, 'a bot must always have something to answer').toBe(true);
    onMove?.(seat, move.cell, move.digit);
    const result = applyEntry(state, move.cell, move.digit);
    expect(result, 'a bot must never propose an answer the rules refuse').not.toBe('refused');
    answered[seat] += 1;
    if (result === 'claimed') right[seat] += 1;
    turns += 1;
  }
  return { turns, right, answered };
}

describe('the geometry', () => {
  it('is a nine by nine grid in three by three boxes', () => {
    expect(SIZE).toBe(9);
    expect(CELL_COUNT).toBe(81);
    expect(UNIT_COUNT).toBe(27);
  });

  it('indexes every square exactly once', () => {
    const seen = new Set<number>();
    for (let row = 0; row < SIZE; row += 1) {
      for (let column = 0; column < SIZE; column += 1) {
        const index = indexOf(column, row);
        expect(rowOf(index)).toBe(row);
        expect(columnOf(index)).toBe(column);
        seen.add(index);
      }
    }
    expect(seen.size).toBe(CELL_COUNT);
  });

  it('puts nine squares in every unit and every square in three units', () => {
    const membership = new Array<number>(CELL_COUNT).fill(0);
    for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
      const cells = new Set<number>();
      for (let k = 0; k < SIZE; k += 1) {
        const cell = unitCell(unit, k);
        cells.add(cell);
        membership[cell] = (membership[cell] as number) + 1;
      }
      expect(cells.size, `unit ${String(unit)} does not hold nine distinct squares`).toBe(SIZE);
    }
    expect(membership.every((count) => count === 3)).toBe(true);
  });

  it('agrees with itself about which units a square belongs to', () => {
    for (let index = 0; index < CELL_COUNT; index += 1) {
      expect(rowUnit(index)).toBe(rowOf(index));
      expect(columnUnit(index)).toBe(SIZE + columnOf(index));
      expect(boxUnit(index)).toBe(SIZE * 2 + boxOf(index));
      for (const unit of [rowUnit(index), columnUnit(index), boxUnit(index)]) {
        let found = false;
        for (let k = 0; k < SIZE; k += 1) if (unitCell(unit, k) === index) found = true;
        expect(found).toBe(true);
      }
    }
  });

  it('puts the top-left nine squares in box zero', () => {
    expect(boxOf(indexOf(0, 0))).toBe(0);
    expect(boxOf(indexOf(2, 2))).toBe(0);
    expect(boxOf(indexOf(3, 2))).toBe(1);
    expect(boxOf(indexOf(8, 8))).toBe(8);
  });
});

describe('the generator', () => {
  it('makes a complete, valid grid', () => {
    const grid = new Array<number>(CELL_COUNT).fill(0);
    solvedGrid(new Rng(4242), grid);
    expect(grid.every((digit) => digit >= 1 && digit <= SIZE)).toBe(true);
    for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
      const seen = new Set<number>();
      for (let k = 0; k < SIZE; k += 1) seen.add(grid[unitCell(unit, k)] as number);
      expect(seen.size, `unit ${String(unit)} repeats a digit`).toBe(SIZE);
    }
  });

  it('gives every puzzle exactly one solution', { timeout: SERIES_TIMEOUT_MS }, () => {
    // The scoring rule is "does this digit match the answer", so a second answer would let
    // a player deduce a digit soundly and still be told they were wrong. Counted to three
    // rather than two so a bug that returned the cap could not pass by accident.
    for (let seed = 1; seed <= 60; seed += 1) {
      const puzzle = generatePuzzle(new Rng(seed * 1009));
      expect(countSolutions(puzzle.givens, 3), `seed ${String(seed)}`).toBe(1);
    }
  });

  it('leaves an even number of squares, so both seats answer the same many', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const puzzle = generatePuzzle(new Rng(seed * 31337));
      expect(puzzle.blanks % 2, `seed ${String(seed)} left an odd number of squares`).toBe(0);
      expect(puzzle.blanks).toBeLessThanOrEqual(TARGET_BLANKS);
      const empty = puzzle.givens.filter((digit) => digit === 0).length;
      expect(empty).toBe(puzzle.blanks);
    }
  });

  it('honours an odd target too, rather than silently rounding it', () => {
    const puzzle = generatePuzzle(new Rng(77), 41);
    expect(puzzle.blanks % 2).toBe(1);
  });

  it('keeps every given consistent with the solution it came from', () => {
    const puzzle = generatePuzzle(new Rng(2024));
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const given = puzzle.givens[index] as number;
      if (given !== 0) expect(given).toBe(puzzle.solution[index]);
    }
  });

  it('is a pure function of the seed', () => {
    const a = generatePuzzle(new Rng(9090));
    const b = generatePuzzle(new Rng(9090));
    expect(a.givens).toEqual(b.givens);
    expect(a.solution).toEqual(b.solution);
  });

  it('gives different seeds different puzzles', () => {
    const a = generatePuzzle(new Rng(1));
    const b = generatePuzzle(new Rng(2));
    expect(a.solution).not.toEqual(b.solution);
  });

  it('counts solutions honestly on a grid with more than one', () => {
    // An empty grid has astronomically many; the count is capped, never wrong about "one".
    const empty = new Array<number>(CELL_COUNT).fill(0);
    expect(countSolutions(empty, 2)).toBe(2);
    const solved = new Array<number>(CELL_COUNT).fill(0);
    solvedGrid(new Rng(5), solved);
    expect(countSolutions(solved, 2)).toBe(1);
  });

  it('reports no solution for a grid that has none', () => {
    const solved = new Array<number>(CELL_COUNT).fill(0);
    solvedGrid(new Rng(6), solved);
    const broken = solved.slice();
    // Empty one square and put its own digit in a neighbour, so the empty square has all
    // nine digits among its row, column and box and nothing at all it could hold.
    const corner = indexOf(0, 0);
    const held = broken[corner] as number;
    broken[corner] = 0;
    broken[indexOf(1, 0)] = held;
    expect(candidateMask(broken, corner)).toBe(0);
    expect(countSolutions(broken, 2)).toBe(0);
  });
});

describe('candidates and legality', () => {
  it('offers every digit in an empty grid and none in a filled square', () => {
    const empty = new Array<number>(CELL_COUNT).fill(0);
    expect(candidateCount(empty, 0)).toBe(SIZE);
    empty[0] = 5;
    expect(candidateMask(empty, 0)).toBe(0);
    expect(candidateCount(empty, 1)).toBe(SIZE - 1);
    expect(isLegalDigit(empty, 1, 5)).toBe(false);
    expect(isLegalDigit(empty, 1, 6)).toBe(true);
  });

  it('eliminates along the row, down the column and around the box', () => {
    const grid = new Array<number>(CELL_COUNT).fill(0);
    grid[indexOf(8, 4)] = 1; // same row as (4,4)
    grid[indexOf(4, 8)] = 2; // same column
    grid[indexOf(3, 3)] = 3; // same box
    const mask = candidateMask(grid, indexOf(4, 4));
    for (const digit of [1, 2, 3]) expect(mask & (1 << (digit - 1))).toBe(0);
    expect(candidateCount(grid, indexOf(4, 4))).toBe(SIZE - 3);
  });

  it('refuses a digit outside one to nine and a square off the grid', () => {
    const empty = new Array<number>(CELL_COUNT).fill(0);
    for (const digit of [0, 10, -1, 1.5, Number.NaN]) {
      expect(isLegalDigit(empty, 0, digit)).toBe(false);
    }
    for (const index of [-1, CELL_COUNT, 2.5, Number.NaN]) {
      expect(candidateMask(empty, index)).toBe(0);
    }
  });
});

describe('a fresh match', () => {
  it('starts level, with the opening seat to move', () => {
    for (const opener of ['p1', 'p2'] as SeatId[]) {
      const state = createMatch(new Rng(11), opener);
      expect(state.active).toBe(opener);
      expect(state.p1).toBe(0);
      expect(state.p2).toBe(0);
      expect(state.squaresP1).toBe(0);
      expect(state.squaresP2).toBe(0);
      expect(winnerOf(state)).toBeNull();
      expect(isOver(state)).toBe(false);
    }
  });

  it('marks every square as given or still to answer, and nothing else', () => {
    const state = createMatch(new Rng(12));
    let blanks = 0;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const owner = state.owner[index] as number;
      expect(owner === GIVEN || owner === EMPTY).toBe(true);
      expect(owner === EMPTY).toBe((state.cells[index] as number) === 0);
      if (owner === EMPTY) blanks += 1;
    }
    expect(blanks).toBe(state.blanks);
  });

  it('confines the opening turn just like every other one', () => {
    // The opener does not get the one turn in the match with the whole grid to pick from;
    // the anchor is seeded. See the note on createMatch for what that is worth.
    const state = createMatch(new Rng(13));
    expect(state.anchor).toBeGreaterThanOrEqual(0);
    expect(state.anchor).toBeLessThan(CELL_COUNT);
    const out = new Array<number>(CELL_COUNT).fill(0);
    const count = allowedCells(out, state);
    expect(count).toBeGreaterThan(0);
    if (!state.wideOpen) {
      for (let i = 0; i < count; i += 1) {
        expect(inCross(out[i] as number, state.anchor)).toBe(true);
      }
      expect(count).toBeLessThan(state.blanks);
    }
  });

  it('gives every unit a head that is a square somebody will answer', () => {
    const state = createMatch(new Rng(14));
    for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
      const head = state.head[unit] as number;
      expect(head, `unit ${String(unit)} has no head`).toBeGreaterThanOrEqual(0);
      expect(state.owner[head]).toBe(EMPTY);
      let inside = false;
      for (let k = 0; k < SIZE; k += 1) if (unitCell(unit, k) === head) inside = true;
      expect(inside).toBe(true);
      expect(isHead(state, head)).toBe(true);
    }
  });

  it('is serialisable and restorable exactly', () => {
    const state = createMatch(new Rng(15));
    applyEntry(state, firstAllowed(state), 0);
    const round = JSON.parse(JSON.stringify(state)) as MatchState;
    expect(round).toEqual(state);
    expect(unitsLedBy(round, 'p1')).toBe(unitsLedBy(state, 'p1'));
  });
});

function firstAllowed(state: MatchState): number {
  for (let index = 0; index < CELL_COUNT; index += 1) if (isAllowed(state, index)) return index;
  return -1;
}

function correctDigitAt(state: MatchState, index: number): number {
  return state.solution[index] as number;
}

function wrongDigitAt(state: MatchState, index: number): number {
  const mask = candidateMask(state.cells, index);
  const right = correctDigitAt(state, index);
  for (let digit = 1; digit <= SIZE; digit += 1) {
    if (digit !== right && (mask & (1 << (digit - 1))) !== 0) return digit;
  }
  return 0;
}

describe('answering a square', () => {
  it('claims it for the mover when the digit is right', () => {
    const state = createMatch(new Rng(21));
    const cell = firstAllowed(state);
    const mover = state.active;
    expect(applyEntry(state, cell, correctDigitAt(state, cell))).toBe('claimed');
    expect(state.owner[cell]).toBe(mover === 'p1' ? CLAIMED_P1 : CLAIMED_P2);
    expect(mover === 'p1' ? state.squaresP1 : state.squaresP2).toBe(1);
    expect(state.active).toBe(otherOf(mover));
  });

  it('hands it to the other seat when the digit is wrong, with the right digit in it', () => {
    const state = createMatch(new Rng(22));
    let cell = firstAllowed(state);
    // Find a square with a second candidate, so a wrong answer is possible at all.
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if (isAllowed(state, index) && candidateCount(state.cells, index) > 1) {
        cell = index;
        break;
      }
    }
    const wrong = wrongDigitAt(state, cell);
    expect(wrong).toBeGreaterThan(0);
    const mover = state.active;
    expect(applyEntry(state, cell, wrong)).toBe('conceded');
    expect(state.owner[cell]).toBe(mover === 'p1' ? CLAIMED_P2 : CLAIMED_P1);
    // The grid never holds a false digit: the answer goes in whoever gets the square.
    expect(state.cells[cell]).toBe(correctDigitAt(state, cell));
    expect(mover === 'p1' ? state.squaresP2 : state.squaresP1).toBe(1);
  });

  it('refuses a digit that already stands in the row, column or box', () => {
    const state = createMatch(new Rng(23));
    const cell = firstAllowed(state);
    const mask = candidateMask(state.cells, cell);
    let illegal = 0;
    for (let digit = 1; digit <= SIZE; digit += 1) {
      if ((mask & (1 << (digit - 1))) === 0) illegal = digit;
    }
    expect(illegal).toBeGreaterThan(0);
    const before = state.blanks;
    const mover = state.active;
    expect(applyEntry(state, cell, illegal)).toBe('refused');
    expect(state.blanks, 'a refusal must not cost a turn').toBe(before);
    expect(state.active).toBe(mover);
  });

  it('refuses a square that is filled, off the grid, or outside the cross', () => {
    const state = createMatch(new Rng(24));
    let filled = -1;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if ((state.cells[index] as number) !== 0) filled = index;
    }
    expect(applyEntry(state, filled, 1)).toBe('refused');
    for (const index of [-1, CELL_COUNT, 3.5, Number.NaN]) {
      expect(applyEntry(state, index, 1)).toBe('refused');
    }
    if (!state.wideOpen) {
      let outside = -1;
      for (let index = 0; index < CELL_COUNT; index += 1) {
        if ((state.cells[index] as number) === 0 && !inCross(index, state.anchor)) outside = index;
      }
      expect(outside).toBeGreaterThanOrEqual(0);
      expect(applyEntry(state, outside, correctDigitAt(state, outside))).toBe('refused');
    }
  });

  it('refuses a digit outside one to nine', () => {
    const state = createMatch(new Rng(25));
    const cell = firstAllowed(state);
    for (const digit of [0, 10, -3, 2.5, Number.NaN]) {
      expect(applyEntry(state, cell, digit)).toBe('refused');
    }
  });

  it('sends the other seat to the cross through the square just answered', () => {
    const state = createMatch(new Rng(26));
    const cell = firstAllowed(state);
    applyEntry(state, cell, correctDigitAt(state, cell));
    expect(state.anchor).toBe(cell);
    expect(state.wideOpen).toBe(!crossHasEmpty(state.cells, cell));
    if (!state.wideOpen) {
      for (let index = 0; index < CELL_COUNT; index += 1) {
        if (!isAllowed(state, index)) continue;
        expect(inCross(index, cell), 'a square outside the cross was offered').toBe(true);
      }
    }
  });

  it('opens the whole grid when the cross has nothing left in it', () => {
    const state = createMatch(new Rng(27));
    // Fill the cross through a chosen square by hand, then check the rule fires.
    const anchor = indexOf(4, 4);
    for (let k = 0; k < SIZE; k += 1) {
      state.cells[indexOf(k, 4)] = 1;
      state.cells[indexOf(4, k)] = 1;
    }
    expect(crossHasEmpty(state.cells, anchor)).toBe(false);
    state.anchor = anchor;
    state.wideOpen = true;
    const out = new Array<number>(CELL_COUNT).fill(0);
    expect(allowedCells(out, state)).toBeGreaterThan(0);
  });

  it('always has a forced answer while a square is left', () => {
    const state = createMatch(new Rng(28));
    const move = createMove();
    for (let turn = 0; turn < 20; turn += 1) {
      expect(forcedMove(move, state)).toBe(true);
      expect(applyEntry(state, move.cell, move.digit)).not.toBe('refused');
    }
    expect(state.blanks).toBe(createMatch(new Rng(28)).blanks - 20);
  });
});

describe('letting the turn go', () => {
  it('reveals the square and gives it to the other seat', () => {
    const state = createMatch(new Rng(31));
    const cell = firstAllowed(state);
    const mover = state.active;
    expect(applyForfeit(state, cell)).toBe('conceded');
    expect(state.cells[cell]).toBe(correctDigitAt(state, cell));
    expect(state.owner[cell]).toBe(mover === 'p1' ? CLAIMED_P2 : CLAIMED_P1);
    expect(state.lastDigit, 'a forfeit offered no digit').toBe(0);
    expect(state.active).toBe(otherOf(mover));
  });

  it('still fills exactly one square, so a match of forfeits terminates', () => {
    const state = createMatch(new Rng(32));
    const total = state.blanks;
    let turns = 0;
    while (!isOver(state)) {
      const cell = firstAllowed(state);
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(applyForfeit(state, cell)).toBe('conceded');
      turns += 1;
      expect(turns).toBeLessThanOrEqual(total);
    }
    expect(turns).toBe(total);
    expect(winnerOf(state)).not.toBeNull();
  });

  it('refuses a square it may not have', () => {
    const state = createMatch(new Rng(33));
    let filled = 0;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if ((state.cells[index] as number) !== 0) filled = index;
    }
    expect(applyForfeit(state, filled)).toBe('refused');
  });
});

describe('holding a unit', () => {
  it('goes to whoever owns more of its answered squares', () => {
    const state = createMatch(new Rng(41));
    const unit = 0;
    state.owner[unitCell(unit, 0)] = CLAIMED_P1;
    state.owner[unitCell(unit, 1)] = CLAIMED_P1;
    state.owner[unitCell(unit, 2)] = CLAIMED_P2;
    expect(unitLeader(state, unit)).toBe('p1');
    state.owner[unitCell(unit, 3)] = CLAIMED_P2;
    state.owner[unitCell(unit, 4)] = CLAIMED_P2;
    expect(unitLeader(state, unit)).toBe('p2');
  });

  it('goes to the head when the two are level', () => {
    const state = createMatch(new Rng(42));
    const unit = 0;
    for (let k = 0; k < SIZE; k += 1) state.owner[unitCell(unit, k)] = EMPTY;
    state.head[unit] = unitCell(unit, 3);
    expect(unitLeader(state, unit), 'nobody holds a unit nobody has touched').toBeNull();

    state.owner[unitCell(unit, 3)] = CLAIMED_P2;
    state.owner[unitCell(unit, 5)] = CLAIMED_P1;
    expect(unitLeader(state, unit), 'level, so the head decides it').toBe('p2');
    state.head[unit] = unitCell(unit, 5);
    expect(unitLeader(state, unit)).toBe('p1');
  });

  it(
    'shares the twenty-seven out completely once the grid is full',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      for (const seed of [1, 2, 3, 5, 8]) {
        const state = createMatch(new Rng(seed * 13));
        playOut(state, 'normal', 'easy', seed);
        expect(isOver(state)).toBe(true);
        expect(state.p1 + state.p2, `seed ${String(seed)} left a unit unheld`).toBe(UNIT_COUNT);
      }
    },
  );
});

describe('the end of a match', () => {
  it('is decided the moment the last square is answered', { timeout: SERIES_TIMEOUT_MS }, () => {
    const state = createMatch(new Rng(51));
    const total = state.blanks;
    const played = playOut(state, 'hard', 'normal', 51);
    expect(played.turns).toBe(total);
    expect(state.squaresP1 + state.squaresP2).toBe(total);
    // Both seats *answer* the same many squares. Which of them ends up *owning* each one
    // is the game: a wrong answer hands the square over.
    expect(played.answered.p1).toBe(total / 2);
    expect(played.answered.p2).toBe(total / 2);
    expect(state.squaresP1 + state.squaresP2).toBe(played.answered.p1 + played.answered.p2);
    expect(winnerOf(state)).not.toBeNull();
  });

  it('cannot be a draw, because twenty-seven is odd', { timeout: SERIES_TIMEOUT_MS }, () => {
    // Every unit belongs to somebody once the grid is full, and an odd number of units
    // cannot be shared equally. This is the property the head rule exists to give.
    let draws = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = createMatch(new Rng(seed * 977));
      playOut(state, 'hard', 'hard', seed);
      if (winnerOf(state) === 'draw') draws += 1;
    }
    expect(draws, 'two perfect players still have to be separated').toBe(0);
  });

  it('reaches a win for either seat', { timeout: SERIES_TIMEOUT_MS }, () => {
    const winners = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const state = createMatch(new Rng(seed * 421));
      playOut(state, 'easy', 'easy', seed);
      winners.add(String(winnerOf(state)));
    }
    expect(winners.has('p1')).toBe(true);
    expect(winners.has('p2')).toBe(true);
  });

  it('falls back to squares if some unit had nothing to answer', () => {
    // Contrived, and the reason the fallback exists: the match may not end undefined.
    const state = createMatch(new Rng(52));
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if ((state.owner[index] as number) === EMPTY) state.owner[index] = GIVEN;
    }
    state.blanks = 0;
    state.p1 = 0;
    state.p2 = 0;
    state.squaresP1 = 3;
    state.squaresP2 = 1;
    expect(winnerOf(state)).toBe('p1');
    state.squaresP2 = 3;
    expect(winnerOf(state)).toBe('draw');
  });

  it('reports nothing while a square is left', () => {
    const state = createMatch(new Rng(53));
    expect(winnerOf(state)).toBeNull();
    applyEntry(state, firstAllowed(state), correctDigitAt(state, firstAllowed(state)));
    expect(winnerOf(state)).toBeNull();
  });
});

describe('the bot', () => {
  it('never sees the answer, and cannot: it is not passed one', () => {
    // Structural rather than behavioural. `chooseMove` takes the grid, the owners, the
    // heads, the seat and the anchor — so scrambling the solution cannot reach it. The
    // test is here to fail the day somebody adds a sixth argument.
    const state = createMatch(new Rng(61));
    const move = createMove();
    chooseMove(move, state.cells, state.owner, state.head, 'p1', state.anchor, new Rng(5), 'hard');
    const first = `${String(move.cell)}:${String(move.digit)}`;

    for (let index = 0; index < CELL_COUNT; index += 1) {
      state.solution[index] = ((state.solution[index] as number) % SIZE) + 1;
    }
    chooseMove(move, state.cells, state.owner, state.head, 'p1', state.anchor, new Rng(5), 'hard');
    expect(`${String(move.cell)}:${String(move.digit)}`).toBe(first);
  });

  it(
    'is wrong sometimes, which is what not cheating looks like',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      let right = 0;
      let answered = 0;
      for (let seed = 1; seed <= 10; seed += 1) {
        const state = createMatch(new Rng(seed * 601));
        const played = playOut(state, 'easy', 'easy', seed);
        right += played.right.p1 + played.right.p2;
        answered += played.answered.p1 + played.answered.p2;
      }
      const accuracy = right / answered;
      // A bot reading the solution would be at 1.000 on every tier and every puzzle.
      expect(accuracy).toBeLessThan(0.97);
      expect(accuracy, 'and it must still be playing, not flailing').toBeGreaterThan(0.6);
    },
  );

  it(
    'only ever answers with a digit the visible grid allows',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
        const state = createMatch(new Rng(62));
        playOut(state, tier, tier, 62, (_seat, cell, digit) => {
          expect(isAllowed(state, cell), `${tier} answered a square it may not have`).toBe(true);
          expect(isLegalDigit(state.cells, cell, digit), `${tier} answered an illegal digit`).toBe(
            true,
          );
        });
      }
    },
  );

  it('is deterministic for a seed', { timeout: SERIES_TIMEOUT_MS }, () => {
    const trace = (): string => {
      const state = createMatch(new Rng(808));
      const moves: string[] = [];
      playOut(state, 'hard', 'normal', 808, (seat, cell, digit) => {
        moves.push(`${seat}${String(cell)}.${String(digit)}`);
      });
      return moves.join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('plays a different match on a different seed', { timeout: SERIES_TIMEOUT_MS }, () => {
    const a = createMatch(new Rng(1));
    const b = createMatch(new Rng(2));
    playOut(a, 'normal', 'normal', 1);
    playOut(b, 'normal', 'normal', 2);
    expect(a.cells).not.toEqual(b.cells);
  });

  it('has a ladder that is ordered by deduction, not by luck', () => {
    expect(BOT_PROFILE.easy.hiddenSingles).toBe(false);
    expect(BOT_PROFILE.normal.hiddenSingles).toBe(true);
    expect(BOT_PROFILE.hard.contradiction).toBe(true);
    expect(BOT_PROFILE.normal.contradiction).toBe(false);
    expect(BOT_PROFILE.hard.slip).toBe(0);
    expect(BOT_PROFILE.easy.slip).toBeGreaterThan(BOT_PROFILE.normal.slip);
  });

  it('gets stronger with each tier, over both seat orders', { timeout: SERIES_TIMEOUT_MS }, () => {
    // Measured in both orders, because a first-mover advantage would otherwise be read as
    // strength. The shipped numbers are in SPEC.md; this asserts the ordering only.
    const share = (strong: BotDifficulty, weak: BotDifficulty): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const strongIsP1 = seed % 2 === 0;
        const state = createMatch(new Rng(seed * 7919 + 3), 'p1');
        playOut(state, strongIsP1 ? strong : weak, strongIsP1 ? weak : strong, seed);
        const winner = winnerOf(state);
        if (winner === 'draw' || winner === null) continue;
        decided += 1;
        if (winner === (strongIsP1 ? 'p1' : 'p2')) wins += 1;
      }
      return wins / decided;
    };

    expect(share('hard', 'easy'), 'hard should beat easy').toBeGreaterThan(0.8);
    expect(share('hard', 'normal'), 'hard should beat normal').toBeGreaterThan(0.6);
    expect(share('normal', 'easy'), 'normal should beat easy').toBeGreaterThan(0.7);
  });

  it('draws from its own stream, so the two seats do not share one', () => {
    // Same position, same seed, same tier: the seat argument changes what it plays for,
    // but not how many values it costs. A shared stream would make seat two's play a
    // function of how its opponent was playing.
    const state = createMatch(new Rng(63));
    const a = createMove();
    const b = createMove();
    const left = new Rng(99);
    const right = new Rng(99);
    chooseMove(a, state.cells, state.owner, state.head, 'p1', state.anchor, left, 'normal');
    chooseMove(b, state.cells, state.owner, state.head, 'p1', state.anchor, right, 'normal');
    expect(a).toEqual(b);
  });

  it('says so when there is nothing to answer', () => {
    const state = createMatch(new Rng(64));
    const filled = state.cells.map(() => 1);
    const move = createMove();
    expect(
      chooseMove(move, filled, state.owner, state.head, 'p1', state.anchor, new Rng(1), 'hard'),
    ).toBe(false);
    expect(move.cell).toBe(-1);
  });
});

describe('termination', () => {
  it(
    'fills exactly one square a turn, whatever anybody does',
    { timeout: SERIES_TIMEOUT_MS },
    () => {
      // No frame cap and no move cap: a rule change that let a turn pass without filling a
      // square would hang this test rather than pass it quietly.
      for (const seed of [1, 7, 13]) {
        const state = createMatch(new Rng(seed * 199));
        const total = state.blanks;
        let turns = 0;
        while (!isOver(state)) {
          const before = state.blanks;
          const cell = firstAllowed(state);
          // Deliberately the worst play available: always wrong when a wrong answer exists.
          const wrong = wrongDigitAt(state, cell);
          const result =
            wrong > 0
              ? applyEntry(state, cell, wrong)
              : applyEntry(state, cell, correctDigitAt(state, cell));
          expect(result).not.toBe('refused');
          expect(state.blanks).toBe(before - 1);
          turns += 1;
        }
        expect(turns).toBe(total);
        expect(state.p1 + state.p2).toBe(UNIT_COUNT);
      }
    },
  );
});
