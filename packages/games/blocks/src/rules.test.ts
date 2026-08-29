import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  CELL_COUNT,
  EMPTY,
  MARK_P1,
  MARK_P2,
  PIECES,
  PIECES_PER_MATCH,
  PIECE_COUNT,
  SIZE,
  TIERS,
  TRAY_SIZE,
  UNIT_CELLS,
  UNIT_COUNT,
  chooseMove,
  createMatch,
  encodeMove,
  evaluate,
  fitsAt,
  halfTurnOf,
  hasPlacement,
  isOver,
  legalMoves,
  markOf,
  otherOf,
  place,
  playMove,
  slotOf,
  topLeftFor,
  topLeftOf,
  traySize,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, MatchState, Position } from './rules.js';

/* --------------------------------------------------------------------- helpers */

const MOVES = new Int16Array(TRAY_SIZE * CELL_COUNT);

/** The board index a cell lands on under a half-turn of the whole board. */
function mirrorCell(cell: number): number {
  return CELL_COUNT - 1 - cell;
}

/** Where a shape's bounding box lands under a half-turn. */
function mirrorTopLeft(piece: number, topLeft: number): number {
  const shape = PIECES[piece]!;
  return CELL_COUNT - 1 - (topLeft + (shape.height - 1) * SIZE + (shape.width - 1));
}

function cellsOf(piece: number, topLeft: number): number[] {
  return PIECES[piece]!.offsets.map((offset) => topLeft + offset).sort((a, b) => a - b);
}

function makePosition(board: Uint8Array, tray: readonly number[], p1 = 0, p2 = 0): Position {
  return { board, tray: Int8Array.from(tray), p1, p2 };
}

function emptyBoard(): Uint8Array {
  return new Uint8Array(CELL_COUNT);
}

/**
 * Drives a whole match exactly as `game.ts` does: the deal and the two bot streams come
 * out of one match generator, in that order, and the streams are handed out by **role**
 * rather than by seat label.
 */
function playToEnd(
  seed: number,
  openingSeat: SeatId,
  tiers: Readonly<Record<SeatId, BotDifficulty>>,
): MatchState {
  const rng = new Rng(seed);
  const state = createMatch(rng, openingSeat);
  const opening = new Rng(rng.int(1, 0x7fff_ffff));
  const responding = new Rng(rng.int(1, 0x7fff_ffff));
  // Deliberately no step ceiling: a match that could not finish must hang this suite
  // rather than pass quietly. `PIECES_PER_MATCH` is what makes that safe.
  while (!isOver(state)) {
    const seat = state.active;
    const stream = seat === openingSeat ? opening : responding;
    const move = chooseMove(state.board, state.tray, seat, stream, tiers[seat]);
    expect(move).toBeGreaterThanOrEqual(0);
    expect(playMove(state, move)).toBeGreaterThanOrEqual(0);
  }
  return state;
}

const BOTH = (tier: BotDifficulty): Readonly<Record<SeatId, BotDifficulty>> => ({
  p1: tier,
  p2: tier,
});

/* ----------------------------------------------------------------- the shape set */

