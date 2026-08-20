import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_CHANCE,
  CELL_COUNT,
  COLUMNS,
  ROWS,
  SEARCH_DEPTH,
  applyMove,
  bestMove,
  capacityOf,
  columnOf,
  createGame,
  evaluate,
  indexOf,
  isLegalMove,
  legalMoves,
  neighboursOf,
  otherOf,
  ownerOfAll,
  resetGame,
  rowOf,
  tallyOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const SERIES_TIMEOUT_MS = 120_000;
const buffer: number[] = new Array<number>(CELL_COUNT).fill(0);

function put(game: Game, column: number, row: number, owner: SeatId | null, dots: number): number {
  const index = indexOf(column, row);
  const cell = game.cells[index];
  if (cell === undefined) throw new Error('no such cell');
  cell.owner = owner;
  cell.dots = dots;
  return index;
}

/** Marks both seats as having moved, so `winnerOf` is willing to decide. */
function bothHaveMoved(game: Game): void {
  game.moves.p1 = 1;
  game.moves.p2 = 1;
}

function playOut(p1: BotDifficulty, p2: BotDifficulty, seed: number, limit = 400): Game {
  const game = createGame();
  const rng = new Rng(seed);
  for (let turn = 0; turn < limit && winnerOf(game) === null; turn += 1) {
    const move = bestMove(game, game.toMove, rng, game.toMove === 'p1' ? p1 : p2);
    if (move < 0) break;
    applyMove(game, move, game.toMove);
  }
  return game;
}

describe('the grid', () => {
  it('is six by six', () => {
    expect(COLUMNS).toBe(6);
    expect(ROWS).toBe(6);
    expect(CELL_COUNT).toBe(36);
  });

  it('maps an index to a square and back', () => {
    for (let index = 0; index < CELL_COUNT; index += 1) {
      expect(indexOf(columnOf(index), rowOf(index))).toBe(index);
    }
  });

  it('bursts corners at two, edges at three and the middle at four', () => {
    // The single fact the whole game's geometry rests on, and the reason a corner is the
    // cheapest place to build a threat.
    expect(capacityOf(indexOf(0, 0)), 'a corner').toBe(2);
    expect(capacityOf(indexOf(COLUMNS - 1, ROWS - 1)), 'the far corner').toBe(2);
    expect(capacityOf(indexOf(1, 0)), 'a top edge').toBe(3);
    expect(capacityOf(indexOf(0, 2)), 'a left edge').toBe(3);
    expect(capacityOf(indexOf(2, 2)), 'the middle').toBe(4);
  });

  it('gives every cell exactly as many neighbours as its capacity', () => {
    const out: number[] = new Array<number>(4).fill(0);
    for (let index = 0; index < CELL_COUNT; index += 1) {
      expect(neighboursOf(out, index), `cell ${String(index)}`).toBe(capacityOf(index));
    }
  });

  it('never names a neighbour that wraps around an edge', () => {
    // The classic grid bug: cell 5 is the right-hand end of row 0, and cell 6 is the
    // left-hand end of row 1. They must not be neighbours.
    const out: number[] = new Array<number>(4).fill(0);
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const count = neighboursOf(out, index);
      for (let i = 0; i < count; i += 1) {
        const neighbour = out[i] as number;
        const sameRow = rowOf(neighbour) === rowOf(index);
        const sameColumn = columnOf(neighbour) === columnOf(index);
        expect(sameRow || sameColumn, `${String(index)} -> ${String(neighbour)}`).toBe(true);
        if (sameRow) expect(Math.abs(columnOf(neighbour) - columnOf(index))).toBe(1);
        else expect(Math.abs(rowOf(neighbour) - rowOf(index))).toBe(1);
      }
    }
  });

  it('starts empty, with p1 to move', () => {
    const game = createGame();
    expect(game.cells.every((cell) => cell.owner === null && cell.dots === 0)).toBe(true);
    expect(game.toMove).toBe('p1');
    expect(tallyOf(game)).toEqual({ p1: 0, p2: 0 });
  });

  it('resets in place', () => {
    const game = createGame();
    applyMove(game, 0, 'p1');
    resetGame(game);
    expect(game.cells.every((cell) => cell.dots === 0)).toBe(true);
    expect(game.moves).toEqual({ p1: 0, p2: 0 });
    expect(game.toMove).toBe('p1');
  });
});

