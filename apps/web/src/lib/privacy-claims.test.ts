import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The privacy page has to describe this build, not a nearby one.
 *
 * It once claimed three things the product did not do: that it stores scores, that it works
 * with no connection at all, and that it is served from "a content delivery network"
 * (#2513). None of the three was caught by anything, because a page of prose is exactly
 * the kind of artefact no test looks at.
 *
 * So this reads the page against the code it describes. Two of those facts have since moved:
 * a second setting is stored (sound, alongside the game setup), and a service worker landed
 * (#2445), so "works with no connection" became true rather than being trimmed. The checks
 * move with them — that is the point of pinning prose to code rather than to a moment.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const privacy = readFileSync(join(web, 'app', 'privacy', 'page.tsx'), 'utf8');

/** The page's prose, with the file's own explanatory comments taken out. */
const prose = privacy.replace(/\/\*[\s\S]*?\*\//g, '');

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(path) && !path.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

describe('what the privacy page says about storage', () => {
  it('is checkable, because a known, small set of modules writes to storage', () => {
    // The claim "a couple of small settings" is only worth making while it is true. If a
    // third writer appears, the page has to be rewritten before this passes again.
    const writers = sources(web)
      .filter((path) =>
        /localStorage\.setItem|sessionStorage|indexedDB/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(web, path))
      .sort();
    expect(writers).toEqual(['lib/last-mode.ts', 'lib/sound-preference.ts']);
  });

  it('does not claim a score is kept', () => {
    // Nothing writes one. A match tally lives in React state and dies with the tab.
    expect(prose).not.toMatch(/scores?[^.]{0,40}\b(are|is)\b[^.]{0,20}\b(kept|stored|saved)\b/i);
  });
});

describe('what the privacy page says about the network', () => {
  it('promises offline only because a service worker now backs it', () => {
    // The inversion the previous version's message anticipated: a service worker landed
    // (#2445), so the page is now allowed to describe offline — and does. A claim the code
    // cannot keep is what this file exists to catch, in either direction.
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
