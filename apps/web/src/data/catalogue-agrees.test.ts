import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './catalogue.generated';
import { MANIFESTS } from './controls';

/**
 * The catalogue card and the game must advertise the same match.
 *
 * `scripts/generate_catalog.py` used to take `roundSeconds` from a per-archetype default
 * table, while the shell takes it from the game's own manifest. They disagreed for **51 of
 * the 107 games** — Crash It's card promised 75 seconds against a 20-second match, Chess's
 * promised 90 against 300 — so a player read one number on the catalogue and played
 * another. Nothing caught it because the two numbers live in different files and neither
 * side had a reason to look at the other.
 *
 * The generator now reads each manifest, and this asserts the two stay married. It is
 * deliberately a test rather than a comment in the generator: a generator's output can be
 * regenerated from a stale checkout, and the assertion travels with the data.
 */
describe('the catalogue card and the manifest agree', () => {
  const byId = new Map(MANIFESTS.map((manifest) => [manifest.id, manifest]));

  it('has a manifest for every catalogue entry, now that every game is built', () => {
    const missing = CATALOGUE.filter((entry) => !byId.has(entry.id)).map((entry) => entry.id);
    expect(missing, `catalogue rows with no built game: ${missing.join(', ')}`).toEqual([]);
  });

  it('advertises the round length the game actually declares', () => {
    const wrong = CATALOGUE.filter((entry) => {
      const manifest = byId.get(entry.id);
      return manifest !== undefined && manifest.roundSeconds !== entry.roundSeconds;
    }).map((entry) => {
      const manifest = byId.get(entry.id);
      return `${entry.id} (card ${String(entry.roundSeconds)}s, manifest ${String(manifest?.roundSeconds)}s)`;
    });
    expect(
      wrong,
      `the catalogue promises a different match from the one the game plays: ${wrong.join(', ')}. ` +
        'Regenerate with `pnpm catalogue` rather than editing either by hand.',
    ).toEqual([]);
  });

  it('names each game the same way in both', () => {
    const wrong = CATALOGUE.filter((entry) => {
      const manifest = byId.get(entry.id);
      return manifest !== undefined && manifest.name !== entry.name;
    }).map((entry) => entry.id);
    expect(wrong, `name disagrees between catalogue and manifest: ${wrong.join(', ')}`).toEqual([]);
  });
});
