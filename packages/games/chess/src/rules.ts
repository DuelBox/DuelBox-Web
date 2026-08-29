import type { Rng, SeatId } from '@duelbox/engine';
import { SearchBudget, deepen } from '@duelbox/game-sdk';

/**
 * Chess, as pure rules. No rendering, no timing, no DOM.
 *
 * ## What is here, and what is not
 *
 * Every FIDE movement rule is here: the six pieces, castling on both wings with all of its
 * conditions, en passant, promotion, check, checkmate and stalemate. So are the three draws
 * that make a match *finish* — threefold repetition, the fifty-move rule and insufficient
 * material — plus one rule of our own, a ply ceiling adjudicated on material, which is what
 * turns "this ends eventually" into a bound somebody can check. See SPEC.md for the
 * argument and for the two deliberate reductions (promotion is to a queen, and a
 * double-push always sets the en-passant square whether or not a capture is available).
 *
 * ## The board, and why it is stored the way it is
 *
 * Sixty-four signed bytes, row-major from the top. **Seat one sits at the bottom** (row 7)
 * and its pawns advance towards row 0; seat two sits at the top and advances towards row 7.
 * A piece is `+type` for seat one and `-type` for seat two, so the sign *is* the seat and
 * "does this belong to me" is one multiply.
 *
 * ## Mirror symmetry is the load-bearing property
 *
 * The starting position is **exactly invariant** under σ = (flip the rows) ∘ (swap the
 * seats): σ maps square `s` to `s ^ 56`, seat one's back rank onto seat two's, and every
 * castling right onto its opposite number. Everything in this file is written to be
 * covariant under σ, which is stronger than measuring 50% and is what
 * `rules.test.ts`'s mirror suite asserts board by board.
 *
 * Two things had to be arranged for that rather than assumed:
 *
 * - **Squares are visited in the mover's own frame.** {@link orient} walks 0…63 for seat
 *   one and 63…0 by row for seat two, so the k-th square seat one looks at is the σ-image
 *   of the k-th square seat two looks at. Iterating 0…63 for both would generate the two
 *   seats' moves in unrelated orders, and every tie-break downstream would then decide a
 *   mirrored position differently — lesson 11 in the brief, in its most literal form.
 * - **Directions are held as (row, column) deltas and the row delta is multiplied by the
 *   seat's sign.** A knight's k-th jump for seat two is therefore the σ-image of its k-th
 *   jump for seat one, for free, for every piece at once.
 */

/* ------------------------------------------------------------------ the board */

export const BOARD_SIZE = 8;
export const SQUARES = BOARD_SIZE * BOARD_SIZE;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

/** Centipawns. The king is worth nothing because losing it ends the match, not the count. */
const VALUE = [0, 100, 320, 330, 500, 900, 0];

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** +1 for seat one, −1 for seat two. The sign of a square's byte is the seat that owns it. */
export function signOf(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

export function rowOf(square: number): number {
  return square >> 3;
}

export function columnOf(square: number): number {
  return square & 7;
}

/** The row a seat's king and rooks start on. */
export function homeRowOf(seat: SeatId): number {
  return seat === 'p1' ? 7 : 0;
}

/**
 * The `index`-th square in `seat`'s own reading order.
 *
 * Seat one reads the board top-left to bottom-right; seat two reads its σ-image. Move
 * generation walks this rather than 0…63 so that the two seats produce mirrored move
 * lists in mirrored positions — see the note at the top of the file.
 */
export function orient(seat: SeatId, index: number): number {
  return seat === 'p1' ? index : index ^ 56;
}

/** The σ-image of a square: the same file, the mirrored rank. */
export function mirrorSquare(square: number): number {
  return square ^ 56;
}

/* ------------------------------------------------------------------ moves */

export const KIND_QUIET = 0;
export const KIND_DOUBLE_PUSH = 1;
export const KIND_EN_PASSANT = 2;
export const KIND_CASTLE_KING = 3;
export const KIND_CASTLE_QUEEN = 4;
export const KIND_PROMOTION = 5;

/**
 * A move is one integer: six bits of origin, six of destination, three of kind.
 *
 * Packed rather than an object because the search makes tens of thousands of them a turn
 * and rule 5 forbids allocating in the loop. `0` is not a legal move — it would be a piece
 * moving from a1 to a1 — so it doubles as "none" alongside {@link NO_MOVE}.
 */
export function packMove(from: number, to: number, kind: number): number {
  return from | (to << 6) | (kind << 12);
}

export const NO_MOVE = -1;

export function moveFrom(move: number): number {
  return move & 63;
}

export function moveTo(move: number): number {
  return (move >> 6) & 63;
}

export function moveKind(move: number): number {
  return (move >> 12) & 7;
}

/** The σ-image of a move. Kinds survive because σ preserves files. */
export function mirrorMove(move: number): number {
  if (move < 0) return move;
  return packMove(mirrorSquare(moveFrom(move)), mirrorSquare(moveTo(move)), moveKind(move));
}

/**
 * The eight ray directions, as (row, column) deltas: four orthogonal then four diagonal.
 *
 * Rooks use 0–3, bishops 4–7, queens and kings all eight. Held as deltas rather than as
 * flat square offsets so the row half can be multiplied by the mover's sign.
 */
const RAY_DR = [-1, 1, 0, 0, -1, -1, 1, 1];
const RAY_DC = [0, 0, -1, 1, -1, 1, -1, 1];
const ORTHOGONAL_RAYS = 4;

const KNIGHT_DR = [-2, -2, -1, -1, 1, 1, 2, 2];
const KNIGHT_DC = [-1, 1, -2, 2, -2, 2, -1, 1];

/* ------------------------------------------------------------------ castling rights */

export const CASTLE_P1_KING = 1;
export const CASTLE_P1_QUEEN = 2;
export const CASTLE_P2_KING = 4;
export const CASTLE_P2_QUEEN = 8;
export const CASTLE_ALL = 15;

/**
 * What each square does to the castling rights when a piece moves off it or onto it.
 *
 * Both directions matter and only one of them is obvious: a rook that *moves* loses its
 * right, and a rook that is *captured on its home square* loses it too. Masking by both
 * ends of every move covers the pair in one line, and covers the case that catches people
 * out — a rook taken by a knight that never went near the king.
 */
const RIGHTS_MASK = new Int8Array(SQUARES).fill(-1);
RIGHTS_MASK[63] = ~CASTLE_P1_KING;
RIGHTS_MASK[56] = ~CASTLE_P1_QUEEN;
RIGHTS_MASK[7] = ~CASTLE_P2_KING;
RIGHTS_MASK[0] = ~CASTLE_P2_QUEEN;
RIGHTS_MASK[60] = ~(CASTLE_P1_KING | CASTLE_P1_QUEEN);
RIGHTS_MASK[4] = ~(CASTLE_P2_KING | CASTLE_P2_QUEEN);

function kingSideRight(seat: SeatId): number {
  return seat === 'p1' ? CASTLE_P1_KING : CASTLE_P2_KING;
}

function queenSideRight(seat: SeatId): number {
  return seat === 'p1' ? CASTLE_P1_QUEEN : CASTLE_P2_QUEEN;
}

/* ------------------------------------------------------------------ position */

export interface Position {
  /** Sixty-four signed bytes, row-major from the top. */
  readonly board: Int8Array;
  toMove: SeatId;
  /** Bitmask of {@link CASTLE_P1_KING} and friends. */
  castling: number;
  /** The square a pawn may be captured on en passant this move, or −1. */
  ep: number;
  /** Plies since the last capture or pawn move, for the fifty-move rule. */
  sinceProgress: number;
  /** Cached king squares; scanning for them was the single hottest thing in the search. */
  kingP1: number;
  kingP2: number;
}

export function kingOf(position: Position, seat: SeatId): number {
  return seat === 'p1' ? position.kingP1 : position.kingP2;
}

const BACK_RANK = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];

