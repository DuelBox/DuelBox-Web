import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';

/**
 * A hundred matches started and quit, and what is left on the heap afterwards (#232).
 *
 * `lifecycle.spec.ts` samples the same thing at fifty cycles on every push and counts
 * listeners rather than bytes, which is the right size and the right instrument for a push
 * gate. This is the deep version: the hundred cycles #232 asks for, and — the part that
 * makes it worth running at all — a second test that installs a deliberate leak and
 * requires the same measurement to catch it. A heap reading is exactly the kind of
 * assertion that can quietly start reporting a constant and pass forever, and six guards in
 * this repository have already turned out to be enforcing nothing. A guard nobody has seen
 * fail is a guard nobody has seen.
 *
 * ## Chromium only, and that is a property of the measurement rather than a shortcut
 *
 * `performance.memory` exists on Chromium alone, is bucketed, and reports whatever has not
 * been swept yet unless the browser was launched with `--expose-gc` — so a number taken
 * from it is noise around a quantity nobody asked for. The honest route is the Chrome
 * DevTools Protocol: `HeapProfiler.collectGarbage` forces a full collection, and
 * `Runtime.getHeapUsage` then reports what is still live. Playwright hands us a CDP session
 * on Chromium and on nothing else, so the two WebKit projects skip rather than fail.
 *
 * The gate below is on `browserName`, which is the true statement about the measurement,
 * and it therefore leaves the `mobile` project in as well — a Pixel 7 is Chromium behind a
 * phone's viewport. That is harmless and the nightly command pins `--project=chromium`
 * regardless, so the number is measured once. A leak is a property of the host's teardown,
 * and the host does not branch on the device (CLAUDE.md rule 10), so a second viewport
 * would be re-measuring the same code.
 *
 * ## Nightly, not on every push, and the honest version of that argument
 *
 * The e2e job was cancelled at its twenty-minute limit and has since been sharded three
 * ways, so a shard is now roughly seven minutes and there is room for what this costs —
 * measured at 25 seconds for both tests on a development machine, which `nightly.yml`'s own
 * notes put at one to two minutes of CI. Room is not a reason to spend it. Three reasons it
 * is spent at 03:15 instead:
 *
 *   - The push gate already measures this at fifty cycles. Doubling the sample on every
 *     push buys a second decimal place on a number that is already being watched.
 *   - The control below doubles the cost again, and the control is the half that cannot be
 *     dropped — without it the soak is a heap reading nobody has seen move.
 *   - A heap comparison on a shared runner is the flakiest assertion in the suite. A flaky
 *     test on the push gate is worse than no test, because it teaches everyone to re-run
 *     the job; a flaky test in a nightly is a number on a report somebody reads.
 *
 * Thirty-five more games are still to come, and `ci.yml` records that raising the e2e limit
 * was the wrong fix twice. So this lives in `nightly.yml` behind `DUELBOX_SOAK=1`, beside
 * the third browser engine and the coverage gate, and the push gate keeps its fifty-cycle
 * sample and loses nothing.
 *
 * The gate is read here rather than expressed as a `testIgnore` in `playwright.config.ts`
 * so that the reason travels with the test rather than sitting two files away from it.
 *
 * ## What the shell actually does, measured, so the number below has a shape
 *
 * Five consecutive blocks of a hundred cycles, each measured after a full collection, grew
 * the heap by 0.71MB, 0.21MB, 0.06MB, 0.011MB and 0.011MB — 1.01MB over five hundred
 * cycles, flattening to about 115 bytes a cycle. That curve is the finding: growth that
 * decays is warm-up (optimised code, inline caches, the singletons a first match builds),
 * and growth that stays flat per cycle is retention. **The shell releases its matches.**
 *
 * It also says what the first hundred cycles cost — 0.71MB, one seventh of the budget — so
 * a run that reports 0.7MB is the expected result and not a near miss.
 */

/** What #232 asks for. */
const CYCLES = 100;

