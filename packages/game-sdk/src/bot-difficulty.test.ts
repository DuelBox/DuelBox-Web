import { describe, expect, it } from 'vitest';
import {
  BOT_DIFFICULTIES,
  BOT_TIERS,
  difficultyForTier,
  isBotTier,
  isStronger,
  type BotTier,
} from './bot-difficulty.js';

describe('the tier table', () => {
  it('has a structured value for every string tier', () => {
    for (const tier of BOT_TIERS) {
      const difficulty = BOT_DIFFICULTIES[tier];
      expect(typeof difficulty.reactionSeconds).toBe('number');
      expect(typeof difficulty.errorMagnitude).toBe('number');
      expect(typeof difficulty.blunderRate).toBe('number');
    }
  });

  it('keeps every lever in range', () => {
    for (const tier of BOT_TIERS) {
      const d = BOT_DIFFICULTIES[tier];
      expect(d.reactionSeconds).toBeGreaterThanOrEqual(0);
      expect(d.errorMagnitude).toBeGreaterThanOrEqual(0);
      expect(d.errorMagnitude).toBeLessThanOrEqual(1);
      expect(d.blunderRate).toBeGreaterThanOrEqual(0);
      expect(d.blunderRate).toBeLessThanOrEqual(1);
    }
  });

  it('is monotonic: harder is stronger on every lever', () => {
    // This is the invariant that would have caught a lever running backwards, which the
    // HANDOFF records finding three separate times.
    expect(isStronger(BOT_DIFFICULTIES.hard, BOT_DIFFICULTIES.normal)).toBe(true);
    expect(isStronger(BOT_DIFFICULTIES.normal, BOT_DIFFICULTIES.easy)).toBe(true);
    // And not the other way round.
    expect(isStronger(BOT_DIFFICULTIES.easy, BOT_DIFFICULTIES.hard)).toBe(false);
  });
});

describe('difficultyForTier', () => {
  it('maps each string tier to its structured value', () => {
    for (const tier of BOT_TIERS) {
      expect(difficultyForTier(tier)).toBe(BOT_DIFFICULTIES[tier]);
    }
  });

  it('throws on a tier it does not know', () => {
    expect(() => difficultyForTier('impossible' as BotTier)).toThrow(RangeError);
  });
});

describe('isBotTier', () => {
  it('accepts the three tiers and nothing else', () => {
    expect(isBotTier('easy')).toBe(true);
    expect(isBotTier('normal')).toBe(true);
    expect(isBotTier('hard')).toBe(true);
    expect(isBotTier('medium')).toBe(false);
    expect(isBotTier(null)).toBe(false);
    expect(isBotTier(2)).toBe(false);
  });
});
