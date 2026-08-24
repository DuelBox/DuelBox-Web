import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BAND_TOP,
  CAR_SCREEN_Y,
  CENTRE_X,
  RacingCarsGame,
  ROAD_LEFT,
  ROAD_RIGHT,
  VIEW_SCALE,
  VIEW_TOP_Y,
  pointerAcross,
  trackToScreenY,
} from './game.js';
import {
  ACROSS_LIMIT,
  CELL_LENGTH,
  COURSE_HEIGHT,
  COURSE_WIDTH,
  RACE_CELLS,
  RACE_DISTANCE,
  ROAD_HALF_WIDTH,
  ROUND_SECONDS,
  SLOT_PITCH,
  SPIN_SECONDS,
  STEER_SPEED,
  VISIBLE_AHEAD,
  gateValue,
  slotAcross,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

interface MutableSeatInput {
  move: Vec2;
  pointer: Vec2 | null;
  actionPressed: boolean;
  actionHeld: boolean;
  actionReleased: boolean;
  holdSeconds: number;
}

function blankSeat(): MutableSeatInput {
  return {
    move: vec2(),
    pointer: null,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
  };
}

class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  /** Direction keys, as the engine reports them: components in [-1, 1]. */
  steer(seat: SeatId, x: number): void {
    this.#of(seat).move.x = x;
  }

  /** A finger down at a point in device-oriented logical units. */
  touch(seat: SeatId, x: number, y = COURSE_HEIGHT * 0.75): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionHeld = true;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionHeld = false;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

const IDLE = new ScriptedInput();

function makeContext(
  seed: number,
  p1: BotDifficulty | null = null,
  p2: BotDifficulty | null = null,
  presentation: Presentation = 'shared-screen',
  localSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? p1 : p2;
    },
  };
}

type DrawArg = number | string | boolean | undefined;

interface Op {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

/** Logs every call and every argument, so no draw can pass unobserved. */
class RecordingRenderer implements Renderer {
  readonly ops: Op[] = [];

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
    this.#record('pushRotation', radians);
  }

  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  #record(op: string, ...args: DrawArg[]): void {
    this.ops.push({ op, args });
  }
}

function draw(game: RacingCarsGame): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer);
  return renderer;
}

/** Every rect drawn, as `[x, y, width, height]`. */
function rects(renderer: RecordingRenderer): number[][] {
  return renderer.ops
    .filter((entry) => entry.op === 'rect')
    .map((entry) => entry.args.slice(0, 4) as number[]);
}

/** Every line drawn, as `[x1, y1, x2, y2]`. */
function lines(renderer: RecordingRenderer): number[][] {
  return renderer.ops
    .filter((entry) => entry.op === 'line')
    .map((entry) => entry.args.slice(0, 4) as number[]);
}

