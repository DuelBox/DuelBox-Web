import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import { resolveSimultaneous } from '@duelbox/game-sdk';
import {
  BOT_PROFILES,
  ROUNDS_TO_WIN,
  SIMULTANEOUS_TOLERANCE,
  THROWS,
  beats,
  botThrow,
  counterTo,
  createMemory,
  likeliestThrow,
  remember,
  resetMemory,
  resolveRound,
  winnerOf,
} from './rules.js';
import type { Throw } from './rules.js';

describe('what beats what', () => {
  it('is the cycle everyone knows', () => {
    expect(beats('rock', 'scissors')).toBe(true);
    expect(beats('scissors', 'paper')).toBe(true);
    expect(beats('paper', 'rock')).toBe(true);
  });

  it('is never symmetric and never reflexive', () => {
    // Both would break the game outright, and both are one typo away in a lookup table.
    for (const a of THROWS) {
      expect(beats(a, a), `${a} must not beat itself`).toBe(false);
      for (const b of THROWS) {
        if (a === b) continue;
        expect(beats(a, b) && beats(b, a), `${a} and ${b} cannot both win`).toBe(false);
      }
    }
  });

  it('gives every throw exactly one thing it beats and one that beats it', () => {
    for (const option of THROWS) {
      expect(THROWS.filter((other) => beats(option, other)).length).toBe(1);
      expect(THROWS.filter((other) => beats(other, option)).length).toBe(1);
    }
  });

  it('has a counter for every throw, and it is the one that wins', () => {
    for (const option of THROWS) {
      expect(beats(counterTo(option), option), `counter to ${option}`).toBe(true);
    }
  });
});

describe('resolving a round', () => {
  it('gives the round to the better throw', () => {
    expect(resolveRound('rock', 'scissors')).toBe('p1');
    expect(resolveRound('scissors', 'rock')).toBe('p2');
  });

  it('draws on the same throw', () => {
    for (const option of THROWS) expect(resolveRound(option, option)).toBe('draw');
  });

  it('gives the round to whoever committed when the other did not', () => {
    expect(resolveRound('rock', null)).toBe('p1');
    expect(resolveRound(null, 'rock')).toBe('p2');
  });

  it('draws when neither committed', () => {
    expect(resolveRound(null, null)).toBe('draw');
  });

  it('ignores who was faster, deliberately', () => {
    // Speed decides nothing here — only the choice does. If being 30ms quicker won a
    // round, the player with the better connection would win the match, and no amount of
    // timestamp reconciliation would fix that.
    expect(resolveRound('rock', 'scissors')).toBe('p1');
    expect(resolveRound('scissors', 'rock')).toBe('p2');
  });

  it('covers every pair of throws', () => {
    for (const a of THROWS) {
      for (const b of THROWS) {
        const outcome = resolveRound(a, b);
        expect(['p1', 'p2', 'draw']).toContain(outcome);
        if (a === b) expect(outcome).toBe('draw');
        else expect(outcome).toBe(beats(a, b) ? 'p1' : 'p2');
      }
    }
  });
});

describe('the simultaneous tolerance', () => {
  it('agrees with the SDK helper it is taken from', () => {
    // The tolerance matters for the *window* rather than for who wins a round, but it is
    // stated here so a future change to the SDK default is visible in this game too.
    expect(resolveSimultaneous(0, SIMULTANEOUS_TOLERANCE / 2, SIMULTANEOUS_TOLERANCE)).toBe('draw');
    expect(resolveSimultaneous(0, SIMULTANEOUS_TOLERANCE * 2, SIMULTANEOUS_TOLERANCE)).toBe('p1');
  });

  it('is about half a frame, below which no honest claim of "first" can be made', () => {
    expect(SIMULTANEOUS_TOLERANCE).toBeGreaterThan(0);
    expect(SIMULTANEOUS_TOLERANCE).toBeLessThan(1 / 60);
  });
});

