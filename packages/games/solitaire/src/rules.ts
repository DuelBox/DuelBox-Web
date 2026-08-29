import { otherSeat } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import { DEFAULT_SEARCH_NODES, SearchBudget, deepen, resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Solitaire, as a duel — pure rules.
 *
 * No rendering, no timing, no DOM. The game, the bot and the balance harness all drive this
 * module, so what a harness measures is what a player feels.
 *
 * The name means *alone*, and that is the whole problem. Everything below the deal itself is
 * an answer to it, and one rule carries the answer:
 *
 * > **Every move must open the board.** You must move, and every legal move either sends a
 * > card up to a foundation, turns a face-down card over, or turns the stock. There is no
 * > shuffling cards about and there is no waiting. Whatever you do, your opponent sees more
 * > afterwards than they did before — the game is choosing *which* thing to hand them.
 *
 * Two seats take turns on **one deal**: one tableau, one stock, one waste, four shared
 * foundations. A card you send up scores **its face value to you** (ace 1, king 13) and is
 * gone for them. So the contest is not "can the deal be cleared" — a good pair clears most of
 * it either way, and a duel scored on the thing that saturates is a duel nobody can lose
 * (Sudoku's finding, and it transfers whole). The contest is **the division of the deal**,
 * which does not saturate: fifty-two cards go somewhere, and every one of them goes to exactly
 * one of you.
 *
 * The tension that makes it a game is native to solitaire and needed nothing bolted on: a
 * foundation is built in order, so **the card you send up is the card that unlocks the next one
 * for the other seat**. Take the five of hearts for five points and you have handed them the six
 * for six. Every bank is a gift wrapped round a point, and every card you turn over is a card
 * you dug out for somebody else.
 *
 * ## Why the match cannot fail to end
 *
 * Classic solitaire deadlocks — that is its ordinary ending — and a shuffling loop between two
 * players who both refuse to help is worse than a deadlock, it is forever. The move set is
 * therefore cut down so that {@link potential} strictly increases on every move ever made, and
 * that potential is bounded. There is no turn cap, no clock and nothing to tune: the match ends
 * because the arithmetic runs out, {@link hasAnyMove} answers false and the score stands.
 *
 * ## What the bot may know
 *
 * Face-down cards and the stock are hidden, and {@link chooseMove} is handed a {@link redact}ed
 * position in which they are literally the value {@link HIDDEN}. There is no further argument
 * carrying the real ones. Rule 6 is a property of the data here rather than a habit — see the
 * test that scrambles what is underneath and asserts the bot plays the identical move.
 */

/**
 * `array[index]`, without the `| undefined` that `noUncheckedIndexedAccess` adds.
 *
 * Every array in this file is a fixed-size typed array indexed by a value the code has already
 * bounded, so the compiler's doubt is real in general and false here. One named escape hatch
 * that says so is better than three hundred `as number` casts, each of which would have to be
 * read as a separate claim.
 */
function at(array: Int8Array, index: number): number {
  return array[index] as number;
}

/* ------------------------------------------------------------------------------------ *
 * The deck
 * ------------------------------------------------------------------------------------ */

export const RANKS = 13;
export const SUITS = 4;
export const DECK = RANKS * SUITS;

/** Seven columns, as a solitaire deal has. */
export const COLUMNS = 7;
/** 1 + 2 + ... + 7. The rest of the deck is the stock. */
export const TABLEAU_CARDS = (COLUMNS * (COLUMNS + 1)) / 2;
export const STOCK_SIZE = DECK - TABLEAU_CARDS;
/** How many dealt cards start face down: one is turned up on each column. */
export const FACE_DOWN_START = TABLEAU_CARDS - COLUMNS;
/** No column can ever hold more than the whole deck. */
const MAX_PILE = DECK;

/**
 * How many cards a turn of the stock reveals.
 *
 * The catalogue row ties this to "difficulty". In this package it is **not** the bot's
 * difficulty — SPEC.md argues that at length. It is a property of the deal, shared by both
 * seats, and it ships at one: one is the value at which every card in the stock can still be
 * reached (there is no redeal), and it is what makes turning the stock a *decision* rather than
 * a formality, because the one card it turns buries the one that was showing.
 */
export const REVEAL_COUNT = 1;

/** No card. */
export const NONE = -1;
/** A card whose identity the reader is not entitled to: face down, or still in the stock. */
export const HIDDEN = -2;

/** 0 spades, 1 clubs — black; 2 hearts, 3 diamonds — red. So colour is just `suit >> 1`. */
export function suitOf(card: number): number {
  return (card / RANKS) | 0;
}

/** 0 for an ace, 12 for a king. */
export function rankOf(card: number): number {
  return card % RANKS;
}

export function colourOf(card: number): number {
  return suitOf(card) >> 1;
}

/**
 * What a card is worth to whoever sends it up: ace 1, ten 10, king 13.
 *
 * Face value rather than one point a card, and the difference is measured in SPEC.md. One a
 * card leaves the two seats' totals differing only by parity and draws a fifth of its matches;
 * face value gives the score enough resolution to separate two good players, and it puts the
 * stakes at the top of a foundation, which is where the tension already is.
 */
export function valueOf(card: number): number {
  return rankOf(card) + 1;
}

/* ------------------------------------------------------------------------------------ *
 * A position
 * ------------------------------------------------------------------------------------ */

/**
 * Everything a move can be made against.
 *
 * Typed arrays throughout, so a search copies a whole position with `set` and nothing on a
 * per-step path ever allocates.
 */
export interface Position {
  /** Column-major, `column * MAX_PILE + depth`; index 0 is the bottom of the pile. */
  readonly pile: Int8Array;
  readonly pileLen: Int8Array;
  /** How many of each column's top cards are face up. A non-empty column always has one. */
  readonly faceUp: Int8Array;
  /** Turned from the top, at index `stockLeft - 1`. */
  readonly stock: Int8Array;
  stockLeft: number;
  /** A face-up pile; only its last entry can be played. */
  readonly waste: Int8Array;
  wasteLen: number;
  /** How many cards are up in each suit: 0 for none, 13 for a finished foundation. */
  readonly foundation: Int8Array;
  p1: number;
  p2: number;
  active: SeatId;
}

export function createPosition(): Position {
  return {
    pile: new Int8Array(COLUMNS * MAX_PILE),
    pileLen: new Int8Array(COLUMNS),
    faceUp: new Int8Array(COLUMNS),
    stock: new Int8Array(DECK),
    stockLeft: 0,
    waste: new Int8Array(DECK),
    wasteLen: 0,
    foundation: new Int8Array(SUITS),
    p1: 0,
    p2: 0,
    active: 'p1',
  };
}

export function copyPosition(out: Position, from: Position): void {
  out.pile.set(from.pile);
  out.pileLen.set(from.pileLen);
  out.faceUp.set(from.faceUp);
  out.stock.set(from.stock);
  out.stockLeft = from.stockLeft;
  out.waste.set(from.waste);
  out.wasteLen = from.wasteLen;
  out.foundation.set(from.foundation);
  out.p1 = from.p1;
  out.p2 = from.p2;
  out.active = from.active;
}

/** The card on top of a column, or {@link NONE}. Always face up when it exists. */
export function topOf(pos: Position, column: number): number {
  const length = at(pos.pileLen, column);
  if (length === 0) return NONE;
  return at(pos.pile, column * MAX_PILE + length - 1);
}

/** The `depth`-th card up from the bottom of a column. {@link HIDDEN} in a redacted position. */
export function cardAt(pos: Position, column: number, depth: number): number {
  return at(pos.pile, column * MAX_PILE + depth);
}

/** How many of a column's cards are still face down. */
export function faceDownIn(pos: Position, column: number): number {
  return at(pos.pileLen, column) - at(pos.faceUp, column);
}

/** The deepest face-up card of a column — the one a whole-run move has to land on. */
export function runBottom(pos: Position, column: number): number {
  const up = at(pos.faceUp, column);
  if (up === 0) return NONE;
  return at(pos.pile, column * MAX_PILE + at(pos.pileLen, column) - up);
}

export function wasteTop(pos: Position): number {
  return pos.wasteLen === 0 ? NONE : at(pos.waste, pos.wasteLen - 1);
}

/** How many cards are on the foundations altogether. Nought to fifty-two. */
export function banked(pos: Position): number {
  let total = 0;
  for (let suit = 0; suit < SUITS; suit += 1) total += at(pos.foundation, suit);
  return total;
}

export function faceDownTotal(pos: Position): number {
  let total = 0;
  for (let column = 0; column < COLUMNS; column += 1) total += faceDownIn(pos, column);
  return total;
}

/**
 * The quantity that makes this game unable to run for ever.
 *
 * Every legal move raises it by at least one, and nothing can lower it:
 *
 * | move | what changes | potential |
 * |---|---|---|
 * | turn the stock (`R` cards) | stock −R, waste +R | +R |
 * | send the waste's card up | banked +1, waste −1 | +3 |
 * | send a column's card up | banked +1, sometimes a card turns over | +2 or +3 |
 * | lay the waste's card on a column | waste −1 | +1 |
 * | move a column's run onto another | a card turns over | +1 |
 *
 * It starts at {@link STOCK_SIZE} and cannot pass {@link MAX_POTENTIAL}, so no match can run
 * past 173 moves whatever anybody does. The last column of that table is also *why* there is
 * no move that merely rearranges the tableau: a move that changed nothing here would be a move
 * two players could make at each other for ever, which is precisely the position classic
 * solitaire is built to reach.
 */
export function potential(pos: Position): number {
  return (
    2 * banked(pos) +
    (FACE_DOWN_START - faceDownTotal(pos)) +
    2 * (STOCK_SIZE - pos.stockLeft) +
    (STOCK_SIZE - pos.wasteLen)
  );
}

/** The ceiling {@link potential} cannot pass. */
export const MAX_POTENTIAL = 2 * DECK + FACE_DOWN_START + 2 * STOCK_SIZE + STOCK_SIZE;
/** And therefore the most moves a match can possibly hold. */
export const MAX_MOVES = MAX_POTENTIAL - STOCK_SIZE;

/* ------------------------------------------------------------------------------------ *
 * Moves
 * ------------------------------------------------------------------------------------ */

/** Nothing was played — a turn let go, or a match already over. */
export const MOVE_NONE = -1;
/**
 * Turn {@link REVEAL_COUNT} cards from the stock onto the waste.
 *
 * **Illegal while the card showing can go up** — you may not bury a card that is ready. This
 * one line is what makes the game a contest rather than a bonfire, and it was added because the
 * measurement said so rather than because it sounded tidy. Without it, a bot deep enough to see
 * one reply discovers that turning the stock over a live card destroys it for *both* seats: it
 * scores nought instead of handing the opponent something, and nought beats a negative. Two
 * two-ply bots then bank **8.4 cards of fifty-two** between them and finish 10 points to 10 —
 * a duel whose optimal line is mutual destruction. With the rule, the same pair bank 34 and
 * finish in the thirties. SPEC.md has the whole table.
 *
 * Burying is not gone, only made honest: a card that is not *yet* wanted can still be turned
 * under, and choosing to do that is real play, because it costs foresight rather than nothing.
 */
export const MOVE_DRAW = 0;
/** Send the waste's top card up to its foundation. */
export const MOVE_BANK_WASTE = 1;
/** `MOVE_BANK_COLUMN + c`: send column `c`'s top card up. */
export const MOVE_BANK_COLUMN = 2;
/** `MOVE_WASTE_TO_COLUMN + c`: lay the waste's top card on column `c`. */
export const MOVE_WASTE_TO_COLUMN = MOVE_BANK_COLUMN + COLUMNS;
/** `MOVE_COLUMN_TO_COLUMN + from * COLUMNS + to`: move a column's whole face-up run. */
export const MOVE_COLUMN_TO_COLUMN = MOVE_WASTE_TO_COLUMN + COLUMNS;
export const MOVE_COUNT = MOVE_COLUMN_TO_COLUMN + COLUMNS * COLUMNS;

/**
 * Whether `card` may be laid on column `to`.
 *
 * Descending by one and alternating colour — the solitaire rule — and an **empty column takes
 * anything**. Klondike reserves an empty column for a king; this does not, and that is
 * `[ours]`. Every tableau move here already has to turn a card over, which makes this tableau
 * far tighter than Klondike's, and kings-only left boards frozen with cards still to come.
 * SPEC.md has the measurement.
 */
export function canStack(pos: Position, card: number, to: number): boolean {
  if (card < 0) return false;
  const top = topOf(pos, to);
  if (top === NONE) return true;
  if (top < 0) return false;
  return rankOf(top) === rankOf(card) + 1 && colourOf(top) !== colourOf(card);
}

/** Whether a card is the next one its own foundation wants. */
export function goesUp(pos: Position, card: number): boolean {
  if (card < 0) return false;
  return at(pos.foundation, suitOf(card)) === rankOf(card);
}

export function isLegal(pos: Position, move: number): boolean {
  if (!Number.isInteger(move) || move < 0 || move >= MOVE_COUNT) return false;

  // The stock is not a bin. See {@link canDraw}.
  if (move === MOVE_DRAW) return pos.stockLeft > 0 && !goesUp(pos, wasteTop(pos));
  if (move === MOVE_BANK_WASTE) return goesUp(pos, wasteTop(pos));
  if (move < MOVE_WASTE_TO_COLUMN) return goesUp(pos, topOf(pos, move - MOVE_BANK_COLUMN));
  if (move < MOVE_COLUMN_TO_COLUMN) {
    return canStack(pos, wasteTop(pos), move - MOVE_WASTE_TO_COLUMN);
  }

  const pair = move - MOVE_COLUMN_TO_COLUMN;
  const from = (pair / COLUMNS) | 0;
  const to = pair % COLUMNS;
  if (from === to) return false;
  if (at(pos.faceUp, from) === 0) return false;
  // The move must turn a card over. Without this line, two players could push one run back
  // and forth between two columns until the sun went out.
  if (faceDownIn(pos, from) === 0) return false;
  return canStack(pos, runBottom(pos, from), to);
}

/**
 * Every legal move, written into a caller-supplied buffer. Returns how many there are.
 *
 * The order is deliberate: banks, then the tableau, then the waste, and **the stock last**. A
 * tier shallow enough to score several moves the same takes the first of them, and turning the
 * stock is the one move in this game that can destroy value outright — it buries whatever was
 * showing. A bot reaching for it on every tie would be weak in a way that also made every
 * match short.
 */
export function legalMoves(out: Int8Array, pos: Position): number {
  let count = 0;
  if (isLegal(pos, MOVE_BANK_WASTE)) out[count++] = MOVE_BANK_WASTE;
  for (let column = 0; column < COLUMNS; column += 1) {
    const move = MOVE_BANK_COLUMN + column;
    if (isLegal(pos, move)) out[count++] = move;
  }
  for (let from = 0; from < COLUMNS; from += 1) {
    for (let to = 0; to < COLUMNS; to += 1) {
      const move = MOVE_COLUMN_TO_COLUMN + from * COLUMNS + to;
      if (isLegal(pos, move)) out[count++] = move;
    }
  }
  for (let column = 0; column < COLUMNS; column += 1) {
    const move = MOVE_WASTE_TO_COLUMN + column;
    if (isLegal(pos, move)) out[count++] = move;
  }
  if (isLegal(pos, MOVE_DRAW)) out[count++] = MOVE_DRAW;
  return count;
}

/**
 * Whether the seat to move has anything at all to do. Both seats face the same board, so this
 * is also the question of whether the deal is finished.
 *
 * A position with cards in the stock always answers true, whichever way the draw rule falls:
 * the stock is only shut when the card showing can go up, and that is itself a move.
 */
export function hasAnyMove(pos: Position): boolean {
  if (pos.stockLeft > 0) return true;
  if (isLegal(pos, MOVE_BANK_WASTE)) return true;
  for (let column = 0; column < COLUMNS; column += 1) {
    if (isLegal(pos, MOVE_BANK_COLUMN + column)) return true;
    if (isLegal(pos, MOVE_WASTE_TO_COLUMN + column)) return true;
  }
  for (let from = 0; from < COLUMNS; from += 1) {
    for (let to = 0; to < COLUMNS; to += 1) {
      if (isLegal(pos, MOVE_COLUMN_TO_COLUMN + from * COLUMNS + to)) return true;
    }
  }
  return false;
}

function pushCard(pos: Position, column: number, card: number): void {
  pos.pile[column * MAX_PILE + at(pos.pileLen, column)] = card;
  pos.pileLen[column] = at(pos.pileLen, column) + 1;
}

function popCard(pos: Position, column: number): number {
  const length = at(pos.pileLen, column) - 1;
  pos.pileLen[column] = length;
  const card = at(pos.pile, column * MAX_PILE + length);
  const up = at(pos.faceUp, column) - 1;
  // A non-empty column always shows a card: taking the last face-up one turns the next over.
  pos.faceUp[column] = up === 0 && length > 0 ? 1 : up;
  return card;
}

function award(pos: Position, seat: SeatId, points: number): void {
  if (seat === 'p1') pos.p1 += points;
  else pos.p2 += points;
}

/**
 * Play a legal move and hand the turn over. Returns the card that went up, or {@link NONE}.
 *
 * Assumes legality — {@link play} and the bot both ask first. Deliberately usable on a redacted
 * position, which is how a search explores without ever learning a hidden card: turning one
 * over there yields {@link HIDDEN}, exactly as it does for a person watching.
 */
export function applyMove(pos: Position, move: number, reveal: number): number {
  const mover = pos.active;
  let sent = NONE;

  if (move === MOVE_DRAW) {
    const take = Math.min(reveal, pos.stockLeft);
    for (let i = 0; i < take; i += 1) {
      pos.stockLeft -= 1;
      pos.waste[pos.wasteLen] = at(pos.stock, pos.stockLeft);
      pos.wasteLen += 1;
    }
  } else if (move === MOVE_BANK_WASTE) {
    pos.wasteLen -= 1;
    sent = at(pos.waste, pos.wasteLen);
    pos.foundation[suitOf(sent)] = at(pos.foundation, suitOf(sent)) + 1;
    award(pos, mover, valueOf(sent));
  } else if (move < MOVE_WASTE_TO_COLUMN) {
    sent = popCard(pos, move - MOVE_BANK_COLUMN);
    pos.foundation[suitOf(sent)] = at(pos.foundation, suitOf(sent)) + 1;
    award(pos, mover, valueOf(sent));
  } else if (move < MOVE_COLUMN_TO_COLUMN) {
    const to = move - MOVE_WASTE_TO_COLUMN;
    pos.wasteLen -= 1;
    pushCard(pos, to, at(pos.waste, pos.wasteLen));
    pos.faceUp[to] = at(pos.faceUp, to) + 1;
  } else {
    const pair = move - MOVE_COLUMN_TO_COLUMN;
    const from = (pair / COLUMNS) | 0;
    const to = pair % COLUMNS;
    const run = at(pos.faceUp, from);
    const base = from * MAX_PILE + at(pos.pileLen, from) - run;
    for (let i = 0; i < run; i += 1) pushCard(pos, to, at(pos.pile, base + i));
    pos.faceUp[to] = at(pos.faceUp, to) + run;
    pos.pileLen[from] = at(pos.pileLen, from) - run;
    // `isLegal` only offers this move when there is a card underneath to turn over.
    pos.faceUp[from] = 1;
  }

  pos.active = otherSeat(mover);
  return sent;
}

/* ------------------------------------------------------------------------------------ *
 * The deal
 * ------------------------------------------------------------------------------------ */

const orderScratch = new Int8Array(DECK);
const destScratch = new Int8Array(DECK);
const stockScratch = new Int8Array(DECK);
const suitNext = new Int8Array(SUITS);
const placed = new Int8Array(COLUMNS);

/** A uniformly random interleaving of the four ace-to-king runs. */
function buildOrder(out: Int8Array, rng: Rng): void {
  for (let i = 0; i < DECK; i += 1) out[i] = (i / RANKS) | 0;
  for (let i = DECK - 1; i > 0; i -= 1) {
    const j = rng.int(0, i + 1);
    const swap = at(out, i);
    out[i] = at(out, j);
    out[j] = swap;
  }
  suitNext.fill(0);
  for (let i = 0; i < DECK; i += 1) {
    const suit = at(out, i);
    out[i] = suit * RANKS + at(suitNext, suit);
    suitNext[suit] = at(suitNext, suit) + 1;
  }
}

/* ------------------------------------------------------------------------------------ *
 * The match
 * ------------------------------------------------------------------------------------ */

export interface MatchState extends Position {
  /** 0 nobody, 1 seat one, 2 seat two — for each of the fifty-two cards. */
  readonly owner: Int8Array;
  /**
   * The order in which this deal *can* be sent up in full, straight from the generator.
   *
   * Never handed to a bot and never read by the game: it exists so a test can replay the clear
   * and prove the deal is winnable. {@link chooseMove} has no argument through which this could
   * reach a tier, which is the only guarantee worth having.
   */
  readonly solution: Int8Array;
  readonly reveal: number;
  /** Consecutive turns let go. Two in a row and the deal is over: nobody will touch it. */
  passes: number;
  turns: number;
  over: boolean;
  /** The last move played and the card it sent up, for the reveal and for the tests. */
  lastMove: number;
  lastCard: number;
}

/**
 * A fresh deal from a seed.
 *
 * **The deal is generated by choosing how it will be cleared and then laying it out to suit.**
 * A shuffled solitaire deal is unwinnable a good fraction of the time and there is no cheap way
 * to tell which, so the deck is never shuffled into the tableau at all:
 *
 * 1. Pick a uniformly random interleaving of the four ace-to-king runs. That sequence is the
 *    order this deal can be sent up in.
 * 2. Deal the fifty-two positions of that sequence uniformly at random across the twenty-eight
 *    tableau slots and the twenty-four stock slots.
 * 3. Lay each column out so its earliest card in the sequence is on **top**, and lay the stock
 *    out so its cards come off in sequence order — with each turn's batch reversed, because the
 *    waste is a pile and the card showing is the last one turned.
 *
 * The clear is then trivial to state and impossible to miss: walk the sequence, and the next
 * card is always the top of some column or the next thing the stock will show. Nothing has to
 * be moved about the tableau at all. A test replays exactly that against the shipped move rules
 * and asserts all fifty-two go up.
 *
 * What this does **not** promise is that the clear survives two players. Turning the stock while
 * the waste still holds an unplayed card buries it, and a buried card only comes back when
 * whatever covers it is played. That is the game, and it is why a draw is a decision.
 *
 * `openingSeat` is read rather than assumed: the shell alternates it across the rounds of a
 * best-of so first-mover advantage washes out.
 */
export function createMatch(
  rng: Rng,
  openingSeat: SeatId = 'p1',
  reveal: number = REVEAL_COUNT,
): MatchState {
  const state: MatchState = {
    ...createPosition(),
    owner: new Int8Array(DECK),
    solution: new Int8Array(DECK),
    reveal: Math.max(1, Math.floor(reveal)),
    passes: 0,
    turns: 0,
    over: false,
    lastMove: MOVE_NONE,
    lastCard: NONE,
  };

  buildOrder(orderScratch, rng);
  state.solution.set(orderScratch);

  // Destinations: column 0 once, column 1 twice, ... column 6 seven times, then the stock.
  let at0 = 0;
  for (let column = 0; column < COLUMNS; column += 1) {
    for (let k = 0; k <= column; k += 1) destScratch[at0++] = column;
  }
  while (at0 < DECK) destScratch[at0++] = COLUMNS;
  for (let i = DECK - 1; i > 0; i -= 1) {
    const j = rng.int(0, i + 1);
    const swap = at(destScratch, i);
    destScratch[i] = at(destScratch, j);
    destScratch[j] = swap;
  }

  for (let column = 0; column < COLUMNS; column += 1) {
    state.pileLen[column] = column + 1;
    state.faceUp[column] = 1;
  }
  placed.fill(0);
  let stockCount = 0;
  for (let i = 0; i < DECK; i += 1) {
    const card = at(orderScratch, i);
    const dest = at(destScratch, i);
    if (dest === COLUMNS) {
      // In sequence order for now; the batches are reversed below.
      stockScratch[stockCount++] = card;
      continue;
    }
    // The earliest card of a column goes on top, so sending them up straight down it works.
    const depth = at(state.pileLen, dest) - 1 - at(placed, dest);
    state.pile[dest * MAX_PILE + depth] = card;
    placed[dest] = at(placed, dest) + 1;
  }

  // A turn of the stock pushes its cards onto the waste one at a time, so the last one turned
  // is the one showing — and the one showing has to be the one wanted first. Reverse each
  // batch, then reverse the whole run, because the stock is turned from its own top.
  for (let start = 0; start < stockCount; start += state.reveal) {
    const end = Math.min(start + state.reveal, stockCount);
    for (let i = start, j = end - 1; i < j; i += 1, j -= 1) {
      const swap = at(stockScratch, i);
      stockScratch[i] = at(stockScratch, j);
      stockScratch[j] = swap;
    }
  }
  for (let i = 0; i < stockCount; i += 1) state.stock[stockCount - 1 - i] = at(stockScratch, i);
  state.stockLeft = stockCount;

  state.active = openingSeat;
  return state;
}

/** Play a move. Returns false and changes nothing if it is not legal right now. */
export function play(state: MatchState, move: number): boolean {
  if (state.over) return false;
  if (!isLegal(state, move)) return false;
  const mover = state.active;
  const sent = applyMove(state, move, state.reveal);
  if (sent !== NONE) state.owner[sent] = mover === 'p1' ? 1 : 2;
  state.lastMove = move;
  state.lastCard = sent;
  state.passes = 0;
  state.turns += 1;
  if (!hasAnyMove(state)) state.over = true;
  return true;
}

/**
 * Let the turn go without playing.
 *
 * Not a move a player chooses — the move set has no pass in it, and being obliged to open the
 * board is the whole design. This is what a run-out turn clock does with somebody who has put
 * the phone down, and **two in a row end the deal**: the board did not change, so if neither
 * seat will touch it there is nothing left to play for. Without that, two idle people would
 * hold a tournament match open for ever.
 */
export function letGo(state: MatchState): void {
  if (state.over) return;
  state.lastMove = MOVE_NONE;
  state.lastCard = NONE;
  state.passes += 1;
  state.turns += 1;
  if (state.passes >= 2) {
    state.over = true;
    return;
  }
  state.active = otherSeat(state.active);
  if (!hasAnyMove(state)) state.over = true;
}

export function isOver(state: MatchState): boolean {
  return state.over;
}

/** How many cards a seat has sent up. Shown beside the points, and the first tiebreak. */
export function cardsTaken(state: MatchState, seat: SeatId): number {
  const mark = seat === 'p1' ? 1 : 2;
  let count = 0;
  for (let card = 0; card < DECK; card += 1) {
    if (at(state.owner, card) === mark) count += 1;
  }
  return count;
}

const MATCH_END: WinCondition = { kind: 'highest-when-time-expires' };

/**
 * Most points wins; level on points, more cards; level on both, a draw.
 *
 * The cards tiebreak fires rarely — face value already separates two good players — and it is
 * there so that two seats who land on the same total are told apart by who did more of the
 * work rather than by nothing at all.
 */
export function winnerOf(state: MatchState): SeatId | 'draw' | null {
  if (!state.over) return null;
  const outcome = resolve(MATCH_END, { p1: state.p1, p2: state.p2 }, { timeExpired: true });
  if (outcome !== 'draw') return outcome;
  const one = cardsTaken(state, 'p1');
  const two = cardsTaken(state, 'p2');
  if (one === two) return 'draw';
  return one > two ? 'p1' : 'p2';
}

/* ------------------------------------------------------------------------------------ *
 * The bot
 * ------------------------------------------------------------------------------------ */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * How many plies it looks ahead, **always odd**.
   *
   * One is "what does this move pay me". Three is "…and what I can take back after their best
   * reply". Five is two whole exchanges. Odd on purpose: every line the search weighs ends on a
   * move of its own, so the last thing counted is something this seat could actually do.
   *
   * That is not a detail, it is where all the strength is. Measured in a round-robin of eight
   * profiles, 100 seeds in each of two opening orders per pairing:
   *
   * | plies | 1 | 2 | 3 | 4 | 5 | 6 |
   * |---|---|---|---|---|---|---|
   * | share of everything else | 41.1% | 42.6% | 69.2% | 43.3% | **72.0%** | 46.7% |
   *
   * Two is worth nothing over one and four is worth nothing over two, because an even line stops
   * the instant the opponent has answered and so counts one of their takes for each of yours —
   * which values every bank at roughly nothing and leaves the tier picking by move order.
   */
  readonly plies: number;
  /** How often it takes a move it has already judged is not the best one. */
  readonly slip: number;
}

/**
 * Three tiers on one honest axis and one human one: **how far ahead it looks**, and how often it
 * settles for something it knows is worse.
 *
 * Depth is the right axis because this game is exactly one step beyond greed. Sending a card up
 * pays its face value and unlocks the next card of that suit for the other seat, so a tier that
 * cannot see a reply cannot see the cost of its own best move; `easy` genuinely cannot, and at
 * one ply every non-scoring move looks the same as every other one.
 *
 * Nothing here is information a person could not have — see {@link redact}, which is what the
 * search is actually run against. The tiers differ in how hard they think and how carefully they
 * act, and in nothing else.
 */
export const BOT_PROFILE: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { plies: 1, slip: 0.3 },
  normal: { plies: 3, slip: 0.1 },
  hard: { plies: 5, slip: 0 },
});

