import { expect, test, type Page } from '@playwright/test';
import {
  FRAMED_ATTRIBUTE,
  FRAMED_NOTICE_ID,
  FRAMED_NOTICE_LINK,
} from '../apps/web/src/app/frame-guard';

/**
 * The clickjacking defence, put in a real frame in a real engine.
 *
 * `X-Frame-Options` and CSP `frame-ancestors` are both header-only, and the host this site
 * is exported for serves neither (#2481) — so the inline guard in `app/frame-guard.ts` is
 * the whole of it. Until this file there was **no test of any kind that framed a page**:
 * `header-delivery.test.ts` reads the guard's source and `check-headers.mjs` looks for its
 * first forty characters in every exported page, and both of those pass on a guard that
 * throws on line two. That is the shape CLAUDE.md counts ten of.
 *
 * It matters more now than it did, because the refusal is split across three files for size
 * (#2545): the script hides and stamps, `globals.css` reveals, `layout.tsx` renders. The
 * unit half (`app/frame-notice.test.ts`) holds the three to each other by reading them. This
 * is the half that asks a browser whether the result actually hides anything.
 *
 * Two engines, deliberately not in `CONTENT_ONLY`: what is under test is how an engine
 * computes visibility for a subtree under `visibility: hidden` and whether an `!important`
 * id rule wins there. That is exactly the kind of thing engines have differed about.
 */

/** A game this build ships, so the frames below have something real to refuse. */
const GAME = 'tic-tac-toe';

/** The address the framing page is served from. Never written by the build. */
const HOST_PAGE = '/__frame-host.html';

/**
 * Frames `path` and hands back the frame.
 *
 * The framing page is fulfilled by `page.route` on this site's own origin rather than being
 * a page of the site, and both halves of that were forced by a failure:
 *
 * - **Not a DuelBox page.** Every page carries a `default-src 'none'` meta CSP with no
 *   `frame-src`, so a DuelBox page cannot frame anything. The child never loads and every
 *   assertion below fails with "element not found" — which is what the first draft did.
 * - **Not `about:blank` either.** The second draft framed an absolute URL from a
 *   `setContent` document, and Chromium refused the subresource outright
 *   (`chrome-error://chromewebdata/`): a request from an opaque origin to a loopback address
 *   is Private Network Access, and it is blocked before the server hears about it.
 *
 * A routed URL on the real origin is neither. Nothing is written to `apps/web/out`, so the
 * artefact under test is exactly the one a host would serve.
 */
async function frame(page: Page, path: string) {
  await page.route(`**${HOST_PAGE}`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>host</title><iframe title="framed" src="${path}" style="width:900px;height:700px;border:0"></iframe>`,
    }),
  );
  await page.goto(HOST_PAGE);
  return page.frameLocator('iframe[title="framed"]');
}

test.describe('a DuelBox page that finds itself in a frame', () => {
  test('shows itself normally when it is not framed', async ({ page }) => {
    // The control. Without it every assertion below could be passing because the page never
    // loaded, and a guard that reports "hidden" for a 404 is not a guard.
    await page.goto(`/games/${GAME}/`);
    await expect(page.locator('.db-shell')).toBeVisible();
    await expect(page.locator(`#${FRAMED_NOTICE_ID}`)).toBeHidden();
  });

  test('hides the page and offers a way out of the frame', async ({ page }) => {
    const framed = await frame(page, `/games/${GAME}/`);
    const notice = framed.locator(`#${FRAMED_NOTICE_ID}`);
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('link', { name: FRAMED_NOTICE_LINK })).toBeVisible();
    // The page itself, not merely dimmed: nothing for an overlay to sit on top of and
    // nothing for a victim to click.
    await expect(framed.locator('.db-shell')).toBeHidden();
  });

  test('sends the way out to this page, in a new tab, with no opener', async ({ page }) => {
    const framed = await frame(page, `/games/${GAME}/`);
    const link = framed.locator(`#${FRAMED_NOTICE_ID} a`);
    // `href="."` plus `trailingSlash: true`, resolved by the browser.
    await expect(link).toHaveAttribute('href', '.');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
    expect(await link.evaluate((a: HTMLAnchorElement) => a.href)).toContain(`/games/${GAME}/`);
  });

  test('lets the one route that is meant to be framed be framed', async ({ page }) => {
    // The embed surface (#2367) is the exemption, and it is the assertion that stops the
    // guard being "hide everything" — which would pass every other test in this file.
    const framed = await frame(page, `/embed/${GAME}/`);
    // The lobby, which is what `/embed/<slug>/` serves until somebody presses a mode — the
    // canvas only exists after that, and this test is about whether the page is *shown*.
    await expect(framed.getByText('Play together here')).toBeVisible();
    await expect(framed.locator(`#${FRAMED_NOTICE_ID}`)).toBeHidden();
    // The attribute is the whole channel, so its absence is the exemption itself rather than
    // a symptom of it.
    await expect(framed.locator('html')).not.toHaveAttribute(FRAMED_ATTRIBUTE);
  });
});
