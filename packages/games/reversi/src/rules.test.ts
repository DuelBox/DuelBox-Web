import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_CHANCE,
  CELL_COUNT,
  COLUMNS,
  ROWS,
  applyMove,
  bestMove,
  createBoard,
  flipCount,
  hasLegalMove,
  indexOf,
  isLegalMove,
  isOver,
  legalMoves,
  otherOf,
  resetBoard,
  runLength,
  tallyOf,
  winnerOf,
} from './rules.js';
import type { Board, BotDifficulty, Cell } from './rules.js';

/** Plays a whole game between two bots, returning the finished board. */
function playOut(p1: BotDifficulty, p2: BotDifficulty, seed: number): Board {
  const board = createBoard();
  const rng = new Rng(seed);
  let seat: SeatId = 'p1';
  for (let turn = 0; turn < CELL_COUNT * 2 && !isOver(board); turn += 1) {
    const move = bestMove(board, seat, rng, seat === 'p1' ? p1 : p2);
    // -1 means this seat must pass, which is a legal position in Reversi.
    if (move >= 0) applyMove(board, move, seat);
    seat = otherOf(seat);
  }
  return board;
}

describe('the opening position', () => {
  it('places four pieces on the diagonals, not in blocks', () => {
    // Getting this the wrong way round mirrors every opening and is a classic bug.
    const board = createBoard();
    expect(board[indexOf(3, 3)]).toBe('p2');
    expect(board[indexOf(4, 4)]).toBe('p2');
    expect(board[indexOf(3, 4)]).toBe('p1');
    expect(board[indexOf(4, 3)]).toBe('p1');
    expect(tallyOf(board)).toEqual({ p1: 2, p2: 2 });
  });

  it('leaves every other square empty', () => {
    const board = createBoard();
    const occupied = board.filter((cell) => cell !== null).length;
    expect(occupied).toBe(4);
    expect(board.length).toBe(CELL_COUNT);
  });

  it('offers each seat exactly four opening moves', () => {
    // The standard Reversi opening. If this is not four, the flanking rule is wrong.
    const board = createBoard();
    const out = new Array<number>(CELL_COUNT).fill(0);
    expect(legalMoves(out, board, 'p1')).toBe(4);
    expect(legalMoves(out, board, 'p2')).toBe(4);
  });

  it('resets in place', () => {
    const board = createBoard();
    applyMove(board, indexOf(2, 3), 'p1');
    resetBoard(board);
    expect(tallyOf(board)).toEqual({ p1: 2, p2: 2 });
  });
});

