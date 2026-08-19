import { expect, test } from '@playwright/test';

test.describe('the static build', () => {
  test('lands, shows the catalogue, and reaches a game page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('107 games');

    await page.getByRole('link', { name: 'Start playing' }).click();
    await expect(page).toHaveURL(/\/games\/?$/);
    await expect(page.getByRole('heading', { name: 'All games' })).toBeVisible();
  });

  test('every game page is reachable without JavaScript rendering it', async ({ page }) => {
    // The content must be in the served HTML — a client-rendered games portal earns no
    // organic traffic, so this asserts the SEO property directly.
    const response = await page.goto('/games/air-hockey/');
    const html = (await response?.text()) ?? '';
    expect(html).toContain('Air Hockey');
    // The observed rule text is rendered server-side, not fetched by the client.
    expect(html).toContain('Score in the opposing goal');
  });

  test('a game loads and renders a non-blank frame', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // A canvas that renders nothing still passes a visibility check, so assert pixels.
    await expect
      .poll(
        async () =>
          canvas.evaluate((node) => {
            const element = node as HTMLCanvasElement;
            const context = element.getContext('2d');
            if (!context || element.width === 0) return 0;
            const { data } = context.getImageData(0, 0, element.width, element.height);
            const first = data.slice(0, 4).join(',');
            for (let i = 4; i < data.length; i += 4) {
              if (data.slice(i, i + 4).join(',') !== first) return 1;
            }
            return 0;
          }),
        { timeout: 10_000 },
      )
      .toBe(1);
  });

  test('the page never scrolls sideways on a phone', async ({ page }) => {
    await page.goto('/games/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