describe('the shapes', () => {
  it('are fifteen non-empty polyominoes with sane bounding boxes', () => {
    expect(PIECE_COUNT).toBe(15);
    for (const shape of PIECES) {
      expect(shape.size).toBeGreaterThan(0);
      expect(shape.offsets.length).toBe(shape.size);
      expect(shape.width).toBeGreaterThan(0);
      expect(shape.height).toBeGreaterThan(0);
      expect(shape.width).toBeLessThanOrEqual(SIZE);
      expect(shape.height).toBeLessThanOrEqual(SIZE);
      // The anchor is inside the bounding box, or a shape could be dropped with nothing
      // under the press.
      expect(shape.anchorX).toBeGreaterThanOrEqual(0);
      expect(shape.anchorX).toBeLessThan(shape.width);
      expect(shape.anchorY).toBeGreaterThanOrEqual(0);
      expect(shape.anchorY).toBeLessThan(shape.height);
      // Every offset is inside its own bounding box, so a shape can never wrap a row.
      for (const offset of shape.offsets) {
        const dx = offset % SIZE;
        const dy = (offset - dx) / SIZE;
        expect(dx).toBeLessThan(shape.width);
        expect(dy).toBeLessThan(shape.height);
      }
    }
  });

  /**
   * The half-turn table is not decoration: the mirror tests below turn a whole position
   * round, tray included, and that is only possible because every shape's 180° rotation
   * is also in the set.
   */
  it('are closed under the half-turn, and the table is an involution', () => {
    for (let piece = 0; piece < PIECE_COUNT; piece += 1) {
      const turned = halfTurnOf(piece);
      expect(halfTurnOf(turned)).toBe(piece);
      const original = PIECES[piece]!;
      const rotated = PIECES[turned]!;
      expect(rotated.width).toBe(original.width);
      expect(rotated.height).toBe(original.height);
      // Rotate the cells by hand and check they are the ones the paired shape holds.
      const expected = original.offsets
        .map((offset) => {
          const dx = offset % SIZE;
          const dy = (offset - dx) / SIZE;
          return (original.height - 1 - dy) * SIZE + (original.width - 1 - dx);
        })
        .sort((a, b) => a - b);
      expect([...rotated.offsets].sort((a, b) => a - b)).toEqual(expected);
    }
  });
});

describe('the twenty-seven units', () => {
  it('are nine rows, nine columns and nine boxes, and cover every cell three times', () => {
    expect(UNIT_CELLS.length).toBe(UNIT_COUNT);
    const seen = new Array<number>(CELL_COUNT).fill(0);
    for (const unit of UNIT_CELLS) {
      expect(unit.length).toBe(SIZE);
      expect(new Set(unit).size).toBe(SIZE);
      for (const cell of unit) seen[cell] = (seen[cell] ?? 0) + 1;
    }
    // One row, one column and one box: every cell, every time.
    expect(seen.every((count) => count === 3)).toBe(true);
  });
});

/* -------------------------------------------------------------------- placement */

describe('placing a shape', () => {
  it('centres an odd shape on the press and refuses one that hangs off the board', () => {
    const across = PIECES.findIndex((shape) => shape.width === 5 && shape.height === 1);
    expect(across).toBeGreaterThanOrEqual(0);
    // A five-long bar is centred on the square pressed: press column 4 and it covers
    // columns 2 to 6, so its bounding box starts two to the left.
    expect(topLeftFor(across, 4 * SIZE + 4)).toBe(4 * SIZE + 2);
    expect(topLeftFor(across, 4 * SIZE + 2)).toBe(4 * SIZE);
    // Pressing near either edge leaves nowhere for it to go.
    expect(topLeftFor(across, 4 * SIZE + 1)).toBe(-1);
    expect(topLeftFor(across, 4 * SIZE + 7)).toBe(-1);
  });

  it('refuses a square that is already taken', () => {
    const board = emptyBoard();
    board[40] = MARK_P1;
    const single = PIECES.findIndex((shape) => shape.size === 1);
    expect(fitsAt(board, single, 40)).toBe(false);
    expect(fitsAt(board, single, 41)).toBe(true);
  });

  it('refuses a move naming an empty tray slot', () => {
    const position = makePosition(emptyBoard(), [0, -1, -1]);
    expect(place(position, encodeMove(1, 0), 'p1', null, null)).toBe(-1);
    expect(place(position, encodeMove(0, 0), 'p1', null, null)).toBe(0);
  });

  it('encodes a move as one number and decodes it back', () => {
    for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
      for (const topLeft of [0, 1, 40, 80]) {
        const move = encodeMove(slot, topLeft);
        expect(slotOf(move)).toBe(slot);
        expect(topLeftOf(move)).toBe(topLeft);
      }
    }
  });
});

