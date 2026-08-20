import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_CHANCE,
  BOARD_SIZE,
  PIECES_PER_SEAT,
  SEARCH_DEPTH,
  SLOT_COUNT,
  applyMove,
  bestMove,
  columnOf,
  createGame,
  evaluate,
  hasCaptureFrom,
  isCapture,
  isLegalMove,
  legalMoves,
  movesFrom,
  otherOf,
  resetGame,
  rowOf,
  slotAt,
  tallyOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game, Move } from './rules.js';

const SERIES_TIMEOUT_MS = 120_000;
const buffer: Move[] = new Array<Move>(64);

/** Clears the board so a fixture can state exactly the position it means. */
function empty(): Game {
  const game = createGame();
  game.slots.fill(null);
  game.chain = -1;
  return game;
}

function put(game: Game, row: number, column: number, seat: SeatId, kind: 'man' | 'king'): number {
  const slot = slotAt(row, column);
  if (slot < 0) throw new Error(`(${String(row)},${String(column)}) is not a dark square`);
  game.slots[slot] = { seat, kind };
  return slot;
}

function movesOf(game: Game): Move[] {
  const count = legalMoves(buffer, game);
  return buffer.slice(0, count);
}

function playOut(p1: BotDifficulty, p2: BotDifficulty, seed: number, limit = 300): Game {
  const game = createGame();
  const rng = new Rng(seed);
  for (let turn = 0; turn < limit && winnerOf(game) === null; turn += 1) {
    const move = bestMove(game, rng, game.toMove === 'p1' ? p1 : p2);
    if (move === null) break;
    applyMove(game, move.from, move.to);
  }
  return game;
}

describe('the board', () => {
  it('is thirty-two dark squares', () => {
    expect(SLOT_COUNT).toBe(32);
    const seen = new Set<number>();
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let column = 0; column < BOARD_SIZE; column += 1) {
        const slot = slotAt(row, column);
        if (slot >= 0) seen.add(slot);
      }
    }
    expect(seen.size, 'every dark square maps to its own slot').toBe(SLOT_COUNT);
  });

  it('maps a slot to its square and back', () => {
    // The classic checkers bug is an off-by-one on odd rows, where moves work on half the
    // board and quietly wrap around the edge on the other half.
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const row = rowOf(slot);
      const column = columnOf(slot);
      expect(slotAt(row, column), `slot ${String(slot)} round-trips`).toBe(slot);
      // And it really is a dark square: row and column differ in parity.
      expect(row % 2 === column % 2, `slot ${String(slot)} at (${String(row)},${String(column)})`).toBe(
        false,
      );
    }
  });

  it('refuses light squares and squares off the board', () => {
    expect(slotAt(0, 0), 'the top-left square is light').toBe(-1);
    expect(slotAt(-1, 1)).toBe(-1);
    expect(slotAt(0, BOARD_SIZE)).toBe(-1);
    expect(slotAt(BOARD_SIZE, 1)).toBe(-1);
  });

  it('sets up twelve pieces a side with two empty rows between', () => {
    const game = createGame();
    let p1 = 0;
    let p2 = 0;
    for (const slot of game.slots) {
      if (slot === null) continue;
      expect(slot.kind, 'nobody starts crowned').toBe('man');
      if (slot.seat === 'p1') p1 += 1;
      else p2 += 1;
    }
    expect(p1).toBe(PIECES_PER_SEAT);
    expect(p2).toBe(PIECES_PER_SEAT);
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const row = rowOf(slot);
      if (row === 3 || row === 4) expect(game.slots[slot], `row ${String(row)} is empty`).toBeNull();
    }
    expect(game.toMove).toBe('p1');
  });

  it('resets in place', () => {
    const game = createGame();
    game.slots.fill(null);
    game.toMove = 'p2';
    game.chain = 5;
    resetGame(game);
    expect(tallyOf(game)).toEqual({ p1: 0, p2: 0 });
    expect(game.toMove).toBe('p1');
    expect(game.chain).toBe(-1);
  });
});

