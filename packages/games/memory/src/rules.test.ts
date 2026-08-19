import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  DEFAULT_COLUMNS,
  DEFAULT_PAIRS,
  MEMORY_SPAN,
  SLIP_CHANCE,
  allMatched,
  botChoice,
  createCards,
  createDeck,
  createMemory,
  dealInto,
  faceUpIndex,
  flip,
  forgetAll,
  gridFor,
  hideCards,
  rememberCard,
  remembers,
  resolveFlip,
} from './rules.js';
import type { BotMemory, Card } from './rules.js';

/** A table with known values, so a test never has to guess what the shuffle dealt. */
function cardsFrom(values: readonly number[]): Card[] {
  return values.map((value) => ({ value, faceUp: false, matched: false }));
}

/** Eight pairs in the most guessable order there is: a cheating bot would be obvious. */
const SORTED = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7];
const SCRAMBLED = [3, 7, 0, 5, 1, 2, 6, 4, 4, 6, 2, 1, 5, 0, 7, 3];

function countsOf(deck: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const value of deck) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function memoryOf(capacity: number, ...seen: number[]): BotMemory {
  const memory = createMemory(capacity);
  for (const index of seen) rememberCard(memory, index);
  return memory;
}

describe('createDeck', () => {
  it('lays every value exactly twice', () => {
    for (const pairs of [1, 2, 6, DEFAULT_PAIRS, 13]) {
      const deck = createDeck(pairs, new Rng(pairs));
      expect(deck).toHaveLength(pairs * 2);
      const counts = countsOf(deck);
      expect(counts.size).toBe(pairs);
      for (let value = 0; value < pairs; value += 1) {
        expect(counts.get(value)).toBe(2);
      }
    }
  });

  it('deals the same table for the same seed', () => {
    const first = createDeck(DEFAULT_PAIRS, new Rng(7));
    const second = createDeck(DEFAULT_PAIRS, new Rng(7));
    expect(second).toEqual(first);
  });

  it('deals different tables for different seeds', () => {
    const decks = [1, 2, 3, 4, 5, 6].map((seed) => createDeck(DEFAULT_PAIRS, new Rng(seed)).join());
    expect(new Set(decks).size).toBeGreaterThan(1);
  });

  it('advances the generator, so successive deals differ', () => {
    const rng = new Rng(99);
    const first = createDeck(DEFAULT_PAIRS, rng).join();
    const second = createDeck(DEFAULT_PAIRS, rng).join();
    expect(second).not.toBe(first);
  });

  it('refuses a table that is not a positive whole number of pairs', () => {
    const rng = new Rng(1);
    expect(() => createDeck(0, rng)).toThrow(RangeError);
    expect(() => createDeck(-3, rng)).toThrow(RangeError);
    expect(() => createDeck(1.5, rng)).toThrow(RangeError);
    expect(() => createDeck(Number.NaN, rng)).toThrow(RangeError);
  });
});

describe('createCards and dealInto', () => {
  it('starts every card face down and unwon', () => {
    const cards = createCards(DEFAULT_PAIRS);
    expect(cards).toHaveLength(DEFAULT_PAIRS * 2);
    expect(cards.every((card) => !card.faceUp && !card.matched)).toBe(true);
  });

  it('lays a deck onto existing cards and turns them all back over', () => {
    const cards = cardsFrom(SORTED);
    cards[0]!.faceUp = true;
    cards[1]!.matched = true;
    dealInto(cards, SCRAMBLED);
    expect(cards.map((card) => card.value)).toEqual(SCRAMBLED);
    expect(cards.every((card) => !card.faceUp && !card.matched)).toBe(true);
  });

  it('refuses a deck that does not fill the table', () => {
    expect(() => dealInto(createCards(4), [0, 0, 1, 1])).toThrow(RangeError);
  });
});

describe('gridFor', () => {
  it('lays the default table four by four', () => {
    expect(gridFor(DEFAULT_PAIRS, DEFAULT_COLUMNS)).toEqual({ columns: 4, rows: 4 });
  });

  it('adds a short last row when the columns do not divide', () => {
    expect(gridFor(6, 4)).toEqual({ columns: 4, rows: 3 });
    expect(gridFor(5, 4)).toEqual({ columns: 4, rows: 3 });
    expect(gridFor(3, 2)).toEqual({ columns: 2, rows: 3 });
  });

  it('refuses a table or a width that is not a positive whole number', () => {
    expect(() => gridFor(0)).toThrow(RangeError);
    expect(() => gridFor(4, 0)).toThrow(RangeError);
    expect(() => gridFor(4, 2.5)).toThrow(RangeError);
  });
});

