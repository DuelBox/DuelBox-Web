import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Checkers, as pure rules.
 *
 * An eight-by-eight board on which only the thirty-two dark squares are ever used, so the
 * board is stored as thirty-two slots rather than sixty-four. Pieces move diagonally
 * forward, capture by jumping, and are crowned on reaching the far side, after which they
 * move both ways.
 *
 * Two rules do most of the work of making it a game rather than a shuffle:
 * **capturing is compulsory** when a capture exists, and **a jump that can continue must
 * continue**. Both are what turn a position into a trap you can walk your opponent into.
 *
 * No rendering, no timing, no DOM.
 */

export const BOARD_SIZE = 8;
/** Only the dark squares are playable, so half the board is never addressed. */
export const SLOT_COUNT = (BOARD_SIZE * BOARD_SIZE) / 2;
export const PIECES_PER_SEAT = 12;

export type PieceKind = 'man' | 'king';

export interface Piece {
  readonly seat: SeatId;
  kind: PieceKind;
}

export type Slot = Piece | null;

export interface Game {
  /** Thirty-two dark squares, row-major from the top. */
  readonly slots: Slot[];
  /** Whose turn it is. */
  toMove: SeatId;
  /**
   * The slot a piece must keep jumping from, or -1.
   *
   * A jump that can continue must continue, and while it does the turn does not pass —
   * so the same seat moves again and only that one piece may move.
   */
  chain: number;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** Row of a slot, 0 at the top. */
export function rowOf(slot: number): number {
  return Math.floor(slot / (BOARD_SIZE / 2));
}

/**
 * Column of a slot.
 *
 * Dark squares alternate which half of a row they start in, so odd rows are offset by one.
 * Getting this wrong is the classic checkers bug: moves work on half the board and quietly
 * wrap around the edge on the other half.
 */
export function columnOf(slot: number): number {
  const row = rowOf(slot);
  const within = slot % (BOARD_SIZE / 2);
  return within * 2 + (row % 2 === 0 ? 1 : 0);
}

/** The slot at a row and column, or -1 when that square is light or off the board. */
export function slotAt(row: number, column: number): number {
  if (row < 0 || row >= BOARD_SIZE || column < 0 || column >= BOARD_SIZE) return -1;
  // A dark square is one where row and column have different parity.
  const dark = row % 2 === 0 ? column % 2 === 1 : column % 2 === 0;
  if (!dark) return -1;
  return row * (BOARD_SIZE / 2) + Math.floor(column / 2);
}

/**
 * Which way is forward for a seat.
 *
 * p1 sits at the bottom and advances up the board; p2 sits opposite and advances down.
 */
export function forwardOf(seat: SeatId): number {
  return seat === 'p1' ? -1 : 1;
}

/** The row a seat's man is crowned on. */
export function crownRowOf(seat: SeatId): number {
  return seat === 'p1' ? 0 : BOARD_SIZE - 1;
}

export function createGame(): Game {
  const game: Game = {
    slots: new Array<Slot>(SLOT_COUNT).fill(null),
    toMove: 'p1',
    chain: -1,
  };
  resetGame(game);
  return game;
}

export function resetGame(game: Game): void {
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const row = rowOf(slot);
    // Three rows each, with two empty rows between them.
    if (row < 3) game.slots[slot] = { seat: 'p2', kind: 'man' };
    else if (row > 4) game.slots[slot] = { seat: 'p1', kind: 'man' };
    else game.slots[slot] = null;
  }
  game.toMove = 'p1';
  game.chain = -1;
}

/** The four diagonal steps, as row/column deltas. */
const DIAGONALS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

export interface Move {
  readonly from: number;
  readonly to: number;
  /** The slot jumped over, or -1 for a plain move. */
  readonly captured: number;
}

/** A move is a capture when it takes a piece. */
export function isCapture(move: Move): boolean {
  return move.captured >= 0;
}

/**
 * Whether a piece may travel in a direction.
 *
 * A man only goes forward; a king goes both ways. This is the only difference between
 * them, and it is why crowning matters so much.
 */
function canTravel(piece: Piece, rowDelta: number): boolean {
  if (piece.kind === 'king') return true;
  return rowDelta === forwardOf(piece.seat);
}

/**
 * Every move a seat's piece in `slot` could make, appended to `out`.
 *
 * Writes into a caller-owned array and returns the new count, so the search allocates
 * nothing per node.
 */
