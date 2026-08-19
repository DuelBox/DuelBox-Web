import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_CHANCE,
  P1_STORE,
  P2_STORE,
  PITS_PER_SIDE,
  SLOT_COUNT,
  STONES_PER_PIT,
  bestMove,
  createBoard,
  firstPitOf,
  hasLegalMove,
  isLegalMove,
  isOver,
  legalMoves,
  oppositeOf,
  otherOf,
  ownsPit,
  resetBoard,
  sow,
  storeOf,
  sweepRemaining,
  tallyOf,
  totalStones,
  winnerOf,
} from './rules.js';
import type { Board, BotDifficulty } from './rules.js';

const TOTAL = PITS_PER_SIDE * 2 * STONES_PER_PIT;
const SERIES_TIMEOUT_MS = 60_000;

/** Plays a whole game between two bots, returning the finished board. */
function playOut(p1: BotDifficulty, p2: BotDifficulty, seed: number): Board {
  const board = createBoard();
  const rng = new Rng(seed);
  let seat: SeatId = 'p1';
  for (let turn = 0; turn < 500 && !isOver(board); turn += 1) {
    const move = bestMove(board, seat, rng, seat === 'p1' ? p1 : p2);
    if (move < 0) break;
    const result = sow(board, move, seat);
    if (!result.extraTurn) seat = otherOf(seat);
  }
  sweepRemaining(board);
  return board;
}

describe('the board', () => {
  it('lays out both sides and both stores', () => {
    expect(SLOT_COUNT).toBe(PITS_PER_SIDE * 2 + 2);
    expect(storeOf('p1')).toBe(P1_STORE);
    expect(storeOf('p2')).toBe(P2_STORE);
  });

  it('starts with every pit full and both stores empty', () => {
    const board = createBoard();
    expect(board[P1_STORE]).toBe(0);
    expect(board[P2_STORE]).toBe(0);
    expect(totalStones(board)).toBe(TOTAL);
  });

  it("gives each seat its own six pits and neither the other's", () => {
    for (let i = 0; i < PITS_PER_SIDE; i += 1) {
      expect(ownsPit('p1', firstPitOf('p1') + i)).toBe(true);
      expect(ownsPit('p2', firstPitOf('p1') + i)).toBe(false);
      expect(ownsPit('p2', firstPitOf('p2') + i)).toBe(true);
      expect(ownsPit('p1', firstPitOf('p2') + i)).toBe(false);
    }
  });

  it('never counts a store as a pit', () => {
    expect(ownsPit('p1', P1_STORE)).toBe(false);
    expect(ownsPit('p2', P2_STORE)).toBe(false);
  });

  it('pairs pits directly across the board', () => {
    // Opposite is its own inverse, and never maps a pit to a store.
    for (let i = 0; i < PITS_PER_SIDE; i += 1) {
      const slot = firstPitOf('p1') + i;
      const across = oppositeOf(slot);
      expect(oppositeOf(across), `slot ${String(slot)}`).toBe(slot);
      expect(ownsPit('p2', across)).toBe(true);
      expect(across).not.toBe(P1_STORE);
      expect(across).not.toBe(P2_STORE);
    }
  });

  it('resets in place', () => {
    const board = createBoard();
    sow(board, 0, 'p1');
    resetBoard(board);
    expect(totalStones(board)).toBe(TOTAL);
    expect(tallyOf(board)).toEqual({ p1: 0, p2: 0 });
  });
});

