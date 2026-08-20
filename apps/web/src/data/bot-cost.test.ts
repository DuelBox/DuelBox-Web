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
 * prove the mechanism. **This is the check that it is wired in** — a smoke ceiling rather
 * than a budget, set well above what any game costs now and well below where they were, so
 * it catches a bot going unbounded again without flaking on a slow CI runner.
 *
 * A clock is the wrong way to *limit* a search — it would make the depth reached depend on
 * how fast the device is, and rule 8 says a phone and a laptop must step the identical
 * match. It is the right way to notice one has got out of hand.
 */

const STEP = 1 / 60;
/** Generous on purpose: the worst game costs about 10 ms here and used to cost 31. */
const CEILING_MS = 22;
const STEPS = 60 * 180;

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
    try {
      for (let i = 0; i < STEPS; i += 1) {
        const state = view.sync(input.beginStep(STEP));
        const started = performance.now();
        game.update(STEP, state);
        worst = Math.max(worst, performance.now() - started);
        if (game.getScore().winner !== null) break;
      }
    } finally {
      game.destroy();
    }

    expect(
      worst,
      `${slug}'s hardest bot spent ${worst.toFixed(1)}ms on one step — see the note at the top of this file`,
    ).toBeLessThan(CEILING_MS);
  });

  it('covers every game, or it is guarding nothing', () => {
    expect(entries.length).toBeGreaterThan(20);
  });
});
