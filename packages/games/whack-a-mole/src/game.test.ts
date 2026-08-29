import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BOARD_X, BOARD_Y, TARGET_HITS, WhackaMoleGame, holeCentre, holeIndexAt } from './game.js';
import { GRID_COLUMNS, HOLE_COUNT, NO_HOLE } from './rules.js';
import type { BotDifficulty, Mole } from './rules.js';

const STEP = 1 / 60;

interface MutableSeatInput {
  move: Vec2;
  pointer: Vec2 | null;
  actionPressed: boolean;
  actionHeld: boolean;
  actionReleased: boolean;
  holdSeconds: number;
  holdSecondsAtRelease: number;
  pointerCancelled: boolean;
}

function blankSeat(): MutableSeatInput {
  return {
    move: vec2(),
    pointer: null,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
    holdSecondsAtRelease: 0,
    pointerCancelled: false,
  };
}

class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  /** Direction keys, as the engine would report them: components in [-1, 1]. */
  steer(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.move.x = x;
    target.move.y = y;
  }

  /** A finger going down at a point, which the engine reports as a press too. */
  tap(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = true;
    target.actionHeld = true;
  }

  /** The action key, with no pointer anywhere: the keyboard path. */
  press(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = true;
    target.actionHeld = true;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = false;
    target.actionHeld = false;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
  presentation: 'shared-screen' | 'single-seat' = 'shared-screen',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

/** The mole standing in `hole`, or null. */
function moleOn(game: WhackaMoleGame, hole: number): Readonly<Mole> | null {
  if (hole === NO_HOLE) return null;
  for (const mole of game.moles) {
    if (mole.hole === hole) return mole;
  }
  return null;
}

/** A hole holding a mole of `seat` with enough life left to survive the next step. */
function ripeHole(game: WhackaMoleGame, seat: SeatId): number {
  for (const mole of game.moles) {
    if (mole.hole === NO_HOLE) continue;
    if (mole.seat !== seat) continue;
    if (mole.upSeconds + STEP * 2 < mole.lifetime) return mole.hole;
  }
  return NO_HOLE;
}

function emptyHole(game: WhackaMoleGame): number {
  for (let hole = 0; hole < HOLE_COUNT; hole += 1) {
    if (moleOn(game, hole) === null) return hole;
  }
  return NO_HOLE;
}

/** Steps an idle match until `find` reports a hole, and returns it. */
function advanceUntilHole(
  game: WhackaMoleGame,
  input: ScriptedInput,
  find: (game: WhackaMoleGame) => number,
  limit = 3000,
): number {
  for (let i = 0; i < limit; i += 1) {
    const hole = find(game);
    if (hole !== NO_HOLE) return hole;
    game.update(STEP, input);
  }
  return NO_HOLE;
}

const point: Vec2 = vec2();

function tapHole(input: ScriptedInput, seat: SeatId, hole: number): void {
  holeCentre(point, hole);
  input.tap(seat, point.x, point.y);
}

type DrawArg = number | string | boolean | undefined;

/** Logs every call and every argument, so no draw can pass unobserved. */
class RecordingRenderer implements Renderer {
  readonly ops: string[] = [];
  readonly args: DrawArg[] = [];

  clear(colour: string): void {
    this.#record('clear', colour);
  }

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#record('rect', x, y, width, height, colour);
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#record('strokeRect', x, y, width, height, lineWidth, colour);
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    this.#record('circle', x, y, radius, colour);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#record('strokeCircle', x, y, radius, lineWidth, colour);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#record('line', x1, y1, x2, y2, lineWidth, colour);
  }

  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.#record('text', value, x, y, sizePx, colour, align);
  }

  pushSeatRotation(rotated: boolean): void {
    this.#record('pushSeatRotation', rotated);
  }

  pushRotation(radians: number): void {
    this.pushSeatRotation(radians !== 0);
  }

  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  #record(op: string, ...values: DrawArg[]): void {
    this.ops.push(op);
    for (const value of values) this.args.push(value);
  }
}

