import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { Game, GameContext } from '@duelbox/game-sdk';
import { LOADERS_FOR_TEST } from './registry';

/**
 * Every game must be able to end.
 *
 * This is the one property nothing else here checks, and it has now been broken twice by
 * two unrelated games. A survival mode ran for ever because nothing could kill the last
 * player standing. A frame of Pool ran for ever because the table reached a position
 * neither side could clear — two `easy` bots played forty frames, finished none of them,
 * and took over a thousand shots each without potting anything.
 *
 * There is no platform-level safety net to fall back on. `roundSeconds` is declared by
 * every manifest and validated by the schema, and the only thing that reads it is the
 * catalogue card that prints "about 5 min". It ends nothing. Each game has to guarantee
 * its own termination — Mini Soccer by a clock, Dice Yatzy by a fixed thirteen turns, Pool
 * by a stalemate rule — and this is what checks that each of them actually did.
 *
 * Bot against bot, because a bot plays on: a human trace that stops pressing keys proves
 * nothing about a game that needs input to progress.
 */

const STEP = 1 / 60;
/** Ten minutes of simulated play. Anything slower than this is broken, not slow. */
const MAX_STEPS = 60 * 600;

/** Never touches the game; bots drive both seats. */
function idleInput(): InputManager {
  return new InputManager({ width: 1000, height: 1000 }, { split: 'horizontal', bottomSeat: 'p1' });
}

function runToDecision(create: () => Game, context: GameContext): number {
  const game = create();
  game.init(context);
  const input = idleInput();
  const view = new InputView();

  try {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      if (game.getScore().winner !== null) return step;
    }
    return -1;
  } finally {
    game.destroy();
  }
}

describe('every playable game', () => {
  const entries = Object.entries(LOADERS_FOR_TEST);

  it.each(entries)('%s reaches a decision when two bots play it', async (slug, load) => {
    const loaded = await load();
    const context: GameContext = {
      manifest: loaded.manifest,
      rng: new Rng(20260820),
      presentation: 'shared-screen',
      localSeat: 'p1',
      openingSeat: 'p1',
      // Both on `easy`, deliberately. The weakest play is the most likely to reach a
      // position nothing can resolve, and it is the pairing that exposed Pool: `hard`
      // against `easy` finished that frame by potting the black and would have passed
      // this test with the stalemate rule deleted.
      botDifficulty: () => 'easy',
    };

    const steps = runToDecision(() => loaded.create(), context);
    expect(
      steps,
      `${slug} did not finish in ten minutes of simulated play — see the note at the top of this file`,
    ).toBeGreaterThanOrEqual(0);
  });

  it('covers every game, or it is guarding nothing', () => {
    expect(entries.length).toBeGreaterThan(20);
  });
});