describe('flanking', () => {
  it('refuses a move that flanks nothing', () => {
    const board = createBoard();
    // A corner flanks nothing from the opening position.
    expect(isLegalMove(board, indexOf(0, 0), 'p1')).toBe(false);
    expect(applyMove(board, indexOf(0, 0), 'p1')).toBe(-1);
  });

  it('refuses a square already occupied', () => {
    const board = createBoard();
    expect(isLegalMove(board, indexOf(3, 3), 'p1')).toBe(false);
  });

  it('refuses a square off the board', () => {
    const board = createBoard();
    for (const index of [-1, CELL_COUNT, 1.5, Number.NaN]) {
      expect(flipCount(board, index, 'p1')).toBe(0);
      expect(applyMove(board, index, 'p1')).toBe(-1);
    }
  });

  it('flips the run it flanks, and only that run', () => {
    const board = createBoard();
    // p1 at (3,2) flanks p2's piece at (3,3) against p1's own at (3,4).
    expect(applyMove(board, indexOf(3, 2), 'p1')).toBe(1);
    expect(board[indexOf(3, 3)]).toBe('p1');
    // The other p2 piece is untouched: it was not in a flanked run.
    expect(board[indexOf(4, 4)]).toBe('p2');
    expect(tallyOf(board)).toEqual({ p1: 4, p2: 1 });
  });

  it('does not count a run that runs off the board', () => {
    const board: Board = new Array<Cell>(CELL_COUNT).fill(null);
    // A row of p2 pieces reaching the edge with no p1 piece to terminate it.
    board[indexOf(1, 0)] = 'p2';
    board[indexOf(2, 0)] = 'p2';
    expect(runLength(board, indexOf(0, 0), 'p1', 1, 0)).toBe(0);
    expect(isLegalMove(board, indexOf(0, 0), 'p1')).toBe(false);
  });

  it('does not count a run broken by an empty square', () => {
    const board: Board = new Array<Cell>(CELL_COUNT).fill(null);
    board[indexOf(1, 0)] = 'p2';
    // Gap at (2,0).
    board[indexOf(3, 0)] = 'p1';
    expect(runLength(board, indexOf(0, 0), 'p1', 1, 0)).toBe(0);
  });

  it('flips in every direction at once when several are flanked', () => {
    const board: Board = new Array<Cell>(CELL_COUNT).fill(null);
    const centre = indexOf(4, 4);
    // p2 on three sides, each backed by a p1 piece: all three runs must flip.
    board[indexOf(3, 4)] = 'p2';
    board[indexOf(2, 4)] = 'p1';
    board[indexOf(4, 3)] = 'p2';
    board[indexOf(4, 2)] = 'p1';
    board[indexOf(3, 3)] = 'p2';
    board[indexOf(2, 2)] = 'p1';
    expect(applyMove(board, centre, 'p1')).toBe(3);
    expect(board[indexOf(3, 4)]).toBe('p1');
    expect(board[indexOf(4, 3)]).toBe('p1');
    expect(board[indexOf(3, 3)]).toBe('p1');
  });

  it('flips a run of several, not just the nearest', () => {
    const board: Board = new Array<Cell>(CELL_COUNT).fill(null);
    for (let column = 1; column <= 4; column += 1) board[indexOf(column, 0)] = 'p2';
    board[indexOf(5, 0)] = 'p1';
    expect(applyMove(board, indexOf(0, 0), 'p1')).toBe(4);
    for (let column = 1; column <= 4; column += 1) {
      expect(board[indexOf(column, 0)]).toBe('p1');
    }
  });

  it('never returns 0 for a legal move, so 0 can only mean refused', () => {
    const board = createBoard();
    const out = new Array<number>(CELL_COUNT).fill(0);
    const count = legalMoves(out, board, 'p1');
    for (let i = 0; i < count; i += 1) {
      expect(flipCount(board, out[i] as number, 'p1')).toBeGreaterThan(0);
    }
  });
});

describe('the end of the game', () => {
  it('is not over at the start', () => {
    expect(isOver(createBoard())).toBe(false);
    expect(winnerOf(createBoard())).toBeNull();
  });

  it('ends when neither seat can move, which is not the same as a full board', () => {
    // One colour wiped out: the board is nearly empty and the game is over.
    const board: Board = new Array<Cell>(CELL_COUNT).fill(null);
    board[indexOf(0, 0)] = 'p1';
    expect(hasLegalMove(board, 'p1')).toBe(false);
    expect(hasLegalMove(board, 'p2')).toBe(false);
    expect(isOver(board)).toBe(true);
    expect(winnerOf(board)).toBe('p1');
  });

  it('calls an equal finished board a draw', () => {
    const board: Board = new Array<Cell>(CELL_COUNT).fill(null);
    board[indexOf(0, 0)] = 'p1';
    board[indexOf(7, 7)] = 'p2';
    expect(isOver(board)).toBe(true);
    expect(winnerOf(board)).toBe('draw');
  });

  it('always terminates, and every piece belongs to someone', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const board = playOut('hard', 'normal', seed);
      expect(isOver(board), `seed ${String(seed)} never finished`).toBe(true);
      const { p1, p2 } = tallyOf(board);
      const occupied = board.filter((cell) => cell !== null).length;
      expect(p1 + p2).toBe(occupied);
      expect(winnerOf(board)).not.toBeNull();
    }
  });
});