/** One drawn shape, reduced to a comparable description and a bounding box. */
interface Shape {
  /** Rounded, so a shape and its point-symmetric twin compare equal despite the arithmetic. */
  readonly key: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function shape(kind: string, values: readonly number[], box: readonly number[]): Shape {
  return {
    key: `${kind}:${values.map((value) => value.toFixed(4)).join(',')}`,
    x0: Math.min(box[0]!, box[2]!),
    y0: Math.min(box[1]!, box[3]!),
    x1: Math.max(box[0]!, box[2]!),
    y1: Math.max(box[1]!, box[3]!),
  };
}

/**
 * Split the frame into the two seats' shapes, both expressed in the near seat's frame.
 *
 * A shape wholly in the lower half is p1's and is left alone; one wholly in the upper half
 * is p2's and is turned half a turn about the centre of the box. Anything straddling the
 * divider belongs to neither and is the divider itself.
 */
function byFrame(renderer: RecordingRenderer): { near: Shape[]; far: Shape[] } {
  const near: Shape[] = [];
  const far: Shape[] = [];
  for (const [x, y, width, height] of rects(renderer) as [number, number, number, number][]) {
    if (y >= BAND_TOP) {
      near.push(shape('rect', [x, y, width, height], [x, y, x + width, y + height]));
    } else if (y + height <= BAND_TOP) {
      const mx = COURSE_WIDTH - x - width;
      const my = COURSE_HEIGHT - y - height;
      far.push(shape('rect', [mx, my, width, height], [mx, my, mx + width, my + height]));
    }
  }
  for (const [x1, y1, x2, y2] of lines(renderer) as [number, number, number, number][]) {
    if (y1 >= BAND_TOP && y2 >= BAND_TOP) {
      near.push(shape('line', [x1, y1, x2, y2], [x1, y1, x2, y2]));
    } else if (y1 <= BAND_TOP && y2 <= BAND_TOP) {
      const a = [COURSE_WIDTH - x1, COURSE_HEIGHT - y1];
      const b = [COURSE_WIDTH - x2, COURSE_HEIGHT - y2];
      far.push(shape('line', [a[0]!, a[1]!, b[0]!, b[1]!], [a[0]!, a[1]!, b[0]!, b[1]!]));
    }
  }
  return { near, far };
}

/**
 * The patch of the near seat's window the car itself occupies.
 *
 * Rule 7 says the two cars must differ in silhouette, so the two windows cannot be
 * shape-for-shape identical everywhere — this is the one place they are allowed to differ,
 * and it is small and stated rather than assumed. The same patch is cut out of both
 * frames, so nothing asymmetric can hide by being cut from only one of them.
 */
const CAR_PATCH = { x0: 226, y0: 826, x1: 374, y1: 952 };

function overCar(entry: Shape): boolean {
  return (
    entry.x1 > CAR_PATCH.x0 &&
    entry.x0 < CAR_PATCH.x1 &&
    entry.y1 > CAR_PATCH.y0 &&
    entry.y0 < CAR_PATCH.y1
  );
}

function keysOf(shapes: readonly Shape[], wanted: (entry: Shape) => boolean): string[] {
  return shapes
    .filter(wanted)
    .map((entry) => entry.key)
    .sort();
}

function started(context: GameContext = makeContext(1)): RacingCarsGame {
  const game = new RacingCarsGame();
  game.init(context);
  return game;
}

/** Run a match to its end, or until the step budget runs out. Returns the steps taken. */
function play(game: RacingCarsGame, input: InputState = IDLE, limit = 60 * 600): number {
  for (let step = 0; step < limit; step += 1) {
    game.update(STEP, input);
    if (game.getScore().winner !== null) return step;
  }
  return -1;
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(COURSE_WIDTH);
    expect(manifest.logical.height).toBe(COURSE_HEIGHT);
    expect(manifest.orientation).toBe('portrait');
  });

  it('splits the screen the way two windows lie, one above the other', () => {
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.archetype).toBe('rt-race');
    expect(manifest.modes).toEqual(['friend', 'bot']);
    expect(manifest.presentations).toContain('shared-screen');
    expect(manifest.presentations).toContain('single-seat');
  });

  it('tells each seat which half of the keyboard is theirs', () => {
    const { keyboard } = manifest.controls;
    expect(keyboard).toMatch(/player one/i);
    expect(keyboard).toMatch(/player two/i);
    // Never "A and D or the arrow keys": the other half moves the other player.
    expect(keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
  });

  it('describes controls the code actually implements', () => {
    // Control strings that lie are a recurring defect in this repository, so each clause
    // here is checked against behaviour rather than trusted.
    const game = started();
    const input = new ScriptedInput();

    input.steer('p1', 1);
    input.steer('p2', -1);
    game.update(STEP, input);
    expect(manifest.controls.keyboard).toMatch(/A and D/);
    expect(game.match.p1.across).toBeGreaterThan(0);
    expect(manifest.controls.keyboard).toMatch(/left and right arrows/);
    expect(game.match.p2.across).toBeLessThan(0);

    input.steer('p1', 0);
    input.touch('p1', ROAD_RIGHT);
    const before = game.match.p1.across;
    game.update(STEP, input);
    expect(manifest.controls.pointer).toMatch(/finger/i);
    expect(game.match.p1.across).toBeGreaterThan(before);
  });

  it('does not claim to be same-input-class only, and the steering rate is why', () => {
    // The other `rt-race` game declares it, because its interaction is rapid discrete
    // input. This one asks for a place, and every instrument arrives at the same rate.
    expect(manifest.sameInputClassOnly).toBe(false);
  });

  it('advertises a round length near the race it actually runs', () => {
    expect(manifest.roundSeconds).toBeLessThan(ROUND_SECONDS);
    expect(manifest.roundSeconds).toBeGreaterThan(30);
  });
});

