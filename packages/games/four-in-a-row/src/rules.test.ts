import { describe, expect, it } from 'vitest';
import { Rng, otherSeat } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_CHANCE,
  CELL_COUNT,
  COLUMNS,
  LINE_LENGTH,
  ROWS,
  SEARCH_DEPTH,
  applyDrop,
  bestColumn,
  columnHeight,
  createBoard,
  dropRow,
  legalColumns,
  winnerOf,
  winningCells,
  winningCellsInto,
} from './rules.js';
import type { BotDifficulty, Cell } from './rules.js';

/**
 * 'o' is p1, 'x' is p2, anything else is empty. Forty-two glyphs, row-major, TOP ROW
 * FIRST — whitespace is ignored so a spec can be laid out as the board looks.
 */
function boardFrom(spec: string): Cell[] {
  const glyphs = spec.replace(/\s+/g, '');
  expect(glyphs).toHaveLength(CELL_COUNT);
  const board = createBoard();
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const glyph = glyphs[i];
    board[i] = glyph === 'o' ? 'p1' : glyph === 'x' ? 'p2' : null;
  }
  return board;
}

/** Index of a cell, written out rather than imported so the convention is asserted. */
function at(row: number, col: number): number {
  return row * 7 + col;
}

/** Plays the columns in order, alternating seats from `first`, and returns the board. */
function play(columns: readonly number[], first: SeatId = 'p1'): Cell[] {
  const board = createBoard();
  let seat = first;
  for (const column of columns) {
    expect(applyDrop(board, column, seat)).toBeGreaterThanOrEqual(0);
    seat = otherSeat(seat);
  }
  return board;
}

/** Written out rather than derived, so a wrong scan in rules.ts cannot pass itself. */
const LINES: readonly { readonly name: string; readonly cells: readonly number[] }[] = [
  { name: 'a row', cells: [36, 37, 38, 39] },
  { name: 'a column', cells: [16, 23, 30, 37] },
  { name: 'a down-right diagonal', cells: [14, 22, 30, 38] },
  { name: 'a down-left diagonal', cells: [20, 26, 32, 38] },
];

const SEATS: readonly SeatId[] = ['p1', 'p2'];

const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

/**
 * A full board with nothing longer than a two in any direction, so it is a genuine
 * draw rather than a win nobody noticed. Twenty-one discs each, as a real game leaves.
 */
const DRAWN_BOARD = `
  xxoxoxo
  oxoxoxo
  xoxoxox
  xoxoxox
  oxoxoxo
  oxoxoxo
`;

/**
 * A legal move order that fills the board without ever completing a line: columns are
 * stacked so that no colour ever runs more than twice in any direction.
 */
const DRAWN_ORDER: readonly number[] = [
  0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 4, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 6, 6,
  6, 6, 6, 6, 5, 5, 5, 5, 5,
];

describe('the board', () => {
  it('starts as forty-two empty cells', () => {
    const board = createBoard();
    expect(board).toHaveLength(CELL_COUNT);
    expect(CELL_COUNT).toBe(COLUMNS * ROWS);
    expect(board.every((cell) => cell === null)).toBe(true);
  });

  it('indexes row-major with row zero at the top', () => {
    const board = createBoard();
    // A disc dropped into an empty column comes to rest on the floor, which is row 5.
    expect(applyDrop(board, 4, 'p1')).toBe(ROWS - 1);
    expect(board[at(ROWS - 1, 4)]).toBe('p1');
    expect(board[at(0, 4)]).toBeNull();
  });
});

describe('gravity', () => {
  it('always lands a disc on top of the stack', () => {
    const board = createBoard();
    for (let expected = ROWS - 1; expected >= 0; expected -= 1) {
      const seat: SeatId = expected % 2 === 0 ? 'p1' : 'p2';
      expect(applyDrop(board, 2, seat)).toBe(expected);
      expect(board[at(expected, 2)]).toBe(seat);
      expect(columnHeight(board, 2)).toBe(ROWS - expected);
    }
  });

  it('refuses a drop into a full column and changes nothing', () => {
    const board = play([1, 1, 1, 1, 1, 1]);
    const before = board.slice();
    expect(columnHeight(board, 1)).toBe(ROWS);
    expect(dropRow(board, 1)).toBe(-1);
    expect(applyDrop(board, 1, 'p1')).toBe(-1);
    expect(board).toEqual(before);
  });

  it('reads a column that is not a column as full', () => {
    const board = createBoard();
    for (const col of [-1, COLUMNS, 1.5, Number.NaN]) {
      expect(columnHeight(board, col)).toBe(ROWS);
      expect(dropRow(board, col)).toBe(-1);
      expect(applyDrop(board, col, 'p1')).toBe(-1);
    }
    expect(board.every((cell) => cell === null)).toBe(true);
  });

  it('counts the stack up from the floor', () => {
    const board = play([3, 3, 3]);
    expect(columnHeight(board, 3)).toBe(3);
    expect(dropRow(board, 3)).toBe(2);
    expect(columnHeight(board, 0)).toBe(0);
    expect(dropRow(board, 0)).toBe(ROWS - 1);
  });
});

