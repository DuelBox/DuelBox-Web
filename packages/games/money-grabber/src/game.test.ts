import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { MoneyGrabberGame } from './game.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  HAND_MAX_X,
  HAND_MIN_X,
  HAND_SPEED,
  MATCH_SECONDS,
  MID_Y,
  NOTE_COUNT,
  PILE_VALUE,
  SAFE_X,
  handMaxYOf,
  handMinYOf,
  handOf,
  safeYOf,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
type Presentation = 'shared-screen' | 'single-seat';

/* --------------------------------------------------------------- scripted input */

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

  /** Direction keys, as the engine reports them: components in [-1, 1]. */
  steer(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.move.x = x;
    target.move.y = y;
  }

  /** A finger somewhere on the glass. Position only — this game reads nothing else. */
  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    // The engine reports a finger down as the action too. Nothing in this game reads it, and
    // these are set so that a regression that started reading one would be seen here.
    target.actionHeld = true;
    target.actionPressed = true;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.move.x = 0;
    target.move.y = 0;
    target.actionHeld = false;
    target.actionPressed = false;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

const IDLE: InputState = new ScriptedInput();

/* ------------------------------------------------------------------- recording */

type DrawArg = string | number | boolean | undefined;

interface Call {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

class RecordingRenderer implements Renderer {
  readonly calls: Call[] = [];

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

  /** Every call with its colour arguments dropped: the picture a greyscale player sees. */
  shapesOnly(): string[] {
    return this.calls.map(
      (call) =>
        `${call.op}(${call.args
          .filter((arg) => typeof arg !== 'string' || !/^(#|rgba?\()/.test(arg))
          .map((arg) => (typeof arg === 'number' ? arg.toFixed(2) : String(arg)))
          .join(',')})`,
    );
  }

  #record(op: string, ...args: DrawArg[]): void {
    this.calls.push({ op, args });
  }
}

const SEAT_COLOURS: ReadonlyMap<string, SeatId> = new Map<string, SeatId>(
  (['p1', 'p2'] as const).flatMap((seat): [string, SeatId][] => {
    const palette = SEAT_PALETTE[seat];
    return [palette.base, palette.deep, palette.tint, palette.soft].map((c) => [c, seat]);
  }),
);

