import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  FIELD_HEIGHT,
  FIELD_LEFT,
  FIELD_WIDTH,
  FLASH_STEPS,
  P1_TOP,
  P2_TOP,
  RAIL_WIDTH,
  RAT_FIELD_Y,
  RatRaceGame,
  SCALE,
  bandTop,
  fieldYFor,
  railCentreX,
  railUnder,
  toBoard,
  toField,
} from './game.js';
import {
  RACE_SECONDS,
  RAILS,
  RAIL_SECONDS,
  RUN_SPEED,
  STUN_SECONDS,
  TARGET_CHEESE,
  VIEW_AHEAD,
  VIEW_BACK,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
const MIDLINE = BOARD_HEIGHT / 2;

/** Steps that comfortably cover a rail change, which takes {@link RAIL_SECONDS}. */
const RAIL_STEPS = Math.ceil(RAIL_SECONDS / STEP) + 2;

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

/**
 * One seat's instruments, spelled the way the engine reports them.
 *
 * `press`/`lift` are a *pair* rather than a level, because the rail keys are edge-triggered:
 * a held key is one rail, not sixty. Any test that wants two rails has to say so twice, which
 * is exactly what a player's hand has to do.
 */
class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  /** The movement axis, as the engine reports a direction key: −1, 0 or +1. */
  steer(seat: SeatId, x: number): void {
    this.#of(seat).move.x = x;
  }

  /** Space for seat one, Enter for seat two: the throttle, held. */
  hold(seat: SeatId, held = true): void {
    this.#of(seat).actionHeld = held;
  }

  /** A finger down at a point in device-oriented logical units. */
  touch(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    // The engine folds a pointer into the action, so a finger on the glass is a held action.
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
    openingSeat: 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? p1 : p2;
    },
  };
}

function started(context: GameContext = makeContext(1)): RatRaceGame {
  const game = new RatRaceGame();
  game.init(context);
  return game;
}

/** Run a match to its end, or until the budget runs out. Returns the steps taken, or −1. */
function play(game: RatRaceGame, input: InputState = IDLE, limit = 60 * 600): number {
  for (let i = 0; i < limit; i += 1) {
    game.update(STEP, input);
    if (game.getScore().winner !== null) return i;
  }
  return -1;
}

function advance(game: RatRaceGame, steps: number, input: InputState): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, input);
}

/** A point in a seat's own band, expressed on the board as that seat's device sees it. */
function boardPoint(
  seat: SeatId,
  flipped: boolean,
  fieldX: number,
  fieldY: number,
): { x: number; y: number } {
  const out = { x: 0, y: 0 };
  toBoard(seat, flipped, fieldX, fieldY, out);
  return out;
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

function draw(game: RatRaceGame, alpha = 0): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer, alpha);
  return renderer;
}

