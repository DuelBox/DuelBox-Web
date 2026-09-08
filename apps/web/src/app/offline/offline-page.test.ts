import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The offline fallback holds two agreements it cannot keep on its own, and this is what keeps
 * them.
 *
 * Neither is checkable by reading this route: both are agreements with a file somewhere else,
 * of the kind that stay true until the day somebody rewords one half of them, and both fail
 * silently when they break — a page that is merely *wrong* still renders.
 *
 * **The heading is an acceptance criterion.** `e2e/offline.spec.ts` waits for a heading whose
 * accessible name is exactly `Not saved to this device`, and that spec is the specification for
 * this route: it landed before the implementation and it is what #2544 exists to satisfy. A
 * rewording here would be caught — by a three-minute browser run, on Chromium only, after the
 * unit suite, the lint and the build have all gone green. Held here it costs a second.
 *
 * **The two marks are quoted from the catalogue.** The words in the legend on this page are the
 * words `globals.css` renders on a catalogue link when the connection is gone, and they are
 * quoted rather than paraphrased so that a player meets one vocabulary rather than two. Nothing
 * in the type system knows that, and a legend that teaches a vocabulary its destination has
 * stopped using is worse than no legend: the player then distrusts both surfaces.
 *
 * The third describe is not an agreement with another file but a decision about this one, of
 * the kind `loading-states.test.ts` holds for the play route's fallback: this page is on the
 * shell budget every visitor pays, so what it imports is a decision and not an accident.
 *
 * Every reader below is handed an input it should reject, in the same test, because a reader
 * that has quietly stopped matching turns each of these into a guard that passes on anything.
 * CLAUDE.md counts the guards this repository has found enforcing nothing; the cheapest way not
 * to add another is to watch this one fail on purpose, which the batch that wrote it did, twice:
 * once with the heading reworded and once with a mark's wording changed on one side.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', '..', '..');
const root = join(web, '..', '..');

const page = readFileSync(join(here, 'page.tsx'), 'utf8');
const globals = readFileSync(join(here, '..', 'globals.css'), 'utf8');
const spec = readFileSync(join(root, 'e2e', 'offline.spec.ts'), 'utf8');

/**
 * The text of every `<h1>` in a page, with its whitespace normalised the way an accessible
 * name is.
 *
 * Only literal text: a heading assembled from an expression is not something this can compare
 * against a string in a spec, so one would be reported as no heading at all rather than
 * silently passing.
 */
function headings(source: string): string[] {
  return [...source.matchAll(/<h1\b[^>]*>([^<]*)<\/h1>/g)]
    .map((match) => (match[1] ?? '').trim().replace(/\s+/g, ' '))
    .filter((text) => text.length > 0 && !text.includes('{'));
}

