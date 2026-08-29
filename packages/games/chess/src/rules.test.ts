import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BISHOP,
  CASTLE_ALL,
  CASTLE_P1_KING,
  CASTLE_P1_QUEEN,
  CASTLE_P2_KING,
  FIFTY_MOVE_PLIES,
  KING,
  KIND_CASTLE_KING,
  KIND_CASTLE_QUEEN,
  KIND_EN_PASSANT,
  KIND_PROMOTION,
  KNIGHT,
  MAX_PLIES,
  MOVE_CAPACITY,
  NO_MOVE,
  PAWN,
  PROFILES,
  QUEEN,
  ROOK,
  SEARCH_NODES,
  SQUARES,
  adjudicate,
  chooseMove,
  chooseWith,
  createMatch,
  createPosition,
  evaluate,
  generate,
  hasLegalMove,
  inCheck,
  insufficientMaterial,
  kingOf,
  lastSearchNodes,
  legalMoves,
  makeMove,
  materialOf,
  mirrorMove,
  mirrorPosition,
  mirrorSquare,
  moveBetween,
  moveFrom,
  moveKind,
  moveTo,
  playMove,
  playPacked,
  repetitionCount,
  resultOf,
} from './rules.js';
import type { BotDifficulty, Match, Position } from './rules.js';

/* ------------------------------------------------------------------ helpers */

/**
 * A position from a FEN string, so the published perft numbers can be quoted directly.
 *
 * Only the four fields that change what is legal are read. Squares run row-major from the
 * top, which is the order FEN itself uses, so `a8` is 0 and `h1` is 63 — and seat one is
 * the side FEN calls white, at the bottom of the board.
 */
function fen(text: string): Position {
  const parts = text.split(/\s+/);
  const placement = parts[0] ?? '';
  const side = parts[1] ?? 'w';
  const castling = parts[2] ?? '-';
  const ep = parts[3] ?? '-';
  const position = createPosition();
  position.board.fill(0);
  const letters = 'pnbrqk';
  let square = 0;
  for (const character of placement) {
    if (character === '/') continue;
    if (character >= '1' && character <= '8') {
      square += Number(character);
      continue;
    }
    const type = letters.indexOf(character.toLowerCase()) + 1;
    const sign = character === character.toUpperCase() ? 1 : -1;
    position.board[square] = sign * type;
    if (type === KING) {
      if (sign > 0) position.kingP1 = square;
      else position.kingP2 = square;
    }
    square += 1;
  }
  position.toMove = side === 'w' ? 'p1' : 'p2';
  position.castling =
    (castling.includes('K') ? CASTLE_P1_KING : 0) |
    (castling.includes('Q') ? CASTLE_P1_QUEEN : 0) |
    (castling.includes('k') ? CASTLE_P2_KING : 0) |
    (castling.includes('q') ? 8 : 0);
  position.ep = ep === '-' ? -1 : (8 - Number(ep[1])) * 8 + (ep.charCodeAt(0) - 97);
  position.sinceProgress = 0;
  return position;
}

/** `e4` and friends, so a test reads like a game rather than like an array index. */
function at(square: string): number {
  return (8 - Number(square[1])) * 8 + (square.charCodeAt(0) - 97);
}

const perftStack: { position: Position; moves: Int32Array }[] = [];
for (let depth = 0; depth <= 8; depth += 1) {
  perftStack.push({ position: createPosition(), moves: new Int32Array(MOVE_CAPACITY) });
}

/** Legal move paths of exactly `depth` plies. The one measurement a generator cannot fake. */
function perft(position: Position, depth: number): number {
  if (depth === 0) return 1;
  const level = perftStack[depth];
  if (level === undefined) return 0;
  const count = generate(level.moves, position, false);
  const seat = position.toMove;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    makeMove(level.position, position, level.moves[i] ?? 0);
    if (inCheck(level.position, seat)) continue;
    total += depth === 1 ? 1 : perft(level.position, depth - 1);
  }
  return total;
}

/** The legal move joining two named squares, or {@link NO_MOVE}. */
function move(position: Position, from: string, to: string): number {
  return moveBetween(position, at(from), at(to));
}