interface Extent {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The box a recorded call actually paints, or null for the calls that have no box.
 *
 * `text` is excluded on purpose: a glyph box cannot be derived from the arguments, and the
 * only text this game draws inside a seat rotation is a deposit tally whose coordinates have
 * already been turned by the game.
 */
function extentOf(call: Call): Extent | null {
  const n = call.args.filter((arg): arg is number => typeof arg === 'number');
  const at = (i: number): number => n[i] ?? 0;
  switch (call.op) {
    case 'rect':
    case 'strokeRect':
      return { left: at(0), top: at(1), right: at(0) + at(2), bottom: at(1) + at(3) };
    case 'circle':
    case 'strokeCircle':
      return {
        left: at(0) - at(2),
        top: at(1) - at(2),
        right: at(0) + at(2),
        bottom: at(1) + at(2),
      };
    case 'line':
      return {
        left: Math.min(at(0), at(2)),
        top: Math.min(at(1), at(3)),
        right: Math.max(at(0), at(2)),
        bottom: Math.max(at(1), at(3)),
      };
    default:
      return null;
  }
}

/** Which seat a recorded call is drawn in the colour of, if any. */
function seatOf(call: Call): SeatId | null {
  for (const arg of call.args) {
    if (typeof arg !== 'string') continue;
    const seat = SEAT_COLOURS.get(arg);
    if (seat !== undefined) return seat;
  }
  return null;
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
  presentation: Presentation = 'shared-screen',
  localSeat: SeatId = 'p1',
  openingSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    openingSeat,
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

/** Everything the simulation holds, flattened, so a change anywhere shows up. */
function snapshot(game: MoneyGrabberGame): string {
  const state = game.state;
  return JSON.stringify({
    p1: state.p1,
    p2: state.p2,
    clock: state.clock,
    inPlay: state.inPlay,
    winner: state.winner,
    hands: [state.p1Hand, state.p2Hand],
    notes: state.notes,
  });
}

/* -------------------------------------------------------------- the contract */

describe('the contract', () => {
  it('never claims to have turns, because both hands grab at once', () => {
    const game = new MoneyGrabberGame();
    // `rt-*` archetypes must not implement it at all — the shell reads its presence and its
    // value to decide whether to hand the whole board and both key halves to one seat.
    expect((game as { getActiveSeat?: unknown }).getActiveSeat).toBeUndefined();
  });

  it('reports a score of the shape the shell expects', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(1));
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
    game.destroy();
  });

  it('does nothing at all before init', () => {
    const game = new MoneyGrabberGame();
    game.update(STEP, IDLE);
    game.update(STEP, IDLE);
    expect(game.state.clock).toBe(0);
  });

  it('renders without moving the simulation, at any alpha', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(3, 'normal', 'hard'));
    for (let k = 0; k < 200; k += 1) game.update(STEP, IDLE);
    const before = snapshot(game);
    const renderer = new RecordingRenderer();
    for (const alpha of [0, 0.37, 0.5, 0.99]) {
      for (let k = 0; k < 30; k += 1) game.render(renderer, alpha);
    }
    expect(snapshot(game)).toBe(before);
    expect(renderer.calls.length).toBeGreaterThan(0);
    game.destroy();
  });

  it('balances every seat rotation it pushes', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(4, 'hard', 'hard'));
    const renderer = new RecordingRenderer();
    let depth = 0;
    for (let k = 0; k < 900; k += 1) {
      game.update(STEP, IDLE);
      game.render(renderer, 0.5);
    }
    for (const call of renderer.calls) {
      if (call.op === 'pushSeatRotation' || call.op === 'pushRotation') depth += 1;
      if (call.op === 'popSeatRotation') depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
    game.destroy();
  });

  it('gives everything back on destroy, and stands back up on the next init', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(5, 'hard', 'hard'));
    const notes = game.state.notes;
    for (let k = 0; k < 400; k += 1) game.update(STEP, IDLE);
    game.destroy();
    expect(game.state.p1).toBe(0);
    expect(game.state.p2).toBe(0);
    expect(game.state.clock).toBe(0);
    expect(game.state.inPlay).toBe(NOTE_COUNT);
    // The same arrays, never new ones: a destroy that reallocated would be a leak per match.
    expect(game.state.notes).toBe(notes);
    expect(game.state.notes.length).toBe(NOTE_COUNT);
    // And a destroyed game is inert until it is told to start again.
    game.update(STEP, IDLE);
    expect(game.state.clock).toBe(0);
    game.init(makeContext(5, 'hard', 'hard'));
    game.update(STEP, IDLE);
    expect(game.state.clock).toBeGreaterThan(0);
    game.destroy();
  });

  it('keeps every drawn point inside the box it declared', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(6, 'hard', 'easy'));
    const renderer = new RecordingRenderer();
    for (let k = 0; k < 1200; k += 1) {
      game.update(STEP, IDLE);
      game.render(renderer, 0.5);
    }
    let checked = 0;
    for (const call of renderer.calls) {
      if (call.op === 'clear' || call.op.includes('Rotation')) continue;
      for (const arg of call.args) {
        if (typeof arg !== 'number') continue;
        expect(Math.abs(arg)).toBeLessThanOrEqual(Math.max(BOARD_WIDTH, BOARD_HEIGHT));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    game.destroy();
  });

  it('never lets a shape spill off the end of the board', () => {
    // Stronger than the check above, and it exists because of a real defect: seat one's safe
    // is drawn as a circle and seat two's as a square of the same *area*, so a centre that let
    // either overhang its own end would clip the two by different fractions and quietly make
    // one of them the bigger object. Extents rather than arguments, so a radius or a half-side
    // that grows past the edge is caught rather than the coordinate it was measured from.
    const game = new MoneyGrabberGame();
    game.init(makeContext(7, 'normal', 'normal'));
    const renderer = new RecordingRenderer();
    for (let k = 0; k < 900; k += 1) {
      game.update(STEP, IDLE);
      game.render(renderer, 0.5);
    }
    let checked = 0;
    for (const call of renderer.calls) {
      const box = extentOf(call);
      if (box === null) continue;
      checked += 1;
      expect(box.left, `${call.op} spills left`).toBeGreaterThanOrEqual(-1);
      expect(box.top, `${call.op} spills above`).toBeGreaterThanOrEqual(-1);
      expect(box.right, `${call.op} spills right`).toBeLessThanOrEqual(BOARD_WIDTH + 1);
      expect(box.bottom, `${call.op} spills below`).toBeLessThanOrEqual(BOARD_HEIGHT + 1);
    }
    expect(checked).toBeGreaterThan(900);
    game.destroy();
  });
});