export function createPosition(): Position {
  const position: Position = {
    board: new Int8Array(SQUARES),
    toMove: 'p1',
    castling: CASTLE_ALL,
    ep: -1,
    sinceProgress: 0,
    kingP1: 60,
    kingP2: 4,
  };
  resetPosition(position, 'p1');
  return position;
}

/**
 * The opening array, with `opener` to move.
 *
 * The layout never depends on who opens: seat one is always at the bottom. Only the side
 * that moves first changes, which is exactly the σ-symmetry — a match opened by seat two
 * is the mirror image of the same match opened by seat one, and nothing else about the
 * board differs.
 */
export function resetPosition(position: Position, opener: SeatId): void {
  const board = position.board;
  board.fill(0);
  for (let column = 0; column < BOARD_SIZE; column += 1) {
    const piece = BACK_RANK[column] ?? ROOK;
    board[column] = -piece;
    board[8 + column] = -PAWN;
    board[48 + column] = PAWN;
    board[56 + column] = piece;
  }
  position.toMove = opener;
  position.castling = CASTLE_ALL;
  position.ep = -1;
  position.sinceProgress = 0;
  position.kingP1 = 60;
  position.kingP2 = 4;
}

export function copyPosition(target: Position, source: Position): void {
  target.board.set(source.board);
  target.toMove = source.toMove;
  target.castling = source.castling;
  target.ep = source.ep;
  target.sinceProgress = source.sinceProgress;
  target.kingP1 = source.kingP1;
  target.kingP2 = source.kingP2;
}

/**
 * The σ-image of a position: rows flipped, seats swapped.
 *
 * Used only by the tests and the balance harness, but it lives here beside the rules it is
 * a symmetry of, because the moment it drifts from them it proves nothing.
 */
export function mirrorPosition(target: Position, source: Position): void {
  for (let square = 0; square < SQUARES; square += 1) {
    target.board[mirrorSquare(square)] = -(source.board[square] ?? 0);
  }
  target.toMove = otherOf(source.toMove);
  const castling = source.castling;
  target.castling =
    ((castling & CASTLE_P1_KING) !== 0 ? CASTLE_P2_KING : 0) |
    ((castling & CASTLE_P1_QUEEN) !== 0 ? CASTLE_P2_QUEEN : 0) |
    ((castling & CASTLE_P2_KING) !== 0 ? CASTLE_P1_KING : 0) |
    ((castling & CASTLE_P2_QUEEN) !== 0 ? CASTLE_P1_QUEEN : 0);
  target.ep = source.ep < 0 ? -1 : mirrorSquare(source.ep);
  target.sinceProgress = source.sinceProgress;
  target.kingP1 = mirrorSquare(source.kingP2);
  target.kingP2 = mirrorSquare(source.kingP1);
}

/* ------------------------------------------------------------------ attacks */

/**
 * Whether `bySeat` attacks `square`.
 *
 * Asked once per generated move, so it is the single hottest function in the package. It
 * scans outwards from the square being asked about rather than inwards from every enemy
 * piece: eight knight jumps, two pawn diagonals, then eight rays that stop at the first
 * piece they meet. A king counts only at distance one, which is the one line people get
 * wrong and which makes kings appear to attack across the board.
 */
export function isAttacked(board: Int8Array, square: number, bySeat: SeatId): boolean {
  const sign = signOf(bySeat);
  const row = square >> 3;
  const column = square & 7;

  for (let k = 0; k < 8; k += 1) {
    const r = row + (KNIGHT_DR[k] ?? 0);
    const c = column + (KNIGHT_DC[k] ?? 0);
    if (r < 0 || r > 7 || c < 0 || c > 7) continue;
    if ((board[(r << 3) | c] ?? 0) === sign * KNIGHT) return true;
  }

  // A pawn of `bySeat` attacking this square stands one rank *behind* it in that seat's
  // own frame, which is `+sign` rows away on the board.
  const pawnRow = row + sign;
  if (pawnRow >= 0 && pawnRow <= 7) {
    const base = pawnRow << 3;
    if (column > 0 && (board[base + column - 1] ?? 0) === sign * PAWN) return true;
    if (column < 7 && (board[base + column + 1] ?? 0) === sign * PAWN) return true;
  }

  for (let k = 0; k < 8; k += 1) {
    const dr = RAY_DR[k] ?? 0;
    const dc = RAY_DC[k] ?? 0;
    let r = row + dr;
    let c = column + dc;
    let steps = 1;
    while (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
      const piece = board[(r << 3) | c] ?? 0;
      if (piece !== 0) {
        const type = piece * sign;
        if (type > 0) {
          if (type === QUEEN) return true;
          if (steps === 1 && type === KING) return true;
          if (k < ORTHOGONAL_RAYS ? type === ROOK : type === BISHOP) return true;
        }
        break;
      }
      r += dr;
      c += dc;
      steps += 1;
    }
  }
  return false;
}

