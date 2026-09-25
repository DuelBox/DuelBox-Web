import { expect, test, type Page } from '@playwright/test';
import { CATEGORY_HUBS } from '../apps/web/src/lib/categories';
import EN_XA from '../apps/web/src/lib/i18n/catalogues/en-XA.generated';
import { PSEUDO_ALLOWED_PATTERNS, PSEUDO_ALLOWLIST } from './pseudo-allowlist';

/**
 * The pseudo-locale as a check rather than a screen to look at (#220, #223).
 *
 * `en-XA` accents every letter of every msgid and wraps it in `⟦ ⟧`, so on a page rendered in it
 * a run of plain letters *outside* the brackets is a string the extractor never saw — a literal
 * a territory missed, a data string nobody registered in `sources.ts`, a value built by
 * concatenation. The lint rule cannot find those: it reads the shape of a file's JSX, and a
 * string that arrives through a variable is an expression to it. This spec finds them the only
 * way they can be found, by rendering every route in the pseudo-locale and reading what came out.
 *
 * What it reads: every text node under the three landmarks (`header`, `main`, `footer`) that
 * is not inside a `display: none` or `visibility: hidden` ancestor — visually-hidden copy for a
 * screen reader is copy — plus the `aria-label`, `title`, `placeholder` and `alt` of every such
 * element. `<script>`, `<style>`, `<noscript>` (deliberately English, `docs/i18n.md`) and inline
 * SVG are skipped. What is left after the bracketed runs are removed is held against
 * `pseudo-allowlist.ts`, whole word by whole word, and anything still carrying a letter fails the
 * route with the element it was found in and the text itself.
 *
 * The play route is walked in two states, because its lobby and its pause menu are the two
 * screens with the most copy on the site and neither is in the exported HTML. The canvas is
 * not read: the thirty-two games that draw English through the renderer's `text()` are
 * `docs/i18n.md`'s recorded limitation, not this spec's.
 */

const LANG = '?lang=en-XA';

const HUB = CATEGORY_HUBS[0];
if (HUB === undefined) throw new Error('no category hubs');

const ROUTES: readonly string[] = [
  '/',
  '/games/',
  `/games/category/${HUB.slug}/`,
  '/games/tic-tac-toe/',
  '/how-to-play/',
  '/settings/',
  '/privacy/',
  '/terms/',
  '/dmca/',
  '/attribution/',
  '/offline/',
  '/no-such-page/',
  // The embed of a game: its own footer carries the backlink sentence and the wordmark link's
  // name, and nothing else on the site renders that route.
  '/embed/tic-tac-toe/',
];

interface Found {
  readonly where: string;
  readonly kind: 'text' | 'aria-label' | 'title' | 'placeholder' | 'alt';
  readonly value: string;
}

/** Everything under the three landmarks that a person or a screen reader is handed. */
function collect(page: Page): Promise<Found[]> {
  return page.evaluate(() => {
    const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt'] as const;
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg']);
    const found: { where: string; kind: (typeof ATTRIBUTES)[number] | 'text'; value: string }[] =
      [];
    const shown = (element: Element): boolean => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const describe = (element: Element): string => {
      const parts: string[] = [];
      for (
        let node: Element | null = element;
        node && node !== document.body;
        node = node.parentElement
      ) {
        const tag = node.tagName.toLowerCase();
        const id = node.id ? `#${node.id}` : '';
        const role = node.getAttribute('role');
        parts.unshift(`${tag}${id}${role ? `[${role}]` : ''}`);
        if (parts.length === 4) break;
      }
      return parts.join(' > ');
    };
    const walk = (element: Element): void => {
      if (SKIP.has(element.tagName) || !shown(element)) return;
      for (const attribute of ATTRIBUTES) {
        const value = element.getAttribute(attribute);
        if (value) found.push({ where: describe(element), kind: attribute, value });
      }
      for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const value = (child.nodeValue ?? '').replace(/\s+/g, ' ').trim();
          if (value) found.push({ where: describe(element), kind: 'text', value });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child as Element);
        }
      }
    };
    for (const landmark of document.querySelectorAll('header, main, footer')) walk(landmark);
    return found;
  });
}

/** The allowlist as whole-word patterns, for one route: an entry with `routes` counts only there. */
function allowedOn(route: string): RegExp[] {
  return PSEUDO_ALLOWLIST.filter((entry) => entry.routes === undefined || entry.routes.test(route))
    .map((entry) => entry.text)
    .filter((text) => /[A-Za-z]/u.test(text))
    .sort((a, b) => b.length - a.length)
    .map(
      (text) =>
        new RegExp(`(?<!\\p{L})${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'gu'),
    );
}

/**
 * The ASCII letters of `text` that the allowlist does not account for, or null.
 *
 * ASCII rather than "outside the brackets": `pseudoAccent` maps all fifty-two ASCII letters, so
 * a translated string carries none. Outside `⟦ ⟧` a plain run is a literal; inside them it is a
 * value that was interpolated untranslated — "⟦Ṁöŕé board ĝåɱéš⟧" is a category name handed to
 * a sentence as a string rather than as a `<T>` — and a check that stopped at the brackets
 * would let the second kind through. A sentence with an element in it is several text nodes,
 * which is the other reason not to pair brackets across a node.
 */
export function unexplained(text: string, route: string): string | null {
  if (!/[A-Za-z]/u.test(text)) return null;
  // Shapes first, on whole tokens, because an email address contains the brand and the
  // allowlist would take that word out from the middle of it.
  let rest = text
    .split(/\s+/u)
    .filter((token) => token.length > 0)
    .filter((token) => !PSEUDO_ALLOWED_PATTERNS.some(({ pattern }) => pattern.test(token)))
    .join(' ');
  for (const allowed of allowedOn(route)) rest = rest.replace(allowed, ' ');
  return /[A-Za-z]/u.test(rest) ? rest : null;
}

async function sweep(page: Page, route: string, screen = route): Promise<void> {
  const misses = (await collect(page)).flatMap((item) => {
    const rest = unexplained(item.value, route);
    return rest === null ? [] : [`${item.where} ${item.kind}: "${item.value}" — plain: "${rest}"`];
  });
  expect(
    misses,
    `${screen}: ${String(misses.length)} run(s) of plain English on a pseudo-localised screen (a literal the extractor never saw, or a deliberate exemption missing from e2e/pseudo-allowlist.ts)`,
  ).toEqual([]);
}

async function open(page: Page, route: string): Promise<void> {
  await page.goto(`${route}${LANG}`);
  // The provider reads `?lang=` on mount and the chunk arrives a frame later; the sweep waits
  // for the document to say the locale is on, and for the first translated run to be there.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
  await expect(page.getByRole('main')).toContainText('⟦');
}

test.describe('the pseudo-locale sweep', () => {
  for (const route of ROUTES) {
    test(`${route} renders no plain English outside ⟦ ⟧`, async ({ page }) => {
      await open(page, route);
      await sweep(page, route);
    });
  }

  test('/play/tic-tac-toe/ — the lobby, then the pause menu', async ({ page }) => {
    await open(page, '/play/tic-tac-toe/');
    await sweep(page, '/play/tic-tac-toe/', '/play/tic-tac-toe/ lobby');

    const start = page.getByRole('button', { name: EN_XA.messages['Play together here'] });
    await expect(start).toBeVisible();
    await start.click();
    // Let the opening countdown finish so the pause is a pause, not a countdown skip — the
    // same wait `match-flow.spec.ts` uses.
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.waitForTimeout(3500);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await sweep(page, '/play/tic-tac-toe/', '/play/tic-tac-toe/ paused');
  });
});
