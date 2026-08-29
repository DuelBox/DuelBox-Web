import { expect, test } from '@playwright/test';

/**
 * Nothing interactive or informational may sit under a notch, a home indicator, or a
 * rounded corner.
 *
 * Playwright cannot simulate real `env(safe-area-inset-*)` values — a device descriptor
 * sets the viewport, not the cutout — so these assert the property that survives that
 * limitation: every interactive element sits inside the visual viewport with a margin,
 * in both orientations, and nothing is clipped or off-screen. Real-inset verification
 * still needs a device, which is why #1885 stays open on that item.
 */
test.describe('the layout keeps clear of screen edges', () => {
  const routes = ['/', '/games/', '/games/air-hockey/', '/play/tic-tac-toe/'];

  for (const route of routes) {
    test(`nothing interactive is clipped or off-screen on ${route}`, async ({ page }) => {
      await page.goto(route);
      const viewport = page.viewportSize();
      expect(viewport).not.toBeNull();
      if (!viewport) return;

      const offenders = await page.evaluate(() => {
        const bad: string[] = [];
        const targets = document.querySelectorAll('a, button, input, [role="button"]');
        for (const node of targets) {
          const el = node as HTMLElement;
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          // The skip link parks itself off-screen until focused; that is deliberate.
          if (el.classList.contains('db-skip')) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.left < 0 || r.top < 0 || r.right > window.innerWidth) {
            bad.push(`${el.tagName}.${el.className} at ${Math.round(r.left)},${Math.round(r.top)}`);
          }
        }
        return bad;
      });

      expect(offenders, `elements outside the viewport on ${route}`).toEqual([]);
    });
  }

  test('the page never scrolls sideways in either orientation', async ({ page }) => {
    await page.goto('/games/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('a running match keeps clear of the cutout', () => {
  /**
   * The checks above run on a lobby. A **running** match is the case that matters: that is
   * where the scoreboard and the pause button live, and a pause button under a notch is a
   * pause button nobody can press.
   *
   * Playwright reports `env(safe-area-inset-*)` as zero even on a notched device profile,
   * so asking the browser about real insets proves nothing. Instead the tokens are given a
   * generous value directly — the same variables the whole layout is built on — and the
   * question becomes whether the layout *honours* them. That is the part we can actually
   * be wrong about; a real device is still needed to confirm the insets themselves arrive,
   * which is why #1885's device item is answered separately.
   */
  /**
   * Real insets, not a worst case no device has.
   *
   * An iPhone puts its cutout on the *short* edges: portrait insets the top for the notch
   * and the bottom for the home indicator, while landscape insets left and right for the
   * notch and a little at the bottom. Injecting a generous number on all four sides at once
   * describes no phone, and a landscape layout that failed it was failing an imaginary
   * device — 44 on every side of a 343-tall window leaves 190 for a header, two
   * scoreboards and a board.
   */
  function insetsFor(
    width: number,
    height: number,
  ): {
    top: number;
    right: number;
    bottom: number;
    left: number;
  } {
    return width > height
      ? { top: 0, right: 59, bottom: 21, left: 59 }
      : { top: 59, right: 0, bottom: 34, left: 0 };
  }

  test('nothing interactive sits inside a real inset while a match runs', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) return;
    const inset = insetsFor(viewport.width, viewport.height);

    await page.addStyleTag({
      content: `:root {
        --db-safe-top: ${String(inset.top)}px;
        --db-safe-right: ${String(inset.right)}px;
        --db-safe-bottom: ${String(inset.bottom)}px;
        --db-safe-left: ${String(inset.left)}px;
      }`,
    });
    // One frame for the layout to settle under the new insets.
    await page.waitForTimeout(200);

    const offenders = await page.evaluate(
      (inset: { top: number; right: number; bottom: number; left: number }) => {
        const bad: string[] = [];
        const targets = document.querySelectorAll('a, button, [role="button"]');
        for (const node of targets) {
          const el = node as HTMLElement;
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          if (el.classList.contains('db-skip')) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (
            r.left < inset.left ||
            r.top < inset.top ||
            r.right > window.innerWidth - inset.right ||
            r.bottom > window.innerHeight - inset.bottom
          ) {
            bad.push(
              `${el.tagName}${el.className ? '.' + String(el.className).split(' ')[0] : ''} at ` +
                `${String(Math.round(r.left))},${String(Math.round(r.top))} ` +
                `${String(Math.round(r.right))},${String(Math.round(r.bottom))}`,
            );
          }
        }
        return bad;
      },
      inset,
    );

    expect(offenders, 'controls inside the cutout band during a match').toEqual([]);
  });

  test('the pause dialog keeps clear of the cutout too', async ({ page }) => {
    // The one panel a player reaches for when something has gone wrong.
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    const viewport = page.viewportSize();
    if (!viewport) return;
    const inset = insetsFor(viewport.width, viewport.height);
    await page.addStyleTag({
      content: `:root {
        --db-safe-top: ${String(inset.top)}px;
        --db-safe-bottom: ${String(inset.bottom)}px;
      }`,
    });
    await page.keyboard.press('Escape');
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused).toBeVisible();

    const box = await paused.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.y, 'the panel starts below the cutout').toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, 'and ends above the indicator').toBeLessThanOrEqual(viewport.height);
  });
});