/** Whether the seat's king is under attack right now. */
export function inCheck(position: Position, seat: SeatId): boolean {
  return isAttacked(position.board, kingOf(position, seat), otherOf(seat));
}

/* ------------------------------------------------------------------ generation */

/** No position in chess has more than 218 legal moves; the buffers are round numbers above it. */
export const MOVE_CAPACITY = 256;

/**
 * Every pseudo-legal move for the seat to move, written into `out`, returning the count.
 *
 * *Pseudo*-legal: a move that leaves or puts its own king in check is still generated. The
 * search filters it out by playing it and asking — which it has to do anyway to recurse —
 * so filtering here would mean making every move twice.
 *
 * With `capturesOnly` the generator returns captures, en passant and promotions and
 * nothing else. That is the quiescence move set: the moves that change the material count,
 * which are the ones a search must resolve before it is allowed to stop.
 */
export function generate(out: Int32Array, position: Position, capturesOnly: boolean): number {
  const board = position.board;
  const seat = position.toMove;
  const sign = signOf(seat);
  const homeRow = homeRowOf(seat);
  const pawnRow = homeRow - sign;
  const lastRow = 7 - homeRow;
  let count = 0;

  for (let index = 0; index < SQUARES; index += 1) {
    const from = orient(seat, index);
    const piece = board[from] ?? 0;
    if (piece === 0) continue;
    const type = piece * sign;
    if (type < 0) continue;
    const row = from >> 3;
    const column = from & 7;

    if (type === PAWN) {
      const dr = -sign;
      const ahead = row + dr;
      const aheadBase = ahead << 3;
      if ((board[aheadBase + column] ?? 0) === 0) {
        if (ahead === lastRow) {
          out[count++] = packMove(from, aheadBase + column, KIND_PROMOTION);
        } else if (!capturesOnly) {
          out[count++] = packMove(from, aheadBase + column, KIND_QUIET);
          const twoAhead = ahead + dr;
          if (row === pawnRow && (board[(twoAhead << 3) + column] ?? 0) === 0) {
            out[count++] = packMove(from, (twoAhead << 3) + column, KIND_DOUBLE_PUSH);
          }
        }
      }
      for (let side = -1; side <= 1; side += 2) {
        const target = column + side;
        if (target < 0 || target > 7) continue;
        const square = aheadBase + target;
        const occupant = board[square] ?? 0;
        if (occupant * sign < 0) {
          out[count++] = packMove(from, square, ahead === lastRow ? KIND_PROMOTION : KIND_QUIET);
        } else if (occupant === 0 && square === position.ep) {
          out[count++] = packMove(from, square, KIND_EN_PASSANT);
        }
      }
      continue;
    }

    if (type === KNIGHT) {
      for (let k = 0; k < 8; k += 1) {
        const r = row + (KNIGHT_DR[k] ?? 0) * sign;
        const c = column + (KNIGHT_DC[k] ?? 0);
        if (r < 0 || r > 7 || c < 0 || c > 7) continue;
        const square = (r << 3) | c;
        const occupant = board[square] ?? 0;
        if (occupant * sign > 0) continue;
        if (capturesOnly && occupant === 0) continue;
        out[count++] = packMove(from, square, KIND_QUIET);
      }
      continue;
    }

    const first = type === BISHOP ? ORTHOGONAL_RAYS : 0;
    const last = type === ROOK ? ORTHOGONAL_RAYS : 8;
    const single = type === KING;
    for (let k = first; k < last; k += 1) {
      const dr = (RAY_DR[k] ?? 0) * sign;
      const dc = RAY_DC[k] ?? 0;
      let r = row + dr;
      let c = column + dc;
      while (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
        const square = (r << 3) | c;
        const occupant = board[square] ?? 0;
        if (occupant * sign > 0) break;
        if (!capturesOnly || occupant !== 0) out[count++] = packMove(from, square, KIND_QUIET);
        if (occupant !== 0) break;
        if (single) break;
        r += dr;
        c += dc;
      }
    }

    if (type === KING && !capturesOnly) {
      count = addCastles(out, count, position, seat, from, homeRow);
    }
  }
  return count;
}

/**
 * Castling, appended after the king's ordinary steps.
 *
 * Three squares have to be safe — the one the king stands on, the one it crosses and the
 * one it lands on — and the last of those is left to the general legality filter, because
 * every king move goes through it anyway. The two board-emptiness tests differ between the
 * wings by one square, which is the detail that makes queen-side castling look like a
 * special case when it is only a longer walk.
 *
 * The rights bitmask already implies the rook is home and unmoved: {@link RIGHTS_MASK}
 * clears the bit the moment anything moves off or onto the rook's square.
 */
function addCastles(
  out: Int32Array,
  count: number,
  position: Position,
  seat: SeatId,
  from: number,
  homeRow: number,
): number {
  const base = homeRow << 3;
  const home = base + 4;
  if (from !== home) return count;
  const wanted = kingSideRight(seat) | queenSideRight(seat);
  if ((position.castling & wanted) === 0) return count;
  const board = position.board;
  const rival = otherOf(seat);
  if (isAttacked(board, home, rival)) return count;
  let next = count;
  if (
    (position.castling & kingSideRight(seat)) !== 0 &&
    (board[home + 1] ?? 0) === 0 &&
    (board[home + 2] ?? 0) === 0 &&
    !isAttacked(board, home + 1, rival)
  ) {
    out[next++] = packMove(from, home + 2, KIND_CASTLE_KING);
  }
  if (
    (position.castling & queenSideRight(seat)) !== 0 &&
    (board[home - 1] ?? 0) === 0 &&
    (board[home - 2] ?? 0) === 0 &&
    (board[home - 3] ?? 0) === 0 &&
    !isAttacked(board, home - 1, rival)
  ) {
    out[next++] = packMove(from, home - 2, KIND_CASTLE_QUEEN);
  }
  return next;
}

/* ------------------------------------------------------------------ making moves */

/**
 * Play `move` from `source` into `target`. Copy-make, never make-unmake.
 *
 * A sixty-four byte `set()` is a memcpy and costs less than the bookkeeping an undo record
 * would need for castling rights, the en-passant square, the fifty-move counter and the two
 * king squares — five things that a naive unmake gets wrong one at a time.
 *
 * The move is assumed pseudo-legal. Legality — whether it leaves the mover's own king
 * attacked — is a question about the *result*, so the caller asks it afterwards.
 */
