import { describe, expect, it } from 'vitest';
import {
  Canvas2DRenderer,
  InputManager,
  InputView,
  NO_INSETS,
  Rng,
  fitViewport,
  type Canvas2DLike,
} from '@duelbox/engine';
import type { Game, GameContext, GameManifest } from '@duelbox/game-sdk';
import { LOADERS_FOR_TEST } from './registry';

/**
 * A phone and a laptop must simulate the identical match.
 *
 * This is the property lockstep cross-device play rests on, and until now nothing
 * checked it: every determinism test in the repo replays a trace at a single implicit
 * size. Here each game is driven through the same logical input trace at four very
 * different viewports — with and without safe-area insets — and the resulting states
 * must be bit-identical, compared with `toEqual` on raw floats rather than a tolerance,
 * because "nearly the same" diverges by the hundredth step.
 */

const VIEWPORTS = [
  { label: 'small phone', width: 320, height: 568, dpr: 2, insets: NO_INSETS },
  { label: 'notched phone', width: 393, height: 852, dpr: 3, insets: { top: 59, right: 0, bottom: 34, left: 0 } },
  { label: 'tablet', width: 768, height: 1024, dpr: 2, insets: NO_INSETS },
  { label: 'laptop', width: 1280, height: 800, dpr: 1, insets: NO_INSETS },
  { label: '4K', width: 3840, height: 2160, dpr: 1, insets: NO_INSETS },
];

const STEP = 1 / 60;
const STEPS = 900;

/**
 * A canvas context that answers every call and records nothing.
 *
 * A proxy rather than a hand-written stub: enumerating the 2D context by hand means the
 * test fails the day a game reaches for a method nobody listed, which is a fact about
 * the stub and not about the simulation.
 */
function stubContext(): Canvas2DLike {
  const noop = (): unknown => undefined;
  const measure = (): TextMetrics => ({ width: 0 }) as TextMetrics;
  return new Proxy(
    {},
    {
      get: (_target, property) => (property === 'measureText' ? measure : noop),
      set: () => true,
    },
  ) as unknown as Canvas2DLike;
}

/**
 * A deterministic input trace in *logical* units.
 *
 * Logical on purpose: a device-space trace would have to be converted per viewport and
 * the conversion, not the simulation, would be what the test compared.
 */
function driveOnce(
  manifest: GameManifest,
  create: () => Game,
  viewport: (typeof VIEWPORTS)[number],
  gestureSeed = 7,
): unknown {
  const logical = manifest.logical;
  const renderer = new Canvas2DRenderer(stubContext(), logical);
  renderer.setViewport(fitViewport(logical, viewport.width, viewport.height, viewport.insets));

  const input = new InputManager(logical, {
    split: manifest.zoneSplit === 'vertical' ? 'vertical' : 'horizontal',
    bottomSeat: 'p1',
  });
  const view = new InputView();

  const game = create();
  const context: GameContext = {
    manifest,
    rng: new Rng(20260820),
    presentation: 'shared-screen',
    localSeat: 'p1',
    botDifficulty: () => null,
  };
  game.init(context);

  // A fixed, seeded gesture script. Both seats act; positions sweep the whole board.
  const script = new Rng(gestureSeed);
  const trace: unknown[] = [];
  for (let step = 0; step < STEPS; step += 1) {
    if (step % 17 === 0) {
      const x = script.float() * logical.width;
      const y = script.float() * logical.height;
      input.pointerDown(step % 3, x, y);
    }
    if (step % 17 === 6) input.pointerUp(step % 3);
    if (step % 23 === 0) input.keyDown('KeyW');
    if (step % 23 === 9) input.keyUp('KeyW');

    game.update(STEP, view.sync(input.beginStep(STEP)));
    game.render(renderer, 0);

    const score = game.getScore();
    trace.push([score.p1, score.p2, score.winner, game.getActiveSeat?.() ?? null]);
  }
  game.destroy();
  return trace;
}