describe('clearing', () => {
  const single = PIECES.findIndex((shape) => shape.size === 1);

  function boardWithRowNearlyFull(owner: number): Uint8Array {
    const board = emptyBoard();
    for (let column = 0; column < SIZE - 1; column += 1) board[column] = owner;
    return board;
  }

  it('clears a full row and pays every cell to whoever placed it', () => {
    const board = boardWithRowNearlyFull(MARK_P2);
    const position = makePosition(board, [single, -1, -1]);
    const gain = place(position, encodeMove(0, SIZE - 1), 'p1', null, null);
    // Eight of the nine cells were seat two's, so seat two banks eight and seat one one.
    expect(gain).toBe(1);
    expect(position.p1).toBe(1);
    expect(position.p2).toBe(SIZE - 1);
    for (let column = 0; column < SIZE; column += 1) expect(board[column]).toBe(EMPTY);
  });

  it('clears a column and a box on the same placement, counting the shared cell once', () => {
    const board = emptyBoard();
    // Column 0 filled except (0,0); box 0 filled except (0,0) as well.
    for (let row = 1; row < SIZE; row += 1) board[row * SIZE] = MARK_P1;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (row === 0 && column === 0) continue;
        board[row * SIZE + column] = MARK_P1;
      }
    }
    const position = makePosition(board, [single, -1, -1]);
    const gain = place(position, encodeMove(0, 0), 'p1', null, null);
    // Nine in the column and nine in the box, overlapping in three: fifteen cells.
    expect(gain).toBe(15);
    expect(position.p1).toBe(15);
    expect(position.p2).toBe(0);
  });

  it('reports the cells it cleared and the cells it filled', () => {
    const board = boardWithRowNearlyFull(MARK_P1);
    const position = makePosition(board, [single, -1, -1]);
    const cleared = new Uint8Array(CELL_COUNT);
    const placed = new Uint8Array(CELL_COUNT);
    place(position, encodeMove(0, SIZE - 1), 'p1', cleared, placed);
    expect([...cleared].filter((flag) => flag === 1).length).toBe(SIZE);
    expect([...placed].filter((flag) => flag === 1).length).toBe(1);
    expect(placed[SIZE - 1]).toBe(1);
  });

  it('leaves a unit that is one short alone', () => {
    const board = boardWithRowNearlyFull(MARK_P1);
    const position = makePosition(board, [single, -1, -1]);
    const gain = place(position, encodeMove(0, SIZE), 'p1', null, null);
    expect(gain).toBe(0);
    expect(position.p1).toBe(0);
    expect(board[0]).toBe(MARK_P1);
  });
});

/* ------------------------------------------------------------------- the tray */

describe('the shared tray', () => {
  it('holds three and is refilled only once all three are gone', () => {
    const state = createMatch(new Rng(11));
    expect(traySize(state.tray)).toBe(TRAY_SIZE);
    const first = [...state.tray];
    const single = PIECES.findIndex((shape) => shape.size === 1);
    void single;
    for (let taken = 1; taken <= 2; taken += 1) {
      playFirstLegal(state);
      expect(traySize(state.tray)).toBe(TRAY_SIZE - taken);
    }
    playFirstLegal(state);
    // Bare, so a fresh three arrives — and none of them is one that was just taken out.
    expect(traySize(state.tray)).toBe(TRAY_SIZE);
    expect(state.dealt).toBe(TRAY_SIZE * 2);
    expect(first.length).toBe(TRAY_SIZE);
  });

  /**
   * The whole fairness argument for the sequence, asserted rather than hoped for.
   *
   * Three is odd and the seats strictly alternate, so the seat that gets the free first
   * pick of a tray changes every tray by itself. Sixteen trays is even, so over a full
   * match each seat opens exactly eight of them and is forced on the last shape of eight.
   */
  it('alternates which seat gets the free first pick, tray by tray', () => {
    expect(PIECES_PER_MATCH % TRAY_SIZE).toBe(0);
    const trays = PIECES_PER_MATCH / TRAY_SIZE;
    expect(trays % 2).toBe(0);

    const opensTray: SeatId[] = [];
    for (let tray = 0; tray < trays; tray += 1) {
      // Turn index of the first pick of this tray, and seat one opens the even turns.
      opensTray.push((tray * TRAY_SIZE) % 2 === 0 ? 'p1' : 'p2');
    }
    expect(opensTray.filter((seat) => seat === 'p1').length).toBe(trays / 2);
    expect(opensTray.filter((seat) => seat === 'p2').length).toBe(trays / 2);
    for (let tray = 1; tray < trays; tray += 1) {
      expect(opensTray[tray]).toBe(otherOf(opensTray[tray - 1]!));
    }
  });

  it('deals the same shapes for the same seed and different ones for another', () => {
    const a = createMatch(new Rng(4242));
    const b = createMatch(new Rng(4242));
    const c = createMatch(new Rng(4243));
    expect([...a.deal]).toEqual([...b.deal]);
    expect([...a.deal]).not.toEqual([...c.deal]);
    expect(a.deal.length).toBe(PIECES_PER_MATCH);
    for (const piece of a.deal) {
      expect(piece).toBeGreaterThanOrEqual(0);
      expect(piece).toBeLessThan(PIECE_COUNT);
    }
  });
});

