import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign } from '@duelbox/engine';
import type { Game, GameContext, MatchScore, Renderer } from '@duelbox/game-sdk';
import { UnfairFishingGame } from './game.js';
import { manifest } from './manifest.js';
import { BOARD_HEIGHT, BOARD_WIDTH, MATCH_SECONDS, MAX_REACH, TARGET_FISH } from './rules.js';

const STEP = 1 / 60;

function context(
  seed = 20260829,
  difficulty: 'easy' | 'normal' | 'hard' | null = null,
  presentation: Presentation = 'shared-screen',
  localSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    openingSeat: 'p1',
    botDifficulty: () => difficulty,
  };
}

/** A real `InputManager`, because a hand-built input record is how Sea Battle shipped dead code. */
function inputs(): { manager: InputManager; view: InputView } {
  return {
    manager: new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
}

class RecordingRenderer implements Renderer {
  readonly calls: Call[] = [];

  get ops(): string[] {
    return this.calls.map((call) => call.op);
  }

  get numbers(): number[] {
    return this.calls
      .flatMap((call) => call.args)
      .filter((v): v is number => typeof v === 'number');
  }

  #push(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args });
  }

  clear(colour: string): void {
    this.#push('clear', colour);
  }
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#push('rect', x, y, width, height, colour);
  }
  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#push('strokeRect', x, y, width, height, lineWidth, colour);
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.#push('circle', x, y, radius, colour);
  }
  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#push('strokeCircle', x, y, radius, lineWidth, colour);
  }
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#push('line', x1, y1, x2, y2, lineWidth, colour);
  }
  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.#push('text', value, x, y, sizePx, colour, align);
  }
  pushSeatRotation(rotated: boolean): void {
    this.#push('pushSeatRotation', rotated);
  }
  pushRotation(radians: number): void {
    this.#push('pushRotation', radians);
  }
  popSeatRotation(): void {
    this.#push('popSeatRotation');
  }
}

/** Play a bot match and describe what happened, so two arms can be compared exactly. */
function trace(game: Game, steps: number): string {
  const { manager, view } = inputs();
  const marks: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    const score = game.getScore();
    marks.push(`${String(score.p1)}:${String(score.p2)}:${String(score.winner)}`);
  }
  return marks.join('|');
}

/* ------------------------------------------------------------------------------------ */
/* The contract                                                                          */
/* ------------------------------------------------------------------------------------ */

