import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, GameManifest } from '@duelbox/game-sdk';
import { CATALOGUE } from './catalogue.generated';
import { LOADERS_FOR_TEST } from './registry';

/**
 * Nobody may be left with a game they cannot start alone.
 *
 * Single-player means a bot sits opposite the human, and a two-player game without one is a
 * dead end for anybody holding the device by themselves. The reference app leaves at least
 * one game with no bot at all; inheriting that gap by accident is the thing this file
 * exists to prevent.
 *
 * Three separate claims are checked, because "there is a bot" can fail in three different
 * ways and only one of them is visible from the manifest:
 *
 * 1. **Every game that offers `friend` also offers `bot`.** A manifest promise.
 * 2. **The difficulty is wired through.** A game may accept `botDifficulty` and ignore it —
 *    it type-checks, it runs, every tier is offered in the lobby, and all three play
 *    identically. Two traces from the same seed at `easy` and at `hard` must differ.
 * 3. **A bot actually plays.** A tier that returns no input at all would satisfy (2) as long
 *    as the tiers differed in some other way, so the match a bot pair produces must differ
 *    from the one two absent humans produce.
 *
 * Deliberately *not* checked here: whether the tiers are ordered by strength. That is a
 * per-game measurement over hundreds of seeded matches — far too slow for a suite that runs
 * on every commit — and each game's own `rules.test.ts` carries it, with the numbers written
 * into its SPEC.md.
 */

const STEP = 1 / 60;
/** Long enough for every game here to have done something distinguishable. */
const TRACE_STEPS = 60 * 25;

/**
 * The genuine single-player puzzles, which have no opponent by nature.
 *
 * Derived rather than listed: a game that does not offer `friend` has nobody to sit
 * opposite. The count is asserted below so that a game quietly losing its `friend` mode
 * cannot slip into this exemption unnoticed.
 */
const SOLO_ONLY = CATALOGUE.filter((entry) => !entry.modes.includes('friend')).map(
  (entry) => entry.id,
);

function contextFor(manifest: GameManifest, difficulty: (seat: SeatId) => 'easy' | 'hard' | null) {
  return {
    manifest,
    rng: new Rng(20260823),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: difficulty,
  } satisfies GameContext;
}

/**
 * A short, deterministic trace of what a match looked like. Never touches input.
 *
 * It records **what the game draws**, not what it scores, and that distinction is the
 * whole usefulness of this file. The first version compared scores and active seats, and
 * reported Hot Potato as ignoring its difficulty tier — which it does not. Hot Potato's
 * bots are properly wired; they simply had not scored yet twenty-five seconds in, so two
 * genuinely different matches produced two identical strings of zeroes and the test was
 * measuring its own blindness.
 *
 * Every position, every radius and every line width crosses the renderer, so hashing the
 * draw calls sees any difference at all in how the match is going. It also stays inside the
 * `Game` contract — `render` is the only window a game is obliged to offer onto its state.
 */
function trace(create: () => Game, context: GameContext): string {
  const game = create();
  game.init(context);
  const input = new InputManager(context.manifest.logical, {
    split: context.manifest.zoneSplit === 'vertical' ? 'vertical' : 'horizontal',
    bottomSeat: 'p1',
  });
  const view = new InputView();

  // A rolling hash rather than the numbers themselves: a match draws tens of thousands of
  // them, and only whether two traces differ is being asked.
  let hash = 2166136261;
  const record = (...args: unknown[]): void => {
    for (const arg of args) {
      if (typeof arg !== 'number') continue;
      hash ^= Math.round(arg * 1000) | 0;
      hash = Math.imul(hash, 16777619);
    }
  };
  const noop = (): void => undefined;
  const renderer = {
    clear: noop,
    rect: record,
    strokeRect: record,
    circle: record,
    strokeCircle: record,
    line: record,
    text: record,
    pushSeatRotation: noop,
    pushRotation: noop,
    popSeatRotation: noop,
  };

  const seen: string[] = [];
  try {
    for (let step = 0; step < TRACE_STEPS; step += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      if (step % 15 !== 0) continue;
      game.render(renderer, 0);
      const score = game.getScore();
      seen.push(`${String(score.p1)}:${String(score.p2)}:${String(hash >>> 0)}`);
      if (score.winner !== null) break;
    }
  } finally {
    game.destroy();
  }
  return seen.join('|');
}

describe('the catalogue', () => {
  it('offers a bot in every game that offers a friend', () => {
    const missing = CATALOGUE.filter(
      (entry) => entry.modes.includes('friend') && !entry.modes.includes('bot'),
    ).map((entry) => entry.id);
    expect(missing, `these have a friend mode and no bot: ${missing.join(', ')}`).toEqual([]);
  });

  it('exempts exactly the solo puzzles, and names them', () => {
    // The issue asks for the exemption to be explicit rather than incidental. If this list
    // grows, a two-player game has lost its friend mode and slipped out of the check above.
    expect(SOLO_ONLY.slice().sort()).toEqual([
      'blocks',
      'maze-paint',
      'nuts-and-bolts',
      'sliding-puzzle',
      'solitaire',
      'sudoku',
      'tap-match',
    ]);
    for (const id of SOLO_ONLY) {
      const entry = CATALOGUE.find((candidate) => candidate.id === id);
      expect(entry?.modes, `${id} is exempt, so it must offer solo`).toContain('solo');
    }
  });

  it('never offers a mode of nothing at all', () => {
    for (const entry of CATALOGUE) {
      expect(entry.modes.length, `${entry.id} offers no play mode`).toBeGreaterThan(0);
    }
  });
});

describe('every playable game', () => {
  const entries = Object.entries(LOADERS_FOR_TEST);

  it.each(entries)('%s declares a bot in its own manifest', async (slug, load) => {
    const loaded = await load();
    if (!loaded.manifest.modes.includes('friend')) return;
    expect(
      loaded.manifest.modes,
      `${slug} offers "friend" but not "bot", so a lone player cannot start it`,
    ).toContain('bot');
  });

  it.each(entries)('%s plays differently on easy and on hard', async (slug, load) => {
    // The failure this catches is a game that accepts `botDifficulty` and ignores it: it
    // type-checks, it runs, the lobby offers all three tiers, and they are the same tier.
    const loaded = await load();
    if (!loaded.manifest.modes.includes('bot')) return;

    const easy = trace(() => loaded.create(), contextFor(loaded.manifest, () => 'easy'));
    const hard = trace(() => loaded.create(), contextFor(loaded.manifest, () => 'hard'));
    expect(easy.length, `${slug} produced no trace at all`).toBeGreaterThan(0);
    expect(hard, `${slug} plays identically on easy and hard — is the tier read?`).not.toBe(easy);
  });

  it.each(entries)('%s plays differently with a bot than with nobody', async (slug, load) => {
    // And this catches a tier that is read but produces no input: two absent humans and two
    // bots would then play the same match.
    const loaded = await load();
    if (!loaded.manifest.modes.includes('bot')) return;

    const bots = trace(() => loaded.create(), contextFor(loaded.manifest, () => 'normal' as never));
    const nobody = trace(() => loaded.create(), contextFor(loaded.manifest, () => null));
    expect(bots, `${slug} plays the same match whether a bot is present or not`).not.toBe(nobody);
  });

  it('covers every game, or it is guarding nothing', () => {
    expect(entries.length).toBeGreaterThan(20);
  });
});
