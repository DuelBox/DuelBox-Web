import { expect, test } from '@playwright/test';

/**
 * The structure a screen reader navigates by (#177).
 *
 * A screen-reader user does not read a page top to bottom. They jump: to the landmarks, to
 * the headings, to the next control, and they wait on the live regions to tell them what
 * changed. So what is asserted here is not "the page looks right" — `axe.spec.ts` already
 * scans for the violations a machine can name — but the four structural facts a browser can
 * check that a scanner cannot: that there is one main and it can be jumped *to*, that every
 * navigation says which one it is, that the board says what it is, and that the result of a
 * match reaches a live region rather than merely appearing on screen.
 *
 * ## Which engines
 *
 * Two, through `ONE_PER_ENGINE` in `playwright.config.ts`, and the skip link is the reason.
 * The defect it pins was engine-specific: a fragment link to a `<main>` that could not hold
 * focus left `document.activeElement` on `<body>`, and Chromium hid it by moving the
 * sequential focus starting point while WebKit was measured not to. A single-engine run of
 * this file would re-confirm the engine that never showed the bug.
 *
 * Focus is moved with `focus()` and the link activated with Enter rather than tabbed to.
 * Whether Tab reaches a link at all is a macOS system preference on WebKit — the trap
 * `MatchOverlay`'s focus trap already records — and this file is about where activation
 * *sends* focus, which is the same question whichever way a player got to the link.
 */

/** One of each page shape the shell has, which is the same reading `axe.spec.ts` takes. */
const SHELL_ROUTES = [
  '/',
  '/games/',
  '/games/air-hockey/',
  '/games/category/board/',
  '/how-to-play/',
  '/settings/',
];

test.describe('the landmarks', () => {
  for (const route of SHELL_ROUTES) {
    test(`${route} has one main, one banner and one contentinfo`, async ({ page }) => {
      await page.goto(route);
      // One each. Two mains is a page with two answers to "where does the content start",
      // and the skip link can only point at one of them.
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
    });

    test(`${route} names every navigation it has`, async ({ page }) => {
      await page.goto(route);
      /*
       * Every page here has at least two navs — the header's and the footer's — and up to
       * four. Unnamed they are announced as "navigation" over and over, which tells a
       * reader jumping between landmarks nothing about which one they have landed in.
       *
       * Read from the DOM rather than through `getByRole`, because a locator can only find
       * the navs that *have* a name and the whole question is whether any does not.
       */
      const unnamed = await page.evaluate(() => {
        const named = (nav: Element): boolean => {
          if ((nav.getAttribute('aria-label') ?? '').trim() !== '') return true;
          const ids = (nav.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
          return ids.some((id) => (document.getElementById(id)?.textContent ?? '').trim() !== '');
        };
        return [...document.querySelectorAll('nav')]
          .filter((nav) => !named(nav))
          .map((nav) => nav.outerHTML.slice(0, 120));
      });
      expect(unnamed, 'a nav with no accessible name').toEqual([]);
      expect(
        await page.getByRole('navigation').count(),
        'the page has navigation to name in the first place',
      ).toBeGreaterThan(1);
    });
  }
});

test.describe('the skip link', () => {
  test('moves focus into the main landmark, rather than only scrolling to it', async ({ page }) => {
    await page.goto('/');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await skip.focus();
    await expect(skip).toBeFocused();

    await page.keyboard.press('Enter');

    // The defect exactly: without `tabindex="-1"` on the target, activating this link left
    // focus on `<body>` and no virtual cursor moved, on either engine.
    const landed = await page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof HTMLElement ? `${active.tagName}#${active.id}` : 'none';
    });
    expect(landed).toBe('MAIN#main');
  });

  test('is the first thing in the document, so it is the first thing reached', async ({ page }) => {
    await page.goto('/games/');
    const first = await page.evaluate(() => {
      const stops = document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea',
      );
      const stop = stops[0];
      return stop === undefined ? 'none' : stop.textContent.trim();
    });
    expect(first).toBe('Skip to content');
  });
});

test.describe('the board', () => {
  test('tells a screen reader what it is, by name and by role', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();
    // Asked for by role, not by attribute: that the name is *computed* is the property that
    // matters, and a `canvas` with no role is an element an engine may drop the name from.
    await expect(page.getByRole('img', { name: /board$/ })).toBeVisible();
  });
});

/**
 * The acceptance criterion of #177 in one test: a screen-reader user can hear the result.
 *
 * Crash It, hard, one round, which is how `record.spec.ts` already drives a match to its end
 * without anybody touching a control. Its 25-second budget is measured, not guessed.
 */
test.describe('the result of a match', () => {
  test.describe.configure({ timeout: 90_000 });

  test('reaches a live region that was already on the page', async ({ page }) => {
    await page.goto('/play/crash-it/');
    await page.getByRole('radio', { name: /Hard/ }).check();
    await page.getByRole('radio', { name: '1 round' }).check();
    await page.getByRole('button', { name: /Play against/ }).click();

    // The region, present and silent from the countdown onward. Both halves matter: a live
    // region inserted at the same moment as its text is the one shape assistive technology
    // is least reliable about, and a region that spoke during play would be announcing the
    // score, which the HUD already does per seat.
    const announcer = page.locator('p.db-visually-hidden[role="status"]');
    await expect(announcer).toHaveCount(1);
    await expect(announcer).toHaveText('');

    await expect(page.getByRole('button', { name: /Rematch/i })).toBeVisible({ timeout: 25_000 });
    await expect(announcer).toHaveText(/(wins|A draw)/);

    // And said once. The panel a player then navigates is a named group: it used to be
    // `role="status"` as well, so an engine that announced its insertion read the heading,
    // the winner, the score, the all-time record and three buttons over the top of the one
    // sentence that says the result.
    await expect(page.getByRole('group', { name: 'Game over' })).toBeVisible();
  });
});
