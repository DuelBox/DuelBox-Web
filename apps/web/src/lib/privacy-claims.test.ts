import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The privacy page has to describe this build, not a nearby one.
 *
 * It claimed three things the product does not do: that it stores scores, that it works
 * with no connection at all, and that it is served from "a content delivery network"
 * (#2513). None of the three was caught by anything, because a page of prose is exactly
 * the kind of artefact no test looks at.
 *
 * So this reads the page against the code it describes. It is deliberately narrow — it
 * checks the three claims that were wrong and the one fact that makes them checkable —
 * because a test that tried to verify a privacy policy in general would verify nothing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const privacy = readFileSync(join(web, 'app', 'privacy', 'page.tsx'), 'utf8');

/**
 * The page's prose: the file's own explanatory comments taken out, and whitespace collapsed
 * the way the rendered HTML collapses it — so a phrase the browser shows on one line is one
 * string here too, rather than one the source happened to wrap across an indented newline.
 */
const prose = privacy.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(path) && !path.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

describe('what the privacy page says about storage', () => {
  it('is checkable, because only one module writes to storage', () => {
    // The page lists what is kept and says every key starts with `duelbox:`. That is a
    // claim about the whole product, and it is only checkable while there is one place
    // the product writes: every store goes through `lib/local-store.ts`, so a new key
    // means a new store built on it, and a store built on it can be found by reading one
    // file's importers. A second writer would mean a key the page might not know about,
    // and the page has to be rewritten — or the writer moved behind the funnel — before
    // this passes again.
    //
    // Deliberately "every store" rather than a list of them. This comment named four —
    // setup, favourites, recent games, settings — and stayed at four through the batch
    // that added the head-to-head record and the chosen seat names, in the one file whose
    // whole job is keeping the storage claims current.
    const writers = sources(web).filter((path) =>
      /localStorage\.setItem|sessionStorage|indexedDB/.test(readFileSync(path, 'utf8')),
    );
    expect(writers.map((path) => relative(web, path))).toEqual(['lib/local-store.ts']);
  });

  it('does not claim a score is kept', () => {
    // Nothing writes one. A match tally lives in React state and dies with the tab.
    expect(prose).not.toMatch(/scores?[^.]{0,40}\b(are|is)\b[^.]{0,20}\b(kept|stored|saved)\b/i);
  });
});

describe('what the privacy page says about the network', () => {
  it('promises offline only because a service worker now backs it', () => {
    // The inversion the previous version's message anticipated: a service worker landed
    // (#2445 / the 29–30 August session), so the page is now allowed to describe offline —
    // and does. A claim the code cannot keep is what this file exists to catch, in either
    // direction.
    const registrations = sources(web)
      .filter((path) => /serviceWorker/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(web, path));
    expect(registrations, 'the offline claim needs a service worker behind it').toEqual([
      'app/service-worker-client.ts',
    ]);
    expect(prose, 'the page should describe the offline cache the worker provides').toMatch(
      /with no connection/i,
    );
  });

  it('names the host rather than gesturing at one', () => {
    expect(prose).toContain('GitHub Pages');
    expect(prose).not.toMatch(/content delivery network/i);
  });
});
