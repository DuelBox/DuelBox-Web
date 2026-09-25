import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { seatForPoint, zoneSplitFor } from '@duelbox/engine';
import type { DeclaredZoneSplit, Presentation, SeatId, ZoneSplit } from '@duelbox/engine';
import { LOADERS_FOR_TEST } from './registry';
import { fuzz, splitFor } from './input-fuzz';

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


/**
 * The rule, written out longhand and on purpose.
 *
 * This deliberately does not call `zoneSplitFor`. If it did, the test below would compare the
 * implementation with itself and pass whatever the implementation became — which is the exact
 * failure mode that let #2479 live: two derivations, each locally reasonable, each covered by
 * a test that only ever asked it to agree with itself.
 */
function expectedSplit(
  presentation: Presentation,
  declared: DeclaredZoneSplit,
  activeSeat: SeatId | null,
): ZoneSplit {
  if (presentation === 'single-seat') return 'shared';
  if (activeSeat === 'p1' || activeSeat === 'p2') return 'shared';
  if (declared === 'vertical') return 'vertical';
  return 'horizontal';
}

/**
 * The shell and the fuzzer must divide the pointer surface identically.
 *
 * They did not (#2479). `GameHost` derived the split from the game's live `getActiveSeat`, so
 * a real-time game — which returns null by contract — always got `'horizontal'` and could
 * never reach `'shared'`. The fuzzer derived it straight from `manifest.zoneSplit` and read
 * `'shared-board'` as `'shared'`. Eleven real-time games declare `'shared-board'`, and
 * `seatForPoint` answers `'shared'` by giving the **entire** surface to one seat — so for
 * Whack a Mole, Snake Clash, Sumo and eight others the fuzzer sent every one of its six
 * fingers to seat one and none at all to seat two. The harness whose whole purpose is two
 * children mashing a shared screen was, for those eleven, modelling one child.
 *
 * That is not a mismatched configuration, it is the guard quietly not testing the thing it
 * exists to test, and no test could catch it while the answer lived in two places. It lives
 * in one now — `zoneSplitFor`, in the engine — and this is the test that could not have been
 * written before.
 */
describe('the shell and the fuzzer divide the surface the same way', () => {
  it('agree for every game in the registry, on the live turn state', async () => {
    const disagreed: string[] = [];
    const sharedBoardRealTime: string[] = [];
    let checked = 0;

    for (const [slug, load] of Object.entries(LOADERS_FOR_TEST)) {
      const loaded = await load();
      const { manifest } = loaded;
      const game = loaded.create();
      // The same question both callers ask, at the same moment: whose turn is it right now.
      const seat = game.getActiveSeat?.() ?? null;

      const fuzzer = splitFor(manifest, seat);
      // The call `GameHost` makes, spelled out. It cannot be imported here — it lives in a
      // `.tsx` module the node test environment will not transform — so the delegation itself
      // is pinned by the next test in this block.
      const shell = zoneSplitFor('shared-screen', manifest.zoneSplit, seat);
      const wanted = expectedSplit('shared-screen', manifest.zoneSplit, seat);

      if (fuzzer !== shell || fuzzer !== wanted) {
        disagreed.push(`${slug}: fuzzer ${fuzzer}, shell ${shell}, wanted ${wanted}`);
      }
      if (manifest.archetype.startsWith('rt-') && manifest.zoneSplit === 'shared-board') {
        sharedBoardRealTime.push(slug);
        // The regression itself: a real-time seat-two must still own half the surface.
        const far = seatForPoint(
          manifest.logical.width / 2,
          1,
          manifest.logical,
          fuzzer,
          'p1',
        );
        if (far !== 'p2') disagreed.push(`${slug}: seat two owns nothing (${fuzzer})`);
      }
      checked += 1;
    }

    expect(checked, 'this test found no games at all, so it is guarding nothing').toBeGreaterThan(
      50,
    );
    expect(
      sharedBoardRealTime.length,
      'no real-time game declares shared-board any more, so the case #2479 was about is gone',
    ).toBeGreaterThanOrEqual(11);
    expect(disagreed, `the two disagree: ${disagreed.join('; ')}`).toEqual([]);
  });

  /**
   * The shell's half of the agreement, pinned at the source.
   *
   * `GameHost.tsx` is JSX, and this suite runs in a node environment that does not transform
   * it, so the delegation is checked by reading it rather than by calling it. What matters is
   * that the shell owns no second copy of the rule — a re-inlined ternary here is precisely
   * how the two answers drifted apart the first time.
   */
  it('leaves the shell with no derivation of its own', () => {
    const source = readFileSync(new URL('../components/GameHost.tsx', import.meta.url), 'utf8');

    expect(source).toContain('zoneSplitFor');
    expect(source).toContain('return zoneSplitFor(presentation, manifest.zoneSplit, activeSeat);');
    // The two shapes the old copies had. Neither may come back.
    expect(source).not.toContain("=== 'vertical' ? 'vertical' : 'horizontal'");
    expect(source).not.toMatch(/manifest\.zoneSplit === '/);
  });

  /**
   * Single-seat, directly. The local player owns the whole viewport — `docs/presentation.md`,
   * "Whole viewport is yours" — and the shell ignored `presentation` entirely, so a real-time
   * game played remotely would have been halved with half the screen dead. Latent only
   * because `PlaySurface` passed `shared-screen`; 74 closed issues were verified against
   * single-seat, so it has to be right rather than merely unreached.
   */
  it('gives a single-seat player the whole viewport, in every game', async () => {
    const halved: string[] = [];

    for (const [slug, load] of Object.entries(LOADERS_FOR_TEST)) {
      const loaded = await load();
      const { manifest } = loaded;
      if (!manifest.presentations.includes('single-seat')) continue;
      const game = loaded.create();
      const seat = game.getActiveSeat?.() ?? null;

      const split = zoneSplitFor('single-seat', manifest.zoneSplit, seat);
      if (split !== 'shared') {
        halved.push(`${slug}: ${split}`);
        continue;
      }
      // Every corner of the board belongs to the one person holding the device.
      const { width, height } = manifest.logical;
      for (const [x, y] of [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
        [width / 2, height / 2],
      ]) {
        if (seatForPoint(x ?? 0, y ?? 0, manifest.logical, split, 'p2') !== 'p2') {
          halved.push(`${slug}: (${String(x)}, ${String(y)}) is not the local seat's`);
        }
      }
    }

    expect(halved, `these are halved in single-seat play: ${halved.join(', ')}`).toEqual([]);
  });
});