describe('board geometry', () => {
  it('names the hole under a point and refuses points off the board', () => {
    for (let hole = 0; hole < HOLE_COUNT; hole += 1) {
      holeCentre(point, hole);
      expect(holeIndexAt(point.x, point.y)).toBe(hole);
    }
    expect(holeIndexAt(BOARD_X - 1, BOARD_Y + 1)).toBe(NO_HOLE);
    expect(holeIndexAt(BOARD_X + 1, BOARD_Y - 1)).toBe(NO_HOLE);
    expect(holeIndexAt(0, 0)).toBe(NO_HOLE);
    expect(holeIndexAt(manifest.logical.width, manifest.logical.height)).toBe(NO_HOLE);
  });

  it('keeps the whole board inside the logical play area', () => {
    for (let hole = 0; hole < HOLE_COUNT; hole += 1) {
      holeCentre(point, hole);
      expect(point.x).toBeGreaterThan(0);
      expect(point.y).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(manifest.logical.width);
      expect(point.y).toBeLessThan(manifest.logical.height);
    }
  });
});

describe('WhackaMoleGame scoring', () => {
  it('scores a hit on your own colour', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();

    const hole = advanceUntilHole(game, input, (g) => ripeHole(g, 'p1'));
    expect(hole).not.toBe(NO_HOLE);

    tapHole(input, 'p1', hole);
    game.update(STEP, input);

    expect(game.getScore().p1).toBe(1);
    expect(game.getScore().p2).toBe(0);
    expect(game.lastStrike('p1')).toBe('own');
    expect(moleOn(game, hole)).toBeNull();
  });

  it('costs a point for hitting the other seats colour', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();

    const own = advanceUntilHole(game, input, (g) => ripeHole(g, 'p1'));
    expect(own).not.toBe(NO_HOLE);
    tapHole(input, 'p1', own);
    game.update(STEP, input);
    input.release('p1');
    expect(game.getScore().p1).toBe(1);

    const theirs = advanceUntilHole(game, input, (g) => ripeHole(g, 'p2'));
    expect(theirs).not.toBe(NO_HOLE);
    tapHole(input, 'p1', theirs);
    game.update(STEP, input);

    expect(game.lastStrike('p1')).toBe('other');
    expect(game.getScore().p1).toBe(0);
    expect(moleOn(game, theirs)).toBeNull();
  });

  it('floors the score at zero, so a penalty can never drive it negative', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(37));
    const input = new ScriptedInput();

    for (let i = 0; i < 6; i += 1) {
      const theirs = advanceUntilHole(game, input, (g) => ripeHole(g, 'p2'));
      expect(theirs).not.toBe(NO_HOLE);
      tapHole(input, 'p1', theirs);
      game.update(STEP, input);
      expect(game.lastStrike('p1')).toBe('other');
      expect(game.getScore().p1).toBe(0);
      input.release('p1');
    }
    expect(game.getScore().p1).toBe(0);
  });

  it('does nothing at all for a swing at an empty hole', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(41));
    const input = new ScriptedInput();
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);

    const hole = emptyHole(game);
    expect(hole).not.toBe(NO_HOLE);
    const before = game.getScore();
    tapHole(input, 'p1', hole);
    game.update(STEP, input);

    expect(game.lastStrike('p1')).toBe('miss');
    expect(game.getScore().p1).toBe(before.p1);
    expect(game.getScore().p2).toBe(before.p2);
  });

  it('ignores a tap that lands off the board entirely', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(43));
    const input = new ScriptedInput();
    const hole = advanceUntilHole(game, input, (g) => ripeHole(g, 'p1'));
    expect(hole).not.toBe(NO_HOLE);

    input.tap('p1', 5, 5);
    game.update(STEP, input);

    expect(game.getScore().p1).toBe(0);
    expect(moleOn(game, hole)).not.toBeNull();
  });

  it('lets both seats hit in the same step', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(57));
    const input = new ScriptedInput();

    let mine = NO_HOLE;
    let theirs = NO_HOLE;
    for (let i = 0; i < 4000; i += 1) {
      mine = ripeHole(game, 'p1');
      theirs = ripeHole(game, 'p2');
      if (mine !== NO_HOLE && theirs !== NO_HOLE) break;
      game.update(STEP, input);
    }
    expect(mine).not.toBe(NO_HOLE);
    expect(theirs).not.toBe(NO_HOLE);

    tapHole(input, 'p1', mine);
    tapHole(input, 'p2', theirs);
    game.update(STEP, input);

    expect(game.getScore().p1).toBe(1);
    expect(game.getScore().p2).toBe(1);
    expect(game.lastStrike('p1')).toBe('own');
    expect(game.lastStrike('p2')).toBe('own');
  });

  it('pays exactly one seat when both swing at the same hole in one step', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(61));
    const input = new ScriptedInput();

    const hole = advanceUntilHole(game, input, (g) => ripeHole(g, 'p1'));
    expect(hole).not.toBe(NO_HOLE);

    tapHole(input, 'p1', hole);
    tapHole(input, 'p2', hole);
    game.update(STEP, input);

    const misses = [game.lastStrike('p1'), game.lastStrike('p2')].filter(
      (result) => result === 'miss',
    );
    expect(misses).toHaveLength(1);
    expect(moleOn(game, hole)).toBeNull();
    expect(game.getScore().p1 + game.getScore().p2).toBeLessThanOrEqual(1);
  });
});