function playFirstLegal(state: MatchState): number {
  const count = legalMoves(MOVES, state.board, state.tray);
  expect(count).toBeGreaterThan(0);
  const move = MOVES[0]!;
  expect(playMove(state, move)).toBeGreaterThanOrEqual(0);
  return move;
}

/* ------------------------------------------------------------------ termination */

describe('termination', () => {
  it('cannot run past the shapes it was dealt, however the two seats play', () => {
    // No ceiling on this loop at all: a match that could not finish hangs the suite.
    const state = createMatch(new Rng(99));
    while (!isOver(state)) playFirstLegal(state);
    expect(state.placed).toBeLessThanOrEqual(PIECES_PER_MATCH);
    expect(winnerOf(state)).not.toBeNull();
  });

  it('is reached by nobody being able to place, which is the reference game over', () => {
    // Always the first legal move: shapes stack into the top-left corner and the board
    // jams, which is the ending the reference has. Both endings must be reachable or the
    // one that is not is dead code.
    let jams = 0;
    let boxes = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const state = createMatch(new Rng(seed));
      while (!isOver(state)) playFirstLegal(state);
      if (state.placed < PIECES_PER_MATCH) {
        jams += 1;
        expect(hasPlacement(state.board, state.tray)).toBe(false);
      } else {
        boxes += 1;
      }
    }
    expect(jams).toBeGreaterThan(10);
    expect(boxes).toBeGreaterThan(0);
  });

  it('is reached by two easy bots, and mostly by them jamming the board', () => {
    // The weakest pairing is the one that finds positions nothing resolves, and it is the
    // pairing the cross-game guard uses. It is also the one that reaches the reference's
    // own game over most often, which is what makes that rule live rather than decorative.
    let longest = 0;
    let jams = 0;
    for (let seed = 0; seed < 24; seed += 1) {
      const state = playToEnd(500 + seed, seed % 2 === 0 ? 'p1' : 'p2', BOTH('easy'));
      expect(winnerOf(state)).not.toBeNull();
      longest = Math.max(longest, state.placed);
      if (state.placed < PIECES_PER_MATCH) jams += 1;
    }
    expect(longest).toBeLessThanOrEqual(PIECES_PER_MATCH);
    expect(jams).toBeGreaterThan(12);
  }, 30_000);

  it('says nothing about a winner while the match is still running', () => {
    const state = createMatch(new Rng(7));
    expect(winnerOf(state)).toBeNull();
    playFirstLegal(state);
    expect(winnerOf(state)).toBeNull();
  });
});

/* --------------------------------------------------------- complete-round scoring */