/** One drawn shape, reduced to a bounding box on the board. */
interface Box {
  readonly kind: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Every shape drawn, as a board-space box. Circles count their radius; lines their ends. */
function boxes(renderer: RecordingRenderer): Box[] {
  const found: Box[] = [];
  for (const entry of renderer.ops) {
    const a = entry.args as number[];
    if (entry.op === 'rect' || entry.op === 'strokeRect') {
      found.push({ kind: entry.op, x0: a[0]!, y0: a[1]!, x1: a[0]! + a[2]!, y1: a[1]! + a[3]! });
    } else if (entry.op === 'circle' || entry.op === 'strokeCircle') {
      found.push({
        kind: entry.op,
        x0: a[0]! - a[2]!,
        y0: a[1]! - a[2]!,
        x1: a[0]! + a[2]!,
        y1: a[1]! + a[2]!,
      });
    } else if (entry.op === 'line') {
      found.push({
        kind: entry.op,
        x0: Math.min(a[0]!, a[2]!),
        y0: Math.min(a[1]!, a[3]!),
        x1: Math.max(a[0]!, a[2]!),
        y1: Math.max(a[1]!, a[3]!),
      });
    }
  }
  return found;
}

/**
 * Which seat a drawn shape belongs to, or null for the clock that lies between them.
 *
 * A margin of thirty units either side of the two bands, which is where a cheese wedge at
 * the very edge of a window sits. Nothing may reach further than that, and the assertion
 * that nothing does is the point of the function.
 */
const BAND_MARGIN = 30;

function ownerOf(box: Box): SeatId | null {
  if (box.y0 >= P1_TOP - BAND_MARGIN) return 'p1';
  if (box.y1 <= P2_TOP + FIELD_HEIGHT + BAND_MARGIN) return 'p2';
  return null;
}

/**
 * Every shape one seat drew, expressed in that seat's own field coordinates.
 *
 * The two bands are point reflections of each other, so mapping both back through
 * {@link toField} puts them in one frame where they can be compared shape for shape. Any
 * asymmetry between the two windows shows up as a key present in one list and not the other.
 */
function inFieldFrame(renderer: RecordingRenderer, seat: SeatId, flipped: boolean): string[] {
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  const keys: string[] = [];
  for (const box of boxes(renderer)) {
    if (ownerOf(box) !== seat) continue;
    toField(seat, flipped, box.x0, box.y0, a);
    toField(seat, flipped, box.x1, box.y1, b);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    // Only what is inside the window: the pip row sits outside it and differs by design.
    if (y1 <= 0 || y0 >= FIELD_HEIGHT) continue;
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    // The rat itself is the one place the two windows are allowed to differ — rule 7 asks
    // for it — so it is cut from both frames rather than excused in one.
    if (x1 > railCentreX(0) - RAIL_WIDTH && x0 < railCentreX(RAILS - 1) + RAIL_WIDTH) {
      if (y1 > RAT_FIELD_Y - 60 && y0 < RAT_FIELD_Y + 50) continue;
    }
    keys.push(`${box.kind}:${x0.toFixed(4)},${y0.toFixed(4)},${x1.toFixed(4)},${y1.toFixed(4)}`);
  }
  return keys.sort();
}

describe('the manifest', () => {
  it('declares the box the simulation actually draws in', () => {
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.id).toBe('rat-race');
  });

  it('is the racing archetype, with two seats and both presentations', () => {
    expect(manifest.archetype).toBe('rt-race');
    expect(manifest.category).toBe('Racing');
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.modes).toEqual(['friend', 'bot']);
    expect(manifest.presentations).toContain('shared-screen');
    expect(manifest.presentations).toContain('single-seat');
  });

  it('advertises the clock the race actually runs to', () => {
    expect(manifest.roundSeconds).toBe(RACE_SECONDS);
  });

