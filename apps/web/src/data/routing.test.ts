import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './catalogue.generated';
import { CONTROLS, MANIFESTS } from './controls';
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

/**
 * The registry can only get shorter quietly, and everything else here would let it.
 *
 * Every assertion above is written as `entry.id in LOADERS_FOR_TEST ? check : skip`, which is
 * the right shape while games are still being built - a catalogue row with no package yet is
 * not a routing bug. But it means a registry that *loses* entries does not fail any of them.
 * It shrinks the sample and they all pass, more cheaply than before.
 *
 * That is not hypothetical. #2497 records a tree operation that stripped `registry.ts` of its
 * entries while the manifests survived, and six guards in this directory build their cases
 * with `it.each(entries)` over the registry - so they went on reporting green over a shorter
 * list. Vitest does fail loudly on a *fully* empty `it.each` ("No test found in suite"),
 * which was checked rather than assumed; it is the partial loss that says nothing.
 *
 * Two assertions close it, and neither duplicates `catalogue-agrees.test.ts` - that file asks
 * whether every catalogue row has a *manifest*, and reads `controls.ts`. This asks whether
 * every manifest has a *loader*, and reads `registry.ts`. The gap between those two files is
 * exactly where a stripped registry hides.
 */
describe('the registry itself', () => {
  it('has a loader for every game the shell can already describe', () => {
    const orphaned = MANIFESTS.filter((manifest) => !(manifest.id in LOADERS_FOR_TEST)).map(
      (manifest) => manifest.id,
    );
    expect(
      orphaned,
      `these have a manifest the shell reads but no loader to play them: ${orphaned.join(', ')}`,
    ).toEqual([]);
  });

  it('registers every game, and the count only goes up', () => {
    // A ratchet rather than an equality, for the same reason `MEASURED_MIN` in
    // balance-aggregate.test.ts is one: a harness that goes red every time somebody
    // scaffolds a package gets edited rather than read. Losing a game is the case worth
    // failing on. Raise this when the catalogue grows.
    const registered = Object.keys(LOADERS_FOR_TEST).length;
    expect(registered, `the registry is down to ${registered} games`).toBeGreaterThanOrEqual(107);
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
