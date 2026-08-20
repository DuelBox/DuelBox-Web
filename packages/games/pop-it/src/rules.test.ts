import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_CHANCE,
  BUBBLE_COUNT,
  ROW_COUNT,
  ROW_SIZES,
  applyMove,
  bestMove,
  bubblesLeft,
  createGame,
  isLegalMove,
  legalMoves,
  otherOf,
  resetGame,
  rowStart,
  segmentsOf,
  sizeOf,
  winnerOf,
  winsFromHere,
  winsFromSegments,
} from './rules.js';
import type { BotDifficulty, Game, Move } from './rules.js';

const moves: Move[] = new Array<Move>(BUBBLE_COUNT * 8);
const segments: number[] = new Array<number>(BUBBLE_COUNT).fill(0);

function runsOf(game: Game): number[] {
  const count = segmentsOf(game, segments);
  return segments.slice(0, count).sort((a, b) => a - b);
}

function playOut(p1: BotDifficulty, p2: BotDifficulty, seed: number): Game {
  const game = createGame();
  const rng = new Rng(seed);
  for (let turn = 0; turn < BUBBLE_COUNT + 5 && winnerOf(game) === null; turn += 1) {
    const move = bestMove(game, rng, game.toMove === 'p1' ? p1 : p2);
    if (move === null) break;
    applyMove(game, move.row, move.from, move.to);
  }
  return game;
}

describe('the sheet', () => {
  it('is five rows in a rounded shape', () => {
    expect(ROW_COUNT).toBe(5);
    expect([...ROW_SIZES]).toEqual([3, 4, 5, 4, 3]);
    expect(BUBBLE_COUNT).toBe(19);
  });

  it('lays the rows out end to end with no gaps or overlaps', () => {
    let expected = 0;
    for (let row = 0; row < ROW_COUNT; row += 1) {
      expect(rowStart(row), `row ${String(row)}`).toBe(expected);
      expected += sizeOf(row);
    }
    expect(expected).toBe(BUBBLE_COUNT);
  });

  it('starts with every bubble up', () => {
    const game = createGame();
    expect(bubblesLeft(game)).toBe(BUBBLE_COUNT);
    expect(game.toMove).toBe('p1');
  });

  it('resets in place', () => {
    const game = createGame();
    applyMove(game, 0, 0, 1);
    resetGame(game);
    expect(bubblesLeft(game)).toBe(BUBBLE_COUNT);
    expect(game.pressed).toEqual({ p1: 0, p2: 0 });
    expect(game.toMove).toBe('p1');
  });
});

describe('pressing', () => {
  it('presses a run and passes the turn', () => {
    const game = createGame();
    expect(applyMove(game, 2, 1, 3), 'three bubbles go down').toBe(3);
    expect(bubblesLeft(game)).toBe(BUBBLE_COUNT - 3);
    expect(game.pressed.p1).toBe(3);
    expect(game.toMove).toBe('p2');
  });

  it('refuses a run that crosses a bubble already down', () => {
    // "Consecutively" means the whole run must still be up.
    const game = createGame();
    applyMove(game, 2, 2, 2);
    expect(isLegalMove(game, 2, 1, 3), 'the middle is already down').toBe(false);
    expect(applyMove(game, 2, 1, 3), 'and a refusal is distinct').toBe(-1);
  });

  it('refuses a run off the end of a row', () => {
    const game = createGame();
    expect(isLegalMove(game, 0, 0, sizeOf(0))).toBe(false);
    expect(isLegalMove(game, ROW_COUNT, 0, 0)).toBe(false);
    expect(isLegalMove(game, 0, -1, 0)).toBe(false);
    expect(isLegalMove(game, 0, 2, 1), 'backwards is not a run').toBe(false);
  });

  it('offers every run in every row', () => {
    // A row of n has n(n+1)/2 runs, and the rows are 3,4,5,4,3.
    const game = createGame();
    const expected = ROW_SIZES.reduce((total, n) => total + (n * (n + 1)) / 2, 0);
    expect(legalMoves(moves, game)).toBe(expected);
  });

  it('splits a row in two when pressed in the middle', () => {
    // The reason a position is a bag of runs rather than a set of rows, and the reason
    // the game is deeper than it looks.
    const game = createGame();
    applyMove(game, 2, 2, 2);
    expect(runsOf(game)).toEqual([2, 2, 3, 3, 4, 4].sort((a, b) => a - b));
  });
});

describe('losing by pressing last', () => {
  it('is undecided while bubbles remain', () => {
    const game = createGame();
    applyMove(game, 0, 0, 2);
    expect(winnerOf(game)).toBeNull();
  });

  it('gives the win to whoever did not press last', () => {
    const game = createGame();
    // Clear everything but one bubble, then let p1 be forced to take it.
    game.popped.fill(true);
    game.popped[0] = false;
    game.toMove = 'p1';
    applyMove(game, 0, 0, 0);
    expect(bubblesLeft(game)).toBe(0);
    expect(winnerOf(game), 'p1 pressed the last one and lost').toBe('p2');
  });
});