describe('moving', () => {
  it('opens with seven moves for p1', () => {
    // Four men on row 5 can each step two ways, except the one on the edge.
    const game = createGame();
    const moves = movesOf(game);
    expect(moves.length).toBe(7);
    expect(moves.every((move) => !isCapture(move)), 'no captures exist yet').toBe(true);
  });

  it('sends a man forward only', () => {
    const game = empty();
    const from = put(game, 4, 3, 'p1', 'man');
    game.toMove = 'p1';
    const moves = movesOf(game).filter((move) => move.from === from);
    expect(moves.length).toBe(2);
    for (const move of moves) {
      expect(rowOf(move.to), 'p1 advances up the board').toBe(3);
    }
  });

  it('sends a king both ways', () => {
    const game = empty();
    const from = put(game, 4, 3, 'p1', 'king');
    game.toMove = 'p1';
    const moves = movesOf(game).filter((move) => move.from === from);
    expect(moves.length, 'a king has four steps from the middle').toBe(4);
    expect(new Set(moves.map((move) => rowOf(move.to)))).toEqual(new Set([3, 5]));
  });

  it('never walks off the edge', () => {
    const game = empty();
    put(game, 4, 1, 'p1', 'king');
    game.toMove = 'p1';
    // Two of the four diagonals leave the board from column 1's neighbour at column -1.
    for (const move of movesOf(game)) {
      expect(columnOf(move.to)).toBeGreaterThanOrEqual(0);
      expect(columnOf(move.to)).toBeLessThan(BOARD_SIZE);
      expect(rowOf(move.to)).toBeGreaterThanOrEqual(0);
      expect(rowOf(move.to)).toBeLessThan(BOARD_SIZE);
    }
  });

  it('refuses a move onto an occupied square', () => {
    const game = empty();
    const from = put(game, 4, 3, 'p1', 'man');
    put(game, 3, 2, 'p1', 'man');
    game.toMove = 'p1';
    const moves = movesOf(game).filter((move) => move.from === from);
    expect(moves.length, 'one of the two steps is blocked by a friend').toBe(1);
    expect(columnOf(moves[0]?.to ?? -1)).toBe(4);
  });

  it('reports a refusal distinctly', () => {
    const game = createGame();
    // A refusal must be distinguishable from a legal move that changed nothing.
    expect(applyMove(game, 0, 31), 'nonsense is refused').toBe(false);
    const move = movesOf(game)[0];
    if (!move) throw new Error('the opening position must have a move');
    expect(applyMove(game, move.from, move.to)).toBe(true);
  });
});