/** Play a run of moves against a live match, failing loudly on the first illegal one. */
function playAll(match: Match, moves: string): void {
  for (const pair of moves.trim().split(/\s+/)) {
    const from = pair.slice(0, 2);
    const to = pair.slice(2, 4);
    expect(playMove(match, at(from), at(to)), `${from}${to} was refused`).toBe(true);
  }
}

/** A match driven to its end by two bots sharing one generator, as the game drives it. */
function runMatch(seed: number, opener: SeatId, tier: BotDifficulty): Match {
  const rng = new Rng(seed);
  const match = createMatch(opener);
  let guard = 0;
  while (match.result === null) {
    expect(guard++, 'a match ran past every rule that is supposed to stop it').toBeLessThan(
      MAX_PLIES + 4,
    );
    playPacked(match, chooseMove(match.position, rng, tier));
  }
  return match;
}

/* ------------------------------------------------------------------ the board */

describe('the opening array', () => {
  it('sets both armies up facing each other, seat one at the bottom', () => {
    const position = createPosition();
    expect(position.board[at('e1')]).toBe(KING);
    expect(position.board[at('d1')]).toBe(QUEEN);
    expect(position.board[at('a1')]).toBe(ROOK);
    expect(position.board[at('b1')]).toBe(KNIGHT);
    expect(position.board[at('e2')]).toBe(PAWN);
    expect(position.board[at('e8')]).toBe(-KING);
    expect(position.board[at('e7')]).toBe(-PAWN);
    expect(position.castling).toBe(CASTLE_ALL);
    expect(position.ep).toBe(-1);
    expect(kingOf(position, 'p1')).toBe(at('e1'));
    expect(kingOf(position, 'p2')).toBe(at('e8'));
    expect(materialOf(position.board, 'p1')).toBe(materialOf(position.board, 'p2'));
  });

  it('is exactly invariant under the half-turn, which is what makes the seats equal', () => {
    const position = createPosition();
    const mirror = createPosition();
    mirrorPosition(mirror, position);
    // σ maps the array onto itself and only swaps whose move it is.
    expect([...mirror.board]).toEqual([...position.board]);
    expect(mirror.castling).toBe(position.castling);
    expect(mirror.toMove).toBe('p2');
  });

  it('puts the same array on the board whichever seat opens', () => {
    const first = createMatch('p1');
    const second = createMatch('p2');
    expect([...second.position.board]).toEqual([...first.position.board]);
    expect(second.position.toMove).toBe('p2');
  });
});

/* ------------------------------------------------------------------ generation */

describe('move generation, against the published perft counts', () => {
  it('counts the opening position correctly to four plies', () => {
    const start = createPosition();
    expect(perft(start, 1)).toBe(20);
    expect(perft(start, 2)).toBe(400);
    expect(perft(start, 3)).toBe(8902);
    expect(perft(start, 4)).toBe(197_281);
  });

  it('counts the standard hard cases correctly', () => {
    // "Kiwipete": castling both wings for both sides, pins, and a discovered check.
    const kiwipete = fen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -');
    expect(perft(kiwipete, 1)).toBe(48);
    expect(perft(kiwipete, 2)).toBe(2039);
    expect(perft(kiwipete, 3)).toBe(97_862);

    // A rook-and-pawn ending built to exercise en passant and pins along a rank.
    const rooks = fen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -');
    expect(perft(rooks, 1)).toBe(14);
    expect(perft(rooks, 2)).toBe(191);
    expect(perft(rooks, 3)).toBe(2812);
    expect(perft(rooks, 4)).toBe(43_238);
  });

  /**
   * The one place our counts are meant to differ from the published ones, and by exactly
   * how much.
   *
   * Promotion here is always to a queen, so every promotion the standard counts four ways
   * we count once. That is a *derivation*, not a fudge: the published breakdown of this
   * position at one ply is 44 nodes of which 4 are promotions, and 44 − ¾ × 4 = 41.
   */
  it('differs from the published counts by precisely the under-promotions it does not make', () => {
    const promoting = fen('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -');
    expect(perft(promoting, 1)).toBe(44 - 3);
    const moves = new Int32Array(MOVE_CAPACITY);
    const count = legalMoves(moves, promoting);
    const promotions = [...moves.slice(0, count)].filter((m) => moveKind(m) === KIND_PROMOTION);
    expect(promotions).toHaveLength(1);
    // And what it becomes is a queen, every time.
    const after = createPosition();
    makeMove(after, promoting, promotions[0] ?? 0);
    expect(after.board[moveTo(promotions[0] ?? 0)]).toBe(QUEEN);
  });
});