  it('tells each seat which half of the keyboard is theirs', () => {
    const { keyboard } = manifest.controls;
    expect(keyboard).toMatch(/player one/i);
    expect(keyboard).toMatch(/player two/i);
    // Never "A and D or the arrow keys": the other half moves the other player.
    expect(keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
    // And never up or down, which this game does not read at all.
    expect(keyboard).not.toMatch(/\bw a s d\b/i);
  });

  it('promises seat one Space and A and D, and the code reads exactly those', () => {
    const game = started();
    const input = new ScriptedInput();

    expect(manifest.controls.keyboard).toMatch(/holds Space to run/i);
    input.hold('p1');
    advance(game, 30, input);
    expect(game.race.p1.speed, 'Space runs').toBeGreaterThan(0);

    expect(manifest.controls.keyboard).toMatch(/taps A and D to change rail/i);
    input.steer('p1', 1);
    advance(game, RAIL_STEPS, input);
    expect(game.race.p1.rail, 'D goes one rail towards this player’s right').toBe(2);
    input.steer('p1', 0);
    game.update(STEP, input);
    input.steer('p1', -1);
    advance(game, RAIL_STEPS, input);
    expect(game.race.p1.rail, 'and A comes back').toBe(1);
  });

  it('promises seat two Enter and the arrows, and the code reads exactly those', () => {
    const game = started();
    const input = new ScriptedInput();

    expect(manifest.controls.keyboard).toMatch(/player two holds Enter/i);
    input.hold('p2');
    advance(game, 30, input);
    expect(game.race.p2.speed).toBeGreaterThan(0);
    expect(game.race.p1.speed, 'and seat one is untouched by it').toBe(0);

    expect(manifest.controls.keyboard).toMatch(/left and right arrows/i);
    input.steer('p2', -1);
    advance(game, RAIL_STEPS, input);
    expect(game.race.p2.rail).toBe(0);
    expect(game.race.p1.rail).toBe(1);
  });

  it('promises a finger that runs and steers, and the code does both', () => {
    expect(manifest.controls.pointer).toMatch(/hold a finger/i);
    expect(manifest.controls.pointer).toMatch(/slide it across/i);
    const game = started();
    const input = new ScriptedInput();
    const point = boardPoint('p1', false, railCentreX(2), RAT_FIELD_Y);
    input.touch('p1', point.x, point.y);
    advance(game, RAIL_STEPS + 20, input);
    expect(game.race.p1.speed, 'a finger down is the throttle').toBeGreaterThan(0);
    expect(game.race.p1.rail, 'and where it is, is the rail').toBe(2);
  });

  it('does not declare same-input-class only, because nothing here is a repeat rate', () => {
    // The throttle is held rather than tapped and a rail change is rate-limited by
    // RAIL_SECONDS, so no instrument can be played faster than another.
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});

describe('a fresh match', () => {
  it('starts level with nobody having won', () => {
    const score = started().getScore();
    expect(score).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    // rt-* games do not model turns; both rats run at once.
    expect(started().getActiveSeat()).toBeNull();
  });

  it('puts both rats on the middle rail, stopped, at the start of the burrow', () => {
    const game = started();
    for (const seat of SEATS) {
      const rat = seat === 'p1' ? game.race.p1 : game.race.p2;
      expect(rat.distance).toBe(0);
      expect(rat.speed).toBe(0);
      expect(rat.rail).toBe(1);
      expect(rat.cheese).toBe(0);
    }
  });

  it('is level again after a second init', () => {
    const game = started(makeContext(2, 'hard', 'hard'));
    advance(game, 600, IDLE);
    expect(game.race.p1.distance).toBeGreaterThan(0);
    game.init(makeContext(3));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.race.elapsed).toBe(0);
    expect(game.race.p1.distance).toBe(0);
  });

  it('leaves nothing behind when it is destroyed', () => {
    const game = started(makeContext(4, 'hard', 'hard'));
    advance(game, 900, IDLE);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.race.p1.swats).toBe(0);
    // A destroyed game must not still be driving itself on a tier it no longer has.
    game.update(STEP, IDLE);
    expect(game.race.p1.distance).toBe(0);
    expect(game.race.p2.distance).toBe(0);
  });

  it('runs the identical race whatever the presentation and whichever seat is local', () => {
    // Nothing in the simulation reads either, which is how rule 10 is kept: there is no
    // branch to get wrong rather than a branch that happens to be right.
    const outcome = (presentation: Presentation, localSeat: SeatId): string => {
      const game = started(makeContext(505, 'normal', 'easy', presentation, localSeat));
      play(game);
      const score = game.getScore();
      return `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}`;
    };
    const base = outcome('shared-screen', 'p1');
    expect(outcome('shared-screen', 'p2')).toBe(base);
    expect(outcome('single-seat', 'p1')).toBe(base);
    expect(outcome('single-seat', 'p2')).toBe(base);
  });
});