export function makeMove(target: Position, source: Position, move: number): void {
  const board = target.board;
  board.set(source.board);
  const seat = source.toMove;
  const sign = signOf(seat);
  const from = moveFrom(move);
  const to = moveTo(move);
  const kind = moveKind(move);
  const piece = board[from] ?? 0;
  const captured = board[to] ?? 0;
  const type = piece * sign;

  board[from] = 0;
  board[to] = piece;
  target.kingP1 = source.kingP1;
  target.kingP2 = source.kingP2;
  target.ep = -1;

  if (kind === KIND_DOUBLE_PUSH) {
    target.ep = (from + to) >> 1;
  } else if (kind === KIND_EN_PASSANT) {
    // The pawn taken stands on the mover's own rank, in the destination's file.
    board[(from & ~7) | (to & 7)] = 0;
  } else if (kind === KIND_PROMOTION) {
    board[to] = sign * QUEEN;
  } else if (kind === KIND_CASTLE_KING) {
    const base = from & ~7;
    board[base + 7] = 0;
    board[base + 5] = sign * ROOK;
  } else if (kind === KIND_CASTLE_QUEEN) {
    const base = from & ~7;
    board[base] = 0;
    board[base + 3] = sign * ROOK;
  }

  if (type === KING) {
    if (seat === 'p1') target.kingP1 = to;
    else target.kingP2 = to;
  }

  target.castling = source.castling & (RIGHTS_MASK[from] ?? -1) & (RIGHTS_MASK[to] ?? -1);
  target.sinceProgress = type === PAWN || captured !== 0 ? 0 : source.sinceProgress + 1;
  target.toMove = otherOf(seat);
}

/** What a move takes, as a piece type, or 0. En passant takes a pawn off a square it is not on. */
export function capturedBy(position: Position, move: number): number {
  if (moveKind(move) === KIND_EN_PASSANT) return PAWN;
  const occupant = position.board[moveTo(move)] ?? 0;
  return occupant < 0 ? -occupant : occupant;
}

/* ------------------------------------------------------------------ legality */

const askPosition = createPosition();
const askMoves = new Int32Array(MOVE_CAPACITY);

/**
 * Every *legal* move, written into `out`.
 *
 * Used by the board — to show a player where a lifted piece may go — and to decide
 * checkmate from stalemate. The search does not call it: it filters as it recurses, which
 * costs one `makeMove` instead of two.
 */
export function legalMoves(out: Int32Array, position: Position): number {
  const seat = position.toMove;
  const pseudo = generate(askMoves, position, false);
  let count = 0;
  for (let i = 0; i < pseudo; i += 1) {
    const move = askMoves[i] ?? 0;
    makeMove(askPosition, position, move);
    if (!inCheck(askPosition, seat)) out[count++] = move;
  }
  return count;
}

const hasScratch = createPosition();
const hasMoves = new Int32Array(MOVE_CAPACITY);

/** Whether the seat to move has any legal move at all. Stops at the first one it finds. */
export function hasLegalMove(position: Position): boolean {
  const seat = position.toMove;
  const pseudo = generate(hasMoves, position, false);
  for (let i = 0; i < pseudo; i += 1) {
    makeMove(hasScratch, position, hasMoves[i] ?? 0);
    if (!inCheck(hasScratch, seat)) return true;
  }
  return false;
}

const findMoves = new Int32Array(MOVE_CAPACITY);

/**
 * The legal move from `from` to `to`, or {@link NO_MOVE}.
 *
 * Two squares are all a player ever names — the piece and where it goes — and this is what
 * turns that pair into the move the rules mean by it, castling and en passant included. A
 * king stepping two squares is castling and nothing else can be, so the board never has to
 * ask which one the player meant.
 */
export function moveBetween(position: Position, from: number, to: number): number {
  const count = legalMoves(findMoves, position);
  for (let i = 0; i < count; i += 1) {
    const move = findMoves[i] ?? 0;
    if (moveFrom(move) === from && moveTo(move) === to) return move;
  }
  return NO_MOVE;
}

/* ------------------------------------------------------------------ material */

/** The seat's material in centipawns, kings excluded. */
export function materialOf(board: Int8Array, seat: SeatId): number {
  const sign = signOf(seat);
  let total = 0;
  for (let square = 0; square < SQUARES; square += 1) {
    const piece = board[square] ?? 0;
    const type = piece * sign;
    if (type > 0) total += VALUE[type] ?? 0;
  }
  return total;
}

/**
 * A position neither side could ever mate from, however badly the other plays.
 *
 * King against king, and king and one minor piece against a bare king or another single
 * minor. Not the full FIDE list — two knights against a king is also a dead draw and is not
 * here — because the fifty-move rule catches the rest a hundred plies later and the extra
 * cases are worth less than the lines they cost. What this *does* buy is the common ending:
 * two weak bots trading down to nothing then shuffling for a hundred plies before the
 * fifty-move rule notices.
 */
export function insufficientMaterial(board: Int8Array): boolean {
  let minorP1 = 0;
  let minorP2 = 0;
  for (let square = 0; square < SQUARES; square += 1) {
    const piece = board[square] ?? 0;
    if (piece === 0) continue;
    const type = piece < 0 ? -piece : piece;
    if (type === PAWN || type === ROOK || type === QUEEN) return false;
    if (type === KNIGHT || type === BISHOP) {
      if (piece > 0) minorP1 += 1;
      else minorP2 += 1;
    }
  }
  return minorP1 <= 1 && minorP2 <= 1;
}

/* ------------------------------------------------------------------ the match */

/** Fifty moves by each side with no capture and no pawn move. */
export const FIFTY_MOVE_PLIES = 100;

/**
 * The ply ceiling. **[ours]**
 *
 * Two hundred moves each, after which the match is adjudicated on material. Chess's own
 * draw rules end nearly every match long before this — see SPEC.md for the measurement —
 * but they do not *bound* one: between two irreversible moves a game may run 99 plies, and
 * there are at most 126 irreversible moves available (ninety-six pawn steps and thirty
 * captures), so FIDE alone permits something near 12 700 plies. That is over an hour of
 * simulated play against `termination.test.ts`'s ten-minute ceiling. The cap is what turns
 * "it ends" into a number.
 */
export const MAX_PLIES = 400;

const HISTORY_STRIDE = SQUARES + 3;
/** One entry per ply since the last irreversible move, and the fifty-move rule caps that. */
const HISTORY_CAPACITY = FIFTY_MOVE_PLIES + 4;