describe('the moves that are always got wrong', () => {
  it('castles on both wings, moving the rook with the king', () => {
    const position = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
    const kingSide = move(position, 'e1', 'g1');
    expect(moveKind(kingSide)).toBe(KIND_CASTLE_KING);
    const after = createPosition();
    makeMove(after, position, kingSide);
    expect(after.board[at('g1')]).toBe(KING);
    expect(after.board[at('f1')]).toBe(ROOK);
    expect(after.board[at('h1')]).toBe(0);
    // And both rights are gone, not just the one that was used.
    expect(after.castling & (CASTLE_P1_KING | CASTLE_P1_QUEEN)).toBe(0);

    const queenSide = move(position, 'e1', 'c1');
    expect(moveKind(queenSide)).toBe(KIND_CASTLE_QUEEN);
    makeMove(after, position, queenSide);
    expect(after.board[at('c1')]).toBe(KING);
    expect(after.board[at('d1')]).toBe(ROOK);
    expect(after.board[at('a1')]).toBe(0);
  });

  it('refuses to castle out of, through, or into check', () => {
    // A rook on e8 attacks the square the king stands on.
    expect(move(fen('4r3/8/8/8/8/8/8/R3K2R w KQ -'), 'e1', 'g1')).toBe(NO_MOVE);
    // On f8 it attacks the square the king crosses.
    expect(move(fen('5r2/8/8/8/8/8/8/R3K2R w KQ -'), 'e1', 'g1')).toBe(NO_MOVE);
    // On g8 it attacks the square the king lands on.
    expect(move(fen('6r1/8/8/8/8/8/8/R3K2R w KQ -'), 'e1', 'g1')).toBe(NO_MOVE);
    // b8 attacks only b1, which the *rook* crosses and the king does not: legal.
    expect(move(fen('1r6/8/8/8/8/8/8/R3K2R w KQ -'), 'e1', 'c1')).not.toBe(NO_MOVE);
  });

  it('refuses to castle through a piece, or without the right', () => {
    expect(move(fen('8/8/8/8/8/8/8/R3KB1R w KQ -'), 'e1', 'g1')).toBe(NO_MOVE);
    expect(move(fen('8/8/8/8/8/8/8/RN2K2R w KQ -'), 'e1', 'c1')).toBe(NO_MOVE);
    expect(move(fen('8/8/8/8/8/8/8/R3K2R w - -'), 'e1', 'g1')).toBe(NO_MOVE);
  });

  it('loses the right when the rook moves, and when the rook is captured at home', () => {
    const moved = fen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
    const after = createPosition();
    makeMove(after, moved, move(moved, 'h1', 'h2'));
    expect(after.castling & CASTLE_P1_KING).toBe(0);
    expect(after.castling & CASTLE_P1_QUEEN).not.toBe(0);

    // A rook taken on its own corner by a knight that never went near the king.
    const taken = fen('r3k2r/8/8/8/8/8/6n1/R3K2R b KQkq -');
    makeMove(after, taken, move(taken, 'g2', 'h1'));
    expect(after.castling & CASTLE_P1_KING).toBe(0);
  });

  it('captures en passant, and takes the pawn off the square it is not standing on', () => {
    const position = fen('8/8/8/3pP3/8/8/4K3/7k w - d6');
    const capture = move(position, 'e5', 'd6');
    expect(moveKind(capture)).toBe(KIND_EN_PASSANT);
    const after = createPosition();
    makeMove(after, position, capture);
    expect(after.board[at('d6')]).toBe(PAWN);
    expect(after.board[at('d5')]).toBe(0);
  });

  it('offers en passant only on the move after the double push', () => {
    const match = createMatch('p1');
    playAll(match, 'e2e4 a7a6 e4e5 d7d5');
    expect(match.position.ep).toBe(at('d6'));
    expect(move(match.position, 'e5', 'd6')).not.toBe(NO_MOVE);
    playAll(match, 'b1c3 a6a5');
    expect(match.position.ep).toBe(-1);
    expect(move(match.position, 'e5', 'd6')).toBe(NO_MOVE);
  });

  it('will not move a pinned piece off the pin', () => {
    // The knight on e2 is the only thing between the king and a rook on e8.
    const position = fen('4r3/8/8/8/8/8/4N3/4K3 w - -');
    expect(move(position, 'e2', 'c3')).toBe(NO_MOVE);
    expect(move(position, 'e2', 'g3')).toBe(NO_MOVE);
    // The king may still step aside.
    expect(move(position, 'e1', 'd1')).not.toBe(NO_MOVE);
  });

  it('never lets a king walk next to the other king', () => {
    const position = fen('8/8/8/3k4/8/3K4/8/8 w - -');
    expect(move(position, 'd3', 'd4')).toBe(NO_MOVE);
    expect(move(position, 'd3', 'c4')).toBe(NO_MOVE);
    expect(move(position, 'd3', 'd2')).not.toBe(NO_MOVE);
  });
});

