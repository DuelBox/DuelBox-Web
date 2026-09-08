import { expect, test, type Page } from '@playwright/test';

/**
 * The two acceptance criteria that only a browser can answer, for the two halves of one
 * change: what a route shows while it is still coming (#93) and what it does when it
 * arrives (#94).
 *
 * #94's is the entire issue: a page transition must never delay interactivity. A fade that
 * looks right and swallows the first press for two hundred milliseconds fails it, and no
 * reading of the stylesheet can tell the two apart — a declaration is not a delay until a
 * browser hit-tests it. So this presses.
 *
 * #93's is one sentence and it was argued for in prose for a while rather than measured:
 * "cumulative layout shift stays under 0.1 when skeletons swap for content". A file can be
 * read for whether the fallback and the page draw the same class; only a browser can say
 * whether the swap moves anything, which is the property the class was chosen for.
 *
 * `apps/web/src/app/loading-states.test.ts` guards the shape of both from the other side:
 * opacity and nothing that moves a box, no `pointer-events`, a duration token so the
 * reduced-motion preference collapses it, one definition of the panel, and the play route
 * excused from the entry animation. This is the half those cannot reach.
 *
 * ## What #93 is measurable as here, and what it is not (#2539)
 *
 * Two tests in this file used to wait for `play/[slug]/loading.tsx`'s fallback to paint and
 * were parked as `fixme` for being a coin flip tossed at build time. #2539 asked whether
 * that fallback can be made to paint deterministically. Measured, against two exported
 * builds with different build ids and webpack runtime hashes — one of them built from an
 * `apps/web/src` byte-identical to this one — in Chromium and in real WebKit, from three
 * different starting routes, under four latency shapes: **thirty-five navigations, and the
 * fallback painted in none of them.** Holding *only* the play route's own page chunk, for
 * four seconds, does not produce it either: the address does not change, the previous page
 * stays on screen for the whole four seconds, and then the lobby appears. Sixteen of the
 * thirty-five were the parked pair itself, un-parked and run against both builds, and it
 * failed sixteen times out of sixteen.
 *
 * The mechanism, and it is not about latency. The router does not commit the arriving route
 * until that route's client modules have loaded — commit tracks the last of them to the
 * millisecond, at 800ms of hold and at 4000ms alike — so at the moment the new tree is
 * committed there is nothing left inside the loading boundary to be suspended on, and there
 * is no moment for a fallback to fill. Nothing a fixture can do to the network changes that
 * ordering; holding the payload, holding the chunks, holding both, and holding neither all
 * end the same way. The payload is not what is missing: `/play/<slug>/index.txt` carries the
 * fallback's markup as a row of its own. Nor is the segment's own `loading-*.js`, 147 bytes
 * of webpack registration and no code — across the six navigations whose every request was
 * logged, three per build, the router asked for the payload and then for the page's four
 * chunks, and never once for that one.
 *
 * **What is not claimed.** #2539 records builds where it *did* paint — six failures from one
 * build, three passes from the next — and that half was not reproduced here: rebuilding was
 * not available, so the branch where the fallback appears rests on the issue's evidence
 * rather than on this file's. Which is exactly why nothing below waits for the fallback and
 * nothing below asserts it is absent. Asserting its absence would be the same coin flip with
 * the faces swapped, and would go red on the build that finally shows it — the one build
 * whose news is good. Every assertion below was chosen to hold whichever way that lands: the
 * fallback and the page it stands in for wear the same two classes, so the geometry, the
 * shift total and the animation state are the same in both branches. The issue's own
 * measurement of the branch this one could not build — a layout-shift sum of 0 — agrees.
 *
 * **What stays unmeasured, then.** That the fallback specifically, rather than whatever the
 * router has on screen, is what a player looks at during that wait. On the evidence here no
 * player ever does, and `loading.tsx` carries that measurement and what it is still kept for.
 */

/**
 * The duration token the entry animation is timed by, stretched so the press below lands
 * unambiguously *during* the animation rather than after it.
 *
 * Overriding the token rather than the rule is the point: `apps/web/src/styles/motion.test.ts`
 * fails any timed declaration that is not reaching for one of these, so this pulls the same
 * lever the reduced-motion preference pulls, and it cannot go stale against a rule it does
 * not name.
 */
