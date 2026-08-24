import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  AIM_DEADZONE,
  CarromGame,
  HOLD_FOR_FULL_POWER,
  REACH_FOR_FULL_POWER,
  SETTLE_SECONDS,
  THINK_SECONDS,
} from './game.js';
import {
  BASE_HALF,
  CENTRE_X,
  CENTRE_Y,
  MAX_AIM,
  PUCKS_PER_SIDE,
  SHOT_LIMIT,
  STRIKER_RADIUS,
  forwardOf,
  otherOf,
  queenOf,
  remaining,
  rightOf,
  strikerOf,
  strikerXFor,
  strikerYFor,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];
/** Long enough for the seat flip to finish and settle. */
const AFTER_FLIP = 40;

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

/**
 * One seat's input, written by the test rather than by a device.
 *
 * The mutable record is held here and handed out through the readonly view the contract
 * declares, so the test never writes through a `SeatInput`.
 */
class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionHeld = true;
    target.actionReleased = false;
  }

  lift(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionHeld = false;
    target.actionReleased = true;
  }

  hold(seat: SeatId, seconds: number): void {
    const target = this.#of(seat);
    target.actionHeld = true;
    target.actionReleased = false;
    target.holdSeconds = seconds;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionHeld = false;
    target.actionReleased = true;
  }

  quiet(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionHeld = false;
    target.actionReleased = false;
    target.holdSeconds = 0;
    target.pointer = null;
    target.move.x = 0;
    target.move.y = 0;
  }

  steer(seat: SeatId, x: number, y = 0): void {
    const target = this.#of(seat);
    target.move.x = x;
    target.move.y = y;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

interface ContextOptions {
  readonly seed?: number;
  readonly botP1?: BotDifficulty | null;
  readonly botP2?: BotDifficulty | null;
  readonly presentation?: Presentation;
  readonly localSeat?: SeatId;
}

function makeContext(options: ContextOptions = {}): GameContext {
  const botP1 = options.botP1 ?? null;
  const botP2 = options.botP2 ?? null;
  return {
    manifest,
    rng: new Rng(options.seed ?? 1),
    presentation: options.presentation ?? 'shared-screen',
    localSeat: options.localSeat ?? 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

type DrawArg = number | string | boolean | undefined;

interface DrawCall {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

class RecordingRenderer implements Renderer {
  readonly calls: DrawCall[] = [];

  get ops(): string[] {
    return this.calls.map((call) => call.op);
  }

  texts(): string[] {
    return this.calls
      .filter((call) => call.op === 'text')
      .map((call) => String(call.args[0] ?? ''));
  }

  clear(colour: string): void {
    this.#record('clear', colour);
  }
  rect(x: number, y: number, w: number, h: number, colour: string): void {
    this.#record('rect', x, y, w, h, colour);
  }
  strokeRect(x: number, y: number, w: number, h: number, lineWidth: number, colour: string): void {
    this.#record('strokeRect', x, y, w, h, lineWidth, colour);
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

  #record(op: string, ...values: DrawArg[]): void {
    this.calls.push({ op, args: values });
  }
}

function fresh(options: ContextOptions = {}): { game: CarromGame; input: ScriptedInput } {
  const game = new CarromGame();
  game.init(makeContext(options));
  return { game, input: new ScriptedInput() };
}

/** Run the loop until the board is aiming again, or the frame ends. Always bounded. */
function runUntilAiming(game: CarromGame, input: ScriptedInput, cap = 60 * 20): number {
  for (let i = 1; i <= cap; i += 1) {
    game.update(STEP, input);
    if (game.state.phase === 'aiming' || game.state.phase === 'over') return i;
  }
  return -1;
}

function idle(game: CarromGame, input: ScriptedInput, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, input);
}

describe('the shell contract', () => {
  it('says whose turn it is, because it is a turn game', () => {
    const { game } = fresh();
    expect(manifest.archetype.startsWith('turn-')).toBe(true);
    expect(typeof game.getActiveSeat).toBe('function');
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('keeps the reported turn and the simulation’s own idea of it in step', () => {
    const { game, input } = fresh();
    game.state.seat = 'p2';
    game.update(STEP, input);
    expect(game.getActiveSeat()).toBe('p2');
  });

  it('reports the score as pucks potted, and no winner until there is one', () => {
    const { game } = fresh();
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBe(null);
  });

  it('starts a fresh frame on every init', () => {
    const { game, input } = fresh();
    idle(game, input, 5);
    game.state.seat = 'p2';
    game.state.shots = 30;
    game.init(makeContext({ seed: 9 }));
    expect(game.state.seat).toBe('p1');
    expect(game.state.shots).toBe(0);
    expect(game.getScore().winner).toBe(null);
    expect(remaining(game.state, 'p1')).toBe(PUCKS_PER_SIDE);
  });

  it('puts the striker on the baseline before the first update', () => {
    const { game } = fresh();
    expect(strikerOf(game.state).y).toBe(strikerYFor('p1'));
    expect(strikerOf(game.state).potted).toBe(false);
  });

  it('lets go of everything on destroy', () => {
    const { game, input } = fresh();
    idle(game, input, 5);
    game.destroy();
    expect(game.getScore().winner).toBe(null);
    expect(game.power).toBe(0);
    expect(game.aimAngle).toBe(0);
    expect(game.state.shots).toBe(0);
  });

  it('forgets a half-built stroke when the match is paused', () => {
    const { game, input } = fresh();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    expect(game.power).toBeGreaterThan(0);
    game.onPause();
    expect(game.power, 'nobody comes back to a striker half flicked').toBe(0);
    game.onResume();
  });

  it('survives a zero-length step without deciding the frame rate from it', () => {
    const { game, input } = fresh();
    game.update(0, input);
    game.update(STEP, input);
    expect(game.state.phase).toBe('aiming');
  });
});

describe('placing and aiming with a thumb', () => {
  it('slides the striker when the finger is behind the shooter’s own line', () => {
    const { game, input } = fresh();
    // Behind seat one's baseline is further down the board than the line itself.
    input.point('p1', CENTRE_X + 120, strikerYFor('p1') + 40);
    game.update(STEP, input);
    expect(game.state.offset).toBeCloseTo(120 / BASE_HALF, 4);
    // The striker is placed at the top of the step, so the slide asked for on one step is
    // where it is standing on the next. That is what makes what is drawn what is flicked.
    game.update(STEP, input);
    expect(strikerOf(game.state).x).toBeCloseTo(strikerXFor('p1', 120 / BASE_HALF), 4);
  });

  it('clamps a slide to the ends of the line', () => {
    const { game, input } = fresh();
    input.point('p1', CENTRE_X + 4000, strikerYFor('p1') + 40);
    game.update(STEP, input);
    expect(game.state.offset).toBe(1);
    input.point('p1', CENTRE_X - 4000, strikerYFor('p1') + 40);
    game.update(STEP, input);
    expect(game.state.offset).toBe(-1);
  });

  it('aims along the line from the striker to the finger, once the finger is in the board', () => {
    const { game, input } = fresh();
    const striker = strikerOf(game.state);
    input.point('p1', striker.x, striker.y - 200);
    game.update(STEP, input);
    expect(Math.abs(game.aimAngle), 'straight up the board').toBeLessThan(0.01);
    input.point('p1', striker.x + 200, striker.y - 200);
    game.update(STEP, input);
    expect(game.aimAngle, 'to the shooter’s own right').toBeGreaterThan(0.5);
  });

  it('takes the power from how far into the board the drag reached', () => {
    const { game, input } = fresh();
    const striker = strikerOf(game.state);
    input.point('p1', striker.x, striker.y - REACH_FOR_FULL_POWER / 2);
    game.update(STEP, input);
    expect(game.power).toBeCloseTo(0.5, 2);
  });

  it('clamps a very long drag to a full-strength stroke', () => {
    const { game, input } = fresh();
    const striker = strikerOf(game.state);
    input.point('p1', striker.x, striker.y - REACH_FOR_FULL_POWER * 4);
    game.update(STEP, input);
    expect(game.power).toBe(1);
  });

  it('ignores a drag too short to be a stroke', () => {
    // Otherwise resting a thumb on the striker fires it.
    const { game, input } = fresh();
    const striker = strikerOf(game.state);
    input.point('p1', striker.x, striker.y - AIM_DEADZONE / 2);
    game.update(STEP, input);
    expect(game.power).toBe(0);
  });

  it('flicks when the finger lifts, and the striker leaves the way it was pointing', () => {
    const { game, input } = fresh();
    const striker = strikerOf(game.state);
    input.point('p1', striker.x, striker.y - 200);
    game.update(STEP, input);
    input.lift('p1');
    game.update(STEP, input);
    expect(game.state.phase).toBe('rolling');
    expect(Math.sign(strikerOf(game.state).vy)).toBe(forwardOf('p1'));
  });

  it('does not flick on a lift with no drag behind it', () => {
    const { game, input } = fresh();
    input.lift('p1');
    game.update(STEP, input);
    expect(game.state.phase, 'a stray tap is not a stroke').toBe('aiming');
  });

  it('caps the aim at the cone, however wide the drag went', () => {
    const { game, input } = fresh();
    const striker = strikerOf(game.state);
    input.point('p1', striker.x + 600, striker.y - 5);
    game.update(STEP, input);
    expect(Math.abs(game.aimAngle)).toBeLessThanOrEqual(MAX_AIM + 1e-9);
  });
});

describe('placing and aiming with a keyboard', () => {
  it('slides the striker along the line with the sideways keys', () => {
    const { game, input } = fresh();
    input.steer('p1', 1);
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.state.offset).toBeGreaterThan(0);
    const right = game.state.offset;
    input.steer('p1', -1);
    for (let i = 0; i < 40; i += 1) game.update(STEP, input);
    expect(game.state.offset).toBeLessThan(right);
  });

  it('swings the aim with the up and down keys', () => {
    const { game, input } = fresh();
    const before = game.aimAngle;
    input.steer('p1', 0, 1);
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.aimAngle).not.toBe(before);
    expect(Math.abs(game.aimAngle)).toBeLessThanOrEqual(MAX_AIM + 1e-9);
  });

  it('ignores a stick barely off centre, so a resting hand does not creep', () => {
    const { game, input } = fresh();
    input.steer('p1', 0.1, 0.1);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.state.offset).toBe(0);
    expect(game.aimAngle).toBe(0);
  });

  it('builds the power while the action key is held', () => {
    const { game, input } = fresh();
    input.hold('p1', HOLD_FOR_FULL_POWER / 2);
    game.update(STEP, input);
    expect(game.power).toBeCloseTo(0.5, 2);
    input.hold('p1', HOLD_FOR_FULL_POWER * 3);
    game.update(STEP, input);
    expect(game.power).toBe(1);
  });

  it('flicks on the release', () => {
    const { game, input } = fresh();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(game.state.phase).toBe('rolling');
  });

  it('carries the power in a field rather than reading it at the release', () => {
    // `holdSeconds` is zero on the step the key comes up. A game that read it there would
    // play every keyboard stroke with no weight at all.
    const { game, input } = fresh();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(Math.hypot(strikerOf(game.state).vx, strikerOf(game.state).vy)).toBeGreaterThan(500);
  });

  it('completes a whole stroke from the keyboard alone', () => {
    const { game, input } = fresh();
    input.steer('p1', 1, 0);
    idle(game, input, 12);
    input.steer('p1', 0, 1);
    idle(game, input, 12);
    input.steer('p1', 0, 0);
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(game.state.phase).toBe('rolling');
    input.quiet('p1');
    expect(runUntilAiming(game, input)).toBeGreaterThan(0);
    expect(game.state.shots).toBe(1);
  });
});

describe('the two instruments are one game', () => {
  it('lets the pointer set the line and the keys adjust it, with no mode between them', () => {
    const { game, input } = fresh();
    const striker = strikerOf(game.state);
    input.point('p1', striker.x + 100, striker.y - 100);
    game.update(STEP, input);
    const fromThumb = game.aimAngle;
    input.steer('p1', 0, 1);
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.aimAngle).not.toBe(fromThumb);
  });

  it('does not let a held key overwrite the power a live drag is setting', () => {
    const { game, input } = fresh();
    const striker = strikerOf(game.state);
    input.point('p1', striker.x, striker.y - REACH_FOR_FULL_POWER / 4);
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    expect(game.power, 'the finger on the glass owns the weight').toBeCloseTo(0.25, 2);
  });

  it('reaches the same stroke from either instrument', () => {
    const straight = (build: (game: CarromGame, input: ScriptedInput) => void): number => {
      const { game, input } = fresh({ seed: 5 });
      build(game, input);
      return Math.hypot(strikerOf(game.state).vx, strikerOf(game.state).vy);
    };
    const byThumb = straight((game, input) => {
      const striker = strikerOf(game.state);
      input.point('p1', striker.x, striker.y - REACH_FOR_FULL_POWER);
      game.update(STEP, input);
      input.lift('p1');
      game.update(STEP, input);
    });
    const byKeys = straight((game, input) => {
      input.hold('p1', HOLD_FOR_FULL_POWER);
      game.update(STEP, input);
      input.release('p1');
      game.update(STEP, input);
    });
    expect(byKeys).toBeCloseTo(byThumb, 6);
  });
});

describe('the controls the manifest promises', () => {
  it('names the sideways keys the game reads for the slide', () => {
    expect(manifest.controls.keyboard).toMatch(/a and d/i);
    const { game, input } = fresh();
    input.steer('p1', 1);
    idle(game, input, 10);
    expect(game.state.offset, 'the horizontal axis must move the slide').toBeGreaterThan(0);
  });

  it('names the up and down keys the game reads for the aim', () => {
    expect(manifest.controls.keyboard).toMatch(/w and s/i);
    const { game, input } = fresh();
    input.steer('p1', 0, -1);
    idle(game, input, 10);
    expect(game.aimAngle, 'the vertical axis must move the aim').not.toBe(0);
  });

  it('names a hold-and-release action, which is what the game implements', () => {
    expect(manifest.controls.keyboard).toMatch(/hold .*space/i);
    expect(manifest.controls.keyboard).toMatch(/let go|release/i);
    const { game, input } = fresh();
    input.hold('p1', HOLD_FOR_FULL_POWER / 2);
    game.update(STEP, input);
    expect(game.power).toBeGreaterThan(0);
    input.release('p1');
    game.update(STEP, input);
    expect(game.state.phase).toBe('rolling');
  });

  it('gives seat two its own half of the keyboard and says so', () => {
    expect(manifest.controls.keyboard).toMatch(/player two/i);
    expect(manifest.controls.keyboard).toMatch(/arrow/i);
    expect(manifest.controls.keyboard).toMatch(/enter/i);
    // And the game reads seat two's own input on seat two's turn, never seat one's.
    const { game, input } = fresh();
    game.state.seat = 'p2';
    idle(game, input, AFTER_FLIP);
    input.steer('p1', 1);
    idle(game, input, 12);
    expect(game.state.offset, 'seat one’s keys moved seat two’s striker').toBe(0);
    input.quiet('p1');
    input.steer('p2', 1);
    idle(game, input, 12);
    expect(game.state.offset).toBeGreaterThan(0);
  });

  it('promises a touch behind the line for the slide, and delivers it', () => {
    expect(manifest.controls.pointer).toMatch(/behind your line/i);
    const { game, input } = fresh();
    input.point('p1', CENTRE_X - 100, strikerYFor('p1') + 30);
    game.update(STEP, input);
    expect(game.state.offset).toBeLessThan(0);
  });

  it('promises a drag into the board that goes further the harder it is, and delivers it', () => {
    expect(manifest.controls.pointer).toMatch(/drag into the board/i);
    expect(manifest.controls.pointer).toMatch(/further is harder/i);
    const { game, input } = fresh();
    const striker = strikerOf(game.state);
    input.point('p1', striker.x, striker.y - 60);
    game.update(STEP, input);
    const shallow = game.power;
    input.point('p1', striker.x, striker.y - 240);
    game.update(STEP, input);
    expect(game.power).toBeGreaterThan(shallow);
  });

  it('promises a release to play the stroke, and delivers it', () => {
    expect(manifest.controls.pointer).toMatch(/let go/i);
    const { game, input } = fresh();
    const striker = strikerOf(game.state);
    input.point('p1', striker.x, striker.y - 200);
    game.update(STEP, input);
    expect(game.state.phase).toBe('aiming');
    input.lift('p1');
    game.update(STEP, input);
    expect(game.state.phase).toBe('rolling');
  });

  it('promises nothing the game does not read', () => {
    // Every instrument the two lines name: the four movement keys, the action key, and a
    // pointer. There is no second button, no double tap and no gesture.
    const words = `${manifest.controls.keyboard} ${manifest.controls.pointer}`.toLowerCase();
    for (const absent of ['double', 'swipe', 'pinch', 'shift', 'tab', 'escape', 'mouse wheel']) {
      expect(words, `the manifest promises "${absent}", which nothing reads`).not.toContain(absent);
    }
  });

  it('declares the archetype, modes and box the game is actually built to', () => {
    expect(manifest.id).toBe('carrom');
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.category).toBe('Sports');
    expect([...manifest.modes].sort()).toEqual(['bot', 'friend']);
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.logical.width).toBe(2 * CENTRE_X);
    expect(manifest.logical.height).toBe(2 * CENTRE_Y);
  });
});

