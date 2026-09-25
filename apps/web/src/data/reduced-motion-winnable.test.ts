import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { Game, GameContext } from '@duelbox/game-sdk';
import { LOADERS_FOR_TEST } from './registry';

/**
 * Every game stays winnable with motion disabled, verified per game (#175).
 *
 * Reduced motion reaches a game through exactly two channels, and neither may touch the
 * simulation: the renderer snaps the seat-flip to a whole turn (`Canvas2DRenderer.
 * setReducedMotion`, which covers all forty-five flip-owning games), and `GameContext.
 * reducedMotion` is handed to the game as a *render* hint. A game that branched its
 * `update()` on that flag would make motion-off a different match — slower, unwinnable, or
 * simply divergent — and nothing else in the suite would catch it, because the shell's
 * `motion.test.ts` only proves the cascade lever is wired and the e2e spec only proves one
 * game still draws.
 *
 * So this runs each game twice, bot against bot from the same seed, once with
 * `reducedMotion` off and once on, and requires the two to step the identical match: the
 * same score after every step and the same winner at the end. Identical trajectories prove
 * the flag never reached the simulation, which is the whole of "winnable with motion
 * disabled" — a game that finishes for one value of the flag finishes for the other, in the
 * same place, for the same reason. `termination.test.ts` is what proves a game finishes at
 * all; this proves motion has nothing to do with whether it does.
 *
 * Bot against bot, and both on `easy`, for the same reasons `termination.test.ts` gives:
 * a bot plays on where a human trace would stop, and the weakest pairing reaches the
 * positions a stronger one papers over.
 */

const STEP = 1 / 60;
/** Long enough for any game to decide; `termination.test.ts` owns the ten-minute ceiling. */
const MAX_STEPS = 60 * 600;
const SEED = 20260907;

/** Never touches the game; the game's own bots drive both seats. */
function idleInput(): InputManager {
  return new InputManager({ width: 1000, height: 1000 }, { split: 'horizontal', bottomSeat: 'p1' });
}

function contextFor(
  manifest: GameContext['manifest'],
  reducedMotion: boolean,
): GameContext {
  return {
    manifest,
    rng: new Rng(SEED),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    reducedMotion,
    botDifficulty: () => 'easy',
  };
}

interface Run {
  readonly game: Game;
  readonly input: InputManager;
  readonly view: InputView;
}

function start(create: () => Game, context: GameContext): Run {
  const game = create();
  game.init(context);
  return { game, input: idleInput(), view: new InputView() };
}

function stepScore(run: Run): { p1: number; p2: number; winner: string | null } {
  run.game.update(STEP, run.view.sync(run.input.beginStep(STEP)));
  const score = run.game.getScore();
  return { p1: score.p1, p2: score.p2, winner: score.winner };
}

describe('every playable game stays winnable with motion disabled', () => {
  const entries = Object.entries(LOADERS_FOR_TEST);

  it.each(entries)('%s steps the identical match with reduced motion on and off', async (slug, load) => {
    const loaded = await load();
    const still = start(() => loaded.create(), contextFor(loaded.manifest, false));
    const reduced = start(() => loaded.create(), contextFor(loaded.manifest, true));

    try {
      let decidedAt = -1;
      for (let step = 0; step < MAX_STEPS; step += 1) {
        const a = stepScore(still);
        const b = stepScore(reduced);
        // The simulation output must match on every step; if it ever differs, reduced
        // motion has reached the simulation, which is the bug this exists to catch.
        expect(b, `${slug} diverged at step ${String(step)} with reduced motion`).toEqual(a);
        if (a.winner !== null) {
          decidedAt = step;
          break;
        }
      }
      // And it must actually reach a decision, so the equality above is over a real match
      // rather than two games sitting still.
      expect(decidedAt, `${slug} reached no decision with two bots`).toBeGreaterThanOrEqual(0);
    } finally {
      still.game.destroy();
      reduced.game.destroy();
    }
  });

  it('covers every game, or it is guarding nothing', () => {
    expect(entries.length).toBeGreaterThan(20);
  });
});