describe('a fresh match', () => {
  it('starts level, with nobody having won', () => {
    const score = started().getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    expect(started().getActiveSeat()).toBeNull();
  });

  it('is level again after a second init', () => {
    const game = started();
    play(game, IDLE, 600);
    expect(game.getScore().p1).toBeGreaterThan(0);
    game.init(makeContext(2));
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
    expect(game.match.elapsed).toBe(0);
  });

  it('leaves nothing behind when it is destroyed', () => {
    const game = started(makeContext(3, 'hard', 'hard'));
    play(game, IDLE, 900);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.p1.crashes).toBe(0);
    expect(game.match.phase).toBe('racing');
    // A destroyed game must not still be driving itself on a bot tier it no longer has.
    game.update(STEP, IDLE);
    expect(game.match.p1.across).toBe(0);
  });

  it('runs the identical race from the same seed, whatever the presentation', () => {
    // Nothing in this game reads the presentation, which is the point: rule 10 is kept by
    // there being no branch to get wrong rather than by branching correctly.
    const outcomes = (['shared-screen', 'single-seat'] as Presentation[]).map((presentation) => {
      const game = started(makeContext(404, 'normal', 'easy', presentation, 'p2'));
      play(game);
      return `${String(game.getScore().p1)}:${String(game.getScore().p2)}:${String(game.getScore().winner)}`;
    });
    expect(outcomes[1]).toBe(outcomes[0]);
  });
});

describe('a person steering a car', () => {
  it('drives the car towards the finger', () => {
    const game = started();
    const input = new ScriptedInput();
    input.touch('p1', CENTRE_X + 200);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.match.p1.across).toBeCloseTo(200, 2);
  });

  it('reads the far seat from the far seat, so the finger is under their own car', () => {
    // The two players face each other. One finger, in one place on the device, means "my
    // right" to whichever of them put it there — so the same point sends the two cars to
    // opposite sides of their own road, and lands under each car on screen.
    const game = started();
    const input = new ScriptedInput();
    input.touch('p1', CENTRE_X + 150);
    input.touch('p2', CENTRE_X + 150);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.match.p1.across).toBeCloseTo(150, 2);
    expect(game.match.p2.across).toBeCloseTo(-150, 2);
    // Which, once the far seat's window is turned half a turn, is the same place on screen.
    expect(CENTRE_X + game.match.p1.across).toBeCloseTo(
      COURSE_WIDTH - (CENTRE_X + game.match.p2.across),
      6,
    );
  });

  it('cannot reach into the other seat’s window', () => {
    const game = started();
    const input = new ScriptedInput();
    input.touch('p1', ROAD_LEFT);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.match.p1.across).toBeLessThan(0);
    expect(game.match.p2.across).toBe(0);
  });

  it('gives each seat its own half of the keyboard, un-mirrored', () => {
    const game = started();
    const input = new ScriptedInput();
    input.steer('p1', 1);
    input.steer('p2', 1);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    // Both asked for their own right, and both went to their own right.
    expect(game.match.p1.across).toBeGreaterThan(0);
    expect(game.match.p2.across).toBe(game.match.p1.across);
  });

  it('takes a part-open axis as part-lock, so two keys at once do not out-run one', () => {
    const game = started();
    const input = new ScriptedInput();
    input.steer('p1', 1);
    input.steer('p2', Math.SQRT1_2);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.match.p2.across).toBeLessThan(game.match.p1.across);
    expect(game.match.p2.across).toBeCloseTo(game.match.p1.across * Math.SQRT1_2, 6);
  });

  it('lets the finger win over the keys, because a finger names a place', () => {
    const game = started();
    const input = new ScriptedInput();
    input.steer('p1', -1);
    input.touch('p1', CENTRE_X + 120);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.match.p1.across).toBeCloseTo(120, 2);
  });

  it('steers no further in a step than the rate allows, however far the finger is', () => {
    const game = started();
    const input = new ScriptedInput();
    input.touch('p1', COURSE_WIDTH * 4);
    const before = game.match.p1.across;
    game.update(STEP, input);
    expect(game.match.p1.across - before).toBeCloseTo(STEER_SPEED * STEP, 9);
  });

  it('holds its line when nobody is asking anything of it', () => {
    const game = started();
    const input = new ScriptedInput();
    input.touch('p1', CENTRE_X + 200);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    const held = game.match.p1.across;
    input.release('p1');
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.match.p1.across).toBe(held);
  });

  it('ignores everything a finger says while the car is spinning', () => {
    const game = started();
    game.match.p1.spin = SPIN_SECONDS;
    const input = new ScriptedInput();
    input.touch('p1', ROAD_RIGHT);
    const held = game.match.p1.across;
    game.update(STEP, input);
    expect(game.match.p1.across).toBe(held);
  });

  it('survives a finger whose position is not a number', () => {
    const game = started();
    const input = new ScriptedInput();
    input.touch('p1', Number.NaN);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(Number.isFinite(game.match.p1.across)).toBe(true);
    expect(Number.isFinite(game.match.p1.distance)).toBe(true);
  });

  it('does not steer on the first step back from a pause', () => {
    // Nothing is latched here, so there is nothing to go stale — but a game that grew a
    // latch later would break exactly this, and it is cheap to pin now.
    const game = started();
    const input = new ScriptedInput();
    input.touch('p1', ROAD_RIGHT);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    const held = game.match.p1.across;
    game.onPause();
    input.release('p1');
    game.onResume();
    game.update(STEP, input);
    expect(game.match.p1.across).toBe(held);
  });

  it('clamps a finger past the kerb to the edge of the road', () => {
    expect(pointerAcross('p1', CENTRE_X)).toBe(0);
    expect(pointerAcross('p1', COURSE_WIDTH * 3)).toBe(ACROSS_LIMIT);
    expect(pointerAcross('p1', -COURSE_WIDTH)).toBe(-ACROSS_LIMIT);
    // And the far seat reads the same points from the other end of the room.
    expect(pointerAcross('p2', COURSE_WIDTH * 3)).toBe(-ACROSS_LIMIT);
    expect(pointerAcross('p1', 400) + pointerAcross('p2', 400)).toBe(0);
  });
});