describe('placing a dot', () => {
  it('is legal on an empty cell and on your own', () => {
    const game = createGame();
    expect(isLegalMove(game, 0, 'p1')).toBe(true);
    applyMove(game, 0, 'p1');
    expect(isLegalMove(game, 0, 'p1'), 'your own cell takes another dot').toBe(true);
  });

  it('is never legal on the opponent cell', () => {
    // The rule that makes a burst the only way to take ground.
    const game = createGame();
    const index = put(game, 2, 2, 'p2', 1);
    expect(isLegalMove(game, index, 'p1')).toBe(false);
    expect(applyMove(game, index, 'p1'), 'and a refusal is distinct from a quiet move').toBe(-1);
  });

  it('refuses an index off the board', () => {
    const game = createGame();
    for (const index of [-1, CELL_COUNT, 1.5, Number.NaN]) {
      expect(isLegalMove(game, index, 'p1'), String(index)).toBe(false);
      expect(applyMove(game, index, 'p1')).toBe(-1);
    }
  });

  it('adds a dot and passes the turn', () => {
    const game = createGame();
    const bursts = applyMove(game, indexOf(2, 2), 'p1');
    expect(bursts, 'one dot in the middle bursts nothing').toBe(0);
    expect(game.cells[indexOf(2, 2)]).toEqual({ owner: 'p1', dots: 1 });
    expect(game.toMove).toBe('p2');
    expect(game.moves.p1).toBe(1);
  });

  it('offers every empty cell plus your own', () => {
    const game = createGame();
    put(game, 0, 0, 'p2', 1);
    expect(legalMoves(buffer, game, 'p1')).toBe(CELL_COUNT - 1);
    expect(legalMoves(buffer, game, 'p2')).toBe(CELL_COUNT);
  });
});