describe('legalColumns', () => {
  it('returns the count and writes only that many entries', () => {
    const out = [9, 9, 9, 9, 9, 9, 9];
    const board = play([0, 0, 0, 0, 0, 0]);
    const count = legalColumns(board, out);
    expect(count).toBe(COLUMNS - 1);
    expect(out.slice(0, count)).toEqual([1, 2, 3, 4, 5, 6]);
    // The buffer is never resized: the entry past the count is the caller's stale value.
    expect(out[6]).toBe(9);
    expect(out).toHaveLength(COLUMNS);
  });

  it('reports every column on an empty board and none on a full one', () => {
    const out = [0, 0, 0, 0, 0, 0, 0];
    expect(legalColumns(createBoard(), out)).toBe(COLUMNS);
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(legalColumns(boardFrom(DRAWN_BOARD), out)).toBe(0);
  });

  it('leaves the tail of an oversized buffer alone', () => {
    const out = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
    expect(legalColumns(play([2, 2, 2, 2, 2, 2]), out)).toBe(COLUMNS - 1);
    expect(out).toHaveLength(10);
    expect(out[9]).toBe(-1);
  });
});

describe('winnerOf', () => {
  for (const seat of SEATS) {
    for (const line of LINES) {
      it(`sees ${seat} holding ${line.name}`, () => {
        const board = createBoard();
        for (const index of line.cells) board[index] = seat;
        expect(winnerOf(board)).toBe(seat);
        expect(winningCells(board)).toEqual(line.cells);
      });
    }
  }

  it('returns null while a column can still be played', () => {
    expect(winnerOf(createBoard())).toBeNull();
    expect(winnerOf(play([3, 3, 4, 4, 5]))).toBeNull();
    expect(winningCells(play([3, 3, 4, 4, 5]))).toBeNull();
  });

  it('does not call three in a row a win', () => {
    const board = play([0, 6, 1, 6, 2]);
    expect(winnerOf(board)).toBeNull();
  });

  it('calls a full board with no line a draw', () => {
    const board = boardFrom(DRAWN_BOARD);
    expect(board.every((cell) => cell !== null)).toBe(true);
    expect(winnerOf(board)).toBe('draw');
    expect(winningCells(board)).toBeNull();
  });

  it('prefers a line to a draw on a full board', () => {
    const board = boardFrom(DRAWN_BOARD);
    // Overwriting one cell completes a row; the board is still full either way.
    board[at(5, 0)] = 'p1';
    board[at(5, 1)] = 'p1';
    board[at(5, 2)] = 'p1';
    board[at(5, 3)] = 'p1';
    expect(winnerOf(board)).toBe('p1');
  });

  it('is a draw at the end of a legal game that fills the board', () => {
    const board = createBoard();
    let seat: SeatId = 'p1';
    for (const column of DRAWN_ORDER) {
      expect(applyDrop(board, column, seat)).toBeGreaterThanOrEqual(0);
      // Nothing may complete on the way either, or the round would have ended early.
      expect(winnerOf(board)).not.toBe(seat);
      seat = otherSeat(seat);
    }
    expect(DRAWN_ORDER).toHaveLength(CELL_COUNT);
    expect(winnerOf(board)).toBe('draw');
  });
});

describe('winningCellsInto', () => {
  it('writes the four indices without allocating and reports whether it did', () => {
    const out = [-1, -1, -1, -1];
    const won = createBoard();
    for (const index of [36, 37, 38, 39]) won[index] = 'p2';
    expect(winningCellsInto(won, out)).toBe(true);
    expect(out).toEqual([36, 37, 38, 39]);
    expect(out).toHaveLength(LINE_LENGTH);

    const untouched = [7, 7, 7, 7];
    expect(winningCellsInto(play([3, 3, 4]), untouched)).toBe(false);
    expect(untouched).toEqual([7, 7, 7, 7]);
  });
});