describe('sowing', () => {
  it('empties the chosen pit and drops one stone in each following slot', () => {
    const board = createBoard();
    sow(board, 0, 'p1');
    expect(board[0]).toBe(0);
    for (let i = 1; i <= STONES_PER_PIT; i += 1) {
      expect(board[i], `slot ${String(i)}`).toBe(STONES_PER_PIT + 1);
    }
  });

  it('drops a stone in your own store as it passes', () => {
    const board = createBoard();
    // Four stones from pit 2 land in slots 3, 4, 5 and 6 — and 6 is p1's store, so the
    // last one lands exactly there. Pit 3 would end in slot 7, which is p2's.
    const result = sow(board, 2, 'p1');
    expect(board[P1_STORE]).toBe(1);
    expect(result.extraTurn, 'landing in your own store grants another turn').toBe(true);
  });

  it("skips the opponent's store entirely", () => {
    // Thirteen stones from pit 0 travel the whole ring. Thirteen slots exist besides the
    // one being emptied, so with the opponent's store skipped the last stone lands back
    // in pit 0 — which is p1's own and now empty, so it captures. That capture is
    // correct; what matters here is that p2's store was never touched on the way round.
    const board: Board = new Array<number>(SLOT_COUNT).fill(0);
    board[0] = 13;
    sow(board, 0, 'p1');
    expect(board[P2_STORE], "you never add to your opponent's score").toBe(0);
    expect(board[P1_STORE], 'one stone passing, plus the capture it landed on').toBe(3);
  });

  it('conserves stones: nothing is created or lost', () => {
    const board = createBoard();
    const rng = new Rng(3);
    let seat: SeatId = 'p1';
    for (let i = 0; i < 200 && !isOver(board); i += 1) {
      const move = bestMove(board, seat, rng, 'normal');
      if (move < 0) break;
      const result = sow(board, move, seat);
      expect(totalStones(board), `after move ${String(i)}`).toBe(TOTAL);
      if (!result.extraTurn) seat = otherOf(seat);
    }
  });

  it('refuses an empty pit, one belonging to the other seat, and one off the board', () => {
    const board = createBoard();
    board[0] = 0;
    expect(isLegalMove(board, 0, 'p1')).toBe(false);
    expect(isLegalMove(board, firstPitOf('p2'), 'p1'), 'not your pit').toBe(false);
    expect(isLegalMove(board, P1_STORE, 'p1'), 'a store is not a pit').toBe(false);
    for (const slot of [-1, SLOT_COUNT, 1.5, Number.NaN]) {
      expect(isLegalMove(board, slot, 'p1'), String(slot)).toBe(false);
    }
  });

  it('reports a refusal distinctly from an unremarkable move', () => {
    const board = createBoard();
    const refused = sow(board, P1_STORE, 'p1');
    expect(refused.lastSlot, 'a refusal must be distinguishable').toBe(-1);
    const legal = sow(board, 0, 'p1');
    expect(legal.lastSlot).toBeGreaterThanOrEqual(0);
  });
});

describe('capturing', () => {
  it('takes the opposite pit when the last stone lands in an empty pit of your own', () => {
    const board: Board = new Array<number>(SLOT_COUNT).fill(0);
    // p1 sows one stone from pit 0 into pit 1, which is empty; pit 1's opposite holds 5.
    board[0] = 1;
    board[1] = 0;
    board[oppositeOf(1)] = 5;
    const result = sow(board, 0, 'p1');
    expect(result.captured, 'five taken plus the landing stone').toBe(6);
    expect(board[P1_STORE]).toBe(6);
    expect(board[1], 'the landing pit is emptied too').toBe(0);
    expect(board[oppositeOf(1)]).toBe(0);
  });

  it('does not capture when the opposite pit is empty', () => {
    const board: Board = new Array<number>(SLOT_COUNT).fill(0);
    board[0] = 1;
    board[1] = 0;
    board[oppositeOf(1)] = 0;
    const result = sow(board, 0, 'p1');
    expect(result.captured).toBe(0);
    expect(board[1], 'the stone simply stays where it landed').toBe(1);
  });

  it('does not capture when the landing pit already had stones', () => {
    const board: Board = new Array<number>(SLOT_COUNT).fill(0);
    board[0] = 1;
    board[1] = 3;
    board[oppositeOf(1)] = 5;
    const result = sow(board, 0, 'p1');
    expect(result.captured).toBe(0);
    expect(board[1]).toBe(4);
  });

  it("does not capture on the opponent's side", () => {
    // p1 sows past its own store and lands on an empty pit of p2's. Even though the pit
    // opposite holds stones, no capture happens: you may only capture into your own row.
    //
    // The pit sown from and the pit opposite the landing square must be different, or the
    // fixture contradicts itself — my first attempt set both, and slot 5 cannot hold two
    // stones and five at once.
    const board: Board = new Array<number>(SLOT_COUNT).fill(0);
    const theirPit = firstPitOf('p2') + 1;
    const across = oppositeOf(theirPit);
    board[P1_STORE - 1] = 3;
    board[theirPit] = 0;
    board[across] = 5;
    sow(board, P1_STORE - 1, 'p1');
    expect(board[across], "p1 may not capture from p2's side").toBe(5);
    expect(board[theirPit], 'the stone simply stays there').toBe(1);
  });

  it('conserves stones through a capture', () => {
    const board: Board = new Array<number>(SLOT_COUNT).fill(0);
    board[0] = 1;
    board[1] = 0;
    board[oppositeOf(1)] = 5;
    const before = totalStones(board);
    sow(board, 0, 'p1');
    expect(totalStones(board)).toBe(before);
  });
});

