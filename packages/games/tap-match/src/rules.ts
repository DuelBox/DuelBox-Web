import { Rng, otherSeat } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * The whole of Tap Match, in logical units and nothing else.
 *
 * No rendering, no DOM, no pixels: the game, the bot, the tests and the balance harness
 * all read the table through these functions, so there is exactly one definition of what
 * a legal take is, of when a rack overflows, and of who has won.
 *
 * The board shape is a parameter throughout. Nothing here assumes the shipped six piles
 * of nine, so a bigger table is a different argument rather than a different file — which
 * is how the shape below was chosen rather than guessed.
 */

/* ------------------------------------------------------------------ the table */

export interface BoardShape {
  /** How many piles sit on the board. Exactly one card of each is face up. */
  readonly piles: number;
  /** How many cards a pile holds when the match starts. */
  readonly depth: number;
  /** How many distinct card kinds the deck is made of. */
  readonly kinds: number;
}

/**
 * The shipped table: six piles of fifteen, nine kinds, ten copies of each.
 *
 * Three properties of this shape are load-bearing and none is decoration.
 *
 * **Ninety is even**, so a match that ran the board right out would give both seats
 * exactly forty-five cards. An odd board hands the opener one extra card, and with the
 * rack arithmetic in {@link judge} that is not a small edge — it is a guaranteed one.
 *
 * **Six piles** is how many cards you choose between, and it is the number the whole
 * difficulty of the game sits on. A rack at the limit survives only if one of the kinds
 * it holds twice is face up somewhere; six windows onto nine kinds is where that stops
 * being a formality without becoming a lottery.
 *
 * **The board is deliberately deeper than a match needs.** Running it out is possible —
 * it takes twenty-six of the twenty-seven sets the deck can yield, and two `normal` bots
 * manage it in 5.3% of matches — but it is not what usually happens. A rack overflowing
 * is, which is what the reference game is about.
 */
export const SHAPE: BoardShape = Object.freeze({ piles: 6, depth: 15, kinds: 9 });

/** The reference's number, and the whole of the tension: an eighth card kills you. */
export const STACK_LIMIT = 7;

/** Three alike clear. The reference's number too. */
export const SET_SIZE = 3;

/**
 * How long the board is frozen at the start of every turn.
 *
 * Longer than the shell's 0.36 s seat flip on purpose, and it lives here rather than in
 * `game.ts` for the reason Cup Pong and Sudoku both record: `seatView` reports **no
 * rotation at all** in single-seat play, so a freeze keyed off the flip would step one
 * match on a shared phone and a different one on two phones playing remotely.
 *
 * A bot does not go through the shell either, so without this the bot would be choosing
 * while the board was still turning under a person's thumb.
 */
export const READY_SECONDS = 0.5;

/** How long a take is left on screen before the turn passes. */
export const SETTLE_SECONDS = 0.45;

/** How long a bot waits before it takes. Pacing, not difficulty — every tier waits it. */
export const THINK_SECONDS = 0.45;

export type Phase = 'ready' | 'choosing' | 'settling' | 'over';

/** What the last take did, for the drawing and for the tests. */
export type TakeResult = 'none' | 'kept' | 'cleared' | 'overflow';

export interface Game {
  readonly shape: BoardShape;
  /**
   * Kind of every card, pile-major: `cards[p * depth + i]`, with `i` counting up from the
   * bottom of the pile. The face-up card of pile `p` is at `i = remaining[p] - 1`.
   *
   * **Everything below the face-up card is hidden from both seats and from the bot.** It
   * is held here because the simulation has to know it; nothing that chooses a move is
   * ever handed this array. See {@link BoardView}.
   */
  readonly cards: number[];
  /** Cards still in each pile, face-up card included. */
  readonly remaining: number[];
  /** Cards still on the board at all. */
  left: number;

  /** Seat one's rack, sorted by kind, `p1Size` entries live. Capacity is STACK_LIMIT + 1. */
  readonly p1Rack: number[];
  readonly p2Rack: number[];
  p1Size: number;
  p2Size: number;
  p1Sets: number;
  p2Sets: number;

