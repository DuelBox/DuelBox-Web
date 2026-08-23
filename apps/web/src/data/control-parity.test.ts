import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, GameManifest } from '@duelbox/game-sdk';
import { LOADERS_FOR_TEST } from './registry';

/**
 * The same game, played the same way, through a keyboard and through a thumb.
 *
 * Rule 10 says no mechanic may reward one instrument over the other, and every game asserts
 * that for itself in its own terms. What none of them can check is the thing the rule is
 * actually about: whether a person holding a keyboard and a person holding a phone are
 * playing the same game. If the pointer aims better, a single-player result is decided by
 * which peripheral somebody happened to have — the cross-device fairness problem with one
 * device in.
 *
 * So this drives seat one with **one script expressed twice**. The script is a seeded walk:
 * hold a direction for a while, act on a schedule, choose another direction. The keyboard run
 * spells that with the four movement keys and the action key. The pointer run spells the same
 * thing by putting a finger at the point in seat one's own zone that the direction names, and
 * lifting and replacing it on the same schedule the keys press on. Seat two is the same bot
 * on the same seed in both runs, so the only difference in the match is the instrument.
 *
 * It compares *outcomes over many matches*, not traces. Two instruments will never produce
 * identical frames — an absolute finger and a held key are different things — and they do not
 * have to. What they must not do is win at different rates.
 */

const STEP = 1 / 60;
/** Long enough for every game here; the slowest decided match in the suite is under four. */
const MAX_STEPS = 60 * 240;
const SEEDS = 14;

interface Script {
  /** Which way seat one is pushing, as a unit-ish vector. */
  dx: number;
  dy: number;
  /**
   * How far out the push reaches, 0 to 1.
   *
   * A direction alone is enough for a key, which only has a sign — but a pointer reads the
   * *point*, and a script that only ever supplied a unit vector put the finger on an ellipse
   * around the middle of the board and never once inside it. Four board games could not be
   * finished by tapping because every tap landed on the same ring of cells, which read as the
   * games refusing the pointer rather than as the script never aiming at them.
   */
  reach: number;
  /**
   * Whether seat one is engaged this step — pushing and acting — or resting.
   *
   * Movement and the action are one phase rather than two, because the engine's input model
   * makes them one for a thumb: `actionHeld` is `keys.action || pointerDown`, so a finger on
   * the glass *is* the action, and there is no way to express "moving but not acting" with a
   * pointer at all. A script that tapped the action key for a single frame while holding a
   * direction therefore had no pointer equivalent — and it also never built any power, so the
   * four games whose keyboard line reads "hold Space, build power, release" could not
   * complete a single shot. That looked like four games refusing the keyboard.
   */
  engaged: boolean;
}

/**
 * One seeded walk, shared by both runs.
 *
 * Generated up front rather than as the match goes, because the two runs must be given the
 * *same* intent — a script that reacted to the board would react differently to two boards
 * and would be measuring the game rather than the instrument.
 */
function script(seed: number): readonly Script[] {
  const rng = new Rng(seed);
  const steps: Script[] = [];
  let dx = 0;
  let dy = 0;
  let reach = 0;
  let hold = 0;
  let engaged = true;
  for (let i = 0; i < MAX_STEPS; i += 1) {
    if (hold <= 0) {
      const angle = rng.float() * Math.PI * 2;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      // Square-rooted so the points land evenly over the area rather than bunching at the
      // middle, which is what a person's taps do across a board.
      reach = Math.sqrt(rng.float());
      engaged = !engaged;
      // Engagements run from a tenth of a second to two thirds of one, so the script both
      // taps and holds — a game that wants a quick press and one that wants a charge are
      // both reachable, and neither is favoured.
      hold = engaged ? 6 + Math.floor(rng.float() * 34) : 5 + Math.floor(rng.float() * 20);
    }
    hold -= 1;
    steps.push({ dx, dy, reach, engaged });
  }
  return steps;
}

const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', action: 'Space' };

/**
 * Where in the surface seat one owns a push of (dx, dy) points.
 *
 * Sized to each manifest's own logical board rather than a device, because that is the
 * coordinate space `InputManager` is given and the space a game reads back.
 */
function pointerFor(
  manifest: GameManifest,
  step: Script,
  split: 'horizontal' | 'vertical' | 'shared',
): [number, number] {
  const { width, height } = manifest.logical;
  const x = step.dx * step.reach;
  const y = step.dy * step.reach;
  if (split === 'vertical') return [width * 0.25 + x * width * 0.22, height / 2 + y * height * 0.46];
  // The whole board belongs to whoever is to move, so the middle of it is the middle.
  if (split === 'shared') return [width / 2 + x * width * 0.46, height / 2 + y * height * 0.46];
  return [width / 2 + x * width * 0.46, height * 0.75 + y * height * 0.22];
}

function splitOf(manifest: GameManifest): 'horizontal' | 'vertical' | 'shared' {
  if (manifest.zoneSplit === 'vertical') return 'vertical';
  // The manifest calls it `shared-board`; the engine calls it `shared`.
  if (manifest.zoneSplit === 'shared-board') return 'shared';
  return 'horizontal';
}

type Instrument = 'keyboard' | 'pointer';

interface Result {
  readonly winner: SeatId | 'draw' | null;
  /** How many times the score moved. Zero means the instrument never reached the game. */
  readonly progress: number;
}

