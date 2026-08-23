import { describe, expect, it } from 'vitest';
import { LOADERS_FOR_TEST } from './registry';
import { fuzz } from './input-fuzz';

/**
 * Nothing a person can do to the screen may throw.
 *
 * Two children mashing a shared phone is the real input pattern for this product, and it is
 * the one pattern no other test here produces: everything else drives a game with a bot, a
 * script, or a tidy trace. This drives it with garbage — unmatched key-ups, six fingers,
 * pointers off the edge of the board, the split changing mid-match, pause and resume at
 * random, a match torn down and stood back up while the storm continues.
 *
 * Four simulated minutes per game on every run, which is the whole catalogue in five seconds.
 * `pnpm fuzz:soak` is the *same* storm at sixty — a real soak rather than a second program
 * that drifts away from this one.
 */

/**
 * How long to storm each game, in simulated minutes.
 *
 * Four by default. One was not enough: Checkers and Shut the Box need a *legal* move before
 * anything about them changes, and a random storm takes several minutes to stumble on one in
 * those two — they showed nothing at all in sixty seconds and responded happily in fifteen
 * minutes. Naming them as exceptions would have been a suppression list that rots; giving the
 * storm long enough to reach every game is the same test with an honest budget, and it still
 * runs the fifty in five seconds.
 */
const MINUTES = Number(process.env.DUELBOX_FUZZ_MINUTES ?? 4);
const STEPS = Math.round(60 * 60 * MINUTES);

describe('a storm of input', () => {
  const entries = Object.entries(LOADERS_FOR_TEST);

  it.each(entries)('%s survives two children mashing the screen', async (slug, load) => {
    const loaded = await load();
    // Not wrapped in expect().not.toThrow(): an exception should arrive with its own stack,
    // pointing at the line in the game that threw, rather than as a matcher's summary.
    const report = fuzz(() => loaded.create(), loaded.manifest, 20260823, STEPS);

    expect(report.steps).toBe(STEPS);
    // The storm has to actually reach the game, or this asserts nothing at all. Every game
    // either finished a match or moved its score inside the minute.
    expect(
      report.finished + report.progress,
      `${slug} never responded to any of ${STEPS} frames of input`,
    ).toBeGreaterThan(0);
  });
});
