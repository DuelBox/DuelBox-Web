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

/**
 * The two script faces of #224, the file each is served from, and a word in its script.
 *
 * `hi` and `ar` are the launch locales' native names — what a language switcher shows —
 * and each is a string every face in the stacks except the one named here lacks a glyph
 * for, which is what makes the width comparison below mean something.
 */
const SCRIPT_FACES = [
  { family: 'Noto Sans Devanagari', file: /noto-sans-devanagari[^/]*\.woff2$/, sample: 'हिन्दी' },
  { family: 'Noto Sans Arabic', file: /noto-sans-arabic[^/]*\.woff2$/, sample: 'العربية' },
] as const;
const ANY_SCRIPT_FACE = /noto-sans-(?:devanagari|arabic)[^/]*\.woff2$/;

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

/**
 * The script faces are range-gated, and the gate is real in both directions (#224).
 *
 * `fonts.css` declares Noto Sans Devanagari and Noto Sans Arabic with Google's `unicode-range`
 * for each subset, and every stack in `tokens.css` lists them after the primary face. The
 * claim that rests on is that an English page never fetches either file — 287,340 bytes that
 * `check-size.mjs` leaves out of the first-session line on the strength of that range — and
 * that a page which does draw Hindi or Arabic fetches exactly the face it needs and draws in
 * it. `font-coverage.test.ts` holds the declared ranges; this is the half that watches a
 * browser act on them.
 *
 * The service worker is blocked for this test, deliberately. On a first visit the worker
 * registers on `load` and claims the page, and from then on a font request is answered by
 * `respondToAsset` in `sw.js` — it still reaches the network, but through the worker, and
 * what is under test here is the browser's own decision to request a face, not the worker's
 * handling of it once requested. `e2e/offline.spec.ts` is where the worker is tested.
 *
 * The four checks, in order. (a) On `/`, no request for either script file, while the base
 * faces were requested — the positive control that the request log is seeing fonts at all.
 * (b) Two probes appended, one word of Hindi and one of Arabic in the body stack, and a layout
 * forced so the browser resolves the runs: now each file is requested, from this origin, and
 * `document.fonts.check` says the face is usable for that text. (c) The probe is wider or
 * narrower in the stack than in the same stack without its script face: if the face were not
 * really drawing, both would resolve to the same fallback and the widths would be equal,
 * which is the failure #2469 shipped for the Latin faces. (d) An approximation of "no box":
 * the width differs from the width in a stack of one face that has no glyph in the script
 * at all (JetBrains Mono alone), where every character is the fallback's `.notdef` or the
 * system's own face. Neither of those is Noto, so a probe drawn in Noto cannot match it —
 * unless by a coincidence of advance widths, which is why (b) is asserted as well and why
 * this is called an approximation rather than a proof.
 */
test.describe('the script faces are fetched only for their scripts', () => {
  test.use({ serviceWorkers: 'block' });

  test('an English page fetches neither; a Hindi or Arabic run fetches its own and draws in it', async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));

    await page.goto('/');
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    // (a) The gate holds shut. The base faces are the control that fonts are being logged.
    const origin = new URL(page.url()).origin;
    const fontsBefore = requested.filter((url) => url.startsWith(origin) && url.endsWith('.woff2'));
    expect(fontsBefore).not.toHaveLength(0);
    expect(fontsBefore.filter((url) => ANY_SCRIPT_FACE.test(url))).toEqual([]);

    const report = await page.evaluate(
      async (faces) => {
        const bodyStack = getComputedStyle(document.body).fontFamily;
        const widthIn = (text: string, stack: string) => {
          const probe = document.createElement('span');
          probe.textContent = text;
          probe.style.cssText =
            'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;' +
            `font:400 40px ${stack}`;
          document.body.append(probe);
          const width = probe.getBoundingClientRect().width;
          probe.remove();
          return width;
        };

        // (b) Two runs of text in the body stack, laid out so the browser resolves them and
        // requests whatever face its ranges say those characters need.
        const probes = faces.map(({ sample }) => {
          const probe = document.createElement('p');
          probe.textContent = sample;
          probe.style.cssText = `position:absolute;left:-9999px;top:0;font:400 40px ${bodyStack}`;
          document.body.append(probe);
          probe.getBoundingClientRect();
          return probe;
        });
        await document.fonts.ready;
        for (const probe of probes) probe.remove();

        return faces.map(({ family, sample }) => {
          const without = bodyStack
            .split(',')
            .filter((entry) => !entry.includes(family))
            .join(',');
          return {
            family,
            usable: document.fonts.check(`16px "${family}"`, sample),
            inStack: widthIn(sample, bodyStack),
            withoutFace: widthIn(sample, without),
            noGlyphs: widthIn(sample, '"JetBrains Mono"'),
          };
        });
      },
      SCRIPT_FACES.map(({ family, sample }) => ({ family, sample })),
    );

    for (const [index, face] of SCRIPT_FACES.entries()) {
      const fetched = requested.filter((url) => url.startsWith(origin) && face.file.test(url));
      // (b) Requested now, from here, once.
      expect(fetched, `${face.family} was not requested for ${face.sample}`).toHaveLength(1);
      const drawn = report[index];
      expect(drawn?.usable, `${face.family} is not usable for ${face.sample}`).toBe(true);
      // (c) and (d): the face is really the one drawing.
      expect(drawn?.inStack).toBeGreaterThan(0);
      expect(
        drawn?.inStack,
        `${face.family} draws no differently from the stack without it`,
      ).not.toBeCloseTo(drawn?.withoutFace ?? 0, 1);
      expect(
        drawn?.inStack,
        `${face.family} draws no differently from a face with no glyph`,
      ).not.toBeCloseTo(drawn?.noGlyphs ?? 0, 1);
    }
  });
});