  active: SeatId;
  phase: Phase;
  /** Seconds left of `ready` or `settling`. Zero in the other two phases. */
  timer: number;

  /** The pile the last take came from, or -1 before the first take. */
  lastPile: number;
  /** The kind the last take was, or -1. */
  lastKind: number;
  lastResult: TakeResult;

  /** The seat that opened the match, which is also who opens every round of it. */
  opener: SeatId;
  /** A seat whose rack has overflowed. It takes no further turn. */
  p1Out: boolean;
  p2Out: boolean;
  winner: SeatId | 'draw' | null;

  /**
   * Scratch for {@link resolve}'s `eliminated` list, so judging the match allocates
   * nothing. Length 0 or 1; only ever written when the match ends.
   */
  readonly eliminated: SeatId[];
}

const LAST_STANDING: WinCondition = Object.freeze({ kind: 'last-standing' });
const HIGHEST: WinCondition = Object.freeze({ kind: 'highest-when-time-expires' });

function assertShape(shape: BoardShape): void {
  const { piles, depth, kinds } = shape;
  for (const [name, value] of [
    ['piles', piles],
    ['depth', depth],
    ['kinds', kinds],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer, received ${String(value)}`);
    }
  }
  const total = piles * depth;
  if (total % kinds !== 0) {
    throw new RangeError(`a deck of ${String(total)} does not divide into ${String(kinds)} kinds`);
  }
  if (total % 2 !== 0) {
    throw new RangeError(
      `a deck of ${String(total)} is odd, so the opener would take one more card than the responder`,
    );
  }
}

/** How many copies of each kind a shape deals. */
export function copiesPerKind(shape: BoardShape): number {
  return (shape.piles * shape.depth) / shape.kinds;
}

/** Every array a match needs, allocated once. `resetGame` deals into them. */
export function createGame(shape: BoardShape = SHAPE): Game {
  assertShape(shape);
  const cards: number[] = [];
  for (let i = 0; i < shape.piles * shape.depth; i += 1) cards.push(0);
  const remaining: number[] = [];
  for (let i = 0; i < shape.piles; i += 1) remaining.push(0);
  const rack = (): number[] => {
    const slots: number[] = [];
    for (let i = 0; i <= STACK_LIMIT; i += 1) slots.push(-1);
    return slots;
  };
  return {
    shape,
    cards,
    remaining,
    left: 0,
    p1Rack: rack(),
    p2Rack: rack(),
    p1Size: 0,
    p2Size: 0,
    p1Sets: 0,
    p2Sets: 0,
    active: 'p1',
    phase: 'over',
    timer: 0,
    lastPile: -1,
    lastKind: -1,
    lastResult: 'none',
    opener: 'p1',
    p1Out: false,
    p2Out: false,
    winner: null,
    eliminated: [],
  };
}

/**
 * Deal a fresh table and hand the first turn to `opener`.
 *
 * The shuffle is the match's own seeded generator, so the same seed deals the same table
 * on every device and a replay is identical. Writes into the arrays it already has: a
 * re-deal costs no allocation beyond the deck it shuffles.
 */
export function resetGame(game: Game, rng: Rng, opener: SeatId = 'p1'): void {
  const { piles, depth, kinds } = game.shape;
  const copies = copiesPerKind(game.shape);

  const deck: number[] = [];
  for (let kind = 0; kind < kinds; kind += 1) {
    for (let i = 0; i < copies; i += 1) deck.push(kind);
  }
  rng.shuffle(deck);
  for (let i = 0; i < deck.length; i += 1) game.cards[i] = deck[i] ?? 0;
  for (let p = 0; p < piles; p += 1) game.remaining[p] = depth;
  game.left = piles * depth;

  for (let i = 0; i <= STACK_LIMIT; i += 1) {
    game.p1Rack[i] = -1;
    game.p2Rack[i] = -1;
  }
  game.p1Size = 0;
  game.p2Size = 0;
  game.p1Sets = 0;
  game.p2Sets = 0;

  game.opener = opener;
  game.active = opener;
  game.phase = 'ready';
  game.timer = READY_SECONDS;
  game.lastPile = -1;
  game.lastKind = -1;
  game.lastResult = 'none';
  game.p1Out = false;
  game.p2Out = false;
  game.winner = null;
  game.eliminated.length = 0;
}

/* ------------------------------------------------------------------ reading the table */

/** Kind of the face-up card on a pile, or -1 when the pile is empty or out of range. */
export function frontKind(game: Readonly<Game>, pile: number): number {
  const left = depthOf(game, pile);
  if (left <= 0) return -1;
  return game.cards[pile * game.shape.depth + left - 1] ?? -1;
}

/** Cards left in a pile. Public — a player can see how tall a pile is. */
export function depthOf(game: Readonly<Game>, pile: number): number {
  if (!Number.isInteger(pile) || pile < 0 || pile >= game.shape.piles) return 0;
  return game.remaining[pile] ?? 0;
}

export function rackOf(game: Readonly<Game>, seat: SeatId): readonly number[] {
  return seat === 'p1' ? game.p1Rack : game.p2Rack;
}

export function sizeOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Size : game.p2Size;
}

export function setsOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Sets : game.p2Sets;
}

/** How many of one kind a seat is holding. Both racks are face up on the table. */
export function heldOf(game: Readonly<Game>, seat: SeatId, kind: number): number {
  const rack = rackOf(game, seat);
  const size = sizeOf(game, seat);
  let count = 0;
  for (let i = 0; i < size; i += 1) {
    if (rack[i] === kind) count += 1;
  }
  return count;
}

/**
 * How many different kinds a seat is holding.
 *
 * The tiebreak when the board runs out, and it is the only one that can do any work —
 * see the note on {@link winnerOf}.
 */
export function distinctOf(game: Readonly<Game>, seat: SeatId): number {
  const rack = rackOf(game, seat);
  const size = sizeOf(game, seat);
  let count = 0;
  for (let i = 0; i < size; i += 1) {
    if (i === 0 || rack[i] !== rack[i - 1]) count += 1;
  }
  return count;
}

/** True when this seat could legally take this pile right now. */
export function canTake(game: Readonly<Game>, seat: SeatId, pile: number): boolean {
  if (game.phase !== 'choosing') return false;
  if (seat !== game.active) return false;
  return frontKind(game, pile) >= 0;
}

/* ------------------------------------------------------------------ the move */

/** Insert into a rack sorted by kind, so matching cards always sit together. */
function insertSorted(rack: number[], size: number, kind: number): number {
  let i = size;
  while (i > 0 && (rack[i - 1] ?? -1) > kind) {
    rack[i] = rack[i - 1] ?? -1;
    i -= 1;
  }
  rack[i] = kind;
  return size + 1;
}

/** Drop every card of one kind out of a rack, keeping the rest in order. */
function removeKind(rack: number[], size: number, kind: number): number {
  let write = 0;
  for (let read = 0; read < size; read += 1) {
    const held = rack[read] ?? -1;
    if (held === kind) continue;
    rack[write] = held;
    write += 1;
  }
  for (let i = write; i < rack.length; i += 1) rack[i] = -1;
  return write;
}

function countIn(rack: readonly number[], size: number, kind: number): number {
  let count = 0;
  for (let i = 0; i < size; i += 1) {
    if (rack[i] === kind) count += 1;
  }
  return count;
}

/**
 * Take the face-up card off a pile.
 *
 * Returns false and changes nothing at all when the take is not legal — a pile that is
 * empty, a seat that is not to move, a board that is mid-freeze — so a caller may offer
 * any tap. A refused take costs no turn, exactly as an illegal square costs no turn in
 * Reversi: the alternative is a mis-tap spending a move, which on a shared phone happens
 * to whoever has the larger thumb.
 */
export function take(game: Game, seat: SeatId, pile: number): boolean {
  if (!canTake(game, seat, pile)) return false;
  const left = game.remaining[pile] ?? 0;
  const kind = game.cards[pile * game.shape.depth + left - 1] ?? -1;
  if (kind < 0) return false;

  game.remaining[pile] = left - 1;
  game.left -= 1;
  game.lastPile = pile;
  game.lastKind = kind;

  const rack = seat === 'p1' ? game.p1Rack : game.p2Rack;
  const size = insertSorted(rack, sizeOf(game, seat), kind);

  if (countIn(rack, size, kind) === SET_SIZE) {
    const after = removeKind(rack, size, kind);
    if (seat === 'p1') {
      game.p1Size = after;
      game.p1Sets += 1;
    } else {
      game.p2Size = after;
      game.p2Sets += 1;
    }
    game.lastResult = 'cleared';
  } else if (size > STACK_LIMIT) {
    // The reference's loss condition, and ours: an eighth card with nothing to complete.
    if (seat === 'p1') {
      game.p1Size = size;
      game.p1Out = true;
    } else {
      game.p2Size = size;
      game.p2Out = true;
    }
    game.lastResult = 'overflow';
  } else {
    if (seat === 'p1') game.p1Size = size;
    else game.p2Size = size;
    game.lastResult = 'kept';
  }

  game.phase = 'settling';
  game.timer = SETTLE_SECONDS;
  return true;
}

/**
 * Advance the clocks. The only thing that ever ends a turn is a take, so `choosing`
 * costs nothing and a table nobody touches simply waits.
 */
export function step(game: Game, fixedDeltaSeconds: number): void {
  if (game.phase === 'over' || game.phase === 'choosing') return;
  game.timer -= fixedDeltaSeconds;
  if (game.timer > 0) return;
  game.timer = 0;
  if (game.phase === 'ready') {
    game.phase = 'choosing';
    return;
  }
  finishTurn(game);
}

/**
 * Settle a turn: end the match, or hand the board to the other seat.
 *
 * **A match ends only on a completed round**, and that rule is doing real work here
 * rather than being tidy. The seat that opens acts first in every round, so at the moment
 * the board stops offering either player a card they can survive, the opener is simply
 * the one whose turn it happens to be. Measured without this rule, the opener took 39.1%
 * of decided matches at `easy` — a first-mover *penalty* the size of a whole tier.
 * Letting the responder answer an overflow with their own turn makes the last round of a
 * match cost both seats the same as every other round did.
 *
 * Termination is arithmetic rather than a clock. Every settled turn takes exactly one card
 * off the board and nothing ever puts one back, so a match is at most `piles × depth`
 * turns long whatever either player does, and a completed round adds at most one turn to
 * that. A refused take changes nothing and so cannot extend it either.
 */
function finishTurn(game: Game): void {
  const moved = game.active;
  const roundComplete = moved !== game.opener;

  if (roundComplete && (game.p1Out || game.p2Out)) {
    game.winner = judge(game);
    game.phase = 'over';
    return;
  }
  // The board holds an even number of cards and the opener takes the odd-numbered ones,
  // so it can only ever run out at the end of a round.
  if (game.left === 0) {
    game.winner = judge(game);
    game.phase = 'over';
    return;
  }

  game.active = otherSeat(moved);
  game.phase = 'ready';
  game.timer = READY_SECONDS;
}

function tallyOf(game: Readonly<Game>): { p1: number; p2: number } {
  return { p1: game.p1Sets, p2: game.p2Sets };
}

/**
 * Who takes a finished match.
 *
 * One seat out and the other still holding is the whole of the usual answer, and that is
 * the SDK's `last-standing`. Everything below it is for the two endings where both seats
 * are still standing — the board ran out — or neither is — they overflowed in the same
 * round.
 *
 * Sets first, then **fewer different kinds left in hand**, and that second rule is the one
 * worth explaining, because the obvious tiebreak is arithmetically incapable of separating
 * anybody. Both seats reach either of those endings having taken exactly the same number
 * of cards, and `taken = 3 × sets + held`, so level on sets *means* level on cards held.
 * Any tiebreak phrased in cards — fewer held, more taken, anything — is a restatement of
 * the first rule and decides nothing.
 *
 * The *composition* of those cards is free of that identity. Six cards as three pairs is a
 * rack one card from two clears; six singletons is a rack that was going nowhere. It is on
 * the table in front of both players for the whole match, so it is something to play for
 * rather than something explained afterwards.
 */
function judge(game: Game): SeatId | 'draw' {
  game.eliminated.length = 0;
  if (game.p1Out) game.eliminated.push('p1');
  if (game.p2Out) game.eliminated.push('p2');
  const standing = resolve(LAST_STANDING, tallyOf(game), { eliminated: game.eliminated });
  if (standing === 'p1' || standing === 'p2') return standing;

  const bySets = resolve(HIGHEST, tallyOf(game), { timeExpired: true });
  if (bySets === 'p1' || bySets === 'p2') return bySets;

  const p1Distinct = distinctOf(game, 'p1');
  const p2Distinct = distinctOf(game, 'p2');
  if (p1Distinct !== p2Distinct) return p1Distinct < p2Distinct ? 'p1' : 'p2';
  return 'draw';
}

/** The decided match, or null while it is still running. */
export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

/* ------------------------------------------------------------------ what a player sees */

/**
 * Everything a seat to move can see, and not one thing more.
 *
 * Rule 6 is easiest to break in this game because the information that would decide
 * everything — the order of the cards buried under each pile — is one array away in
 * {@link Game}. So the bot is never given a `Game`. It is given this, which holds the six
 * face-up kinds, how tall each pile is, and both racks, all of which are on the table in
 * front of a person. There is no field for what is underneath, so no tier can read it and
 * no later tier can start to.
 */
export interface BoardView {
  readonly kinds: number;
  readonly piles: number;
  /** Face-up kind of each pile, or -1 for an empty one. */
  readonly front: number[];
  /** Cards left in each pile, face-up card included. */
  readonly depth: number[];
  /** How many of each kind the seat to move is holding. */
  readonly mine: number[];
  /** How many of each kind the other seat is holding. */
  readonly theirs: number[];
  mySize: number;
  theirSize: number;
}

export function createView(shape: BoardShape): BoardView {
  const zeros = (n: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) out.push(0);
    return out;
  };
  return {
    kinds: shape.kinds,
    piles: shape.piles,
    front: zeros(shape.piles),
    depth: zeros(shape.piles),
    mine: zeros(shape.kinds),
    theirs: zeros(shape.kinds),
    mySize: 0,
    theirSize: 0,
  };
}

/** Fill a view from the seat's own side of the table. Allocates nothing. */
export function readView(view: BoardView, game: Readonly<Game>, seat: SeatId): BoardView {
  for (let p = 0; p < view.piles; p += 1) {
    view.front[p] = frontKind(game, p);
    view.depth[p] = depthOf(game, p);
  }
  for (let k = 0; k < view.kinds; k += 1) {
    view.mine[k] = 0;
    view.theirs[k] = 0;
  }
  const other = otherSeat(seat);
  const mine = rackOf(game, seat);
  const theirs = rackOf(game, other);
  view.mySize = sizeOf(game, seat);
  view.theirSize = sizeOf(game, other);
  for (let i = 0; i < view.mySize; i += 1) {
    const kind = mine[i] ?? -1;
    if (kind >= 0) view.mine[kind] = (view.mine[kind] ?? 0) + 1;
  }
  for (let i = 0; i < view.theirSize; i += 1) {
    const kind = theirs[i] ?? -1;
    if (kind >= 0) view.theirs[kind] = (view.theirs[kind] ?? 0) + 1;
  }
  return view;
}

/* ------------------------------------------------------------------ the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * A tier, as three weights and a slip.
 *
 * Every weight is an integer so that two options either score the same or do not; a float
 * comparison with an epsilon would make the tie-break depend on rounding, and the
 * tie-break is where the seat symmetry lives.
 *
 * Two more weights were written, swept alone and deleted, and both are worth knowing about
 * because both looked obviously right. See SPEC.md for the tables.
 */
export interface BotProfile {
  /** Completing three alike, which frees two slots and scores. */
  readonly setValue: number;
  /** Taking a second copy of something, which is a set half made. */
  readonly pairValue: number;
  /** Taking a card the other seat needs, off the one board you both draw from. */
  readonly denyValue: number;
  /** How often the tier ignores all of that and takes any pile at all. */
  readonly slip: number;
}

/**
 * A take that would overflow is refused by every tier, and that is not a difficulty knob.
 *
 * Whether the card in front of you kills you is arithmetic on your own face-up rack —
 * the one thing in this game that no amount of skill is needed to see. A tier that walked
 * into it deliberately would not be a weaker player, it would be a broken one. The slip
 * is what makes the weak tiers die, and it kills them the way a person dies: by taking
 * the wrong card for a reason, not by choosing to lose.
 */
const OVERFLOW_PENALTY = 1000;

/**
 * The three tiers, as three things a player has learned to notice.
 *
 * `easy` sees only the card in front of it: three alike clear, and an eighth card kills.
 * `normal` has learned that a second copy is worth more than a first. `hard` has learned
 * to read the other rack. Every weight below was swept alone — see SPEC.md for the tables.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ setValue: 30, pairValue: 0, denyValue: 0, slip: 0.35 }),
  normal: Object.freeze({ setValue: 30, pairValue: 4, denyValue: 0, slip: 0.12 }),
  hard: Object.freeze({ setValue: 30, pairValue: 4, denyValue: 40, slip: 0 }),
});

/**
 * Values a bot draws per decision. Always exactly this many, drawn before anything
 * branches, so the generator advances by the same amount whatever the table looks like
 * and a replay cannot diverge.
 */
export const BOT_DRAWS_PER_TURN = 3;

/**
 * What one pile is worth to the seat to move.
 *
 * Every term is a function of the *kind* on the pile and of the two racks — never of
 * where the pile sits. That is not tidiness, it is the honest model: with the rest of a
 * pile face down, the only knowable consequence of taking a card is that the card has
 * left the board, and the card is the same card whichever pile it was lying on. A test
 * shuffles the piles and asserts the scores shuffle with them.
 *
 * A weight was written for the one thing position *can* say — that a pile with one card
 * left will vanish, narrowing what both seats have to choose from. Swept alone at `hard`
 * it moved the win rate by 0.9 points across its entire range, which is half the standard
 * error of the sample that measured it. It was deleted, and so was a second weight on how
 * exposed the rack a take leaves you with is: see SPEC.md for both.
 *
 * Returns a large negative for an empty pile, so an illegal option can never win a
 * comparison against a legal one.
 */
export function scorePile(
  view: Readonly<BoardView>,
  profile: Readonly<BotProfile>,
  pile: number,
): number {
  const kind = view.front[pile] ?? -1;
  if (kind < 0) return -OVERFLOW_PENALTY * 4;

  const held = view.mine[kind] ?? 0;
  const completes = held === SET_SIZE - 1;
  const size = completes ? view.mySize - (SET_SIZE - 1) : view.mySize + 1;

  let score = 0;
  if (completes) score += profile.setValue;
  else if (size > STACK_LIMIT) score -= OVERFLOW_PENALTY;
  else if (held === 1) score += profile.pairValue;

  // Denial. One board, two players: a card you take is a card they cannot have, and the
  // cards they most want are the ones they are holding two of. It is worth most when
  // their rack is nearly full, because then it is not a set they lose but the match.
  if ((view.theirs[kind] ?? 0) === SET_SIZE - 1) {
    const pressure = view.theirSize >= STACK_LIMIT ? 3 : view.theirSize >= STACK_LIMIT - 1 ? 2 : 1;
    score += profile.denyValue * pressure;
  }

  return score;
}

/** How many piles still have a card on them. */
function legalCount(view: Readonly<BoardView>): number {
  let count = 0;
  for (let p = 0; p < view.piles; p += 1) {
    if ((view.front[p] ?? -1) >= 0) count += 1;
  }
  return count;
}

/** The `ordinal`th pile that still has a card, or -1. Walks rather than building a list. */
function legalAt(view: Readonly<BoardView>, ordinal: number): number {
  let seen = 0;
  for (let p = 0; p < view.piles; p += 1) {
    if ((view.front[p] ?? -1) < 0) continue;
    if (seen === ordinal) return p;
    seen += 1;
  }
  return -1;
}

/**
 * The pile a bot takes from, or -1 when the board is empty.
 *
 * Three values are drawn first and unconditionally — see {@link BOT_DRAWS_PER_TURN} — so
 * the stream advances identically whatever the table looks like. Ties are broken by a
 * uniform draw among the equal-scoring piles rather than by the lowest index: the board
 * is one shared row read from opposite ends, and a bot that always reached for the
 * left-hand pile would be reaching for different piles depending on which chair it sat
 * in. Allocates nothing: this runs inside a fixed step.
 */
export function chooseTake(
  view: Readonly<BoardView>,
  profile: Readonly<BotProfile>,
  rng: Rng,
): number {
  const slipRoll = rng.float();
  const anyRoll = rng.float();
  const tieRoll = rng.float();

  const legal = legalCount(view);
  if (legal === 0) return -1;

  // A slip is a real take of a real card, chosen without thinking about it — which is
  // how a careless player loses, rather than by passing or by freezing.
  if (slipRoll < profile.slip) return legalAt(view, Math.floor(anyRoll * legal));

  let best = -Infinity;
  let tied = 0;
  for (let p = 0; p < view.piles; p += 1) {
    if ((view.front[p] ?? -1) < 0) continue;
    const score = scorePile(view, profile, p);
    if (score > best) {
      best = score;
      tied = 1;
    } else if (score === best) {
      tied += 1;
    }
  }

  let wanted = Math.floor(tieRoll * tied);
  for (let p = 0; p < view.piles; p += 1) {
    if ((view.front[p] ?? -1) < 0) continue;
    if (scorePile(view, profile, p) !== best) continue;
    if (wanted === 0) return p;
    wanted -= 1;
  }
  return legalAt(view, 0);
}

export interface BotState {
  /** Seconds left before this bot takes. Reset whenever it is not this bot's turn. */
  thinkLeft: number;
  /** The bot's own window onto the table. Allocated once, refilled every decision. */
  readonly view: BoardView;
}

export function createBotState(shape: BoardShape = SHAPE): BotState {
  return { thinkLeft: THINK_SECONDS, view: createView(shape) };
}

export function resetBotState(state: BotState): void {
  state.thinkLeft = THINK_SECONDS;
}

/**
 * A generator per seat, both drawn from the match's own before anything else touches it.
 *
 * One shared stream would make each seat's play a function of how its opponent was
 * playing — Cup Pong measured exactly that and wrote it down. Here the coupling would be
 * worse than there, because a slip changes nothing about how many values a turn costs but
 * a *turn* only happens when its seat is to move, and the two seats do not take equal
 * numbers of turns once one of them overflows.
 */
export function createBotRngs(source: Rng): { p1: Rng; p2: Rng } {
  return { p1: new Rng(source.next() | 0), p2: new Rng(source.next() | 0) };
}

/** Run one bot for one step. Returns true if it took a card this step. */
export function driveBot(
  game: Game,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  if (game.phase !== 'choosing' || game.active !== seat) {
    state.thinkLeft = THINK_SECONDS;
    return false;
  }
  state.thinkLeft -= fixedDeltaSeconds;
  if (state.thinkLeft > 0) return false;
  state.thinkLeft = THINK_SECONDS;

  readView(state.view, game, seat);
  const pile = chooseTake(state.view, BOT_PROFILES[difficulty], rng);
  if (pile < 0) return false;
  return take(game, seat, pile);
}
