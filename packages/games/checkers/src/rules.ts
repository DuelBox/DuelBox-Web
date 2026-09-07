import type { Rng, SeatId } from '@duelbox/engine';
import { DEFAULT_SEARCH_NODES, SearchBudget } from '@duelbox/game-sdk';

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
  /**
   * Plies since the last capture or man move — the forty-move rule's counter.
   *
   * See {@link IDLE_PLIES_DRAW}. A man move is progress because a man can only go forward
   * and must eventually crown or be taken; a king move on its own is not progress at all.
   */
  idlePlies: number;
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
    idlePlies: 0,
  };
  resetGame(game);
  return game;
}

/**
 * The opener is the shell's `context.openingSeat`, never a literal `p1`: the SDK
 * alternates it across the rounds of a best-of so first-mover advantage washes out
 * (#2466), and a game that assumed seat one would leave that rotation reaching nothing.
 * The default exists only so the rules tests can name a concrete side.
 */
export function resetGame(game: Game, opener: SeatId = 'p1'): void {
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const row = rowOf(slot);
    // Three rows each, with two empty rows between them.
    if (row < 3) game.slots[slot] = { seat: 'p2', kind: 'man' };
    else if (row > 4) game.slots[slot] = { seat: 'p1', kind: 'man' };
    else game.slots[slot] = null;
  }
  game.toMove = opener;
  game.chain = -1;
  game.idlePlies = 0;
}

/**
 * The four diagonal steps, **in the moving seat's own frame**.
 *
 * Each entry is `[ahead, across]` as the mover sees the board, and a global row/column
 * delta is `[ahead * f, across * f]` where `f` is {@link forwardOf} — so a given entry is
 * the same side of the board to whichever seat is moving, once the board is turned round.
 * Written the obvious
 * way — one fixed list of global deltas, walked in the same order for both seats — move
 * generation is *not* covariant under the half turn that maps one seat's board onto the
 * other's: mirroring a position reverses the generated list rather than mirroring it, and
 * everything downstream that breaks a tie by taking the first-listed move then prefers one
 * seat's direction of travel over the other's. That was worth 8 points of seat balance
 * (#2502). Keeping the order in the mover's frame is what makes the two seats the same
 * player facing opposite ways.
 */