describe('a person running a rat', () => {
  it('runs while the throttle is held and brakes the moment it is let go', () => {
    const game = started();
    const input = new ScriptedInput();
    input.hold('p1');
    advance(game, 60, input);
    const flat = game.race.p1.speed;
    expect(flat).toBe(RUN_SPEED);
    input.hold('p1', false);
    advance(game, 60, input);
    expect(game.race.p1.speed).toBe(0);
  });

  it('gives each seat its own keys, and neither reaches the other', () => {
    const game = started();
    const input = new ScriptedInput();
    input.hold('p1');
    input.steer('p1', 1);
    advance(game, RAIL_STEPS + 20, input);
    expect(game.race.p1.rail).toBe(2);
    expect(game.race.p2.rail, 'seat two was not touched').toBe(1);
    expect(game.race.p2.distance).toBe(0);
  });

  it('runs both rats at once, because there are no turns to take', () => {
    const game = started();
    const input = new ScriptedInput();
    input.hold('p1');
    input.hold('p2');
    advance(game, 60, input);
    expect(game.race.p1.distance).toBeGreaterThan(0);
    expect(game.race.p2.distance).toBe(game.race.p1.distance);
  });

  it('changes one rail per press, not one per frame', () => {
    const game = started();
    const input = new ScriptedInput();
    input.steer('p1', 1);
    advance(game, 240, input);
    expect(game.race.p1.rail, 'a key held for four seconds is still one rail').toBe(2);
  });

  it('takes a second press to cross a second rail', () => {
    const game = started();
    const input = new ScriptedInput();
    input.steer('p1', -1);
    advance(game, RAIL_STEPS, input);
    expect(game.race.p1.rail).toBe(0);
    input.steer('p1', 0);
    game.update(STEP, input);
    input.steer('p1', -1);
    advance(game, RAIL_STEPS, input);
    expect(game.race.p1.rail, 'and it cannot leave the burrow sideways').toBe(0);
  });

  it('ignores an axis that has barely opened, so a diagonal is not a rail change', () => {
    const game = started();
    const input = new ScriptedInput();
    input.steer('p1', 0.4);
    advance(game, RAIL_STEPS, input);
    expect(game.race.p1.rail).toBe(1);
    input.steer('p1', 0.9);
    advance(game, RAIL_STEPS, input);
    expect(game.race.p1.rail).toBe(2);
  });

  it('reads the far seat’s finger from the far seat’s own end of the room', () => {
    // Both players put a finger on the rail on their own right. One device point means two
    // different rails, because the two of them are not facing the same way.
    const game = started();
    const input = new ScriptedInput();
    const near = boardPoint('p1', false, railCentreX(2), RAT_FIELD_Y);
    const far = boardPoint('p2', true, railCentreX(2), RAT_FIELD_Y);
    input.touch('p1', near.x, near.y);
    input.touch('p2', far.x, far.y);
    advance(game, RAIL_STEPS + 10, input);
    expect(game.race.p1.rail).toBe(2);
    expect(game.race.p2.rail).toBe(2);
    // Which are point-symmetric places on the device, exactly as the two bands are drawn.
    expect(near.x + far.x).toBe(BOARD_WIDTH);
    expect(near.y + far.y).toBe(BOARD_HEIGHT);
  });

  it('reads both seats the same way up once nobody is sitting opposite', () => {
    // Single-seat: one player, one device, upright. The far band is no longer turned.
    const game = started(makeContext(6, null, null, 'single-seat', 'p1'));
    const input = new ScriptedInput();
    const point = boardPoint('p2', false, railCentreX(0), RAT_FIELD_Y);
    input.touch('p2', point.x, point.y);
    advance(game, RAIL_STEPS + 10, input);
    expect(game.race.p2.rail).toBe(0);
  });

  it('ignores a finger that is nowhere near its own burrow', () => {
    const game = started();
    const input = new ScriptedInput();
    input.steer('p1', 1);
    advance(game, RAIL_STEPS, input);
    expect(game.race.p1.rail).toBe(2);
    input.steer('p1', 0);
    // Far outside the band sideways: it still runs the rat, it just names no rail.
    input.touch('p1', -BOARD_WIDTH, P1_TOP + RAT_FIELD_Y);
    advance(game, 20, input);
    expect(game.race.p1.rail).toBe(2);
    expect(game.race.p1.speed).toBeGreaterThan(0);
  });

  it('lets the finger win over the keys, because a finger names a place', () => {
    const game = started();
    const input = new ScriptedInput();
    input.steer('p1', -1);
    const point = boardPoint('p1', false, railCentreX(2), RAT_FIELD_Y);
    input.touch('p1', point.x, point.y);
    advance(game, RAIL_STEPS + 10, input);
    expect(game.race.p1.rail).toBe(2);
  });

  it('survives a finger whose position is not a number', () => {
    const game = started();
    const input = new ScriptedInput();
    input.touch('p1', Number.NaN, Number.NaN);
    advance(game, 60, input);
    expect(Number.isFinite(game.race.p1.distance)).toBe(true);
    expect(Number.isInteger(game.race.p1.railTarget)).toBe(true);
    expect(game.race.p1.rail).toBeGreaterThanOrEqual(0);
    expect(game.race.p1.rail).toBeLessThanOrEqual(RAILS - 1);
  });

  it('does not change rail on the first step back from a pause', () => {
    // A key held through a pause is still held. Clearing the latch would read it as brand
    // new and swerve the rat before the player had touched anything.
    const game = started();
    const input = new ScriptedInput();
    input.steer('p1', 1);
    advance(game, RAIL_STEPS, input);
    expect(game.race.p1.rail).toBe(2);
    game.onPause();
    game.onResume();
    advance(game, RAIL_STEPS, input);
    expect(game.race.p1.rail, 'the same key, still held, is not a new press').toBe(2);
  });

  it('drops the throttle across a pause and picks it up again on the next press', () => {
    const game = started();
    const input = new ScriptedInput();
    input.hold('p1');
    advance(game, 60, input);
    expect(game.race.p1.speed).toBe(RUN_SPEED);
    game.onPause();
    input.hold('p1', false);
    game.onResume();
    advance(game, 60, input);
    expect(game.race.p1.speed).toBe(0);
    input.hold('p1');
    advance(game, 60, input);
    expect(game.race.p1.speed).toBe(RUN_SPEED);
  });

  it('lets a key released during a pause take effect on the way back', () => {
    const game = started();
    const input = new ScriptedInput();
    input.steer('p1', 1);
    advance(game, RAIL_STEPS, input);
    game.onPause();
    input.steer('p1', 0);
    game.onResume();
    game.update(STEP, input);
    input.steer('p1', 1);
    advance(game, RAIL_STEPS, input);
    expect(game.race.p1.rail, 'a fresh press after the pause still counts').toBe(2);
  });

  it('takes nothing at all from a flattened rat’s controls', () => {
    const game = started();
    const input = new ScriptedInput();
    game.race.p1.stun = STUN_SECONDS;
    input.hold('p1');
    input.steer('p1', 1);
    advance(game, 30, input);
    expect(game.race.p1.distance).toBe(0);
    expect(game.race.p1.speed).toBe(0);
    expect(game.race.p1.rail).toBe(1);
  });

  it('stops simulating once the race is decided', () => {
    const game = started();
    const input = new ScriptedInput();
    game.race.p1.cheese = TARGET_CHEESE;
    game.update(STEP, input);
    expect(game.getScore().winner).toBe('p1');
    const where = game.race.p1.distance;
    input.hold('p1');
    advance(game, 120, input);
    expect(game.race.p1.distance).toBe(where);
    expect(game.getScore().winner).toBe('p1');
  });
});