/** The deepest line the search will start, whatever a profile asks for. */
const MAX_PLIES = 7;

/**
 * One scratch position and one move buffer per ply, plus a pair for the root.
 *
 * Allocated once at module load. A search allocating per node would break rule 5 outright, and
 * copying a position into a pre-made one is cheaper than unmaking a move by hand: a position is
 * four small typed arrays and `set` is a memcpy.
 */
const plyPosition: Position[] = [];
const plyMoves: Int8Array[] = [];
for (let depth = 0; depth <= MAX_PLIES; depth += 1) {
  plyPosition.push(createPosition());
  plyMoves.push(new Int8Array(MOVE_COUNT));
}
const rootChild = createPosition();
const rootPosition = createPosition();
const rootMoves = new Int8Array(MOVE_COUNT);

/**
 * Copy a position with everything the reader is not entitled to blanked out.
 *
 * Face-down cards and the stock become {@link HIDDEN}, which no rule accepts: a hidden card
 * cannot be sent up, cannot be laid on anything and nothing can be laid on it. A search run
 * against this therefore **cannot** use what is underneath whatever it does — rule 6 is a
 * property of the data the bot is given rather than a claim about how it behaves.
 *
 * The waste is not redacted. Its cards were turned face up in front of both players and stay
 * visible in the fan, so knowing what is buried in it is knowing what everybody watched go by.
 */