describe('the contract', () => {
  it('never claims to have turns', () => {
    // `apps/web/src/data/turn-seat.test.ts` enforces this: a real-time game that reported
    // an active seat would switch the shell into shared-board mode and take one seat's
    // pointer zone away. The SDK contract says a real-time game may ignore `openingSeat`
    // too, and this one does — the pond is invariant under the half-turn and there is
    // nothing for an opener to name.
    const game: Game = new UnfairFishingGame();
    expect(Object.prototype.hasOwnProperty.call(UnfairFishingGame.prototype, 'getActiveSeat')).toBe(
      false,
    );
    expect(game.getActiveSeat?.() ?? null).toBeNull();
  });

  it('reports a score the shell can read at every moment of a match', () => {
    const game = new UnfairFishingGame();
    game.init(context(1, 'normal'));
    const { manager, view } = inputs();
    const seen: MatchScore[] = [];
    for (let i = 0; i < 60 * 200; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      seen.push(score);
      expect(Number.isInteger(score.p1)).toBe(true);
      expect(Number.isInteger(score.p2)).toBe(true);
      expect(score.p1).toBeGreaterThanOrEqual(0);
      expect(score.p2).toBeGreaterThanOrEqual(0);
      expect(score.p1).toBeLessThanOrEqual(TARGET_FISH);
      expect(score.p2).toBeLessThanOrEqual(TARGET_FISH);
      if (score.winner !== null) break;
    }
    const last = seen[seen.length - 1] as MatchScore;
    expect(last.winner).not.toBeNull();
  });

  it('ignores the opening seat, which a real-time game is entitled to do', () => {
    function run(openingSeat: SeatId): string {
      const game = new UnfairFishingGame();
      game.init({ ...context(12, 'hard'), openingSeat });
      return trace(game, 900);
    }
    expect(run('p2')).toBe(run('p1'));
  });

  it('starts a fresh match from init, with no leakage between matches', () => {
    const game = new UnfairFishingGame();
    game.init(context(2, 'hard'));
    const first = trace(game, 700);
    game.init(context(2, 'hard'));
    expect(trace(game, 700)).toBe(first);
  });

  it('plays a different match from a different seed', () => {
    const one = new UnfairFishingGame();
    one.init(context(3, 'normal'));
    const other = new UnfairFishingGame();
    other.init(context(4, 'normal'));
    expect(trace(other, 900)).not.toBe(trace(one, 900));
  });

  it('wires the difficulty through', () => {
    // `apps/web/src/data/bot-parity.test.ts` checks this across the catalogue: a game may
    // accept `botDifficulty` and ignore it, and every tier then plays identically.
    const easy = new UnfairFishingGame();
    easy.init(context(5, 'easy'));
    const hard = new UnfairFishingGame();
    hard.init(context(5, 'hard'));
    expect(trace(hard, 900)).not.toBe(trace(easy, 900));

    const nobody = new UnfairFishingGame();
    nobody.init(context(5, null));
    expect(nobody.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    // Nobody at the device, nobody fishing: a game that scored with no hands on it would
    // be reading something it should not.
    expect(trace(nobody, 900).endsWith('0:0:null')).toBe(true);
  });

  it('releases its state on destroy', () => {
    const game = new UnfairFishingGame();
    game.init(context(6, 'hard'));
    const { manager, view } = inputs();
    for (let i = 0; i < 900; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.pond.clock).toBe(MATCH_SECONDS);
    expect(game.pond.p1.phase).toBe('ready');
    expect(game.pond.p2.phase).toBe('ready');
  });
});

/* ------------------------------------------------------------------------------------ */
/* Two instruments, one game                                                             */
/* ------------------------------------------------------------------------------------ */

describe('a key and a thumb', () => {
  /**
   * The same press schedule, spelled twice.
   *
   * This is the whole cross-device fairness claim in one test: the game reads
   * `actionPressed` and nothing else, and the engine raises that identically for a key and
   * for a finger, so the two runs are not merely comparable — they are byte-identical.
   * Shuriken bound its throw to pointer velocity and is filed as a fairness bug (#2478)
   * precisely because that sentence cannot be written about it.
   */
  function playWith(instrument: 'keys' | 'thumb', at: readonly number[]): string {
    const game = new UnfairFishingGame();
    game.init(context(7));
    const { manager, view } = inputs();
    const marks: string[] = [];
    for (let i = 0; i < 900; i += 1) {
      const on = at.includes(i);
      if (instrument === 'keys') {
        if (on) manager.keyDown('Space');
        else manager.keyUp('Space');
      } else if (on) {
        manager.pointerDown(1, BOARD_WIDTH / 2, BOARD_HEIGHT - 100);
      } else {
        manager.pointerUp(1);
      }
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      marks.push(`${String(game.pond.p1.phase)}:${game.pond.p1.out.toFixed(9)}`);
    }
    return marks.join('|');
  }

  it('work the rod identically, press for press', () => {
    const schedule = [10, 40, 41, 42, 90, 200, 201, 340, 500, 620, 621, 622, 700];
    expect(playWith('thumb', schedule)).toBe(playWith('keys', schedule));
  });

  it('gives a seat only its own half to start a gesture in', () => {
    // The engine owns seat ownership; this is the check that the game did not reimplement
    // it and did not read the far half by accident.
    const game = new UnfairFishingGame();
    game.init(context(8));
    const { manager, view } = inputs();
    manager.pointerDown(1, BOARD_WIDTH / 2, 60);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.pond.p1.phase).toBe('ready');
    expect(game.pond.p2.phase).toBe('flying');
  });

  it('reads no pointer position and no movement keys at all', () => {
    // A rod is one button. Holding a direction, dragging a finger across the pond, and
    // resting a finger in a corner must all be the same match, because none of them is
    // a press — and the difference between a thumb and a key lives entirely in the
    // quantities this game refuses to read.
    const still = new UnfairFishingGame();
    still.init(context(9, null));
    const stillTrace = trace(still, 600);

    const busy = new UnfairFishingGame();
    busy.init(context(9, null));
    const { manager, view } = inputs();
    const marks: string[] = [];
    for (let i = 0; i < 600; i += 1) {
      manager.keyDown('KeyW');
      manager.keyDown('ArrowLeft');
      manager.pointerMove(1, 40 + (i % 500), BOARD_HEIGHT - 40 - (i % 300));
      busy.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = busy.getScore();
      marks.push(`${String(score.p1)}:${String(score.p2)}:${String(score.winner)}`);
    }
    expect(marks.join('|')).toBe(stillTrace);
  });

  it('does not throw a bait on the way out of the pause menu', () => {
    // `InputManager.clear()` drops the finger that is still on the glass, so the first
    // step back reports a fresh press. Without the swallow the rod throws by itself.
    const game = new UnfairFishingGame();
    game.init(context(10));
    const { manager, view } = inputs();
    manager.pointerDown(1, BOARD_WIDTH / 2, BOARD_HEIGHT - 100);
    for (let i = 0; i < 5; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.pond.p1.phase).toBe('flying');
    const wasAt = game.pond.p1.out;

    game.onPause();
    manager.clear();
    game.onResume();
    manager.pointerDown(1, BOARD_WIDTH / 2, BOARD_HEIGHT - 100);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    // Still flying, and further out: the leftover press neither struck nor recast.
    expect(game.pond.p1.phase).toBe('flying');
    expect(game.pond.p1.out).toBeGreaterThan(wasAt);

    // And the next real press still works.
    manager.pointerUp(1);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.pointerDown(1, BOARD_WIDTH / 2, BOARD_HEIGHT - 100);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.pond.p1.phase).toBe('reeling');
  });
});

