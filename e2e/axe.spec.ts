import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Result } from 'axe-core';

/**
 * axe-core over every distinct page shape the site has (#181).
 *
 * ## Why one scan per shape rather than one per route
 *
 * There are 108 game pages, 108 play routes and 18 category hubs, and every page in each of
 * those sets is the same component with different words in it. Scanning all 234 would take
 * minutes to re-confirm one template three hundred times over — the same arithmetic that
 * put `category-hubs.spec.ts` on one engine. What differs between shapes is the markup:
 * the landing page's hero, the catalogue's controls, a game page's definition list, a hub's
 * breadcrumb, the settings panel's switches and file input, and the play route's canvas.
 * One of each is what this scans.
 *
 * ## Which engine
 *
 * Chromium alone, and `playwright.config.ts` carries the ignore that arranges it. axe reads
 * the accessibility tree and the computed styles; a contrast ratio, an accessible name and a
 * heading order are properties of the document, not of how an engine paints it. Running the
 * identical verdict on four projects would be the same waste `CONTENT_ONLY` was written to
 * stop, on a spec that costs far more per run than a content check does. Anything that
 * genuinely differs between engines — layout, insets, pointers, the canvas — is already
 * covered by specs that run on all four.
 *
 * ## The canvas
 *
 * A game draws into a canvas, and a page whose main content is one is the case an automated
 * scan is worst at. The canvas is **not** excluded here, and the reason is that excluding it
 * would buy nothing while costing everything around it: a canvas has no DOM inside it, so
 * axe already sees one element with no content to judge — it reports nothing about the board
 * and could report nothing if the board were unreadable. What it *can* see on the play route
 * is the scoreboard, the mute, the pause button and the overlays, which is the part a screen
 * reader actually uses during a match and the part worth guarding. An `exclude()` on the
 * canvas would have taken its ancestors' contrast checks with it for no gain.
 *
 * So the play route is scanned like every other shape, and what these do **not** assert is
 * axe's `incomplete` list — the nodes it flags as needing a human. `color-contrast` goes
 * there whenever axe cannot resolve what sits behind a piece of text: measured on this
 * build, one node on a running match (the pause glyph over the HUD's tinted band) and 250 on
 * the catalogue (the Play badge and the favourite star, both over tile art). A machine
 * cannot read pixels, so failing on those would mean either failing a question nobody has
 * answered or answering it by suppressing the rule. Those pixels are covered by people and
 * by rules a scanner cannot run: CLAUDE.md rule 7 (colour is never the only signal), the
 * greyscale item in the definition of done, and each game's own palette.
 *
 * ## When this fails
 *
 * The failure message names the rule id and the nodes it fired on. Look the id up on
 * dequeuniversity.com — every axe rule has a page there — and fix the markup. Suppressing a
 * rule to get green needs the reason written into `SUPPRESSED` below, and there is nothing
 * in it today.
 */

/**
 * The tags #181 asks for: A and AA at WCAG 2.0 and 2.1, and now 2.2 (#182), plus Deque's
 * own best-practice set, which is where the landmark and heading-order rules live. AAA is
 * deliberately absent — it contains rules the product has decided against on purpose, and a
 * gate nobody can pass is a gate somebody turns off.
 *
 * `wcag22a`/`wcag22aa` add the automatable share of WCAG 2.2: axe machine-checks 2.4.11
 * Focus Not Obscured (Minimum), 2.5.8 Target Size (Minimum) and 3.3.8 Accessible
 * Authentication among them. The 2.2 criteria a scanner cannot judge — 2.4.13 Focus
 * Appearance, 2.5.7 Dragging Movements, 3.2.6 Consistent Help, 3.3.7 Redundant Entry — are
 * reviewed by hand in `docs/wcag-audit.md`, which lists a pass or a defect against every
 * one and is the deliverable this tag change is half of.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice'];

/**
 * Rules turned off, with the reason each one is off.
 *
 * Empty, and it should stay that way: a suppression is a decision to ship a known defect, so
 * it belongs in a review rather than in a commit that was trying to get a build green.
 */
