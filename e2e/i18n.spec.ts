import { expect, test, type Page } from '@playwright/test';
import AR_XB from '../apps/web/src/lib/i18n/catalogues/ar-XB.generated';
import EN_XA from '../apps/web/src/lib/i18n/catalogues/en-XA.generated';

/**
 * The i18n framework in a real browser against the static build (#219, #222, #223).
 *
 * The unit suite proves the pieces — the registry, the lazy guard, the lookup, the transforms
 * — and `check-size.mjs` weighs the chunks. What these cover is the wiring none of that can
 * see: that a `?lang=` on a link reaches the header's button, the page's heading and `<html>`
 * itself; that switching back is a re-render and not a navigation; that choosing a language
 * fetches that language's chunk and no other; that a right-to-left locale mirrors the document;
 * and that a stored choice is on `<html>` before the page has finished parsing, so a
 * right-to-left reader never sees the shell painted the wrong way round and flipped.
 *
 * The expected pseudo strings are read from the committed catalogues rather than typed here,
 * so the assertion is on exactly the bytes the build ships — a transform change regenerates
 * the catalogue and this follows it, while a catalogue the build stopped shipping fails on the
 * first `goto`.
 *
 * **The service worker is blocked** for this spec, and only for this spec. The second test
 * counts which scripts the page fetched and reads their bodies, and a worker answering from
 * the runtime cache is a second source of truth for both — `page-transition.spec.ts` makes
 * the same choice for the same reason. The offline half of the locale story (a chosen locale
 * is served from the device on the second load) is a property of `sw.js`'s runtime path,
 * documented in `docs/i18n.md`, and is exercised by `offline.spec.ts` for every same-origin
 * asset rather than repeated here per locale.
 *
 * On every engine, because this hydrates, imports a chunk and re-renders — none of which is
 * server-rendered content — and one test sets a desktop viewport because the header hides its
 * controls below 40rem, as `settings.spec.ts` does.
 */

test.use({ serviceWorkers: 'block' });

const PSEUDO_MUTE = EN_XA.messages['Mute sound'];
const PSEUDO_SETTINGS = EN_XA.messages['Settings'];
const MIRRORED_SETTINGS = AR_XB.messages['Settings'];

/** The marker `check-size.mjs` recognises a locale chunk by, in either quote style. */
const marker = (code: string): RegExp => new RegExp(`locale:["']${code}["'],messages:`);

/** The language control, found by the option it offers rather than by its label — the label changes with the locale. */
const language = (page: Page) =>
  page.locator('select', { has: page.locator('option[value="ar-XB"]') });

const html = (page: Page) => page.locator('html');
const headerButton = (page: Page, name: string) =>
  page.locator('header').getByRole('button', { name, exact: true });

/** Every script the page fetched, with its body — recorded from the first request on. */
function recordScripts(page: Page): { url: string; body: Promise<string> }[] {
  const scripts: { url: string; body: Promise<string> }[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'script') return;
    scripts.push({ url: response.url(), body: response.text().catch(() => '') });
  });
  return scripts;
}

const bodies = (scripts: readonly { body: Promise<string> }[]): Promise<string[]> =>
  Promise.all(scripts.map((script) => script.body));

test.describe('choosing a language', () => {
  test('?lang= reaches the control, the header, the heading and <html>, and switching back is not a navigation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/settings/?lang=en-XA');

    await expect(language(page)).toHaveValue('en-XA');
    // The header's mute is a client component on every page; the heading is a server
    // component rendered through <T>. Both read the one catalogue the provider loaded.
    await expect(headerButton(page, PSEUDO_MUTE)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(PSEUDO_SETTINGS);
    await expect(html(page)).toHaveAttribute('lang', 'en-XA');
    await expect(html(page)).toHaveAttribute('dir', 'ltr');

    // A marker on the window survives a re-render and not a navigation.
    await page.evaluate(() => {
      (window as Window & { __duelboxI18n?: number }).__duelboxI18n = 1;
    });
    await language(page).selectOption('en');
    await expect(headerButton(page, 'Mute sound')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
    await expect(html(page)).toHaveAttribute('lang', 'en');
    await expect(html(page)).toHaveAttribute('dir', 'ltr');
    expect(
      await page.evaluate(() => (window as Window & { __duelboxI18n?: number }).__duelboxI18n),
    ).toBe(1);
    // Read, never written back: the address still carries the request it arrived with.
    expect(new URL(page.url()).searchParams.get('lang')).toBe('en-XA');
  });

  test('only the chosen locale is downloaded, and only once it is chosen', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const scripts = recordScripts(page);
    await page.goto('/settings/');
    await expect(headerButton(page, 'Mute sound')).toBeVisible();
    await expect(language(page)).toHaveValue('en');

    // Control: scripts were seen at all, so an empty list below cannot pass as "none".
    const before = await bodies(scripts);
    expect(before.length).toBeGreaterThan(3);
    expect(before.filter((body) => marker('en-XA').test(body))).toHaveLength(0);
    expect(before.filter((body) => marker('ar-XB').test(body))).toHaveLength(0);

    const seen = scripts.length;
    await language(page).selectOption('en-XA');
    await expect(headerButton(page, PSEUDO_MUTE)).toBeVisible();

    const after = await bodies(scripts.slice(seen));
    const enXa = scripts.slice(seen).filter((_, index) => marker('en-XA').test(after[index] ?? ''));
    expect(enXa, 'exactly one new script carries the en-XA catalogue').toHaveLength(1);
    // An async chunk, as webpack names one: a numeric id and a content hash.
    expect(new URL(enXa[0]!.url).pathname).toMatch(/\/_next\/static\/chunks\/\d+\.[0-9a-f]+\.js$/);
    // The other locale was never asked for, before or after.
    const all = await bodies(scripts);
    expect(all.filter((body) => marker('ar-XB').test(body))).toHaveLength(0);
  });

  test('a right-to-left locale mirrors the document', async ({ page }) => {
    await page.goto('/settings/?lang=ar-XB');
    await expect(html(page)).toHaveAttribute('lang', 'ar-XB');
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(MIRRORED_SETTINGS);
    await expect(language(page)).toHaveValue('ar-XB');
  });

  test('a reload keeps the choice, with lang and dir on <html> before DOMContentLoaded', async ({
    page,
  }) => {
    // Recorded at DOMContentLoaded — before hydration, before any chunk — so what this sees
    // is the inline script in the layout and nothing else.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        (window as Window & { __duelboxAtReady?: { lang: string; dir: string } }).__duelboxAtReady =
          { lang: document.documentElement.lang, dir: document.documentElement.dir };
      });
    });
    await page.goto('/settings/?lang=ar-XB');
    await expect(html(page)).toHaveAttribute('dir', 'rtl');

    // Without the query this time: what is stored is what applies.
    await page.goto('/settings/');
    await expect(html(page)).toHaveAttribute('lang', 'ar-XB');
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    await expect(language(page)).toHaveValue('ar-XB');
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __duelboxAtReady?: { lang: string; dir: string } })
            .__duelboxAtReady,
      ),
    ).toEqual({ lang: 'ar-XB', dir: 'rtl' });
  });
});
