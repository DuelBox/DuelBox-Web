import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign } from '@duelbox/engine';
import type { Game, GameContext, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BAND_TOP,
  CENTRE_X,
  ROAD_LEFT,
  ROAD_RIGHT,
  SWIPE_RISE,
  TAXI_SCREEN_Y,
  TaxiRaceGame,
  VIEW_SCALE,
  VIEW_TOP_Y,
  pointerAcross,
  pointerAlong,
  trackToScreenY,
} from './game.js';
import {
  ACROSS_LIMIT,
  BOT_LOOKAHEAD,
  CELL_LENGTH,
  CLEAR,
  COURSE_HEIGHT,
  COURSE_WIDTH,
  HOP_AIM,
  JAM,
  LANES,
  RACE_CELLS,
  RACE_DISTANCE,
  ROUND_SECONDS,
  STEER_SPEED,
  VISIBLE_AHEAD,
  laneAcross,
  maskAt,
  readAhead,
  trafficAlong,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

/** Seat one owns the bottom half of the device; seat two the top. */
const P1_HALF_Y = 900;
const P2_HALF_Y = 100;

function makeContext(
  seed = 1,
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

/**
 * The real thing rather than a stand-in.
 *
 * Every claim the manifest's control strings make is driven through this, because a control
 * string that is only compared against a hand-rolled input object is a string checked
 * against itself. Seat ownership, the tap latch, the precision lattice and the diagonal
 * normalisation all live in `InputManager`, and all four of them change what this game does.
 */
function rig(context: GameContext = makeContext()): {
  game: TaxiRaceGame;
  manager: InputManager;
  step: (count?: number) => void;
} {
  const game = new TaxiRaceGame();
  game.init(context);
  const manager = new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' });
  const view = new InputView();
  return {
    game,
    manager,
    step(count = 1): void {
      for (let i = 0; i < count; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
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

function draw(game: TaxiRaceGame): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer);
  return renderer;
}

function rects(renderer: RecordingRenderer): number[][] {
  return renderer.ops
    .filter((entry) => entry.op === 'rect')
    .map((entry) => entry.args.slice(0, 4) as number[]);
}

function lines(renderer: RecordingRenderer): number[][] {
  return renderer.ops
    .filter((entry) => entry.op === 'line')
    .map((entry) => entry.args.slice(0, 4) as number[]);
}

interface Shape {
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
 * Split a frame into the two seats' shapes, both expressed in the near seat's frame.
 *
 * A shape wholly in the lower half is seat one's and is left alone; one wholly in the upper
 * half is seat two's and is turned half a turn about the centre of the box. Anything
 * straddling the divider belongs to neither and is the divider itself.
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
 * The patch of the near seat's window the cab itself occupies.
 *
 * Rule 7 says the two taxis must differ in silhouette, so the two windows cannot be
 * shape-for-shape identical everywhere — this is the one place they are allowed to differ,
 * and it is small and stated rather than assumed. The same patch is cut out of both frames,
 * so nothing asymmetric can hide by being cut from only one of them.
 */
const CAB_PATCH = { x0: 256, y0: 856, x1: 344, y1: 952 };

function overCab(entry: Shape): boolean {
  return (
    entry.x1 > CAB_PATCH.x0 &&
    entry.x0 < CAB_PATCH.x1 &&
    entry.y1 > CAB_PATCH.y0 &&
    entry.y0 < CAB_PATCH.y1
  );
}

function keysOf(shapes: readonly Shape[], wanted: (entry: Shape) => boolean): string[] {
  return shapes
    .filter(wanted)
    .map((entry) => entry.key)
    .sort();
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

  it('advertises a round length near the one the game measures', () => {
    expect(manifest.roundSeconds).toBeGreaterThan(20);
    expect(manifest.roundSeconds).toBeLessThan(ROUND_SECONDS);
  });

  it('does not claim the two instruments are unequal', () => {
    // Steering asks for a place rather than a press, so a thumb and a key arrive at the same
    // rate; the one discrete act is the hop, and a race wants about five of them.
    expect(manifest.sameInputClassOnly).toBe(false);
  });

  it('tells each seat which half of the keyboard is theirs', () => {
    const { keyboard } = manifest.controls;
    expect(keyboard).toMatch(/player one/i);
    expect(keyboard).toMatch(/player two/i);
    // Never "A and D or the arrow keys": the other half drives the other player.
    expect(keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
    expect(keyboard).toMatch(/\ba and d\b/i);
  });

  it('has something to say to a thumb as well as to a keyboard', () => {
    expect(manifest.controls.pointer.length).toBeGreaterThan(10);
    expect(manifest.controls.pointer).toMatch(/flick|swipe/i);
  });
});

describe('the keyboard line, clause by clause, through the real InputManager', () => {
  it('"player one steers with A and D" — A goes left', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyA');
    step(6);
    expect(game.match.p1.across).toBeCloseTo(-STEER_SPEED * 6 * STEP, 6);
  });

  it('"player one steers with A and D" — D goes right', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyD');
    step(6);
    expect(game.match.p1.across).toBeCloseTo(STEER_SPEED * 6 * STEP, 6);
  });

  it('"and hops with W" — one press, one hop', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyW');
    step(1);
    expect(game.match.p1.hops).toBe(1);
    expect(game.match.p1.hop).toBeGreaterThan(0);
  });

  it('"and hops with W" — holding it down is still one hop', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyW');
    step(120);
    expect(game.match.p1.hops).toBe(1);
  });

  it('"and hops with W" — releasing and pressing again is a second hop', () => {
    const { game, manager, step } = rig();
    // Open road: what is being measured is the latch, not whether the taxi met a queue in the
    // three seconds a hop and a settle take.
    game.match.track.fill(CLEAR);
    manager.keyDown('KeyW');
    step(1);
    manager.keyUp('KeyW');
    // Long enough for the first hop to land and the suspension to settle; a hop asked for
    // mid-air is refused by the taxi rather than by the key.
    step(200);
    manager.keyDown('KeyW');
    step(1);
    expect(game.match.p1.hops).toBe(2);
  });

  it('steers at the full rate on a diagonal, because the sign is taken not the component', () => {
    // The engine normalises two keys at once to (0.707, 0.707). A player holding a direction
    // and something else must not thereby steer three-quarters as hard.
    const { game, manager, step } = rig();
    manager.keyDown('KeyD');
    manager.keyDown('KeyS');
    step(6);
    expect(game.match.p1.across).toBeCloseTo(STEER_SPEED * 6 * STEP, 6);
  });

  it('hops and steers off the same handful of keys', () => {
    const { game, manager, step } = rig();
    game.match.track.fill(CLEAR);
    manager.keyDown('KeyD');
    manager.keyDown('KeyW');
    step(1);
    expect(game.match.p1.hops).toBe(1);
    // A taxi in the air holds its line, so nothing steers until the wheels are back down.
    manager.keyUp('KeyW');
    manager.keyUp('KeyD');
    step(200);
    expect(game.match.p1.across).toBe(0);
    manager.keyDown('KeyD');
    step(6);
    expect(game.match.p1.across).toBeCloseTo(STEER_SPEED * 6 * STEP, 6);
  });

  it('says nothing about S, and S does nothing', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyS');
    step(30);
    expect(game.match.p1.across).toBe(0);
    expect(game.match.p1.hops).toBe(0);
  });

  it('says nothing about Space, and Space does nothing', () => {
    const { game, manager, step } = rig();
    manager.keyDown('Space');
    step(30);
    expect(game.match.p1.across).toBe(0);
    expect(game.match.p1.hops).toBe(0);
  });

  it('"player two with the left, right and up arrows" — left goes left', () => {
    const { game, manager, step } = rig();
    manager.keyDown('ArrowLeft');
    step(6);
    expect(game.match.p2.across).toBeCloseTo(-STEER_SPEED * 6 * STEP, 6);
  });

  it('"player two with the left, right and up arrows" — right goes right', () => {
    const { game, manager, step } = rig();
    manager.keyDown('ArrowRight');
    step(6);
    expect(game.match.p2.across).toBeCloseTo(STEER_SPEED * 6 * STEP, 6);
  });

  it('"player two with the left, right and up arrows" — up hops', () => {
    const { game, manager, step } = rig();
    manager.keyDown('ArrowUp');
    step(1);
    expect(game.match.p2.hops).toBe(1);
  });

  it('says nothing about the down arrow, and the down arrow does nothing', () => {
    const { game, manager, step } = rig();
    manager.keyDown('ArrowDown');
    step(30);
    expect(game.match.p2.across).toBe(0);
    expect(game.match.p2.hops).toBe(0);
  });

  it('says nothing about Enter, and Enter does nothing', () => {
    const { game, manager, step } = rig();
    manager.keyDown('Enter');
    step(30);
    expect(game.match.p2.across).toBe(0);
    expect(game.match.p2.hops).toBe(0);
  });

  it('never lets one seat’s half of the keyboard reach the other seat', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyA');
    manager.keyDown('KeyW');
    step(10);
    expect(game.match.p2.across).toBe(0);
    expect(game.match.p2.hops).toBe(0);
    manager.keyUp('KeyA');
    manager.keyUp('KeyW');
    const held = game.match.p1.across;
    manager.keyDown('ArrowRight');
    manager.keyDown('ArrowUp');
    step(10);
    expect(game.match.p1.across).toBe(held);
    expect(game.match.p1.hops).toBe(1);
  });

  it('means the same thing to both seats: a key names the driver’s own right', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyD');
    manager.keyDown('ArrowRight');
    step(12);
    expect(game.match.p1.across).toBeCloseTo(game.match.p2.across, 10);
    expect(game.match.p1.across).toBeGreaterThan(0);
  });

  it('lets go the moment the key does', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyD');
    step(6);
    manager.keyUp('KeyD');
    const held = game.match.p1.across;
    step(30);
    expect(game.match.p1.across).toBe(held);
  });
});

