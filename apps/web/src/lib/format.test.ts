import { describe, expect, it } from 'vitest';
import { formatRound } from './format';

describe('formatRound', () => {
  it('says one minute, not one minutes', () => {
    // This was rendering on 98 of the 107 catalogue pages.
    expect(formatRound(60)).toBe('1 minute');
    expect(formatRound(75)).toBe('1 minute');
  });

  it('says one second, not one seconds', () => {
    expect(formatRound(1)).toBe('1 second');
  });

  it('pluralises everything that is not one', () => {
    expect(formatRound(30)).toBe('30 seconds');
    expect(formatRound(45)).toBe('45 seconds');
    expect(formatRound(120)).toBe('2 minutes');
    expect(formatRound(300)).toBe('5 minutes');
  });

  it('reads correctly at every round length the catalogue uses', () => {
    for (const seconds of [20, 30, 45, 60, 75, 90, 120, 180, 240, 300, 600]) {
      expect(formatRound(seconds), `"about ${formatRound(seconds)}"`).not.toMatch(
        /^1 (minutes|seconds)$/,
      );
    }
  });
});