describe('the two bands', () => {
  it('gives the two seats bands of the same size, symmetric about the halfway line', () => {
    expect(bandTop('p2')).toBe(P2_TOP);
    expect(bandTop('p1')).toBe(P1_TOP);
    expect(P2_TOP + FIELD_HEIGHT).toBeLessThan(MIDLINE);
    expect(P1_TOP).toBeGreaterThan(MIDLINE);
    // The near band's bottom margin equals the far band's top margin, to the unit.
    expect(BOARD_HEIGHT - (P1_TOP + FIELD_HEIGHT)).toBe(P2_TOP);
    expect(FIELD_LEFT * 2 + FIELD_WIDTH).toBe(BOARD_WIDTH);
  });

  it('draws exactly the window a rat can see, which is what caps the bot (rule 6)', () => {
    expect(SCALE).toBeCloseTo(FIELD_HEIGHT / (VIEW_AHEAD + VIEW_BACK), 12);
    expect(fieldYFor(VIEW_AHEAD)).toBeCloseTo(0, 9);
    expect(fieldYFor(0)).toBeCloseTo(RAT_FIELD_Y, 9);
    expect(fieldYFor(-VIEW_BACK)).toBeCloseTo(FIELD_HEIGHT, 9);
    // Further up the burrow is further up the band, at one rate and in one direction.
    expect(fieldYFor(100)).toBeLessThan(fieldYFor(50));
  });

  it('shows both seats the same depth of burrow, because there is one mapping', () => {
    // One function, no seat argument: there is nowhere for an asymmetry to live.
    expect(fieldYFor(200) - fieldYFor(300)).toBeCloseTo(100 * SCALE, 9);
    expect(RAT_FIELD_Y).toBeGreaterThan(0);
    expect(RAT_FIELD_Y).toBeLessThan(FIELD_HEIGHT);
  });

  it('lays the rails evenly across the band and reads a finger back onto them', () => {
    expect(RAIL_WIDTH * RAILS).toBe(FIELD_WIDTH);
    for (let rail = 0; rail < RAILS; rail += 1) {
      expect(railUnder(railCentreX(rail))).toBe(rail);
    }
    expect(railCentreX(0) + railCentreX(RAILS - 1), 'symmetric across the band').toBe(FIELD_WIDTH);
  });

  it('clamps a finger inside the burrow, and refuses one far outside it', () => {
    expect(railUnder(-RAIL_WIDTH * 0.4)).toBe(0);
    expect(railUnder(FIELD_WIDTH + RAIL_WIDTH * 0.4)).toBe(RAILS - 1);
    expect(railUnder(-RAIL_WIDTH), 'a finger in the margin names nothing').toBe(-1);
    expect(railUnder(FIELD_WIDTH + RAIL_WIDTH)).toBe(-1);
  });

  it('maps a band onto the board and back again, both ways up', () => {
    const there = { x: 0, y: 0 };
    const back = { x: 0, y: 0 };
    for (const seat of SEATS) {
      for (const flipped of [false, true]) {
        for (const [fx, fy] of [
          [0, 0],
          [FIELD_WIDTH, FIELD_HEIGHT],
          [123.5, 321.25],
        ] as [number, number][]) {
          toBoard(seat, flipped, fx, fy, there);
          toField(seat, flipped, there.x, there.y, back);
          expect(back.x).toBeCloseTo(fx, 9);
          expect(back.y).toBeCloseTo(fy, 9);
        }
      }
    }
  });

  it('places the two bands as point reflections of one another', () => {
    const near = { x: 0, y: 0 };
    const far = { x: 0, y: 0 };
    for (const [fx, fy] of [
      [0, 0],
      [FIELD_WIDTH, FIELD_HEIGHT],
      [200, 100],
    ] as [number, number][]) {
      toBoard('p1', false, fx, fy, near);
      toBoard('p2', true, fx, fy, far);
      expect(near.x + far.x).toBeCloseTo(BOARD_WIDTH, 9);
      expect(near.y + far.y).toBeCloseTo(BOARD_HEIGHT, 9);
    }
  });
});

