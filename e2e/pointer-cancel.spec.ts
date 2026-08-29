import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * An interrupted aim must not fire the shot.
 *
 * `pointercancel` is the browser saying *this gesture did not happen* — a system
 * edge-swipe, palm rejection, an incoming call, the pointer being taken away. It was
 * wired straight to `input.pointerUp` in `GameHost.tsx`, which produces an ordinary
 * `actionReleased`, and every drag-and-release aim game commits on `actionReleased`. So a
 * player who began to aim and got a system gesture did not get their aim cancelled: they
 * got a shot they never took, at whatever the aim happened to be (#2480). On a phone,
 * where the edge swipe is how you leave an app, that is not an edge case.
 *
 * This is the e2e half of the fix, and it is deliberately driven through a **real
 * `pointercancel` dispatched at the element the host listens on**, with the live
 * `pointerId` the browser handed us. A unit test can only assert what `InputManager` does
 * with a call; the wiring from the DOM event to that call is what was wrong, and only a
 * real event exercises it.
 */

/** The two games the existing aim spec already proves can be aimed at these coordinates. */
const AIMING_GAMES = [
  { slug: 'darts', logical: { w: 700, h: 1000 } },
  { slug: 'cornhole', logical: { w: 900, h: 900 } },
];

/** Down here, drag to there — the same gesture `tap.spec.ts` proves lands a throw. */
const FROM = { x: 0.5, y: 0.72 };
const TO = { x: 0.54, y: 0.86 };

async function startMatch(page: Page, slug: string) {
  await page.goto(`/play/${slug}/`);
  await page.getByRole('button', { name: 'Play together here' }).click();
  // Input is refused until the count-in finishes.
  await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
    timeout: 10_000,
  });
}

/**
 * Map a fraction of the logical play area to a screen point.
 *
 * The engine letterboxes the logical area inside the canvas, so a fraction of the element
 * is not a fraction of the board.
 */
async function projector(page: Page, logical: { w: number; h: number }) {
  const box = await page.locator('canvas').boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('no canvas');
  const scale = Math.min(box.width / logical.w, box.height / logical.h);
  const originX = box.x + (box.width - logical.w * scale) / 2;
  const originY = box.y + (box.height - logical.h * scale) / 2;
  return (at: { x: number; y: number }) => ({
    x: originX + logical.w * at.x * scale,
    y: originY + logical.h * at.y * scale,
  });
}

/** Watch the canvas for the next `pointerdown`, so the cancel can name the same pointer. */
async function watchPointerId(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const store = globalThis as unknown as { __livePointerId: number | undefined };
    store.__livePointerId = undefined;
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        store.__livePointerId = event.pointerId;
      },
      // Capture, so this runs whatever the host does in the bubble phase.
      { capture: true },
    );
  });
}

/**
 * Dispatch a real `pointercancel` for the pointer that is currently down.
 *
 * Constructed rather than simulated because no browser automation API can ask a real
 * system gesture to interrupt a drag — and the point is the event, not what produced it.
 */
async function cancelLivePointer(page: Page): Promise<void> {
  const dispatched = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const id = (globalThis as unknown as { __livePointerId: number | undefined }).__livePointerId;
    if (!canvas || id === undefined) return false;
    canvas.dispatchEvent(
      new PointerEvent('pointercancel', { pointerId: id, bubbles: true, cancelable: false }),
    );
    return true;
  });
  expect(dispatched, 'the press must have reached the canvas for the cancel to mean anything').toBe(
    true,
  );
}

for (const { slug, logical } of AIMING_GAMES) {
  test.describe(`${slug} and an interrupted aim`, () => {
    test('a pointercancel mid-drag takes no shot and changes no score', async ({ page }) => {
      await startMatch(page, slug);
      const at = await projector(page, logical);
      const hud = page.getByRole('group', { name: 'Score' });
      const before = await hud.innerText();

      await watchPointerId(page);

      // Down, drag, and then the browser takes the gesture away mid-aim.
      const from = at(FROM);
      const to = at(TO);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.waitForTimeout(200);
      await page.mouse.move(to.x, to.y, { steps: 14 });
      await page.waitForTimeout(200);
      await cancelLivePointer(page);

      // The lift the browser still owes us afterwards is inert too: the cancel already
      // ended the gesture, so this must not deliver the release a second time.
      await page.mouse.up();

      // Long enough for a thrown dart or a tossed bag to land and score, several times
      // over. Nothing may have moved: not the score, not the turn.
      await page.waitForTimeout(1500);
      expect(await hud.innerText(), 'an interrupted aim fired the shot').toBe(before);

      /**
       * And the same gesture, completed, still does throw.
       *
       * Without this the test above passes on a build where the aim never started — a
       * countdown that never cleared, a canvas nothing reaches, a game that ignores the
       * pointer entirely — which is the vacuous-assertion trap this suite keeps falling
       * into. The cancel must be the reason nothing happened, not the setup.
       */
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.waitForTimeout(200);
      await page.mouse.move(to.x, to.y, { steps: 14 });
      await page.waitForTimeout(200);
      await page.mouse.up();

      await expect(async () => {
        expect(await hud.innerText(), 'a completed aim must still throw').not.toBe(before);
      }).toPass({ timeout: 5000 });
    });
  });
}
