import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The game lifecycle host, measured rather than asserted.
 *
 * A long session on a phone is fifty matches, not one. Every mount attaches pointer, key,
 * visibility and resize listeners and allocates a renderer, an input manager and a game;
 * if any of that survives unmount the tab dies before the players get bored. These run
 * against the built static files, so what is measured is what ships.
 */

const CYCLES = 50;

/** Counts listener adds and removes per event type, from before any app code runs. */
const COUNT_LISTENERS = `
  window.__listeners = {};
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    window.__listeners[type] = (window.__listeners[type] ?? 0) + 1;
    return add.call(this, type, ...rest);
  };
  EventTarget.prototype.removeEventListener = function (type, ...rest) {
    window.__listeners[type] = (window.__listeners[type] ?? 0) - 1;
    return remove.call(this, type, ...rest);
  };
`;

test.describe('the game lifecycle host', () => {
  test('leaves no listener behind after fifty load-unload cycles', async ({ page }) => {
    await page.addInitScript(COUNT_LISTENERS);
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).waitFor();

    const read = () =>
      page.evaluate(() => ({
        ...(window as never as { __listeners: Record<string, number> }).__listeners,
      }));

    // Baseline after one full cycle, so React's own one-time listeners are not counted
    // as a leak. What matters is that cycles two through fifty-one add nothing net.
    await cycle(page);
    const before = await read();

    // The instrumentation has to have seen the host attach something, or every
    // assertion below compares zero to zero and passes whatever the host does.
    expect(Object.keys(before).length, 'listener instrumentation saw nothing').toBeGreaterThan(0);

    for (let i = 0; i < CYCLES; i += 1) await cycle(page);
    const after = await read();

    // Every type the host attaches must come back to where it started.
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'contextmenu',
      'keydown',
      'keyup',
      'blur',
      'visibilitychange',
    ]) {
      expect
        .soft(after[type] ?? 0, `${type} listeners after ${CYCLES} cycles`)
        .toBe(before[type] ?? 0);
    }
  });

  test('fifty load-unload cycles grow the heap by under 5MB', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'heap measurement needs the Chrome DevTools Protocol');

    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).waitFor();
    const session = await page.context().newCDPSession(page);

    async function heapBytes(): Promise<number> {
      // Collect first, or what is measured is garbage that has not been swept yet
      // rather than anything actually retained.
      await session.send('HeapProfiler.collectGarbage');
      const { usedSize } = (await session.send('Runtime.getHeapUsage')) as { usedSize: number };
      return usedSize;
    }

    await cycle(page);
    const before = await heapBytes();

    for (let i = 0; i < CYCLES; i += 1) await cycle(page);
    const after = await heapBytes();

    const grownMB = (after - before) / (1024 * 1024);
    expect(grownMB, `heap grew ${grownMB.toFixed(2)}MB over ${CYCLES} cycles`).toBeLessThan(5);
  });
});

/** Mount a game, then unmount it: start a match, pause, quit. */
async function cycle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play together here' }).click();
  await page.getByRole('button', { name: 'Pause the match' }).click();
  await page.getByRole('button', { name: 'Quit match' }).click();
}
