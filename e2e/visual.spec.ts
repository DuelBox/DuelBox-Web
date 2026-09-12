import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Pixels, held to what they were last time, on the screens that are not a game (#227).
 *
 * Every other spec in this directory asks a question with a name: is this link dead, does
 * that control clear the token, can a screen reader find the heading. None of them can see
 * a stylesheet edit that moves a card six pixels left, drops a border, or swaps a colour
 * token for one four shades off — and a batch here is several people editing CSS modules at
 * the same time. That is the gap this fills, and it is the only thing it does: it cannot say
 * what a screen *should* look like, only that it looks like it did when somebody last agreed.
 *
 * ## The five shots, and the many that are deliberately absent
 *
 * A snapshot is worth having when a change to it means something. The catalogue's grid is
 * the counter-example and the reason this file is short: a hundred and eight tiles that
 * change every time `data/catalog.yaml` gains a row, with thirty-five more games still to
 * come. Its baseline would be updated on sight, in a batch about something else, by somebody
 * who had stopped reading the diff two batches ago — and a baseline nobody reads is worse
 * than no baseline, because it makes the suite look like it is working. The same argument
 * rules out a game's own landing page and the eighteen category hubs.
 *
 * So: the guide, the settings panel, the catalogue's chips, the landing hero, and the header
 * at the narrowest width the product supports. Between them they carry the whole shell type
 * scale, the header, the footer, every species of control the site has outside a match, and
 * both sides of the 30rem breakpoint.
 *
 * ## The screens move, so this freezes them
 *
 * Four things on the shell differ between two visitors, and every one of them is per-device
 * state held in `localStorage`: a favourite star, the recently-played row, the head-to-head
 * record and the settings counts. Playwright gives every test a fresh browser context, so
 * all four are in the state a first visit gets — five zeroes and "Nothing yet." under Most
 * played, which is exactly what the settings baseline holds — and none of them needs a mask.
 * A test that starts by writing to storage would need one; none of these does.
 *
 * What does have to be masked is the catalogue's *size*. "108" appears in the footer of
 * every page and in the guide's opening paragraph, and it changes on every batch of new
 * games. Left alone it would churn all five baselines at once, and five churning baselines
 * are how a reviewer learns to accept a diff without opening it. Both sentences are masked,
 * so exactly one baseline carries the number — the landing hero, where it is the largest
 * text on the site's most-visited page and worth a deliberate look when it changes.
 *
 * Animations need no handling here: `toHaveScreenshot` disables them, and Playwright
 * emulates `prefers-color-scheme` and `prefers-reduced-motion` to fixed values, so the
 * machine the run happens on cannot change what is drawn. The faces are this site's own and
 * arrive over the wire, so every shot waits on `document.fonts.ready` first — `fonts.spec.ts`
 * reads the same signal for the same reason.
 *
 * ## Linux only, and what a Mac sees
 *
 * A screenshot is a fact about a platform. macOS rasterises text through CoreText and Linux
 * through the copy of FreeType inside Chromium; the same build of the same page is a
 * different picture on each, by far more than any threshold worth setting. Three honest ways
 * to live with that: generate the baselines in CI and nowhere else, run the suite in a
 * container so every machine agrees, or pick one platform and say so.
 *
 * This picks the platform CI runs on. A container would be a second toolchain to install
 * before anybody could run the gate, and its font set is not the runner's font set either —
 * the 🔊 in the header is drawn in whatever face the system offers rather than in one of the
 * three this site ships, so a container would trade one mismatch for a subtler one.
 * Generating in CI is what actually happens, and the baselines in `e2e/__screenshots__` are
 * named `-linux` to say so out loud.
 *
 * On any other platform each test **skips** rather than fails, and says why. A suite that is
 * red on every developer's machine for a reason no developer can fix is a suite that teaches
 * people to ignore a red run, which costs more than this guard is worth. `-u` on a Mac
 * writes `-darwin` baselines, which `.gitignore` keeps out of the repository: they are for
 * watching your own change locally, and CI will not look at them.
 *
 * ## Accepting a change is one command
 *
 * A failed run regenerates the baselines on the platform that owns them and attaches them,
 * so accepting is:
 *
 *     gh run download <run-id> -n visual-baselines-<shard> -D e2e/__screenshots__
 *
 * and then a commit. The shard is in the name of the job that went red. Seeing what you are
 * accepting first is the companion artefact — `-n visual-diffs-<shard>`, into anywhere —
 * which holds the `-diff.png` for each screen, the page ghosted with the changed pixels lit
 * up. `ci.yml` carries both, and on a Linux machine the whole thing is
 * `npx playwright test e2e/visual.spec.ts --project=chromium -u changed`.
 *
 * Nothing here is tuned loose, and one thing had to be tightened: Playwright's default
 * `threshold` of 0.2 tolerates a luminance shift of a fifth of the range on every pixel, and
 * this suite was watched passing `--db-muted` swapped for `--db-faint` — 4.65:1 replaced by
 * 2.45:1, the one contrast regression this product least wants to ship — before
 * `playwright.config.ts` set it to 0. There is no `maxDiffPixels` and no `maxDiffPixelRatio`
 * either, for the reason given there.
 */

/**
 * Where an intended change is accepted, printed on the failure itself.
 *
 * Playwright's own message names the file and the diff and stops there, which is the right
 * place for this sentence to be: the person reading it has just been told their change moved
 * something, and the next thing they need is whether that is fine and how to say so.
 */
const ACCEPT =
  'If the change is intended, accept it in one command: `gh run download <run-id> ' +
  '-n visual-baselines-<shard> -D e2e/__screenshots__` from the failed run, then commit ' +
  'what it changed. To see what you are accepting first, `-n visual-diffs-<shard>` holds ' +
  'the -diff.png for each screen. On Linux: `npx playwright test e2e/visual.spec.ts ' +
  '--project=chromium -u changed`.';

/**
 * 1280 by 800, pinned here rather than taken from the `Desktop Chrome` preset the project
 * carries. A baseline is a picture of a viewport, and a Playwright upgrade that revised the
 * preset by a pixel would invalidate all five of these for a reason nobody could see in a
 * diff of this repository.
 */
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

/**
 * Whether this run has a baseline to compare against, and what to do when it does not.
 *
 * On CI it never skips: a baseline missing from the repository means the guard is not
 * running, so the comparison goes ahead and fails — `A snapshot doesn't exist at …`, with
 * nothing written, because `playwright.config.ts` sets `updateSnapshots: 'none'`. Everywhere
 * else a missing baseline is not a defect — it is a Mac, or a first checkout — so it says so
 * and stands down.
 *
 * Unless the run asked for baselines. `updateSnapshots` is `'none'` in the config and
 * anything else only when `-u` was typed, and skipping a run that was told to write the
 * pictures is how the documented way to make them would have quietly done nothing: written
 * first, run second, five skips and no files.
 */
function requireBaseline(name: string): void {
  if (test.info().config.updateSnapshots !== 'none') return;
  const baseline = test.info().snapshotPath(name, { kind: 'screenshot' });
  if (existsSync(baseline)) return;
  test.skip(
    !process.env.CI,
    `No ${process.platform} baseline for ${name}: the committed ones are Linux, because ` +
      'that is what CI compares on. Run `npx playwright test e2e/visual.spec.ts ' +
      '--project=chromium -u changed` to write your own; they are gitignored.',
  );
}

/**
 * The faces, loaded, before anything is photographed.
 *
 * `goto` resolves on `load`, which a woff2 can miss — and a shot of the fallback stack
 * against a baseline drawn in the real one is a full-page diff with no cause in it.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/**
 * Every mask, checked before it is used.
 *
 * A mask locator that matches nothing is silently no mask at all, which would leave a
 * moving sentence in the picture and fail the next run with a diff nobody could explain.
 * `toBeVisible` is strict, so a mask that has come to match two elements fails here as well.
 */
async function checkMasks(mask: readonly Locator[]): Promise<void> {
  for (const target of mask) await expect(target).toBeVisible();
}

/** The whole document, top to bottom. */
async function shootPage(page: Page, name: string, mask: Locator[] = []): Promise<void> {
  requireBaseline(name);
  await settle(page);
  await checkMasks(mask);
  await compare(() => expect(page).toHaveScreenshot(name, { fullPage: true, mask }));
}

/** One element and its box, for the screens where the rest of the page is noise. */
async function shootElement(target: Locator, name: string): Promise<void> {
  requireBaseline(name);
  await settle(target.page());
  await compare(() => expect(target).toHaveScreenshot(name));
}

/**
 * The comparison, with {@link ACCEPT} on the end of whatever it says.
 *
 * Rethrown rather than logged: the images Playwright attached to the test are attached to
 * the test, not to the error, so the report still shows expected, actual and diff.
 */
async function compare(shoot: () => Promise<void>): Promise<void> {
  try {
    await shoot();
  } catch (error) {
    const said = error instanceof Error ? error.message : 'the screenshot did not match';
    throw new Error(`${said}\n\n${ACCEPT}`);
  }
}

/** The catalogue's size, in the footer of every page. It changes; the layout around it does not. */
const footerCount = (page: Page): Locator =>
  page.getByRole('contentinfo').getByText(/games for two players/);

test.describe('the shell screens', () => {
  test('the guide, header and footer included', async ({ page }) => {
    await page.goto('/how-to-play/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to play');
    await shootPage(page, 'how-to-play.png', [
      footerCount(page),
      page.getByText(/games in the catalogue are playable today/),
    ]);
  });

  test('the settings panel, every control it has', async ({ page }) => {
    await page.goto('/settings/');
    // The switches and the counts arrive from storage in an effect, so the first paint is
    // the defaults and a shot taken before the mount is a picture of a page that no longer
    // exists a frame later. `axe.spec.ts` waits on the same control for the same reason.
    await expect(page.getByRole('switch', { name: 'Mute', exact: true })).toBeVisible();
    await shootPage(page, 'settings.png', [footerCount(page)]);
  });

  test('the catalogue chips, which no other page has', async ({ page }) => {
    await page.goto('/games/');
    // `data-ready` is the browser's own signal that the address and the stores have been
    // read. Before it the chips are the server's, and pressed state has not been applied.
    await expect(page.locator('[data-ready]')).toBeAttached();
    await shootElement(page.getByRole('group', { name: 'Categories' }), 'catalogue-chips.png');
  });

  test('the landing hero, where the catalogue count is guarded', async ({ page }) => {
    await page.goto('/');
    // The one section with an h1 in it. The class is a CSS-module hash and not something a
    // spec may name; what identifies the hero is that the page's heading lives there.
    const hero = page.locator('section').filter({ has: page.getByRole('heading', { level: 1 }) });
    await shootElement(hero, 'landing-hero.png');
  });
});

/**
 * 320px, the width `touch-targets.spec.ts` measures at and the narrowest this product
 * supports.
 *
 * The header rather than a page: it is on all 223 exported routes, and this width is where
 * it is doing the most — the stylesheet has taken the three tools away below 40rem and the
 * call to action below 64rem, so what is left is a wordmark and two links, and whether that
 * still fits is a question a padding token can change. A whole page at this width would be a
 * very tall picture of prose reflowing, most of which is already guarded at 1280.
 */
test.describe('the shell at 320px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('the header still fits', async ({ page }) => {
    await page.goto('/');
    await shootElement(page.getByRole('banner'), 'header-narrow.png');
  });
});
