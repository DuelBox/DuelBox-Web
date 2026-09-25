import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import EN_XA from '../apps/web/src/lib/i18n/catalogues/en-XA.generated';

/**
 * Every screen under a locale half again as long as the English (#223).
 *
 * `en-XA` accents every letter and pads every string to 150% of its source length, which is
 * the acceptance criterion of #223 written as a locale: **no truncation or overflow at 150%
 * string length**. The unit suite proves the transform produces that string; what only a
 * browser can say is whether the layout survives it, and the answer is a property of the
 * stylesheet rather than of any component, so it is asked of whole screens rather than of
 * controls.
 *
 * Three questions on each screen, and each of them is a different failure:
 *
 * 1. **The document does not scroll sideways.** `scrollWidth <= clientWidth` on `<html>`. A
 *    page a phone can pan left and right is the coarsest version of this bug and the only
 *    one a player finds without reading anything.
 * 2. **No box clips its own text.** `scrollWidth <= clientWidth + 1` on every visible
 *    `button`, `a`, `label`, `h1`–`h3`, `option`, `summary`, `dt`, `dd`, `p` and `li` —
 *    unless it or an ancestor asked to be clipped, by `text-overflow: ellipsis` (a deliberate
 *    truncation with a visible mark) or by a horizontal `overflow: auto | scroll` (a box the
 *    reader can scroll). One pixel of tolerance because a fractional layout rounds up and
 *    both engines round it differently; anything real is tens of pixels.
 * 3. **No two controls overlap.** Every visible `button` and `a`, pairwise, by more than 2px
 *    in both dimensions — a label that grew over its neighbour is a control that takes the
 *    neighbour's press. A pair where one box contains the other is a deliberate stack rather
 *    than a clash (`touch-targets.spec.ts` makes the same exception for the same reason), and
 *    an element the page has covered with something else is not measured against what covers
 *    it: the pause dialog sits over the HUD on purpose.
 *
 * **A vertical scroller does not excuse a clipped line.** The exemption in (2) is on
 * `overflow-x`, not on `overflow`, because a column that scrolls up and down says nothing
 * about a word cut off at its right edge — and `overflow-y: auto` is common enough on this
 * shell that taking it as an exemption would have excused most of the site.
 *
 * ## What is deliberately not measured
 *
 * The canvas, and everything inside the play surface island — the `[dir="ltr"]` root whose
 * stylesheet pins the box model for the board (`e2e/rtl.spec.ts` and rule 9 own that
 * decision) — except the buttons in it, which are the shell's controls sitting over a game
 * rather than part of one. The island is found by its attribute and `<html>` is excluded from
 * that search by hand, because the document itself carries `dir="ltr"` in this locale.
 *
 * ## Reading a failure
 *
 * Each violation is one line — `route @width selector "text"` — and every violation on a
 * screen is reported at once rather than one per run, because a text-expansion fix is nearly
 * always one stylesheet answering for several of them.
 *
 * ## Where it runs
 *
 * One project per engine. It sets its own two viewports, so the two Chromium projects would
 * measure one engine at the same two widths twice and the two WebKit ones likewise — and both
 * engines are worth having, because line breaking, `overflow-wrap` and the intrinsic width of
 * a native `select` are engine decisions, and this spec is made of exactly those.
 */

test.use({ serviceWorkers: 'block' });

/** Every screen a visitor reaches without starting a match, including the two error ones. */
const SCREENS = [
  '/',
  '/games/',
  '/games/category/board/',
  '/games/tic-tac-toe/',
  '/how-to-play/',
  '/settings/',
  '/privacy/',
  '/terms/',
  '/dmca/',
  '/attribution/',
  '/offline/',
  '/this-route-does-not-exist/',
] as const;

/**
 * The narrowest screen the definition of done covers, and a desktop one.
 *
 * 320 is where a padded label has the least room and a fix has to be real rather than
 * incidental, which is `touch-targets.spec.ts`'s argument for the same width. 1280 is not a
 * formality: the failures text expansion causes on a wide screen are the ones a narrow layout
 * never has — a row of controls meant to sit on one line, a header that stops fitting, a grid
 * whose columns are fixed — and none of them can be seen at 320, where everything is already
 * stacked.
 */
const WIDTHS = [
  { width: 320, height: 568 },
  { width: 1280, height: 800 },
] as const;