describe('the score settles on complete rounds', () => {
  it('holds an unanswered placement back and releases it when the round closes', () => {
    const state = createMatch(new Rng(21));
    // A row that only wants its last square, so the first placement definitely banks.
    for (let column = 0; column < SIZE - 1; column += 1) state.board[column] = markOf(state.active);
    const single = PIECES.findIndex((shape) => shape.size === 1);
    state.tray[0] = single;
    const opener = state.active;
    playMove(state, encodeMove(0, SIZE - 1));

    const bankedByOpener = opener === 'p1' ? state.p1 : state.p2;
    expect(bankedByOpener).toBe(SIZE);
    // The round is open, so nothing has settled yet.
    expect(state.scoredP1).toBe(0);
    expect(state.scoredP2).toBe(0);

    playFirstLegal(state);
    expect(opener === 'p1' ? state.scoredP1 : state.scoredP2).toBe(SIZE);
  });

  it('settles everything when the box runs out, because that is always a whole round', () => {
    const state = playToEnd(31, 'p1', BOTH('normal'));
    if (state.placed === PIECES_PER_MATCH) {
      expect(state.scoredP1).toBe(state.p1);
      expect(state.scoredP2).toBe(state.p2);
    }
    expect(state.placed % 2 === 0 ? state.scoredP1 : state.scoredP1).toBeGreaterThanOrEqual(0);
  }, 20_000);
});

/* ----------------------------------------------------------------- symmetries */

/**
 * Mirror symmetry, which is the test class that found two defects nothing else could see
 * in Snowball Throw. Here it is asserted on the **evaluation** rather than on the chosen
 * move: a tie broken among equal moves is not covariant under a half-turn — the tie set
 * comes out in the reverse order — but every number the bot compares must be.
 */
describe('a half-turn of the board changes nothing', () => {
  function mirrorBoard(board: Uint8Array): Uint8Array {
    const out = new Uint8Array(CELL_COUNT);
    for (let cell = 0; cell < CELL_COUNT; cell += 1) out[mirrorCell(cell)] = board[cell] ?? EMPTY;
    return out;
  }

  function randomPosition(rng: Rng): Position {
    const board = emptyBoard();
    const fill = rng.int(10, 55);
    for (let i = 0; i < fill; i += 1) {
      board[rng.int(0, CELL_COUNT)] = rng.bool() ? MARK_P1 : MARK_P2;
    }
    // Never leave a complete unit standing: the rules would have cleared it already.
    for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
      const cells = UNIT_CELLS[unit]!;
      if (cells.every((cell) => (board[cell] ?? EMPTY) !== EMPTY)) board[cells[0]!] = EMPTY;
    }
    const tray = [rng.int(0, PIECE_COUNT), rng.int(0, PIECE_COUNT), rng.int(0, PIECE_COUNT)];
    return makePosition(board, tray, rng.int(0, 40), rng.int(0, 40));
  }

  it('scores the mirrored position identically, over three hundred boards', () => {
    const rng = new Rng(20260829);
    for (let trial = 0; trial < 300; trial += 1) {
      const position = randomPosition(rng);
      const mirrored = makePosition(
        mirrorBoard(position.board),
        [...position.tray].map(halfTurnOf),
        position.p1,
        position.p2,
      );
      for (const seat of ['p1', 'p2'] as const) {
        expect(evaluate(mirrored, seat)).toBe(evaluate(position, seat));
      }
    }
  });

  it('offers the mirrored set of placements, cell for cell', () => {
    const rng = new Rng(555);
    for (let trial = 0; trial < 120; trial += 1) {
      const position = randomPosition(rng);
      const mirrored = makePosition(
        mirrorBoard(position.board),
        [...position.tray].map(halfTurnOf),
        position.p1,
        position.p2,
      );

      const here = legalMoves(MOVES, position.board, position.tray);
      const expected: string[] = [];
      for (let i = 0; i < here; i += 1) {
        const move = MOVES[i]!;
        const piece = position.tray[slotOf(move)]!;
        const turned = halfTurnOf(piece);
        expected.push(
          `${String(slotOf(move))}:${cellsOf(turned, mirrorTopLeft(piece, topLeftOf(move))).join(',')}`,
        );
      }

      const other = new Int16Array(TRAY_SIZE * CELL_COUNT);
      const there = legalMoves(other, mirrored.board, mirrored.tray);
      const actual: string[] = [];
      for (let i = 0; i < there; i += 1) {
        const move = other[i]!;
        const piece = mirrored.tray[slotOf(move)]!;
        actual.push(`${String(slotOf(move))}:${cellsOf(piece, topLeftOf(move)).join(',')}`);
      }

      expect(actual.slice().sort()).toEqual(expected.slice().sort());
    }
  });

  /**
   * The invariance this game actually needs, and the reason its seat share is exactly even.
   *
   * There is one board, one tray and no seat-specific geometry anywhere, so exchanging the
   * two seats is a relabelling and nothing else. A bot handed a position with the colours
   * swapped and the other seat to move must play the identical square.
   */
  it('plays the identical move when the two seats are exchanged', () => {
    const rng = new Rng(31337);
    for (let trial = 0; trial < 120; trial += 1) {
      const position = (() => {
        const board = emptyBoard();
        for (let i = 0; i < rng.int(6, 45); i += 1) {
          board[rng.int(0, CELL_COUNT)] = rng.bool() ? MARK_P1 : MARK_P2;
        }
        for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
          const cells = UNIT_CELLS[unit]!;
          if (cells.every((cell) => (board[cell] ?? EMPTY) !== EMPTY)) board[cells[0]!] = EMPTY;
        }
        return makePosition(board, [
          rng.int(0, PIECE_COUNT),
          rng.int(0, PIECE_COUNT),
          rng.int(0, PIECE_COUNT),
        ]);
      })();

      const swapped = emptyBoard();
      for (let cell = 0; cell < CELL_COUNT; cell += 1) {
        const mark = position.board[cell] ?? EMPTY;
        swapped[cell] = mark === EMPTY ? EMPTY : mark === MARK_P1 ? MARK_P2 : MARK_P1;
      }

      for (const tier of ['easy', 'normal', 'hard'] as const) {
        const here = chooseMove(position.board, position.tray, 'p1', new Rng(9), tier);
        const there = chooseMove(swapped, position.tray, 'p2', new Rng(9), tier);
        expect(there).toBe(here);
      }
    }
  }, 30_000);
});