describe('the end of the game', () => {
  it('is not over at the start', () => {
    expect(isOver(createBoard())).toBe(false);
    expect(winnerOf(createBoard())).toBeNull();
  });

  it('ends when either side runs out, not when both do', () => {
    const board: Board = new Array<number>(SLOT_COUNT).fill(0);
    board[firstPitOf('p2')] = 3;
    expect(hasLegalMove(board, 'p1')).toBe(false);
    expect(hasLegalMove(board, 'p2')).toBe(true);
    expect(isOver(board), 'one side emptying ends it').toBe(true);
  });

  it('sweeps the remaining stones to their owner, so none are stranded', () => {
    // Missing this sweep is the classic Mancala bug: the game ends with stones on the
    // board and the score is simply wrong.
    const board: Board = new Array<number>(SLOT_COUNT).fill(0);
    board[firstPitOf('p2')] = 3;
    board[firstPitOf('p2') + 1] = 2;
    board[P1_STORE] = 10;
    sweepRemaining(board);
    expect(tallyOf(board)).toEqual({ p1: 10, p2: 5 });
    expect(totalStones(board)).toBe(15);
  });

  it('sweeps idempotently', () => {
    const board = createBoard();
    sweepRemaining(board);
    const first = tallyOf(board);
    sweepRemaining(board);
    expect(tallyOf(board)).toEqual(first);
  });

  it('accounts for every stone at the end of a real game', { timeout: SERIES_TIMEOUT_MS }, () => {
    for (const seed of [1, 2, 5, 11]) {
      const board = playOut('hard', 'normal', seed);
      const { p1, p2 } = tallyOf(board);
      expect(p1 + p2, `seed ${String(seed)} lost stones`).toBe(TOTAL);
      expect(winnerOf(board)).not.toBeNull();
    }
  });
});

describe('the extra turn', () => {
  it('is granted only by landing in your own store', () => {
    const board = createBoard();
    // Four stones from pit 2 reach the store exactly.
    expect(sow(board, 2, 'p1').extraTurn).toBe(true);
    resetBoard(board);
    expect(sow(board, 0, 'p1').extraTurn).toBe(false);
  });

  it("is never granted by the opponent's store, which is skipped", () => {
    const board: Board = new Array<number>(SLOT_COUNT).fill(0);
    board[0] = 13;
    expect(sow(board, 0, 'p1').extraTurn).toBe(false);
  });
});

describe('the bot', () => {
  it('only ever returns a legal move, or -1', () => {
    const board = createBoard();
    const rng = new Rng(8);
    let seat: SeatId = 'p1';
    for (let i = 0; i < 200 && !isOver(board); i += 1) {
      const move = bestMove(board, seat, rng, 'hard');
      if (move < 0) {
        expect(hasLegalMove(board, seat)).toBe(false);
        break;
      }
      expect(isLegalMove(board, move, seat), `illegal move ${String(move)}`).toBe(true);
      if (!sow(board, move, seat).extraTurn) seat = otherOf(seat);
    }
  });

  it('takes a free extra turn from the opening position', () => {
    // Pit 2 lands exactly in the store, which is strictly better than any alternative on
    // move one. A bot that misses it is not seeing the extra-turn rule at all.
    const board = createBoard();
    expect(bestMove(board, 'p1', new Rng(2), 'hard')).toBe(2);
  });

  it('is deterministic for a seed', { timeout: SERIES_TIMEOUT_MS }, () => {
    const trace = (): string => {
      const board = createBoard();
      const rng = new Rng(606);
      const moves: number[] = [];
      let seat: SeatId = 'p1';
      for (let i = 0; i < 300 && !isOver(board); i += 1) {
        const move = bestMove(board, seat, rng, 'normal');
        if (move < 0) break;
        moves.push(move);
        if (!sow(board, move, seat).extraTurn) seat = otherOf(seat);
      }
      return moves.join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('beats its blundering self over a series', { timeout: SERIES_TIMEOUT_MS }, () => {
    let hardWins = 0;
    const games = 10;
    for (let game = 0; game < games; game += 1) {
      const hardIsP1 = game % 2 === 0;
      const board = playOut(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 900 + game);
      if (winnerOf(board) === (hardIsP1 ? 'p1' : 'p2')) hardWins += 1;
    }
    expect(hardWins, `hard won ${String(hardWins)} of ${String(games)}`).toBeGreaterThan(games / 2);
  });

  it('declares its tiers in a sensible order', () => {
    expect(BLUNDER_CHANCE.easy).toBeGreaterThan(BLUNDER_CHANCE.normal);
    expect(BLUNDER_CHANCE.hard).toBe(0);
  });

  it('finds every legal move and no more', () => {
    const board = createBoard();
    const out = new Array<number>(PITS_PER_SIDE).fill(0);
    expect(legalMoves(out, board, 'p1')).toBe(PITS_PER_SIDE);
    board[0] = 0;
    expect(legalMoves(out, board, 'p1')).toBe(PITS_PER_SIDE - 1);
  });
});