const STRETCH = ':root { --db-duration-fast: 5s; }';

test('a control on the arriving page can be pressed while the page is still fading in', async ({
  page,
}) => {
  // Stated rather than assumed. With the preference set the token collapses to a
  // millisecond, there is no animation left to press through, and this test would pass
  // having measured nothing at all.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  // A style element survives a client navigation, because a client navigation never
  // replaces the document — which is also why the animation is worth having.
  await page.addStyleTag({ content: STRETCH });

  await page.getByRole('link', { name: 'Start playing' }).click();
  // The catalogue's own "Surprise me", inside the main landmark, and the scope is the whole
  // test rather than tidiness. There are two controls with that name on this page: the
  // header's, which belongs to the layout the router keeps mounted across a navigation and
  // therefore never fades, and the catalogue's, which is part of the page that just arrived.
  // Unscoped, the locator matched whichever had rendered — the header's while the catalogue
  // was still coming, and both once it had, which is a strict-mode failure. So the test was
  // racy, and on the runs it passed it had pressed the one control on screen that this issue
  // has nothing to say about. Waiting for the scoped one is also what makes the assertion
  // below land after the arriving page exists rather than before it.
  const surprise = page.locator('#main').getByRole('button', { name: 'Surprise me' });
  await surprise.waitFor();

  const animating = await page.evaluate(() =>
    [...(document.querySelector('main')?.children ?? [])].some((arriving) =>
      arriving.getAnimations().some((animation) => animation.playState === 'running'),
    ),
  );
  expect(animating, 'the animation had finished before the press, so nothing was proved').toBe(
    true,
  );

  // No wait of any kind between the page arriving and the press, and Playwright's own
  // actionability checks are half the assertion: it refuses to click an element whose box
  // is still moving, so a transition that slid or scaled the page in would sit here for the
  // whole five seconds and time out. The other half is the hit test, which an overlay or a
  // `pointer-events: none` fails.
  await surprise.click({ timeout: 2_000 });
  await expect(page).toHaveURL(/\/play\/[a-z0-9-]+\/$/);
});

/**
 * Long enough that each phase of the arrival is on screen to be looked at, short enough to
 * be free. Three of them are spent per navigation and they are strictly sequential, because
 * each request names the next: the route's payload, then the four chunks the payload names,
 * then the game's own chunk that `PlaySurface` asks for once it has mounted. About two and a
 * half seconds from the press to the lobby, measured.
 */
/**
 * No service worker in this file, and it is the difference between a test and a coin toss.
 *
 * Every test below models latency by holding requests in `page.route`. A registered service
 * worker answers a navigation and its chunks from its own cache without a network request at
 * all, so the hold never applies and the arrival this spec is written to observe is over
 * before the first assertion looks at it — which is exactly how it failed the moment the
 * worker (#192, #2546) landed on main: the panel read the whole lobby where `/^Loading/` was
 * expected. Blocking it is not avoiding the interaction, it is removing a second mechanism
 * from a measurement of the first; `e2e/offline.spec.ts` is where the worker's own behaviour
 * is tested, with the network really gone rather than merely slowed.
 */
test.use({ serviceWorkers: 'block' });

const HOLD_MS = 800;

/**
 * The router's request for a play route's payload, which is the first observable
 * consequence of a press that reached a hydrated button.
 *
 * There is exactly one on these tests' path. They start on `/settings/`, a leaf route with
 * no game link anywhere on it, so nothing has prefetched a play route and the only payload
 * under `/play/` any of them fetches is the one the press asked for. That is also the
 * navigation `play/[slug]/loading.tsx` exists for.
 */
const PLAY_PAYLOAD = /\/play\/[a-z0-9-]+\/index\.txt/;