export function redact(out: Position, from: Position): void {
  copyPosition(out, from);
  for (let column = 0; column < COLUMNS; column += 1) {
    const down = faceDownIn(from, column);
    for (let depth = 0; depth < down; depth += 1) out.pile[column * MAX_PILE + depth] = HIDDEN;
  }
  for (let i = 0; i < out.stockLeft; i += 1) out.stock[i] = HIDDEN;
}

/**
 * What a position is worth to `me`: the score difference, and nothing else.
 *
 * A second term was written, swept and deleted. `tempo` added a fraction of the best card
 * currently on offer, signed by whose turn it was — an attempt to say "a card left ready is a
 * debt owed to whoever moves next". Swept alone it is flat below 1 and backwards above it, and
 * at exactly 1 it turns out to be **the same thing as one more ply**: a one-ply search with
 * `tempo = 1` and a two-ply search played bit-identical matches across every pairing of the
 * round-robin, because once the stock cannot be used to bury a live card, the best move at a ply
 * is always to take the best card on offer. A knob that is a slower spelling of a knob already
 * there is not a second axis, so it went.
 */
function evaluate(pos: Position, me: SeatId): number {
  return me === 'p1' ? pos.p1 - pos.p2 : pos.p2 - pos.p1;
}

/** Set when the budget runs out, so a half-finished depth is thrown away rather than trusted. */
let aborted = false;

