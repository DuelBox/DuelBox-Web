import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import { allowedCells, applyEntry, createMatch } from './rules.js';

/**
 * Solo (#1750): one seat, never handed over. A mistake still costs the square — it goes to
 * the far seat nobody is in, which is how a solo run counts its errors — but the turn does
 * not go with it.
 */
describe('a solo run of sudoku', () => {
  const someAllowed = (state: ReturnType<typeof createMatch>): number => {
    const out: number[] = [];
    const count = allowedCells(out, state);
    expect(count).toBeGreaterThan(0);
    return out[0] ?? -1;
  };

  it('opens on p1 whatever seat the coin named', () => {
    expect(createMatch(new Rng(3), 'p2', undefined, true).active).toBe('p1');
    expect(createMatch(new Rng(3), 'p2').active).toBe('p2');
  });

  it('keeps the turn after a right answer, where the two-seat game hands it over', () => {
    const solo = createMatch(new Rng(3), 'p1', undefined, true);
    const cell = someAllowed(solo);
    expect(applyEntry(solo, cell, solo.solution[cell] ?? 0)).toBe('claimed');
    expect(solo.active).toBe('p1');
    const pair = createMatch(new Rng(3), 'p1');
    const other = someAllowed(pair);
    expect(applyEntry(pair, other, pair.solution[other] ?? 0)).toBe('claimed');
    expect(pair.active).toBe('p2');
  });

  it('keeps the turn after a wrong answer too, and counts the square against the run', () => {
    const solo = createMatch(new Rng(3), 'p1', undefined, true);
    const cell = someAllowed(solo);
    const wrong = ((solo.solution[cell] ?? 1) % 9) + 1;
    expect(applyEntry(solo, cell, wrong)).toBe('conceded');
    expect(solo.active).toBe('p1');
    expect(solo.squaresP2).toBe(1);
    expect(solo.squaresP1).toBe(0);
  });
});