describe('flip', () => {
  it('turns a face-down card over', () => {
    const cards = cardsFrom(SORTED);
    expect(flip(cards, 3)).toBe(true);
    expect(cards[3]!.faceUp).toBe(true);
  });

  it('refuses a card that is already face up', () => {
    const cards = cardsFrom(SORTED);
    expect(flip(cards, 3)).toBe(true);
    expect(flip(cards, 3)).toBe(false);
    expect(cards[3]!.faceUp).toBe(true);
  });

  it('refuses a card that has already been won', () => {
    const cards = cardsFrom(SORTED);
    cards[2]!.matched = true;
    cards[2]!.faceUp = false;
    expect(flip(cards, 2)).toBe(false);
    expect(cards[2]!.faceUp).toBe(false);
  });

  it('refuses an index that is not a card', () => {
    const cards = cardsFrom(SORTED);
    expect(flip(cards, -1)).toBe(false);
    expect(flip(cards, cards.length)).toBe(false);
    expect(flip(cards, 1.5)).toBe(false);
    expect(flip(cards, Number.NaN)).toBe(false);
    expect(cards.some((card) => card.faceUp)).toBe(false);
  });
});

describe('resolveFlip', () => {
  it('wins a pair and leaves it face up', () => {
    const cards = cardsFrom(SORTED);
    flip(cards, 0);
    flip(cards, 1);
    expect(resolveFlip(cards, 0, 1)).toBe(true);
    expect(cards[0]!.matched).toBe(true);
    expect(cards[1]!.matched).toBe(true);
    expect(cards[0]!.faceUp).toBe(true);
    expect(cards[1]!.faceUp).toBe(true);
  });

  it('leaves a mismatch face up and unwon, for the caller to turn back', () => {
    const cards = cardsFrom(SORTED);
    flip(cards, 0);
    flip(cards, 2);
    expect(resolveFlip(cards, 0, 2)).toBe(false);
    expect(cards[0]!.faceUp).toBe(true);
    expect(cards[2]!.faceUp).toBe(true);
    expect(cards[0]!.matched).toBe(false);
    expect(cards[2]!.matched).toBe(false);
  });

  it('refuses one card offered as both picks', () => {
    const cards = cardsFrom(SORTED);
    flip(cards, 0);
    expect(resolveFlip(cards, 0, 0)).toBe(false);
    expect(cards[0]!.matched).toBe(false);
  });

  it('refuses face-down cards, which would be reading hidden state', () => {
    const cards = cardsFrom(SORTED);
    expect(resolveFlip(cards, 0, 1)).toBe(false);
    flip(cards, 0);
    expect(resolveFlip(cards, 0, 1)).toBe(false);
    expect(cards[0]!.matched).toBe(false);
    expect(cards[1]!.matched).toBe(false);
  });

  it('refuses a card that has already been won, and an index that is not a card', () => {
    const cards = cardsFrom(SORTED);
    flip(cards, 0);
    flip(cards, 1);
    expect(resolveFlip(cards, 0, 1)).toBe(true);
    expect(resolveFlip(cards, 0, 1)).toBe(false);
    expect(resolveFlip(cards, 0, cards.length)).toBe(false);
    expect(resolveFlip(cards, -1, 1)).toBe(false);
  });
});

describe('hideCards', () => {
  it('turns a mismatched pair back over', () => {
    const cards = cardsFrom(SORTED);
    flip(cards, 0);
    flip(cards, 2);
    hideCards(cards, 0, 2);
    expect(cards[0]!.faceUp).toBe(false);
    expect(cards[2]!.faceUp).toBe(false);
  });

  it('leaves a won pair face up', () => {
    const cards = cardsFrom(SORTED);
    flip(cards, 0);
    flip(cards, 1);
    resolveFlip(cards, 0, 1);
    hideCards(cards, 0, 1);
    expect(cards[0]!.faceUp).toBe(true);
    expect(cards[1]!.faceUp).toBe(true);
  });

  it('ignores indices that are not cards', () => {
    const cards = cardsFrom(SORTED);
    expect(() => {
      hideCards(cards, -1, cards.length);
    }).not.toThrow();
  });
});