/**
 * The `en-XA` rendering of a message, as far as its first placeholder.
 *
 * Read from the committed catalogue rather than typed, so the transform change that #223 is
 * about regenerates this spec's locators with the site's — a control found by a string typed
 * here would go stale the next time the padding moved. Cut at the placeholder because
 * Playwright matches an accessible name as a substring, and `Play against {name}` reaches the
 * button as the seat's own name interpolated into the middle of the pseudo string.
 */
function xa(id: string): string {
  const messages: Readonly<Record<string, string>> = EN_XA.messages;
  const value = messages[id];
  if (value === undefined) throw new Error(`no en-XA message for "${id}"`);
  const start = value.split('{')[0] ?? value;
  return start.replace(/^⟦/, '').trim();
}

/**
 * Store the locale once, the way a player chooses one.
 *
 * `?lang=` is read on mount and written to storage, so every later navigation in the same
 * context is pseudo-localised without carrying a query string — which matters, because a
 * `?lang=` on `/this-route-does-not-exist/` would be testing a different address from the one
 * a visitor arrives at.
 */
async function chooseEnXa(page: Page): Promise<void> {
  await page.goto('/settings/?lang=en-XA');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EN_XA.messages['Settings']);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
}

/** Wait until the page is rendered in the pseudo-locale, so nothing is measured mid-swap. */
async function settled(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
  await expect(page.locator('body')).toContainText('⟦');
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Every violation on the screen as it stands, as `route @width selector "text"` lines.
 *
 * One pass in the page rather than a locator per element: a screen carries a few hundred
 * candidates and a round trip each would be slower than the rest of the suite put together.
 */
async function violationsOn(page: Page, where: string): Promise<string[]> {
  return page.evaluate((label: string) => {
    const TEXT = 'button, a, label, h1, h2, h3, option, summary, dt, dd, p, li';
    const found: string[] = [];
    const root = document.documentElement;

    // `<html>` itself carries `dir="ltr"` in this locale, so it has to come out of the
    // search by hand or the whole document would count as the play surface.
    const islands = Array.from(document.querySelectorAll('[dir="ltr"]')).filter(
      (node) => node !== root && node !== document.body,
    );
    const inIsland = (element: Element): boolean =>
      islands.some((island) => island !== element && island.contains(element));

    function isVisible(element: Element): boolean {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (element.closest('[aria-hidden="true"]') !== null) return false;
      const rect = element.getBoundingClientRect();
      // Two pixels rather than zero: `.db-visually-hidden` is a real 1×1 box with its text
      // clipped away, and measuring one would report every screen-reader-only line as clipped.
      return rect.width > 2 && rect.height > 2;
    }

    /** Tag, semantics and the stylesheet the class came from, with the build hash dropped. */
    function describe(element: Element): string {
      const tag = element.tagName.toLowerCase();
      const module = Array.from(element.classList)
        .map((name) => name.replace(/__[\w-]+$/, ''))
        .slice(0, 2)
        .map((name) => `.${name}`)
        .join('');
      const href =
        element instanceof HTMLAnchorElement ? `[href="${new URL(element.href).pathname}"]` : '';
      const role = element.getAttribute('role');
      return `${tag}${href}${role === null ? '' : `[role="${role}"]`}${module}`;
    }

    function text(element: Element): string {
      const label = element.getAttribute('aria-label');
      const written = element.textContent.replace(/\s+/g, ' ').trim();
      // An icon-only control has no text of its own; what it is called is on the attribute.
      const own = written === '' && label !== null ? label : written;
      return own.length > 60 ? `${own.slice(0, 60)}…` : own;
    }

    /** Asked to be clipped: a deliberate ellipsis, or a box the reader can scroll sideways. */
    function allowedToClip(element: Element): boolean {
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.textOverflow === 'ellipsis') return true;
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true;
      }
      return false;
    }

    if (root.scrollWidth > root.clientWidth) {
      found.push(
        `${label} html "the document scrolls sideways: ${String(root.scrollWidth)} > ${String(
          root.clientWidth,
        )}"`,
      );
    }

    for (const element of document.querySelectorAll(TEXT)) {
      if (!isVisible(element)) continue;
      if (inIsland(element) && element.tagName !== 'BUTTON') continue;
      if (element.scrollWidth <= element.clientWidth + 1) continue;
      if (allowedToClip(element)) continue;
      found.push(
        `${label} ${describe(element)} "${text(element)}" clips ${String(
          element.scrollWidth - element.clientWidth,
        )}px`,
      );
    }

    /**
     * Whether the page has covered this control with something else.
     *
     * Asked at the control's own centre: if the topmost element there is neither this one nor
     * anything inside or around it, the control is behind an overlay and the overlay's own
     * controls are not its neighbours. Below the fold the question cannot be asked at all —
     * `elementFromPoint` only answers inside the viewport — and there the box is taken at face
     * value, which is the right answer for a layout measurement.
     */
    function onTop(element: Element): boolean {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x > root.clientWidth || y > root.clientHeight) return true;
      const hit = document.elementFromPoint(x, y);
      if (hit === null) return false;
      return hit === element || element.contains(hit) || hit.contains(element);
    }

    /** Whether `outer` covers every edge of `inner`. */
    function holds(outer: DOMRect, inner: DOMRect): boolean {
      return (
        outer.left <= inner.left &&
        outer.top <= inner.top &&
        outer.right >= inner.right &&
        outer.bottom >= inner.bottom
      );
    }

    const controls = Array.from(document.querySelectorAll('button, a')).filter(
      (element) =>
        isVisible(element) &&
        (!inIsland(element) || element.tagName === 'BUTTON') &&
        onTop(element),
    );
    for (let i = 0; i < controls.length; i += 1) {
      for (let j = i + 1; j < controls.length; j += 1) {
        const a = controls[i];
        const b = controls[j];
        if (a === undefined || b === undefined) continue;
        const boxA = a.getBoundingClientRect();
        const boxB = b.getBoundingClientRect();
        // A pair where one box holds the other is a deliberate stack rather than a clash —
        // the catalogue's favourite star sits inside its card, takes every press inside
        // itself and leaves the rest to the card, so there is nothing for a thumb to land
        // in that is ambiguous. `touch-targets.spec.ts` makes the same exception in the same
        // words. Geometry rather than the DOM, because the star is the card's sibling.
        if (holds(boxA, boxB) || holds(boxB, boxA)) continue;
        const across = Math.min(boxA.right, boxB.right) - Math.max(boxA.left, boxB.left);
        const down = Math.min(boxA.bottom, boxB.bottom) - Math.max(boxA.top, boxB.top);
        if (across <= 2 || down <= 2) continue;
        found.push(
          `${label} ${describe(a)} "${text(a)}" overlaps ${describe(b)} "${text(b)}" by ${String(
            Math.round(across),
          )}×${String(Math.round(down))}px`,
        );
      }
    }

    return found;
  }, where);
}