describe('the exact solver', () => {
  it('knows the misère base cases', () => {
    expect(winsFromSegments([]), 'nothing left: the opponent pressed last').toBe(true);
    expect(winsFromSegments([1]), 'one bubble: you must take it and lose').toBe(false);
    expect(winsFromSegments([1, 1]), 'leave them the last one').toBe(true);
    expect(winsFromSegments([2]), 'press one, leave one').toBe(true);
  });

  it('does not care which row a run came from', () => {
    // Sorting the runs is what collapses the state space, and it is only sound because a
    // three and a five is the same game whichever rows they sat in.
    expect(winsFromSegments([3, 5])).toBe(winsFromSegments([5, 3]));
    expect(winsFromSegments([1, 2, 4])).toBe(winsFromSegments([4, 1, 2]));
  });

  it('agrees with a brute-force search on small positions', () => {
    // The solver is memoised and misère, both of which are easy to get subtly wrong, so
    // it is checked against a direct search that shares none of its code.
    const brute = (runs: number[]): boolean => {
      if (runs.length === 0) return true;
      for (let index = 0; index < runs.length; index += 1) {
        const length = runs[index] as number;
        for (let from = 0; from < length; from += 1) {
          for (let to = from; to < length; to += 1) {
            const next = runs.filter((_, i) => i !== index);
            if (from > 0) next.push(from);
            if (length - to - 1 > 0) next.push(length - to - 1);
            if (!brute(next)) return true;
          }
        }
      }
      return false;
    };
    // Every position up to five bubbles, plus a few larger ones. A shorter list let a
    // real bug through: a solver that dropped the *left* half of a split still agreed on
    // every position small enough that the left half was always empty.
    const positions: number[][] = [];
    for (let a = 1; a <= 5; a += 1) {
      positions.push([a]);
      for (let b = 1; b <= a; b += 1) {
        positions.push([a, b]);
        for (let c = 1; c <= b; c += 1) positions.push([a, b, c]);
      }
    }
    for (const runs of positions) {
      expect(winsFromSegments(runs), `runs ${runs.join('+')}`).toBe(brute(runs));
    }
  });

  it('reads the runs off a real board', () => {
    const game = createGame();
    applyMove(game, 2, 2, 2);
    expect(winsFromHere(game)).toBe(winsFromSegments(runsOf(game)));
  });
});

describe('the bot', () => {
  it('only ever returns a legal move', () => {
    const game = createGame();
    const rng = new Rng(3);
    for (let turn = 0; turn < BUBBLE_COUNT && winnerOf(game) === null; turn += 1) {
      const move = bestMove(game, rng, 'normal');
      if (move === null) break;
      expect(isLegalMove(game, move.row, move.from, move.to)).toBe(true);
      applyMove(game, move.row, move.from, move.to);
    }
  });

  it('refuses to take the last bubble when it has a choice', () => {
    // The whole misère point, and the mistake a person makes first.
    const game = createGame();
    game.popped.fill(true);
    game.popped[rowStart(0)] = false;
    game.popped[rowStart(0) + 1] = false;
    game.toMove = 'p1';
    const move = bestMove(game, new Rng(1), 'hard');
    expect(move).not.toBeNull();
    expect(move?.from, 'it presses exactly one, leaving one').toBe(move?.to);
  });

  it('never loses from a won position', () => {
    // It plays the solver's own answer, so this is a check that the two agree in practice
    // and not only in principle.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const game = createGame();
      const rng = new Rng(seed);
      // p1 is hard and the opening position is a win for the player to move.
      expect(winsFromHere(game), 'the full sheet is a win for whoever starts').toBe(true);
      let seat: SeatId = 'p1';
      for (let turn = 0; turn < BUBBLE_COUNT + 5 && winnerOf(game) === null; turn += 1) {
        const move = bestMove(game, rng, seat === 'p1' ? 'hard' : 'easy');
        if (move === null) break;
        applyMove(game, move.row, move.from, move.to);
        seat = otherOf(seat);
      }
      expect(winnerOf(game), `seed ${String(seed)}: the perfect player must win`).toBe('p1');
    }
  });

  it('beats its blundering self over a series', () => {
    let hardWins = 0;
    const games = 8;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const finished = playOut(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 200 + i);
      if (winnerOf(finished) === (hardIsP1 ? 'p1' : 'p2')) hardWins += 1;
    }
    expect(hardWins, `hard won ${String(hardWins)} of ${String(games)}`).toBeGreaterThan(games / 2);
  });

  it('is deterministic for a seed', () => {
    const trace = (): string => {
      const game = createGame();
      const rng = new Rng(77);
      const out: string[] = [];
      for (let turn = 0; turn < BUBBLE_COUNT && winnerOf(game) === null; turn += 1) {
        const move = bestMove(game, rng, 'normal');
        if (move === null) break;
        out.push(`${String(move.row)}:${String(move.from)}-${String(move.to)}`);
        applyMove(game, move.row, move.from, move.to);
      }
      return out.join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('declares its tiers in a sensible order', () => {
    expect(BLUNDER_CHANCE.easy).toBeGreaterThan(BLUNDER_CHANCE.normal);
    expect(BLUNDER_CHANCE.hard).toBe(0);
  });
});

describe('a whole game', () => {
  it('always ends, and every bubble is pressed by somebody', () => {
    for (const seed of [11, 22, 33]) {
      const game = playOut('normal', 'normal', seed);
      expect(winnerOf(game), `seed ${String(seed)}`).not.toBeNull();
      expect(game.pressed.p1 + game.pressed.p2).toBe(BUBBLE_COUNT);
    }
  });

  it('never leaves a seat with no move while bubbles remain', () => {
    const game = createGame();
    const rng = new Rng(9);
    for (let turn = 0; turn < BUBBLE_COUNT && winnerOf(game) === null; turn += 1) {
      expect(legalMoves(moves, game)).toBeGreaterThan(0);
      const move = bestMove(game, rng, 'normal');
      if (move === null) break;
      applyMove(game, move.row, move.from, move.to);
    }
  });
});