/**
 * Megabytes of growth #232 accepts across those hundred cycles.
 *
 * The same number `lifecycle.spec.ts` holds at fifty, deliberately: a shell that leaks
 * nothing does not care how many cycles it is asked for, and a shell that leaks anything
 * shows twice as much here. Two thresholds that drifted apart would be two answers to one
 * question.
 */
const BUDGET_MB = 5;

/**
 * Cycles run before the baseline reading, so one-time costs are not billed as growth.
 *
 * The first mount pulls the game's own chunk over the wire, builds the audio graph and lets
 * React allocate whatever it allocates once. `lifecycle.spec.ts` warms up with one; three
 * costs about a second and puts the baseline somewhere the first cycle's stragglers cannot
 * move it.
 */
const WARM_UP_CYCLES = 3;

/**
 * Objects the control deliberately retains per mount, on top of the match itself.
 *
 * Ballast, and both halves of why it is needed are measurements rather than taste.
 *
 * The faithful leak — retain the listener and its element, so the closure pins the game, the
 * renderer, the input manager and the loop — was tried first and grew the heap by **1.9MB
 * over a hundred cycles** against 0.7MB for the same hundred retaining nothing: a little
 * over 11kB a match. That is under the 5MB budget, so a shell that retained *every match it
 * had ever run* would pass this test. Worth writing down rather than tuning away: what a
 * 5MB-per-hundred budget catches is a leak that retains something large or something
 * per-frame, not one that retains a small Tic Tac Toe match per match. `lifecycle.spec.ts`
 * counts listeners for that reason and is the sharper instrument for this exact failure.
 *
 * The ballast is objects, and it was a 128kB string first. A hundred of those is 12.5MB
 * deliberately retained, and the measurement did not move: `Runtime.getHeapUsage`'s
 * `usedSize` does not see string character data. Checked directly — 800 strings of 8kB,
 * 6.25MB held on `window`, moved it by 0.22MB, while 800,000 plain objects moved it by
 * 15.25MB, which is the twenty bytes an object costs under pointer compression and is
 * exactly right. Ballast the instrument cannot see would have made the control prove the
 * opposite of what it is for.
 *
 * Eight thousand objects is about 152kB a mount and about 15MB across a hundred — three
 * times the budget, so the control is not itself a coin toss.
 */
const LEAK_OBJECTS_PER_MOUNT = 8000;

const MB = 1024 * 1024;

/**
 * A leak, put there on purpose, so the measurement below has been seen to fail.
 *
 * `pointerdown` on the canvas is the game host's setup effect running, one add per mount —
 * the same signal `lifecycle.spec.ts` counts. Both the listener and the element it was
 * added to are retained, which is what a missed `removeEventListener` does and is what pins
 * the match. The ballast rides along for the reason `LEAK_OBJECTS_PER_MOUNT` gives.
 */
const RETAIN_EVERY_MOUNT = `
  window.__soakRetained = [];
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, ...rest) {
    if (type === 'pointerdown') {
      window.__soakRetained.push({
        listener,
        target: this,
        ballast: Array.from({ length: ${LEAK_OBJECTS_PER_MOUNT} }, (_, i) => ({ i })),
      });
    }
    return add.call(this, type, listener, ...rest);
  };
`;

test.skip(
  ({ browserName }) => browserName !== 'chromium' || process.env.DUELBOX_SOAK !== '1',
  'the soak is Chromium-only and runs nightly; set DUELBOX_SOAK=1 to run it',
);

/**
 * Two hundred mount-unmount cycles across the two tests, each of them three real clicks
 * through the real match flow. A local run is about twelve seconds a test; five minutes is
 * headroom for a shared runner rather than an estimate, and it is deliberately generous
 * because a soak that dies on its timeout reads as an infrastructure flake rather than as
 * the leak it might be — which is the failure mode `ci.yml` has now been bitten by twice.
 */
test.describe.configure({ timeout: 300_000 });