describe('a full race', () => {
  it('reaches a decision with two bots racing it, at every tier', () => {
    for (const tier of TIERS) {
      const game = started(makeContext(9, tier, tier));
      const steps = play(game);
      expect(steps, `${tier} never finished`).toBeGreaterThanOrEqual(0);
      expect(steps * STEP).toBeLessThan(ROUND_SECONDS);
      expect(game.getScore().winner).not.toBeNull();
    }
  });

  it('reaches a decision with nobody driving at all', () => {
    const game = started();
    const steps = play(game);
    expect(steps).toBeGreaterThanOrEqual(0);
    // Two untouched cars are the same car, so it is the dead heat it looks like.
    expect(game.getScore().winner).toBe('draw');
    expect(game.getScore().p1).toBe(RACE_CELLS);
  });

  it('stops simulating once it is decided', () => {
    const game = started(makeContext(11, 'hard', 'easy'));
    play(game);
    const settled = game.getScore();
    const distance = game.match.p1.distance;
    const input = new ScriptedInput();
    input.touch('p1', ROAD_RIGHT);
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.getScore()).toEqual(settled);
    expect(game.match.p1.distance).toBe(distance);
  });

  it('replays a fixed pointer trace to the identical score', () => {
    const trace = (): string => {
      const game = started(makeContext(707, null, 'normal'));
      const input = new ScriptedInput();
      for (let i = 0; i < 60 * 40; i += 1) {
        if (i % 40 === 0) input.touch('p1', CENTRE_X + ((i * 37) % 400) - 200);
        game.update(STEP, input);
        if (game.getScore().winner !== null) break;
      }
      const score = game.getScore();
      return `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}`;
    };
    expect(trace()).toBe(trace());
  });

  it('is won by a bot against a seat nobody is driving', () => {
    for (const tier of TIERS) {
      const game = started(makeContext(23, null, tier));
      play(game);
      expect(game.getScore().winner, `${tier} lost to an empty seat`).toBe('p2');
    }
  });

  it('scores the whole race in whole cells and stops at the flag', () => {
    const game = started(makeContext(31, 'normal', 'normal'));
    let last = 0;
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, IDLE);
      const score = game.getScore();
      expect(score.p1).toBeGreaterThanOrEqual(last);
      expect(score.p1).toBeLessThanOrEqual(RACE_CELLS);
      last = score.p1;
      if (score.winner !== null) break;
    }
    expect(last).toBeGreaterThan(RACE_CELLS / 2);
  });
});

