import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, GameManifest, Renderer } from '@duelbox/game-sdk';

/**
 * Two children mashing a shared screen, which is the real input pattern.
 *
 * Shared by the fast fuzz in `input-fuzz.test.ts` and the long soak in
 * `scripts/fuzz-soak.mjs`, so the thing CI runs every push and the thing that runs for an hour
 * are the same storm at two lengths rather than two programs that drift apart.
 *
 * The storm is deliberately *illegal* as well as random. A tidy random walk only exercises
 * sequences a browser would produce; what actually reaches a page is worse — a key that
 * repeats without ever going up because the window lost focus mid-press, a pointer that
 * vanishes because the browser cancelled the gesture, four fingers at once on a phone one
 * child is holding. So this sends unmatched key-ups, doubled key-downs, pointer-ups for ids
 * that were never down, and up to six simultaneous pointers.
 */

export const STEP = 1 / 60;

/** Every key the shell binds, plus a few it does not, so a stray key is in the storm too. */
const KEYS = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ArrowUp',
  'ArrowLeft',
  'ArrowDown',
  'ArrowRight',
  'Enter',
  'Escape',
  'Tab',
  'KeyQ',
];

const SPLITS = ['horizontal', 'vertical', 'shared'] as const;

/**
 * The split the shell would start this game on.
 *
 * Starting everything on `horizontal` gave each seat half the surface, which is right for a
 * real-time game and wrong for a turn-based one — a shared board belongs to whoever is to
 * move, all of it. Seventeen turn games therefore took no pointer input at all and read as
 * "never responded", which is a defect in the harness rather than in any of them. The storm
 * still shuffles the split afterwards, because the shell does too.
 */
function splitFor(manifest: GameManifest): (typeof SPLITS)[number] {
  if (manifest.zoneSplit === 'vertical') return 'vertical';
  if (manifest.zoneSplit === 'shared-board') return 'shared';
  return 'horizontal';
}

/**
 * A renderer that only counts, so `render` is exercised without a canvas.
 *
 * A `Proxy` rather than an object of stubs, because a hand-written stub is a list that goes
 * stale: the first version of this listed eleven methods and two games called a twelfth, so
 * they failed on `renderer.pushSeatRotation is not a function` — a defect in the test wearing
 * the costume of a defect in the game. Answering to whatever is asked for cannot go stale, and
 * this is a fuzz harness, so a renderer that accepts anything is the right shape anyway.
 */
export function countingRenderer(): { renderer: Renderer; calls: () => number } {
  let calls = 0;
  const noop = (): void => {
    calls += 1;
  };
  const renderer = new Proxy(
    {},
    {
      get: () => noop,
      has: () => true,
    },
  ) as unknown as Renderer;
  return { renderer, calls: () => calls };
}

export interface FuzzReport {
  readonly steps: number;
  readonly finished: number;
  /**
   * How many times the score moved **or the turn passed** — zero means the storm never
   * reached the game.
   *
   * The turn half matters more than it looks. In a turn game the score usually does not move
   * until something is *achieved*, and a storm achieves very little: Sling Puck took a shot
   * every ten seconds under a plain key storm and put nothing through the gap in a minute, so
   * on score alone seventeen games read as having ignored the input entirely. They had not —
   * they were playing, badly, which is exactly what a storm should look like. A turn passing
   * is proof the input was consumed.
   */
  readonly progress: number;
  readonly draws: number;
}

/**
 * Storm one game for `steps` frames, restarting it whenever a match ends.
 *
 * Throws whatever the game throws: the whole point is that nothing here is caught, so an
 * unhandled exception fails the test with its own stack rather than a summary of one.
 */
