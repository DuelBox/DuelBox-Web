import { expect, test, type Page } from '@playwright/test';

/**
 * The shell turned round for a right-to-left reader, in a real engine against the built
 * export (#222).
 *
 * `styles/direction.test.ts` reads the stylesheets and says nothing physical is left in them
 * without a written reason; this is the other half, which asks a browser what that produced.
 * A logical property is only a mirror if the engine honours it — `inset-inline-start` on a
 * skip link, `margin-inline-start: auto` on a nav, a `translateX` signed by a token — and
 * whether an engine honours it is exactly the kind of thing engines have differed about, so
 * this runs on every project rather than in `CONTENT_ONLY`.
 *
 * ## How the direction is set
 *
 * The locale registry (`lib/i18n`, being built in parallel) stamps `dir` on `<html>` from the
 * locale's own direction, alongside `lang`. It has not landed on this branch, so each page
 * here is given the same attribute by an init script before any of the site's own script
 * runs. That is the same DOM the registry will produce and a smaller claim: it proves the
 * shell mirrors when told to, not that the registry tells it.
 *
 * TODO(#222, lib/i18n): when the registry lands, drop `forceRtl` and open the pseudo-locale
 * instead, so the attribute under test is the one the product sets:
 *
 *     await page.goto(`${route}?lang=ar-XB`);
 *
 * ## What is measured
 *
 * On the landing page, the catalogue, the settings page and a play route: the brand sits at
 * the right edge with the navigation to its left; the skip link, once focused, sits at the
 * inline start, which is now the right; nothing scrolls sideways, on the document or inside
 * any button. On the play route with a match running: the play surface is an `ltr` island
 * — `direction` computes to `ltr` on it while `<html>` is `rtl` — and, the assertion rule 9
 * actually needs, **nothing on it moves**: the two seats' scoreboards, the board and the
 * exit control sit at the same pixels as in a left-to-right load of the same page, while
 * the header's brand, measured the same way, does move. The last is the control that the
 * init script took effect, so an island that "did not move" because nothing did cannot pass.
 * And the mirror class the directional icons wear flips outside the island and not inside it.
 *
 * ## Watched failing
 *
 * Each plant went into the built export's CSS, the spec ran on Chromium, and the file was
 * put back. `direction:ltr` on the surface turned to `rtl`: `Expected: "ltr" Received:
 * "rtl"`. The mirror class's transform set to `none`: shell and island both read `none`.
 * The skip link's `inset-inline-start` put back to `left`: `skip link on the right half —
 * Expected: > 640, Received: 16`, on all four routes. The header row reversed: `brand flush
 * right — Expected: <= 1, Received: 1053`. And a rule appended that makes the scoreboard
 * row follow `[dir=rtl]`, with the island's own direction untouched: the direction check
 * passed and the rule 9 check failed on seat one, `left: 69 → 761`, which is the failure
 * this file exists to produce.
 */

/**
 * Stamp the attribute the locale registry will stamp, before the page's own script runs.
 *
 * Not simply `document.documentElement.setAttribute(…)`. An init script runs the moment the
 * document is created, and in Chromium that is before the parser has inserted `<html>`:
 * measured over twelve loads of `/games/`, `documentElement` was `null` in every one, so the
 * one-line version threw into nothing and every assertion below failed on its control —
 * `direction` computing `ltr` on the root — which is what the control is for. The first
 * `childList` mutation on the document is the doctype, a comment and the root element in
 * one batch (sixteen of sixteen loads), and the observer stamps it there. It keeps observing
 * rather than disconnecting, and stamps again at `DOMContentLoaded`, because a version that
 * stamped once and stood down still lost two loads in eight under a parallel run, and a
 * guard on layout must not depend on winning a race with the parser.
 */
async function forceRtl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // The DOM types say the root is never null; at document creation it is.
    const root = (): HTMLElement | null => document.documentElement;
    const stamp = () => {
      const el = root();
      if (el !== null && el.getAttribute('dir') !== 'rtl') el.setAttribute('dir', 'rtl');
    };
    stamp();
    new MutationObserver(stamp).observe(document, { childList: true });
    document.addEventListener('DOMContentLoaded', stamp);
  });
}

type Box = { left: number; right: number; top: number; bottom: number };

async function box(page: Page, selector: string): Promise<Box> {
  const rect = await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
  return {
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    top: Math.round(rect.top),
    bottom: Math.round(rect.bottom),
  };
}

const ROUTES = ['/', '/games/', '/settings/', '/play/tic-tac-toe/'] as const;