const SUPPRESSED: readonly string[] = [];

/** How many offending nodes a failure message lists per rule. */
const MAX_NODES = 8;

/**
 * Up to `MAX_NODES` of a rule's nodes, spread evenly across the list rather than taken from
 * the front.
 *
 * A rule that fires on a hundred catalogue cards and once in the footer is a rule whose
 * interesting node is the last one, and the front of the list is a hundred copies of the
 * same finding. Reading the head of `color-contrast` on `/settings/` is exactly how the four
 * footer links were missed the first time this spec's own output was read: they were inside
 * "and 4 more nodes", behind six identical ones.
 */
function spread<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = items.length / max;
  const picked: T[] = [];
  for (let i = 0; i < max; i += 1) {
    const item = items[Math.floor(i * step)];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

async function scan(page: Page): Promise<Result[]> {
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  const results = await (
    SUPPRESSED.length > 0 ? builder.disableRules([...SUPPRESSED]) : builder
  ).analyze();
  return results.violations;
}

/**
 * One readable line per offending node.
 *
 * A list of strings rather than the raw violation objects, because a failed `toEqual` prints
 * what it was given: the objects carry every node's full HTML and the diff becomes unusable
 * at exactly the moment somebody needs to read it.
 */
function lines(violations: readonly Result[]): string[] {
  const out: string[] = [];
  for (const violation of violations) {
    const impact = violation.impact ?? 'unknown';
    if (violation.nodes.length > MAX_NODES) {
      out.push(
        `${violation.id} (${impact}) on ${String(violation.nodes.length)} nodes — ` +
          `${violation.help}. ${String(MAX_NODES)} of them, sampled across the page:`,
      );
    }
    for (const node of spread(violation.nodes, MAX_NODES)) {
      out.push(`${violation.id} (${impact}) at ${node.target.join(' ')} — ${violation.help}`);
    }
  }
  return out;
}

async function expectClean(page: Page, shape: string): Promise<void> {
  expect(lines(await scan(page)), `axe violations on ${shape}`).toEqual([]);
}

test.describe('the site has no automated accessibility violations', () => {
  test('the landing page', async ({ page }) => {
    await page.goto('/');
    await expectClean(page, 'the landing page');
  });

  test('the catalogue, once its controls are live', async ({ page }) => {
    await page.goto('/games/');
    // The search, the chips and the stars are server-rendered before the script that drives
    // them arrives, and `data-ready` is the browser's own signal that it has read the
    // address and the stores. Scanning before then scans a page that is still the old one.
    await expect(page.locator('[data-ready]')).toBeAttached();
    await expectClean(page, 'the catalogue');
  });

  test("a game's landing page", async ({ page }) => {
    await page.goto('/games/air-hockey/');
    await expectClean(page, '/games/air-hockey/');
  });

  test('a category hub', async ({ page }) => {
    await page.goto('/games/category/board/');
    await expectClean(page, '/games/category/board/');
  });

  test('how to play', async ({ page }) => {
    await page.goto('/how-to-play/');
    await expectClean(page, '/how-to-play/');
  });

  test('the settings page', async ({ page }) => {
    await page.goto('/settings/');
    // The panel's switches and counts come from storage in an effect, so the first paint is
    // the defaults; the status line is rendered either way. Waiting on a control that only
    // exists after mount is what makes this a scan of the real page.
    await expect(page.getByRole('switch', { name: 'Mute', exact: true })).toBeVisible();
    await expectClean(page, '/settings/');
  });

  test('a play route before the match starts', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    // The lobby is a different page from the match: radio groups, mode buttons and the
    // control legend, none of which exist once a match is running.
    await expect(page.getByRole('button', { name: 'Play together here' })).toBeVisible();
    await expectClean(page, 'the play lobby');
  });

  test('a play route with a match running', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    // Past the countdown, so what is scanned is the HUD and the board rather than the
    // overlay that covers them for three seconds.
    await expect(page.getByRole('status').filter({ hasText: /^[0-9]$|^Go$/ })).toBeHidden({
      timeout: 10_000,
    });
    await expectClean(page, 'a running match');
  });
});