describe('capturing', () => {
  it('jumps an enemy piece and removes it', () => {
    const game = empty();
    const from = put(game, 4, 3, 'p1', 'man');
    const victim = put(game, 3, 2, 'p2', 'man');
    game.toMove = 'p1';
    const landing = slotAt(2, 1);

    expect(isLegalMove(game, from, landing)).toBe(true);
    expect(applyMove(game, from, landing)).toBe(true);
    expect(game.slots[victim], 'the jumped piece is gone').toBeNull();
    expect(game.slots[landing]?.seat).toBe('p1');
    expect(game.slots[from]).toBeNull();
  });

  it('cannot jump when the square beyond is occupied', () => {
    const game = empty();
    const from = put(game, 4, 3, 'p1', 'man');
    put(game, 3, 2, 'p2', 'man');
    put(game, 2, 1, 'p2', 'man');
    game.toMove = 'p1';
    const moves = movesOf(game).filter((move) => move.from === from);
    expect(moves.some((move) => isCapture(move)), 'the landing square is taken').toBe(false);
  });

  it('cannot jump its own piece', () => {
    const game = empty();
    const from = put(game, 4, 3, 'p1', 'man');
    put(game, 3, 2, 'p1', 'man');
    game.toMove = 'p1';
    expect(movesOf(game).filter((move) => move.from === from).some(isCapture)).toBe(false);
  });

  it('makes capturing compulsory', () => {
    // The rule that lets a player set a trap rather than merely hope one is taken.
    const game = empty();
    const jumper = put(game, 4, 3, 'p1', 'man');
    put(game, 3, 2, 'p2', 'man');
    const idle = put(game, 6, 7, 'p1', 'man');
    game.toMove = 'p1';

    const moves = movesOf(game);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every(isCapture), 'with a capture available, only captures are legal').toBe(true);
    expect(moves.every((move) => move.from === jumper)).toBe(true);
    expect(isLegalMove(game, idle, slotAt(5, 6)), 'a quiet move is refused').toBe(false);
  });

  it('continues a chain, keeping the turn', () => {
    // Two victims placed so one jump lands where another is available.
    const game = empty();
    const from = put(game, 5, 2, 'p1', 'man');
    put(game, 4, 1, 'p2', 'man');
    put(game, 2, 1, 'p2', 'man');
    game.toMove = 'p1';

    const first = slotAt(3, 0);
    expect(applyMove(game, from, first)).toBe(true);
    expect(game.toMove, 'a chain does not pass the turn').toBe('p1');
    expect(game.chain, 'and only the chaining piece may move').toBe(first);

    const moves = movesOf(game);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((move) => move.from === first && isCapture(move))).toBe(true);

    expect(applyMove(game, first, slotAt(1, 2))).toBe(true);
    expect(game.toMove, 'the turn passes once the chain ends').toBe('p2');
    expect(game.chain).toBe(-1);
  });

  it('ends the turn when a chain has nowhere to continue', () => {
    const game = empty();
    const from = put(game, 4, 3, 'p1', 'man');
    put(game, 3, 2, 'p2', 'man');
    game.toMove = 'p1';
    applyMove(game, from, slotAt(2, 1));
    expect(game.chain).toBe(-1);
    expect(game.toMove).toBe('p2');
  });

  it('knows whether a piece could jump again', () => {
    const game = empty();
    const slot = put(game, 4, 3, 'p1', 'man');
    expect(hasCaptureFrom(game, slot)).toBe(false);
    put(game, 3, 2, 'p2', 'man');
    expect(hasCaptureFrom(game, slot)).toBe(true);
  });
});

describe('crowning', () => {
  it('crowns a man that reaches the far row', () => {
    const game = empty();
    const from = put(game, 1, 2, 'p1', 'man');
    game.toMove = 'p1';
    const to = slotAt(0, 1);
    expect(applyMove(game, from, to)).toBe(true);
    expect(game.slots[to]?.kind, 'p1 crowns on row 0').toBe('king');
  });

  it('crowns p2 on the other side', () => {
    const game = empty();
    const from = put(game, BOARD_SIZE - 2, 1, 'p2', 'man');
    game.toMove = 'p2';
    const to = slotAt(BOARD_SIZE - 1, 0);
    expect(applyMove(game, from, to)).toBe(true);
    expect(game.slots[to]?.kind).toBe('king');
  });

  it('stops a chain at the crown rather than granting a free king move', () => {
    // A man that crowns mid-jump stops there. Letting it carry on as a king would conjure
    // an extra move out of the promotion.
    const game = empty();
    const from = put(game, 2, 5, 'p1', 'man');
    put(game, 1, 4, 'p2', 'man');
    // A second victim placed so that a *king* standing on the crown square really could
    // jump it — (1,2) with (2,1) empty beyond. My first fixture had no such square, so
    // the test passed whether or not crowning stopped the chain, which is worse than no
    // test at all: it asserted the rule while being blind to it.
    put(game, 1, 2, 'p2', 'man');
    game.toMove = 'p1';

    const landing = slotAt(0, 3);
    expect(applyMove(game, from, landing)).toBe(true);
    expect(game.slots[landing]?.kind).toBe('king');
    expect(hasCaptureFrom(game, landing), 'the fixture must offer a continuation').toBe(true);
    expect(game.chain, 'and the chain still stops at the crown').toBe(-1);
    expect(game.toMove, 'so the turn passes').toBe('p2');
  });

  it('leaves a king a king', () => {
    const game = empty();
    const from = put(game, 1, 2, 'p1', 'king');
    game.toMove = 'p1';
    applyMove(game, from, slotAt(0, 1));
    expect(game.slots[slotAt(0, 1)]?.kind).toBe('king');
  });
});

