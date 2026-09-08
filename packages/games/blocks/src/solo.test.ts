import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import { createMatch, isOver, legalMoves, playMove } from './rules.js';

/**
 * Solo (#1750): one seat, never handed over, scored every shape.
 *
 * The two-seat game settles the score once a round of two shapes has closed, and hands the
 * turn across after each; a solo run has no round of two and nobody to hand to.
 */
describe('a solo run of blocks', () => {
  const firstMove = (state: ReturnType<typeof createMatch>): number => {
    const out = new Int16Array(4096);
    const count = legalMoves(out, state.board, state.tray);
    expect(count).toBeGreaterThan(0);
    return out[0] ?? -1;
  };

  it('opens on p1 whatever seat the coin named', () => {
    expect(createMatch(new Rng(7), 'p2', true).active).toBe('p1');
    expect(createMatch(new Rng(7), 'p2').active).toBe('p2');
  });

  it('keeps the turn on p1 after a shape, where the two-seat game hands it over', () => {
    const solo = createMatch(new Rng(7), 'p1', true);
    expect(playMove(solo, firstMove(solo))).toBeGreaterThanOrEqual(0);
    expect(solo.active).toBe('p1');
    const pair = createMatch(new Rng(7), 'p1');
    expect(playMove(pair, firstMove(pair))).toBeGreaterThanOrEqual(0);
    expect(pair.active).toBe('p2');
  });

  it('settles the score on every shape rather than every second one', () => {
    const solo = createMatch(new Rng(7), 'p1', true);
    playMove(solo, firstMove(solo));
    expect(solo.scoredP1).toBe(solo.p1);
    const pair = createMatch(new Rng(7), 'p1');
    playMove(pair, firstMove(pair));
    // One shape in, the round of two is still open, so the two-seat score is not settled yet.
    expect(pair.placed).toBe(1);
    expect(pair.scoredP1).toBe(0);
  });

  it('still ends, on the same condition as ever', () => {
    const solo = createMatch(new Rng(7), 'p1', true);
    let guard = 0;
    while (!isOver(solo) && guard < 400) {
      const out = new Int16Array(4096);
      const count = legalMoves(out, solo.board, solo.tray);
      if (count === 0) break;
      playMove(solo, out[0] ?? -1);
      guard += 1;
    }
    expect(isOver(solo)).toBe(true);
    expect(solo.p2).toBe(0);
    expect(solo.active).toBe('p1');
  });
});
