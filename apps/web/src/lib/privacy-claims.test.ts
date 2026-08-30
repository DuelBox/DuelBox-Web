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
  it('is checkable, because only one module writes to storage', () => {
    // The claim "one key" is only worth making while it is true. If a second writer
    // appears, the page has to be rewritten before this passes again.
    const writers = sources(web).filter((path) =>
      /localStorage\.setItem|sessionStorage|indexedDB/.test(readFileSync(path, 'utf8')),
    );
    expect(writers.map((path) => relative(web, path))).toEqual(['lib/last-mode.ts']);
  });

  it('does not claim a score is kept', () => {
    // Nothing writes one. A match tally lives in React state and dies with the tab.
    expect(prose).not.toMatch(/scores?[^.]{0,40}\b(are|is)\b[^.]{0,20}\b(kept|stored|saved)\b/i);
  });
});

describe('what the privacy page says about the network', () => {
  it('does not promise offline, because there is no service worker', () => {
    const registrations = sources(web).filter((path) =>
      /serviceWorker/.test(readFileSync(path, 'utf8')),
    );
    expect(registrations, 'a service worker exists — the page may now say offline').toEqual([]);
    expect(prose).not.toMatch(/with no connection at all/i);
  });

  it('names the host rather than gesturing at one', () => {
    expect(prose).toContain('GitHub Pages');
    expect(prose).not.toMatch(/content delivery network/i);
  });
});
