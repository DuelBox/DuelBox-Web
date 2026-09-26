import { expect, test, type Page } from '@playwright/test';
import { cpus, platform, release } from 'node:os';

// The normal suite serves a production export, which deliberately contains no overlay.
test.skip(process.env.DUELBOX_LATENCY !== '1', 'Run the dedicated pnpm e2e:latency dev lab');

interface Reading {
  family: 'keyboard' | 'pointer' | 'gamepad';
  samples: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
}

declare global {
  interface Window {
    __latencyLab: {
      frozen: boolean;
      lastFrame: number;
      queued: Map<number, FrameRequestCallback>;
      pad: {
        index: number;
        id: string;
        connected: boolean;
        timestamp: number;
        axes: number[];
        buttons: { pressed: boolean }[];
      };
      source: { keyboard: number; pointer: number; gamepad: number };
    };
  }
}

async function installLab(page: Page) {
  await page.addInitScript(() => {
    const lab: Window['__latencyLab'] = (window.__latencyLab = {
      frozen: false,
      lastFrame: 0,
      queued: new Map<number, FrameRequestCallback>(),
      pad: {
        index: 0,
        id: 'Latency lab',
        connected: true,
        timestamp: 0,
        axes: [0, 0],
        buttons: [{ pressed: false }],
      },
      source: { keyboard: 0, pointer: 0, gamepad: 0 },
    });
    // Only the platform boundary is controlled. Assignment, conversion, GameHost,
    // fixed-step input consumption and the displayed readings are the real product.
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [
        {
          ...lab.pad,
          axes: [...lab.pad.axes],
          buttons: lab.pad.buttons.map((button) => ({ ...button })),
        },
      ],
    });
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = request((at) => {
        if (lab.frozen) lab.queued.set(id, callback);
        else {
          lab.lastFrame = at;
          callback(at);
        }
      });
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      lab.queued.delete(id);
      cancel(id);
    };
    window.addEventListener('keydown', (event) => {
      lab.source.keyboard = event.timeStamp;
    });
    window.addEventListener('pointerdown', (event) => {
      lab.source.pointer = event.timeStamp;
    });
  });
}

async function start(page: Page) {
  await page.goto('/play/mini-soccer/?debug=1');
  await page.getByRole('button', { name: 'Play together here' }).click();
  await expect(page.locator('#duelbox-debug-overlay')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
    timeout: 15_000,
  });
}

async function readings(page: Page): Promise<Reading[]> {
  const raw = await page.locator('#duelbox-debug-overlay').getAttribute('data-latency');
  return JSON.parse(raw ?? '[]') as Reading[];
}

/** Wait for an actual overlay sampling tick, never a guessed timeout. */
async function nextReading(page: Page) {
  await page.locator('#duelbox-debug-overlay').evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve();
        });
        observer.observe(element, { attributes: true, attributeFilter: ['data-latency'] });
      }),
  );
  return readings(page);
}