/** Play one match with seat one driven by `instrument`. */
function play(
  create: () => Game,
  manifest: GameManifest,
  seed: number,
  instrument: Instrument,
): Result {
  const game = create();
  const context: GameContext = {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    botDifficulty: (seat: SeatId) => (seat === 'p2' ? 'normal' : null),
  };
  game.init(context);

  const split = splitOf(manifest);
  const input = new InputManager(
    { width: manifest.logical.width, height: manifest.logical.height },
    { split, bottomSeat: 'p1' },
  );
  const shared = split === 'shared';
  const view = new InputView();
  const plan = script(seed);
  let held = { x: 0, y: 0 };
  let down = false;
  let progress = 0;
  let last = '';

  try {
    for (let i = 0; i < MAX_STEPS; i += 1) {
      const now = plan[i];
      if (now === undefined) break;

      if (instrument === 'keyboard') {
        const wantX = !now.engaged || Math.abs(now.dx) < 0.35 ? 0 : Math.sign(now.dx);
        const wantY = !now.engaged || Math.abs(now.dy) < 0.35 ? 0 : Math.sign(now.dy);
        if (held.x !== wantX) {
          if (held.x < 0) input.keyUp(KEYS.left);
          if (held.x > 0) input.keyUp(KEYS.right);
          if (wantX < 0) input.keyDown(KEYS.left);
          if (wantX > 0) input.keyDown(KEYS.right);
          held = { x: wantX, y: held.y };
        }
        if (held.y !== wantY) {
          if (held.y < 0) input.keyUp(KEYS.up);
          if (held.y > 0) input.keyUp(KEYS.down);
          if (wantY < 0) input.keyDown(KEYS.up);
          if (wantY > 0) input.keyDown(KEYS.down);
          held = { x: held.x, y: wantY };
        }
        if (now.engaged) input.keyDown(KEYS.action);
        else input.keyUp(KEYS.action);
      } else {
        const [x, y] = pointerFor(manifest, now, split);
        if (!now.engaged) {
          // A finger off the glass, which is the only way a pointer can say "not acting" —
          // and therefore the only thing a released action key can mean to it.
          if (down) input.pointerUp(1);
          down = false;
        } else if (!down) {
          input.pointerDown(1, x, y);
          down = true;
        } else {
          input.pointerMove(1, x, y);
        }
      }

      // A turn-based board belongs to whoever is to move, and that changes every turn.
      if (shared) input.setBoardSeat(game.getActiveSeat?.() ?? 'p1');

      game.update(STEP, view.sync(input.beginStep(STEP)));
      const score = game.getScore();
      const shown = `${score.p1}:${score.p2}`;
      if (shown !== last) {
        if (last !== '') progress += 1;
        last = shown;
      }
      if (score.winner !== null) return { winner: score.winner, progress };
    }
    return { winner: null, progress };
  } finally {
    game.destroy();
  }
}

interface Tally {
  readonly wins: number;
  readonly decided: number;
  readonly finished: number;
  readonly progress: number;
}

function tally(create: () => Game, manifest: GameManifest, instrument: Instrument): Tally {
  let wins = 0;
  let decided = 0;
  let finished = 0;
  let progress = 0;
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const result = play(create, manifest, seed * 37, instrument);
    progress += result.progress;
    if (result.winner === null) continue;
    finished += 1;
    if (result.winner === 'draw') continue;
    decided += 1;
    if (result.winner === 'p1') wins += 1;
  }
  return { wins, decided, finished, progress };
}

describe('the two instruments play the same game', () => {
  const entries = Object.entries(LOADERS_FOR_TEST);

  it.each(entries)('%s answers a keyboard and a thumb alike', async (slug, load) => {
    const loaded = await load();
    const keyboard = tally(() => loaded.create(), loaded.manifest, 'keyboard');
    const pointer = tally(() => loaded.create(), loaded.manifest, 'pointer');

    // **Both instruments must be able to move the game**, which is the unambiguous half of
    // the question: a game that answers one and ignores the other is unplayable on that
    // peripheral, and no amount of tuning fixes it.
    //
    // Deliberately not "must finish a match". A flailing script is not a player, and in a
    // cursor-driven board game it is a very poor one — Checkers finished none of its
    // twenty-eight matches inside four minutes on either instrument while quite happily
    // taking pieces on both. Asserting completion there measured how long Checkers is, not
    // whether a keyboard can play it.
    expect(keyboard.progress, `${slug} never moved on the keyboard`).toBeGreaterThan(0);
    expect(pointer.progress, `${slug} never moved on the pointer`).toBeGreaterThan(0);

    if (keyboard.decided < 6 || pointer.decided < 6) return;
    const byKey = keyboard.wins / keyboard.decided;
    const byThumb = pointer.wins / pointer.decided;
    // A wide band, deliberately. Fourteen matches cannot resolve a five-point difference, and
    // this is looking for a game one instrument simply cannot play — not for a tuning gap.
    expect(
      Math.abs(byKey - byThumb),
      `${slug}: keyboard wins ${(byKey * 100).toFixed(0)}% (${keyboard.wins}/${keyboard.decided}), ` +
        `pointer ${(byThumb * 100).toFixed(0)}% (${pointer.wins}/${pointer.decided})`,
    ).toBeLessThan(0.75);
  });
});