export type MatchResult = SeatId | 'draw' | null;

export interface Match {
  readonly position: Position;
  /**
   * Packed snapshots of every position since the last capture or pawn move, for threefold
   * repetition. Only that far back is needed: an irreversible move makes every position
   * before it unreachable, so nothing older can ever repeat.
   */
  readonly history: Int8Array;
  historyLength: number;
  /** Plies played, against {@link MAX_PLIES}. */
  ply: number;
  /** Enemy pieces each seat has taken. This is the scoreline the shell shows. */
  takenByP1: number;
  takenByP2: number;
  result: MatchResult;
  /** The last move played, so the board can show what just happened. −1 when none. */
  lastFrom: number;
  lastTo: number;
}

export function createMatch(opener: SeatId = 'p1'): Match {
  const match: Match = {
    position: createPosition(),
    history: new Int8Array(HISTORY_CAPACITY * HISTORY_STRIDE),
    historyLength: 0,
    ply: 0,
    takenByP1: 0,
    takenByP2: 0,
    result: null,
    lastFrom: -1,
    lastTo: -1,
  };
  resetMatch(match, opener);
  return match;
}

export function resetMatch(match: Match, opener: SeatId): void {
  resetPosition(match.position, opener);
  match.historyLength = 0;
  match.ply = 0;
  match.takenByP1 = 0;
  match.takenByP2 = 0;
  match.result = null;
  match.lastFrom = -1;
  match.lastTo = -1;
  remember(match);
}

function remember(match: Match): void {
  const base = match.historyLength * HISTORY_STRIDE;
  if (base + HISTORY_STRIDE > match.history.length) return;
  match.history.set(match.position.board, base);
  match.history[base + SQUARES] = match.position.toMove === 'p1' ? 1 : 2;
  match.history[base + SQUARES + 1] = match.position.castling;
  match.history[base + SQUARES + 2] = match.position.ep;
  match.historyLength += 1;
}

/**
 * How many times the current position has occurred, itself included.
 *
 * Only every second entry can match, because the side to move alternates and is part of
 * what makes two positions the same one.
 */
export function repetitionCount(match: Match): number {
  const last = match.historyLength - 1;
  if (last < 0) return 0;
  const history = match.history;
  const base = last * HISTORY_STRIDE;
  let count = 0;
  for (let entry = last; entry >= 0; entry -= 2) {
    const other = entry * HISTORY_STRIDE;
    let same = true;
    for (let i = 0; i < HISTORY_STRIDE; i += 1) {
      if (history[base + i] !== history[other + i]) {
        same = false;
        break;
      }
    }
    if (same) count += 1;
  }
  return count;
}

/**
 * Who has won, or `'draw'`, or null while the match is live.
 *
 * The order is FIDE's and it matters at exactly one point: **checkmate is checked first**,
 * so a mate delivered on the hundredth quiet ply is a win rather than a fifty-move draw.
 */
export function resultOf(match: Match): MatchResult {
  const position = match.position;
  const seat = position.toMove;
  if (!hasLegalMove(position)) {
    return inCheck(position, seat) ? otherOf(seat) : 'draw';
  }
  if (position.sinceProgress >= FIFTY_MOVE_PLIES) return 'draw';
  if (repetitionCount(match) >= 3) return 'draw';
  if (insufficientMaterial(position.board)) return 'draw';
  if (match.ply >= MAX_PLIES) return adjudicate(position.board);
  return null;
}

/** The ceiling's verdict: more material wins, level is a draw. */
export function adjudicate(board: Int8Array): SeatId | 'draw' {
  const p1 = materialOf(board, 'p1');
  const p2 = materialOf(board, 'p2');
  if (p1 === p2) return 'draw';
  return p1 > p2 ? 'p1' : 'p2';
}

/**
 * Play a move against the live match.
 *
 * Returns false for an illegal one, so a caller cannot mistake a refusal for a move that
 * happened to change nothing visible.
 */
export function playMove(match: Match, from: number, to: number): boolean {
  if (match.result !== null) return false;
  const move = moveBetween(match.position, from, to);
  if (move === NO_MOVE) return false;
  return playPacked(match, move);
}

/** The same, for a move the rules already produced — the bot's path, with no second search. */
export function playPacked(match: Match, move: number): boolean {
  if (match.result !== null || move < 0) return false;
  const position = match.position;
  const mover = position.toMove;
  const taken = capturedBy(position, move);
  makeMove(position, position, move);
  if (taken !== 0) {
    if (mover === 'p1') match.takenByP1 += 1;
    else match.takenByP2 += 1;
  }
  match.ply += 1;
  match.lastFrom = moveFrom(move);
  match.lastTo = moveTo(move);
  if (position.sinceProgress === 0) match.historyLength = 0;
  remember(match);
  match.result = resultOf(match);
  return true;
}

/* ------------------------------------------------------------------ evaluation */

/**
 * How central a square is: 12 in the middle four, 0 in a corner.
 *
 * Row-flip invariant by construction, so every term built on it is automatically the same
 * for both seats — which is half of what makes the whole evaluation σ-covariant.
 */
const CENTRE = new Int8Array(SQUARES);
for (let square = 0; square < SQUARES; square += 1) {
  CENTRE[square] = 14 - Math.abs(2 * (square >> 3) - 7) - Math.abs(2 * (square & 7) - 7);
}

/** Below this much non-pawn material on the board, kings come out and start fighting. */
const ENDGAME_MATERIAL = 1400;
/**
 * How hard a winning side is pushed to drive a bare king to the edge.
 *
 * Swept alone over 0…48, and it is worth reading what the sweep actually said, because it
 * is not what the term was put in for. It changes **nothing** about how strong the bot is —
 * weight 12 against weight 6 scores 48.5% over a hundred matches, and against weight 0,
 * 50.0% — and it changes a great deal about whether a won ending gets *finished*:
 *
 * | weight | K+Q against a bare king, 40 placements | decisive matches, `hard` v `hard` |
 * |---|---|---|
 * | 0 | 8 mated, 27 repeated | 48% |
 * | 6 | 5 mated, 30 repeated | 52% |
 * | 10 | 26 mated, 9 repeated | 58% |
 * | **12** | **29 mated, 6 repeated** | **56%** |
 * | 16 and above | 20 mated, 15 repeated | 54% |
 *
 * Non-monotone, and the shape is the explanation: the term has to out-vote the queen's own
 * centrality (1 a square) and the king term (3 a square) before it decides anything, which
 * happens between 8 and 10; above about 14 it swamps them entirely and the winning side
 * walks its king in without keeping the queen anywhere useful. Twelve is the top of the
 * middle plateau, not a single lucky point — ten is nearly as good.
 *
 * What the sweep does *not* fix is the underlying cause: the search cannot see a
 * repetition, so a side with an overwhelming position and nothing to capture has no reason
 * to prefer progress. That is what the remaining 6 of 40 are, and SPEC.md records it.
 */
