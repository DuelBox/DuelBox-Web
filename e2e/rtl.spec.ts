import { expect, test, type Page } from '@playwright/test';
import { MIRROR_CLASS } from '../apps/web/src/lib/icons';

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
 * any button. On the landing page: the one directional glyph a route renders — the arrow
 * on "See all 108 →", a `<span>` wearing `MIRROR_CLASS` (page.tsx) — computes `scaleX(-1)`
 * and sits at the left end of its link, and in a left-to-right load of the same page it is
 * the identity at the right end. That arrow is a blockified flex item, so it turns round
 * whether or not the rule says `display: inline-block`; the declaration is for the class in
 * running text, and it is measured there in pixels — a span with the class drawn into a
 * paragraph photographed against the same span with its transform cancelled, and the same
 * pair forced back to `inline` — because a computed `transform` serialises the matrix on an
 * inline span too and a flip moves no box. On the play route with a match running: the play surface
 * is an `ltr` island — `direction` computes to `ltr` on it, and on **every element inside
 * it**, while `<html>` is `rtl` — and, the assertion rule 9 actually needs, **nothing on it
 * moves or turns**: the two seats' scoreboards, the board, the pause button and the exit
 * control have the same box, the same computed `transform` and the same `direction` as in
 * a left-to-right load of the same page, while the header's brand, measured the same way,
 * does move. The last is the control that the init script took effect, so an island that
 * "did not move" because nothing did cannot pass. The transform is compared as well as the
 * box because a `scaleX(-1)` on the board moves no box at all — the first version of this
 * file compared boxes alone, and a `[dir=rtl] canvas { transform: scaleX(-1) }` planted in
 * the export, the mirrored board rule 9 forbids, passed every assertion in it. And the
 * mirror class itself, on a synthesised element, flips outside the island and not inside it.
 *
 * ## Watched failing
 *
 * Each plant went into the built export's CSS, the spec ran on Chromium, and the file was
 * put back. `direction:ltr` on the surface turned to `rtl`: `Expected: "ltr" Received:
 * "rtl"`. The mirror class's transform set to `none`: shell and island both read `none`.
 * The skip link's `inset-inline-start` put back to `left`: `skip link on the right half —
 * Expected: > 640, Received: 16`, on all four routes. The header row reversed: `brand flush
 * right — Expected: <= 1, Received: 1053`. A rule appended that makes the scoreboard row
 * follow `[dir=rtl]`, with the island's own direction untouched: the direction check passed
 * and the rule 9 check failed on seat one, `left: 69 → 761`, which is the failure this file
 * exists to produce. After review, `[dir=rtl] canvas{transform:scaleX(-1)}` appended to the
 * export's CSS: the rule 9 check failed on `canvas` with `"transform": "none"` expected and
 * `"matrix(-1, 0, 0, 1, 0, 0)"` received, where the box-only version had passed. The arrow
 * span's class stripped from the exported landing page: `exactly one mirrored glyph on the
 * landing page — Expected: 1, Received: 0`. `MIRROR_CLASS` renamed in `lib/icons.ts` with the
 * export untouched: the same count failure under the new name, and the island test's
 * synthesised probes read `none` for shell and island both, so the class the component
 * emits and the rule that flips it cannot drift apart behind a green run. And
 * `display:inline-block` removed from the built `.db-mirror` rule: every box and
 * computed-style assertion stayed green — the arrow is blockified — and only the pixel
 * comparison failed, which is why it exists.
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

/**
 * Where an element is *and* which way it faces. A box alone cannot tell a mirrored board
 * from an unmirrored one — `scaleX(-1)` about the centre leaves every edge where it was —
 * so the rule 9 comparison below reads the computed transform and direction beside it.
 */
async function pose(
  page: Page,
  selector: string,
): Promise<{ box: Box; transform: string; direction: string }> {
  const style = await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { transform: s.transform, direction: s.direction };
    });
  return { box: await box(page, selector), ...style };
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
    // devices, so none of them moves — or turns — when the shell turns round. The exit
    // control is up whenever the match is live (PlaySurface.tsx), so it is measured too.
    const SAME = [
      '[role="group"][aria-label="Score"] [data-seat="p1"]',
      '[role="group"][aria-label="Score"] [data-seat="p2"]',
      'canvas',
      'button[aria-label="Pause the match"]',
      'button[aria-haspopup="dialog"]',
    ];
    for (const selector of SAME) {
      expect(await pose(rtl, selector), selector).toEqual(await pose(ltr, selector));
    }
    // Nothing inside the island reads right-to-left, whatever it is: a `[dir=rtl] .x` rule
    // in a module would match from `<html>` past the island's `direction`, and this is the
    // measurement of that in a browser — `direction.test.ts` forbids the rule in the source.
    const notLtr = await island.evaluate((root) =>
      [...root.querySelectorAll('*')]
        .filter((el) => getComputedStyle(el).direction !== 'ltr')
        .map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}`),
    );
    expect(notLtr, 'elements inside the island not computing ltr').toEqual([]);
    // And the control: the header, which is shell, did move — or the attribute never took.
    const brand = 'header a[aria-label="DuelBox home"]';
    expect((await box(rtl, brand)).left, 'the brand moved').not.toBe((await box(ltr, brand)).left);

    // The mirror class the directional icons wear: turned round in the shell, not inside
    // the island, and absent from a glyph that does not wear it. Synthesised here because
    // this route draws no directional glyph; the landing page's real one is measured in
    // the test below. The name is imported, not spelled, so a renamed constant fails this
    // rather than probing a class no component emits.
    const transforms = await rtl.evaluate((mirrorClass) => {
      const probe = (parent: Element, mirror: boolean) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        if (mirror) el.setAttribute('class', mirrorClass);
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
    }, MIRROR_CLASS);
    expect(transforms).toEqual({
      shell: 'matrix(-1, 0, 0, 1, 0, 0)',
      plain: 'none',
      island: 'matrix(1, 0, 0, 1, 0, 0)',
    });
  });

  test("turns the landing page's forward arrow round, and only under a right-to-left shell", async ({
    context,
  }) => {
    // The one directional glyph a route renders today: the text arrow on "See all 108 →"
    // (page.tsx), a `<span>` wearing `MIRROR_CLASS`. U+2192 is not Bidi_Mirrored, so
    // without the class it would keep pointing right — towards the start of an Arabic line.
    // Measured against a left-to-right load of the same page so both halves of the rule
    // are seen: identity at the right end of the link there, `scaleX(-1)` at the left end
    // here. The arrow's own box is compared to its link's centre rather than to the text,
    // because the text node has no box to ask for.
    const arrowOn = async (page: Page) => {
      const arrow = page.locator(`main .${MIRROR_CLASS}`);
      await expect(arrow, 'exactly one mirrored glyph on the landing page').toHaveCount(1);
      const link = arrow.locator('xpath=ancestor::a[1]');
      await expect(link).toHaveAttribute('href', '/games/');
      await expect(link).toContainText('See all');
      return {
        transform: await arrow.evaluate((el) => getComputedStyle(el).transform),
        arrow: await box(page, `main .${MIRROR_CLASS}`),
        link: await link.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      };
    };

    const ltr = await context.newPage();
    await ltr.goto('/');
    const before = await arrowOn(ltr);
    expect(before.transform, 'identity in a left-to-right shell').toBe('matrix(1, 0, 0, 1, 0, 0)');
    const ltrMid = (before.link.left + before.link.right) / 2;
    expect(before.arrow.left, 'at the end of the link, which is its right').toBeGreaterThan(ltrMid);

    const rtl = await context.newPage();
    await forceRtl(rtl);
    await rtl.goto('/');
    const after = await arrowOn(rtl);
    expect(after.transform, 'turned round under rtl').toBe('matrix(-1, 0, 0, 1, 0, 0)');
    const rtlMid = (after.link.left + after.link.right) / 2;
    expect(after.arrow.right, 'at the end of the link, which is now its left').toBeLessThan(rtlMid);

    // `display: inline-block` in the rule is not what turned that arrow: its link is
    // `inline-flex`, so the span is a flex item, blockified and transformable either way —
    // with the declaration removed from the built rule it still read `matrix(-1, …)`. The
    // declaration is for the class in running text, where a non-replaced inline box is not
    // transformable, and a computed `transform` cannot see that: it serialises the matrix
    // on a span forced to `inline` too (measured), and a flip about the centre moves no box.
    // Pixels can. Four spans drawn one after another at the same spot in a paragraph are
    // photographed: with the class, and with the class but its transform cancelled — those
    // must differ, the glyph turned round; then the same pair forced back to `inline` — those
    // must not, which is the control that an inline box ignores the transform, and so the
    // proof that the declaration is load-bearing. Fonts are awaited first so a swap between
    // two shots cannot be the difference.
    await rtl.evaluate(() => document.fonts.ready.then(() => undefined));
    const shot = async (inline: boolean, flipped: boolean) => {
      await rtl.evaluate(
        ([mirrorClass, inline, flipped]) => {
          const p = document.querySelector('main p');
          if (!p) throw new Error('no paragraph on the landing page');
          const el = document.createElement('span');
          el.id = 'rtl-probe';
          el.className = mirrorClass;
          el.textContent = '→';
          if (inline) el.style.display = 'inline';
          if (!flipped) el.style.transform = 'none';
          p.append(el);
        },
        [MIRROR_CLASS, inline, flipped] as const,
      );
      const png = await rtl.locator('#rtl-probe').screenshot();
      await rtl.evaluate(() => document.getElementById('rtl-probe')?.remove());
      return png;
    };
    const ruled = await shot(false, true);
    const ruledStill = await shot(false, false);
    const inline = await shot(true, true);
    const inlineStill = await shot(true, false);
    expect(ruled.equals(ruledStill), 'the class turns a glyph in running text round').toBe(false);
    expect(inline.equals(inlineStill), 'an inline box ignores the transform (control)').toBe(true);
  });
});