test.describe('a right-to-left shell', () => {
  for (const route of ROUTES) {
    test(`mirrors the header, the skip link and nothing overflows on ${route}`, async ({
      page,
    }) => {
      await forceRtl(page);
      await page.goto(route);
      // The layout viewport, which on a desktop project is the window less its scrollbar.
      const width = await page.evaluate(() => document.documentElement.clientWidth);

      // The control: the attribute took, and the engine turned the document round.
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).direction)).toBe(
        'rtl',
      );

      // The brand is the first thing in the row, so it sits flush against the inline start
      // of the header's content box — its right edge inside the gutter — with the navigation
      // to its left. Measured against the header's own content edge rather than the window,
      // because `.db-wrap` caps itself at 76rem and centres, so on a wide window the gutter
      // is not where the viewport ends.
      const header = await page
        .locator('header > div')
        .first()
        .evaluate((inner) => {
          const rect = inner.getBoundingClientRect();
          const style = getComputedStyle(inner);
          return {
            contentRight: Math.round(rect.right - parseFloat(style.paddingRight)),
            contentLeft: Math.round(rect.left + parseFloat(style.paddingLeft)),
          };
        });
      const brand = await box(page, 'header a[aria-label="DuelBox home"]');
      const nav = await box(page, 'header nav[aria-label="Main"]');
      expect(Math.abs(brand.right - header.contentRight), 'brand flush right').toBeLessThanOrEqual(
        1,
      );
      expect(brand.left, 'brand on the right half').toBeGreaterThan(width / 2);
      expect(nav.right, 'nav to the left of the brand').toBeLessThanOrEqual(brand.left);
      expect(nav.left, 'nav inside the content box').toBeGreaterThanOrEqual(header.contentLeft);

      // The skip link parks off-screen until focused, then slides in — `transition: top` in
      // globals.css — so its box is read once it has settled, not on the frame focus landed.
      await page.locator('.db-skip').focus();
      await expect
        .poll(async () => (await box(page, '.db-skip')).top, 'skip link slid on screen')
        .toBeGreaterThanOrEqual(0);
      const skip = await box(page, '.db-skip');
      expect(skip.left, 'skip link on the right half').toBeGreaterThan(width / 2);
      expect(width - skip.right, 'skip link at the right gutter').toBeLessThanOrEqual(48);

      // Nothing scrolls sideways: not the document, not any button.
      const overflow = await page.evaluate(() => {
        const bad: string[] = [];
        const root = document.documentElement;
        if (root.scrollWidth > root.clientWidth) {
          bad.push(`document ${String(root.scrollWidth)} > ${String(root.clientWidth)}`);
        }
        for (const el of document.querySelectorAll('button')) {
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          if (el.scrollWidth > el.clientWidth) {
            bad.push(
              `${el.textContent.trim() || el.className} ${String(el.scrollWidth)} > ${String(el.clientWidth)}`,
            );
          }
        }
        return bad;
      });
      expect(overflow, 'horizontal overflow').toEqual([]);
    });
  }

  test('leaves the play surface exactly where a left-to-right shell puts it', async ({
    context,
  }) => {
    // Two pages of the same route, one turned round and one not, both with a match running.
    const start = async (page: Page) => {
      await page.goto('/play/tic-tac-toe/');
      await page.getByRole('button', { name: 'Play together here' }).click();
      await expect(page.locator('canvas')).toBeVisible();
      await expect(page.getByRole('group', { name: 'Score' })).toBeVisible();
    };
    const ltr = await context.newPage();
    await start(ltr);
    const rtl = await context.newPage();
    await forceRtl(rtl);
    await start(rtl);

    // The island: one element, wearing the attribute, computing `ltr` under an `rtl` root.
    expect(await rtl.evaluate(() => getComputedStyle(document.documentElement).direction)).toBe(
      'rtl',
    );
    const island = rtl.locator('[dir="ltr"]');
    await expect(island).toHaveCount(1);
    expect(await island.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
    await expect(island.locator('canvas')).toHaveCount(1);
    await expect(island.getByRole('group', { name: 'Score' })).toHaveCount(1);

    // Rule 9: the seats are sides of the device and the board is the same play area on both
    // devices, so none of them moves when the shell turns round.
    const SAME = [
      '[role="group"][aria-label="Score"] [data-seat="p1"]',
      '[role="group"][aria-label="Score"] [data-seat="p2"]',
      'canvas',
      'button[aria-label="Pause the match"]',
    ];
    for (const selector of SAME) {
      expect(await box(rtl, selector), selector).toEqual(await box(ltr, selector));
    }
    // And the control: the header, which is shell, did move — or the attribute never took.
    const brand = 'header a[aria-label="DuelBox home"]';
    expect((await box(rtl, brand)).left, 'the brand moved').not.toBe((await box(ltr, brand)).left);

    // The mirror class the directional icons wear: turned round in the shell, not inside
    // the island, and absent from a glyph that does not wear it. Synthesised rather than
    // found, because no route renders an `<Icon>` yet (#74 parked the sprite unmounted);
    // the day one does, locate it here instead.
    const transforms = await rtl.evaluate(() => {
      const probe = (parent: Element, mirror: boolean) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        if (mirror) el.setAttribute('class', 'db-mirror');
        parent.append(el);
        const transform = getComputedStyle(el).transform;
        el.remove();
        return transform;
      };
      const island = document.querySelector('[dir="ltr"]');
      if (!island) throw new Error('no ltr island');
      return {
        shell: probe(document.body, true),
        plain: probe(document.body, false),
        island: probe(island, true),
      };
    });
    expect(transforms).toEqual({
      shell: 'matrix(-1, 0, 0, 1, 0, 0)',
      plain: 'none',
      island: 'matrix(1, 0, 0, 1, 0, 0)',
    });
  });
});
