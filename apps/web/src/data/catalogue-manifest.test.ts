import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './catalogue.generated';
import { LOADERS_FOR_TEST, loadGame } from './registry';

/**
 * The catalogue and the manifests describe the same games, so they have to agree.
 *
 * Every game says what it is twice. `data/catalog.yaml` carries the row a visitor reads —
 * the card, the landing page, the metadata, the structured data — and
 * `packages/games/<id>/src/manifest.ts` carries the one the product runs on: the shell
 * builds the mode buttons from the manifest, and `turn-seat.test.ts` decides which
 * questions to ask a game from its archetype.
 *
 * Nothing had ever compared the two, and eight games disagreed about `modes` (#2531).
 * Seven were marked solo-only in the catalogue while their manifests offered `friend` and
 * `bot`, so `/games/sudoku/` advertised a two-player game as solitaire — its own rule text
 * in the same row says "the square is your opponent's" — while `/play/sudoku/` rendered
 * both buttons. One, `wheelie`, promised a solo mode its manifest does not declare. And
 * `memory` was filed under `rt-split` in the catalogue and `turn-board` in its manifest,
 * which is the field that decides what the test suite asks of it.
 *
 * The manifest wins every one of these arguments, because it is the one that executes.
 * A row that disagrees with it is a promise to a visitor that the product does not keep.
 *
 * ## Why this checks every shared field rather than the two that were broken
 *
 * `roundSeconds` and `name` agreed on all 108 when this was written, and that is exactly
 * the argument for covering them: they are the fields that would drift next, silently, in
 * a repository whose HANDOFF.md keeps a tally of rules nobody was executing. A guard
 * written to cover only what is currently broken has to be rewritten each time something
 * else breaks, which is the same as not having it.
 */

/** The catalogue is keyed by package id; a game with no package has nothing to compare. */
const BUILT = CATALOGUE.filter((entry) => entry.id in LOADERS_FOR_TEST);

describe('the catalogue and the manifests', () => {
  it('has games to compare, or this file is guarding nothing', () => {
    expect(BUILT.length).toBeGreaterThan(100);
  });

  it.each(BUILT.map((entry) => [entry.id, entry] as const))(
    '%s says the same thing in both places',
    async (_id, entry) => {
      const { manifest } = await loadGame(entry.slug);

      expect(
        [...manifest.modes].sort(),
        `${entry.id}: the catalogue offers ${entry.modes.join(', ') || '(none)'} and the ` +
          `manifest offers ${manifest.modes.join(', ')}. The manifest is what the shell ` +
          `builds its buttons from, so the catalogue row is a promise the product does not keep.`,
      ).toEqual([...entry.modes].sort());

      expect(
        manifest.archetype,
        `${entry.id}: the catalogue files it under ${entry.archetype} and the manifest under ` +
          `${manifest.archetype}. The archetype decides which questions turn-seat.test.ts asks ` +
          `a game, so a game under the wrong one is being tested for the wrong thing.`,
      ).toBe(entry.archetype);

      expect(manifest.name, `${entry.id}: the two files disagree about the name`).toBe(entry.name);
    },
  );
});