/**
 * Whether the last sweep ran out of budget.
 *
 * Read through a function rather than directly, because the flag is only ever set from inside
 * one — and the compiler, seeing the assignment and the read in the same closure, would
 * otherwise be sure it could not have changed.
 */
function ranOut(): boolean {
  return aborted;
}

function searchValue(
  pos: Position,
  depth: number,
  alpha: number,
  beta: number,
  me: SeatId,
  reveal: number,
  budget: SearchBudget,
): number {
  if (!budget.spend()) {
    aborted = true;
    return 0;
  }
  if (depth === 0) return evaluate(pos, me);

  const moves = plyMoves[depth] as Int8Array;
  const count = legalMoves(moves, pos);
  if (count === 0) return evaluate(pos, me);

  const child = plyPosition[depth] as Position;
  const maximising = pos.active === me;
  let low = alpha;
  let high = beta;
  let best = maximising ? -Infinity : Infinity;

  for (let i = 0; i < count; i += 1) {
    copyPosition(child, pos);
    applyMove(child, at(moves, i), reveal);
    const value = searchValue(child, depth - 1, low, high, me, reveal, budget);
    if (aborted) return Number.isFinite(best) ? best : evaluate(pos, me);
    if (maximising) {
      if (value > best) best = value;
      if (best > low) low = best;
    } else {
      if (value < best) best = value;
      if (best < high) high = best;
    }
    if (low >= high) break;
  }
  return best;
}