for (const size of WIDTHS) {
  const at = `@${String(size.width)}`;

  test.describe(`text expansion at ${String(size.width)}×${String(size.height)}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size);
      await chooseEnXa(page);
    });

    test(`every shell screen holds its text ${at}`, async ({ page }) => {
      // Twelve pages, each a navigation and a full-document measurement rather than a match.
      test.setTimeout(120_000);
      const found: string[] = [];
      for (const route of SCREENS) {
        await page.goto(route);
        await settled(page);
        found.push(...(await violationsOn(page, `${route} ${at}`)));
      }
      expect(found.join('\n')).toBe('');
    });

    /**
     * The play route, which is three screens rather than one and the only place the shell
     * draws over a game: the lobby a match is started from, the pause menu over a live board,
     * and the result screen a match ends on.
     *
     * The match is started the way `match-flow.spec.ts` starts one — the two-player button,
     * then the HUD's pause — and the result is reached its cheap way: Crash It at hard settles
     * a round against an idle human seat in about eight seconds, and one round is the whole
     * match, so the result screen costs a countdown and a crash rather than a best-of-three.
     */
    test(`the lobby, the pause menu and the result screen hold their text ${at}`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const found: string[] = [];

      await page.goto('/play/tic-tac-toe/');
      await settled(page);
      const together = page.getByRole('button', { name: xa('Play together here') });
      await expect(together).toBeVisible();
      found.push(...(await violationsOn(page, `/play/tic-tac-toe/ (lobby) ${at}`)));

      await together.click();
      await page.getByRole('button', { name: xa('Pause the match') }).click();
      const paused = page.getByRole('dialog', { name: xa('Paused') });
      await expect(paused).toBeVisible();
      found.push(...(await violationsOn(page, `/play/tic-tac-toe/ (paused) ${at}`)));

      await page.goto('/play/crash-it/');
      await settled(page);
      await page.getByRole('radio', { name: xa('Hard') }).check();
      await page.getByRole('radio', { name: xa('1 round') }).check();
      await page.getByRole('button', { name: xa('Play against {name}') }).click();
      await expect(page.getByRole('button', { name: xa('Rematch') })).toBeVisible({
        timeout: 60_000,
      });
      found.push(...(await violationsOn(page, `/play/crash-it/ (result) ${at}`)));

      expect(found.join('\n')).toBe('');
    });
  });
}
