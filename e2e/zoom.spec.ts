import { expect, test, type Page } from '@playwright/test';

/**
 * The shell survives 200% text zoom and page zoom without clipping (#1890).
 *
 * Two WCAG obligations meet here. 1.4.4 Resize Text asks that text scale to 200% with no
 * loss of content or function; 1.4.10 Reflow asks that content not need horizontal scrolling
 * to be read. Both are broken the same way — a fixed-width box, a `width` in pixels, a row
 * that will not wrap — and both show up as the page growing wider than the viewport, so that
 * is what this measures: at twice the text size, and at twice the page zoom, no shell route
 * scrolls sideways and its landmark controls stay on screen.
 *
 * It runs on Chromium alone (see `playwright.config.ts`): reflow is a property of the layout
 * the same across engines, and the cost of loading each route twice is not worth paying four
 * times to re-confirm one verdict. The routes are the distinct shell shapes, the same set the
 * axe scan walks, because a new shape is where a fixed width hides.
 */

/** Every distinct shell shape. A game page and the play lobby are the busiest layouts. */
const ROUTES = [
  '/',
  '/games/',
  '/games/air-hockey/',
  '/games/category/board/',
  '/how-to-play/',
  '/settings/',
  '/play/tic-tac-toe/',
];

/** True if the document needs horizontal scrolling — the shared symptom of both failures. */
async function overflowsSideways(page: Page): Promise<{ scroll: number; client: number }> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return { scroll: el.scrollWidth, client: el.clientWidth };
  });
}

async function settle(page: Page, route: string): Promise<void> {
  await page.goto(route);
  // The catalogue and the settings panel finish after their first effect; wait for the one
  // signal each gives so the measurement is of the live page, not the pre-hydration one.
  if (route === '/games/') await expect(page.locator('[data-ready]')).toBeAttached();
  if (route === '/settings/') {
    await expect(page.getByRole('switch', { name: 'Mute', exact: true })).toBeVisible();
  }
}

test.describe('at 200% text size', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  for (const route of ROUTES) {
    test(`${route} does not scroll sideways`, async ({ page }) => {
      await settle(page, route);
      // 1.4.4 is a text-size increase, not a page zoom: double the root font size and let the
      // rem-based type and spacing grow with it. A layout pinned in pixels does not, and
      // overflows.
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      const { scroll, client } = await overflowsSideways(page);
      // One pixel of slack for sub-pixel rounding; anything more is a real overflow.
      expect(scroll, `${route} overflows at 200% text`).toBeLessThanOrEqual(client + 1);
    });
  }
});

test.describe('at 200% page zoom', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  for (const route of ROUTES) {
    test(`${route} reflows without a horizontal scrollbar`, async ({ page }) => {
      await settle(page, route);
      // Page zoom scales everything, including images and the canvas; the reflow obligation
      // is that it still fits the width. `zoom` is the Chromium property that models the
      // browser's own zoom control.
      await page.evaluate(() => {
        (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = '2';
      });
      const { scroll, client } = await overflowsSideways(page);
      expect(scroll, `${route} overflows at 200% zoom`).toBeLessThanOrEqual(client + 1);
    });
  }
});

test.describe('the controls stay usable, not just on-screen', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('the settings switches are still reachable at 200% text', async ({ page }) => {
    await settle(page, '/settings/');
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    // No loss of function (1.4.4): the mute switch is still there, still has its size, and can
    // still be toggled — a control clipped to zero or pushed off-page would fail one of these.
    const mute = page.getByRole('switch', { name: 'Mute', exact: true });
    await expect(mute).toBeVisible();
    const box = await mute.boundingBox();
    expect(box, 'the mute switch has a box').not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    await mute.click();
    await expect(mute).toHaveAttribute('aria-checked', 'true');
  });
});