describe('WhackaMoleGame controls', () => {
  it('moves the selection cursor with the direction keys and clamps at the edges', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(71));
    const input = new ScriptedInput();
    const start = game.cursorFor('p1');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start).toBeLessThan(HOLE_COUNT);

    input.steer('p1', 1, 0);
    game.update(STEP, input);
    expect(game.cursorFor('p1')).toBe(start + 1);

    // The repeat delay is longer than a step, so holding the key does not sprint.
    game.update(STEP, input);
    expect(game.cursorFor('p1')).toBe(start + 1);

    for (let i = 0; i < 400; i += 1) game.update(STEP, input);
    expect(game.cursorFor('p1') % GRID_COLUMNS).toBe(GRID_COLUMNS - 1);

    input.steer('p1', 0, -1);
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);
    expect(Math.floor(game.cursorFor('p1') / GRID_COLUMNS)).toBe(0);

    input.steer('p1', -1, 1);
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);
    expect(game.cursorFor('p1')).toBe(HOLE_COUNT - GRID_COLUMNS);
  });

  it('mirrors the far seats keys, so up is up from where that seat is sitting', () => {
    const shared = new WhackaMoleGame();
    shared.init(makeContext(73));
    const single = new WhackaMoleGame();
    single.init(makeContext(73, null, null, 'single-seat'));
    const input = new ScriptedInput();
    input.steer('p2', 0, 1);

    shared.update(STEP, input);
    single.update(STEP, input);

    const start = GRID_COLUMNS - 1;
    // p2 reads the device upside down only when the two share one screen.
    expect(shared.cursorFor('p2')).toBe(start);
    expect(single.cursorFor('p2')).toBe(start + GRID_COLUMNS);
  });

  it('strikes the hole under the cursor when the action key is pressed', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(2468));
    const input = new ScriptedInput();
    input.press('p1');

    let scored = 0;
    let ripe = 0;
    for (let i = 0; i < 6000; i += 1) {
      const cursor = game.cursorFor('p1');
      const target = moleOn(game, cursor);
      // Mirrors the ageing at the top of the step: a mole retires before it can be hit.
      if (target !== null && target.seat === 'p1' && target.upSeconds + STEP < target.lifetime) {
        ripe += 1;
      }
      const before = game.getScore().p1;
      game.update(STEP, input);
      if (game.getScore().p1 > before) scored += 1;
    }

    expect(ripe).toBeGreaterThan(0);
    expect(scored).toBe(ripe);
  });

  it('drops a held direction across a pause rather than carrying it into the resume', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(79));
    const input = new ScriptedInput();
    input.steer('p1', 1, 0);
    game.update(STEP, input);
    const moved = game.cursorFor('p1');

    game.onPause();
    game.onResume();
    game.update(STEP, input);

    // The direction reads as a fresh press after the pause, so it steps on once more
    // rather than resuming mid-repeat or firing every step.
    expect(game.cursorFor('p1')).toBe(moved + 1);
    game.update(STEP, input);
    expect(game.cursorFor('p1')).toBe(moved + 1);
  });
});

