import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAYER_DATA_KEYS } from './player-data';

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
 *
 * Narrow is not the same as aimed at the wrong thing, and this file was aimed at the wrong
 * thing for one store. It held the *funnel* — one writer, therefore a findable set of keys —
 * and never the *list*, so the tournament (#157) put a seventh key under `duelbox:` through
 * the very module this checks, and the page went on saying "Six things" over six items with
 * the tournament missing from them. The list is now counted against `PLAYER_DATA_KEYS`,
 * which is the array export, import and erase walk: a key that travels in a player's export
 * and is not named on this page fails here. CLAUDE.md's tenth entry is that failure.
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

/**
 * A file whose words a visitor can be shown. Both test extensions are excluded, not just
 * `.test.ts`: a `.test.tsx` would otherwise be read as product prose, and the same slip in
 * `offline-claims.test.ts` reddens CI on the day somebody writes one.
 */
const isProseSource = (path: string): boolean =>
  /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path);

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (isProseSource(path)) found.push(path);
  }
  return found;
}

/** The numbers this page is allowed to count in, spelled the way it spells them. */
const COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/**
 * The one section that enumerates the stores, from its own heading to the next one.
 *
 * Sliced rather than counted across the whole page, because there are other lists on it and
 * a count over all of them would be a number nobody could act on. Throws rather than falls
 * back to the whole file: a slice that quietly stopped finding its section would count every
 * bullet on the page and pass.
 */
function storageSection(): string {
  const heading = '<h2>What stays on your device</h2>';
  const start = prose.indexOf(heading);
  if (start === -1) {
    throw new Error(
      `the privacy page no longer has a "${heading}" section, so this file cannot find the` +
        ' list it is holding to PLAYER_DATA_KEYS. Point it at whatever replaced it.',
    );
  }
  const end = prose.indexOf('<h2>', start + heading.length);
  return end === -1 ? prose.slice(start) : prose.slice(start, end);
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

  it('lists one thing for every key the site writes, and counts them correctly', () => {
    // The half the funnel check cannot see. One writer means the keys are findable; it does
    // not mean anybody went and found them, and for the tournament nobody did. The list is
    // meant to be exhaustive — the page says so, in a number, before the first bullet — so
    // the number and the bullets are both held against `PLAYER_DATA_KEYS`, which is what a
    // player's export actually contains.
    const section = storageSection();
    const items = section.match(/<li>/g) ?? [];
    expect(
      items.length,
      `the page enumerates ${String(items.length)} stores and the site writes ${String(
        PLAYER_DATA_KEYS.length,
      )}: ${PLAYER_DATA_KEYS.join(', ')}. A key that travels in an export belongs on this page.`,
    ).toBe(PLAYER_DATA_KEYS.length);

    const stated = /\b([A-Za-z]+) things, all kept in your browser/.exec(section);
    expect(
      stated,
      'the section no longer opens by counting what it is about to list. If it has stopped' +
        ' stating a number, delete this half rather than weakening it.',
    ).not.toBeNull();
    expect(COUNT_WORDS[(stated?.[1] ?? '').toLowerCase()]).toBe(PLAYER_DATA_KEYS.length);
  });

  it('can read a wrong count as well as a right one', () => {
    // Without this, the check above passes just as happily on a word it cannot parse at all.
    expect(COUNT_WORDS['six']).toBe(6);
    expect(COUNT_WORDS['seven']).toBe(7);
    expect(COUNT_WORDS['plenty']).toBeUndefined();
    // And the slice: a section that fell back to the whole file would count the bullets in
    // the doc comment above it and pass on a page listing nothing at all.
    expect(storageSection()).not.toContain('<h2>Cookies</h2>');
    expect(storageSection()).toContain('favourites');
  });
});

describe('what the privacy page says about the network', () => {
  /**
   * The offline half of #2513 has moved to `offline-claims.test.ts`, and this is the note
   * saying where, because its absence here is the whole point of the move.
   *
   * It used to live at this line: no source under `apps/web/src` mentions a service
   * worker, therefore the privacy page may not say the site works with no connection. Both
   * halves were right and the pairing was too narrow — README.md and CLAUDE.md went on
   * calling the product "offline-capable" for another six days with this test green on
   * every push, because a guard built out of one page's prose can only ever hold one page.
   * The replacement computes the same fact and holds it against every file that describes
   * the product, this page among them, and it fails in both directions.
   */
  it('names the host rather than gesturing at one', () => {
    expect(prose).toContain('GitHub Pages');
    expect(prose).not.toMatch(/content delivery network/i);
  });
});