describe('rendering', () => {
  it('draws every shape inside the declared box, at every stage of a race', () => {
    const game = started(makeContext(7, 'easy', 'hard'));
    for (let i = 0; i < 60 * 120; i += 1) {
      game.update(STEP, IDLE);
      const decided = game.getScore().winner !== null;
      if (i % 97 === 0 || decided) {
        for (const box of boxes(draw(game, 0.5))) {
          expect(box.x0, `${box.kind} off the left`).toBeGreaterThanOrEqual(0);
          expect(box.x1, `${box.kind} off the right`).toBeLessThanOrEqual(BOARD_WIDTH);
          expect(box.y0, `${box.kind} off the top`).toBeGreaterThanOrEqual(0);
          expect(box.y1, `${box.kind} off the bottom`).toBeLessThanOrEqual(BOARD_HEIGHT);
        }
      }
      if (decided) break;
    }
  });

  it('keeps every shape a seat owns out of the other seat’s band', () => {
    // A paw is the one thing with length along the burrow, so it is the one thing that can
    // hang over the horizon — and a claw past the top of the near band lands inside the far
    // one, which is a paw appearing in a burrow it is not in.
    const game = started(makeContext(8, 'normal', 'easy'));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, IDLE);
      if (i % 53 !== 0) continue;
      for (const box of boxes(draw(game))) {
        const owner = ownerOf(box);
        if (owner === 'p1') {
          expect(box.y0, 'p1 reached into p2’s band').toBeGreaterThan(P2_TOP + FIELD_HEIGHT);
        } else if (owner === 'p2') {
          expect(box.y1, 'p2 reached into p1’s band').toBeLessThan(P1_TOP);
        } else {
          // Only the clock lies between the two, and it is a bar three units either side of
          // the halfway line. Anything else unowned is a shape that has left its own band.
          expect(box.y0, 'a stray shape between the bands').toBeGreaterThanOrEqual(MIDLINE - 4);
          expect(box.y1, 'a stray shape between the bands').toBeLessThanOrEqual(MIDLINE + 4);
        }
      }
    }
  });

  it('gives both seats the same burrow, shape for shape', () => {
    // The fairness claim at the level a player actually sees it. With both rats in the same
    // state, every shape of burrow in one window must have its twin in the other.
    const game = started();
    for (let round = 0; round < 6; round += 1) {
      advance(game, 90, IDLE);
      const renderer = draw(game);
      const near = inFieldFrame(renderer, 'p1', false);
      expect(near.length, 'nothing left to compare').toBeGreaterThan(8);
      expect(inFieldFrame(renderer, 'p2', true)).toEqual(near);
    }
  });

  it('keeps the two windows identical once both rats are running the burrow', () => {
    // The same claim a long way down the course, with paws falling and cheese going. Two
    // rats given the same instruction see the same thing, because there is one burrow.
    const game = started(makeContext(14));
    const input = new ScriptedInput();
    input.hold('p1');
    input.hold('p2');
    for (let round = 0; round < 8; round += 1) {
      advance(game, 120, input);
      const renderer = draw(game);
      const near = inFieldFrame(renderer, 'p1', false);
      expect(near.length, 'nothing left to compare').toBeGreaterThan(8);
      expect(inFieldFrame(renderer, 'p2', true)).toEqual(near);
    }
    expect(game.race.p1.distance).toBeGreaterThan(VIEW_AHEAD * 2);
  });

  it('draws the two rats differently, so the board reads in greyscale (rule 7)', () => {
    const game = started();
    advance(game, 90, IDLE);
    const renderer = draw(game);
    const ratShapes = (seat: SeatId, flipped: boolean): string[] => {
      const a = { x: 0, y: 0 };
      const keys: string[] = [];
      for (const box of boxes(renderer)) {
        if (ownerOf(box) !== seat) continue;
        toField(seat, flipped, box.x0, box.y0, a);
        if (Math.abs(a.y - RAT_FIELD_Y) > 60) continue;
        keys.push(`${box.kind}:${(box.x1 - box.x0).toFixed(3)}x${(box.y1 - box.y0).toFixed(3)}`);
      }
      return keys.sort();
    };
    const near = ratShapes('p1', false);
    expect(near.length).toBeGreaterThan(3);
    expect(ratShapes('p2', true), 'the two rats are the same silhouette').not.toEqual(near);
  });

  it('marks a flattened rat in shape as well as in colour', () => {
    const game = started();
    advance(game, 30, IDLE);
    const quiet = draw(game).ops.length;
    game.race.p1.stun = STUN_SECONDS;
    expect(draw(game).ops.length, 'a strike through it, not another colour').toBeGreaterThan(quiet);
  });

  it('marks a pickup over the rat that made it, for the steps the flash lasts', () => {
    // A count of draw calls would not do: the wedge that was taken stops being drawn on the
    // same frame, so the total goes *down*. The mark is looked for where it is put.
    const game = started();
    const input = new ScriptedInput();
    const marked = (): boolean =>
      draw(game).ops.some(
        (entry) =>
          entry.op === 'circle' &&
          Math.abs((entry.args[1] as number) - (P1_TOP + RAT_FIELD_Y - 42)) < 0.5,
      );

    expect(marked(), 'nothing over a rat that has taken nothing').toBe(false);
    input.hold('p1');
    let took = false;
    for (let i = 0; i < 600 && !took; i += 1) {
      const before = game.getScore().p1;
      game.update(STEP, input);
      took = game.getScore().p1 > before;
    }
    expect(took, 'no cheese was ever picked up').toBe(true);
    expect(marked(), 'the moment it is taken').toBe(true);

    // Held for the flash and then gone, with the throttle off so nothing else is taken.
    input.hold('p1', false);
    advance(game, FLASH_STEPS - 2, input);
    expect(marked(), 'still marked while the flash lasts').toBe(true);
    advance(game, 4, input);
    expect(marked(), 'and clear again afterwards').toBe(false);
  });

  it('says nothing in words, so neither seat has to read it upside down', () => {
    const game = started(makeContext(9, 'hard', 'hard'));
    advance(game, 600, IDLE);
    expect(draw(game).ops.some((entry) => entry.op === 'text')).toBe(false);
  });

  it('never asks the renderer to turn the board', () => {
    // Both seats read at once, so there is no rotation to push: the two bands are drawn
    // point-symmetrically instead, which is what makes both of them upright at once.
    const game = started();
    advance(game, 120, IDLE);
    const ops = draw(game).ops.map((entry) => entry.op);
    expect(ops).not.toContain('pushSeatRotation');
    expect(ops).not.toContain('pushRotation');
    expect(ops).not.toContain('popSeatRotation');
  });

  it('does not move the simulation on', () => {
    const game = started(makeContext(10, 'easy', 'easy'));
    advance(game, 300, IDLE);
    const before = `${String(game.race.p1.distance)}:${String(game.race.p2.rail)}:${String(game.race.elapsed)}`;
    for (let i = 0; i < 20; i += 1) draw(game, i / 20);
    expect(
      `${String(game.race.p1.distance)}:${String(game.race.p2.rail)}:${String(game.race.elapsed)}`,
    ).toBe(before);
  });

  it('survives an alpha the loop should never hand it', () => {
    const game = started();
    advance(game, 60, IDLE);
    for (const alpha of [Number.NaN, -3, 4, Number.POSITIVE_INFINITY]) {
      for (const box of boxes(draw(game, alpha))) {
        expect(Number.isFinite(box.x0)).toBe(true);
        expect(Number.isFinite(box.y1)).toBe(true);
      }
    }
  });
});