/**
 * Holds every request for {@link HOLD_MS}, and hands back the switch that stops holding.
 *
 * The handler is switched off with a flag rather than removed. `unroute` settles the
 * requests a handler is still sleeping on, and the sleeper then wakes to a route somebody
 * else has already answered — which fails the test for a reason that has nothing to do with
 * the product.
 *
 * A local server answers fast enough that every phase of the arrival would otherwise be over
 * within a frame or two of the press, so the swap these tests are about would have happened
 * before the first assertion could look at it. Flat latency rather than a bandwidth model:
 * #2539 tried modelling bandwidth and recorded it as worse.
 */
async function holdEveryRequest(page: Page): Promise<() => void> {
  let holding = true;
  await page.route('**/*', async (route) => {
    if (holding) await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    await route.continue();
  });
  return () => {
    holding = false;
  };
}

/**
 * Presses the header's "Surprise me" until the router actually starts fetching a play route.
 *
 * The retry is not defensiveness: a statically exported page is on screen before it is
 * interactive, `QuickPlay` is a client component, and a press that lands before it has
 * hydrated does nothing whatsoever — no error, no navigation, a test that then waits out its
 * timeout for an arrival nothing asked for.
 *
 * What it is guarded on is the correction #2539 asked for. It used to retry while the
 * *address* was unchanged, and the address cannot change until the router commits, which
 * under a held network is about 1.7 seconds after the press — so the guard was still true
 * when the second attempt came round at one second and the button was pressed **twice**. The
 * second press picks a fresh game, so the navigation actually being measured was one whose
 * chunks the first press had already fetched. The payload request is the honest signal: a
 * press that worked produces one within milliseconds, a press that landed before hydration
 * produces none at all, and there is no window in between for the two to be confused.
 * Measured after the change: one press, every run, on both builds.
 *
 * The header's control and not the catalogue's, scoped to the banner rather than left to be
 * the only match: it is the control that decides where it is going at the moment it is
 * pressed, which is why nothing can have prefetched the route.
 */
async function pressSurpriseMe(page: Page): Promise<void> {
  await expect(async () => {
    const asked = page.waitForRequest(PLAY_PAYLOAD, { timeout: 2_000 }).catch(() => null);
    await page.getByRole('banner').getByRole('button', { name: 'Surprise me' }).click();
    expect(await asked, 'the press landed before the button had hydrated').not.toBeNull();
  }).toPass({ timeout: 15_000 });
  await page.waitForURL(/\/play\/[a-z0-9-]+\/$/, { timeout: 15_000 });
}

/** Whether any child of the main landmark is part-way through the entry animation. */
async function entryAnimationRunning(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...(document.querySelector('main')?.children ?? [])].some((child) =>
      child.getAnimations().some((animation) => animation.playState === 'running'),
    ),
  );
}

/** A rounded rectangle, or nulls for an element the stylesheet has stood down. */
type Box = readonly [number, number, number, number];

/**
 * Where the furniture is: the boxes of the three things a swap inside the page could push
 * around, plus the top-left corner of the panel the swap happens in.
 *
 * The panel's *height* is left out on purpose and it is the only thing that legitimately
 * changes — one line becomes a lobby with a heading and two buttons, 119px becoming 576px.
 * It is anchored to the top of the main landmark and grows downward into height the shell
 * had already reserved, so its corner stays where it was and nothing around it moves. That
 * is the whole of what #93 asks for on this route, and it is the assertion that can fail:
 * `db-fill` and the `:has(.db-fill)` rules beside it are what fix the shell's height and
 * stand the footer down, and a build with that class dropped from the play route moves the
 * footer 154px, grows `main` by the same, and fails here four times out of four.
 */
async function shellFrame(page: Page): Promise<Record<string, Box | null>> {
  return page.evaluate(() => {
    const box = (selector: string): readonly [number, number, number, number] | null => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      return [
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.width),
        Math.round(rect.height),
      ];
    };
    const panel = box('#main .db-panel');
    return {
      header: box('header'),
      main: box('#main'),
      footer: box('footer'),
      // Corner and width, not height: the panel is what grows.
      panelCorner: panel === null ? null : [panel[0], panel[1], panel[2], 0],
    };
  });
}