describe('the seats', () => {
  it('reads each seat’s slide in that seat’s own direction', () => {
    for (const seat of SEATS) {
      const { game, input } = fresh({ localSeat: seat });
      game.state.seat = seat;
      idle(game, input, AFTER_FLIP);
      input.steer(seat, 1);
      idle(game, input, 15);
      expect(game.state.offset, `${seat} slide`).toBeGreaterThan(0);
      const x = strikerOf(game.state).x;
      expect(Math.sign(x - CENTRE_X), `${seat} slid to their own right`).toBe(rightOf(seat));
    }
  });

  it('sends each seat’s stroke away from that seat', () => {
    for (const seat of SEATS) {
      const { game, input } = fresh({ localSeat: seat });
      game.state.seat = seat;
      idle(game, input, AFTER_FLIP);
      input.hold(seat, HOLD_FOR_FULL_POWER);
      game.update(STEP, input);
      input.release(seat);
      game.update(STEP, input);
      expect(Math.sign(strikerOf(game.state).vy), seat).toBe(forwardOf(seat));
    }
  });

  it('ignores input while the board is turning to face the other player', () => {
    const { game, input } = fresh();
    game.state.seat = 'p2';
    // The flip has started but not finished: a tap now would land where nobody aimed.
    game.update(STEP, input);
    input.steer('p2', 1);
    idle(game, input, 4);
    expect(game.state.offset).toBe(0);
    idle(game, input, AFTER_FLIP);
    expect(game.state.offset).toBeGreaterThan(0);
  });

  it('turns the board to face whoever is to play, sharing one device', () => {
    const { game, input } = fresh({ localSeat: 'p1', presentation: 'shared-screen' });
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const upright = renderer.calls.find((call) => call.op === 'pushRotation');
    expect(upright?.args[0]).toBe(0);

    game.state.seat = 'p2';
    idle(game, input, AFTER_FLIP);
    const turned = new RecordingRenderer();
    game.render(turned);
    const angle = turned.calls.find((call) => call.op === 'pushRotation')?.args[0];
    expect(typeof angle).toBe('number');
    expect(angle).toBeCloseTo(Math.PI, 6);
  });

  it('never turns the board on a player alone on their own device', () => {
    for (const seat of SEATS) {
      const { game, input } = fresh({ presentation: 'single-seat', localSeat: seat });
      const first = new RecordingRenderer();
      game.render(first);
      const before = first.calls.find((call) => call.op === 'pushRotation')?.args[0];
      game.state.seat = otherOf(seat);
      idle(game, input, AFTER_FLIP);
      const after = new RecordingRenderer();
      game.render(after);
      expect(after.calls.find((call) => call.op === 'pushRotation')?.args[0], seat).toBe(before);
    }
  });

  it('steps the identical match whichever way it is presented', () => {
    const trace = (presentation: Presentation, localSeat: SeatId): string => {
      const game = new CarromGame();
      game.init(
        makeContext({ seed: 77, botP1: 'normal', botP2: 'normal', presentation, localSeat }),
      );
      const input = new ScriptedInput();
      for (let i = 0; i < 60 * 20; i += 1) game.update(STEP, input);
      return game.state.bodies
        .map((b) => `${b.x.toFixed(6)},${b.y.toFixed(6)},${String(b.potted)}`)
        .join('|');
    };
    const shared = trace('shared-screen', 'p1');
    expect(trace('single-seat', 'p1')).toBe(shared);
    expect(trace('single-seat', 'p2')).toBe(shared);
    expect(trace('shared-screen', 'p2')).toBe(shared);
  });
});

