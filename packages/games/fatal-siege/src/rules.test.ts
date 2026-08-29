import { describe, expect, it } from 'vitest';
import { createState, winnerOf } from './rules.js';

describe('Fatal Siege rules', () => {
  it('starts level with no winner', () => {
    const state = createState();
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect(winnerOf(state)).toBeNull();
  });

  // TODO: cover every terminal state, illegal moves, and the edge cases in SPEC.md.
});