test.describe('a hundred load-unload cycles', () => {
  test('grow the heap by under 5MB', async ({ page }) => {
    const { baselineBytes, grownBytes } = await soak(page);

    // Without this the test compares one reading of a broken measurement to another and
    // passes whatever the shell does — the same trap `lifecycle.spec.ts` guards against by
    // requiring its listener instrumentation to have seen something.
    expect(baselineBytes, 'the heap reading is not a measurement').toBeGreaterThan(0);

    const grownMB = grownBytes / MB;
    expect(grownMB, `heap grew ${grownMB.toFixed(2)}MB over ${CYCLES} cycles`).toBeLessThan(
      BUDGET_MB,
    );
  });

  test('are measured well enough to fail on a leak put there on purpose', async ({ page }) => {
    await page.addInitScript(RETAIN_EVERY_MOUNT);
    const { grownBytes } = await soak(page);

    const grownMB = grownBytes / MB;
    expect(
      grownMB,
      `a match and ${LEAK_OBJECTS_PER_MOUNT} objects retained per mount across ${CYCLES} cycles ` +
        `measured as ${grownMB.toFixed(2)}MB, which the budget above would not have caught`,
    ).toBeGreaterThan(BUDGET_MB);
  });
});

/**
 * Load the play route, settle it, then measure the live heap either side of `CYCLES`
 * mount-unmount cycles.
 *
 * Tic Tac Toe for the same reason `lifecycle.spec.ts` uses it: it is the cheapest game to
 * start and quit, so the cycle count measures the host rather than the game. What is being
 * asked is whether the *shell* releases a match, and every game is mounted by the same
 * host through the same effect.
 */
async function soak(page: Page): Promise<{ baselineBytes: number; grownBytes: number }> {
  await page.goto('/play/tic-tac-toe/');
  await page.getByRole('button', { name: 'Play together here' }).waitFor();
  const session = await page.context().newCDPSession(page);

  for (let i = 0; i < WARM_UP_CYCLES; i += 1) await cycle(page);
  const baselineBytes = await heapBytes(session);

  for (let i = 0; i < CYCLES; i += 1) await cycle(page);
  const afterBytes = await heapBytes(session);

  const grownBytes = afterBytes - baselineBytes;
  // Printed whether the assertion holds or not. On a morning this goes red the number that
  // moved is the finding; on the mornings it stays green the same number is the evidence
  // that it did, and a threshold with no measurement behind it is how a guard stops being
  // one.
  console.log(
    `soak: ${CYCLES} cycles, ${(baselineBytes / MB).toFixed(2)}MB -> ${(afterBytes / MB).toFixed(2)}MB, ` +
      `${(grownBytes / MB).toFixed(2)}MB grown, ${Math.round(grownBytes / CYCLES)}B per cycle`,
  );

  return { baselineBytes, grownBytes };
}

/** The live heap, in bytes, with everything unreachable already swept. */
async function heapBytes(session: CDPSession): Promise<number> {
  // Twice, because one full collection can leave behind objects that only became
  // unreachable during it — a finaliser, a weak reference cleared on the first pass. What
  // is wanted is the retained set, and the second pass is cheap next to a hundred cycles.
  await session.send('HeapProfiler.collectGarbage');
  await session.send('HeapProfiler.collectGarbage');
  const { usedSize } = await session.send('Runtime.getHeapUsage');
  return usedSize;
}

/**
 * Mount a game, then unmount it: start a match, pause, quit.
 *
 * The quit path is what makes this a real unmount. `PlaySurface` clears the mode on quit,
 * which returns the route to its lobby, and the lobby renders no `GameHost` at all — so the
 * host's setup effect runs its cleanup and the canvas, the listeners, the loop and the game
 * all go. Nothing short of quitting unmounts it: pausing only stops the run loop.
 *
 * The same three clicks as `lifecycle.spec.ts`, duplicated rather than shared. Extracting
 * them would mean editing that spec, and three lines of a public flow is a cheaper thing to
 * have twice than a helper module is to have at all.
 */
async function cycle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play together here' }).click();
  await page.getByRole('button', { name: 'Pause the match' }).click();
  await page.getByRole('button', { name: 'Quit match' }).click();
}