export function movesFrom(out: Move[], count: number, game: Game, slot: number): number {
  const piece = game.slots[slot];
  if (piece === null || piece === undefined) return count;
  const row = rowOf(slot);
  const column = columnOf(slot);
  let next = count;

  for (const [dr, dc] of DIAGONALS) {
    if (!canTravel(piece, dr)) continue;

    const stepSlot = slotAt(row + dr, column + dc);
    if (stepSlot < 0) continue;
    const occupant = game.slots[stepSlot];

    if (occupant === null || occupant === undefined) {
      out[next++] = { from: slot, to: stepSlot, captured: -1 };
      continue;
    }
    if (occupant.seat === piece.seat) continue;

    // An enemy piece: a jump is legal when the square directly beyond is empty.
    const landing = slotAt(row + dr * 2, column + dc * 2);
    if (landing < 0) continue;
    const beyond = game.slots[landing];
    if (beyond !== null && beyond !== undefined) continue;
    out[next++] = { from: slot, to: landing, captured: stepSlot };
  }
  return next;
}

/**
 * Every legal move for the seat to move, written into `out`.
 *
 * **Capturing is compulsory.** If any capture exists, only captures are returned — which
 * is what lets a player set a trap rather than merely hope one is taken. And while a jump
 * chain is running, only the chaining piece may move, and only by jumping again.
 */
export function legalMoves(out: Move[], game: Game): number {
  const seat = game.toMove;
  let count = 0;

  if (game.chain >= 0) {
    const total = movesFrom(out, 0, game, game.chain);
    // Only the continuations count; a chaining piece may not stop and stroll.
    let kept = 0;
    for (let i = 0; i < total; i += 1) {
      const move = out[i];
      if (move !== undefined && isCapture(move)) out[kept++] = move;
    }
    return kept;
  }

  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const piece = game.slots[slot];
    if (piece === null || piece === undefined || piece.seat !== seat) continue;
    count = movesFrom(out, count, game, slot);
  }

  let captures = 0;
  for (let i = 0; i < count; i += 1) {
    const move = out[i];
    if (move !== undefined && isCapture(move)) captures += 1;
  }
  if (captures === 0) return count;

  let kept = 0;
  for (let i = 0; i < count; i += 1) {
    const move = out[i];
    if (move !== undefined && isCapture(move)) out[kept++] = move;
  }
  return kept;
}

/** Scratch for legality checks, so asking a question never allocates. */
const legalScratch: Move[] = new Array<Move>(64);

export function isLegalMove(game: Game, from: number, to: number): boolean {
  const count = legalMoves(legalScratch, game);
  for (let i = 0; i < count; i += 1) {
    const move = legalScratch[i];
    if (move !== undefined && move.from === from && move.to === to) return true;
  }
  return false;
}

/**
 * Play a move.
 *
 * Returns false for an illegal one, so a caller cannot mistake a refusal for a move that
 * happened to change nothing visible.
 */
export function applyMove(game: Game, from: number, to: number): boolean {
  const count = legalMoves(legalScratch, game);
  let chosen: Move | null = null;
  for (let i = 0; i < count; i += 1) {
    const move = legalScratch[i];
    if (move !== undefined && move.from === from && move.to === to) {
      chosen = move;
      break;
    }
  }
  if (chosen === null) return false;

  const piece = game.slots[from];
  if (piece === null || piece === undefined) return false;

  game.slots[from] = null;
  game.slots[to] = piece;
  if (chosen.captured >= 0) game.slots[chosen.captured] = null;

  // Crowning ends the turn even mid-chain: a man that reaches the far row becomes a king
  // and stops there. Letting it carry on jumping as a king would be a free extra move
  // conjured out of the promotion.
  const crowned = piece.kind === 'man' && rowOf(to) === crownRowOf(piece.seat);
  if (crowned) piece.kind = 'king';

  if (!crowned && chosen.captured >= 0 && hasCaptureFrom(game, to)) {
    game.chain = to;
    return true;
  }

  game.chain = -1;
  game.toMove = otherOf(game.toMove);
  return true;
}

/** Scratch for the chain check. */
const chainScratch: Move[] = new Array<Move>(8);

/** Whether the piece in `slot` could jump again. */
export function hasCaptureFrom(game: Game, slot: number): boolean {
  const count = movesFrom(chainScratch, 0, game, slot);
  for (let i = 0; i < count; i += 1) {
    const move = chainScratch[i];
    if (move !== undefined && isCapture(move)) return true;
  }
  return false;
}

export interface Tally {
  readonly p1: number;
  readonly p2: number;
}

/** Pieces captured by each seat, which is what the shell's HUD shows. */
export function tallyOf(game: Game): Tally {
  let p1Left = 0;
  let p2Left = 0;
  for (const slot of game.slots) {
    if (slot === null) continue;
    if (slot.seat === 'p1') p1Left += 1;
    else p2Left += 1;
  }
  return { p1: PIECES_PER_SEAT - p2Left, p2: PIECES_PER_SEAT - p1Left };
}

/**
 * Who has won, or null while the game is live.
 *
 * A seat loses when it has no pieces **or no legal move**. Being stalemated is a loss in
 * checkers rather than a draw, which is not obvious and is the sort of thing a player
 * only discovers by being on the wrong end of it.
 */