/** One full sweep of the root at a fixed depth. */
function rootBest(
  view: Position,
  depth: number,
  me: SeatId,
  reveal: number,
  budget: SearchBudget,
): number {
  const count = legalMoves(rootMoves, view);
  if (count === 0) return MOVE_NONE;
  let best = at(rootMoves, 0);
  let bestValue = -Infinity;
  for (let i = 0; i < count; i += 1) {
    copyPosition(rootChild, view);
    applyMove(rootChild, at(rootMoves, i), reveal);
    const value = searchValue(rootChild, depth - 1, -Infinity, Infinity, me, reveal, budget);
    if (aborted) break;
    if (value > bestValue) {
      bestValue = value;
      best = at(rootMoves, i);
    }
  }
  return best;
}

/**
 * The move a tier plays, chosen against a redacted board.
 *
 * `view` is the only board it sees and `rng` the only randomness it has. Neither the solution
 * order, nor the cards under the tableau, nor the stock is reachable from here — there is no
 * argument that carries them, which is the point.
 *
 * Exactly two values are drawn from the generator every turn, unconditionally and before
 * anything branches, so a seat's play never becomes a function of the position it happens to
 * face or of how its opponent is playing. Returns {@link MOVE_NONE} only when there is nothing
 * to play, which is the same condition that ends the match.
 */