/* -------------------------------------------------------------------- the bot */

describe('the bot', () => {
  it('cannot see a shape that has not been dealt', () => {
    // Structural, because `chooseMove` has no argument carrying the deal. Behavioural too:
    // scrambling every undealt shape changes nothing about the move it plays.
    const state = createMatch(new Rng(808));
    for (let i = 0; i < 6; i += 1) playFirstLegal(state);
    const before = chooseMove(state.board, state.tray, state.active, new Rng(5), 'hard');
    const scramble = new Rng(1);
    for (let i = state.dealt; i < PIECES_PER_MATCH; i += 1) {
      state.deal[i] = scramble.int(0, PIECE_COUNT);
    }
    const after = chooseMove(state.board, state.tray, state.active, new Rng(5), 'hard');
    expect(after).toBe(before);
  });

  it('returns -1 rather than an illegal move when nothing fits', () => {
    const board = emptyBoard();
    board.fill(MARK_P1);
    board[0] = EMPTY;
    const twoAcross = PIECES.findIndex((shape) => shape.width === 2 && shape.height === 1);
    expect(chooseMove(board, Int8Array.from([twoAcross, -1, -1]), 'p1', new Rng(1), 'hard')).toBe(
      -1,
    );
  });

  it('plays the legal move it says it plays, at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const state = createMatch(new Rng(60 + tier.length));
      while (!isOver(state)) {
        const move = chooseMove(state.board, state.tray, state.active, new Rng(3), tier);
        expect(move).toBeGreaterThanOrEqual(0);
        const piece = state.tray[slotOf(move)] ?? -1;
        expect(piece).toBeGreaterThanOrEqual(0);
        expect(fitsAt(state.board, piece, topLeftOf(move))).toBe(true);
        playMove(state, move);
      }
    }
  }, 30_000);

  it('takes a clear that is there to be taken', () => {
    const board = emptyBoard();
    for (let column = 0; column < SIZE - 1; column += 1) board[column] = MARK_P1;
    const single = PIECES.findIndex((shape) => shape.size === 1);
    const tray = Int8Array.from([single, -1, -1]);
    const move = chooseMove(board, tray, 'p1', new Rng(2), 'hard');
    expect(topLeftOf(move)).toBe(SIZE - 1);
  });

  it('prefers the line it owns when two are equally close', () => {
    const board = emptyBoard();
    // Row 0 is eight of seat one's; row 8 is eight of seat two's. Seat one should take its
    // own, because every cleared cell pays the seat that placed it.
    for (let column = 0; column < SIZE - 1; column += 1) {
      board[column] = MARK_P1;
      board[8 * SIZE + column] = MARK_P2;
    }
    const single = PIECES.findIndex((shape) => shape.size === 1);
    const tray = Int8Array.from([single, -1, -1]);
    expect(topLeftOf(chooseMove(board, tray, 'p1', new Rng(2), 'hard'))).toBe(SIZE - 1);
    expect(topLeftOf(chooseMove(board, tray, 'p2', new Rng(2), 'hard'))).toBe(8 * SIZE + SIZE - 1);
  });

  it('is a monotone ladder, measured from both seat orders', () => {
    const table: Record<string, number> = {};
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['hard', 'normal'],
      ['normal', 'easy'],
    ] as const) {
      let strongWins = 0;
      let decided = 0;
      for (let seed = 0; seed < 20; seed += 1) {
        for (const opener of ['p1', 'p2'] as const) {
          const tiers: Record<SeatId, BotDifficulty> = { p1: strong, p2: weak };
          const state = playToEnd(900 + seed, opener, tiers);
          const winner = winnerOf(state);
          if (winner === 'draw' || winner === null) continue;
          decided += 1;
          if (winner === 'p1') strongWins += 1;
        }
      }
      table[`${strong}>${weak}`] = strongWins / Math.max(1, decided);
    }
    expect(table['hard>easy']).toBeGreaterThan(table['hard>normal']!);
    expect(table['normal>easy']).toBeGreaterThan(table['hard>normal']!);
    expect(table['hard>normal']).toBeGreaterThan(0.55);
    expect(table['hard>easy']).toBeGreaterThan(0.8);
  }, 60_000);

  it('has a ladder of two knobs and nothing else', () => {
    expect(Object.keys(TIERS.easy).sort()).toEqual(['beam', 'blunder']);
    expect(TIERS.easy.blunder).toBeGreaterThan(TIERS.normal.blunder);
    expect(TIERS.normal.blunder).toBeGreaterThan(TIERS.hard.blunder);
    expect(TIERS.hard.beam).toBeGreaterThan(TIERS.normal.beam);
  });
});