/* ---------------------------------------------------------------- rule 7 */

describe('colour is never the only signal', () => {
  /**
   * Seat one is round and seat two is square, everywhere and without exception.
   *
   * The whole board reduces to one rule a greyscale player can learn in a second: **round
   * things belong to the player at the bottom and square things to the player at the top**.
   * Safes, hands, knuckles, the money in a hand and the marker showing where a hand is going
   * all obey it. Money still on the table belongs to nobody, so it is drawn in nobody's
   * colour, as a plain note with its value written on it.
   */
  function seatShapes(game: MoneyGrabberGame): { p1: Set<string>; p2: Set<string> } {
    const renderer = new RecordingRenderer();
    for (let k = 0; k < 1500; k += 1) {
      game.update(STEP, IDLE);
      game.render(renderer, 0.5);
    }
    const p1 = new Set<string>();
    const p2 = new Set<string>();
    for (const call of renderer.calls) {
      const seat = seatOf(call);
      if (seat === 'p1') p1.add(call.op);
      if (seat === 'p2') p2.add(call.op);
    }
    return { p1, p2 };
  }

  it('draws one seat only in round primitives and the other only in square ones', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(11, 'normal', 'normal'));
    const { p1, p2 } = seatShapes(game);
    game.destroy();

    expect(p1.size).toBeGreaterThan(0);
    expect(p2.size).toBeGreaterThan(0);
    const round = new Set(['circle', 'strokeCircle']);
    const square = new Set(['rect', 'strokeRect']);
    // Anything either seat draws that is not a shape — the deposit tally is a label — is
    // allowed to both, because rule 7 names shape, pattern *or* label and the two labels
    // differ. What may never happen is one seat borrowing the other's silhouette.
    for (const op of p1) expect(square.has(op), `seat one drew a ${op}`).toBe(false);
    for (const op of p2) expect(round.has(op), `seat two drew a ${op}`).toBe(false);
    expect([...p1].some((op) => round.has(op))).toBe(true);
    expect([...p2].some((op) => square.has(op))).toBe(true);
  });

  it('puts both seats on the screen in the same frame, so the two can be compared', () => {
    // The greyscale guard can only judge a game whose two seats are visible together. Both
    // hands and both safes are drawn every frame of every match here, from the first.
    const game = new MoneyGrabberGame();
    game.init(makeContext(12, 'easy', 'easy'));
    game.update(STEP, IDLE);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const seats = new Set(renderer.calls.map(seatOf).filter((s): s is SeatId => s !== null));
    expect([...seats].sort()).toEqual(['p1', 'p2']);
    game.destroy();
  });

  it('states a note’s worth as a numeral rather than as a colour', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(13));
    game.update(STEP, IDLE);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const labels = renderer.calls
      .filter((call) => call.op === 'text')
      .map((call) => String(call.args[0]));
    expect(labels.length).toBeGreaterThanOrEqual(NOTE_COUNT);
    for (const label of labels) expect(['1', '2', '3']).toContain(label);
    game.destroy();
  });

  it('is still two different pictures with every colour stripped out', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(14, 'normal', 'normal'));
    for (let k = 0; k < 120; k += 1) game.update(STEP, IDLE);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const shapes = renderer.shapesOnly().join('\n');
    expect(shapes).toContain('circle(');
    expect(shapes).toContain('rect(');
    game.destroy();
  });
});