describe('WhackaMoleGame match', () => {
  it('runs a headless bot match through to a decided score', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(4711, 'hard', 'hard'));
    const input = new ScriptedInput();

    let steps = 0;
    while (game.getScore().winner === null && steps < 40_000) {
      game.update(STEP, input);
      steps += 1;
    }

    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBe(TARGET_HITS);
    expect(score.winner).toBe(score.p1 === score.p2 ? 'draw' : score.p1 > score.p2 ? 'p1' : 'p2');
  });

  it('lets an easier bot lose to a harder one over a match', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(1009, 'easy', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 40_000 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).toBe('p2');
  });

  it('stops simulating once the match is decided', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(4711, 'hard', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 40_000 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }

    const decided = game.getScore();
    const steps = game.elapsedSteps;
    for (let i = 0; i < 300; i += 1) game.update(STEP, input);

    expect(game.getScore().p1).toBe(decided.p1);
    expect(game.getScore().p2).toBe(decided.p2);
    expect(game.elapsedSteps).toBe(steps);
  });

  it('raises moles faster later in a match than at the start', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(83));
    const input = new ScriptedInput();

    function countSpawns(steps: number): number {
      let count = 0;
      for (let i = 0; i < steps; i += 1) {
        game.update(STEP, input);
        for (const mole of game.moles) {
          // A mole spawned on the step just run is the only one that has not aged yet.
          if (mole.hole !== NO_HOLE && mole.upSeconds === 0) count += 1;
        }
      }
      return count;
    }

    const early = countSpawns(300);
    countSpawns(2400);
    const late = countSpawns(300);

    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
  });

  it('ignores updates after destroy', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(3, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);

    game.destroy();
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);

    expect(game.elapsedSteps).toBe(0);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    for (const mole of game.moles) expect(mole.hole).toBe(NO_HOLE);
  });

  it('starts a second match from a clean board', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(5, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 800; i += 1) game.update(STEP, input);
    expect(game.getScore().p1 + game.getScore().p2).toBeGreaterThan(0);

    game.init(makeContext(5, 'hard', 'hard'));
    expect(game.elapsedSteps).toBe(0);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    for (const mole of game.moles) expect(mole.hole).toBe(NO_HOLE);
  });
});

describe('WhackaMoleGame determinism', () => {
  function run(seed: number): number[] {
    const game = new WhackaMoleGame();
    game.init(makeContext(seed, null, 'normal'));
    const input = new ScriptedInput();

    for (let i = 0; i < 3000; i += 1) {
      if (i % 20 === 0) input.steer('p1', i % 40 === 0 ? 1 : 0, i % 40 === 0 ? 0 : 1);
      if (i % 7 === 0) input.press('p1');
      else input.release('p1');
      game.update(STEP, input);
    }

    const score = game.getScore();
    const snapshot = [score.p1, score.p2, game.elapsedSteps, game.cursorFor('p1')];
    for (const mole of game.moles) {
      snapshot.push(mole.hole, mole.seat === 'p1' ? 0 : 1, mole.upSeconds, mole.lifetime);
    }
    return snapshot;
  }

  it('replays a long match identically from the same seed and the same inputs', () => {
    const first = run(2026);
    expect(first).toEqual(run(2026));
    for (const value of first) expect(Number.isFinite(value)).toBe(true);
  });

  it('diverges on a different seed', () => {
    expect(run(2026)).not.toEqual(run(4052));
  });
});

describe('WhackaMoleGame render', () => {
  it('draws without touching simulation state', () => {
    const game = new WhackaMoleGame();
    game.init(makeContext(13, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);

    const before = [game.getScore().p1, game.getScore().p2, game.elapsedSteps];
    for (const mole of game.moles) before.push(mole.hole, mole.upSeconds);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    game.render(renderer, 0);

    expect(renderer.ops.length).toBeGreaterThan(0);
    expect(renderer.ops[0]).toBe('clear');
    for (const value of renderer.args) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }

    const after = [game.getScore().p1, game.getScore().p2, game.elapsedSteps];
    for (const mole of game.moles) after.push(mole.hole, mole.upSeconds);
    expect(after).toEqual(before);
  });

  it('balances every seat rotation it opens, in both presentations', () => {
    for (const presentation of ['shared-screen', 'single-seat'] as const) {
      const game = new WhackaMoleGame();
      game.init(makeContext(17, null, null, presentation));
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);

      const pushes = renderer.ops.filter((op) => op === 'pushSeatRotation').length;
      const pops = renderer.ops.filter((op) => op === 'popSeatRotation').length;
      expect(pushes).toBe(pops);
      expect(pushes).toBeGreaterThan(0);
    }
  });
});