/* ------------------------------------------------------------------------------------ */
/* Presentations                                                                         */
/* ------------------------------------------------------------------------------------ */

describe('the two presentations', () => {
  it('step the identical match', () => {
    // `docs/presentation.md`: rules, scoring and simulation are byte-identical across
    // both; only placement, rotation and control mapping change. Nothing in this game
    // reads `presentation` or `localSeat` at all, which is the strongest way to satisfy it.
    const arms: string[] = [];
    for (const [presentation, localSeat] of [
      ['shared-screen', 'p1'],
      ['single-seat', 'p1'],
      ['single-seat', 'p2'],
    ] as const) {
      const game = new UnfairFishingGame();
      game.init(context(11, 'normal', presentation, localSeat));
      arms.push(trace(game, 1200));
    }
    expect(arms[1]).toBe(arms[0]);
    expect(arms[2]).toBe(arms[0]);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Drawing                                                                               */
/* ------------------------------------------------------------------------------------ */

function played(seed: number, steps: number): UnfairFishingGame {
  const game = new UnfairFishingGame();
  game.init(context(seed, 'normal'));
  const { manager, view } = inputs();
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
  return game;
}

describe('drawing', () => {
  it('never mutates the simulation, at any alpha', () => {
    const game = played(20, 400);
    const before = JSON.stringify(game.pond);
    for (let i = 0; i < 40; i += 1) {
      game.render(new RecordingRenderer(), (i % 10) / 10);
    }
    expect(JSON.stringify(game.pond)).toBe(before);
  });

  it('interpolates a flying bait by the render alpha', () => {
    const game = played(21, 200);
    // Drive it to a state with a bait actually in the air.
    const { manager, view } = inputs();
    for (let i = 0; i < 400 && game.pond.p1.phase !== 'flying'; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.pond.p1.phase).toBe('flying');
    const early = new RecordingRenderer();
    const late = new RecordingRenderer();
    game.render(early, 0);
    game.render(late, 0.9);
    expect(late.numbers).not.toEqual(early.numbers);
  });

  it('draws no text at all', () => {
    const game = played(22, 900);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0.5);
    expect(renderer.ops).not.toContain('text');
  });

  it('keeps every drawn coordinate inside the declared box', () => {
    // Rule 8 and the logical-size suite: a game that drew outside its own box would be
    // cropped on one device and not on another.
    for (const seed of [23, 24, 25]) {
      const game = played(seed, 900);
      for (const alpha of [0, 0.5, 0.99]) {
        const renderer = new RecordingRenderer();
        game.render(renderer, alpha);
        for (const call of renderer.calls) {
          if (call.op === 'clear') continue;
          const [x, y] = call.args as number[];
          expect(x).toBeGreaterThanOrEqual(-1);
          expect(x).toBeLessThanOrEqual(BOARD_WIDTH + 1);
          expect(y).toBeGreaterThanOrEqual(-1);
          expect(y).toBeLessThanOrEqual(BOARD_HEIGHT + 1);
        }
      }
    }
  });

  it('tells the two seats apart by shape, not only by colour', () => {
    // Rule 7, checked here in the game's own terms and by
    // `apps/web/src/data/greyscale.test.ts` across the catalogue. The two seat colours sit
    // at 1.03:1 under deuteranopia, so for those players the shape is the only signal
    // there is: seat one is round everywhere — hull, float, tally mark — and seat two is
    // square everywhere.
    const game = played(26, 900);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0.5);
    const shapesFor = (seat: SeatId): Set<string> => {
      const palette = SEAT_PALETTE[seat];
      const owned = new Set([palette.base, palette.deep, palette.tint, palette.soft]);
      const shapes = new Set<string>();
      for (const call of renderer.calls) {
        const colour = call.args[call.args.length - 1];
        if (typeof colour === 'string' && owned.has(colour)) shapes.add(call.op);
      }
      return shapes;
    };
    const one = shapesFor('p1');
    const two = shapesFor('p2');
    expect(one.size).toBeGreaterThan(0);
    expect(two.size).toBeGreaterThan(0);
    expect([...one].some((op) => !two.has(op))).toBe(true);
    expect([...two].some((op) => !one.has(op))).toBe(true);
    expect(one.has('circle')).toBe(true);
    expect(two.has('rect')).toBe(true);
    expect(two.has('circle')).toBe(false);
  });

  it('keeps both seats on screen together, so rule 7 can be asked at all', () => {
    // `greyscale.test.ts` can only judge frames in which both seats have material; a game
    // that showed one seat at a time would be unjudgeable and would have to be listed as
    // an exception. Two boats are always moored, so there is never such a frame here.
    const game = played(27, 900);
    for (const alpha of [0, 0.6]) {
      const renderer = new RecordingRenderer();
      game.render(renderer, alpha);
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const palette = SEAT_PALETTE[seat];
        const owned = new Set([palette.base, palette.deep, palette.tint, palette.soft]);
        const marks = renderer.calls.filter((call) => {
          const colour = call.args[call.args.length - 1];
          return typeof colour === 'string' && owned.has(colour);
        });
        expect(marks.length, `${seat} has nothing on screen`).toBeGreaterThan(2);
      }
    }
  });

  it('draws a line only while there is one in the water', () => {
    const game = new UnfairFishingGame();
    game.init(context(28));
    const idle = new RecordingRenderer();
    game.render(idle, 0);
    const beforeOps = idle.ops.length;
    const { manager, view } = inputs();
    manager.keyDown('Space');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    const casting = new RecordingRenderer();
    game.render(casting, 0);
    expect(casting.ops.length).toBeGreaterThan(beforeOps);
    expect(game.pond.p1.out).toBeGreaterThan(0);
    expect(game.pond.p1.out).toBeLessThanOrEqual(MAX_REACH);
  });
});