describe('allMatched and faceUpIndex', () => {
  it('reports the table finished only once every pair has gone', () => {
    const cards = cardsFrom([0, 0, 1, 1]);
    expect(allMatched(cards)).toBe(false);
    flip(cards, 0);
    flip(cards, 1);
    resolveFlip(cards, 0, 1);
    expect(allMatched(cards)).toBe(false);
    flip(cards, 2);
    flip(cards, 3);
    resolveFlip(cards, 2, 3);
    expect(allMatched(cards)).toBe(true);
  });

  it('names the single card turned over this turn', () => {
    const cards = cardsFrom([0, 0, 1, 1]);
    expect(faceUpIndex(cards)).toBe(-1);
    flip(cards, 2);
    expect(faceUpIndex(cards)).toBe(2);
    flip(cards, 3);
    resolveFlip(cards, 2, 3);
    // A won pair stays face up but is out of play, so it is not this turn's pick.
    expect(faceUpIndex(cards)).toBe(-1);
  });
});

describe('bot memory', () => {
  it('holds two cards on easy, five on normal and ten on hard', () => {
    expect(MEMORY_SPAN.easy).toBe(2);
    expect(MEMORY_SPAN.normal).toBe(5);
    expect(MEMORY_SPAN.hard).toBe(10);
  });

  it('remembers what it is shown and forgets the oldest past its capacity', () => {
    const memory = memoryOf(3, 4, 5, 6);
    expect(memory.size).toBe(3);
    expect(remembers(memory, 4)).toBe(true);

    rememberCard(memory, 7);
    expect(memory.size).toBe(3);
    expect(remembers(memory, 4)).toBe(false);
    expect(remembers(memory, 5)).toBe(true);
    expect(remembers(memory, 7)).toBe(true);
  });

  it('refreshes a card seen again rather than storing it twice', () => {
    const memory = memoryOf(3, 1, 2, 1);
    expect(memory.size).toBe(2);
    expect(remembers(memory, 1)).toBe(true);
    expect(remembers(memory, 2)).toBe(true);

    // 2 is now the oldest, so it is the one that goes when the memory fills.
    rememberCard(memory, 3);
    rememberCard(memory, 4);
    expect(remembers(memory, 2)).toBe(false);
    expect(remembers(memory, 1)).toBe(true);
  });

  it('remembers nothing at zero capacity, which is what a human seat holds', () => {
    const memory = memoryOf(0, 1, 2, 3);
    expect(memory.size).toBe(0);
    expect(remembers(memory, 1)).toBe(false);
  });

  it('ignores an index that is not a card', () => {
    const memory = memoryOf(4, -1, 1.5, Number.NaN);
    expect(memory.size).toBe(0);
  });

  it('forgets everything on request', () => {
    const memory = memoryOf(4, 1, 2);
    forgetAll(memory);
    expect(memory.size).toBe(0);
    expect(remembers(memory, 1)).toBe(false);
  });

  it('refuses a capacity that is not a whole number of cards', () => {
    expect(() => createMemory(-1)).toThrow(RangeError);
    expect(() => createMemory(2.5)).toThrow(RangeError);
  });
});

