import type { Rng } from '@duelbox/engine';

/**
 * The rules of a pairs game, with nothing else in them.
 *
 * No rendering, no timing, no DOM: the game, the bot and the balance harness all read the
 * table through these functions, so there is exactly one definition of what a legal flip
 * is and of when the last pair has gone.
 *
 * The board size is a parameter throughout. Nothing here assumes the default eight pairs,
 * so a harder table is a different argument rather than a different file.
 */

export interface Card {
  /** Pair identity. Every value in a deck appears on exactly two cards. */
  value: number;
  faceUp: boolean;
  matched: boolean;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** The default table: eight pairs laid out four by four. */
export const DEFAULT_PAIRS = 8;
export const DEFAULT_COLUMNS = 4;

/**
 * How many cards a bot keeps in mind, by tier.
 *
 * This is the whole of the bot's advantage and it is strictly less than a human's: it
 * remembers the last N cards ANYONE turned over and forgets everything before that. A
 * bot never reads a face-down card it has not been shown.
 */
export const MEMORY_SPAN: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 2,
  normal: 5,
  hard: 10,
});

/**
 * How often a bot fails to act on a pair it does in fact remember.
 *
 * Recall error, not information: a slipping bot still explores a card nobody has seen,
 * so it never trades a lapse of memory for a peek at the table.
 */
export const SLIP_CHANCE: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 0.4,
  normal: 0.15,
  hard: 0,
});

/** Rows and columns a deck is laid out in. */
export interface GridShape {
  readonly columns: number;
  readonly rows: number;
}

function assertPairs(pairs: number): void {
  if (!Number.isInteger(pairs) || pairs < 1) {
    throw new RangeError(`pairs must be a positive integer, received ${String(pairs)}`);
  }
}

/** Reads through `noUncheckedIndexedAccess`; an out-of-range index reads as absent. */
function at(cards: readonly Card[], index: number): Card | undefined {
  return cards[index];
}

function isCandidate(card: Card): boolean {
  return !card.matched && !card.faceUp;
}

/**
 * Grid a deck of `pairs` fills at `columns` wide. The last row may be short when the two
 * do not divide. Allocates, so it is called at layout time rather than per step.
 */
export function gridFor(pairs: number, columns: number = DEFAULT_COLUMNS): GridShape {
  assertPairs(pairs);
  if (!Number.isInteger(columns) || columns < 1) {
    throw new RangeError(`columns must be a positive integer, received ${String(columns)}`);
  }
  return { columns, rows: Math.ceil((pairs * 2) / columns) };
}

/**
 * A shuffled deck in which every value in [0, pairs) appears exactly twice.
 *
 * Shuffled through the match's seeded generator, never through Math.random, so the same
 * seed deals the same table on every device and a replay is identical.
 */
export function createDeck(pairs: number, rng: Rng): number[] {
  assertPairs(pairs);
  const deck: number[] = [];
  for (let value = 0; value < pairs; value += 1) {
    deck.push(value, value);
  }
  rng.shuffle(deck);
  return deck;
}

/** Face-down cards for a deck of `pairs`, values unset until {@link dealInto} fills them. */
export function createCards(pairs: number): Card[] {
  assertPairs(pairs);
  const cards: Card[] = [];
  for (let i = 0; i < pairs * 2; i += 1) {
    cards.push({ value: 0, faceUp: false, matched: false });
  }
  return cards;
}

/**
 * Lay a deck onto existing cards, turning them all face down again.
 *
 * Writes into the cards it is given rather than making new ones, so re-dealing a table
 * costs no allocation at all.
 *
 * @throws RangeError if the deck does not exactly fill the table.
 */
export function dealInto(cards: Card[], deck: readonly number[]): void {
  if (deck.length !== cards.length) {
    throw new RangeError(`dealInto: a deck of ${deck.length} does not fill ${cards.length} cards`);
  }
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    if (card === undefined) continue;
    card.value = deck[i] ?? 0;
    card.faceUp = false;
    card.matched = false;
  }
}

/**
 * Turn a card face up. Returns false and changes nothing when the index is not a card, or
 * the card is already face up or already won, so a caller may offer any tap at all.
 */
export function flip(cards: Card[], index: number): boolean {
  const card = at(cards, index);
  if (card === undefined) return false;
  if (card.faceUp || card.matched) return false;
  card.faceUp = true;
  return true;
}

/**
 * Judge the two cards turned over this turn: true when they are a pair, and then both are
 * marked won and stay face up. A mismatch changes nothing — the cards are left face up for
 * the caller to turn back after a delay, which is the whole point of the game.
 *
 * Both cards must already be face up. Comparing two face-down cards would be reading
 * hidden state, so it is refused rather than answered.
 */
export function resolveFlip(cards: Card[], a: number, b: number): boolean {
  if (a === b) return false;
  const first = at(cards, a);
  const second = at(cards, b);
  if (first === undefined || second === undefined) return false;
  if (!first.faceUp || !second.faceUp) return false;
  if (first.matched || second.matched) return false;
  if (first.value !== second.value) return false;
  first.matched = true;
  second.matched = true;
  return true;
}

/** Turn a mismatched pair back over. A won card is left face up. */
export function hideCards(cards: Card[], a: number, b: number): void {
  hideOne(cards, a);
  hideOne(cards, b);
}

function hideOne(cards: Card[], index: number): void {
  const card = at(cards, index);
  if (card === undefined || card.matched) return;
  card.faceUp = false;
}

/** True once every pair has been won, which is the end of the match. */
export function allMatched(cards: readonly Card[]): boolean {
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    if (card !== undefined && !card.matched) return false;
  }
  return true;
}

