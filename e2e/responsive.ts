import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The pieces `resize.spec.ts`, `safe-area.spec.ts` and `responsive-sweep.spec.ts` share.
 *
 * Three specs were about to ask the same three questions — does the page scroll sideways, is
 * anything interactive outside the viewport, what insets does a phone really have — and the
 * first two had already written two slightly different answers to the third. A sweep over 107
 * games that measured *nearly* what the push gate measures would be the worst of both: a
 * nightly failure nobody could reproduce against the spec that is supposed to hold the same
 * property. So the answers live here once, and `scripts/responsive-matrix.mjs` re-states them
 * in plain JavaScript for the same reason it re-states the device classes — it is a Node
 * script rather than a Playwright spec and cannot import TypeScript.
 *
 * Nothing in this file is a test. `playwright.config.ts` collects `*.spec.ts`, so a plain
 * `.ts` beside them is a module and not a suite, which is how `seat-pixels.ts` already lives
 * in this directory.
 */

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Real insets, not a worst case no device has.
 *
 * An iPhone puts its cutout on the *short* edges: portrait insets the top for the notch and
 * the bottom for the home indicator, while landscape insets left and right for the notch and
 * a little at the bottom. Injecting a generous number on all four sides at once describes no
 * phone, and a landscape layout that failed it was failing an imaginary device — 44 on every
 * side of a 343-tall window leaves 190 for a header, two scoreboards and a board.
 */
export function insetsFor(width: number, height: number): Insets {
  return width > height
    ? { top: 0, right: 59, bottom: 21, left: 59 }
    : { top: 59, right: 0, bottom: 34, left: 0 };
}

/** No cutout at all — what a tablet, a laptop and a desktop have. */
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The narrowest class `docs/responsive.md` names, in both orientations.
 *
 * 320px rather than the width a current phone happens to use: the definition of done says
 * 320px to 4K, and a layout that only holds at 393 is a layout nobody has checked at the
 * floor. `compact` is also the band a notched phone occupies — an iPhone 14 Pro is 393 CSS
 * px wide, which is between `compact`'s 320 and `phone`'s 480 — so these are the two cells
 * that carry insets.
 */
export const NARROWEST = [
  { orientation: 'portrait', width: 320, height: 568 },
  { orientation: 'landscape', width: 568, height: 320 },
] as const;

/**
 * Gives the layout a real phone's insets to honour.
 *
 * Playwright reports `env(safe-area-inset-*)` as zero even on a notched device profile, so
 * asking the browser about real insets proves nothing. The `--db-safe-*` tokens the whole
 * layout is built on are given real values instead, and the question becomes whether the
 * layout *honours* them — which is the part we can actually be wrong about. A physical
 * device is still needed to confirm the insets themselves arrive (#1885).
 */
export async function applyInsets(page: Page, inset: Insets): Promise<void> {
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
}

/** Opens a play route and plays the countdown out, leaving a live match on screen. */
export async function startMatch(page: Page, slug: string): Promise<void> {
  await page.goto(`/play/${slug}/`);
  await page.getByRole('button', { name: 'Play together here' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
    timeout: 10_000,
  });
}

/** How far the page can be pushed sideways. Zero or less is the only acceptable answer. */
export function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/**
 * Every visible interactive element outside the viewport or inside the inset band.
 *
 * The bottom edge needs a qualifier and it is per element rather than per page: a control
 * below the fold of a scroller is reachable and is not a finding, while the same control in
 * a container that *clips* is a control nobody can press. The play route's scroller is
 * `.db-main` — `globals.css` gives it `overflow: auto` so a viewport too short for the board
 * scrolls honestly rather than collapsing it — and the document itself stays exactly one
 * viewport tall, so asking the document alone reports every mode button on a 320px lobby as
 * buried under the home indicator. It is not.
 */
export function outsideSafeArea(page: Page, inset: Insets): Promise<string[]> {
  return page.evaluate((bounds: Insets) => {
    const doc = document.documentElement;
    const reachable = (el: HTMLElement): boolean => {
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        const overflowY = getComputedStyle(node).overflowY;
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          node.scrollHeight - node.clientHeight > 1
        ) {
          return true;
        }
      }
      return doc.scrollHeight - doc.clientHeight > 1;
    };

    const bad: string[] = [];
    for (const node of document.querySelectorAll('button, a, [role="button"], input, select')) {
      const el = node as HTMLElement;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      // The skip link parks itself off-screen until focused; that is deliberate.
      if (el.classList.contains('db-skip')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const past: string[] = [];
      if (r.left < bounds.left - 1) past.push('left');
      if (r.top < bounds.top - 1) past.push('top');
      if (r.right > window.innerWidth - bounds.right + 1) past.push('right');
      if (r.bottom > window.innerHeight - bounds.bottom + 1 && !reachable(el)) past.push('bottom');
      if (past.length === 0) continue;
      const first = String(el.className || '').split(' ')[0];
      bad.push(
        `${el.tagName.toLowerCase()}${first ? `.${first}` : ''} past ${past.join('+')} ` +
          `(${String(Math.round(r.left))},${String(Math.round(r.top))} → ` +
          `${String(Math.round(r.right))},${String(Math.round(r.bottom))})`,
      );
    }
    return bad;
  }, inset);
}
