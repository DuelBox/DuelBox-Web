import { describe, expect, it } from 'vitest';
import { Rng, otherSeat } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_CHANCE,
  CELL_COUNT,
  applyMove,
  bestMove,
  createBoard,
  legalMoves,
  winnerOf,
  winningLine,
  winningLineInto,
} from './rules.js';
import type { Cell } from './rules.js';

/** 'o' is p1, 'x' is p2, anything else is empty. Nine characters, row-major. */
function boardFrom(spec: string): Cell[] {
  const board = createBoard();
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const glyph = spec[i];
    board[i] = glyph === 'o' ? 'p1' : glyph === 'x' ? 'p2' : null;
  }
  return board;
}

/** Written out rather than imported, so a wrong table in rules.ts cannot pass itself. */
const LINES: readonly (readonly number[])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const SEATS: readonly SeatId[] = ['p1', 'p2'];

describe('createBoard', () => {
  it('starts with nine empty cells', () => {
    const board = createBoard();
    expect(board).toHaveLength(CELL_COUNT);
    expect(board.every((cell) => cell === null)).toBe(true);
  });
});

describe('winnerOf', () => {
  for (const seat of SEATS) {
    for (const line of LINES) {
      it(`sees ${seat} holding ${line.join('-')}`, () => {
        const board = createBoard();
        for (const index of line) board[index] = seat;
        expect(winnerOf(board)).toBe(seat);
        expect(winningLine(board)).toEqual(line);
      });
    }
  }

  it('returns null while the board is still open', () => {
    expect(winnerOf(createBoard())).toBeNull();
    expect(winnerOf(boardFrom('ox.......'))).toBeNull();
    expect(winningLine(boardFrom('ox.......'))).toBeNull();
  });

  it('calls a full board with no line a draw', () => {
    const board = boardFrom('oxooxxxoo');
    expect(board.every((cell) => cell !== null)).toBe(true);
    expect(winnerOf(board)).toBe('draw');
    expect(winningLine(board)).toBeNull();
  });

  it('does not call a nearly full board a draw', () => {
    expect(winnerOf(boardFrom('oxooxxxo.'))).toBeNull();
  });
});

describe('winningLineInto', () => {
  it('writes the three indices without allocating and reports whether it did', () => {
    const out = [-1, -1, -1];
    expect(winningLineInto(boardFrom('ooo......'), out)).toBe(true);
    expect(out).toEqual([0, 1, 2]);

    const untouched = [7, 7, 7];
    expect(winningLineInto(boardFrom('ox.......'), untouched)).toBe(false);
    expect(untouched).toEqual([7, 7, 7]);
  });
});