/** Every accessible name `e2e/offline.spec.ts` asks a heading for. */
function headingNamesAssertedBy(source: string): string[] {
  const pattern = /getByRole\(\s*['"]heading['"]\s*,\s*\{\s*name:\s*['"]([^'"]+)['"]/g;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? '');
}

/**
 * The word the catalogue puts on a link, by whether the device holds that game: `1` for a game
 * that is here, `0` for one that is not.
 *
 * Read out of the `content:` declarations rather than restated, because restating them here
 * would make this file a third copy of the two strings and leave all three free to drift.
 */
function catalogueMarks(css: string): Record<string, string> {
  const pattern = /a\[data-offline-ready='([01])'\]::after\s*\{[^}]*?content:\s*'([^']*)'/g;
  const found: Record<string, string> = {};
  for (const match of css.matchAll(pattern)) {
    const ready = match[1];
    const words = match[2];
    if (ready !== undefined && words !== undefined) found[ready] = words;
  }
  return found;
}

/** Every module a source file imports, in the order it imports them. */
function imports(source: string): string[] {
  return [...source.matchAll(/^import\s[^']*'([^']+)';$/gm)].map((match) => match[1] ?? '');
}

describe('the heading the e2e spec waits for', () => {
  const asserted = headingNamesAssertedBy(spec);
  const rendered = headings(page);

  it('is asked for by the spec, so this test is holding something', () => {
    // A guard whose other half has gone quiet passes for ever. If `offline.spec.ts` stops
    // naming a heading at all, the agreement below has nothing to be an agreement with.
    expect(asserted.length, 'e2e/offline.spec.ts no longer waits for any heading').toBeGreaterThan(
      0,
    );
  });

  it('is the one heading this page renders', () => {
    // One `<h1>`, and it must be literal text. Playwright resolves a role locator strictly, so
    // a second heading on this page with the same name would fail the spec on ambiguity rather
    // than on absence — a failure that reads as "the page is missing" when it is not.
    expect(rendered, 'the offline page renders no literal <h1>').toHaveLength(1);
    expect(asserted, `the spec waits for ${asserted.join(', ')}`).toContain(rendered[0]);
  });

  it('reads a heading it should not accept as well as one it should', () => {
    expect(headings('<h1 className={styles.title}>Not saved to this device</h1>')).toEqual([
      'Not saved to this device',
    ]);
    // An interpolated heading is not a string anything can compare, and must not be read as one.
    expect(headings('<h1>{title}</h1>')).toEqual([]);
    expect(headingNamesAssertedBy("getByRole('heading', { name: 'Score' })")).toEqual(['Score']);
    expect(headingNamesAssertedBy("getByRole('button', { name: 'Reload' })")).toEqual([]);
  });
});

describe('the two marks this page quotes from the catalogue', () => {
  const marks = catalogueMarks(globals);

  it('are the two the catalogue actually renders', () => {
    expect(
      Object.keys(marks).sort(),
      'globals.css no longer annotates catalogue links in words — see rule 7',
    ).toEqual(['0', '1']);
  });

  it('are quoted here word for word, both of them', () => {
    for (const [ready, words] of Object.entries(marks)) {
      expect(
        page,
        `the catalogue says "${words}" for data-offline-ready="${ready}" and this page does not`,
      ).toContain(`<dt>${words}</dt>`);
    }
  });

  it('reads the stylesheet rather than matching anything shaped like it', () => {
    const css = `html[data-net='offline'] a[data-offline-ready='1']::after {\n  content: 'Here';\n}`;
    expect(catalogueMarks(css)).toEqual({ '1': 'Here' });
    // A rule with no `content` is not a mark, and must not be read as an empty one.
    expect(catalogueMarks(`a[data-offline-ready='0'] {\n  opacity: 0.55;\n}`)).toEqual({});
  });
});

describe('the offline page ships no behaviour', () => {
  /**
   * What it may import, and why each one is on the list.
   *
   * `check-size.mjs` bills every non-play route's eager scripts to the shell budget, so an
   * import here is a download for every visitor to any page — on a route that exists for the
   * moment a fetch fails, which is the worst possible time to need one. The three below are
   * the floor: a type, the link component the whole shell already carries, and this route's
   * own stylesheet. A fourth needs the on-disk numbers before and after it, the way
   * `loading-states.test.ts` says: the word "server" is not a measurement.
   */
  const ALLOWED = ['next', 'next/link', './page.module.css'];

  it('is a server component', () => {
    expect(page, 'a client component here is paid for by every visitor').not.toContain(
      'use client',
    );
  });

  it('imports only what it is allowed to', () => {
    const extra = imports(page).filter((specifier) => !ALLOWED.includes(specifier));
    expect(extra, `an unbudgeted import on the shell: ${extra.join(', ')}`).toEqual([]);
    expect(imports(page), 'the import reader found nothing at all').toContain('./page.module.css');
  });

  it('keeps itself out of search, being a stand-in for another page', () => {
    expect(page, 'the fallback would compete with the pages it stands in for').toContain(
      'index: false',
    );
  });
});