describe('a whole match', () => {
  it('reaches a decision at every tier, inside the clock', () => {
    for (const tier of TIERS) {
      const game = started(makeContext(11, tier, tier));
      const steps = play(game);
      expect(steps, `${tier} never finished`).toBeGreaterThanOrEqual(0);
      expect(game.race.elapsed).toBeLessThanOrEqual(RACE_SECONDS + STEP);
      expect(game.getScore().winner).not.toBeNull();
    }
  });

  it('reaches a decision with nobody driving at all', () => {
    const game = started();
    const steps = play(game);
    expect(steps).toBeGreaterThanOrEqual(0);
    // Two rats that never move are the same rat, so it is the dead heat it looks like.
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: 'draw' });
    expect(game.race.elapsed).toBeGreaterThanOrEqual(RACE_SECONDS);
  });

  it('is won by a bot against a seat nobody is driving, at every tier', () => {
    for (const tier of TIERS) {
      const game = started(makeContext(12, null, tier));
      play(game);
      expect(game.getScore().winner, `${tier} lost to an empty seat`).toBe('p2');
    }
  });

  it('never scores past a full load, and never goes backwards', () => {
    const game = started(makeContext(13, 'normal', 'hard'));
    let p1 = 0;
    let p2 = 0;
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, IDLE);
      const score = game.getScore();
      expect(score.p1).toBeGreaterThanOrEqual(p1);
      expect(score.p2).toBeGreaterThanOrEqual(p2);
      expect(score.p1).toBeLessThanOrEqual(TARGET_CHEESE);
      expect(score.p2).toBeLessThanOrEqual(TARGET_CHEESE);
      p1 = score.p1;
      p2 = score.p2;
      if (score.winner !== null) break;
    }
    expect(Math.max(p1, p2)).toBe(TARGET_CHEESE);
  });

  it('replays a fixed keyboard trace to the identical result', () => {
    const trace = (): string => {
      const game = started(makeContext(707, null, 'normal'));
      const input = new ScriptedInput();
      for (let i = 0; i < 60 * 90; i += 1) {
        input.hold('p1', i % 90 < 70);
        input.steer('p1', i % 37 === 0 ? 1 : 0);
        game.update(STEP, input);
        if (game.getScore().winner !== null) break;
      }
      const score = game.getScore();
      return `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}:${game.race.p1.distance.toFixed(6)}`;
    };
    expect(trace()).toBe(trace());
  });

  it('plays a different match from a different seed', () => {
    const outcome = (seed: number): string => {
      const game = started(makeContext(seed, 'normal', 'normal'));
      play(game);
      return `${String(game.getScore().p1)}:${String(game.race.p1.distance.toFixed(3))}`;
    };
    expect(outcome(31)).not.toBe(outcome(32));
  });
});