describe('the pointer line, clause by clause, through the real InputManager', () => {
  it('"slide a finger across your own half to pick a lane" — seat one', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, CENTRE_X + laneAcross(3), P1_HALF_Y);
    step(120);
    expect(game.match.p1.across).toBeCloseTo(laneAcross(3), 0);
  });

  it('"slide a finger across your own half to pick a lane" — seat two, in its own frame', () => {
    // Seat two reads the device the other way up, so its own right is the device's left.
    const { game, manager, step } = rig();
    manager.pointerDown(2, CENTRE_X - laneAcross(3), P2_HALF_Y);
    step(120);
    expect(game.match.p2.across).toBeCloseTo(laneAcross(3), 0);
  });

  it('follows the finger when it slides to another lane', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, CENTRE_X + laneAcross(0), P1_HALF_Y);
    step(120);
    expect(game.match.p1.across).toBeCloseTo(laneAcross(0), 0);
    manager.pointerMove(1, CENTRE_X + laneAcross(2), P1_HALF_Y);
    step(120);
    expect(game.match.p1.across).toBeCloseTo(laneAcross(2), 0);
  });

  it('never asks for more road than there is', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, COURSE_WIDTH + 400, P1_HALF_Y);
    step(200);
    expect(game.match.p1.across).toBeCloseTo(ACROSS_LIMIT, 8);
  });

  it('"and flick it up to hop" — seat one flicks towards the far end of its own half', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, CENTRE_X, P1_HALF_Y);
    step(2);
    expect(game.match.p1.hops).toBe(0);
    manager.pointerMove(1, CENTRE_X, P1_HALF_Y - SWIPE_RISE - 10);
    step(1);
    expect(game.match.p1.hops).toBe(1);
  });

  it('"and flick it up to hop" — seat two flicks the other way in device coordinates', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(2, CENTRE_X, P2_HALF_Y);
    step(2);
    expect(game.match.p2.hops).toBe(0);
    manager.pointerMove(2, CENTRE_X, P2_HALF_Y + SWIPE_RISE + 10);
    step(1);
    expect(game.match.p2.hops).toBe(1);
  });

  it('does not hop for a flick the other way', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, CENTRE_X, P1_HALF_Y - 200);
    step(2);
    manager.pointerMove(1, CENTRE_X, P1_HALF_Y);
    step(4);
    expect(game.match.p1.hops).toBe(0);
  });

  it('does not hop for a finger that is merely resting high up the half', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, CENTRE_X, BAND_TOP + 10);
    step(300);
    expect(game.match.p1.hops).toBe(0);
  });

  it('does not hop for a slide straight across the road', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, ROAD_LEFT, P1_HALF_Y);
    step(2);
    for (let i = 0; i < 20; i += 1) {
      manager.pointerMove(1, ROAD_LEFT + i * 24, P1_HALF_Y);
      step(2);
    }
    expect(game.match.p1.hops).toBe(0);
  });

  it('re-arms after the finger comes back down the half', () => {
    const { game, manager, step } = rig();
    game.match.track.fill(CLEAR);
    manager.pointerDown(1, CENTRE_X, P1_HALF_Y);
    step(2);
    manager.pointerMove(1, CENTRE_X, P1_HALF_Y - SWIPE_RISE - 10);
    step(1);
    expect(game.match.p1.hops).toBe(1);
    manager.pointerMove(1, CENTRE_X, P1_HALF_Y);
    // Long enough for the first hop to land and settle, so the second is refused by nothing.
    step(200);
    manager.pointerMove(1, CENTRE_X, P1_HALF_Y - SWIPE_RISE - 10);
    step(1);
    expect(game.match.p1.hops).toBe(2);
  });

  it('costs one hop for a long slow slide, not thirty', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, CENTRE_X, COURSE_HEIGHT - 20);
    step(2);
    for (let i = 1; i <= 40; i += 1) {
      manager.pointerMove(1, CENTRE_X, COURSE_HEIGHT - 20 - i * 10);
      step(1);
    }
    // Four hundred units of travel is four flicks' worth, not four hundred steps' worth.
    expect(game.match.p1.hops).toBeLessThanOrEqual(5);
    expect(game.match.p1.hops).toBeGreaterThanOrEqual(1);
  });

  it('lifting the finger asks for nothing at all', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, CENTRE_X + 150, P1_HALF_Y);
    step(30);
    const held = game.match.p1.across;
    manager.pointerUp(1);
    step(60);
    expect(game.match.p1.across).toBe(held);
    expect(game.match.p1.hops).toBe(0);
  });

  it('keeps a finger with the seat it started in, even across the midline', () => {
    // The engine owns this and the game must not reimplement it. A drag that crosses into
    // the other half keeps steering the taxi it began with.
    const { game, manager, step } = rig();
    manager.pointerDown(1, CENTRE_X + laneAcross(3), P1_HALF_Y);
    step(60);
    manager.pointerMove(1, CENTRE_X + laneAcross(0), 200);
    step(120);
    expect(game.match.p1.across).toBeCloseTo(laneAcross(0), 0);
    expect(game.match.p2.across).toBe(0);
  });

  it('never lets a finger in one half reach the other seat’s taxi', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, CENTRE_X + 200, P1_HALF_Y);
    step(60);
    expect(game.match.p2.across).toBe(0);
    manager.pointerUp(1);
    manager.pointerDown(2, CENTRE_X + 200, P2_HALF_Y);
    const held = game.match.p1.across;
    step(60);
    expect(game.match.p1.across).toBe(held);
    expect(game.match.p2.across).toBeLessThan(0);
  });

  it('lets the two instruments be used together, with no mode to switch', () => {
    // A finger names the lane and a key still hops, at the same time.
    const { game, manager, step } = rig();
    manager.pointerDown(1, CENTRE_X + laneAcross(3), P1_HALF_Y);
    step(30);
    manager.keyDown('KeyW');
    step(1);
    expect(game.match.p1.hops).toBe(1);
    expect(game.match.p1.across).toBeGreaterThan(0);
  });

  it('gives the finger the last word on the lane while it is down', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyA');
    manager.pointerDown(1, CENTRE_X + laneAcross(3), P1_HALF_Y);
    step(120);
    expect(game.match.p1.across).toBeCloseTo(laneAcross(3), 0);
  });
});

