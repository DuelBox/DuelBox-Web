import { describe, expect, it } from 'vitest';
import { GAME_IDS } from './game-names.generated';
import { LOADERS_FOR_TEST, SLUG_ALIASES_FOR_TEST, isPlayable } from './registry';

/**
 * `registry.ts` writes out the eighteen slugs whose package id differs, instead of reading
 * all 108 pairs from `GAME_IDS`, because `resolve` is called by a client component and so
 * everything it touches ships to every visitor.
 *
 * That is a saving bought with a duplicate, and a duplicate that can drift is worse than
 * the bytes. So it is checked here, in Node, where the full map is free: the hand-written
 * table must agree with the generated one **in both directions**. A game renamed in the
 * catalogue and not here would otherwise 404 in production and pass every other test — the
 * same failure that once made eleven finished games unreachable.
 */
describe('the hand-written slug aliases', () => {
  const derived = Object.fromEntries(
    Object.entries(GAME_IDS).filter(([slug, id]) => slug !== id),
  );

  it('lists exactly the slugs whose package id differs', () => {
    expect(SLUG_ALIASES_FOR_TEST).toEqual(derived);
  });

  it('is not empty, or it is agreeing with nothing', () => {
    expect(Object.keys(derived).length).toBeGreaterThan(10);
  });

  it('resolves every catalogue slug the way the generated map does', () => {
    // The property that actually matters: for every slug the site can route to, the
    // cheaper lookup and the full map must land on the same package.
    for (const [slug, id] of Object.entries(GAME_IDS)) {
      const playable = id in LOADERS_FOR_TEST;
      expect(isPlayable(slug), `${slug} resolves differently now`).toBe(playable);
    }
  });

  it('still answers when handed a package id rather than a slug', () => {
    for (const id of Object.keys(LOADERS_FOR_TEST)) {
      expect(isPlayable(id), `${id} stopped resolving from its own id`).toBe(true);
    }
  });
});