export const MOP_UP_WEIGHT = 12;
/** The lead at which mopping up is worth more than shuffling. */
const MOP_UP_THRESHOLD = 400;

const CENTRE_WEIGHT = [0, 0, 3, 2, 1, 1, 0];

/**
 * Score the position from the point of view of the seat to move.
 *
 * Material dominates, as it must. Three positional terms carry the rest, and each of them
 * is there for a reason that showed up in a measurement rather than in taste:
 *
 * - **Centrality**, weighted per piece, so knights come out and rooks are not encouraged to
 *   sit in the middle of the board where they are only exposed.
 * - **Pawn advancement**, quadratic, so a pawn near promotion is worth chasing. Without it
 *   nothing pushes a pawn at all and every match grinds to a fifty-move draw with sixteen
 *   pawns still on their starting squares.
 * - **Mopping up**, which only switches on once one side is clearly winning a simple
 *   endgame: the losing king is pushed to the edge and the winning king is drawn towards
 *   it. A three-ply search with no such term wins a queen and then shuffles, because
 *   nothing in the other two terms prefers progress — 8 conversions in 40 bare-king
 *   endings against 29 with it. It buys no *strength*: see {@link MOP_UP_WEIGHT} for the
 *   sweep, which is one of the two knobs here that measured flat on the thing it was
 *   assumed to move.
 */
export function evaluate(position: Position): number {
  const board = position.board;
  let score = 0;
  let material = 0;
  let leadP1 = 0;
  for (let square = 0; square < SQUARES; square += 1) {
    const piece = board[square] ?? 0;
    if (piece === 0) continue;
    const forP1 = piece > 0;
    const type = forP1 ? piece : -piece;
    const value = VALUE[type] ?? 0;
    let term = value + (CENTRE[square] ?? 0) * (CENTRE_WEIGHT[type] ?? 0);
    if (type === PAWN) {
      // Rows advanced from this seat's own second rank, 0…5.
      const row = square >> 3;
      const advanced = forP1 ? 6 - row : row - 1;
      term += advanced * advanced * 2;
    }
    if (type !== PAWN && type !== KING) material += value;
    leadP1 += forP1 ? value : -value;
    score += forP1 ? term : -term;
  }

  const endgame = material < ENDGAME_MATERIAL;
  const kingCentreP1 = CENTRE[position.kingP1] ?? 0;
  const kingCentreP2 = CENTRE[position.kingP2] ?? 0;
  // A king hides in the middlegame and fights in the endgame; the same number, sign flipped.
  const kingTerm = endgame ? 3 : -3;
  score += kingTerm * (kingCentreP1 - kingCentreP2);

  if (endgame && (leadP1 >= MOP_UP_THRESHOLD || leadP1 <= -MOP_UP_THRESHOLD)) {
    const winner = leadP1 > 0 ? position.kingP1 : position.kingP2;
    const loser = leadP1 > 0 ? position.kingP2 : position.kingP1;
    const separation = Math.max(
      Math.abs((winner >> 3) - (loser >> 3)),
      Math.abs((winner & 7) - (loser & 7)),
    );
    const mop = MOP_UP_WEIGHT * (12 - (CENTRE[loser] ?? 0) + (7 - separation));
    score += leadP1 > 0 ? mop : -mop;
  }

  // `| 0` rather than a bare negation, and it is not decoration. Every term above is a
  // whole number, so this truncates nothing — what it does is turn `-0` back into `0` for
  // a level position seen from seat two. The two are equal to every comparison the search
  // makes, so nothing played differently; they are *not* equal to `Object.is`, so the
  // mirror suite could not assert the symmetry it exists to assert. That is the family
  // lesson 8 of the brief names: a value a variable lands on exactly by construction,
  // reached from opposite ends by the two seats, differing in the last bit.
  return (position.toMove === 'p1' ? score : -score) | 0;
}

/* ------------------------------------------------------------------ search */

const MATE = 30_000;
const INFINITY = 1_000_000;
/** Deep enough for the deepest tier plus a long capture sequence at the leaf. */
const MAX_SEARCH_PLY = 20;

const searchStates: Position[] = [];
const moveBuffers: Int32Array[] = [];
const scoreBuffers: Int32Array[] = [];
for (let ply = 0; ply <= MAX_SEARCH_PLY; ply += 1) {
  searchStates.push(createPosition());
  moveBuffers.push(new Int32Array(MOVE_CAPACITY));
  scoreBuffers.push(new Int32Array(MOVE_CAPACITY));
}

/** Set when the node budget ran out, so a half-finished depth can be thrown away whole. */
let aborted = false;

/**
 * Clear the abort flag before a sweep.
 *
 * A function rather than a bare `aborted = false`, and that is a compiler detail worth one
 * line: assigned in place, TypeScript narrows the flag to `false` for the rest of the
 * block and then objects that reading it back after the search is a check that can never
 * fire. It can — {@link search} sets it from three levels down. Hiding the assignment
 * behind a call keeps the declared type, and keeps the lint honest instead of suppressed.
 */
function beginSweep(): void {
  aborted = false;
}

/**
 * Order the moves so the cheapest refutations are tried first.
 *
 * Captures by most-valuable-victim, least-valuable-attacker; then promotions; then
 * everything else in generation order. This is not polish — alpha-beta prunes in proportion
 * to how good the first move is. Measured over 3 900 `hard` decisions, ordering against no
 * ordering at all: **5 246 nodes a decision against 8 264**, and the node ceiling reached
 * on **11.4% of decisions against 48.0%**. Nearly half of an unordered `hard`'s moves would
 * be a depth-two answer wearing a depth-three label.
 */
