import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import { createIntent, createMatch, resetMatch, step } from './rules.js';

/**
 * Solo (#1750): the far yard is never stepped, so nothing is ever dealt to it and it can
 * neither stand nor fall. The run is decided on the near yard alone.
 */
describe('a solo run of animal stack', () => {
  const STEP = 1 / 60;

  it('deals nothing to the far yard, where the two-seat game deals to both', () => {
    const solo = createMatch();
    resetMatch(solo, true);
    const idle = createIntent();
    const rng = new Rng(9);
    for (let i = 0; i < 60 * 8; i += 1) step(solo, idle, idle, STEP, rng);
    expect(solo.solo).toBe(true);
    expect(solo.p2.dealt).toBe(0);
    expect(solo.p2.count).toBe(0);
    expect(solo.p1.dealt).toBeGreaterThan(0);

    const pair = createMatch();
    resetMatch(pair);
    for (let i = 0; i < 60 * 8; i += 1) step(pair, idle, idle, STEP, new Rng(9));
    expect(pair.solo).toBe(false);
    expect(pair.p2.dealt).toBeGreaterThan(0);
  });

  it('forgets solo on a plain reset, so a rematch does not inherit it', () => {
    const match = createMatch();
    resetMatch(match, true);
    resetMatch(match);
    expect(match.solo).toBe(false);
  });
});
