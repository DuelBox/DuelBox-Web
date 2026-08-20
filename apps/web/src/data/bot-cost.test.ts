import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { LOADERS_FOR_TEST } from './registry';

/**
 * No bot may bring the frame rate down on its own.
 *
 * A searching bot does all its work in the single frame its think-timer expires, and that
 * frame used to be enormous. Measured with the hardest tier before this was addressed:
 * Reversi 31.5 ms, Ultimate Tic Tac Toe 27.4 ms, Drop Four 12.2 ms — against a 60 Hz frame
 * of 16.7 ms, on a development machine. A phone is several times slower again.
 *
 * The real fix is the deterministic node budget in `@duelbox/game-sdk`; its own unit tests
 * prove the mechanism. **This is the check that it is wired in.**
 *
 * A clock is the wrong way to *limit* a search — it would make the depth reached depend on
 * how fast the device is, and rule 8 says a phone and a laptop must step the identical
 * match. It is the right way to notice one has got out of hand — but only if the ceiling
 * knows how fast the machine is.
 *
 * The first version did not, and failed on CI at 45 ms against a 22 ms ceiling while
 * costing 9.7 ms locally. CI is roughly four to five times slower than a development
 * machine, which is precisely the objection to clocks, aimed back at the test that made it.
 *
 * So the ceiling is **calibrated**: a fixed synthetic workload is timed at the start of the
 * run and the allowance scaled by how long it took. A slow runner gets a proportionally
 * larger budget, and the thing this exists to catch — a search with no ceiling, four to
 * five times over — is still caught anywhere.
 *
 * And it counts **how many** steps go over rather than looking at the single worst one. A
 * lone step can be a garbage collection or a scheduler hiccup and says nothing about the
 * code; Hand Slap, whose bot does no searching at all, failed this test once on exactly
 * that. Measured with the budget deliberately put out of reach:
 *
 * | | over budget, healthy | over budget, unbounded |
 * |---|---|---|
 * | Reversi | 0 | 20 |
 * | Ultimate Tic Tac Toe | 0 | 4 |
 * | Drop Four | 0 | 4 |
 * | Hand Slap | 0 | 0 |
 *
 * Zero against four is a clean signal, so two is allowed.
 */

const STEP = 1 / 60;
const STEPS = 60 * 180;

/**
 * A fixed lump of arithmetic, timed to find out how fast this machine is.
 *
 * Three million square roots takes about 17.5 ms on the development machine these numbers
 * were taken on. Anything slower scales the allowance up in proportion.
 */
function calibrationMs(): number {
  const started = performance.now();
  let acc = 0;
  for (let i = 1; i <= 3_000_000; i += 1) acc += Math.sqrt(i) % 7;
  if (acc < 0) throw new Error('unreachable');
  return performance.now() - started;
}

const REFERENCE_CALIBRATION_MS = 17.5;
/** Generous on purpose: the worst game costs about 10 ms on the reference machine. */
const REFERENCE_CEILING_MS = 22;
/** Steps allowed to exceed it, so one hiccup is not a failure. */
const ALLOWED_SPIKES = 2;

// Timed once for the whole file. Floored at 1 so a suspiciously fast reading cannot make
// the ceiling smaller than it was measured against.
const machine = Math.max(1, calibrationMs() / REFERENCE_CALIBRATION_MS);
const CEILING_MS = REFERENCE_CEILING_MS * machine;

describe('no bot stalls a frame', () => {
  const entries = Object.entries(LOADERS_FOR_TEST);

  it.each(entries)('%s thinks inside a frame, hardest tier', async (slug, load) => {
    const loaded = await load();
    const game = loaded.create();
    const context: GameContext = {
      manifest: loaded.manifest,
      rng: new Rng(20260820),
      presentation: 'shared-screen',
      localSeat: 'p1',
      botDifficulty: () => 'hard',
    };
    game.init(context);
    const input = new InputManager(
      { width: 1000, height: 1000 },
      { split: 'horizontal', bottomSeat: 'p1' },
    );
    const view = new InputView();

    let worst = 0;
    let over = 0;
    try {
      for (let i = 0; i < STEPS; i += 1) {
        const state = view.sync(input.beginStep(STEP));
        const started = performance.now();
        game.update(STEP, state);
        const spent = performance.now() - started;
        worst = Math.max(worst, spent);
        if (spent > CEILING_MS) over += 1;
        if (game.getScore().winner !== null) break;
      }
    } finally {
      game.destroy();
    }

    expect(
      over,
      `${slug}'s hardest bot went over ${CEILING_MS.toFixed(0)}ms on ${String(over)} steps ` +
        `(worst ${worst.toFixed(1)}ms) on a machine ${machine.toFixed(1)}× the reference — ` +
        'see the note at the top of this file',
    ).toBeLessThanOrEqual(ALLOWED_SPIKES);
  });

  it('covers every game, or it is guarding nothing', () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it('scales its ceiling to the machine it is running on', () => {
    expect(machine, 'never tighter than the reference').toBeGreaterThanOrEqual(1);
    expect(CEILING_MS).toBeGreaterThanOrEqual(REFERENCE_CEILING_MS);
  });
});