describe('the two instruments reach the same game', () => {
  function drive(instrument: 'keyboard' | 'pointer'): TaxiRaceGame {
    const { game, manager, step } = rig(makeContext(77));
    for (let block = 0; block < 40; block += 1) {
      const lane = block % LANES;
      if (instrument === 'keyboard') {
        const wanted = laneAcross(lane);
        for (let i = 0; i < 30; i += 1) {
          const gap = wanted - game.match.p1.across;
          manager.keyUp('KeyA');
          manager.keyUp('KeyD');
          if (gap > 4) manager.keyDown('KeyD');
          else if (gap < -4) manager.keyDown('KeyA');
          step(1);
        }
        manager.keyDown('KeyW');
        step(1);
        manager.keyUp('KeyW');
        step(4);
      } else {
        manager.pointerDown(1, CENTRE_X + laneAcross(lane), P1_HALF_Y);
        step(30);
        manager.pointerMove(1, CENTRE_X + laneAcross(lane), P1_HALF_Y - SWIPE_RISE - 10);
        step(1);
        manager.pointerMove(1, CENTRE_X + laneAcross(lane), P1_HALF_Y);
        step(4);
      }
    }
    return game;
  }

  it('lets a keyboard pick every lane and hop', () => {
    const game = drive('keyboard');
    expect(game.match.p1.hops).toBeGreaterThan(8);
    expect(game.match.p1.distance).toBeGreaterThan(CELL_LENGTH * 5);
  });

  it('lets a thumb pick every lane and hop', () => {
    const game = drive('pointer');
    expect(game.match.p1.hops).toBeGreaterThan(8);
    expect(game.match.p1.distance).toBeGreaterThan(CELL_LENGTH * 5);
  });

  it('gets the same number of hops out of both, because neither repeats faster', () => {
    // The one place a keyboard could out-run a thumb is a discrete act. The script asks for
    // forty hops through both instruments and the taxi grants the same thirteen to each: what
    // limits a hop is the suspension, not how quickly the instrument can say so.
    expect(drive('keyboard').match.p1.hops).toBe(drive('pointer').match.p1.hops);
  });

  it('gets them both down the road at a comparable pace', () => {
    const keyboard = drive('keyboard').match.p1.distance;
    const pointer = drive('pointer').match.p1.distance;
    expect(Math.abs(keyboard - pointer) / Math.max(keyboard, pointer)).toBeLessThan(0.2);
  });
});