export function fuzz(
  create: () => Game,
  manifest: GameManifest,
  seed: number,
  steps: number,
): FuzzReport {
  const rng = new Rng(seed);
  const { renderer } = countingRenderer();
  const view = new InputView();
  const { width, height } = manifest.logical;

  let game = create();
  let context = makeContext(manifest, rng.next() | 0);
  game.init(context);
  const split = splitFor(manifest);
  let input = new InputManager({ width, height }, { split, bottomSeat: 'p1' });
  const down = new Set<number>();
  const held = new Set<string>();
  let finished = 0;
  let draws = 0;
  let progress = 0;
  let last = '';
  let lastSeat: SeatId | null | undefined;

  try {
    for (let i = 0; i < steps; i += 1) {
      storm(input, rng, width, height, down, held);

      // The shell changes both of these mid-match — a turn game hands the board to whoever is
      // to move, and Sea Battle changes the split part-way through — so the storm changes them
      // too, at moments a game has no reason to expect.
      if (rng.float() < 0.01) input.setBoardSeat(rng.float() < 0.5 ? 'p1' : 'p2');
      if (rng.float() < 0.004) input.setSplit(SPLITS[Math.floor(rng.float() * 3)] ?? 'horizontal');
      // The shell hands a turn game's board to whoever is to move, every frame. The storm
      // does the same, and occasionally does not — a dropped frame there is a real bug class.
      const active = game.getActiveSeat?.();
      if (active !== undefined && active !== null && rng.float() < 0.95) input.setBoardSeat(active);

      game.update(STEP, view.sync(input.beginStep(STEP)));

      if (rng.float() < 0.2) game.render(renderer, rng.float());
      if (rng.float() < 0.005) {
        game.onPause();
        game.onResume();
      }

      const score = game.getScore();
      if (!Number.isFinite(score.p1) || !Number.isFinite(score.p2)) {
        throw new Error(`${manifest.id} scored ${String(score.p1)}:${String(score.p2)}`);
      }
      const shown = `${score.p1}:${score.p2}`;
      if (shown !== last) {
        if (last !== '') progress += 1;
        last = shown;
      }
      const seat = game.getActiveSeat?.() ?? null;
      if (lastSeat !== undefined && seat !== lastSeat) progress += 1;
      lastSeat = seat;

      if (score.winner !== null) {
        finished += 1;
        if (score.winner === 'draw') draws += 1;
        // Straight into another one, because tearing a game down and standing it back up
        // under a storm is exactly where a listener or a stale index survives.
        game.destroy();
        game = create();
        context = makeContext(manifest, rng.next() | 0);
        game.init(context);
        input = new InputManager({ width, height }, { split, bottomSeat: 'p1' });
        down.clear();
        held.clear();
        last = '';
        lastSeat = undefined;
      }
    }
  } finally {
    game.destroy();
  }

  return { steps, finished, progress, draws };
}

function makeContext(manifest: GameManifest, seed: number): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    // Nobody is a bot: the storm drives both seats, so both seats are being mashed.
    botDifficulty: (): null => null,
  };
}

/**
 * One frame of two children on one screen.
 *
 * **It lets go of things**, and that is not a detail. The first version pressed a random key
 * or pointer id and released a random one, so within a few seconds most ids and keys were
 * held and never released again — and since `actionPressed` is an edge, once every action is
 * permanently held nothing can ever press again. Six turn-board games showed *zero* response
 * to ten simulated minutes of it, which read as six games ignoring input entirely. They were
 * being handed one long unbroken press. A fuzz that never releases is not a storm, it is a
 * stuck key.
 *
 * So releases are aimed at what is actually held, most of the time. The rest of the time they
 * are not, because an unmatched release is a real event: a window losing focus mid-press and
 * a cancelled gesture both produce exactly that, and the engine has to survive it.
 */
function storm(
  input: InputManager,
  rng: Rng,
  width: number,
  height: number,
  down: Set<number>,
  held: Set<string>,
): void {
  const bursts = 1 + Math.floor(rng.float() * 4);
  for (let i = 0; i < bursts; i += 1) {
    const roll = rng.float();

    if (roll < 0.26) {
      const key = KEYS[Math.floor(rng.float() * KEYS.length)] ?? 'Space';
      input.keyDown(key);
      held.add(key);
    } else if (roll < 0.55) {
      // Usually a key that is down; sometimes one that never was.
      const pool = [...held];
      const key =
        pool.length > 0 && rng.float() < 0.8
          ? (pool[Math.floor(rng.float() * pool.length)] ?? 'Space')
          : (KEYS[Math.floor(rng.float() * KEYS.length)] ?? 'Space');
      input.keyUp(key);
      held.delete(key);
    } else if (roll < 0.72) {
      const id = Math.floor(rng.float() * 6);
      // Outside the board as often as inside: a thumb on the bezel is a real event, and the
      // logical box is not the device.
      const x = (rng.float() * 1.4 - 0.2) * width;
      const y = (rng.float() * 1.4 - 0.2) * height;
      input.pointerDown(id, x, y);
      down.add(id);
    } else if (roll < 0.86) {
      const id = Math.floor(rng.float() * 6);
      input.pointerMove(id, rng.float() * width, rng.float() * height);
    } else {
      const pool = [...down];
      const id =
        pool.length > 0 && rng.float() < 0.8
          ? (pool[Math.floor(rng.float() * pool.length)] ?? 0)
          : Math.floor(rng.float() * 6);
      input.pointerUp(id);
      down.delete(id);
    }
  }

  // Whatever the rolls did, everything is let go of now and then — a child does put the phone
  // down. Without this the storm still drifts towards everything held.
  if (rng.float() < 0.02) {
    for (const key of held) input.keyUp(key);
    held.clear();
    for (const id of down) input.pointerUp(id);
    down.clear();
  }
}

export type SeatIdForFuzz = SeatId;