/* --------------------------------------------------------------- the hands */

describe('driving a hand', () => {
  it('follows a finger at the hand’s own speed rather than jumping to it', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(21));
    const input = new ScriptedInput();
    // A finger slammed into the far corner of seat one's own half.
    input.point('p1', HAND_MIN_X, handMaxYOf('p1'));
    const start = handOf(game.state, 'p1');
    const from = { x: start.x, y: start.y };
    game.update(STEP, input);
    const moved = Math.hypot(start.x - from.x, start.y - from.y);
    expect(moved).toBeCloseTo(HAND_SPEED * STEP, 9);
    game.destroy();
  });

  it('mirrors the far seat’s keys on a shared screen and not on its own device', () => {
    // The two players sit on opposite sides of one device, so the far seat's "up" is the
    // board's "down". That is control mapping, which the two presentations are allowed to
    // differ in — and nothing in the simulation reads the presentation.
    const shared = new MoneyGrabberGame();
    const single = new MoneyGrabberGame();
    shared.init(makeContext(22, null, null, 'shared-screen', 'p1'));
    single.init(makeContext(22, null, null, 'single-seat', 'p2'));
    const input = new ScriptedInput();
    input.steer('p2', 0, -1);
    for (let k = 0; k < 30; k += 1) {
      shared.update(STEP, input);
      single.update(STEP, input);
    }
    const sharedHand = handOf(shared.state, 'p2');
    const singleHand = handOf(single.state, 'p2');
    // Up on the far seat's own keys is down the board when it is reading upside down.
    expect(sharedHand.y).toBeGreaterThan(MID_Y * 0.1);
    expect(sharedHand.y).toBeGreaterThan(singleHand.y);
    shared.destroy();
    single.destroy();
  });

  it('parks on the reach limit when a finger points into the other half', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    input.point('p1', SAFE_X, 0);
    for (let k = 0; k < 600; k += 1) game.update(STEP, input);
    const hand = handOf(game.state, 'p1');
    expect(hand.y).toBe(handMinYOf('p1'));
    expect(hand.x).toBe(SAFE_X);
    game.destroy();
  });

  it('reads nothing from the action, so a tapping player and a sliding one are the same', () => {
    // Happy Hippos measured a four-fold rate difference between a player who slides and one
    // who taps, because the engine reports a finger going down as the action. There is no
    // action in this game at all, so the two styles cannot diverge — asserted by driving one
    // match with the action permanently held and another with it never held.
    const held = new MoneyGrabberGame();
    const never = new MoneyGrabberGame();
    held.init(makeContext(24, null, 'normal'));
    never.init(makeContext(24, null, 'normal'));
    const withAction = new ScriptedInput();
    const withoutAction = new ScriptedInput();
    for (let k = 0; k < 900; k += 1) {
      const x = HAND_MIN_X + ((k * 7) % (HAND_MAX_X - HAND_MIN_X));
      const y = handMinYOf('p1') + ((k * 11) % (handMaxYOf('p1') - handMinYOf('p1')));
      withAction.point('p1', x, y);
      withoutAction.point('p1', x, y);
      const bare = withoutAction.seat('p1') as unknown as MutableSeatInput;
      bare.actionHeld = false;
      bare.actionPressed = false;
      held.update(STEP, withAction);
      never.update(STEP, withoutAction);
    }
    expect(snapshot(held)).toBe(snapshot(never));
    held.destroy();
    never.destroy();
  });
});