describe('botChoice', () => {
  it('draws uniformly over the cards it has never been shown', () => {
    // The deck is in sorted order, so a bot that could read a face-down value would pick
    // the same pair every time. A flat distribution is the proof that it cannot.
    const cards = cardsFrom(SORTED);
    const memory = createMemory(MEMORY_SPAN.hard);
    const rng = new Rng(2024);
    const counts: number[] = SORTED.map(() => 0);
    const trials = 16000;

    for (let i = 0; i < trials; i += 1) {
      const pick = botChoice(cards, memory, rng, 'hard');
      counts[pick] = (counts[pick] ?? 0) + 1;
    }

    // Summing to the trial count proves every draw landed on a real card, since an
    // out-of-range pick would never reach one of these sixteen slots.
    expect(counts).toHaveLength(cards.length);
    expect(counts.reduce((total, count) => total + count, 0)).toBe(trials);
    const expected = trials / cards.length;
    expect(Math.min(...counts)).toBeGreaterThan(expected * 0.85);
    expect(Math.max(...counts)).toBeLessThan(expected * 1.15);
  });

  it('makes the same choices whatever the unseen cards happen to be', () => {
    // Same generator, same face-up pattern, two completely different deals: identical
    // choices, because the values of unseen cards never enter the decision.
    const sorted = cardsFrom(SORTED);
    const scrambled = cardsFrom(SCRAMBLED);
    const sortedRng = new Rng(31);
    const scrambledRng = new Rng(31);
    for (let i = 0; i < 300; i += 1) {
      const a = botChoice(sorted, createMemory(MEMORY_SPAN.hard), sortedRng, 'normal');
      const b = botChoice(scrambled, createMemory(MEMORY_SPAN.hard), scrambledRng, 'normal');
      expect(b).toBe(a);
    }
  });

  it('prefers an unexplored card to one it knows is no use', () => {
    // 0 holds a 0 and 1 holds a 1, so what it remembers is no help; it must explore.
    const cards = cardsFrom([0, 1, 2, 3, 0, 1, 2, 3]);
    const memory = memoryOf(MEMORY_SPAN.normal, 0, 1);
    const rng = new Rng(9);
    for (let i = 0; i < 300; i += 1) {
      const pick = botChoice(cards, memory, rng, 'easy');
      expect(pick).not.toBe(0);
      expect(pick).not.toBe(1);
    }
  });

  it('falls back to the whole table once it has seen every card left', () => {
    const cards = cardsFrom([0, 1, 0, 1]);
    const memory = memoryOf(MEMORY_SPAN.hard, 0, 1, 2, 3);
    // 0 and 2 are a remembered pair, so a slip is the only route to the fallback.
    const rng = new Rng(3);
    let picks = 0;
    for (let i = 0; i < 200; i += 1) {
      const pick = botChoice(cards, memory, rng, 'easy');
      expect(pick).toBeGreaterThanOrEqual(0);
      expect(pick).toBeLessThan(cards.length);
      picks += 1;
    }
    expect(picks).toBe(200);
  });

  it('never turns a card that is face up or already won', () => {
    const cards = cardsFrom(SCRAMBLED);
    cards[0]!.matched = true;
    cards[0]!.faceUp = true;
    cards[15]!.matched = true;
    cards[15]!.faceUp = true;
    cards[4]!.faceUp = true;
    const memory = memoryOf(MEMORY_SPAN.hard, 0, 4, 15, 9);
    const rng = new Rng(17);
    for (let i = 0; i < 500; i += 1) {
      const pick = botChoice(cards, memory, rng, 'normal');
      const card = cards[pick];
      expect(card).toBeDefined();
      expect(card!.faceUp).toBe(false);
      expect(card!.matched).toBe(false);
    }
  });

  it('takes a pair it remembers, lowest index first', () => {
    const cards = cardsFrom([0, 1, 2, 3, 0, 1, 2, 3]);
    const memory = memoryOf(MEMORY_SPAN.hard, 5, 1);
    const rng = new Rng(5);
    for (let i = 0; i < 100; i += 1) {
      expect(botChoice(cards, memory, rng, 'hard')).toBe(1);
    }
  });

  it('takes the remembered partner of the card it has just turned', () => {
    const cards = cardsFrom([0, 1, 2, 3, 0, 1, 2, 3]);
    cards[3]!.faceUp = true;
    const memory = memoryOf(MEMORY_SPAN.hard, 1, 5, 3, 7);
    const rng = new Rng(6);
    for (let i = 0; i < 100; i += 1) {
      expect(botChoice(cards, memory, rng, 'hard')).toBe(7);
    }
  });

  it('slips sometimes on easy and never on hard', () => {
    expect(SLIP_CHANCE.hard).toBe(0);
    const cards = cardsFrom([0, 1, 2, 3, 0, 1, 2, 3]);
    const known = memoryOf(MEMORY_SPAN.easy, 1, 5);

    const hardRng = new Rng(21);
    for (let i = 0; i < 200; i += 1) {
      expect(botChoice(cards, known, hardRng, 'hard')).toBe(1);
    }

    const easyRng = new Rng(21);
    let slips = 0;
    for (let i = 0; i < 300; i += 1) {
      const pick = botChoice(cards, known, easyRng, 'easy');
      // Even a slip explores rather than peeking: it never lands on the seen card 5.
      expect(pick).not.toBe(5);
      if (pick !== 1) slips += 1;
    }
    expect(slips).toBeGreaterThan(0);
    expect(slips).toBeLessThan(300);
  });

  it('is deterministic for a given generator state', () => {
    const cards = cardsFrom(SCRAMBLED);
    const first: number[] = [];
    const second: number[] = [];
    const rngA = new Rng(404);
    const rngB = new Rng(404);
    for (let i = 0; i < 120; i += 1) {
      first.push(botChoice(cards, memoryOf(MEMORY_SPAN.easy, 2, 9), rngA, 'easy'));
      second.push(botChoice(cards, memoryOf(MEMORY_SPAN.easy, 2, 9), rngB, 'easy'));
    }
    expect(second).toEqual(first);
  });

  it('returns -1 when there is nothing left to turn', () => {
    const cards = cardsFrom([0, 0]);
    for (const card of cards) {
      card.faceUp = true;
      card.matched = true;
    }
    expect(botChoice(cards, createMemory(MEMORY_SPAN.hard), new Rng(1), 'hard')).toBe(-1);
  });
});