describe('the input mapping, in the seats’ own frames', () => {
  it('reads a finger’s x as how far across the driver’s own road it is', () => {
    expect(pointerAcross('p1', CENTRE_X)).toBe(0);
    expect(pointerAcross('p2', CENTRE_X)).toBe(0);
    expect(pointerAcross('p1', CENTRE_X + 100)).toBe(100);
    expect(pointerAcross('p2', CENTRE_X + 100)).toBe(-100);
  });

  it('clamps a finger off the edge of the device to the kerb', () => {
    expect(pointerAcross('p1', COURSE_WIDTH * 5)).toBe(ACROSS_LIMIT);
    expect(pointerAcross('p1', -COURSE_WIDTH * 5)).toBe(-ACROSS_LIMIT);
    expect(pointerAcross('p2', COURSE_WIDTH * 5)).toBe(-ACROSS_LIMIT);
  });

  it('reads a coordinate that is not a number as the middle of the road', () => {
    expect(pointerAcross('p1', Number.NaN)).toBe(0);
    expect(pointerAcross('p2', Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('measures "up the road" from each driver’s own edge of the device', () => {
    expect(pointerAlong('p1', COURSE_HEIGHT)).toBe(0);
    expect(pointerAlong('p1', BAND_TOP)).toBe(BAND_TOP);
    expect(pointerAlong('p2', 0)).toBe(0);
    expect(pointerAlong('p2', BAND_TOP)).toBe(BAND_TOP);
  });

  it('makes a flick up the same gesture for both seats', () => {
    const p1Rise = pointerAlong('p1', 800) - pointerAlong('p1', 900);
    const p2Rise = pointerAlong('p2', 200) - pointerAlong('p2', 100);
    expect(p1Rise).toBe(p2Rise);
    expect(p1Rise).toBe(100);
  });
});

describe('the window on the road', () => {
  it('maps a taxi’s own position to where the taxi is drawn', () => {
    expect(trackToScreenY(1000, 1000)).toBe(TAXI_SCREEN_Y);
  });

  it('puts the far edge of the window exactly where the visible road ends', () => {
    expect(trackToScreenY(VISIBLE_AHEAD, 0)).toBeCloseTo(VIEW_TOP_Y, 8);
  });

  it('scales the road by the same amount for both seats, so neither sees further', () => {
    expect(VIEW_SCALE).toBe((TAXI_SCREEN_Y - VIEW_TOP_Y) / VISIBLE_AHEAD);
    expect(VIEW_TOP_Y).toBeGreaterThan(BAND_TOP);
  });

  it('keeps the road inside the box', () => {
    expect(ROAD_LEFT).toBeGreaterThan(0);
    expect(ROAD_RIGHT).toBeLessThan(COURSE_WIDTH);
  });
});

describe('what the screen shows', () => {
  it('draws something at all', () => {
    const { game } = rig();
    const renderer = draw(game);
    expect(renderer.ops.length).toBeGreaterThan(40);
    expect(renderer.ops[0]?.op).toBe('clear');
  });

  it('never draws outside the logical box', () => {
    const { game, step } = rig(makeContext(3, 'hard', 'hard'));
    for (let sample = 0; sample < 40; sample += 1) {
      step(31);
      const renderer = draw(game);
      for (const [x, y, width, height] of rects(renderer) as [number, number, number, number][]) {
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(x + width).toBeLessThanOrEqual(COURSE_WIDTH + 1);
        expect(y + height).toBeLessThanOrEqual(COURSE_HEIGHT + 1);
      }
    }
  });

  it('never draws one seat’s window into the other seat’s half', () => {
    const { game, step } = rig(makeContext(9, 'hard', 'easy'));
    for (let sample = 0; sample < 20; sample += 1) {
      step(37);
      for (const [x, y, width, height] of rects(draw(game)) as [number, number, number, number][]) {
        // The divider is the one shape that belongs to neither seat.
        const divider = y < BAND_TOP && y + height > BAND_TOP;
        if (divider) {
          expect(x).toBe(0);
          expect(width).toBe(COURSE_WIDTH);
          continue;
        }
        expect(y >= BAND_TOP || y + height <= BAND_TOP).toBe(true);
      }
    }
  });

  it('draws the two windows as each other, turned half a turn', () => {
    // Rule 9 as a property of the drawing: apart from the cab itself, every shape one seat
    // is shown is a shape the other seat is shown too.
    const { game } = rig(makeContext(4));
    const { near, far } = byFrame(draw(game));
    expect(near.length).toBeGreaterThan(30);
    expect(keysOf(near, (entry) => !overCab(entry))).toEqual(
      keysOf(far, (entry) => !overCab(entry)),
    );
  });

  it('draws the two cabs differently, so colour is never the only signal', () => {
    const { game } = rig(makeContext(4));
    const { near, far } = byFrame(draw(game));
    expect(keysOf(near, overCab)).not.toEqual(keysOf(far, overCab));
    expect(keysOf(near, overCab).length).toBeGreaterThan(2);
    expect(keysOf(far, overCab).length).toBeGreaterThan(2);
  });

  it('draws a shadow under a taxi that is in the air, and none under one that is not', () => {
    const { game, manager, step } = rig();
    const grounded = rects(draw(game)).length;
    manager.keyDown('KeyW');
    step(2);
    expect(game.match.p1.hop).toBeGreaterThan(0);
    expect(rects(draw(game)).length).toBeGreaterThan(grounded);
  });

  it('lifts the cab up its own window as the hop goes on', () => {
    const { game, manager, step } = rig();
    // An empty road, so the only cab-sized things in the picture are the cab and its shadow.
    game.match.track.fill(CLEAR);
    manager.keyDown('KeyW');
    step(1);
    const noses: number[] = [];
    for (let sample = 0; sample < 7; sample += 1) {
      const cab = rects(draw(game)).filter(
        (entry) => entry[1]! > 700 && entry[1]! < 960 && entry[2]! >= 60 && entry[2]! <= 90,
      );
      expect(cab.length).toBeGreaterThan(0);
      noses.push(Math.min(...cab.map((entry) => entry[1]!)));
      step(6);
    }
    // It rises off the road and it is drawn bigger as it does, so the top edge climbs by
    // much more than a rounding error.
    expect(Math.min(...noses)).toBeLessThan(noses[0]! - 20);
  });

  it('paints a ramp across the road wherever a jam has to be jumped', () => {
    const { game } = rig(makeContext(5));
    // Find the first jam and drive to within sight of it.
    let jam = -1;
    for (let cell = 0; cell < RACE_CELLS && jam < 0; cell += 1) {
      if (maskAt(game.match.track, cell) === JAM) jam = cell;
    }
    expect(jam).toBeGreaterThan(0);
    game.match.p1.distance = trafficAlong(jam) - HOP_AIM - 100;
    const rampY = trackToScreenY(trafficAlong(jam) - HOP_AIM, game.match.p1.distance);
    const banded = rects(draw(game)).filter(
      (entry) => Math.abs(entry[1]! - (rampY - 7)) < 1 && entry[2]! === ROAD_RIGHT - ROAD_LEFT,
    );
    expect(banded.length).toBe(1);
  });

  it('draws traffic in every blocked lane and none in an open one', () => {
    const { game } = rig(makeContext(6));
    const match = game.match;
    match.track.fill(CLEAR);
    match.track[3] = (1 << 0) | (1 << 2);
    match.p1.distance = trafficAlong(3) - 200;
    match.p2.distance = trafficAlong(3) - 200;
    const centre = trackToScreenY(trafficAlong(3), match.p1.distance);
    const cars = rects(draw(game)).filter(
      (entry) => entry[2]! === 72 && Math.abs(entry[1]! + entry[3]! / 2 - centre) < 1,
    );
    expect(cars.length).toBe(2);
    const xs = cars.map((entry) => entry[0]! + 36).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(CENTRE_X + laneAcross(0), 6);
    expect(xs[1]).toBeCloseTo(CENTRE_X + laneAcross(2), 6);
  });

  /**
   * Rule 6, closed against the *picture* rather than against two constants.
   *
   * `BOT_LOOKAHEAD < VISIBLE_AHEAD` compares two numbers neither of which is what either
   * driver actually gets: the bot walked whole cells and reached 770 units, and a person's
   * window keeps drawing a car until its tail leaves the band, which is 788. The rule was
   * being kept by eighteen units nobody had measured. This measures both ends — the
   * furthest traffic the renderer really puts on the glass, and the furthest the bot's own
   * `readAhead` will return — and asserts the order between them.
   */
  it('never lets the bot read road the window has not drawn', () => {
    const { game } = rig(makeContext(31));
    const match = game.match;
    match.track.fill(CLEAR);
    // One queue, walked backwards away from the taxi until the window stops drawing it.
    const cell = 20;
    match.track[cell] = (1 << 0) | (1 << 1);
    let drawnUpTo = 0;
    for (let back = 600; back < 900; back += 1) {
      match.p1.distance = trafficAlong(cell) - back;
      match.p2.distance = match.p1.distance;
      const centre = trackToScreenY(trafficAlong(cell), match.p1.distance);
      const cars = rects(draw(game)).filter(
        (entry) => entry[2]! === 72 && entry[1]! < centre + 40 && entry[1]! + entry[3]! > BAND_TOP,
      );
      if (cars.length > 0) drawnUpTo = back;
    }
    let botReadsUpTo = 0;
    for (let back = 0; back < 900; back += 1) {
      match.p1.distance = trafficAlong(cell) - back;
      if (readAhead(match, 'p1', BOT_LOOKAHEAD) === cell) botReadsUpTo = back;
    }
    expect(botReadsUpTo).toBeLessThanOrEqual(BOT_LOOKAHEAD);
    expect(botReadsUpTo).toBeLessThan(drawnUpTo);
    // and the margin is one the drawing owns, not one that happens to fall out of the cells
    expect(drawnUpTo - botReadsUpTo).toBeGreaterThan(CELL_LENGTH / 2);
  });

  it('does not mutate anything when it draws', () => {
    const { game, step } = rig(makeContext(8, 'normal', 'normal'));
    step(400);
    const before = JSON.stringify(game.match);
    draw(game);
    draw(game);
    expect(JSON.stringify(game.match)).toBe(before);
  });

  it('draws a route strip carrying both taxis, for both seats', () => {
    const { game, step } = rig(makeContext(12, 'hard', 'easy'));
    step(900);
    const { near, far } = byFrame(draw(game));
    // Three tab-width shapes in each window: one solid tab for the taxi that seat is driving,
    // and two bars of an open one for its rival. The hop pip beside them is per-seat state
    // and is deliberately *not* counted here — a seat whose taxi is mid-hop shows a different
    // pip from one whose taxi is on the road, which is the point of it.
    const tabs = (shapes: readonly Shape[]): number =>
      shapes.filter(
        (entry) => entry.y0 > 950 && entry.y1 < 995 && Math.abs(entry.x1 - entry.x0 - 14) < 1e-6,
      ).length;
    expect(tabs(near)).toBe(3);
    expect(tabs(far)).toBe(3);
    expect(game.match.p1.distance).not.toBe(game.match.p2.distance);
  });
});

describe('the game contract', () => {
  it('reports no active seat, because both taxis are live at once', () => {
    const { game } = rig();
    expect(game.getActiveSeat()).toBeNull();
  });

  it('scores in city blocks and names no winner until there is one', () => {
    const { game, step } = rig(makeContext(2, 'normal', 'normal'));
    step(60);
    const score = game.getScore();
    expect(score.p1).toBeGreaterThanOrEqual(0);
    expect(score.p1).toBeLessThanOrEqual(RACE_CELLS);
    expect(score.winner).toBeNull();
  });

  it('names a winner once somebody is home, and then stops', () => {
    const { game, step } = rig(makeContext(2, 'hard', 'easy'));
    let ended = -1;
    for (let sample = 0; sample < 400 && ended < 0; sample += 1) {
      step(30);
      if (game.getScore().winner !== null) ended = sample;
    }
    expect(ended).toBeGreaterThanOrEqual(0);
    const frozen = game.match.p1.distance;
    step(120);
    expect(game.match.p1.distance).toBe(frozen);
  });

  it('always reaches a decision with two bots driving', () => {
    for (const tier of TIERS) {
      const { game, step } = rig(makeContext(30, tier, tier));
      let winner: SeatId | 'draw' | null = null;
      for (let sample = 0; sample < 300 && winner === null; sample += 1) {
        step(30);
        winner = game.getScore().winner;
      }
      expect(winner, tier).not.toBeNull();
    }
  });

  it('starts a fresh match on init and leaves nothing behind on destroy', () => {
    const { game, step } = rig(makeContext(2, 'hard', 'hard'));
    step(600);
    expect(game.match.p1.distance).toBeGreaterThan(0);
    game.destroy();
    expect(game.match.p1.distance).toBe(0);
    expect(game.match.p2.distance).toBe(0);
    expect(game.match.winner).toBeNull();
    expect(game.getScore().winner).toBeNull();
  });

  it('drops a half-made flick when the match is torn down', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, CENTRE_X, P1_HALF_Y);
    step(2);
    game.destroy();
    game.init(makeContext(2));
    manager.pointerMove(1, CENTRE_X, P1_HALF_Y - SWIPE_RISE - 10);
    step(1);
    // The ratchet was reset, so this reading is a fresh base rather than a flick.
    expect(game.match.p1.hops).toBe(0);
  });

  it('hops nothing across a pause and a resume', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyW');
    step(2);
    expect(game.match.p1.hops).toBe(1);
    game.onPause();
    manager.clear();
    step(2);
    game.onResume();
    step(60);
    // The engine dropped the key, and a key nobody is pressing cannot hop a taxi.
    expect(game.match.p1.hops).toBe(1);
  });

  it('answers the SDK’s own interface, alpha and all', () => {
    const game: Game = new TaxiRaceGame();
    game.init(makeContext(1));
    game.update(STEP, new InputView().sync(new InputManager(manifest.logical).beginStep(STEP)));
    game.render(new RecordingRenderer(), 0);
    expect(game.getScore().p1).toBe(0);
    game.destroy();
  });

  it('never reads the interpolation alpha, so a frame is the state as it stands', () => {
    const game: Game = new TaxiRaceGame();
    game.init(makeContext(1));
    const a = new RecordingRenderer();
    const b = new RecordingRenderer();
    game.render(a, 0);
    game.render(b, 0.9);
    expect(JSON.stringify(b.ops)).toBe(JSON.stringify(a.ops));
    game.destroy();
  });
});

describe('determinism', () => {
  it('plays the identical match twice from one seed', () => {
    function run(): string {
      const { game, step } = rig(makeContext(4242, 'normal', 'hard'));
      step(1800);
      return JSON.stringify(game.match);
    }
    expect(run()).toBe(run());
  });

  it('draws the identical road for both seat orders on one seed', () => {
    const a = rig(makeContext(31, 'hard', null)).game;
    const b = rig(makeContext(31, null, 'hard')).game;
    expect([...a.match.track]).toEqual([...b.match.track]);
  });

  it('does not care which presentation it is running in', () => {
    function run(presentation: Presentation, localSeat: SeatId): string {
      const { game, step } = rig(makeContext(77, 'normal', 'normal', presentation, localSeat));
      step(900);
      return JSON.stringify(game.match);
    }
    expect(run('single-seat', 'p2')).toBe(run('shared-screen', 'p1'));
  });

  it('plays the same match whatever the step count is broken into', () => {
    const a = rig(makeContext(5, 'hard', 'hard'));
    const b = rig(makeContext(5, 'hard', 'hard'));
    a.step(600);
    for (let i = 0; i < 600; i += 1) b.step(1);
    expect(JSON.stringify(a.game.match)).toBe(JSON.stringify(b.game.match));
  });
});

describe('the bot, through the game', () => {
  it('is wired to the tier the shell hands it', () => {
    function trace(tier: BotDifficulty): string {
      const { game, step } = rig(makeContext(19, tier, tier));
      step(900);
      return JSON.stringify(game.match);
    }
    expect(trace('easy')).not.toBe(trace('normal'));
    expect(trace('normal')).not.toBe(trace('hard'));
  });

  it('plays a different match from two absent humans', () => {
    const bots = rig(makeContext(19, 'normal', 'normal'));
    const nobody = rig(makeContext(19, null, null));
    bots.step(900);
    nobody.step(900);
    expect(JSON.stringify(bots.game.match)).not.toBe(JSON.stringify(nobody.game.match));
  });

  it('takes no input from the instruments in a seat it is driving', () => {
    const { game, manager, step } = rig(makeContext(19, 'hard', null));
    manager.keyDown('KeyA');
    manager.pointerDown(1, ROAD_LEFT, P1_HALF_Y);
    step(120);
    const withInput = JSON.stringify(game.match.p1);
    const quiet = rig(makeContext(19, 'hard', null));
    quiet.step(120);
    expect(JSON.stringify(quiet.game.match.p1)).toBe(withInput);
  });

  it('leaves a human seat entirely to the human', () => {
    const { game, manager, step } = rig(makeContext(19, null, 'hard'));
    step(120);
    expect(game.match.p1.across).toBe(0);
    expect(game.match.p1.hops).toBe(0);
    manager.keyDown('KeyD');
    step(6);
    expect(game.match.p1.across).toBeGreaterThan(0);
  });
});

describe('the rule the game is named after, through the whole game', () => {
  it('has taxis driving past traffic and hopping over it in every bot match', () => {
    // Counted through the public surface, over seeded matches played end to end, because a
    // game whose headline verb never fires passes every global guard in the repository.
    let matches = 0;
    let passed = 0;
    let vaulted = 0;
    let withoutPass = 0;
    let withoutVault = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const { game, step } = rig(makeContext(1 + seed * 7919, 'normal', 'normal'));
      for (let sample = 0; sample < 400 && game.getScore().winner === null; sample += 1) {
        step(30);
      }
      expect(game.getScore().winner).not.toBeNull();
      const both = game.match.p1.passed + game.match.p2.passed;
      const air = game.match.p1.vaulted + game.match.p2.vaulted;
      matches += 1;
      passed += both;
      vaulted += air;
      if (both === 0) withoutPass += 1;
      if (air === 0) withoutVault += 1;
    }
    expect(matches).toBe(20);
    expect(withoutPass).toBe(0);
    expect(withoutVault).toBe(0);
    expect(passed / matches).toBeGreaterThan(12);
    expect(vaulted / matches).toBeGreaterThan(3);
  });

  it('has a human on a keyboard hopping a jam they could not have driven round', () => {
    const { game, manager, step } = rig(makeContext(5, null, 'easy'));
    const match = game.match;
    match.track.fill(CLEAR);
    match.track[6] = JAM;
    const centre = trafficAlong(6);
    let hopped = false;
    for (let i = 0; i < 1200; i += 1) {
      if (!hopped && match.p1.distance >= centre - HOP_AIM) {
        manager.keyDown('KeyW');
        hopped = true;
      }
      step(1);
      if (match.p1.distance > centre + 400) break;
    }
    expect(match.p1.vaulted).toBe(1);
    expect(match.p1.crashes).toBe(0);
  });

  it('has that same human crash into it if they never hop', () => {
    const { game, step } = rig(makeContext(5, null, 'easy'));
    const match = game.match;
    match.track.fill(CLEAR);
    match.track[6] = JAM;
    step(1200);
    expect(match.p1.crashes).toBe(1);
    expect(match.p1.vaulted).toBe(0);
  });
});