/** Two display frames give a live 60Hz fixed step an opportunity to consume each edge. */
async function settleInput(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.beforeEach(async ({ page }) => {
  await installLab(page);
});

test('all families wait for a simulation step and retain their source timestamps', async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press('KeyZ'); // unbound
  await page.keyboard.press('Control+KeyD'); // browser chord
  await page.evaluate(() => {
    // A repeat arriving after a clear/attachment is still a repeat, even though the
    // debug helper has never seen its original down.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS' }));
  });
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('missing canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75); // hover
  await settleInput(page);
  expect((await nextReading(page)).map((row) => row.samples)).toEqual([0, 0, 0]);
  await page.evaluate(() => {
    window.__latencyLab.frozen = true;
  });
  await page.waitForFunction(() => window.__latencyLab.queued.size > 0, undefined, { polling: 10 });

  // Create the event before dispatch: measuring handler arrival instead of source time
  // loses this known delay and fails the inequality below.
  await page.evaluate(async () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', bubbles: true });
    await new Promise((resolve) => setTimeout(resolve, 40));
    window.dispatchEvent(event);
    window.__latencyLab.pad.buttons[0]!.pressed = true;
    window.__latencyLab.pad.timestamp = performance.now() - 37;
    window.__latencyLab.source.gamepad = window.__latencyLab.pad.timestamp;
  });
  await page.mouse.down();
  expect((await nextReading(page)).map((row) => row.samples)).toEqual([0, 0, 0]);
  const stepsBefore = /steps (\d+)/.exec(
    await page.locator('#duelbox-debug-overlay').innerText(),
  )?.[1];
  expect(stepsBefore).toBeDefined();
  // A render callback is not a consuming step. Deliver one frame at the previous
  // frame's timestamp: delta=0, so FixedLoop may render but cannot advance input.
  const callbacks = await page.evaluate(() => {
    const lab = window.__latencyLab;
    const queued = [...lab.queued.values()];
    lab.queued.clear();
    for (const callback of queued) callback(lab.lastFrame);
    return queued.length;
  });
  expect(callbacks).toBeGreaterThan(0);
  expect((await nextReading(page)).map((row) => row.samples)).toEqual([0, 0, 0]);
  expect(/steps (\d+)/.exec(await page.locator('#duelbox-debug-overlay').innerText())?.[1]).toBe(
    stepsBefore,
  );
  await page.waitForFunction(() => window.__latencyLab.queued.size > 0, undefined, { polling: 10 });
  const minimum = await page.evaluate(() => {
    const lab = window.__latencyLab;
    const at = performance.now();
    const delays = {
      keyboard: at - lab.source.keyboard,
      pointer: at - lab.source.pointer,
      gamepad: at - lab.source.gamepad,
    };
    lab.frozen = false;
    const queued = [...lab.queued.values()];
    lab.queued.clear();
    for (const callback of queued) callback(performance.now());
    return delays;
  });
  await expect
    .poll(async () => (await readings(page)).map((row) => row.samples))
    .toEqual([1, 1, 1]);
  for (const row of await readings(page)) {
    // A millisecond accommodates reduced clock precision; the injected waits are >37ms.
    expect(row.lastMs, row.family).toBeGreaterThanOrEqual(minimum[row.family] - 1);
  }
  // Auto-repeat and timestamp refreshes of held pads are not fresh input samples.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', repeat: true }));
    window.__latencyLab.pad.timestamp = performance.now();
  });
  await settleInput(page);
  expect((await nextReading(page)).map((row) => row.samples)).toEqual([1, 1, 1]);
  await page.mouse.up();
});

test('records a lab baseline for keyboard, pointer and injected gamepad samples', async ({
  page,
  browser,
}, testInfo) => {
  await start(page);
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('missing canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
  for (const family of ['keyboard', 'pointer', 'gamepad'] as const) {
    for (let edge = 0; edge < 40; edge += 1) {
      const down = edge % 2 === 0;
      if (family === 'keyboard') {
        if (down) await page.keyboard.down('KeyD');
        else await page.keyboard.up('KeyD');
      } else if (family === 'pointer') {
        if (down) await page.mouse.down();
        else await page.mouse.up();
      } else {
        await page.evaluate((pressed) => {
          const pad = window.__latencyLab.pad;
          pad.buttons[0]!.pressed = pressed;
          pad.timestamp = performance.now();
        }, down);
      }
      await settleInput(page);
    }
    await expect
      .poll(async () => (await readings(page)).find((row) => row.family === family)?.samples)
      .toBe(40);
  }
  const measured = await readings(page);
  for (const row of measured) {
    expect(row.samples).toBe(40);
    expect(row.minMs).toBeGreaterThanOrEqual(0);
    expect(row.meanMs).toBeGreaterThanOrEqual(row.minMs);
    expect(row.maxMs).toBeGreaterThanOrEqual(row.meanMs);
  }
  const report = {
    date: new Date().toISOString(),
    project: testInfo.project.name,
    browser: browser.version(),
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    node: process.version,
    headless: testInfo.project.use.headless,
    mode: 'development build; DOM event-to-step; injected gamepad sample-to-step',
    readings: measured,
  };
  await testInfo.attach('input-latency-baseline.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  console.log(JSON.stringify(report));
});