/* ------------------------------------------------- the engine's real input path */

describe('through the engine’s own input manager', () => {
  /**
   * Ten fingers, and what the game is actually handed.
   *
   * The catalogue row says "all the fingers of your hand". `InputManager` does track ten
   * concurrent pointers and does keep each one with the seat whose half it went down in — but
   * `SeatInputView` carries **one** nullable pointer per seat, and `pointerCount` never
   * leaves `input.ts`. So a game cannot address a second finger, and five fingers on one half
   * are the position of the most recent event and nothing more.
   *
   * That is the finding the whole design rests on, so it is asserted here rather than argued
   * in SPEC.md alone: if the engine ever grows a per-finger view, this test is where somebody
   * will see that this game could be built the other way.
   */
  it('collapses a whole hand of fingers into one position, and survives it', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(31));
    const input = new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' });
    const view = new InputView();
    const notes = game.state.notes;

    // Five fingers on seat one's half and five on seat two's, all down at once.
    for (let id = 0; id < 10; id += 1) {
      const y = id < 5 ? handMaxYOf('p1') : handMinYOf('p2');
      input.pointerDown(id, HAND_MIN_X + id * 40, y);
    }
    let state = input.beginStep(STEP);
    expect(state.seat('p1').pointerActive).toBe(true);
    expect(state.seat('p2').pointerActive).toBe(true);
    // The most recent event owns the seat's position: there is no second finger to read.
    expect(state.seat('p1').pointerX).toBe(Math.round((HAND_MIN_X + 4 * 40) / 3) * 3);

    for (let k = 0; k < 600; k += 1) {
      for (let id = 0; id < 10; id += 1) {
        input.pointerMove(
          id,
          HAND_MIN_X + ((id * 47 + k * 13) % 480),
          MID_Y + ((k * 7) % 200) - 100,
        );
      }
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    state = input.beginStep(STEP);
    expect(game.state.notes).toBe(notes);
    expect(game.state.notes.length).toBe(NOTE_COUNT);
    expect(game.state.clock).toBeGreaterThan(0);

    // Lifting nine of the ten still leaves both seats holding a pointer if one each remains.
    for (let id = 0; id < 9; id += 1) input.pointerUp(id);
    state = input.beginStep(STEP);
    expect(state.seat('p1').pointerActive).toBe(false);
    expect(state.seat('p2').pointerActive).toBe(true);
    game.update(STEP, view.sync(state));
    game.destroy();
  });

  it('keeps a gesture with the seat it began in, even dragged across the middle', () => {
    const game = new MoneyGrabberGame();
    game.init(makeContext(32));
    const input = new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' });
    const view = new InputView();
    input.pointerDown(1, SAFE_X, handMaxYOf('p1'));
    for (let k = 0; k < 400; k += 1) {
      input.pointerMove(1, SAFE_X, 20);
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    // Seat one's own hand moved, and seat two's did not: the finger never changed owner.
    expect(handOf(game.state, 'p1').y).toBe(handMinYOf('p1'));
    expect(handOf(game.state, 'p2').y).toBe(safeYOf('p2'));
    game.destroy();
  });
});

/* ------------------------------------------------------------- the match */