export function winnerOf(game: Game): SeatId | 'draw' | null {
  let p1 = 0;
  let p2 = 0;
  for (const slot of game.slots) {
    if (slot === null) continue;
    if (slot.seat === 'p1') p1 += 1;
    else p2 += 1;
  }
  if (p1 === 0 && p2 === 0) return 'draw';
  if (p1 === 0) return 'p2';
  if (p2 === 0) return 'p1';
  if (legalMoves(legalScratch, game) === 0) return otherOf(game.toMove);
  return null;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export const BLUNDER_CHANCE: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 0.5,
  normal: 0.16,
  hard: 0,
});

export const SEARCH_DEPTH: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 1,
  normal: 3,
  hard: 5,
});

/** A king is worth appreciably more than a man, because it is. */
const MAN_VALUE = 10;
const KING_VALUE = 17;

/**
 * Score a position from `seat`'s point of view.
 *
 * Material dominates, as it should. Two positional terms carry the rest: advancing a man
 * is worth a little because it is progress towards a crown, and a piece on the edge is
 * worth a little more because it can never be captured there.
 */
export function evaluate(game: Game, seat: SeatId): number {
  let score = 0;
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const piece = game.slots[slot];
    if (piece === null || piece === undefined) continue;
    const sign = piece.seat === seat ? 1 : -1;
    let value = piece.kind === 'king' ? KING_VALUE : MAN_VALUE;
    if (piece.kind === 'man') {
      // How far this man has come, in rows, towards its crown.
      const row = rowOf(slot);
      const advanced = piece.seat === 'p1' ? BOARD_SIZE - 1 - row : row;
      value += advanced * 0.4;
    }
    const column = columnOf(slot);
    if (column === 0 || column === BOARD_SIZE - 1) value += 1;
    score += sign * value;
  }
  return score;
}

/** One game state per ply, reused across the search so no node allocates. */
const SEARCH_PLIES = 12;
const searchStates: Game[] = Array.from({ length: SEARCH_PLIES }, () => createGame());
const moveBuffers: Move[][] = Array.from({ length: SEARCH_PLIES }, () => new Array<Move>(64));

function copyInto(target: Game, source: Game): void {
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const piece = source.slots[i];
    if (piece === null || piece === undefined) {
      target.slots[i] = null;
      continue;
    }
    const existing = target.slots[i];
    // Reused in place where possible, so a deep search does not allocate a piece per node.
    if (existing !== null && existing !== undefined && existing.seat === piece.seat) {
      existing.kind = piece.kind;
    } else {
      target.slots[i] = { seat: piece.seat, kind: piece.kind };
    }
  }
  target.toMove = source.toMove;
  target.chain = source.chain;
}

function search(game: Game, depth: number, ply: number, alpha: number, beta: number): number {
  const decided = winnerOf(game);
  if (decided !== null) {
    if (decided === 'draw') return 0;
    return decided === game.toMove ? 10_000 - ply : -(10_000 - ply);
  }
  if (depth === 0 || ply >= SEARCH_PLIES - 1) return evaluate(game, game.toMove);

  const buffer = moveBuffers[ply] ?? [];
  const count = legalMoves(buffer, game);
  if (count === 0) return -(10_000 - ply);

  const next = searchStates[ply] ?? game;
  const mover = game.toMove;
  let best = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const move = buffer[i];
    if (move === undefined) continue;
    copyInto(next, game);
    applyMove(next, move.from, move.to);
    // A jump chain does not pass the turn, so the same seat keeps searching at this sign.
    const score =
      next.toMove === mover
        ? search(next, depth - 1, ply + 1, alpha, beta)
        : -search(next, depth - 1, ply + 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * The move a bot plays, or null when it has none.
 *
 * Every tier sees exactly the board a human sees. Difficulty is search depth and blunder
 * rate, never extra information.
 */
export function bestMove(game: Game, rng: Rng, difficulty: BotDifficulty): Move | null {
  const buffer = moveBuffers[0] ?? [];
  const count = legalMoves(buffer, game);
  if (count === 0) return null;

  if (rng.bool(BLUNDER_CHANCE[difficulty])) return buffer[rng.int(0, count)] ?? null;

  const depth = SEARCH_DEPTH[difficulty];
  const next = searchStates[0] ?? game;
  const mover = game.toMove;
  let best: Move | null = buffer[0] ?? null;
  let bestScore = -Infinity;

  for (let i = 0; i < count; i += 1) {
    const move = buffer[i];
    if (move === undefined) continue;
    copyInto(next, game);
    applyMove(next, move.from, move.to);
    const score =
      next.toMove === mover
        ? search(next, depth - 1, 1, -Infinity, Infinity)
        : -search(next, depth - 1, 1, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}