/** Index of the single card turned over so far this turn, or -1 when none is. */
export function faceUpIndex(cards: readonly Card[]): number {
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    if (card !== undefined && card.faceUp && !card.matched) return i;
  }
  return -1;
}

/**
 * What one bot has been shown, oldest first.
 *
 * Card INDICES, never values: the bot looks a value up only for a card it holds here, so
 * the set of cards it can reason about is exactly the set it has watched being turned over.
 */
export interface BotMemory {
  /** Only the first `size` entries are meaningful; the rest are stale. */
  readonly slots: number[];
  size: number;
  /** How many cards this bot can hold at once. Zero for a seat no bot occupies. */
  readonly capacity: number;
}

/** @throws RangeError if `capacity` is not a non-negative integer. */
export function createMemory(capacity: number): BotMemory {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError(`capacity must be a non-negative integer, received ${String(capacity)}`);
  }
  const slots: number[] = [];
  for (let i = 0; i < capacity; i += 1) {
    slots.push(-1);
  }
  return { slots, size: 0, capacity };
}

/**
 * Record that a card was turned over in front of this bot.
 *
 * Fed from every reveal, the bot's own and the opponent's alike, because a flip on a
 * shared board is public. Past capacity the oldest card is forgotten, and seeing a card
 * again refreshes it rather than filling the memory with duplicates.
 */
export function rememberCard(memory: BotMemory, index: number): void {
  if (memory.capacity === 0) return;
  if (!Number.isInteger(index) || index < 0) return;

  let write = 0;
  for (let read = 0; read < memory.size; read += 1) {
    const held = memory.slots[read];
    if (held === undefined || held === index) continue;
    memory.slots[write] = held;
    write += 1;
  }

  if (write === memory.capacity) {
    for (let i = 1; i < write; i += 1) {
      memory.slots[i - 1] = memory.slots[i] ?? -1;
    }
    write -= 1;
  }

  memory.slots[write] = index;
  memory.size = write + 1;
}

export function forgetAll(memory: BotMemory): void {
  memory.size = 0;
}

export function remembers(memory: BotMemory, index: number): boolean {
  for (let i = 0; i < memory.size; i += 1) {
    if (memory.slots[i] === index) return true;
  }
  return false;
}

/**
 * The card a bot turns over next, or -1 when nothing is left to turn.
 *
 * The bot may read the value of a card only through {@link BotMemory}, so a face-down
 * card it has never been shown is worth exactly as much to it as any other: it draws
 * among those uniformly. It also prefers an unexplored card to one it already knows is no
 * use, which is how a person plays and costs the bot no hidden information.
 *
 * Ties are broken by the lowest card index, so the same table and the same generator
 * state always give the same card. Allocates nothing: this runs inside a fixed step.
 */
export function botChoice(
  cards: readonly Card[],
  memory: BotMemory,
  rng: Rng,
  difficulty: BotDifficulty,
): number {
  // Drawn first and unconditionally, so the generator advances by the same amount
  // whatever the bot happens to remember and a replay cannot diverge.
  const slip = rng.bool(SLIP_CHANCE[difficulty]);

  if (!slip) {
    const open = faceUpIndex(cards);
    const known = open < 0 ? knownPair(cards, memory) : knownPartner(cards, memory, open);
    if (known >= 0) return known;
  }

  const unseen = countCandidates(cards, memory, true);
  if (unseen > 0) return candidateAt(cards, memory, true, rng.int(0, unseen));
  const remaining = countCandidates(cards, memory, false);
  if (remaining > 0) return candidateAt(cards, memory, false, rng.int(0, remaining));
  return -1;
}

/** Lowest index of a remembered pair both of whose cards are still face down, or -1. */
function knownPair(cards: readonly Card[], memory: BotMemory): number {
  let best = -1;
  for (let i = 0; i < memory.size; i += 1) {
    const a = memory.slots[i];
    if (a === undefined) continue;
    const cardA = at(cards, a);
    if (cardA === undefined || !isCandidate(cardA)) continue;
    for (let j = i + 1; j < memory.size; j += 1) {
      const b = memory.slots[j];
      if (b === undefined) continue;
      const cardB = at(cards, b);
      if (cardB === undefined || !isCandidate(cardB)) continue;
      if (cardB.value !== cardA.value) continue;
      const lower = a < b ? a : b;
      if (best < 0 || lower < best) best = lower;
    }
  }
  return best;
}

/** Remembered face-down partner of the card already turned over this turn, or -1. */
function knownPartner(cards: readonly Card[], memory: BotMemory, open: number): number {
  const target = at(cards, open);
  if (target === undefined) return -1;
  let best = -1;
  for (let i = 0; i < memory.size; i += 1) {
    const index = memory.slots[i];
    if (index === undefined || index === open) continue;
    const card = at(cards, index);
    if (card === undefined || !isCandidate(card)) continue;
    if (card.value !== target.value) continue;
    if (best < 0 || index < best) best = index;
  }
  return best;
}

/**
 * Face-down, unwon cards, optionally restricted to those this bot has never been shown.
 *
 * The count is returned rather than a list of indices so that drawing one costs no
 * allocation: {@link candidateAt} walks the same filter again to find the nth.
 */
function countCandidates(cards: readonly Card[], memory: BotMemory, unseenOnly: boolean): number {
  let count = 0;
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    if (card === undefined || !isCandidate(card)) continue;
    if (unseenOnly && remembers(memory, i)) continue;
    count += 1;
  }
  return count;
}

function candidateAt(
  cards: readonly Card[],
  memory: BotMemory,
  unseenOnly: boolean,
  ordinal: number,
): number {
  let seen = 0;
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    if (card === undefined || !isCandidate(card)) continue;
    if (unseenOnly && remembers(memory, i)) continue;
    if (seen === ordinal) return i;
    seen += 1;
  }
  return -1;
}
