import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import { pickQuickPlay } from './quick-play';

/** The engine's own seeded generator, so every draw below is the same on every run. */
function seeded(seed: number): () => number {
  const rng = new Rng(seed);
  return () => rng.float();
}

const CANDIDATES = ['air-hockey', 'chess', 'darts', 'ludo', 'pool', 'sumo'] as const;

/** How often each candidate came up over `draws` picks from one seeded source. */
function tally(
  candidates: readonly string[],
  recent: readonly string[],
  draws: number,
  seed = 1,
): Map<string, number> {
  const random = seeded(seed);
  const counts = new Map<string, number>();
  for (let index = 0; index < draws; index += 1) {
    const pick = pickQuickPlay(candidates, recent, random);
    expect(pick).toBeDefined();
    counts.set(pick!, (counts.get(pick!) ?? 0) + 1);
  }
  return counts;
}

describe('picking a game to play', () => {
  it('picks nothing from nothing', () => {
    expect(pickQuickPlay([], [], seeded(1))).toBeUndefined();
    expect(pickQuickPlay([], ['chess'], seeded(1))).toBeUndefined();
  });

  it('always picks one of the candidates', () => {
    for (const seed of [1, 2, 3]) {
      const counts = tally(CANDIDATES, ['pool', 'chess'], 200, seed);
      for (const slug of counts.keys()) expect(CANDIDATES).toContain(slug);
    }
  });

  it('never offers the game just played', () => {
    // Two hundred draws with the last game in the pool, and not one of them is it. The
    // rematch button is for playing the same thing again.
    const counts = tally(CANDIDATES, ['chess', 'pool', 'darts'], 200);
    expect(counts.get('chess')).toBeUndefined();
    expect([...counts.keys()].sort()).toEqual(CANDIDATES.filter((slug) => slug !== 'chess').sort());
  });

  it('offers the game just played when it is the only one there is', () => {
    expect(pickQuickPlay(['chess'], ['chess'], seeded(1))).toBe('chess');
    // The same game listed twice is still the only game.
    expect(pickQuickPlay(['chess', 'chess'], ['chess'], seeded(1))).toBe('chess');
  });

  it('offers the two games before that, but less often', () => {
    // 'pool' and 'darts' carry a quarter of the weight of the other four, so over a long
    // evening a pair sees new games more often without the picker ever refusing to
    // return to one they liked.
    const counts = tally(CANDIDATES, ['chess', 'pool', 'darts'], 4000);
    const cooling = ['pool', 'darts'].map((slug) => counts.get(slug) ?? 0);
    const fresh = ['air-hockey', 'ludo', 'sumo'].map((slug) => counts.get(slug) ?? 0);
    for (const count of cooling) expect(count).toBeGreaterThan(0);
    for (const count of cooling) for (const other of fresh) expect(count).toBeLessThan(other);
    const ratio =
      fresh.reduce((sum, count) => sum + count, 0) /
      fresh.length /
      (cooling.reduce((sum, count) => sum + count, 0) / cooling.length);
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(6);
  });

  it('treats a game outside the last three as fresh', () => {
    // Only the three most recent matter. A fourth-most-recent game is as likely as one
    // never played, so the picker does not slowly exclude the whole catalogue.
    const counts = tally(CANDIDATES, ['chess', 'pool', 'darts', 'ludo'], 4000);
    const ludo = counts.get('ludo') ?? 0;
    const sumo = counts.get('sumo') ?? 0;
    expect(Math.abs(ludo - sumo) / sumo).toBeLessThan(0.2);
  });

  it('is the same pick for the same seed', () => {
    const first = Array.from({ length: 20 }, () => pickQuickPlay(CANDIDATES, ['pool'], seeded(7)));
    const second = Array.from({ length: 20 }, () => pickQuickPlay(CANDIDATES, ['pool'], seeded(7)));
    expect(first).toEqual(second);
  });

  it('still returns a candidate when the source misbehaves', () => {
    // A source that yields 1 or NaN is outside the contract, and the answer is still a
    // game rather than undefined.
    expect(CANDIDATES).toContain(pickQuickPlay(CANDIDATES, [], () => 1));
    expect(CANDIDATES).toContain(pickQuickPlay(CANDIDATES, [], () => Number.NaN));
    expect(CANDIDATES).toContain(pickQuickPlay(CANDIDATES, [], () => -1));
  });
});