describe('rendering', () => {
  it('draws every shape inside the declared box, at every stage of a race', () => {
    const game = started(makeContext(5, 'easy', 'hard'));
    for (let i = 0; i < 60 * 90; i += 1) {
      game.update(STEP, IDLE);
      if (i % 300 !== 0 && game.getScore().winner === null) continue;
      const renderer = draw(game);
      for (const [x, y, width, height] of rects(renderer) as [number, number, number, number][]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + width).toBeLessThanOrEqual(COURSE_WIDTH);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y + height).toBeLessThanOrEqual(COURSE_HEIGHT);
      }
      for (const [x1, y1, x2, y2] of lines(renderer) as [number, number, number, number][]) {
        for (const x of [x1, x2]) expect(x).toBeGreaterThanOrEqual(0);
        for (const x of [x1, x2]) expect(x).toBeLessThanOrEqual(COURSE_WIDTH);
        for (const y of [y1, y2]) expect(y).toBeGreaterThanOrEqual(0);
        for (const y of [y1, y2]) expect(y).toBeLessThanOrEqual(COURSE_HEIGHT);
      }
      if (game.getScore().winner !== null) break;
    }
  });

  it('keeps every shape a seat owns inside that seat’s own half', () => {
    // The whole reason the drawing clips to the band: a barrier placed from one car's
    // distance would otherwise scroll off the top of its own window and into the other
    // player's. Only the divider itself is allowed to touch both halves.
    const game = started(makeContext(6, 'normal', 'normal'));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, IDLE);
      if (i % 137 !== 0) continue;
      for (const [, y, , height] of rects(draw(game)) as [number, number, number, number][]) {
        const crossing = Math.min(y + height, BAND_TOP) - Math.max(y, BAND_TOP);
        expect(crossing).toBeLessThanOrEqual(2);
      }
    }
  });

  it('gives both seats the same road, shape for shape', () => {
    // The fairness test, at the level a player actually sees. With both cars in the same
    // state every shape of road in one window must have a point-symmetric twin in the
    // other, or one of them is being shown a different race.
    const game = started();
    for (let round = 0; round < 6; round += 1) {
      for (let i = 0; i < 120; i += 1) game.update(STEP, IDLE);
      const { near, far } = byFrame(draw(game));
      const road = keysOf(near, (entry) => !overCar(entry));
      expect(road.length, 'nothing left to compare').toBeGreaterThan(24);
      expect(road).toEqual(keysOf(far, (entry) => !overCar(entry)));
    }
  });

  it('draws the two cars differently, so the board reads in greyscale (rule 7)', () => {
    const game = started();
    for (let i = 0; i < 120; i += 1) game.update(STEP, IDLE);
    const { near, far } = byFrame(draw(game));
    expect(keysOf(near, overCar)).not.toEqual(keysOf(far, overCar));
  });

  it('marks a spinning car in shape as well as in colour', () => {
    const game = started();
    for (let i = 0; i < 60; i += 1) game.update(STEP, IDLE);
    const quiet = draw(game).ops.length;
    game.match.p1.spin = SPIN_SECONDS;
    const spinning = draw(game).ops.length;
    // A cross over the car and a recovery bar beside it: more shapes, not another colour.
    expect(spinning).toBeGreaterThan(quiet);
  });

  it('shows the finish line only once it is in sight', () => {
    const game = started();
    const chequered = (): number =>
      rects(draw(game)).filter(([, , width]) => Math.abs(width! - (ROAD_RIGHT - ROAD_LEFT) / 8) < 1)
        .length;
    expect(chequered()).toBe(0);
    game.match.p1.distance = RACE_DISTANCE - VISIBLE_AHEAD / 4;
    game.match.p2.distance = RACE_DISTANCE - VISIBLE_AHEAD / 4;
    expect(chequered()).toBeGreaterThan(8);
  });

  it('draws a barrier it can see and none it cannot', () => {
    const game = started();
    game.match.track.fill(0);
    const quiet = draw(game).ops.length;
    // A barrier a long way past the horizon changes nothing on screen.
    game.match.track[Math.floor((VISIBLE_AHEAD / CELL_LENGTH) * 3)] = gateValue(0, false);
    expect(draw(game).ops.length).toBe(quiet);
    game.match.track[2] = gateValue(0, false);
    expect(draw(game).ops.length).toBeGreaterThan(quiet);
  });

  it('does not move the simulation on', () => {
    const game = started(makeContext(7, 'easy', 'easy'));
    for (let i = 0; i < 300; i += 1) game.update(STEP, IDLE);
    const before = `${String(game.match.p1.distance)}:${String(game.match.p2.across)}`;
    for (let i = 0; i < 20; i += 1) draw(game);
    expect(`${String(game.match.p1.distance)}:${String(game.match.p2.across)}`).toBe(before);
  });

  it('says nothing in words, so neither seat has to read it upside down', () => {
    const game = started(makeContext(8, 'hard', 'hard'));
    for (let i = 0; i < 600; i += 1) game.update(STEP, IDLE);
    expect(draw(game).ops.some((entry) => entry.op === 'text')).toBe(false);
  });

  it('never asks the renderer to turn the board', () => {
    // Both seats read at once, so there is no rotation to push — the two windows are drawn
    // point-symmetrically instead, which is what makes both of them upright at the same
    // time.
    const game = started();
    for (let i = 0; i < 120; i += 1) game.update(STEP, IDLE);
    const ops = draw(game).ops.map((entry) => entry.op);
    expect(ops).not.toContain('pushSeatRotation');
    expect(ops).not.toContain('pushRotation');
  });
});

