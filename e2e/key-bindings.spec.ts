import { expect, test, type Page } from '@playwright/test';
import { seatCentroids } from './seat-pixels.js';

/**
 * Rebinding a key, and the half of it no unit test can hold: that the new key drives the game
 * and the old one stops (#129, #2428).
 *
 * `apps/web/src/lib/key-bindings.ts` was written with the store, the defaults, the reserved
 * list, the cross-seat conflict rules and a full test file — and **nothing imported it**. No
 * page offered a rebinding, and `GameHost` built its `InputManager` on the engine's defaults,
 * so a binding put into storage by hand would not have reached a match either. Both ends are
 * wired now, and the last test here is the one that would have caught either being missing:
 * it presses the rebound key and watches the seat move.
 */

/** The slot button for a seat, by its accessible name. */
const slot = (name: string) => new RegExp(`^${name} for `, 'i');

async function openSettings(page: Page) {
  await page.goto('/settings/');
  await expect(page.getByRole('heading', { name: 'Keys' })).toBeVisible();
}

test.describe('rebinding a key', () => {
  test('takes the next key pressed, and keeps it across a reload', async ({ page }) => {
    await openSettings(page);
    const down = page.getByRole('button', { name: slot('Down') }).first();
    await expect(down).toContainText('S');

    await down.click();
    await expect(down).toContainText('Press a key');
    await page.keyboard.press('KeyG');
    await expect(down).toContainText('G');

    await page.reload();
    await expect(page.getByRole('button', { name: slot('Down') }).first()).toContainText('G');
  });

  test('refuses a key the other seat already holds, and says which', async ({ page }) => {
    await openSettings(page);
    const action = page.getByRole('button', { name: slot('Action') }).first();
    await action.click();
    // The far seat's up arrow. One key must never drive both people.
    await page.keyboard.press('ArrowUp');

    await expect(page.getByText(/already belongs to the far seat/i)).toBeVisible();
    // Refused means nothing was written: the slot still shows what it showed.
    await expect(action).toContainText('Space');
    await page.reload();
    await expect(page.getByRole('button', { name: slot('Action') }).first()).toContainText('Space');
  });

  test('refuses a key the page itself needs', async ({ page }) => {
    await openSettings(page);
    const up = page.getByRole('button', { name: slot('Up') }).first();
    await up.click();
    await page.keyboard.press('Tab');
    await expect(page.getByText(/DuelBox needs for the page itself/i)).toBeVisible();
    await expect(up).toContainText('W');
  });

  test('escape cancels rather than binding, so an armed box is never a trap', async ({ page }) => {
    await openSettings(page);
    const left = page.getByRole('button', { name: slot('Left') }).first();
    await left.click();
    await expect(left).toContainText('Press a key');
    await page.keyboard.press('Escape');
    await expect(left).toContainText('A');
  });

  test('puts one seat back to its defaults and leaves the other alone', async ({ page }) => {
    await openSettings(page);
    const p1Down = page.getByRole('button', { name: slot('Down') }).first();
    const p2Down = page.getByRole('button', { name: slot('Down') }).last();
    await p1Down.click();
    await page.keyboard.press('KeyG');
    await p2Down.click();
    await page.keyboard.press('KeyH');
    await expect(p1Down).toContainText('G');
    await expect(p2Down).toContainText('H');

    await page.getByRole('button', { name: /Reset the near seat/i }).click();
    await expect(p1Down).toContainText('S');
    await expect(p2Down, 'the far seat is untouched by the near seat being reset').toContainText(
      'H',
    );
  });

  test('the rebound key drives the seat, and the old one no longer does', async ({ page }) => {
    // The whole point. Everything above this is a page agreeing with itself.
    await openSettings(page);
    const down = page.getByRole('button', { name: slot('Down') }).first();
    await down.click();
    await page.keyboard.press('KeyG');
    await expect(down).toContainText('G');

    await page.goto('/play/mini-soccer/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });

    const start = await seatCentroids(page);
    expect(start.p1, 'p1 is on the pitch to begin with').not.toBeNull();

    await page.keyboard.down('KeyG');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyG');
    const afterNew = await seatCentroids(page);
    expect(
      Math.abs((afterNew.p1?.y ?? 0) - (start.p1?.y ?? 0)),
      'the key the player chose moved their seat',
    ).toBeGreaterThan(8);

    const before = await seatCentroids(page);
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyS');
    const afterOld = await seatCentroids(page);
    expect(
      Math.abs((afterOld.p1?.y ?? 0) - (before.p1?.y ?? 0)),
      'the key it replaced does nothing now',
    ).toBeLessThan(2);
  });
});
