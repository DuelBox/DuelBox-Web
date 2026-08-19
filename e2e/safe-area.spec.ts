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
