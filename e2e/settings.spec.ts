import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A destructive button, pressed the two times it now takes.
 *
 * The first press arms it and the label becomes "Press again to …", so the second press
 * cannot be found under the original name — which is the whole point of the control and
 * the reason this helper exists rather than two `.click()` calls (#160).
 */
async function confirmPress(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page
    .getByRole('button', { name: `Press again to ${label.toLowerCase()}`, exact: true })
    .click();
}

/**
 * The settings page (#91), in a real browser against the static build.
 *
 * The stores are unit-tested in `apps/web/src/lib`; what these cover is the wiring the
 * unit suite cannot see. That a switch really writes and a reload really reads (#171,
 * #135). That the header's button and the page's switch show one stored value rather than
 * two copies of it. That an export is a file a player can actually pick up, and that
 * "Reset everything" leaves nothing behind (#2448). And that the page holds at 320px,
 * because every other page is measured there and a settings page is not exempt.
 */

const mute = (page: Page) => page.getByRole('switch', { name: 'Mute', exact: true });

test.describe('the settings page', () => {
  test('a mute chosen here survives a reload', async ({ page }) => {
    await page.goto('/settings/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
    await expect(mute(page)).toHaveAttribute('aria-checked', 'false');

    await mute(page).click();
    await expect(mute(page)).toHaveAttribute('aria-checked', 'true');

    await page.reload();
    await expect(mute(page)).toHaveAttribute('aria-checked', 'true');
  });

  test('the header button and the page agree, live and after a reload', async ({ page }) => {
    // The header hides its controls below 40rem, so this is a desktop-sized window.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/settings/');
    const header = page.locator('header');
    const muteButton = header.getByRole('button', { name: 'Mute sound', exact: true });
    const unmuteButton = header.getByRole('button', { name: 'Unmute sound', exact: true });
    await expect(muteButton).toHaveAttribute('aria-pressed', 'false');

    // Live: the header re-reads the one stored value the page just wrote.
    await mute(page).click();
    await expect(unmuteButton).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(unmuteButton).toHaveAttribute('aria-pressed', 'true');
    await expect(mute(page)).toHaveAttribute('aria-checked', 'true');

    // And the other way round, from the header this time.
    await unmuteButton.click();
    await expect(mute(page)).toHaveAttribute('aria-checked', 'false');
    await expect(muteButton).toHaveAttribute('aria-pressed', 'false');
  });

  test('the volume moves from the keyboard, shows its level, and is kept', async ({ page }) => {
    await page.goto('/settings/');
    const slider = page.getByRole('slider', { name: 'Volume' });
    await expect(slider).toHaveValue('1');
    await expect(page.getByText('100%')).toBeVisible();

    await slider.press('ArrowLeft');
    await expect(slider).toHaveValue('0.95');
    await expect(page.getByText('95%')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('slider', { name: 'Volume' })).toHaveValue('0.95');
  });

  test('vibration starts off, is switched on here, and is kept', async ({ page }) => {
    await page.goto('/settings/');
    const vibration = page.getByRole('switch', { name: 'Vibration', exact: true });
    // Off by default (#135): a phone lying between two people buzzes against the table.
    await expect(vibration).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('button', { name: 'Try it' })).toBeVisible();

    await vibration.click();
    await expect(vibration).toHaveAttribute('aria-checked', 'true');

    await page.reload();
    await expect(page.getByRole('switch', { name: 'Vibration', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('a game played is counted here, and can be cleared (#87)', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();

    await page.goto('/settings/');
    const recent = page.locator('dl div', { hasText: 'Recently played' }).locator('dd');
    await expect(recent).toHaveText('1');

    await confirmPress(page, 'Clear recently played');
    await expect(recent).toHaveText('0');
    await expect(page.getByRole('status')).toContainText('Recently played cleared');

    await page.reload();
    await expect(page.locator('dl div', { hasText: 'Recently played' }).locator('dd')).toHaveText(
      '0',
    );
  });

  test('export produces a player-data file, and reset erases everything', async ({ page }) => {
    await page.goto('/settings/');
    // Something to export: a fresh browser has nothing stored at all.
    await mute(page).click();

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('duelbox-player-data.json');

    const parsed: unknown = JSON.parse(readFileSync(await download.path(), 'utf8'));
    expect(parsed).toMatchObject({
      format: 'duelbox-player-data',
      version: 1,
      data: { 'duelbox:settings': { muted: true } },
    });

    await confirmPress(page, 'Reset everything');
    await expect(page.getByRole('status')).toContainText('erased');
    // The controls read the defaults again without a reload ...
    await expect(mute(page)).toHaveAttribute('aria-checked', 'false');
    // ... and storage really is empty, not merely reset to defaults.
    const keys = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('duelbox:')),
    );
    expect(keys).toEqual([]);

    await page.reload();
    await expect(mute(page)).toHaveAttribute('aria-checked', 'false');
  });

  test('an export can be imported, and a file that is not one is refused', async ({ page }) => {
    await page.goto('/settings/');
    const chooser = page.getByLabel('Import', { exact: true });

    await chooser.setInputFiles({
      name: 'duelbox-player-data.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'duelbox-player-data',
          version: 1,
          data: { 'duelbox:settings': { version: 1, muted: true, volume: 0.5, haptics: false } },
        }),
      ),
    });
    await expect(page.getByRole('status')).toContainText('Imported your settings');
    // Applied to the controls without a reload.
    await expect(mute(page)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('slider', { name: 'Volume' })).toHaveValue('0.5');

    await chooser.setInputFiles({
      name: 'notes.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"hello":"world"}'),
    });
    await expect(page.getByRole('status')).toContainText('not a DuelBox player-data export');
    // And the refusal changed nothing.
    await expect(mute(page)).toHaveAttribute('aria-checked', 'true');
  });

  test('fits a 320px phone without scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/settings/');
    await expect(page.getByRole('button', { name: 'Reset everything' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * "Within one tap from any screen" (#171) includes a match on a phone, where the header
 * hides its controls. The HUD carries the mute there — at every width, so the button is
 * in the same place whichever device a pair picked up.
 */
test.describe('the mute during a match', () => {
  test('is in the HUD, and the settings page agrees with it', async ({ page }) => {
    await page.goto('/play/tic-tac-toe/');
    await page.getByRole('button', { name: 'Play together here' }).click();

    const hud = page.getByRole('group', { name: 'Score' });
    const muteButton = hud.getByRole('button', { name: 'Mute sound', exact: true });
    await expect(muteButton).toBeVisible();
    await muteButton.click();
    await expect(hud.getByRole('button', { name: 'Unmute sound', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.goto('/settings/');
    await expect(mute(page)).toHaveAttribute('aria-checked', 'true');
  });
});