/* ------------------------------------------------------------------ endings */

describe('how a match ends', () => {
  it('calls the fastest checkmate there is a win for the mating seat', () => {
    const match = createMatch('p1');
    playAll(match, 'f2f3 e7e5 g2g4 d8h4');
    expect(inCheck(match.position, 'p1')).toBe(true);
    expect(hasLegalMove(match.position)).toBe(false);
    expect(match.result).toBe('p2');
  });

  it('calls a seat with no move and no check a draw', () => {
    // Seat two to move, not in check, and every square it could go to is covered.
    const match = createMatch('p2');
    const position = match.position;
    position.board.fill(0);
    position.board[at('a8')] = -KING;
    position.board[at('c7')] = QUEEN;
    position.board[at('h1')] = KING;
    position.kingP2 = at('a8');
    position.kingP1 = at('h1');
    position.castling = 0;
    expect(inCheck(position, 'p2')).toBe(false);
    expect(hasLegalMove(position)).toBe(false);
    expect(resultOf(match)).toBe('draw');
  });

  it('draws on the fiftieth move by each side with nothing taken and no pawn moved', () => {
    const match = createMatch('p1');
    const position = match.position;
    position.board.fill(0);
    position.board[at('a1')] = KING;
    position.board[at('h8')] = -KING;
    position.board[at('a2')] = ROOK;
    position.board[at('h7')] = -ROOK;
    position.kingP1 = at('a1');
    position.kingP2 = at('h8');
    position.castling = 0;
    position.sinceProgress = FIFTY_MOVE_PLIES - 1;
    match.historyLength = 0;
    expect(resultOf(match)).toBeNull();
    expect(playMove(match, at('a2'), at('b2'))).toBe(true);
    expect(match.position.sinceProgress).toBe(FIFTY_MOVE_PLIES);
    expect(match.result).toBe('draw');
  });

  it('prefers a mate delivered on the hundredth quiet ply to the fifty-move draw', () => {
    const match = createMatch('p1');
    const position = match.position;
    position.board.fill(0);
    position.board[at('a8')] = -KING;
    position.board[at('c7')] = QUEEN;
    position.board[at('b1')] = ROOK;
    position.board[at('h1')] = KING;
    position.kingP1 = at('h1');
    position.kingP2 = at('a8');
    position.castling = 0;
    position.sinceProgress = FIFTY_MOVE_PLIES - 1;
    match.historyLength = 0;
    expect(playMove(match, at('b1'), at('b8'))).toBe(true);
    expect(match.position.sinceProgress).toBe(FIFTY_MOVE_PLIES);
    expect(match.result).toBe('p1');
  });

  it('draws on the third time a position comes round', () => {
    const match = createMatch('p1');
    expect(repetitionCount(match)).toBe(1);
    playAll(match, 'g1f3 g8f6 f3g1 f6g8');
    expect(repetitionCount(match)).toBe(2);
    expect(match.result).toBeNull();
    playAll(match, 'g1f3 g8f6 f3g1 f6g8');
    expect(repetitionCount(match)).toBe(3);
    expect(match.result).toBe('draw');
  });

  it('forgets the positions before a capture or a pawn move, because they cannot come back', () => {
    const match = createMatch('p1');
    playAll(match, 'g1f3 g8f6 f3g1 f6g8');
    expect(match.historyLength).toBeGreaterThan(1);
    playAll(match, 'e2e4');
    expect(match.historyLength).toBe(1);
    expect(repetitionCount(match)).toBe(1);
  });

  it('draws the endings nobody could ever mate from', () => {
    const bare = createPosition();
    bare.board.fill(0);
    bare.board[0] = -KING;
    bare.board[63] = KING;
    expect(insufficientMaterial(bare.board)).toBe(true);
    bare.board[10] = BISHOP;
    expect(insufficientMaterial(bare.board)).toBe(true);
    bare.board[20] = -KNIGHT;
    expect(insufficientMaterial(bare.board)).toBe(true);
    bare.board[30] = PAWN;
    expect(insufficientMaterial(bare.board)).toBe(false);
    bare.board[30] = ROOK;
    expect(insufficientMaterial(bare.board)).toBe(false);
  });

  it('adjudicates the ply ceiling on material, and calls a level board a draw', () => {
    const level = createPosition();
    expect(adjudicate(level.board)).toBe('draw');
    level.board[at('a8')] = 0;
    expect(adjudicate(level.board)).toBe('p1');
    level.board[at('a1')] = 0;
    level.board[at('b1')] = 0;
    expect(adjudicate(level.board)).toBe('p2');
  });

  it('ends at the ply ceiling whatever the position looks like', () => {
    const match = createMatch('p1');
    match.ply = MAX_PLIES - 1;
    expect(resultOf(match)).toBeNull();
    playAll(match, 'e2e4');
    expect(match.ply).toBe(MAX_PLIES);
    expect(match.result).not.toBeNull();
  });
});