function scoreMoves(moves: Int32Array, scores: Int32Array, count: number, board: Int8Array): void {
  for (let i = 0; i < count; i += 1) {
    const move = moves[i] ?? 0;
    const kind = moveKind(move);
    const occupant = board[moveTo(move)] ?? 0;
    const victim = kind === KIND_EN_PASSANT ? PAWN : occupant < 0 ? -occupant : occupant;
    if (victim !== 0) {
      const attacker = board[moveFrom(move)] ?? 0;
      const mine = attacker < 0 ? -attacker : attacker;
      scores[i] = 100_000 + (VALUE[victim] ?? 0) * 10 - (VALUE[mine] ?? 0);
    } else if (kind === KIND_PROMOTION) {
      scores[i] = 90_000;
    } else {
      scores[i] = 0;
    }
  }
}

/** Swap the best remaining move into slot `at`. A selection sort, so nothing is allocated. */
function pickBest(moves: Int32Array, scores: Int32Array, count: number, at: number): void {
  let best = at;
  let bestScore = scores[at] ?? 0;
  for (let i = at + 1; i < count; i += 1) {
    const score = scores[i] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best === at) return;
  const move = moves[at] ?? 0;
  moves[at] = moves[best] ?? 0;
  moves[best] = move;
  const score = scores[at] ?? 0;
  scores[at] = scores[best] ?? 0;
  scores[best] = score;
}

/**
 * Search the captures out of a position before scoring it.
 *
 * Without this a search stops in the middle of an exchange and calls whatever it finds the
 * truth: a bot that has just taken a defended queen believes it is a queen up. It is the
 * single largest lever in the whole bot. The same three-ply search against the shipped
 * `normal`, over fifty matches, scores **94% with it and 31% without**; at one ply, 34%
 * against 0%.
 *
 * It is also the reason {@link depthFor} can be the identity — see the note there, and
 * SPEC.md for the ablation table both functions were measured from.
 */
