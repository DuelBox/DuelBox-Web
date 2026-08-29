import { expect, test } from '@playwright/test';

/**
 * The site renders in its own faces, and fetches them from itself.
 *
 * Issue #2469: the layout linked a stylesheet from `fonts.googleapis.com` while the site's
 * own Content-Security-Policy said `style-src 'self' 'unsafe-inline'` and `font-src 'self'`.
 * The browser refused both halves and rendered the page anyway, in whatever each device
 * defaults to. Nothing threw, nothing 404'd, no test failed — and for a product where two
 * people share one screen, the two of them were not even reading the same typeface.
 *
 * A CSP failure is invisible from inside the page, so this checks it from outside as well as
 * in: the requests the browser actually made, and the face the text is actually drawn in.
 * `apps/web/src/security/csp-origins.test.ts` is the cheap static half of the same guard.
 */

const FAMILIES = ['Fredoka', 'Plus Jakarta Sans', 'JetBrains Mono'] as const;

test.describe('the site’s own typography', () => {
  test('loads its faces from this origin and draws in them, not the system fallback', async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));

    await page.goto('/');

    const report = await page.evaluate(async (families: readonly string[]) => {
      // Ask for each face explicitly rather than hoping the landing page happens to use all
      // three. A blocked `font-src` shows up here as a face that never becomes available.
      await Promise.all(families.map((family) => document.fonts.load(`600 16px "${family}"`)));
      await document.fonts.ready;

      // Width of one string in a stack that starts with the custom face, and in the same
      // stack without it. If the custom face is not really being used, the browser resolves
      // both to the same fallback and the two widths are identical — which is exactly what
      // was happening in production.
      const widthIn = (stack: string) => {
        const probe = document.createElement('span');
        probe.textContent = 'DuelBox — 107 games for two';
        probe.style.cssText =
          'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;' +
          `font:600 40px ${stack}`;
        document.body.append(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return width;
      };

      const heading = document.querySelector('h1');
      return {
        available: families.map((family) => document.fonts.check(`600 16px "${family}"`)),
        declared: [...document.fonts].map((face) => face.family),
        headingFamily: heading ? getComputedStyle(heading).fontFamily : '',
        bodyFamily: getComputedStyle(document.body).fontFamily,
        displayWidth: widthIn('Fredoka, ui-rounded, system-ui, sans-serif'),
        fallbackWidth: widthIn('ui-rounded, system-ui, sans-serif'),
      };
    }, FAMILIES);

    // 1. Nothing was asked of Google. Not the stylesheet, not the font files, not even a
    //    preconnect — the whole third-party leg is gone rather than merely blocked.
    expect(requested.filter((url) => /fonts\.(googleapis|gstatic)\.com/.test(url))).toEqual([]);

    // 2. The faces came from here. A same-origin woff2 on the wire is the positive half:
    //    without it, every assertion below could be satisfied by a locally installed font.
    const origin = new URL(page.url()).origin;
    expect(
      requested.filter((url) => url.startsWith(origin) && url.endsWith('.woff2')),
    ).not.toHaveLength(0);

    // 3. Every family the design names is declared and usable.
    for (const family of FAMILIES) expect(report.declared).toContain(family);
    expect(report.available).toEqual([true, true, true]);

    // 4. The page asks for them, and gets them. The computed stack is what CSS asked for;
    //    the width difference is what the browser actually drew.
    expect(report.headingFamily).toMatch(/^Fredoka\b/);
    expect(report.bodyFamily).toMatch(/^["']?Plus Jakarta Sans/);
    expect(report.displayWidth).toBeGreaterThan(0);
    expect(report.displayWidth).not.toBeCloseTo(report.fallbackWidth, 1);
  });
});