describe('the simulation is viewport-independent', () => {
  for (const [slug, load] of Object.entries(LOADERS_FOR_TEST)) {
    it(`${slug} plays the identical match at every viewport size`, async () => {
      const loaded = await load();
      const baseline = driveOnce(loaded.manifest, () => loaded.create(), VIEWPORTS[0]!);

      for (const viewport of VIEWPORTS.slice(1)) {
        const other = driveOnce(loaded.manifest, () => loaded.create(), viewport);
        expect(other, `${slug} diverged at ${viewport.label}`).toEqual(baseline);
      }
    });
  }

  it('covers every playable game, so a new one cannot skip this quietly', () => {
    expect(Object.keys(LOADERS_FOR_TEST).length).toBeGreaterThanOrEqual(7);
  });

  it('records a full trace, rather than comparing two empty ones', async () => {
    // Guards the comparisons above from passing vacuously: if the harness stopped
    // driving the games, every one of them would still agree about nothing.
    const loaded = await LOADERS_FOR_TEST['air-hockey']!();
    const trace = driveOnce(loaded.manifest, () => loaded.create(), VIEWPORTS[0]!) as unknown[];
    expect(trace.length).toBe(STEPS);
  });

  it('sees a difference when there is one to see', async () => {
    // The comparisons above are only worth anything if this harness can tell two
    // different matches apart. Same viewport, different seed: the traces must diverge.
    const loaded = await LOADERS_FOR_TEST['air-hockey']!();
    const a = driveOnce(loaded.manifest, () => loaded.create(), VIEWPORTS[0]!, 7);
    const b = driveOnce(loaded.manifest, () => loaded.create(), VIEWPORTS[0]!, 99);
    expect(a).not.toEqual(b);
  });
});

describe('the declared logical size is the one the simulation uses', () => {
  /**
   * A manifest that disagrees with its game is worse than no manifest: the shell
   * letterboxes to the declared box, so a game simulating in a different one has part
   * of its play area cropped or floating in dead space. The schema cannot catch this —
   * it only sees the number, not what the code does with it.
   */
  for (const [slug, load] of Object.entries(LOADERS_FOR_TEST)) {
    it(`${slug} keeps every drawn point inside its declared box`, async () => {
      const loaded = await load();
      const { width, height } = loaded.manifest.logical;

      const seen: number[][] = [];
      const recorder = new Proxy(
        {},
        {
          get: (_t, property) => {
            if (property === 'measureText') return () => ({ width: 0 }) as TextMetrics;
            return (...args: unknown[]) => {
              const numbers = args.filter((a): a is number => typeof a === 'number');
              if (numbers.length >= 2) seen.push(numbers);
              return undefined;
            };
          },
          set: () => true,
        },
      ) as unknown as Canvas2DLike;

      const renderer = new Canvas2DRenderer(recorder, loaded.manifest.logical);
      renderer.setViewport(fitViewport(loaded.manifest.logical, 800, 1200, NO_INSETS));
      const game = loaded.create();
      game.init({
        manifest: loaded.manifest,
        rng: new Rng(1),
        presentation: 'shared-screen',
        localSeat: 'p1',
        botDifficulty: () => null,
      });
      const input = new InputManager(loaded.manifest.logical, {
        split: loaded.manifest.zoneSplit === 'vertical' ? 'vertical' : 'horizontal',
        bottomSeat: 'p1',
      });
      const view = new InputView();
      for (let i = 0; i < 120; i += 1) {
        game.update(1 / 60, view.sync(input.beginStep(1 / 60)));
        game.render(renderer, 0);
      }
      game.destroy();

      expect(seen.length, `${slug} drew nothing`).toBeGreaterThan(0);
      // Generous: strokes, shadows and glyph boxes legitimately overhang a little. What
      // this catches is a game simulating in a box unrelated to the one it declared.
      const limit = Math.max(width, height) * 2;
      for (const args of seen) {
        for (const value of args) {
          expect(Math.abs(value), `${slug} drew at ${String(value)}, far outside ${String(width)}x${String(height)}`).toBeLessThanOrEqual(limit);
        }
      }
    });
  }
});