describe('both seats, symmetrically', () => {
  it('gives each seat the same taxi and the same road', () => {
    for (const seat of SEATS) {
      const { game, manager, step } = rig();
      if (seat === 'p1') manager.keyDown('KeyD');
      else manager.keyDown('ArrowRight');
      step(30);
      const mine = seat === 'p1' ? game.match.p1 : game.match.p2;
      const theirs = seat === 'p1' ? game.match.p2 : game.match.p1;
      expect(mine.across).toBeGreaterThan(0);
      expect(theirs.across).toBe(0);
      expect(mine.distance).toBeCloseTo(theirs.distance, 10);
    }
  });

  it('plays a mirrored match to a mirrored result', () => {
    const straight = rig(makeContext(64));
    const swapped = rig(makeContext(64));
    straight.manager.keyDown('KeyD');
    straight.manager.keyDown('ArrowLeft');
    swapped.manager.keyDown('KeyA');
    swapped.manager.keyDown('ArrowRight');
    straight.step(900);
    swapped.step(900);
    expect(swapped.game.match.p2.across).toBeCloseTo(straight.game.match.p1.across, 10);
    expect(swapped.game.match.p2.distance).toBeCloseTo(straight.game.match.p1.distance, 10);
    expect(swapped.game.match.p1.across).toBeCloseTo(straight.game.match.p2.across, 10);
  });

  it('finishes on the same line for both, whoever gets there', () => {
    expect(RACE_DISTANCE).toBe(RACE_CELLS * CELL_LENGTH);
    const { game, step } = rig(makeContext(2, 'hard', 'hard'));
    for (let sample = 0; sample < 400 && game.getScore().winner === null; sample += 1) step(30);
    const winner = game.getScore().winner;
    expect(winner).not.toBeNull();
    if (winner === 'p1') expect(game.match.p1.distance).toBe(RACE_DISTANCE);
    if (winner === 'p2') expect(game.match.p2.distance).toBe(RACE_DISTANCE);
  });
});
