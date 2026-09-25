import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './catalogue.generated';
import { LOADERS_FOR_TEST } from './registry';

/**
 * Every slug an end-to-end spec names has to belong to a built game.
 *
 * The catalogue routes by slug and the registry is keyed by id, and for eleven games the two
 * differ — `memory` is served at `/play/memory-match/`, `four-in-a-row` at `/play/drop-four/`.
 * When the routing was corrected to use slugs, four specs were left pointing at the old
 * id-shaped URLs. Nothing caught it for a while: a missing static route still serves a page,
 * just one without a "Play together here" button on it, so each spec sat waiting for a button
 * that was never coming and failed a minute later with a timeout — which reads like a slow
 * machine rather than a wrong address, and cost a while to tell apart from one.
 *
 * This runs in the unit suite, in milliseconds, and names the bad slug.
 */
describe('the end-to-end specs', () => {
  const root = join(__dirname, '../../../../e2e');
  const specs = readdirSync(root).filter((name) => name.endsWith('.spec.ts'));

  // `isPlayable` answers to an id as well as a slug, and a temporary kill switch removes a
  // route even when a spec still correctly names its game. Check the slug-to-build mapping;
  // a spec targeting a disabled game must skip its play assertion at runtime.
  const routed = new Set(
    CATALOGUE.filter((game) => game.id in LOADERS_FOR_TEST).map((game) => game.slug),
  );

  it('has specs to check', () => {
    expect(specs.length).toBeGreaterThan(0);
    expect(routed.size).toBeGreaterThan(0);
  });

  for (const spec of specs) {
    it(`${spec} names only slugs that are really routed`, () => {
      const source = readFileSync(join(root, spec), 'utf8');
      const named = [...source.matchAll(/\bslug:\s*'([a-z0-9-]+)'/g)].map((match) => match[1]);
      const strays = [...new Set(named)].filter((slug) => slug !== undefined && !routed.has(slug));
      expect(strays, `${spec} points at ${strays.join(', ')}`).toEqual([]);
    });

    it(`${spec} navigates only to pages that are really built`, () => {
      // Navigations only. A `/play/…` URL also turns up inside assertions that a link is
      // *absent* — `chess` is cased in the catalogue with no build behind it, and a spec
      // checks the landing page offers no way in.
      const source = readFileSync(join(root, spec), 'utf8');
      const visited = [...source.matchAll(/goto\(\s*[`'"]\/play\/([a-z0-9-]+)\//g)].map(
        (match) => match[1],
      );
      // `e2e/responsive.ts` owns the goto now (#1891), so a spec that starts a match names
      // its slug in the call instead of in a URL. A guard that reads only `goto` would have
      // stopped seeing five of `resize.spec.ts`'s navigations the moment they moved, which
      // is the silent loss this file exists to prevent.
      const started = [...source.matchAll(/startMatch\(\s*page,\s*'([a-z0-9-]+)'/g)].map(
        (match) => match[1],
      );
      const strays = [...new Set([...visited, ...started])].filter(
        (slug) => slug !== undefined && !routed.has(slug),
      );
      expect(strays, `${spec} visits ${strays.join(', ')}`).toEqual([]);
    });
  }
});