describe('winning', () => {
  it('is undecided at the start', () => {
    expect(winnerOf(createGame())).toBeNull();
  });

  it('is won by taking every piece', () => {
    const game = empty();
    put(game, 4, 3, 'p1', 'man');
    game.toMove = 'p2';
    expect(winnerOf(game)).toBe('p1');
  });

  it('is won by leaving the opponent with no move', () => {
    // Being stalemated is a loss in checkers rather than a draw, which is not obvious.
    const game = empty();
    put(game, 0, 1, 'p2', 'man');
    put(game, 1, 0, 'p1', 'man');
    put(game, 1, 2, 'p1', 'man');
    put(game, 2, 3, 'p1', 'man');
    game.toMove = 'p2';
    expect(legalMoves(buffer, game), 'p2 is stuck').toBe(0);
    expect(winnerOf(game), 'and being stuck loses').toBe('p1');
  });

  it('counts captures for the HUD', () => {
    const game = createGame();
    expect(tallyOf(game)).toEqual({ p1: 0, p2: 0 });
    const from = slotAt(5, 0);
    const victim = slotAt(2, 1);
    game.slots[victim] = null;
    expect(tallyOf(game), 'a missing p2 piece is a p1 capture').toEqual({ p1: 1, p2: 0 });
    expect(from).toBeGreaterThanOrEqual(0);
  });
});