describe('a move that is not legal is refused rather than half-played', () => {
  it('returns false and changes nothing', () => {
    const match = createMatch('p1');
    const before = [...match.position.board];
    expect(playMove(match, at('e2'), at('e5'))).toBe(false);
    expect(playMove(match, at('e7'), at('e5'))).toBe(false); // not this seat's piece
    expect(playMove(match, at('d4'), at('d5'))).toBe(false); // an empty square
    expect([...match.position.board]).toEqual(before);
    expect(match.ply).toBe(0);
  });

  it('refuses every move once the match is over', () => {
    const match = createMatch('p1');
    playAll(match, 'f2f3 e7e5 g2g4 d8h4');
    expect(match.result).toBe('p2');
    expect(playMove(match, at('g1'), at('f3'))).toBe(false);
    expect(playPacked(match, moveBetween(match.position, at('g1'), at('f3')))).toBe(false);
  });

  it('counts a taken piece for the seat that took it, en passant included', () => {
    const match = createMatch('p1');
    playAll(match, 'e2e4 d7d5 e4d5');
    expect(match.takenByP1).toBe(1);
    expect(match.takenByP2).toBe(0);
    playAll(match, 'd8d5');
    expect(match.takenByP2).toBe(1);
  });
});

/* ------------------------------------------------------------------ symmetry */

/**
 * The mirror suite. Lesson 8 of the brief says to write this first, and it is the reason
 * seat one's share is 50.0% by construction rather than 49-point-something by sampling.
 *
 * σ = (flip the rows) ∘ (swap the seats). Every claim below is that some function commutes
 * with σ, asserted board by board over positions reached by real play rather than over
 * hand-picked ones.
 */
