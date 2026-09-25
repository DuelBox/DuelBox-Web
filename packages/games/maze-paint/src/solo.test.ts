import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import { canRoll, createMatch, isOver, legalDirections, startMatch, stepMatch } from './rules.js';

/**
 * Solo (#1750): the roll never goes to the far seat, and the run is over when the near seat
 * cannot roll — not when both cannot, which with one player would be never.
 */
describe('a solo run of maze paint', () => {
  const STEP = 1 / 60;

  function live(match: ReturnType<typeof createMatch>): void {
    // Through 'ready' to 'live' with no request, exactly as the host would.
    let guard = 0;
    while (match.phase !== 'live' && guard < 200) {
      stepMatch(match, STEP, -1, null, new Rng(1));
      guard += 1;
    }
    expect(match.phase).toBe('live');
  }

  it('opens on p1 whatever seat the coin named', () => {
    const solo = createMatch();
    startMatch(solo, new Rng(5), 'p2', undefined, true);
    expect(solo.solo).toBe(true);
    expect(solo.active).toBe('p1');
    const pair = createMatch();
    startMatch(pair, new Rng(5), 'p2');
    expect(pair.active).toBe('p2');
  });

  it('gives the roll straight back to p1, where the two-seat game hands it over', () => {
    const solo = createMatch();
    startMatch(solo, new Rng(5), 'p1', undefined, true);
    live(solo);
    const out = new Int32Array(8);
    expect(legalDirections(out, solo.position, 'p1')).toBeGreaterThan(0);
    stepMatch(solo, STEP, out[0] ?? -1, null, new Rng(1));
    expect(solo.active).toBe('p1');
    expect(solo.moves).toBe(1);

    const pair = createMatch();
    startMatch(pair, new Rng(5), 'p1');
    live(pair);
    expect(legalDirections(out, pair.position, 'p1')).toBeGreaterThan(0);
    stepMatch(pair, STEP, out[0] ?? -1, null, new Rng(1));
    expect(pair.active).toBe('p2');
  });

  it('is over when p1 cannot roll, whatever p2 could have done', () => {
    const solo = createMatch();
    startMatch(solo, new Rng(5), 'p1', undefined, true);
    expect(isOver(solo.position, true)).toBe(!canRoll(solo.position, 'p1'));
    expect(isOver(solo.position, true)).toBe(false);
  });
});
