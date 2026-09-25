import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import { createMatch, legalMoves, letGo, play } from './rules.js';

/**
 * Solo (#1750): one seat, never handed over, and letting go ends the deal at once — with one
 * player, one pass says the same thing two in a row say between two.
 */
describe('a solo run of solitaire', () => {
  const someMove = (state: ReturnType<typeof createMatch>): number => {
    const out = new Int8Array(256);
    const count = legalMoves(out, state);
    expect(count).toBeGreaterThan(0);
    return out[0] ?? -1;
  };

  it('opens on p1 whatever seat the coin named', () => {
    expect(createMatch(new Rng(11), 'p2', undefined, true).active).toBe('p1');
    expect(createMatch(new Rng(11), 'p2').active).toBe('p2');
  });

  it('keeps the turn after a move, where the two-seat game hands it over', () => {
    const solo = createMatch(new Rng(11), 'p1', undefined, true);
    expect(play(solo, someMove(solo))).toBe(true);
    expect(solo.active).toBe('p1');
    const pair = createMatch(new Rng(11), 'p1');
    expect(play(pair, someMove(pair))).toBe(true);
    expect(pair.active).toBe('p2');
  });

  it('ends on the first pass, where the two-seat game needs two in a row', () => {
    const solo = createMatch(new Rng(11), 'p1', undefined, true);
    letGo(solo);
    expect(solo.over).toBe(true);
    const pair = createMatch(new Rng(11), 'p1');
    letGo(pair);
    expect(pair.over).toBe(false);
    letGo(pair);
    expect(pair.over).toBe(true);
  });
});