export function chooseMove(
  view: Position,
  rng: Rng,
  difficulty: BotDifficulty,
  reveal: number = REVEAL_COUNT,
): number {
  return chooseWith(view, rng, BOT_PROFILE[difficulty], reveal);
}

/**
 * The same choice against an arbitrary profile.
 *
 * Exists so a knob can be swept on its own with everything else left as shipped, which is the
 * only way to find out what sign it has. Three of the first six games in this repository deleted
 * a knob after measuring one, and two of those ran backwards.
 */
export function chooseWith(
  view: Position,
  rng: Rng,
  profile: BotProfile,
  reveal: number = REVEAL_COUNT,
): number {
  const roll = rng.float();
  const pick = rng.float();

  const count = legalMoves(rootMoves, view);
  if (count === 0) return MOVE_NONE;
  if (roll < profile.slip) return at(rootMoves, Math.min(count - 1, (pick * count) | 0));

  const me = view.active;
  const budget = new SearchBudget(DEFAULT_SEARCH_NODES);
  const exchanges = Math.max(1, Math.min(MAX_PLIES, profile.plies) + 1) >> 1;

  aborted = false;
  if (exchanges <= 1) return rootBest(view, 1, me, reveal, budget);

  // Deepen an exchange at a time — one of mine and one of theirs — so a line cut short by the
  // budget falls back to a shorter *odd* line rather than to an even one, which the table above
  // shows is worth nothing at all.
  const found = deepen(budget, exchanges, (level) => {
    aborted = false;
    const move = rootBest(view, level * 2 - 1, me, reveal, budget);
    return ranOut() ? null : move;
  });
  return found >= 0 ? found : at(rootMoves, 0);
}

/**
 * The move a bot plays against a live match, redacting on the way in.
 *
 * The one entry point `game.ts` uses, so nothing on the game side ever gets the chance to hand
 * a bot the real board by accident.
 */
export function botMove(state: MatchState, rng: Rng, difficulty: BotDifficulty): number {
  redact(rootPosition, state);
  return chooseMove(rootPosition, rng, difficulty, state.reveal);
}
