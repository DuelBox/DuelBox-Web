import { describe, expect, it } from 'vitest';
import { CONTROLS, MANIFESTS } from './controls.js';
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

/**
 * In a real-time game both seats play at once, and the engine binds W A S D to the near
 * seat and the arrow keys to the far one — strictly disjoint, so one player can never
 * drive the other. Four manifests used to read "W A S D or the arrow keys", which tells
 * the second player to press keys that move their opponent. In a turn-based game the two
 * sets really are alternatives for whoever is to move, so the phrasing is only wrong for
 * the simultaneous archetypes.
 */
describe('keyboard controls in simultaneous games', () => {
  const NAMES_A_SIDE = /seat|left|right|near|far/i;

  it('never offers the two key halves as alternatives', () => {
    for (const manifest of MANIFESTS) {
      if (!manifest.archetype.startsWith('rt-')) continue;
      const { keyboard } = manifest.controls;
      if (!/arrow/i.test(keyboard)) continue;
      expect(keyboard, `${manifest.id} presents both key halves as one player's choice`).not.toMatch(
        /\bor\b[^,]*arrow/i,
      );
      expect(keyboard, `${manifest.id} does not say which half belongs to which seat`).toMatch(
        NAMES_A_SIDE,
      );
    }
  });

  it('covers every real-time game, or it is guarding nothing', () => {
    const realtime = MANIFESTS.filter((manifest) => manifest.archetype.startsWith('rt-'));
    expect(realtime.length).toBeGreaterThan(3);
  });
});
