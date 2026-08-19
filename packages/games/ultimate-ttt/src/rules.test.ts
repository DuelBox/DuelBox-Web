import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_CHANCE,
  BOARD_COUNT,
  CELLS_PER_BOARD,
  CELL_COUNT,
  LINES,
  applyMove,
  bestMove,
  boardFull,
  boardOf,
  boardPlayable,
  cellIndex,
  cellOf,
  createGame,
  isLegalMove,
  legalMoves,
  lineWinner,
  otherOf,
  resetGame,
  tallyOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const SERIES_TIMEOUT_MS = 60_000;

/** Plays a whole game between two bots. */
function playOut(p1: BotDifficulty, p2: BotDifficulty, seed: number): Game {
  const game = createGame();
  const rng = new Rng(seed);
  let seat: SeatId = 'p1';
  for (let turn = 0; turn < CELL_COUNT + 10 && winnerOf(game) === null; turn += 1) {
    const move = bestMove(game, seat, rng, seat === 'p1' ? p1 : p2);
    if (move < 0) break;
    applyMove(game, move, seat);
    seat = otherOf(seat);
  }
  return game;
}

describe('the geometry', () => {
  it('is nine boards of nine cells', () => {
    expect(BOARD_COUNT).toBe(9);
    expect(CELLS_PER_BOARD).toBe(9);
    expect(CELL_COUNT).toBe(81);
  });

  it('maps every cell to exactly one board and back', () => {
    const seen = new Set<number>();
    for (let board = 0; board < BOARD_COUNT; board += 1) {
      for (let cell = 0; cell < CELLS_PER_BOARD; cell += 1) {
        const index = cellIndex(board, cell);
        expect(boardOf(index), `index ${String(index)}`).toBe(board);
        expect(cellOf(index)).toBe(cell);
        seen.add(index);
      }
    }
    expect(seen.size).toBe(CELL_COUNT);
  });

  it('has the eight lines of a three-by-three grid', () => {
    expect(LINES.length).toBe(8);
    // Every cell but the centre is in three lines; the centre is in four.
    const counts = new Array<number>(9).fill(0);
    for (const line of LINES) for (const cell of line) counts[cell] = (counts[cell] ?? 0) + 1;
    expect(counts[4], 'the centre sits on four lines').toBe(4);
    expect(counts[0]).toBe(3);
    expect(counts[1]).toBe(2);
  });
});

describe('the small boards', () => {
  it('start empty and undecided', () => {
    const game = createGame();
    expect(game.cells.every((cell) => cell === null)).toBe(true);
    expect(game.boards.every((result) => result === null)).toBe(true);
    expect(game.sentTo, 'the first move may be anywhere').toBe(-1);
  });

  it('are won by a line inside them', () => {
    const game = createGame();
    // p1 takes the top row of board 4, alternating so the sent-to rule stays satisfied.
    game.cells[cellIndex(4, 0)] = 'p1';
    game.cells[cellIndex(4, 1)] = 'p1';
    expect(game.boards[4]).toBeNull();
    applyMove(game, cellIndex(4, 2), 'p1');
    expect(game.boards[4], 'three in a row takes the small board').toBe('p1');
  });

  it('are drawn when full with no line', () => {
    const game = createGame();
    // A filled board with no three in a row.
    const pattern: SeatId[] = ['p1', 'p1', 'p2', 'p2', 'p2', 'p1', 'p1', 'p2', 'p1'];
    for (let i = 0; i < 8; i += 1) game.cells[cellIndex(0, i)] = pattern[i] as SeatId;
    applyMove(game, cellIndex(0, 8), pattern[8] as SeatId);
    expect(lineWinner(game.cells, 0), 'this pattern must have no line').toBeNull();
    expect(game.boards[0]).toBe('draw');
  });

  it('stop being playable once decided', () => {
    const game = createGame();
    game.boards[3] = 'p1';
    expect(boardPlayable(game, 3)).toBe(false);
    expect(isLegalMove(game, cellIndex(3, 0)), 'a decided board takes no more moves').toBe(false);
  });

  it('stop being playable once full', () => {
    const game = createGame();
    for (let i = 0; i < CELLS_PER_BOARD; i += 1) game.cells[cellIndex(2, i)] = 'p1';
    expect(boardFull(game, 2)).toBe(true);
    expect(boardPlayable(game, 2)).toBe(false);
  });
});

describe('where your move sends them', () => {
  it('sends the opponent to the board matching the cell played', () => {
    // The rule that makes this one game rather than nine.
    const game = createGame();
    applyMove(game, cellIndex(0, 5), 'p1');
    expect(game.sentTo).toBe(5);
    expect(isLegalMove(game, cellIndex(5, 0))).toBe(true);
    expect(isLegalMove(game, cellIndex(3, 0)), 'anywhere else is refused').toBe(false);
  });

  it('frees the choice when the sent-to board is already decided', () => {
    // Without this escape a player could be sent somewhere with no legal move and the
    // game would deadlock.
    const game = createGame();
    game.boards[5] = 'p1';
    applyMove(game, cellIndex(0, 5), 'p1');
    expect(game.sentTo, 'a decided destination frees the choice').toBe(-1);
    expect(isLegalMove(game, cellIndex(3, 0))).toBe(true);
  });

  it('frees the choice when the sent-to board is full', () => {
    const game = createGame();
    for (let i = 0; i < CELLS_PER_BOARD; i += 1) game.cells[cellIndex(7, i)] = 'p1';
    applyMove(game, cellIndex(0, 7), 'p2');
    expect(game.sentTo).toBe(-1);
  });

  it('never leaves a player with no legal move while the match is live', () => {
    // The property the escape exists for, checked across a whole real game.
    const game = createGame();
    const rng = new Rng(12);
    const buffer = new Array<number>(CELL_COUNT).fill(0);
    let seat: SeatId = 'p1';
    for (let turn = 0; turn < CELL_COUNT && winnerOf(game) === null; turn += 1) {
      expect(legalMoves(buffer, game), `turn ${String(turn)} had no legal move`).toBeGreaterThan(0);
      const move = bestMove(game, seat, rng, 'normal');
      applyMove(game, move, seat);
      seat = otherOf(seat);
    }
  });
});