describe('the bot at the board', () => {
  it('looks at the board before it plays, rather than firing on the first step', () => {
    const { game, input } = fresh({ botP1: 'normal' });
    const think = Math.round(THINK_SECONDS * 60);
    for (let i = 0; i < think - 1; i += 1) {
      game.update(STEP, input);
      expect(game.state.phase, `step ${String(i)}`).toBe('aiming');
    }
    idle(game, input, 3);
    expect(game.state.phase).toBe('rolling');
  });

  it('never plays a stroke for a seat a person is sitting in', () => {
    const { game, input } = fresh({ botP1: null, botP2: 'hard' });
    idle(game, input, 60 * 5);
    expect(game.state.phase, 'the bot played seat one’s stroke').toBe('aiming');
    expect(game.state.shots).toBe(0);
    expect(game.state.seat).toBe('p1');
  });

  it('takes over the moment the board reaches the seat it holds', () => {
    const { game, input } = fresh({ botP1: null, botP2: 'normal' });
    game.state.seat = 'p2';
    // Long enough for the flip, the thinking time and the stroke it plays to run out.
    idle(game, input, 60 * 6);
    expect(game.state.shots).toBeGreaterThan(0);
  });

  it('plays a different match on easy and on hard from the same seed', () => {
    const trace = (tier: BotDifficulty): string => {
      const game = new CarromGame();
      game.init(makeContext({ seed: 20260824, botP1: tier, botP2: tier }));
      const input = new ScriptedInput();
      for (let i = 0; i < 60 * 30; i += 1) game.update(STEP, input);
      return game.state.bodies.map((b) => `${b.x.toFixed(3)},${b.y.toFixed(3)}`).join('|');
    };
    expect(trace('hard')).not.toBe(trace('easy'));
  });

  it('replays a bot match exactly from the same seed', () => {
    const trace = (): string => {
      const game = new CarromGame();
      game.init(makeContext({ seed: 4242, botP1: 'easy', botP2: 'hard' }));
      const input = new ScriptedInput();
      for (let i = 0; i < 60 * 30; i += 1) game.update(STEP, input);
      return `${String(game.getScore().p1)}:${String(game.getScore().p2)}:${game.state.bodies
        .map((b) => `${b.x.toFixed(9)},${b.y.toFixed(9)}`)
        .join('|')}`;
    };
    expect(trace()).toBe(trace());
  });

  it('finishes a frame between two of the weakest bots, well inside ten minutes', () => {
    // The property `apps/web/src/data/termination.test.ts` checks for every game, run here
    // through the same class the shell runs.
    const game = new CarromGame();
    game.init(makeContext({ seed: 20260820, botP1: 'easy', botP2: 'easy' }));
    const input = new ScriptedInput();
    let decided = -1;
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) {
        decided = i;
        break;
      }
    }
    expect(decided, 'two easy bots never finished a frame').toBeGreaterThanOrEqual(0);
    expect(decided).toBeLessThan(60 * 400);
  });

  it('reports a winner only once the board has been left on screen a moment', () => {
    const game = new CarromGame();
    game.init(makeContext({ seed: 3, botP1: 'hard', botP2: 'hard' }));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      if (game.state.phase === 'over') break;
    }
    expect(game.state.phase).toBe('over');
    expect(game.getScore().winner, 'the frame is decided but not yet reported').toBe(null);
    idle(game, input, Math.round(SETTLE_SECONDS * 60) + 2);
    expect(game.getScore().winner).not.toBe(null);
  });

  it('stops playing once the frame is decided', () => {
    const game = new CarromGame();
    game.init(makeContext({ seed: 11, botP1: 'hard', botP2: 'normal' }));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    const settled = game.getScore();
    idle(game, input, 300);
    expect(game.getScore()).toEqual(settled);
    expect(game.state.shots).toBeLessThanOrEqual(SHOT_LIMIT);
  });
});