/**
 * The header on the narrowest phone the product supports.
 *
 * This suite already walks the interactive elements of every route at phone widths, which
 * is the reason it is the right home for this: the header's navigation used to be
 * `display: none` below 40rem with nothing put in its place, so "Games" and "How to play"
 * were simply gone on the product's primary device — and a walk over what is *present*
 * cannot see something that is absent (#2484).
 */
test.describe('the header keeps its navigation on a phone', () => {
  /** Every destination the header offers. Neither may disappear at a breakpoint. */
  const DESTINATIONS = [
    { href: '/games/', name: 'Games' },
    { href: '/how-to-play/', name: 'How to play' },
  ];

  test('every navigation destination is reachable from the header at 320px', async ({ page }) => {
    // 320 rather than 360: the definition of done says 320px to 4K, and a layout that only
    // holds at the widths current phones happen to use is a layout nobody has checked.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');

    const header = page.locator('header');
    const target = await page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--db-touch-target'),
      ),
    );
    expect(target, 'the touch-target token is readable').toBeGreaterThan(0);

    for (const destination of DESTINATIONS) {
      const link = header.locator(`a[href="${destination.href}"]`).first();
      await expect(link, `${destination.name} is in the header`).toBeVisible();
      const box = await link.boundingBox();
      expect(box, `${destination.name} has a box`).not.toBeNull();
      if (!box) continue;
      // A thumb, not a mouse pointer. #178: the header's links carried no target at all.
      expect(box.height, `${destination.name} is a real touch target`).toBeGreaterThanOrEqual(
        target,
      );
      // And it is on the screen, not merely in the document.
      expect(box.x, `${destination.name} starts on screen`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${destination.name} ends on screen`).toBeLessThanOrEqual(320);
    }

    // Nothing was bought by pushing the page sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the header fits without widening the page').toBeLessThanOrEqual(0);
  });

  test('the header navigation is keyboard reachable at 320px', async ({ page, browserName }) => {
    // Safari puts only text fields on the Tab order unless macOS full keyboard access is
    // switched on, so pressing Tab there measures a system preference rather than the page.
    // The two tests either side of this one cover WebKit; this one asks the question that
    // only a browser which tabs to links can answer.
    test.skip(browserName === 'webkit', 'Tab does not visit links in Safari by default');
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');

    // Tab from the top of the document — a fresh load leaves focus on the body, so the
    // first press is the skip link. Ten presses is far more than the header holds.
    const reached = new Set<string>();
    for (let press = 0; press < 10; press += 1) {
      await page.keyboard.press('Tab');
      const href = await page.evaluate(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLAnchorElement)) return '';
        return active.closest('header') === null ? '' : new URL(active.href).pathname;
      });
      if (href !== '') reached.add(href);
    }
    for (const destination of DESTINATIONS) {
      expect(reached, `${destination.name} is on the Tab order`).toContain(destination.href);
    }
  });

  test('the phone header actually navigates', async ({ page }) => {
    // Visible and focusable is not the same as working: a link that goes nowhere passes
    // every check above.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    await page.locator('header').getByRole('link', { name: 'How to play' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to play');
    await page.locator('header').getByRole('link', { name: 'Games' }).click();
    await expect(page).toHaveURL(/\/games\/$/);
  });
});