/** Play `runs` seeded matches of one pairing and return how often seat one won. */
function pairing(p1: BotDifficulty, p2: BotDifficulty, runs: number): number {
  let wins = 0;
  for (let seed = 1; seed <= runs; seed += 1) {
    const game = started(makeContext(seed * 977, p1, p2));
    play(game);
    if (game.getScore().winner === 'p1') wins += 1;
  }
  return wins;
}

describe('the tiers, measured through the game', () => {
  const RUNS = 30;

  it('has a stronger tier beat a weaker one from either seat', () => {
    // From *either* seat, because a tier that only wins from seat one is a seat bias wearing
    // a difficulty's clothes. The two are near enough the same number here.
    const hardAsNear = pairing('hard', 'easy', RUNS);
    const hardAsFar = RUNS - pairing('easy', 'hard', RUNS);
    expect(hardAsNear, `hard as p1 won ${String(hardAsNear)}/${String(RUNS)}`).toBeGreaterThan(
      RUNS * 0.8,
    );
    expect(hardAsFar, `hard as p2 won ${String(hardAsFar)}/${String(RUNS)}`).toBeGreaterThan(
      RUNS * 0.8,
    );
  });

  it('has the middle tier sit between the two, and beat the weak one', () => {
    const normalOverEasy = pairing('normal', 'easy', RUNS);
    const hardOverNormal = pairing('hard', 'normal', RUNS);
    expect(normalOverEasy, 'normal must beat easy').toBeGreaterThan(RUNS * 0.7);
    expect(hardOverNormal, 'hard must beat normal').toBeGreaterThan(RUNS * 0.55);
    expect(hardOverNormal, 'but not as easily as it beats easy').toBeLessThan(normalOverEasy + 1);
  });

  it('is a fair fight between two bots of the same tier', () => {
    for (const tier of TIERS) {
      const wins = pairing(tier, tier, RUNS);
      expect(wins, `${tier} vs ${tier}: p1 won ${String(wins)}/${String(RUNS)}`).toBeGreaterThan(
        RUNS * 0.25,
      );
      expect(wins).toBeLessThan(RUNS * 0.75);
    }
  });
});