test('a play route arrives without moving anything already on screen', async ({ page }) => {
  // #93's acceptance criterion, executed rather than argued, on the swap that this route
  // actually performs: the game's own loading panel becoming the lobby.
  //
  // Every layout-shift entry is counted, including the ones the published metric excuses
  // because they fall within half a second of a press. That is deliberate and it is the only
  // way the number means anything here: the swap under test always follows a press, so
  // scoring it the way a field measurement does would score it zero by definition.
  await page.goto('/settings/');
  await page.evaluate(() => {
    const shifts = { total: 0 };
    (globalThis as unknown as { dbShifts: { total: number } }).dbShifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        shifts.total += (entry as unknown as { value: number }).value;
      }
    }).observe({ type: 'layout-shift' });
  });

  const release = await holdEveryRequest(page);
  await pressSurpriseMe(page);

  // Half a hold after the press the route has been asked for and cannot have arrived. What
  // is on screen is either the page the press started from or the loading fallback — which
  // of the two is the build-dependent thing #2539 is about, and neither this nor anything
  // below depends on the answer. That the landmark is never *empty* holds either way, and it
  // is the property a player would notice going wrong.
  await page.waitForTimeout(HOLD_MS / 2);
  await expect(page.locator('#main')).not.toBeEmpty();

  // The panel mid-arrival: `PlaySurface` fetches the game's chunk from an effect after it
  // mounts, so this is its own one-line panel, named for the game. The fallback's line, on a
  // build that shows one, is the same shape in the same class and matches the same pattern.
  const panel = page.locator('#main .db-panel').first();
  await expect(panel).toHaveText(/^Loading/);
  const before = await shellFrame(page);

  await expect(page.getByRole('button', { name: 'Play together here' })).toBeVisible();
  const after = await shellFrame(page);
  release();

  expect(after, 'the lobby moved the shell around the panel it grew into').toEqual(before);

  const shifted = await page.evaluate(
    () => (globalThis as unknown as { dbShifts: { total: number } }).dbShifts.total,
  );
  // #93's threshold, in its own words. It is kept for that and it is not the guard: measured
  // at 0 on both builds, and the sabotage that breaks the geometry above — dropping
  // `db-fill` from the arriving page — reads 0.0282, which is under this line. A number
  // nothing has been made to cross is not a check, so the assertion above it is the one that
  // fails when this route stops reserving its own height.
  expect(shifted, 'the panel grew into height the shell had already reserved').toBeLessThan(0.1);
});

test('a play route arrives with no entry animation, so nothing can fade in twice', async ({
  page,
}) => {
  // `.db-main > *:not(.db-fill)` in `globals.css` excuses this route from the entry
  // animation, and the excuse is load-bearing rather than a taste call: React never reuses a
  // node across the swap from a Suspense fallback to the children it was standing in for, so
  // on a build that shows the fallback two elements arrive in one navigation, both freshly
  // mounted children of `<main>`, and an animation matching both ran twice — the centred
  // panel faded in, dropped back to transparent when the payload landed, and faded in again.
  // Both roots wear `db-fill`, so excusing that class excuses exactly the pair. Asserting the
  // excuse holds is what this can do on every build; counting the fades is what it cannot.
  //
  // Watched failing on purpose rather than believed: served a build with `:not(.db-fill)`
  // taken out of that one rule, this goes red twice out of two and the test above it stays
  // green, which is the right pair of answers — the rule changes what fades, not what moves.
  //
  // The token is stretched for the reason the first test in this file stretches it: at the
  // real 120ms an animation that did run would very likely be over before either check, and
  // a test that cannot fail is not a test. That first test is also the control — it asserts a
  // fade *is* running, on a route that is not the play route, with this same lever pulled.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/settings/');
  await page.addStyleTag({ content: STRETCH });

  const release = await holdEveryRequest(page);
  await pressSurpriseMe(page);

  expect(await entryAnimationRunning(page), 'the play route fades in').toBe(false);

  await expect(page.getByRole('button', { name: 'Play together here' })).toBeVisible();
  release();
  expect(
    await entryAnimationRunning(page),
    'the lobby fades in from transparent over the panel it replaced',
  ).toBe(false);
});
