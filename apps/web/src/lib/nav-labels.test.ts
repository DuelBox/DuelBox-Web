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
 * Every `<Link href="…">plain text</Link>` in one file.
 *
 * Plain text only: a label built from an expression is not a literal anybody can compare
 * against a heading, and guessing at what one renders would make this test lie.
 */
function literalLinks(source: string): { href: string; label: string }[] {
  const found: { href: string; label: string }[] = [];
  const pattern = /<Link\b[^>]*\bhref="([^"]+)"[^>]*>([^<{}]*)<\/Link>/g;
  for (const match of source.matchAll(pattern)) {
    const href = match[1];
    const label = match[2]?.trim().replace(/\s+/g, ' ');
    if (href !== undefined && label !== undefined && label.length > 0) found.push({ href, label });
  }
  return found;
}

describe('links that name a page', () => {
  const files = sources(web);

  it('finds the shell to check', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(
      files.flatMap((path) => literalLinks(readFileSync(path, 'utf8'))).length,
    ).toBeGreaterThan(5);
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
      expect(readFileSync(page, 'utf8'), route).toContain(`<h1>${heading}</h1>`);
    }
  });
});