describe('bestColumn', () => {
  it('maps the difficulty tiers to the declared depths and blunder rates', () => {
    expect(SEARCH_DEPTH.easy).toBe(2);
    expect(SEARCH_DEPTH.normal).toBe(4);
    expect(SEARCH_DEPTH.hard).toBe(6);
    expect(BLUNDER_CHANCE.easy).toBeGreaterThan(0);
    expect(BLUNDER_CHANCE.normal).toBe(0);
    expect(BLUNDER_CHANCE.hard).toBe(0);
  });

  it('takes an immediate win along a row', () => {
    const board = boardFrom(`
      .......
      .......
      .......
      .......
      .....x.
      ooo..xx
    `);
    expect(bestColumn(board, 'p1', new Rng(11), 'hard')).toBe(3);
  });

  it('takes an immediate win up a column', () => {
    const board = boardFrom(`
      .......
      .......
      .......
      ..o....
      ..o..x.
      ..o..xx
    `);
    expect(bestColumn(board, 'p1', new Rng(12), 'hard')).toBe(2);
    // The same cell is the only block from the other side of the board.
    expect(bestColumn(board, 'p2', new Rng(12), 'hard')).toBe(2);
  });

  it('blocks an immediate loss along a row', () => {
    const board = boardFrom(`
      .......
      .......
      .......
      .......
      .....o.
      xxx..oo
    `);
    expect(bestColumn(board, 'p1', new Rng(13), 'hard')).toBe(3);
  });

  it('blocks an immediate loss up a column', () => {
    const board = boardFrom(`
      .......
      .......
      .......
      ....x..
      ....x..
      o.o.x.o
    `);
    expect(bestColumn(board, 'p1', new Rng(14), 'hard')).toBe(4);
  });

  it('prefers its own win to a block', () => {
    // p1 completes the bottom row this move; p2 would complete its column next.
    const board = boardFrom(`
      .......
      .......
      .......
      ......x
      ......x
      ooo...x
    `);
    expect(bestColumn(board, 'p1', new Rng(15), 'hard')).toBe(3);
  });

  it('opens near the centre, where a disc takes part in the most lines', () => {
    expect([2, 3, 4]).toContain(bestColumn(createBoard(), 'p1', new Rng(16), 'hard'));
  });

  it('returns -1 when there is nothing to play', () => {
    expect(bestColumn(boardFrom(DRAWN_BOARD), 'p1', new Rng(17), 'hard')).toBe(-1);
  });

  it('only ever plays a legal column, whatever the tier', () => {
    const rng = new Rng(31);
    for (const difficulty of TIERS) {
      const board = boardFrom(`
        x......
        o......
        x......
        o......
        x......
        o......
      `);
      const column = bestColumn(board, 'p1', rng, difficulty);
      expect(column).toBeGreaterThanOrEqual(0);
      expect(column).toBeLessThan(COLUMNS);
      expect(dropRow(board, column)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic for a given generator state', () => {
    const board = play([3, 3, 2]);
    const first: number[] = [];
    const second: number[] = [];
    const rngA = new Rng(99);
    const rngB = new Rng(99);
    for (let i = 0; i < 40; i += 1) {
      first.push(bestColumn(board, 'p1', rngA, 'easy'));
      second.push(bestColumn(board, 'p1', rngB, 'easy'));
    }
    expect(first).toEqual(second);
  });

  it('never deviates at hard, and sometimes does at easy', () => {
    const board = boardFrom(`
      .......
      .......
      .......
      .......
      .....x.
      ooo..xx
    `);
    const hardRng = new Rng(21);
    for (let i = 0; i < 60; i += 1) {
      expect(bestColumn(board, 'p1', hardRng, 'hard')).toBe(3);
    }

    const easyRng = new Rng(21);
    let deviations = 0;
    for (let i = 0; i < 200; i += 1) {
      const column = bestColumn(board, 'p1', easyRng, 'easy');
      expect(dropRow(board, column)).toBeGreaterThanOrEqual(0);
      if (column !== 3) deviations += 1;
    }
    expect(deviations).toBeGreaterThan(0);
  });

  it('takes an immediate win in every column, even against a threat of its own', () => {
    const rng = new Rng(7);
    for (let col = 0; col < COLUMNS; col += 1) {
      const board = createBoard();
      const rival = (col + 3) % COLUMNS;
      for (const row of [ROWS - 1, ROWS - 2, ROWS - 3]) {
        board[at(row, col)] = 'p1';
        board[at(row, rival)] = 'p2';
      }
      // p2 is one disc from its own line, so anything but winning now loses next move.
      expect(bestColumn(board, 'p1', rng, 'hard')).toBe(col);
    }
  });

  it('blocks an immediate loss in every column', () => {
    const rng = new Rng(8);
    for (let col = 0; col < COLUMNS; col += 1) {
      const board = createBoard();
      for (const row of [ROWS - 1, ROWS - 2, ROWS - 3]) board[at(row, col)] = 'p2';
      // p1's three discs sit apart on the floor, so it has no line of its own to take.
      let placed = 0;
      for (const own of [0, 2, 4, 6]) {
        if (own === col || placed === 3) continue;
        board[at(ROWS - 1, own)] = 'p1';
        placed += 1;
      }
      expect(bestColumn(board, 'p1', rng, 'hard')).toBe(col);
    }
  });
});