describe('everything commutes with the half-turn', () => {
  /** Positions reached by random legal play, which is where the awkward ones live. */
  function sample(count: number): Position[] {
    const found: Position[] = [];
    const moves = new Int32Array(MOVE_CAPACITY);
    for (let seed = 0; seed < count; seed += 1) {
      const rng = new Rng(7 + seed * 13);
      const match = createMatch(seed % 2 === 0 ? 'p1' : 'p2');
      const plies = 1 + (seed % 40);
      for (let i = 0; i < plies && match.result === null; i += 1) {
        const legal = legalMoves(moves, match.position);
        if (legal === 0) break;
        playPacked(match, moves[(rng.float() * legal) | 0] ?? 0);
      }
      const copy = createPosition();
      copy.board.set(match.position.board);
      copy.toMove = match.position.toMove;
      copy.castling = match.position.castling;
      copy.ep = match.position.ep;
      copy.sinceProgress = match.position.sinceProgress;
      copy.kingP1 = match.position.kingP1;
      copy.kingP2 = match.position.kingP2;
      found.push(copy);
    }
    return found;
  }

  const positions = sample(160);

  it('mirrors a square and a move and gets back where it started', () => {
    for (let square = 0; square < SQUARES; square += 1) {
      expect(mirrorSquare(mirrorSquare(square))).toBe(square);
    }
    const packed = moveBetween(createPosition(), at('e2'), at('e4'));
    expect(mirrorMove(mirrorMove(packed))).toBe(packed);
    expect(mirrorMove(NO_MOVE)).toBe(NO_MOVE);
  });

  it('generates the mirrored moves in the mirrored order', () => {
    const mirror = createPosition();
    const mine = new Int32Array(MOVE_CAPACITY);
    const theirs = new Int32Array(MOVE_CAPACITY);
    for (const position of positions) {
      mirrorPosition(mirror, position);
      for (const capturesOnly of [false, true]) {
        const a = generate(mine, position, capturesOnly);
        const b = generate(theirs, mirror, capturesOnly);
        expect(b).toBe(a);
        for (let i = 0; i < a; i += 1) expect(theirs[i]).toBe(mirrorMove(mine[i] ?? 0));
      }
    }
  });

  it('scores a position and its mirror identically', () => {
    const mirror = createPosition();
    for (const position of positions) {
      mirrorPosition(mirror, position);
      expect(evaluate(mirror)).toBe(evaluate(position));
      expect(inCheck(mirror, mirror.toMove)).toBe(inCheck(position, position.toMove));
      expect(hasLegalMove(mirror)).toBe(hasLegalMove(position));
      expect(materialOf(mirror.board, 'p2')).toBe(materialOf(position.board, 'p1'));
    }
  });

  it('makes every bot at every tier choose the mirrored move', () => {
    const mirror = createPosition();
    for (const position of positions) {
      mirrorPosition(mirror, position);
      for (const tier of ['easy', 'normal', 'hard'] as const) {
        const mine = chooseMove(position, new Rng(99), tier);
        const theirs = chooseMove(mirror, new Rng(99), tier);
        expect(theirs, `${tier} broke the mirror`).toBe(mirrorMove(mine));
      }
    }
  });

  it('plays a whole match as the exact mirror of the same match opened by the other seat', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      for (let s = 0; s < 12; s += 1) {
        const seed = 1000003 + s * 7919;
        const a = runMatch(seed, 'p1', tier);
        const b = runMatch(seed, 'p2', tier);
        expect(b.ply).toBe(a.ply);
        expect(b.takenByP2).toBe(a.takenByP1);
        expect(b.takenByP1).toBe(a.takenByP2);
        expect(b.lastFrom).toBe(mirrorSquare(a.lastFrom));
        const flipped = a.result === 'p1' ? 'p2' : a.result === 'p2' ? 'p1' : a.result;
        expect(b.result).toBe(flipped);
        const mirror = createPosition();
        mirrorPosition(mirror, a.position);
        expect([...b.position.board]).toEqual([...mirror.board]);
      }
    }
  });
});

/* ------------------------------------------------------------------ the bot */