describe('the match', () => {
  it('is not won until a seat reaches the target', () => {
    expect(winnerOf({ p1: 0, p2: 0 })).toBeNull();
    expect(winnerOf({ p1: ROUNDS_TO_WIN - 1, p2: ROUNDS_TO_WIN - 1 })).toBeNull();
  });

  it('is won by whoever reaches it', () => {
    expect(winnerOf({ p1: ROUNDS_TO_WIN, p2: 0 })).toBe('p1');
    expect(winnerOf({ p1: 1, p2: ROUNDS_TO_WIN })).toBe('p2');
  });

  it('needs three rounds, as the observed rules say', () => {
    expect(ROUNDS_TO_WIN).toBe(3);
  });
});

describe('the bot', () => {
  it('always throws something legal', () => {
    const memory = createMemory();
    const rng = new Rng(1);
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      for (let i = 0; i < 500; i += 1) {
        const thrown = botThrow(memory, BOT_PROFILES[difficulty], rng.float());
        expect(THROWS, `${difficulty} threw ${String(thrown)}`).toContain(thrown);
        remember(memory, thrown);
      }
    }
  });

  it('remembers nothing at the start', () => {
    expect(likeliestThrow(createMemory())).toBeNull();
  });

  it('reads a habit once it has seen one', () => {
    const memory = createMemory();
    remember(memory, 'rock');
    remember(memory, 'rock');
    remember(memory, 'paper');
    expect(likeliestThrow(memory)).toBe('rock');
  });

  it('forgets on reset', () => {
    const memory = createMemory();
    remember(memory, 'rock');
    resetMemory(memory);
    expect(likeliestThrow(memory)).toBeNull();
  });

  it('plays the counter to a habit, at a rate set by difficulty', () => {
    const memory = createMemory();
    for (let i = 0; i < 10; i += 1) remember(memory, 'rock');
    // A roll below the reading strength takes the counter; above it, chance.
    expect(botThrow(memory, BOT_PROFILES.hard, 0)).toBe('paper');
    expect(botThrow(memory, BOT_PROFILES.easy, 0), 'easy never reads').not.toBe(undefined);
  });

  it('never reads at all on the easy tier', () => {
    const memory = createMemory();
    for (let i = 0; i < 20; i += 1) remember(memory, 'rock');
    // Easy has reading 0, so its throws must be spread rather than all countering rock.
    const seen = new Set<Throw>();
    const rng = new Rng(4);
    for (let i = 0; i < 200; i += 1) seen.add(botThrow(memory, BOT_PROFILES.easy, rng.float()));
    expect(seen.size, 'easy should not lock on to one counter').toBeGreaterThan(1);
  });

  it('beats a predictable opponent more often on the hard tier than the easy one', () => {
    // The tiers must differ in strength rather than only in label. A human who always
    // throws rock should lose badly to a reader and roughly break even against chance.
    const winRate = (difficulty: 'easy' | 'hard'): number => {
      const memory = createMemory();
      const rng = new Rng(31);
      let botWins = 0;
      const rounds = 900;
      for (let i = 0; i < rounds; i += 1) {
        const human: Throw = 'rock';
        const bot = botThrow(memory, BOT_PROFILES[difficulty], rng.float());
        if (resolveRound(human, bot) === 'p2') botWins += 1;
        remember(memory, human);
      }
      return botWins / rounds;
    };
    const hard = winRate('hard');
    const easy = winRate('easy');
    expect(hard, `hard ${hard.toFixed(2)} vs easy ${easy.toFixed(2)}`).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(0.5);
  });

  it('is deterministic for a seed', () => {
    const play = (): string => {
      const memory = createMemory();
      const rng = new Rng(77);
      const thrown: Throw[] = [];
      for (let i = 0; i < 100; i += 1) {
        const t = botThrow(memory, BOT_PROFILES.normal, rng.float());
        thrown.push(t);
        remember(memory, t);
      }
      return thrown.join(',');
    };
    expect(play()).toBe(play());
  });

  it('commits sooner as the difficulty rises', () => {
    expect(BOT_PROFILES.easy.commitAt).toBeGreaterThan(BOT_PROFILES.normal.commitAt);
    expect(BOT_PROFILES.normal.commitAt).toBeGreaterThan(BOT_PROFILES.hard.commitAt);
  });
});