describe('what the player is shown', () => {
  it('draws a board, the pucks and the striker', () => {
    const { game } = fresh();
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops).toContain('clear');
    expect(renderer.ops).toContain('rect');
    expect(renderer.ops).toContain('circle');
    expect(renderer.ops.filter((op) => op === 'circle').length).toBeGreaterThan(12);
    expect(renderer.ops[renderer.ops.length - 1]).toBe('popSeatRotation');
  });

  it('keeps every drawn point inside the box the manifest declares', () => {
    const { game, input } = fresh({ botP1: 'normal', botP2: 'normal' });
    for (let frame = 0; frame < 200; frame += 1) {
      idle(game, input, 3);
      const renderer = new RecordingRenderer();
      game.render(renderer);
      for (const call of renderer.calls) {
        if (call.op === 'pushRotation' || call.op === 'clear') continue;
        const numbers = call.args.filter((a): a is number => typeof a === 'number');
        for (const value of numbers) {
          expect(Number.isFinite(value), `${call.op} drew a non-finite number`).toBe(true);
          expect(Math.abs(value)).toBeLessThan(4000);
        }
      }
    }
  });

  it('marks each seat’s pucks by shape as well as by colour', () => {
    // Rule 7: playable in greyscale. Seat one's puck carries a ring, seat two's a bar.
    const { game } = fresh();
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const rings = renderer.calls.filter(
      (call) => call.op === 'strokeCircle' && typeof call.args[2] === 'number' && call.args[2] < 12,
    );
    const bars = renderer.calls.filter(
      (call) => call.op === 'rect' && typeof call.args[3] === 'number' && call.args[3] === 8,
    );
    expect(rings.length, 'seat one’s pucks carry no ring').toBeGreaterThanOrEqual(6);
    expect(bars.length, 'seat two’s pucks carry no bar').toBeGreaterThanOrEqual(6);
  });

  it('marks the queen with a cross that nothing else wears', () => {
    const { game } = fresh();
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const queen = queenOf(game.state);
    const across = renderer.calls.filter(
      (call) =>
        call.op === 'line' &&
        Math.abs(Number(call.args[1]) - queen.y) < 1e-6 &&
        Math.abs(Number(call.args[3]) - queen.y) < 1e-6 &&
        Math.abs(Number(call.args[0]) - (queen.x - 8)) < 1e-6,
    );
    expect(across.length).toBe(1);
  });

  it('rings the striker in the colour of whoever is to play', () => {
    const { game } = fresh();
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const striker = strikerOf(game.state);
    const halo = renderer.calls.filter(
      (call) =>
        call.op === 'strokeCircle' &&
        Math.abs(Number(call.args[0]) - striker.x) < 1e-6 &&
        Math.abs(Number(call.args[2]) - (STRIKER_RADIUS + 4)) < 1e-6,
    );
    expect(halo.length, 'nothing on the striker says whose stroke it is').toBe(1);
  });

  it('tells both players how many pucks each of them still has to pot', () => {
    const { game } = fresh();
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const lines = renderer.texts();
    expect(lines.filter((line) => line.includes('to go')).length).toBe(2);
    expect(lines).toContain('6 to go');
  });

  it('says what the shooter has to do next, in words', () => {
    const { game, input } = fresh();
    const say = (): string[] => {
      const renderer = new RecordingRenderer();
      game.render(renderer);
      return renderer.texts();
    };
    expect(say().join(' ')).toMatch(/slide|aim|flick/i);

    game.state.queenPending = true;
    expect(say().join(' ')).toMatch(/queen/i);
    game.state.queenPending = false;

    game.state.fouled = true;
    expect(say().join(' ')).toMatch(/foul/i);
    game.state.fouled = false;

    game.state.phase = 'over';
    expect(say().join(' ')).toMatch(/over/i);
    game.state.phase = 'aiming';
    idle(game, input, 1);
  });

  it('warns the shooter when the queen is the only pot left to them', () => {
    const { game } = fresh();
    for (const b of game.state.bodies) {
      if (b.kind === 'p1') b.potted = true;
    }
    const last = game.state.bodies.find((b) => b.kind === 'p1');
    if (last !== undefined) last.potted = false;
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.texts().join(' ')).toMatch(/queen first/i);
  });

  it('draws the aiming line further the harder the stroke will be', () => {
    const { game, input } = fresh();
    // The pip at the far end of the aim line is the only circle of radius six on the board.
    const tipDistance = (): number => {
      const renderer = new RecordingRenderer();
      game.render(renderer);
      const striker = strikerOf(game.state);
      const pips = renderer.calls.filter((call) => call.op === 'circle' && call.args[2] === 6);
      expect(pips.length, 'no aim pip was drawn').toBe(1);
      const pip = pips[0];
      return Math.hypot(Number(pip?.args[0]) - striker.x, Number(pip?.args[1]) - striker.y);
    };
    const soft = tipDistance();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    expect(tipDistance()).toBeGreaterThan(soft);
  });

  it('draws no striker once the frame is over', () => {
    const { game } = fresh();
    game.state.phase = 'over';
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const striker = strikerOf(game.state);
    const onStriker = renderer.calls.filter(
      (call) =>
        call.op === 'strokeCircle' &&
        Math.abs(Number(call.args[0]) - striker.x) < 1e-6 &&
        Math.abs(Number(call.args[2]) - (STRIKER_RADIUS + 4)) < 1e-6,
    );
    expect(onStriker.length).toBe(0);
  });

  it('never mutates the board while drawing it', () => {
    const { game, input } = fresh({ botP1: 'normal' });
    idle(game, input, 40);
    const before = game.state.bodies.map(
      (b) => `${String(b.x)},${String(b.y)},${String(b.potted)}`,
    );
    for (let i = 0; i < 5; i += 1) game.render(new RecordingRenderer());
    expect(
      game.state.bodies.map((b) => `${String(b.x)},${String(b.y)},${String(b.potted)}`),
    ).toEqual(before);
  });

  it('draws a frame in every phase without falling over', () => {
    const { game, input } = fresh({ botP1: 'hard', botP2: 'hard' });
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 120; i += 1) {
      game.update(STEP, input);
      seen.add(game.state.phase);
      game.render(new RecordingRenderer());
      if (game.getScore().winner !== null) break;
    }
    expect([...seen].sort()).toEqual(['aiming', 'over', 'rolling']);
  });
});