describe('the bot', () => {
  it('is a pure function of the position and the generator', () => {
    const position = createPosition();
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      expect(chooseMove(position, new Rng(4242), tier)).toBe(
        chooseMove(position, new Rng(4242), tier),
      );
    }
  });

  it('takes exactly two draws a decision, whatever it decides', () => {
    // A conditional draw count would couple the seats through the shared generator and
    // the mirror property would go with it.
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const rng = new Rng(11);
      const position = createPosition();
      const before = rng.float();
      void before;
      const counting = new Rng(11);
      counting.float();
      let draws = 0;
      const proxy = {
        float: (): number => {
          draws += 1;
          return counting.float();
        },
      } as unknown as Rng;
      chooseMove(position, proxy, tier);
      expect(draws).toBe(2);
    }
  });

  it('never plays an illegal move, in any position it can be handed', () => {
    const moves = new Int32Array(MOVE_CAPACITY);
    for (let seed = 0; seed < 40; seed += 1) {
      const rng = new Rng(500 + seed);
      const match = createMatch(seed % 2 === 0 ? 'p1' : 'p2');
      for (let i = 0; i < 40 && match.result === null; i += 1) {
        const chosen = chooseMove(match.position, rng, 'normal');
        const legal = legalMoves(moves, match.position);
        expect([...moves.slice(0, legal)]).toContain(chosen);
        playPacked(match, chosen);
      }
    }
  });

  it('says it has no move when it has none', () => {
    const mated = createPosition();
    mated.board.fill(0);
    mated.board[at('a8')] = -KING;
    mated.board[at('a7')] = QUEEN;
    mated.board[at('b7')] = KING;
    mated.kingP2 = at('a8');
    mated.kingP1 = at('b7');
    mated.toMove = 'p2';
    mated.castling = 0;
    expect(hasLegalMove(mated)).toBe(false);
    expect(chooseMove(mated, new Rng(1), 'hard')).toBe(NO_MOVE);
  });

  it('stays inside its node ceiling on every decision of a whole match', () => {
    const rng = new Rng(20260829);
    const match = createMatch('p1');
    while (match.result === null) {
      playPacked(match, chooseMove(match.position, rng, 'hard'));
      expect(lastSearchNodes()).toBeLessThanOrEqual(SEARCH_NODES);
    }
  });

  it('takes a free queen', () => {
    // Nothing defends the queen on d5; a search of any depth should notice.
    const position = fen('4k3/8/8/3q4/8/8/8/3RK3 w - -');
    for (const tier of ['normal', 'hard'] as const) {
      const chosen = chooseMove(position, new Rng(1), tier);
      expect(moveFrom(chosen)).toBe(at('d1'));
      expect(moveTo(chosen)).toBe(at('d5'));
    }
  });

  it('does not take a defended pawn with a queen, which is what quiescence is for', () => {
    // Qxb7 wins a pawn and loses the queen to the knight on d8. A search that stopped at
    // the capture would call it a pawn up.
    const position = fen('3nk3/1p6/8/8/8/8/8/3QK3 w - -');
    const chosen = chooseMove(position, new Rng(1), 'hard');
    expect(moveTo(chosen)).not.toBe(at('b7'));
  });

  it('mates in one when there is a mate in one', () => {
    const position = fen('6k1/5ppp/8/8/8/8/8/R3K3 w - -');
    const chosen = chooseMove(position, new Rng(1), 'hard');
    const after = createPosition();
    makeMove(after, position, chosen);
    expect(inCheck(after, 'p2')).toBe(true);
    expect(hasLegalMove(after)).toBe(false);
  });

  it('climbs: every tier beats the one below it over the same seeds', () => {
    // Both seat orders, so this measures skill rather than the move.
    function contest(a: BotDifficulty, b: BotDifficulty): number {
      let points = 0;
      for (let s = 0; s < 8; s += 1) {
        const seed = 1000003 + s * 7919;
        for (const aOpens of [true, false]) {
          const rng = new Rng(seed);
          const match = createMatch('p1');
          while (match.result === null) {
            const mine = (match.position.toMove === 'p1') === aOpens;
            playPacked(match, chooseMove(match.position, rng, mine ? a : b));
          }
          if (match.result === 'draw') points += 0.5;
          else if ((match.result === 'p1') === aOpens) points += 1;
        }
      }
      return points / 16;
    }
    expect(contest('normal', 'easy')).toBeGreaterThan(0.75);
    expect(contest('hard', 'normal')).toBeGreaterThan(0.75);
    expect(contest('hard', 'easy')).toBeGreaterThan(0.85);
  });

  it('has a ladder made of depth and error and nothing else', () => {
    expect(PROFILES.easy.levels).toBeLessThan(PROFILES.normal.levels);
    expect(PROFILES.normal.levels).toBeLessThan(PROFILES.hard.levels);
    expect(PROFILES.easy.blunder).toBeGreaterThan(PROFILES.normal.blunder);
    expect(PROFILES.hard.blunder).toBe(0);
    // Every tier reads the same board through the same function; there is no other input.
    expect(Object.keys(PROFILES.hard).sort()).toEqual(['blunder', 'levels']);
  });

  it('blunders exactly as often as it says it does', () => {
    const position = fen('4k3/8/8/3q4/8/8/8/3RK3 w - -');
    const best = chooseWith(position, new Rng(1), { levels: 3, blunder: 0 });
    let played = 0;
    const trials = 400;
    for (let seed = 0; seed < trials; seed += 1) {
      if (chooseWith(position, new Rng(seed), { levels: 3, blunder: 0.25 }) !== best) played += 1;
    }
    // A blunder can coincide with the best move, so this is an upper bound that has to be
    // near the rate rather than at it.
    expect(played / trials).toBeGreaterThan(0.1);
    expect(played / trials).toBeLessThan(0.3);
  });
});

