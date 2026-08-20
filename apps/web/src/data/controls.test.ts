import { describe, expect, it } from 'vitest';
import { CONTROLS } from './controls.js';
import { PLAYABLE } from './registry.js';

/**
 * The landing page promises a game's controls; the registry decides which games are
 * playable. If the two drift, a playable game's page silently loses its controls — the
 * kind of gap nobody notices because nothing errors.
 */
describe('the controls map', () => {
  it('covers every playable game', () => {
    const missing = PLAYABLE.filter((slug) => !CONTROLS.has(slug));
    expect(missing, `add these to controls.ts: ${missing.join(', ')}`).toEqual([]);
  });

  it('names no game that is not playable', () => {
    const extra = [...CONTROLS.keys()].filter((slug) => !PLAYABLE.includes(slug));
    expect(extra, `these are not in the registry: ${extra.join(', ')}`).toEqual([]);
  });

  it('gives every game something to say about both input families', () => {
    for (const [slug, controls] of CONTROLS) {
      expect(controls.keyboard.length, `${slug} keyboard`).toBeGreaterThan(3);
      // The pointer line may be empty for an archetype with no pointer idiom, but the
      // field must exist rather than being undefined.
      expect(typeof controls.pointer, `${slug} pointer`).toBe('string');
    }
  });
});