describe('legalMoves', () => {
  it('returns the count and writes only that many entries', () => {
    const out = [9, 9, 9, 9, 9, 9, 9, 9, 9];
    const count = legalMoves(boardFrom('ox.......'), out);
    expect(count).toBe(7);
    expect(out.slice(0, count)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    // The buffer is never resized: the entry past the count is the caller's stale value.
    expect(out[7]).toBe(9);
    expect(out).toHaveLength(CELL_COUNT);
  });

  it('reports nine on an empty board and zero on a full one', () => {
    const out = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(legalMoves(createBoard(), out)).toBe(CELL_COUNT);
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(legalMoves(boardFrom('oxooxxxoo'), out)).toBe(0);
  });

  it('leaves the tail of an oversized buffer alone', () => {
    const out = [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
    expect(legalMoves(boardFrom('oxo......'), out)).toBe(6);
    expect(out).toHaveLength(12);
    expect(out[11]).toBe(-1);
  });
});

describe('applyMove', () => {
  it('claims an empty cell', () => {
    const board = createBoard();
    expect(applyMove(board, 4, 'p2')).toBe(true);
    expect(board[4]).toBe('p2');
  });

  it('refuses a taken cell and changes nothing', () => {
    const board = boardFrom('o........');
    expect(applyMove(board, 0, 'p2')).toBe(false);
    expect(board).toEqual(boardFrom('o........'));
  });

  it('refuses an index that is not a cell', () => {
    const board = boardFrom('o........');
    expect(applyMove(board, -1, 'p1')).toBe(false);
    expect(applyMove(board, CELL_COUNT, 'p1')).toBe(false);
    expect(applyMove(board, 1.5, 'p1')).toBe(false);
    expect(applyMove(board, Number.NaN, 'p1')).toBe(false);
    expect(board).toEqual(boardFrom('o........'));
  });
});

describe('bestMove', () => {
  it('maps the difficulty tiers to the declared blunder rates', () => {
    expect(BLUNDER_CHANCE.easy).toBe(0.45);
    expect(BLUNDER_CHANCE.normal).toBe(0.15);
    expect(BLUNDER_CHANCE.hard).toBe(0);
  });

  it('takes an immediate win', () => {
    // p1 completes 0-1-2; p2's two marks share no line, so nothing competes with it.
    const rng = new Rng(11);
    expect(bestMove(boardFrom('oo.x...x.'), 'p1', rng, BLUNDER_CHANCE.hard)).toBe(2);
  });

  it('prefers winning over blocking', () => {
    // p1 completes 0-1-2 this move; p2 would complete 3-4-5 next.
    const rng = new Rng(12);
    expect(bestMove(boardFrom('oo.xx....'), 'p1', rng, 0)).toBe(2);
  });

  it('blocks an immediate loss', () => {
    // p1 has no line of its own available; p2 completes 3-4-5 unless cell 5 is taken.
    const rng = new Rng(13);
    expect(bestMove(boardFrom('o..xx...o'), 'p1', rng, 0)).toBe(5);
  });

  it('returns -1 when there is nothing to play', () => {
    const rng = new Rng(14);
    expect(bestMove(boardFrom('oxooxxxoo'), 'p1', rng, 0)).toBe(-1);
  });

  it('is deterministic for a given generator state', () => {
    const board = boardFrom('o..x.....');
    const first: number[] = [];
    const second: number[] = [];
    const rngA = new Rng(99);
    const rngB = new Rng(99);
    for (let i = 0; i < 50; i += 1) {
      first.push(bestMove(board, 'p1', rngA, BLUNDER_CHANCE.easy));
      second.push(bestMove(board, 'p1', rngB, BLUNDER_CHANCE.easy));
    }
    expect(first).toEqual(second);
  });

  it('never deviates at hard, and sometimes does at easy', () => {
    const board = boardFrom('oo.xx....');
    const hardRng = new Rng(21);
    for (let i = 0; i < 100; i += 1) {
      expect(bestMove(board, 'p1', hardRng, BLUNDER_CHANCE.hard)).toBe(2);
    }

    const easyRng = new Rng(21);
    let deviations = 0;
    for (let i = 0; i < 200; i += 1) {
      const move = bestMove(board, 'p1', easyRng, BLUNDER_CHANCE.easy);
      expect(move).toBeGreaterThanOrEqual(0);
      expect(board[move]).toBeNull();
      if (move !== 2) deviations += 1;
    }
    expect(deviations).toBeGreaterThan(0);
  });

  it('only ever plays a legal move, whatever the tier', () => {
    const rng = new Rng(31);
    for (const chance of [BLUNDER_CHANCE.easy, BLUNDER_CHANCE.normal, BLUNDER_CHANCE.hard]) {
      const board = boardFrom('ox.o.x...');
      const move = bestMove(board, 'p1', rng, chance);
      expect(move).toBeGreaterThanOrEqual(0);
      expect(move).toBeLessThan(CELL_COUNT);
      expect(board[move]).toBeNull();
    }
  });
});

/**
 * Plays the perfect bot against every sequence the opponent can produce, and asserts the
 * bot is never the loser. This is the whole point of the hard tier: it may draw, but a
 * human must not be able to beat it, on any line, from either side of the first move.
 */
function assertNeverLoses(board: Cell[], botSeat: SeatId, toMove: SeatId, rng: Rng): void {
  const outcome = winnerOf(board);
  if (outcome !== null) {
    expect(outcome).not.toBe(otherSeat(botSeat));
    return;
  }

  if (toMove === botSeat) {
    const move = bestMove(board, botSeat, rng, BLUNDER_CHANCE.hard);
    expect(applyMove(board, move, botSeat)).toBe(true);
    assertNeverLoses(board, botSeat, otherSeat(botSeat), rng);
    board[move] = null;
    return;
  }

  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (board[i] !== null) continue;
    board[i] = toMove;
    assertNeverLoses(board, botSeat, botSeat, rng);
    board[i] = null;
  }
}

describe('the hard bot', () => {
  it('never loses when it moves first', () => {
    assertNeverLoses(createBoard(), 'p1', 'p1', new Rng(1));
  });

  it('never loses when it moves second', () => {
    assertNeverLoses(createBoard(), 'p2', 'p1', new Rng(2));
  });
});
