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

/** Long enough that the fallback is on screen to be looked at, short enough to be free. */
const HOLD_MS = 800;

/**
 * Presses "Surprise me" and waits until the play route's own loading fallback is on screen.
 *
 * Two things are arranged rather than hoped for. The press starts on `/settings/`, a leaf
 * route with no game link anywhere on it, so nothing about the route the button picks has
 * been prefetched — that is the navigation `play/[slug]/loading.tsx` exists for. And every
 * request the navigation makes is held for a moment, because a local server answers fast
 * enough that the fallback would otherwise never paint and the two tests below would be
 * measuring a swap that never happened.
 */
async function pressSurpriseAndWaitForTheSkeleton(page: Page): Promise<void> {
  // The handler is switched off with a flag rather than removed. `unroute` settles the
  // requests a handler is still sleeping on, and the sleeper then wakes to a route somebody
  // else has already answered — which fails the test for a reason that has nothing to do
  // with the product.
  let holding = true;
  await page.route('**/*', async (route) => {
    if (holding) await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    await route.continue();
  });

  // The press is retried until the router actually moves, and that is not defensiveness: a
  // statically exported page is on screen before it is interactive, `QuickPlay` is a client
  // component, and a press that lands before it has hydrated does nothing whatsoever — no
  // error, no navigation, a test that then waits five seconds for a fallback that was never
  // asked for. Guarded on the route still being the one we started from, so a press that did
  // work is never followed by a second one that would open a different game.
  const start = new URL(page.url()).pathname;
  await expect(async () => {
    if (new URL(page.url()).pathname === start) {
      // The header's, scoped to the banner rather than left to be the only match: it is the
      // control that decides where it is going at the moment it is pressed, which is why
      // nothing can have prefetched the route. The catalogue carries a second by that name.
      await page.getByRole('banner').getByRole('button', { name: 'Surprise me' }).click();
    }
    await page.waitForURL(/\/play\/[a-z0-9-]+\/$/, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  // The fallback's own line and nothing else's: what replaces it names the game.
  await expect(page.getByText('Loading…', { exact: true })).toBeVisible();
  holding = false;
}

/** Whether any child of the main landmark is part-way through the entry animation. */
async function entryAnimationRunning(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...(document.querySelector('main')?.children ?? [])].some((child) =>
      child.getAnimations().some((animation) => animation.playState === 'running'),
    ),
  );
}

/**
 * NONDETERMINISTIC, AND PARKED RATHER THAN LEFT TO FLAKE.
 *
 * The two tests below both wait for `loading.tsx`'s fallback to paint, and whether it
 * paints at all is decided by the BUILD rather than by anything in this file. Measured:
 * rebuilding the identical tree flips the result — six failures out of six from one
 * build, three passes out of three from the next, with `app-build-manifest.json`
 * byte-identical for the play route except the webpack runtime chunk's content hash. A
 * clean `rm -rf .next` does not settle it either, and adding three lines nothing calls was
 * enough to move it.
 *
 * The mechanism: the fixture holds every request, and inside that window Next's router
 * either commits the fallback (~1755 ms, then the page at ~2085 ms) or waits for the play
 * route's chunks and goes straight to the lobby. When it waits, there is no fallback to
 * see and the assertion times out.
 *
 * Two repairs were written and both rejected, which is why this is a `fixme` rather than a
 * patch. Retrying on the payload request instead of the address stops the press being
 * doubled — and then the router waits for the chunks every time, so the fallback never
 * paints and the test fails deterministically instead of intermittently. Modelling
 * bandwidth rather than flat latency made it worse.
 *
 * A flaky guard is worse than an absent one: it teaches whoever sees it red to press
 * re-run, which is the habit CLAUDE.md spends a page warning about. So the coverage is
 * declared missing, loudly, instead of being asserted unreliably. #2539 carries the work.
 *
 * The first test in this file is NOT parked: it never waits for the fallback, it is what
 * #94's acceptance actually asks ("never delay interactivity"), and it passed every one of
 * the eight builds this was measured across.
 */
test.fixme('the skeleton swaps for the page without moving the layout under it', async ({
  page,
}) => {
  // #93's acceptance criterion, executed rather than argued.
  //
  // Every entry is counted, including the ones the published metric excuses because they
  // fall within half a second of a press. That is deliberate and it is the only way this
  // number means anything here: the swap under test always follows a press, so scoring it
  // the way a field measurement does would score it zero by definition and pass on a
  // fallback shaped nothing like the panel it becomes.
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

  await pressSurpriseAndWaitForTheSkeleton(page);
  // The whole swap: fallback, then the route's own payload, then the lobby it settles on.
  await expect(page.getByRole('button', { name: 'Play together here' })).toBeVisible();

  const shifted = await page.evaluate(
    () => (globalThis as unknown as { dbShifts: { total: number } }).dbShifts.total,
  );
  expect(shifted, 'the fallback is the panel it becomes, so nothing moves').toBeLessThan(0.1);
});

test.fixme('the play route arrives once rather than fading in twice', async ({ page }) => {
  // The fallback and the page are both direct children of `<main>`, and React mounts the
  // second as a fresh node rather than reusing the first — so an entry animation that
  // matched them both ran twice, and the player saw the centred panel fade in, drop back to
  // transparent when the payload landed, and fade in again. `:not(.db-fill)` in `globals.css`
  // excuses exactly that pair.
  //
  // The token is stretched for the reason the first test in this file stretches it: at the
  // real 120ms an animation that did run would very likely be over before either check, and
  // a test that cannot fail is not a test. That first test is also the control — it asserts
  // a fade *is* running, on a route that is not the play route.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/settings/');
  await page.addStyleTag({ content: STRETCH });

  await pressSurpriseAndWaitForTheSkeleton(page);
  expect(await entryAnimationRunning(page), 'the fallback fades in').toBe(false);

  await expect(page.getByRole('button', { name: 'Play together here' })).toBeVisible();
  expect(
    await entryAnimationRunning(page),
    'the page fades in from transparent over the fallback it replaced',
  ).toBe(false);
});