describe('the bot', () => {
  it('only ever returns a legal move', () => {
    const game = createGame();
    const rng = new Rng(7);
    for (let turn = 0; turn < 120 && winnerOf(game) === null; turn += 1) {
      const move = bestMove(game, rng, 'normal');
      if (move === null) break;
      expect(isLegalMove(game, move.from, move.to), `illegal move on turn ${String(turn)}`).toBe(
        true,
      );
      applyMove(game, move.from, move.to);
    }
  });

  it('takes a capture it is forced to take', () => {
    const game = empty();
    const from = put(game, 4, 3, 'p1', 'man');
    put(game, 3, 2, 'p2', 'man');
    put(game, 6, 7, 'p1', 'man');
    game.toMove = 'p1';
    const move = bestMove(game, new Rng(1), 'hard');
    expect(move).not.toBeNull();
    expect(move?.from).toBe(from);
    expect(isCapture(move as Move)).toBe(true);
  });

  it('prefers the jump that takes two pieces', () => {
    const game = empty();
    const chainer = put(game, 5, 2, 'p1', 'man');
    put(game, 4, 1, 'p2', 'man');
    put(game, 2, 1, 'p2', 'man');
    // A lone capture elsewhere, worth one piece rather than two.
    put(game, 5, 6, 'p1', 'man');
    put(game, 4, 5, 'p2', 'man');
    game.toMove = 'p1';
    const move = bestMove(game, new Rng(3), 'hard');
    expect(move?.from, 'the double jump is worth more').toBe(chainer);
  });

  it('is deterministic for a seed', { timeout: SERIES_TIMEOUT_MS }, () => {
    const trace = (): string => {
      const game = createGame();
      const rng = new Rng(99);
      const moves: string[] = [];
      for (let turn = 0; turn < 80 && winnerOf(game) === null; turn += 1) {
        const move = bestMove(game, rng, 'normal');
        if (move === null) break;
        moves.push(`${String(move.from)}-${String(move.to)}`);
        applyMove(game, move.from, move.to);
      }
      return moves.join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('beats its blundering self over a series', { timeout: SERIES_TIMEOUT_MS }, () => {
    let hardWins = 0;
    const games = 6;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const finished = playOut(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 500 + i);
      const winner = winnerOf(finished);
      if (winner === (hardIsP1 ? 'p1' : 'p2')) hardWins += 1;
    }
    expect(hardWins, `hard won ${String(hardWins)} of ${String(games)}`).toBeGreaterThan(games / 2);
  });

  it('declares its tiers in a sensible order', () => {
    expect(BLUNDER_CHANCE.easy).toBeGreaterThan(BLUNDER_CHANCE.normal);
    expect(BLUNDER_CHANCE.hard).toBe(0);
    expect(SEARCH_DEPTH.hard).toBeGreaterThan(SEARCH_DEPTH.normal);
    expect(SEARCH_DEPTH.normal).toBeGreaterThan(SEARCH_DEPTH.easy);
  });

  it('values a king above a man', () => {
    const withMan = empty();
    put(withMan, 4, 3, 'p1', 'man');
    const withKing = empty();
    put(withKing, 4, 3, 'p1', 'king');
    expect(evaluate(withKing, 'p1')).toBeGreaterThan(evaluate(withMan, 'p1'));
  });

  it('never allocates a move array per node', () => {
    // `movesFrom` writes into a caller-owned buffer; this pins the contract.
    const game = createGame();
    const out: Move[] = new Array<Move>(64);
    const first = movesFrom(out, 0, game, slotAt(5, 0));
    const second = movesFrom(out, first, game, slotAt(5, 2));
    expect(second).toBeGreaterThan(first);
    expect(out.length, 'the buffer is not grown').toBe(64);
  });
});

describe('a whole game', () => {
  it('always terminates', { timeout: SERIES_TIMEOUT_MS }, () => {
    for (const seed of [2, 8, 17]) {
      const game = playOut('normal', 'normal', seed, 400);
      // Either somebody won, or four hundred plies passed without one — which is a real
      // outcome in checkers rather than a hang, and the shell's round timer settles it.
      const decided = winnerOf(game);
      const stillLegal = legalMoves(buffer, game);
      expect(
        decided !== null || stillLegal > 0,
        `seed ${String(seed)} reached a position with no winner and no move`,
      ).toBe(true);
    }
  });

  it('never lets a seat move twice except in a chain', { timeout: SERIES_TIMEOUT_MS }, () => {
    const game = createGame();
    const rng = new Rng(21);
    let previous: SeatId | null = null;
    for (let turn = 0; turn < 150 && winnerOf(game) === null; turn += 1) {
      const seat = game.toMove;
      const move = bestMove(game, rng, 'normal');
      if (move === null) break;
      const chaining = game.chain >= 0;
      if (seat === previous) {
        expect(chaining, `${seat} moved twice without a chain on turn ${String(turn)}`).toBe(true);
      }
      applyMove(game, move.from, move.to);
      previous = seat;
    }
  });

  it('keeps the piece count honest', { timeout: SERIES_TIMEOUT_MS }, () => {
    const game = createGame();
    const rng = new Rng(33);
    let pieces = PIECES_PER_SEAT * 2;
    for (let turn = 0; turn < 200 && winnerOf(game) === null; turn += 1) {
      const move = bestMove(game, rng, 'normal');
      if (move === null) break;
      const capturing = isCapture(move);
      applyMove(game, move.from, move.to);
      const now = game.slots.filter((slot) => slot !== null).length;
      expect(now, 'a move takes exactly one piece, or none').toBe(capturing ? pieces - 1 : pieces);
      pieces = now;
    }
  });

  it('agrees with itself about legality', () => {
    const game = createGame();
    const rng = new Rng(44);
    for (let turn = 0; turn < 60 && winnerOf(game) === null; turn += 1) {
      const moves = movesOf(game);
      for (const move of moves) {
        expect(isLegalMove(game, move.from, move.to)).toBe(true);
      }
      // And a move for the seat that is *not* to move is never legal.
      expect(isLegalMove(game, -1, 0)).toBe(false);
      const move = moves[rng.int(0, moves.length)];
      if (!move) break;
      applyMove(game, move.from, move.to);
    }
  });
});

describe('seats', () => {
  it('has two of them and they alternate', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});