const DIAGONALS: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
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

  const facing = forwardOf(piece.seat);
  for (const [ahead, across] of DIAGONALS) {
    const dr = ahead * facing;
    const dc = across * facing;
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

  // Walked from the mover's own back rank forward, for the same reason the diagonals are
  // kept in the mover's frame: slot order is board order, and board order runs towards one
  // seat and away from the other. Ascending for p2, whose back rank is row 0; descending
  // for p1, whose back rank is row 7.
  const ascending = forwardOf(seat) === 1;
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const slot = ascending ? i : SLOT_COUNT - 1 - i;
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

  // Counted before the piece is crowned, because a crowning move is a man move.
  game.idlePlies = chosen.captured >= 0 || piece.kind === 'man' ? 0 : game.idlePlies + 1;

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
 * Forty moves each without a capture or a man move, and the game is a draw.
 *
 * This is the standard forty-move rule, and until #2502 this game did not have it: the
 * SPEC's "not specified here" section said a long endgame would be "settled by the shell's
 * round timer instead", and nothing in the simulation ends a match on that timer. Nothing
 * ended it at all.
 *
 * It was invisible while the bot was lopsided. A search whose tie-break quietly favoured
 * one seat's direction of travel is a search the two seats do not share, and two different
 * players break a shuffle sooner or later. Making the two seats the same player — which is
 * the whole of the seat-balance fix — made them shuffle in step: six kings, 944 plies with
 * no capture and no man move, one position reached thirty-one times, and 84 matches in 100
 * still running after ten simulated minutes. So the rule that was missing had been load-
 * bearing on an accident, and this is it stated outright.
 *
 * Forty moves per seat is eighty plies, which is the tournament figure for English
 * draughts. A man move counts as progress because a man cannot go backwards and so must
 * crown or be taken; a king shuffling between two squares is not progress by any reading.
 */
export const IDLE_PLIES_DRAW = 80;

/**
 * Who has won, or null while the game is live.
 *
 * A seat loses when it has no pieces **or no legal move**. Being stalemated is a loss in
 * checkers rather than a draw, which is not obvious and is the sort of thing a player
 * only discovers by being on the wrong end of it. A game that stops making progress is a
 * draw — see {@link IDLE_PLIES_DRAW}.
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
  if (game.idlePlies >= IDLE_PLIES_DRAW) return 'draw';
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

/**
 * Piece values, in fifths of a man.
 *
 * **Every term here is a whole number, and that is the point.** The scale used to be
 * `man = 10`, `king = 17`, two fifths of a point per row advanced and one point for the
 * edge — and two fifths is `0.4`, which has no exact binary representation. Two dozen
 * multiples of it, summed in slot order, land a few times `Number.EPSILON` away from the
 * true total, and *which* way they land depends on the order the terms were added in. A
 * position and its half-turn mirror sum the identical terms in opposite orders, so the
 * opening position scored `+7.1e-15` from one seat and `-7.1e-15` from the other: the same
 * `-0`-shaped defect this repository has already found in Chess, on the position every
 * match starts from. Downstream, `score > bestScore` is a strict comparison, so a
 * fifteenth-decimal-place difference is enough to pick a different move for one seat.
 *
 * Scaling by five removes the fraction rather than papering over it, and integer sums are
 * exact in any order at these magnitudes. The ratios, and therefore the bot, are unchanged.
 */
const MAN_VALUE = 50;
const KING_VALUE = 85;
/** Per row a man has advanced towards its crown — a twenty-fifth of a man, as before. */
const ADVANCE_VALUE = 2;
/** For a piece on a file it can never be captured from — a tenth of a man, as before. */
const EDGE_VALUE = 5;

/**
 * Score a position from `seat`'s point of view.
 *
 * Material dominates, as it should. Two positional terms carry the rest: advancing a man
 * is worth a little because it is progress towards a crown, and a piece on the edge is
 * worth a little more because it can never be captured there.
 *
 * The result is always a whole number — see {@link MAN_VALUE}.
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
      value += advanced * ADVANCE_VALUE;
    }
    const column = columnOf(slot);
    if (column === 0 || column === BOARD_SIZE - 1) value += EDGE_VALUE;
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
  target.idlePlies = source.idlePlies;
}

function search(
  game: Game,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  budget: SearchBudget,
): number {
  // Charged on every node, leaves included: leaves are the overwhelming majority of the
  // work, and charging only internal nodes puts the ceiling above the thing it limits.
  if (!budget.spend()) return evaluate(game, game.toMove);
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
        ? search(next, depth - 1, ply + 1, alpha, beta, budget)
        : -search(next, depth - 1, ply + 1, -beta, -alpha, budget);
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

  const next = searchStates[0] ?? game;
  const mover = game.toMove;
  const budget = new SearchBudget(DEFAULT_SEARCH_NODES);

  /** One full sweep at a fixed depth, or null when the budget ran out part-way. */
  const sweep = (depth: number): Move | null | undefined => {
    let best: Move | null = buffer[0] ?? null;
    let bestScore = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const move = buffer[i];
      if (move === undefined) continue;
      copyInto(next, game);
      applyMove(next, move.from, move.to);
      const score =
        next.toMove === mover
          ? search(next, depth - 1, 1, -Infinity, Infinity, budget)
          : -search(next, depth - 1, 1, -Infinity, Infinity, budget);
      if (budget.exhausted) return undefined;
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  };

  // Iterative deepening under a node budget rather than one sweep at a fixed depth. A
  // partial depth is thrown away: half a ply is not an opinion, it is whichever moves
  // happened to be generated first.
  let found: Move | null = buffer[0] ?? null;
  for (let depth = 1; depth <= SEARCH_DEPTH[difficulty]; depth += 1) {
    const move = sweep(depth);
    if (move === undefined) break;
    found = move;
    if (budget.exhausted) break;
  }
  return found;
}