describe('a match', () => {
  it('is the same match whichever seat the shell says opens', () => {
    // A real-time game has no opener, and the contract says it may ignore the field. This one
    // does, and asserts it rather than claiming it: the table is dealt as half-turn pairs of
    // equal value, so there is no deal, no parity and no draw order for an opener to decide.
    for (const seed of [41, 42, 43]) {
      const a = new MoneyGrabberGame();
      const b = new MoneyGrabberGame();
      a.init(makeContext(seed, 'normal', 'normal', 'shared-screen', 'p1', 'p1'));
      b.init(makeContext(seed, 'normal', 'normal', 'shared-screen', 'p1', 'p2'));
      for (let k = 0; k < 1200; k += 1) {
        a.update(STEP, IDLE);
        b.update(STEP, IDLE);
      }
      expect(snapshot(a)).toBe(snapshot(b));
      a.destroy();
      b.destroy();
    }
  });

  it('steps identically in both presentations when nobody touches the device', () => {
    for (const seed of [51, 52]) {
      const shared = new MoneyGrabberGame();
      const single = new MoneyGrabberGame();
      shared.init(makeContext(seed, 'hard', 'easy', 'shared-screen', 'p1'));
      single.init(makeContext(seed, 'hard', 'easy', 'single-seat', 'p2'));
      for (let k = 0; k < 1500; k += 1) {
        shared.update(STEP, IDLE);
        single.update(STEP, IDLE);
      }
      expect(snapshot(shared)).toBe(snapshot(single));
      shared.destroy();
      single.destroy();
    }
  });

  it('finishes, and hands out the whole pile when it does', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const game = new MoneyGrabberGame();
      game.init(makeContext(61, tier, tier));
      let steps = 0;
      while (game.getScore().winner === null) {
        game.update(STEP, IDLE);
        steps += 1;
        expect(steps).toBeLessThan(60 * MATCH_SECONDS + 60);
      }
      const score = game.getScore();
      expect(score.p1 + score.p2).toBeLessThanOrEqual(PILE_VALUE);
      if (game.state.inPlay === 0) {
        expect(score.p1 + score.p2).toBe(PILE_VALUE);
        expect(score.winner).not.toBe('draw');
      }
      game.destroy();
    }
  });

  it('is replayable from the seed the shell gives it', () => {
    const a = new MoneyGrabberGame();
    const b = new MoneyGrabberGame();
    a.init(makeContext(71, 'hard', 'normal'));
    b.init(makeContext(71, 'hard', 'normal'));
    for (let k = 0; k < 900; k += 1) {
      a.update(STEP, IDLE);
      b.update(STEP, IDLE);
    }
    expect(snapshot(a)).toBe(snapshot(b));
    a.destroy();
    b.destroy();
  });
});

/* ------------------------------------------------------------ the manifest */

describe('the manifest', () => {
  it('declares the archetype, the box and the modes the shell needs', () => {
    expect(manifest.id).toBe('money-grabber');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.logical).toEqual({ width: BOARD_WIDTH, height: BOARD_HEIGHT });
    expect(manifest.zoneSplit).toBe('horizontal');
    // `PlaySurface` only renders friend and bot start buttons, so a solo-only manifest is a
    // page with no way to start the game.
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
  });

  it('is not same-input-class-only, and its controls describe what it really reads', () => {
    expect(manifest.sameInputClassOnly).toBe(false);
    // Both lines describe steering and nothing else, because that is the whole interaction.
    expect(manifest.controls.keyboard).toMatch(/W A S D/);
    expect(manifest.controls.keyboard).toMatch(/arrow/i);
    expect(manifest.controls.keyboard).not.toMatch(/space|enter/i);
    expect(manifest.controls.pointer).not.toMatch(/tap|press/i);
    expect(manifest.controls.pointer.length).toBeGreaterThan(3);
  });

  it('puts a whole number of precision-lattice cells on both axes', () => {
    // `presentation-parity.test.ts` calls this latticeSurvivesTurn: the engine quantises every
    // pointer onto a lattice of min(w, h) / 200, and a half-turn maps that lattice onto itself
    // only when the box is a whole number of cells across. 600 x 900 is; 600 x 1000 is not.
    const cell = Math.min(BOARD_WIDTH, BOARD_HEIGHT) / 200;
    expect(Number.isInteger(BOARD_WIDTH / cell)).toBe(true);
    expect(Number.isInteger(BOARD_HEIGHT / cell)).toBe(true);
  });
});
