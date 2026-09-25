import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A link that names a page must name the page it opens.
 *
 * The hero button said "How it works" and opened a page headed "How to play", which is a
 * navigation bug rather than a wording one: a reader who follows a label and lands on a
 * differently-titled page cannot tell whether they arrived (#2513). The header, the footer
 * and the guide's own heading all agreed; one control did not, and nothing noticed.
 *
 * Only the pages that links refer to *by name* are checked. `/games/` is deliberately not
 * one: its links are calls to action — "Start playing", "Play now" — which describe what
 * pressing does rather than claiming to be the page's title, and holding those to a
 * heading would be a rule against writing a button.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');

/** Route → the `<h1>` the route renders. Both halves are checked. */
const NAMED_ROUTES: Readonly<Record<string, string>> = {
  '/how-to-play/': 'How to play',
  '/privacy/': 'Privacy',
  '/settings/': 'Settings',
  '/terms/': 'Terms of use',
};

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (path.endsWith('.tsx')) found.push(path);
  }
  return found;
}

/**
 * Every `<Link href="…">plain text</Link>` in one file, the i18n form included.
 *
 * Plain text only: a label built from an expression is not a literal anybody can compare
 * against a heading, and guessing at what one renders would make this test lie.
 *
 * `<Link href="…"><T id="…" /></Link>` is plain text by the same standard and is read as
 * such (#220). `<T>` with no values renders its id and nothing else, so the label in the
 * exported HTML is the string written here — and reading only the bare form would have let
 * this guard go quiet the moment the footer was translated, which is four of the four
 * routes it checks. Whitespace is collapsed first, because prettier puts the `<T>` on a line
 * of its own. A `<T>` with values, or an id that is not a literal, is not a label this can
 * compare and is skipped like any other expression.
 */
function literalLinks(source: string): { href: string; label: string }[] {
  const found: { href: string; label: string }[] = [];
  const flat = source.replace(/\s+/g, ' ');
  const pattern =
    /<Link\b[^>]*\bhref="([^"]+)"[^>]*>(?:\s*<T id="([^"{}]*)" \/>\s*|([^<{}]*))<\/Link>/g;
  for (const match of flat.matchAll(pattern)) {
    const href = match[1];
    const label = (match[2] ?? match[3])?.trim();
    if (href !== undefined && label !== undefined && label.length > 0) found.push({ href, label });
  }
  return found;
}

describe('links that name a page', () => {
  const files = sources(web);

  it('finds the shell to check', () => {
    expect(files.length).toBeGreaterThan(10);
    const links = files.flatMap((path) => literalLinks(readFileSync(path, 'utf8')));
    expect(links.length).toBeGreaterThan(5);
    // And it finds the ones it is actually for: every route in the table below is linked by
    // name from somewhere in the shell. Without this, a reader that had stopped matching
    // would pass the test above on somebody else's links and check nothing.
    const hrefs = new Set(links.map((link) => link.href));
    for (const route of Object.keys(NAMED_ROUTES)) {
      expect(hrefs, `nothing in the shell links ${route} by name any more`).toContain(route);
    }
  });

  it('reads both forms of a label, and neither of the two it cannot compare', () => {
    expect(literalLinks('<Link href="/terms/">Terms of use</Link>')).toEqual([
      { href: '/terms/', label: 'Terms of use' },
    ]);
    expect(literalLinks('<Link href="/settings/">\n  <T id="Settings" />\n</Link>')).toEqual([
      { href: '/settings/', label: 'Settings' },
    ]);
    expect(literalLinks('<Link href="/games/">{label}</Link>')).toEqual([]);
    expect(
      literalLinks('<Link href="/games/"><T id="All {count} games" values={{ count }} /></Link>'),
    ).toEqual([]);
  });

  it('opens a page whose heading is the label', () => {
    const wrong: string[] = [];
    for (const path of files) {
      for (const { href, label } of literalLinks(readFileSync(path, 'utf8'))) {
        const heading = NAMED_ROUTES[href];
        if (heading === undefined || label === heading) continue;
        wrong.push(`${relative(web, path)}: "${label}" opens ${href}, headed "${heading}"`);
      }
    }
    expect(wrong, wrong.join('; ')).toEqual([]);
  });

  it('checks headings that the routes really render', () => {
    // Half the rule is the table above being true. A heading renamed here and not in the
    // page would make the other test enforce a page that does not exist.
    for (const [route, heading] of Object.entries(NAMED_ROUTES)) {
      const page = join(web, 'app', route.replaceAll('/', ''), 'page.tsx');
      // A heading is either the literal or the same English rendered through the i18n
      // lookup (#219): `<h1><T id="Settings" /></h1>` puts exactly "Settings" in the
      // exported HTML, which is what a link's label has to match. Whitespace collapsed,
      // because prettier breaks the element onto its own line.
      const source = readFileSync(page, 'utf8').replace(/\s+/g, ' ').replace(/> </g, '><');
      expect(
        source.includes(`<h1>${heading}</h1>`) || source.includes(`<h1><T id="${heading}" /></h1>`),
        `${route} renders no <h1>${heading}</h1>, literally or through <T>`,
      ).toBe(true);
    }
  });
});
