import { expect, test, type Page } from '@playwright/test';

/**
 * The game card's two states, in a real engine (#82).
 *
 * `components/game-card.test.ts` reads the stylesheet and proves the loop is declared and
 * gated. What a file cannot say is whether an engine actually starts an animation on a
 * `<use>` inside an inline SVG when its ancestor link is hovered, or stops it when the
 * preference is set — `transform-box: fill-box` on `<use>` is precisely the kind of thing
 * engines have implemented at different times. So the running state is read back with
 * `getAnimations()`, which every engine here implements.
 *
 * The keyboard half: a card is a link, so it is one tab stop and Enter opens it. **Space does
 * not, and that is decided rather than missed.** An `<a>` does not activate on Space in any
 * browser — Space scrolls — and making it do so means a key handler on 108 server-rendered
 * cards, which is the client directive `lib/landing.test.ts` fails the build over. The issue
 * wrote "Enter and Space" for a card imagined as a button; this one is a link, announces as
 * one, and behaves as every other link on the site does.
 */

const SLUG = 'chess';
const card = (page: Page) => page.locator(`a[href="/play/${SLUG}/"]`);
/** The tile's moving parts: every `<use>` but the chip, which the stylesheet holds still. */
const moving = (page: Page) => card(page).locator('svg use').first();

async function openCatalogue(page: Page) {
  await page.goto('/games/');
  await expect(page.locator('[data-ready]')).toBeAttached();
  await card(page).scrollIntoViewIfNeeded();
}

const playState = (page: Page) =>
  moving(page).evaluate((el) => el.getAnimations().map((animation) => animation.playState));

test.describe('the card at rest', () => {
  test('runs no animation until it is pointed at', async ({ page }) => {
    // The control: a loop that ran on every card all the time would pass the hover test
    // for the wrong reason, and would be 108 loops on a page nobody has touched.
    await openCatalogue(page);
    expect(await playState(page)).toEqual([]);
  });
});

test.describe('the card under a pointer', () => {
  test('starts its preview loop, and the chip stays still', async ({ page }) => {
    await openCatalogue(page);
    await card(page).hover();
    await expect.poll(() => playState(page)).toContain('running');
    const chip = await card(page)
      .locator('svg use')
      .last()
      .evaluate((el) => el.getAnimations().length);
    expect(chip, 'the chip is the one part of the tile that does not move').toBe(0);
  });

  test('stays still when motion is not wanted', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openCatalogue(page);
    await card(page).hover();
    // Not "finished" or "paused": `animation: none` means there is no animation at all.
    await page.waitForTimeout(100);
    expect(await playState(page)).toEqual([]);
  });
});

test.describe('the card from the keyboard', () => {
  test('is one tab stop, previews while focused, and opens on Enter', async ({ page }) => {
    await openCatalogue(page);
    // Focus is moved with `focus()` and not by tabbing to it, the way `screen-reader.spec.ts`
    // does: WebKit on macOS skips links on Tab unless a system preference says otherwise,
    // and the ~40 stops between the search box and this card are not what is under test.
    // A modifier press afterwards makes the focus keyboard-shaped, which is what
    // `:focus-visible` keys off in every engine here.
    await card(page).focus();
    await page.keyboard.press('Shift');
    await expect(card(page)).toBeFocused();
    await expect.poll(() => playState(page)).toContain('running');

    // Nothing inside the link takes a second Tab: wherever focus goes next, it is not
    // inside this card.
    await page.keyboard.press('Tab');
    const leftTheCard = await page.evaluate(
      (slug) => document.activeElement?.closest(`a[href="/play/${slug}/"]`) === null,
      SLUG,
    );
    expect(leftTheCard, 'the stop after the card is outside it').toBe(true);

    await card(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/play/${SLUG}/$`));
  });
});