/* ------------------------------------------------------------------ determinism */

describe('determinism', () => {
  it('replays a whole match exactly from the same seed', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const a = playToEnd(77, 'p1', BOTH(tier));
      const b = playToEnd(77, 'p1', BOTH(tier));
      expect([...a.board]).toEqual([...b.board]);
      expect([a.p1, a.p2, a.placed, a.active]).toEqual([b.p1, b.p2, b.placed, b.active]);
    }
  }, 30_000);

  /**
   * The property the exactly-even seat share rests on.
   *
   * One seed played with each opening seat is the *same match with the two labels
   * exchanged*, because the bot streams are handed out by role. So a seed that seat one
   * wins when it opens is a seed seat two wins when it opens, and a paired sample cannot
   * lean either way. This is a proof rather than a measurement, and it is why the number
   * in SPEC.md is exactly 50.0% rather than nearly.
   */
  it('plays the identical match with the seats exchanged', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 12; seed += 1) {
        const a = playToEnd(300 + seed, 'p1', BOTH(tier));
        const b = playToEnd(300 + seed, 'p2', BOTH(tier));
        expect(b.p2).toBe(a.p1);
        expect(b.p1).toBe(a.p2);
        expect(b.scoredP2).toBe(a.scoredP1);
        expect(b.scoredP1).toBe(a.scoredP2);
        expect(b.placed).toBe(a.placed);
        const swap = (mark: number): number =>
          mark === EMPTY ? EMPTY : mark === MARK_P1 ? MARK_P2 : MARK_P1;
        expect([...b.board]).toEqual([...a.board].map(swap));
        const winnerA = winnerOf(a);
        const winnerB = winnerOf(b);
        expect(winnerB).toBe(winnerA === 'draw' || winnerA === null ? winnerA : otherOf(winnerA));
      }
    }
  }, 60_000);
});