describe('legality', () => {
  it('refuses an occupied cell', () => {
    const game = createGame();
    applyMove(game, cellIndex(0, 0), 'p1');
    expect(isLegalMove(game, cellIndex(0, 0))).toBe(false);
  });

  it('refuses a cell off the board', () => {
    const game = createGame();
    for (const index of [-1, CELL_COUNT, 1.5, Number.NaN]) {
      expect(isLegalMove(game, index), String(index)).toBe(false);
      expect(applyMove(game, index, 'p1')).toBe(false);
    }
  });

  it('reports a refusal distinctly', () => {
    const game = createGame();
    expect(applyMove(game, cellIndex(0, 0), 'p1')).toBe(true);
    expect(applyMove(game, cellIndex(0, 0), 'p2'), 'a refusal must be distinguishable').toBe(false);
  });

  it('resets in place', () => {
    const game = createGame();
    applyMove(game, cellIndex(0, 0), 'p1');
    resetGame(game);
    expect(game.cells.every((cell) => cell === null)).toBe(true);
    expect(game.sentTo).toBe(-1);
  });
});

describe('winning the match', () => {
  it('is not decided at the start', () => {
    expect(winnerOf(createGame())).toBeNull();
  });

  it('is won by three small boards in a line', () => {
    const game = createGame();
    game.boards[0] = 'p1';
    game.boards[1] = 'p1';
    expect(winnerOf(game)).toBeNull();
    game.boards[2] = 'p1';
    expect(winnerOf(game), 'a line of small boards takes the match').toBe('p1');
  });

  it('is decided on count when no line exists and nothing is playable', () => {
    const game = createGame();
    // Fill every board with a decided result and no line for either seat.
    const results: (SeatId | 'draw')[] = ['p1', 'p2', 'p1', 'p1', 'p2', 'p2', 'p2', 'p1', 'p1'];
    for (let i = 0; i < BOARD_COUNT; i += 1) game.boards[i] = results[i] ?? 'draw';
    expect(lineWinner(game.boards), 'this arrangement must have no line').toBeNull();
    expect(winnerOf(game)).toBe('p1');
  });

  it('draws on an equal count with no line', () => {
    const game = createGame();
    const results: (SeatId | 'draw')[] = [
      'p1',
      'p2',
      'draw',
      'p2',
      'p1',
      'draw',
      'draw',
      'draw',
      'draw',
    ];
    for (let i = 0; i < BOARD_COUNT; i += 1) game.boards[i] = results[i] ?? 'draw';
    expect(winnerOf(game)).toBe('draw');
  });

  it('counts small boards won for the HUD', () => {
    const game = createGame();
    game.boards[0] = 'p1';
    game.boards[4] = 'p1';
    game.boards[8] = 'p2';
    expect(tallyOf(game)).toEqual({ p1: 2, p2: 1 });
  });

  it('always terminates', { timeout: SERIES_TIMEOUT_MS }, () => {
    for (const seed of [1, 3, 9, 21]) {
      const game = playOut('normal', 'normal', seed);
      expect(winnerOf(game), `seed ${String(seed)} never finished`).not.toBeNull();
    }
  });
});

describe('the bot', () => {
  it('only ever returns a legal move', () => {
    const game = createGame();
    const rng = new Rng(6);
    let seat: SeatId = 'p1';
    for (let turn = 0; turn < CELL_COUNT && winnerOf(game) === null; turn += 1) {
      const move = bestMove(game, seat, rng, 'normal');
      expect(isLegalMove(game, move), `illegal move ${String(move)}`).toBe(true);
      applyMove(game, move, seat);
      seat = otherOf(seat);
    }
  });

  it('takes a small board when one move away from it', () => {
    const game = createGame();
    game.cells[cellIndex(4, 0)] = 'p1';
    game.cells[cellIndex(4, 1)] = 'p1';
    game.sentTo = 4;
    expect(bestMove(game, 'p1', new Rng(1), 'hard')).toBe(cellIndex(4, 2));
  });

  it('is deterministic for a seed', { timeout: SERIES_TIMEOUT_MS }, () => {
    const trace = (): string => {
      const game = createGame();
      const rng = new Rng(4321);
      const moves: number[] = [];
      let seat: SeatId = 'p1';
      for (let turn = 0; turn < CELL_COUNT && winnerOf(game) === null; turn += 1) {
        const move = bestMove(game, seat, rng, 'normal');
        if (move < 0) break;
        moves.push(move);
        applyMove(game, move, seat);
        seat = otherOf(seat);
      }
      return moves.join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('beats its blundering self over a series', { timeout: SERIES_TIMEOUT_MS }, () => {
    let hardWins = 0;
    const games = 8;
    for (let game = 0; game < games; game += 1) {
      const hardIsP1 = game % 2 === 0;
      const finished = playOut(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 700 + game);
      if (winnerOf(finished) === (hardIsP1 ? 'p1' : 'p2')) hardWins += 1;
    }
    expect(hardWins, `hard won ${String(hardWins)} of ${String(games)}`).toBeGreaterThan(games / 2);
  });

  it('declares its tiers in a sensible order', () => {
    expect(BLUNDER_CHANCE.easy).toBeGreaterThan(BLUNDER_CHANCE.normal);
    expect(BLUNDER_CHANCE.hard).toBe(0);
  });
});