function quiesce(
  position: Position,
  ply: number,
  alphaIn: number,
  beta: number,
  budget: SearchBudget,
): number {
  if (!budget.spend()) {
    aborted = true;
    return 0;
  }
  const standing = evaluate(position);
  if (ply >= MAX_SEARCH_PLY || standing >= beta) return standing;
  let alpha = alphaIn;
  if (standing > alpha) alpha = standing;

  const moves = moveBuffers[ply];
  const scores = scoreBuffers[ply];
  const child = searchStates[ply];
  if (moves === undefined || scores === undefined || child === undefined) return standing;

  const seat = position.toMove;
  const count = generate(moves, position, true);
  scoreMoves(moves, scores, count, position.board);
  let best = standing;
  for (let i = 0; i < count; i += 1) {
    pickBest(moves, scores, count, i);
    makeMove(child, position, moves[i] ?? 0);
    if (inCheck(child, seat)) continue;
    const score = -quiesce(child, ply + 1, -beta, -alpha, budget);
    if (aborted) break;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function search(
  position: Position,
  depth: number,
  ply: number,
  alphaIn: number,
  beta: number,
  budget: SearchBudget,
): number {
  // Charged on every node, leaves included: leaves are the overwhelming majority of the
  // work, and charging only internal nodes puts the ceiling above the thing it limits.
  if (!budget.spend()) {
    aborted = true;
    return 0;
  }
  if (depth <= 0 || ply >= MAX_SEARCH_PLY) return quiesce(position, ply, alphaIn, beta, budget);

  const moves = moveBuffers[ply];
  const scores = scoreBuffers[ply];
  const child = searchStates[ply];
  if (moves === undefined || scores === undefined || child === undefined) {
    return evaluate(position);
  }

  const seat = position.toMove;
  const count = generate(moves, position, false);
  scoreMoves(moves, scores, count, position.board);
  let alpha = alphaIn;
  let best = -INFINITY;
  let legal = 0;
  for (let i = 0; i < count; i += 1) {
    pickBest(moves, scores, count, i);
    makeMove(child, position, moves[i] ?? 0);
    if (inCheck(child, seat)) continue;
    legal += 1;
    const score = -search(child, depth - 1, ply + 1, -beta, -alpha, budget);
    if (aborted) break;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  // No legal move at all: mated, or stalemated. A mate found sooner is worth more, which is
  // what stops a bot postponing a forced mate for ever.
  if (legal === 0 && !aborted) return inCheck(position, seat) ? -(MATE - ply) : 0;
  return best;
}

const rootMoves = new Int32Array(MOVE_CAPACITY);
const rootScores = new Int32Array(MOVE_CAPACITY);

/**
 * Shuffle the root list before it is ordered. **[ours]**
 *
 * Alpha-beta replaces its best move only on a *strict* improvement, so when several root
 * moves come back with the same score the one that is played is simply whichever the
 * generator happened to emit first. That is a real defect and not a cosmetic one: with
 * `hard`'s blunder rate at zero nothing else in the bot consumes randomness, so every
 * `hard` match was **the same game**, seed for seed. Twenty seeds measured the opener at
 * 100% and the honest reading of that number was "one match, and the opener won it".
 *
 * Shuffling only the root cannot change how strong the bot is. The score a move gets is
 * computed by {@link search} from the position after it, which no permutation of its
 * siblings touches; ordering is re-applied by {@link pickBest} straight afterwards, so
 * captures are still tried first. All that moves is the choice *between moves the search
 * cannot separate* — and SPEC.md measures the ladder either way to say so with numbers.
 *
 * Two properties it has to keep, both of them by construction rather than by luck:
 *
 * - **No extra random draw.** The key is the second of the two floats {@link chooseWith}
 *   already takes, so a decision still costs exactly two, and the seats stay uncoupled.
 * - **σ-covariance.** The permutation is a function of the index and the key alone, never
 *   of the board, so the mirrored position's list — which holds the mirrored moves in the
 *   same order — is permuted the same way, and the k-th move stays the σ-image of the
 *   k-th move. A shuffle keyed on squares would decide a mirrored position differently,
 *   which is lesson 11 of the brief with the board coordinates hidden inside a hash.
 */
function shuffleRoot(moves: Int32Array, count: number, key: number): void {
  let state = (key ^ 0x9e3779b9) | 0;
  for (let i = count - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) | 0;
    const j = (state >>> 9) % (i + 1);
    const move = moves[i] ?? 0;
    moves[i] = moves[j] ?? 0;
    moves[j] = move;
  }
}

/** One full sweep at a fixed depth. Returns the best move, or {@link NO_MOVE} if none. */
function rootSearch(position: Position, depth: number, budget: SearchBudget, key: number): number {
  const child = searchStates[0];
  if (child === undefined) return NO_MOVE;
  const seat = position.toMove;
  const count = generate(rootMoves, position, false);
  shuffleRoot(rootMoves, count, key);
  scoreMoves(rootMoves, rootScores, count, position.board);
  let alpha = -INFINITY;
  let best = NO_MOVE;
  for (let i = 0; i < count; i += 1) {
    pickBest(rootMoves, rootScores, count, i);
    const move = rootMoves[i] ?? 0;
    makeMove(child, position, move);
    if (inCheck(child, seat)) continue;
    const score = -search(child, depth - 1, 1, -INFINITY, -alpha, budget);
    if (aborted) break;
    if (best === NO_MOVE || score > alpha) {
      alpha = score;
      best = move;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How many iterative-deepening levels the tier is allowed. */
  readonly levels: number;
  /** How often it throws the search away and plays any legal move at all. */
  readonly blunder: number;
}

/**
 * A node ceiling, not a clock, and **one ceiling for all three tiers**.
 *
 * The same position spends the same budget on a phone and on a laptop, which rule 8
 * requires and which a stopwatch cannot give.
 *
 * There used to be a `nodes` field on {@link BotProfile} as well. It was dead: the budget
 * is a module-level singleton and {@link chooseWith} only ever called `reset()` on it, so
 * the field was carried, documented and never read. Sweeping it alone is what found that —
 * 400 nodes and 12 000 nodes produced byte-identical matches, which no real ceiling can.
 * The brief's fourth lesson says to delete a knob that does nothing, so it is gone, and
 * what is left is one number swept for real by rebuilding:
 *
 * | ceiling | `hard`'s score against shipped `normal` | worst single decision |
 * |---|---|---|
 * | 1 500 | 78.3% | 0.56 ms |
 * | 2 600 | 77.5% | 1.00 ms |
 * | 6 000 | 88.3% | 2.26 ms |
 * | **12 000** | **94.2%** | **3.96 ms** |
 * | 25 000 | 95.0% | 8.20 ms |
 * | 60 000 | 95.0% | 19.02 ms |
 *
 * 12 000 is the knee. Above it the search is buying almost nothing — a full depth-three
 * sweep costs about 7 400 nodes, so 25 000 only pays for the rare wide position — and
 * 60 000 puts the worst decision past a whole 60 Hz frame, which is the thing the ceiling
 * exists to prevent.
 */
export const SEARCH_NODES = 12_000;

export const PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { levels: 1, blunder: 0.2 },
  normal: { levels: 2, blunder: 0.08 },
  hard: { levels: 3, blunder: 0 },
});

/**
 * One budget, reset per turn rather than rebuilt.
 *
 * A bot moves on one frame in sixty and `SearchBudget` is a two-field object, so this is
 * not about the allocation — it is about there being exactly one place the ceiling lives.
 */
const budget = new SearchBudget(SEARCH_NODES);

/**
 * The depth a deepening level searches to.
 *
 * Identity, and that is a decision rather than a default. Issue #2495 says `deepen` assumes
 * deeper is monotonically better and that this is false without quiescence, so Solitaire
 * maps level → 2·level−1 to keep every iteration on the same side of an exchange. The
 * instruction was to do the same or say why not, so this was measured rather than argued.
 *
 * **Deeper is monotonically better here, at every depth the node ceiling can pay for.**
 * Head to head at equal everything else, 120 matches a pair:
 *
 * | | score |
 * |---|---|
 * | depth 2 against depth 1 | 86.3% |
 * | depth 3 against depth 2 | 85.4% |
 * | depth 4 against depth 3 | 53.8% (39W 51D 30L) |
 * | depth 5 against depth 4 | 50.4% |
 *
 * No inversion at any parity, with quiescence on **or off** — the ablation in SPEC.md
 * searched for one deliberately and found none. The flattening at four is the node ceiling,
 * not the exchange: depth four rarely completes inside 12 000 nodes, so `deepen` throws it
 * away and keeps depth three.
 *
 * The odd-only mapping is therefore not needed, and here it would cost something real:
 * levels 1, 2, 3 are depths **1, 2, 3**, which measure 34%, 80% and 94% against the shipped
 * `normal` — three usable rungs. Under level → 2·level−1 they would be depths 1, 3 and 5,
 * and depth 5 does not fit in the budget, so `normal` and `hard` would collapse onto the
 * same search and the ladder would lose its middle.
 */
function depthFor(level: number): number {
  return level;
}

/**
 * The move a bot plays, or {@link NO_MOVE} when it has none.
 *
 * Every tier sees exactly the board a human sees. Difficulty is search depth and blunder
 * rate — never extra information, never a longer clock.
 */
export function chooseMove(position: Position, rng: Rng, difficulty: BotDifficulty): number {
  return chooseWith(position, rng, PROFILES[difficulty]);
}

/**
 * The same choice against an arbitrary profile.
 *
 * Exists so a knob can be swept on its own with everything else left as shipped, which is
 * the only way to find out what sign it has.
 *
 * **Both random draws happen before anything branches**, and there are always exactly two.
 * A conditional draw count couples the seats through a shared generator: seat two's play
 * becomes a function of how its opponent is playing, and the mirror property dies with it.
 */
export function chooseWith(position: Position, rng: Rng, profile: BotProfile): number {
  const roll = rng.float();
  const pick = rng.float();

  const count = legalMoves(rootMoves, position);
  if (count === 0) return NO_MOVE;
  const fallback = rootMoves[0] ?? NO_MOVE;
  if (roll < profile.blunder) {
    return rootMoves[Math.min(count - 1, (pick * count) | 0)] ?? fallback;
  }

  budget.reset();
  // Iterative deepening under the node budget. A depth cut short part-way is thrown away
  // rather than trusted: half a ply is not an opinion, it is whichever moves happened to be
  // ordered first.
  // The same key at every level, so a deeper sweep re-examines the same list in the same
  // order rather than changing its mind about two moves it already could not separate.
  const key = (pick * 0x7fff_ffff) | 0;
  const found = deepen(budget, profile.levels, (level) => {
    beginSweep();
    const move = rootSearch(position, depthFor(level), budget, key);
    return aborted || move === NO_MOVE ? null : move;
  });
  return found > 0 ? found : fallback;
}

/** How many nodes the last search actually spent. For the cost tests and the sweeps. */
export function lastSearchNodes(): number {
  return budget.spent;
}