describe('the window on the track', () => {
  it('puts the car where the geometry says and the horizon at the divider', () => {
    expect(trackToScreenY(1234, 1234)).toBe(CAR_SCREEN_Y);
    expect(trackToScreenY(1234 + VISIBLE_AHEAD, 1234)).toBeCloseTo(VIEW_TOP_Y, 9);
    expect(VIEW_SCALE).toBeGreaterThan(0);
  });

  it('shows both seats exactly the same depth of road (rule 9)', () => {
    // One mapping, no seat argument. There is nowhere for an asymmetry to live.
    const ahead = CAR_SCREEN_Y - trackToScreenY(VISIBLE_AHEAD, 0);
    expect(ahead).toBeCloseTo(CAR_SCREEN_Y - VIEW_TOP_Y, 9);
    expect(trackToScreenY(-100, 0) - trackToScreenY(0, 0)).toBeCloseTo(100 * VIEW_SCALE, 9);
  });

  it('gives each seat exactly half the box', () => {
    expect(BAND_TOP).toBe(COURSE_HEIGHT / 2);
    expect(COURSE_HEIGHT - CAR_SCREEN_Y).toBeGreaterThan(0);
    expect(CAR_SCREEN_Y).toBeGreaterThan(BAND_TOP);
    expect(VIEW_TOP_Y).toBeGreaterThan(BAND_TOP);
  });

  it('keeps the road and its gauges inside the box, with a margin either side', () => {
    expect(ROAD_LEFT).toBe(CENTRE_X - ROAD_HALF_WIDTH);
    expect(ROAD_RIGHT).toBe(CENTRE_X + ROAD_HALF_WIDTH);
    expect(ROAD_LEFT).toBeGreaterThan(0);
    expect(ROAD_RIGHT).toBeLessThan(COURSE_WIDTH);
    // Symmetric about the centre line, so neither seat's own margin is the wider one.
    expect(ROAD_LEFT).toBe(COURSE_WIDTH - ROAD_RIGHT);
  });

  it('puts every gate slot on the road with room for the widest gate', () => {
    for (const seat of SEATS) {
      const sign = seat === 'p1' ? 1 : -1;
      for (let slot = 0; slot < 5; slot += 1) {
        const x = CENTRE_X + sign * slotAcross(slot);
        expect(x).toBeGreaterThanOrEqual(ROAD_LEFT);
        expect(x).toBeLessThanOrEqual(ROAD_RIGHT);
      }
    }
    expect(Math.abs(slotAcross(0))).toBe(SLOT_PITCH * 2);
  });
});
