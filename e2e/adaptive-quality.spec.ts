import { expect, test, type Page } from '@playwright/test';

/**
 * A low battery halves the picture and leaves the match alone (#190, #31).
 *
 * Playwright cannot drain a battery, and WebKit has no battery API at all, so
 * `navigator.getBattery` is replaced before any script runs with a promise for a fake manager
 * the test controls. That is the only seam the product reads — `browserBatterySource` in
 * `packages/engine/src/loop.ts` — so everything downstream is the real code: the gate, the
 * renderer's effects switch, and the fixed step that must not notice any of it.
 *
 * Two numbers are measured because they are the two the issue can be held to. Frames drawn
 * per second: `Canvas2DRenderer.beginFrame` saves the context exactly once per drawn frame,
 * so `CanvasRenderingContext2D.prototype.save` is counted — the picture's own heartbeat,
 * with no debug build needed. And the count-in: the SDK's three-second countdown is advanced
 * one fixed step at a time, so a countdown that takes the same wall time under a low battery
 * as it does on a full one is a fixed step that did not slow down when the picture did. A
 * halved *step* rate would take six seconds; a halved *render* rate takes three, drawn on
 * alternate frames.
 */

declare global {
  interface Window {
    __saves: number;
  }
}

async function installBattery(page: Page, level: number, charging: boolean) {
  await page.addInitScript(
    ({ level, charging }) => {
      const manager = {
        level,
        charging,
        addEventListener: (): void => {},
      };
      Object.defineProperty(navigator, 'getBattery', {
        configurable: true,
        writable: true,
        value: () => Promise.resolve(manager),
      });
    },
    { level, charging },
  );
}

async function countSaves(page: Page) {
  await page.addInitScript(() => {
    window.__saves = 0;
    const proto = CanvasRenderingContext2D.prototype;
    // The original is called on the instance below, which is the binding the rule is
    // guarding; taking the reference is the only way to wrap a prototype method.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = proto.save;
    proto.save = function save(this: CanvasRenderingContext2D) {
      window.__saves += 1;
      return original.call(this);
    };
  });
}

/**
 * Starts a match and returns two measurements: how long the three-second count-in took in
 * wall time, and how many frames a second were drawn over the two seconds after it.
 */
async function measure(page: Page): Promise<{ countdownMs: number; drawsPerSecond: number }> {
  await page.goto('/play/mini-soccer/');
  const count = page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ });
  await page.getByRole('button', { name: 'Play together here' }).click();
  await expect(count).toBeVisible({ timeout: 10_000 });
  const started = Date.now();
  await expect(count).toBeHidden({ timeout: 10_000 });
  const countdownMs = Date.now() - started;
  const before = await page.evaluate(() => window.__saves);
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => window.__saves);
  return { countdownMs, drawsPerSecond: (after - before) / 2 };
}

test.describe('on a low battery', () => {
  test('draws about half as many frames, and the count-in keeps its own time', async ({ page }) => {
    // Beginning with the picture: a charged device is the control, so the number below
    // means something rather than merely being small.
    await countSaves(page);
    await installBattery(page, 1, true);
    const full = await measure(page);

    await installBattery(page, 0.1, false);
    const low = await measure(page);

    // A real display is 60 Hz or so; the gate lets alternate frames through. Half, with
    // room for the frame the gate always draws first and for a runner that is doing
    // something else.
    expect(
      full.drawsPerSecond,
      'the control never drew — the count is not counting',
    ).toBeGreaterThan(20);
    expect(low.drawsPerSecond).toBeLessThan(full.drawsPerSecond * 0.65);
    expect(low.drawsPerSecond).toBeGreaterThan(full.drawsPerSecond * 0.3);

    // Three seconds of count-in cost about three seconds of wall time either way: the
    // fixed step did not slow down when the picture did. A halved step rate would read six.
    expect(full.countdownMs).toBeGreaterThan(2000);
    expect(low.countdownMs).toBeGreaterThan(2000);
    expect(Math.abs(low.countdownMs - full.countdownMs)).toBeLessThan(800);
  });

  test('does nothing on a device that is low but charging', async ({ page }) => {
    await countSaves(page);
    await installBattery(page, 0.05, true);
    const charging = (await measure(page)).drawsPerSecond;
    await installBattery(page, 1, true);
    const full = (await measure(page)).drawsPerSecond;
    expect(charging).toBeGreaterThan(full * 0.8);
  });
});

test.describe('where there is no battery API', () => {
  test('draws every frame, because an unknown battery is never throttled on a guess', async ({
    page,
  }) => {
    await countSaves(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'getBattery', {
        configurable: true,
        writable: true,
        value: undefined,
      });
    });
    const rate = (await measure(page)).drawsPerSecond;
    expect(rate).toBeGreaterThan(20);
  });
});