describe('bursting', () => {
  it('bursts a corner at two dots and takes both neighbours', () => {
    const game = createGame();
    const corner = put(game, 0, 0, 'p1', 1);
    const bursts = applyMove(game, corner, 'p1');
    expect(bursts).toBe(1);
    expect(game.cells[corner], 'the cell empties completely').toEqual({ owner: null, dots: 0 });
    expect(game.cells[indexOf(1, 0)]).toEqual({ owner: 'p1', dots: 1 });
    expect(game.cells[indexOf(0, 1)]).toEqual({ owner: 'p1', dots: 1 });
  });

  it('turns the neighbours your colour, whoever held them', () => {
    // This is how ground changes hands: never by placing, only by bursting.
    const game = createGame();
    const corner = put(game, 0, 0, 'p1', 1);
    put(game, 1, 0, 'p2', 1);
    applyMove(game, corner, 'p1');
    expect(game.cells[indexOf(1, 0)]?.owner, 'captured by the burst').toBe('p1');
    expect(game.cells[indexOf(1, 0)]?.dots).toBe(2);
  });

  it('cascades when a burst pushes a neighbour over its own capacity', () => {
    const game = createGame();
    const corner = put(game, 0, 0, 'p1', 1);
    // Primed edge next door: one more dot and it goes too.
    put(game, 1, 0, 'p1', 2);
    const bursts = applyMove(game, corner, 'p1');
    expect(bursts, 'the corner and then the edge').toBeGreaterThanOrEqual(2);
    expect(game.cells[indexOf(2, 0)]?.owner, 'the cascade reached further along').toBe('p1');
  });

  it('spends everything rather than keeping a remainder', () => {
    // Leaving a dot behind would let one cell burst over and over from one placement.
    const game = createGame();
    const middle = put(game, 2, 2, 'p1', 3);
    applyMove(game, middle, 'p1');
    expect(game.cells[middle]?.dots).toBe(0);
    expect(game.cells[middle]?.owner).toBeNull();
  });

  it('stops a cascade once the opponent has nothing left', () => {
    // The guard against a won position cascading forever.
    const game = createGame();
    const corner = put(game, 0, 0, 'p1', 1);
    put(game, 1, 0, 'p1', 2);
    put(game, 2, 0, 'p1', 2);
    game.moves.p1 = 3;
    game.moves.p2 = 1;
    const bursts = applyMove(game, corner, 'p1');
    expect(bursts, 'it burst at least once').toBeGreaterThan(0);
    expect(bursts, 'and stopped rather than running on').toBeLessThan(CELL_COUNT);
    expect(corner).toBeGreaterThanOrEqual(0);
  });

  it('terminates even when the board is nearly all primed', () => {
    // A pathological position: every cell one dot from bursting, all one colour.
    const game = createGame();
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const cell = game.cells[index];
      if (cell === undefined) continue;
      cell.owner = 'p1';
      cell.dots = capacityOf(index) - 1;
    }
    // p2 must still hold something, or the cascade correctly stops the moment it has
    // nothing left to decide — which is the guard working, not the cascade failing.
    put(game, COLUMNS - 1, ROWS - 1, 'p2', 1);
    bothHaveMoved(game);
    const bursts = applyMove(game, indexOf(0, 0), 'p1');
    expect(bursts, 'it really did cascade').toBeGreaterThan(4);
    expect(Number.isFinite(bursts)).toBe(true);
  });
});

describe('winning', () => {
  it('is undecided before both seats have moved', () => {
    // Otherwise the game ends on the very first move, with the second player beaten
    // before they have touched anything.
    const game = createGame();
    applyMove(game, 0, 'p1');
    expect(tallyOf(game).p2, 'p2 holds nothing').toBe(0);
    expect(winnerOf(game), 'but has not had a turn').toBeNull();
  });

  it('is won by taking every cell', () => {
    const game = createGame();
    put(game, 0, 0, 'p1', 1);
    bothHaveMoved(game);
    expect(winnerOf(game)).toBe('p1');
  });

  it('is a draw only if the board somehow empties', () => {
    const game = createGame();
    bothHaveMoved(game);
    expect(winnerOf(game)).toBe('draw');
  });

  it('names the seat holding everything', () => {
    const game = createGame();
    expect(ownerOfAll(game), 'an empty board belongs to nobody').toBeNull();
    put(game, 0, 0, 'p1', 1);
    put(game, 1, 1, 'p1', 1);
    expect(ownerOfAll(game)).toBe('p1');
    put(game, 2, 2, 'p2', 1);
    expect(ownerOfAll(game)).toBeNull();
  });

  it('counts cells held for the HUD', () => {
    const game = createGame();
    put(game, 0, 0, 'p1', 2);
    put(game, 1, 1, 'p1', 1);
    put(game, 2, 2, 'p2', 3);
    expect(tallyOf(game), 'cells, not dots').toEqual({ p1: 2, p2: 1 });
  });
});