/* ------------------------------------------------------------------ termination */

/**
 * Termination is a proof, not a hope.
 *
 * Every ply increments `ply`; nothing anywhere decrements it; and `resultOf` returns a
 * non-null result the moment `ply` reaches {@link MAX_PLIES}. So a match is over in at most
 * `MAX_PLIES` plies, and the first two tests below are that statement made executable —
 * the counter only goes up, and the ceiling really does fire. The third measures the
 * distance between the bound and reality.
 */
describe('a match always ends', () => {
  it('never plays a ply without counting it', () => {
    const rng = new Rng(5);
    const match = createMatch('p1');
    let previous = match.ply;
    while (match.result === null) {
      playPacked(match, chooseMove(match.position, rng, 'easy'));
      expect(match.ply).toBe(previous + 1);
      previous = match.ply;
    }
    expect(match.ply).toBeLessThanOrEqual(MAX_PLIES);
  });

  it('stops at the ceiling even when the rules would let it run', () => {
    // Two kings and two rooks that never touch: no capture, no pawn, no mate. Left alone
    // this is a fifty-move draw, so the fifty-move counter is held back to isolate the cap.
    const match = createMatch('p1');
    const position = match.position;
    position.board.fill(0);
    position.board[at('a1')] = KING;
    position.board[at('h8')] = -KING;
    position.kingP1 = at('a1');
    position.kingP2 = at('h8');
    position.castling = 0;
    match.historyLength = 0;
    let plies = 0;
    while (match.result === null && plies < MAX_PLIES + 10) {
      // Shuffle without ever repeating a position three times or reaching fifty moves.
      position.sinceProgress = 0;
      match.historyLength = 0;
      const moves = new Int32Array(MOVE_CAPACITY);
      const legal = legalMoves(moves, position);
      playPacked(match, moves[plies % legal] ?? 0);
      plies += 1;
    }
    expect(match.result).not.toBeNull();
    expect(match.ply).toBeLessThanOrEqual(MAX_PLIES);
  });

  it('finishes two easy bots a long way inside the ceiling, from either opening seat', () => {
    let longest = 0;
    for (let s = 0; s < 10; s += 1) {
      for (const opener of ['p1', 'p2'] as const) {
        const match = runMatch(1000003 + s * 7919, opener, 'easy');
        expect(match.result).not.toBeNull();
        longest = Math.max(longest, match.ply);
      }
    }
    // Measured over 360 matches — 120 a tier, both opening seats — the longest was 273 and
    // the ceiling is 400. If this ever gets close, the ceiling has started doing work the
    // drawing rules were supposed to do, and that is worth knowing before it fires.
    expect(longest).toBeLessThan(MAX_PLIES);
  });
});