describe('the contract as the shell holds it', () => {
  it('satisfies the Game interface, alpha and all', () => {
    const game = new CarromGame();
    const asContract: Game = game;
    asContract.init(makeContext());
    const renderer = new RecordingRenderer();
    asContract.render(renderer, 0);
    asContract.render(renderer, 0.5);
    expect(renderer.ops.length).toBeGreaterThan(0);
    asContract.onPause();
    asContract.onResume();
    expect(asContract.getActiveSeat?.()).toBe('p1');
    asContract.destroy();
  });

  it('takes any nonsense a device can produce without breaking the board', () => {
    const { game, input } = fresh();
    const rng = new Rng(8080);
    for (let i = 0; i < 600; i += 1) {
      input.steer('p1', rng.float() * 6 - 3, rng.float() * 6 - 3);
      input.point('p1', rng.float() * 4000 - 2000, rng.float() * 4000 - 2000);
      if (rng.float() < 0.1) input.lift('p1');
      if (rng.float() < 0.1) input.hold('p1', rng.float() * 10);
      game.update(STEP, input);
      for (const b of game.state.bodies) {
        expect(Number.isFinite(b.x), 'a body reached a non-finite position').toBe(true);
        expect(Number.isFinite(b.y)).toBe(true);
      }
      expect(Math.abs(game.aimAngle)).toBeLessThanOrEqual(MAX_AIM + 1e-9);
      expect(game.power).toBeGreaterThanOrEqual(0);
      expect(game.power).toBeLessThanOrEqual(1);
      expect(game.state.offset).toBeGreaterThanOrEqual(-1);
      expect(game.state.offset).toBeLessThanOrEqual(1);
    }
  });

  it('does the same thing at 120 Hz as it does at 60', () => {
    // Every delay the game counts is in steps derived from the delta it is handed, so the
    // bot thinks for the same fraction of a second at either rate.
    const shots = (rate: number): number => {
      const game = new CarromGame();
      game.init(makeContext({ seed: 606, botP1: 'normal', botP2: 'normal' }));
      const input = new ScriptedInput();
      for (let i = 0; i < rate * 30; i += 1) game.update(1 / rate, input);
      return game.state.shots;
    };
    expect(Math.abs(shots(120) - shots(60))).toBeLessThanOrEqual(2);
  });
});