describe('the bot', () => {
  it('only ever returns a legal move', () => {
    const game = createGame();
    const rng = new Rng(4);
    for (let turn = 0; turn < 120 && winnerOf(game) === null; turn += 1) {
      const move = bestMove(game, game.toMove, rng, 'normal');
      if (move < 0) break;
      expect(isLegalMove(game, move, game.toMove), `turn ${String(turn)}`).toBe(true);
      applyMove(game, move, game.toMove);
    }
  });

  it('takes the burst that wins outright', () => {
    const game = createGame();
    // p1 has a primed corner; bursting it takes p2's only cell and ends the game.
    const corner = put(game, 0, 0, 'p1', 1);
    put(game, 1, 0, 'p2', 1);
    bothHaveMoved(game);
    game.toMove = 'p1';
    expect(bestMove(game, 'p1', new Rng(1), 'hard')).toBe(corner);
  });

  it('is deterministic for a seed', { timeout: SERIES_TIMEOUT_MS }, () => {
    const trace = (): string => {
      const game = createGame();
      const rng = new Rng(31);
      const moves: number[] = [];
      for (let turn = 0; turn < 60 && winnerOf(game) === null; turn += 1) {
        const move = bestMove(game, game.toMove, rng, 'normal');
        if (move < 0) break;
        moves.push(move);
        applyMove(game, move, game.toMove);
      }
      return moves.join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('beats its blundering self over a series', { timeout: SERIES_TIMEOUT_MS }, () => {
    let hardWins = 0;
    const games = 8;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const finished = playOut(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 900 + i);
      if (winnerOf(finished) === (hardIsP1 ? 'p1' : 'p2')) hardWins += 1;
    }
    expect(hardWins, `hard won ${String(hardWins)} of ${String(games)}`).toBeGreaterThan(games / 2);
  });

  it('declares its tiers in a sensible order', () => {
    expect(BLUNDER_CHANCE.easy).toBeGreaterThan(BLUNDER_CHANCE.normal);
    expect(BLUNDER_CHANCE.hard).toBe(0);
    expect(SEARCH_DEPTH.hard).toBeGreaterThan(SEARCH_DEPTH.easy);
  });

  it('sees a primed cell next to an enemy as worth something', () => {
    // The tactical texture of the game: a bot that only counts dots plays it like a
    // filling exercise.
    const plain = createGame();
    put(plain, 2, 2, 'p1', 3);
    put(plain, 4, 4, 'p2', 1);

    const threatening = createGame();
    put(threatening, 2, 2, 'p1', 3);
    put(threatening, 3, 2, 'p2', 1);

    expect(
      evaluate(threatening, 'p1'),
      'the same material, but primed against the enemy',
    ).toBeGreaterThan(evaluate(plain, 'p1'));
  });

  it('prefers a corner to the middle, all else equal', () => {
    const corner = createGame();
    put(corner, 0, 0, 'p1', 1);
    const middle = createGame();
    put(middle, 2, 2, 'p1', 1);
    expect(evaluate(corner, 'p1')).toBeGreaterThan(evaluate(middle, 'p1'));
  });
});

describe('a whole game', () => {
  it('finishes rather than running forever', { timeout: SERIES_TIMEOUT_MS }, () => {
    for (const seed of [3, 12, 40]) {
      const game = playOut('normal', 'normal', seed, 400);
      expect(winnerOf(game), `seed ${String(seed)} never finished`).not.toBeNull();
    }
  });

  it('alternates the seats', () => {
    const game = createGame();
    const rng = new Rng(6);
    let expected: SeatId = 'p1';
    for (let turn = 0; turn < 40 && winnerOf(game) === null; turn += 1) {
      expect(game.toMove).toBe(expected);
      const move = bestMove(game, game.toMove, rng, 'easy');
      if (move < 0) break;
      applyMove(game, move, game.toMove);
      expected = otherOf(expected);
    }
  });

  it('never leaves a seat with no legal move while it is live', () => {
    // You may always play into an empty cell or your own, so the only way to have nothing
    // is to hold nothing — which is losing, not being stuck.
    const game = createGame();
    const rng = new Rng(15);
    for (let turn = 0; turn < 120 && winnerOf(game) === null; turn += 1) {
      expect(legalMoves(buffer, game, game.toMove), `turn ${String(turn)}`).toBeGreaterThan(0);
      const move = bestMove(game, game.toMove, rng, 'normal');
      if (move < 0) break;
      applyMove(game, move, game.toMove);
    }
  });
});