describe('passing', () => {
  it('is a real position rather than an error', () => {
    // A board of p1 with one empty corner and a single p2 in the far corner. p1 cannot
    // play the empty square — every neighbour is its own colour, so there is no run to
    // flank — while p2 can, flanking the whole diagonal. p1 must pass and play continues.
    //
    // My first attempt at this fixture was wrong in the other direction: p1 *could* move,
    // because a run of p2 pieces terminated by a p1 piece is exactly what makes a move
    // legal, and the position I built had one.
    const board: Board = new Array<Cell>(CELL_COUNT).fill('p1');
    board[indexOf(0, 0)] = null;
    board[indexOf(7, 7)] = 'p2';

    expect(hasLegalMove(board, 'p1'), 'p1 should have no move').toBe(false);
    expect(hasLegalMove(board, 'p2'), 'p2 should be able to take the corner').toBe(true);
    expect(isOver(board), 'one seat passing does not end the game').toBe(false);
    expect(bestMove(board, 'p1', new Rng(1), 'hard')).toBe(-1);
  });

  it('ends the game only when both seats must pass', () => {
    const board: Board = new Array<Cell>(CELL_COUNT).fill(null);
    // Two lone pieces, nowhere near each other: neither can flank anything.
    board[indexOf(0, 0)] = 'p1';
    board[indexOf(7, 7)] = 'p2';
    expect(hasLegalMove(board, 'p1')).toBe(false);
    expect(hasLegalMove(board, 'p2')).toBe(false);
    expect(isOver(board)).toBe(true);
  });
});

describe('the bot', () => {
  it('only ever returns a legal move, or -1 to pass', () => {
    const board = createBoard();
    const rng = new Rng(5);
    let seat: SeatId = 'p1';
    for (let turn = 0; turn < 80 && !isOver(board); turn += 1) {
      const move = bestMove(board, seat, rng, 'hard');
      if (move >= 0) {
        expect(isLegalMove(board, move, seat), `illegal move ${String(move)}`).toBe(true);
        applyMove(board, move, seat);
      } else {
        expect(hasLegalMove(board, seat), 'passed with a move available').toBe(false);
      }
      seat = otherOf(seat);
    }
  });

  it('takes a corner when one is offered', () => {
    // Corners can never be flipped, so a bot that does not take a free one is not
    // playing Reversi.
    const board: Board = new Array<Cell>(CELL_COUNT).fill(null);
    board[indexOf(1, 0)] = 'p2';
    board[indexOf(2, 0)] = 'p1';
    // Also offer a mediocre alternative elsewhere.
    board[indexOf(4, 4)] = 'p2';
    board[indexOf(4, 5)] = 'p1';
    expect(bestMove(board, 'p1', new Rng(2), 'hard')).toBe(indexOf(0, 0));
  });

  it('is deterministic for a seed', () => {
    const trace = (): string => {
      const board = createBoard();
      const rng = new Rng(808);
      const moves: number[] = [];
      let seat: SeatId = 'p1';
      for (let turn = 0; turn < 80 && !isOver(board); turn += 1) {
        const move = bestMove(board, seat, rng, 'normal');
        moves.push(move);
        if (move >= 0) applyMove(board, move, seat);
        seat = otherOf(seat);
      }
      return moves.join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('beats its blundering self over a series', () => {
    // The tiers must differ in strength, or difficulty is a label rather than a setting.
    let hardWins = 0;
    const games = 10;
    for (let game = 0; game < games; game += 1) {
      // Alternate which seat the strong bot plays, so a first-move advantage cannot
      // account for the result.
      const hardIsP1 = game % 2 === 0;
      const board = playOut(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 500 + game);
      const winner = winnerOf(board);
      if (winner === (hardIsP1 ? 'p1' : 'p2')) hardWins += 1;
    }
    expect(hardWins, `hard won ${String(hardWins)} of ${String(games)}`).toBeGreaterThan(games / 2);
  });

  it('blunders at the declared rate on the easy tier', () => {
    expect(BLUNDER_CHANCE.easy).toBeGreaterThan(BLUNDER_CHANCE.normal);
    expect(BLUNDER_CHANCE.normal).toBeGreaterThan(BLUNDER_CHANCE.hard);
    expect(BLUNDER_CHANCE.hard).toBe(0);
  });
});

describe('the geometry', () => {
  it('is an 8x8 board', () => {
    expect(COLUMNS).toBe(8);
    expect(ROWS).toBe(8);
    expect(CELL_COUNT).toBe(64);
  });

  it('indexes every square exactly once', () => {
    const seen = new Set<number>();
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) seen.add(indexOf(column, row));
    }
    expect(seen.size).toBe(CELL_COUNT);
  });
});
