import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './catalogue.generated';
import { CONTROLS } from './controls';
import { LOADERS_FOR_TEST, PLAYABLE, isPlayable, loadGame } from './registry';

/**
 * A game has two names, and everything a player touches must agree on which one it uses.
 *
 * The catalogue gives every game an `id` — the package it lives in — and a `slug` — the word
 * in its URL. For most they are the same word; for eighteen they are not, and Snake Clash is
 * the package `snakes` living at `/games/snake-clash/`.
 *
 * The site routes by **slug** everywhere: the catalogue card's link, the per-game page, the
 * controls lookup, `generateStaticParams`. The registry was keyed by **package id**. So
 * `isPlayable('snake-clash')` was false, the card linked to the information page with "still
 * being built" on it, and a `/play/snakes/` route was generated that nothing linked to.
 * **Eleven finished games were unreachable**, and nothing failed: every test in the repo
 * spoke package ids to a registry that spoke package ids.
 *
 * These assertions are written from the *player's* side on purpose — they ask what the
 * catalogue would do, not what the registry contains.
 */

/** The games whose two names differ, which is the case the bug lived in. */
const RENAMED = CATALOGUE.filter((entry) => entry.id !== entry.slug);

describe('a game reached by its slug', () => {
  it('is a case that actually exists, or this file is guarding nothing', () => {
    expect(RENAMED.length).toBeGreaterThan(5);
    const playableAndRenamed = RENAMED.filter((entry) => entry.id in LOADERS_FOR_TEST);
    expect(
      playableAndRenamed.length,
      'no built game has a slug different from its package id, so this file proves nothing',
    ).toBeGreaterThan(3);
  });

  it('is playable whenever its package is in the registry', () => {
    const missing = CATALOGUE.filter(
      (entry) => entry.id in LOADERS_FOR_TEST && !isPlayable(entry.slug),
    ).map((entry) => `${entry.slug} (package ${entry.id})`);
    expect(
      missing,
      `these are built but the catalogue would show them as unplayable: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('loads', async () => {
    for (const entry of CATALOGUE) {
      if (!(entry.id in LOADERS_FOR_TEST)) continue;
      const loaded = await loadGame(entry.slug);
      expect(loaded.manifest.id, `${entry.slug} loaded the wrong package`).toBe(entry.id);
    }
  });

  it('still loads by its package id, so an old link cannot break', async () => {
    for (const entry of RENAMED) {
      if (!(entry.id in LOADERS_FOR_TEST)) continue;
      expect(isPlayable(entry.id)).toBe(true);
      const loaded = await loadGame(entry.id);
      expect(loaded.manifest.id).toBe(entry.id);
    }
  });

  it('has its controls under the same name the page looks them up by', () => {
    // `/games/[slug]/page.tsx` calls `CONTROLS.get(game.slug)`. Keyed by package id, the
    // eighteen renamed games showed no controls at all.
    const missing = CATALOGUE.filter(
      (entry) => entry.id in LOADERS_FOR_TEST && !CONTROLS.has(entry.slug),
    ).map((entry) => entry.slug);
    expect(missing, `these built games have no controls on their page: ${missing.join(', ')}`).toEqual(
      [],
    );
  });
});

describe('the routes the site builds', () => {
  it('are slugs, which is what every link on the site uses', () => {
    const slugs = new Set(CATALOGUE.map((entry) => entry.slug));
    const strays = PLAYABLE.filter((slug) => !slugs.has(slug));
    expect(strays, `these are not slugs of anything in the catalogue: ${strays.join(', ')}`).toEqual(
      [],
    );
  });

  it('cover exactly the games that have a build', () => {
    const expected = CATALOGUE.filter((entry) => entry.id in LOADERS_FOR_TEST)
      .map((entry) => entry.slug)
      .sort();
    expect([...PLAYABLE].sort()).toEqual(expected);
  });

  it('name no game twice', () => {
    expect(new Set(PLAYABLE).size).toBe(PLAYABLE.length);
  });
});

describe('the catalogue itself', () => {
  it('gives every game a unique id and a unique slug', () => {
    expect(new Set(CATALOGUE.map((entry) => entry.id)).size).toBe(CATALOGUE.length);
    expect(new Set(CATALOGUE.map((entry) => entry.slug)).size).toBe(CATALOGUE.length);
  });

  it('never uses one game id as another game slug', () => {
    // That would make the two spellings ambiguous, and `resolve` would answer with the
    // wrong game rather than with nothing.
    const ids = new Set(CATALOGUE.map((entry) => entry.id));
    const clashes = CATALOGUE.filter((entry) => entry.id !== entry.slug && ids.has(entry.slug)).map(
      (entry) => entry.slug,
    );
    expect(clashes, `these slugs are also some other game's id: ${clashes.join(', ')}`).toEqual([]);
  });
});
