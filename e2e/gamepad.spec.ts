import { expect, test, type Page } from '@playwright/test';
import { seatCentroids } from './seat-pixels.js';

/**
 * Two pads, two seats, and a match that stops when one of them goes (#130).
 *
 * Playwright cannot plug in a controller, and neither engine exposes a way to fake one, so
 * `navigator.getGamepads` is replaced before any script runs with a reader over a table the
 * test writes to. That is the only seam the product reads — `browserGamepadSource` in
 * `packages/engine/src/loop.ts` — so everything downstream of it is the real code: the
 * manager's seat assignment, the fixed-step poll, the analogue merge, the pause, the panel.
 *
 * `GamepadManager` had been in the engine with tests and called by nothing; the last two
 * tests here are the ones that would have caught that.
 */

interface FakePad {
  index: number;
  id: string;
  connected: boolean;
  axes: number[];
  buttons: { pressed: boolean }[];
}

declare global {
  interface Window {
    __pads: (FakePad | null)[];
  }
}

async function installFakePads(page: Page) {
  await page.addInitScript(() => {
    window.__pads = [];
    // A fresh array of fresh objects each call, as the real API returns — the adapter's
    // reuse is what is under test in `loop.test.ts`, and a fake that handed back the same
    // objects would let a stale-read bug pass here. `writable`, because the product reads
    // this through `bind` on the instance and a non-writable data property was not seen.
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      writable: true,
      value: () =>
        window.__pads.map((pad) =>
          pad === null
            ? null
            : { ...pad, axes: [...pad.axes], buttons: pad.buttons.map((b) => ({ ...b })) },
        ),
    });
  });
}

const pad = (index: number, axes: [number, number] = [0, 0], pressed = false): FakePad => ({
  index,
  id: `Fake pad ${String(index)}`,
  connected: true,
  axes,
  buttons: [{ pressed }],
});

async function setPads(page: Page, pads: (FakePad | null)[]) {
  await page.evaluate((next) => {
    window.__pads = next;
  }, pads);
}

async function startMatch(page: Page) {
  await page.goto('/play/mini-soccer/');
  await page.getByRole('button', { name: 'Play together here' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
    timeout: 10_000,
  });
}

test.describe('two controllers on one device', () => {
  test.beforeEach(async ({ page }) => {
    await installFakePads(page);
  });

  test('drive their own seats and not each other', async ({ page }) => {
    await page.addInitScript(() => {
      window.__pads = [
        { index: 0, id: 'A', connected: true, axes: [0, 0], buttons: [{ pressed: false }] },
        { index: 1, id: 'B', connected: true, axes: [0, 0], buttons: [{ pressed: false }] },
      ];
    });
    await startMatch(page);
    const start = await seatCentroids(page);
    expect(start.p1).not.toBeNull();
    expect(start.p2).not.toBeNull();

    // Pad 0 — seated first, so seat one — pushes its stick down.
    await setPads(page, [pad(0, [0, 1]), pad(1)]);
    await page.waitForTimeout(600);
    await setPads(page, [pad(0), pad(1)]);
    const afterFirst = await seatCentroids(page);
    expect(
      Math.abs((afterFirst.p1?.y ?? 0) - (start.p1?.y ?? 0)),
      'pad 0 moved seat one',
    ).toBeGreaterThan(8);
    expect(
      Math.abs((afterFirst.p2?.y ?? 0) - (start.p2?.y ?? 0)),
      'pad 0 left seat two alone',
    ).toBeLessThan(2);

    // Pad 1 — seat two — pushes up, the other way.
    const before = await seatCentroids(page);
    await setPads(page, [pad(0), pad(1, [0, -1])]);
    await page.waitForTimeout(600);
    await setPads(page, [pad(0), pad(1)]);
    const afterSecond = await seatCentroids(page);
    expect(
      Math.abs((afterSecond.p2?.y ?? 0) - (before.p2?.y ?? 0)),
      'pad 1 moved seat two',
    ).toBeGreaterThan(8);
    expect(
      Math.abs((afterSecond.p1?.y ?? 0) - (before.p1?.y ?? 0)),
      'pad 1 left seat one alone',
    ).toBeLessThan(2);
  });

  test('a pad plugged in mid-match pauses it and says whose seat it will drive', async ({
    page,
  }) => {
    await startMatch(page);
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeHidden();
    await setPads(page, [pad(0)]);
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused).toBeVisible();
    await expect(paused).toContainText(/controller was plugged in\. It will drive .*'s seat/);
    await expect(paused.getByRole('button', { name: 'Swap controllers' })).toBeVisible();
  });

  test('a pad unplugged mid-match pauses it and names the seat that lost it', async ({ page }) => {
    await page.addInitScript(() => {
      window.__pads = [
        { index: 0, id: 'A', connected: true, axes: [0, 0], buttons: [{ pressed: false }] },
      ];
    });
    await startMatch(page);
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeHidden();
    await setPads(page, [null]);
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused).toBeVisible();
    await expect(paused).toContainText(/'s controller was unplugged/);
    // Resume clears the news, so a later pause for another reason does not repeat it.
    await paused.getByRole('button', { name: 'Resume' }).click();
    await expect(paused).toBeHidden();
  });

  test('swapping controllers moves the one pad to the other seat', async ({ page }) => {
    await page.addInitScript(() => {
      window.__pads = [
        { index: 0, id: 'A', connected: true, axes: [0, 0], buttons: [{ pressed: false }] },
      ];
    });
    await startMatch(page);
    // A second pad arriving pauses and seats itself at seat two; swap so pad 0 drives seat two.
    await setPads(page, [pad(0), pad(1)]);
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused).toBeVisible();
    await paused.getByRole('button', { name: 'Swap controllers' }).click();
    await expect(paused).toContainText(/controllers were swapped/);
    await paused.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });

    const start = await seatCentroids(page);
    await setPads(page, [pad(0, [0, 1]), pad(1)]);
    await page.waitForTimeout(600);
    await setPads(page, [pad(0), pad(1)]);
    const after = await seatCentroids(page);
    expect(
      Math.abs((after.p2?.y ?? 0) - (start.p2?.y ?? 0)),
      'pad 0 now drives seat two',
    ).toBeGreaterThan(8);
    expect(
      Math.abs((after.p1?.y ?? 0) - (start.p1?.y ?? 0)),
      'and no longer seat one',
    ).toBeLessThan(2);
  });

  test('a device with no pads plugged in never sees the swap button', async ({ page }) => {
    await startMatch(page);
    await page.keyboard.press('Escape');
    const paused = page.getByRole('dialog', { name: 'Paused' });
    await expect(paused).toBeVisible();
    await expect(paused.getByRole('button', { name: 'Swap controllers' })).toBeHidden();
  });
});
