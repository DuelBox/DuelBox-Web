import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { StickyTonguesGame } from './game.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  FROG_RADIUS,
  FROG_SPEED,
  SHOT_CYCLE_SECONDS,
  STEER_DEADZONE,
  TAP_RADIUS,
  TAP_SECONDS,
  TARGET_CATCHES,
  bankMaxYOf,
  bankMinYOf,
  frogOf,
  homeYOf,
} from './rules.js';
import type { BotDifficulty, State } from './rules.js';

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
  };
}

/**
 * A hand-built input record.
 *
 * Used only where a test needs a state the real `InputManager` also produces and where
 * building it by hand is clearer. Everything about the **separation of the two channels** is
 * driven through a real `InputManager` instead — that is the whole point of those tests, and
 * `docs/input-idiom.md` records Sea Battle shipping a dead branch precisely because its test
 * supplied a literal the engine can never emit.
 */
class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  steer(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.move.x = x;
    target.move.y = y;
    target.actionPressed = false;
    target.actionHeld = false;
    target.actionReleased = false;
  }

  keyShot(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = true;
    target.actionHeld = true;
    target.actionReleased = false;
  }

  idle(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.move.x = 0;
    target.move.y = 0;
    target.actionPressed = false;
    target.actionHeld = false;
    target.actionReleased = false;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

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

  /** Every mark drawn in one seat's own colours. */
  seatCalls(seat: SeatId): Call[] {
    const palette = SEAT_PALETTE[seat];
    const owned = new Set<string>([palette.base, palette.deep, palette.tint, palette.soft]);
    return this.calls.filter((call) =>
      call.args.some((arg) => typeof arg === 'string' && owned.has(arg)),
    );
  }

  /** Every call with the colour arguments dropped: the picture a greyscale player sees. */
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
function snapshot(game: StickyTonguesGame): string {
  const state: Readonly<State> = game.state;
  return JSON.stringify({
    p1: state.p1,
    p2: state.p2,
    clock: state.clock,
    winner: state.winner,
    frogs: [state.p1Frog, state.p2Frog],
    flies: state.flies,
  });
}

/** A real `InputManager` over the declared box, split the way the shell splits it. */
function realInput(): InputManager {
  return new InputManager(
    { width: BOARD_WIDTH, height: BOARD_HEIGHT },
    { split: 'horizontal', bottomSeat: 'p1' },
  );
}

/** How many shots seat one has started so far. */
function shotsTaken(game: StickyTonguesGame): number {
  const frog = frogOf(game.state, 'p1');
  return frog.wasted + frog.shotCaught + (frog.shooting ? 1 : 0);
}

/* ------------------------------------------------------------------------------------ */
/* The contract                                                                          */
/* ------------------------------------------------------------------------------------ */

describe('the contract', () => {
  it('never claims to have turns, because both frogs act at once', () => {
    const game = new StickyTonguesGame();
    // `apps/web/src/data/turn-seat.test.ts` fails an `rt-*` game that answers this, because
    // `GameHost` decides a game is turn-based from the presence of the method alone.
    expect((game as { getActiveSeat?: unknown }).getActiveSeat).toBeUndefined();
  });

  it('reports a score of the shape the shell expects', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(1));
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
  });

  it('does nothing at all before init and after destroy', () => {
    const game = new StickyTonguesGame();
    const input = new ScriptedInput();
    game.update(STEP, input);
    expect(game.getScore().p1).toBe(0);

    game.init(makeContext(2, 'hard', 'hard'));
    for (let i = 0; i < 240; i += 1) game.update(STEP, input);
    expect(game.state.clock).toBeGreaterThan(0);

    game.destroy();
    const after = snapshot(game);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(snapshot(game)).toBe(after);
  });

  it('plays the identical match twice from the same seed', () => {
    const runs: string[] = [];
    for (let run = 0; run < 2; run += 1) {
      const game = new StickyTonguesGame();
      game.init(makeContext(99, 'normal', 'easy'));
      const input = new ScriptedInput();
      for (let i = 0; i < 900; i += 1) game.update(STEP, input);
      runs.push(snapshot(game));
      game.destroy();
    }
    expect(runs[0]).toBe(runs[1]);
  });

  it('plays the same match whichever seat the shell says opens', () => {
    // A real-time game may ignore `openingSeat`, and this one does: nothing on the board
    // belongs to a seat, so there is no opener for the shell's alternation to alternate.
    // This is the check that ignoring it is deliberate rather than a value silently read.
    const seen: string[] = [];
    for (const openingSeat of ['p1', 'p2'] as const) {
      const game = new StickyTonguesGame();
      game.init(makeContext(31, 'normal', 'normal', 'shared-screen', 'p1', openingSeat));
      const input = new ScriptedInput();
      for (let i = 0; i < 600; i += 1) game.update(STEP, input);
      seen.push(snapshot(game));
      game.destroy();
    }
    expect(seen[0]).toBe(seen[1]);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Two mechanics, one hand                                                               */
/* ------------------------------------------------------------------------------------ */

describe('steering and the tongue are separate channels', () => {
  /**
   * The defect this whole section exists to avoid, in the repository's own words:
   *
   * > **tennis** — Manifest says "every fresh press is a jump for a high ball" and the code
   * > binds the jump to `actionPressed`, which a *steering* press also raises. Steering and
   * > jumping share one edge, so beginning to move is also a jump.
   *
   * `actionHeld` is `keys.action || pointerDown`, so a finger on the glass *is* the action.
   * Every test below drives a real `InputManager`, because that fusion only exists in the
   * engine and a hand-built input record cannot reproduce it.
   */
  it('never fires the tongue while a finger is steering, however far it drags', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(101));
    const input = realInput();
    const view = new InputView();

    input.pointerDown(1, 300, 900);
    let fired = 0;
    for (let i = 0; i < 200; i += 1) {
      // A long, wandering drag over the whole of seat one's own band.
      input.pointerMove(1, 100 + ((i * 7) % 400), 600 + ((i * 11) % 340));
      game.update(STEP, view.sync(input.beginStep(STEP)));
      if (frogOf(game.state, 'p1').shooting) fired += 1;
    }
    input.pointerUp(1);
    game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(fired).toBe(0);
    expect(shotsTaken(game)).toBe(0);
    // And it really did steer: the frog is somewhere other than where it started.
    expect(frogOf(game.state, 'p1').y).not.toBe(homeYOf('p1'));
  });

  it('fires exactly one tongue for a tap, and none for the press that begins it', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(102));
    const input = realInput();
    const view = new InputView();

    input.pointerDown(1, 300, 900);
    game.update(STEP, view.sync(input.beginStep(STEP)));
    // The press step. `actionPressed` is up here and the tongue has not moved.
    expect(frogOf(game.state, 'p1').shooting).toBe(false);

    input.pointerUp(1);
    game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(frogOf(game.state, 'p1').shooting).toBe(true);
    expect(frogOf(game.state, 'p1').shotSeconds).toBeCloseTo(STEP, 9);
  });

  it('treats a finger held on one spot past the tap window as a steer, not a shot', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(103));
    const input = realInput();
    const view = new InputView();

    input.pointerDown(1, 300, 700);
    for (let i = 0; i < Math.ceil(TAP_SECONDS * 60) + 6; i += 1) {
      input.pointerMove(1, 300, 700);
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    input.pointerUp(1);
    game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(shotsTaken(game)).toBe(0);
    // The hold *did* steer, which is the other half of the claim: a finger resting on one
    // spot is quantised onto a five-unit lattice and never leaves the six-unit tap radius,
    // so without the window it would have been a shot that also refused to move.
    expect(frogOf(game.state, 'p1').y).toBeLessThan(homeYOf('p1'));
  });

  it('will not let a drag that returns to the press point fire after all', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(104));
    const input = realInput();
    const view = new InputView();

    input.pointerDown(1, 300, 900);
    game.update(STEP, view.sync(input.beginStep(STEP)));
    input.pointerMove(1, 300 + TAP_RADIUS * 6, 900);
    game.update(STEP, view.sync(input.beginStep(STEP)));
    input.pointerMove(1, 300, 900);
    game.update(STEP, view.sync(input.beginStep(STEP)));
    input.pointerUp(1);
    game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(shotsTaken(game)).toBe(0);
  });

  it('never fires the tongue while the direction keys are held', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(105));
    const input = realInput();
    const view = new InputView();

    input.keyDown('KeyD');
    input.keyDown('KeyW');
    for (let i = 0; i < 120; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(shotsTaken(game)).toBe(0);
    expect(frogOf(game.state, 'p1').x).toBeGreaterThan(BOARD_WIDTH / 2);

    // And the action key, on its own, does fire — so the silence above is a separation and
    // not a game that cannot shoot from a keyboard at all.
    input.keyDown('Space');
    game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(frogOf(game.state, 'p1').shooting).toBe(true);
  });

  it('forgets a gesture across a pause instead of releasing it into a shot', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(106));
    const input = realInput();
    const view = new InputView();

    input.pointerDown(1, 300, 900);
    game.update(STEP, view.sync(input.beginStep(STEP)));
    game.onPause();
    // The shell's `InputManager.clear()` is what a pause really does to a finger.
    input.clear();
    game.onResume();
    for (let i = 0; i < 10; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(shotsTaken(game)).toBe(0);
  });
});

describe('the two instruments', () => {
  /**
   * Steering is the sign of the gap on each axis and nothing else — nine headings, which is
   * exactly the vocabulary `move` gives a keyboard. So the same walk, spelled with keys and
   * spelled with a finger, has to land on the same coordinate.
   */
  it('walk a frog to the identical coordinate for the same heading', () => {
    const byKey = new StickyTonguesGame();
    const byThumb = new StickyTonguesGame();
    byKey.init(makeContext(111));
    byThumb.init(makeContext(111));
    const keyInput = realInput();
    const thumbInput = realInput();
    const keyView = new InputView();
    const thumbView = new InputView();

    // A finger far up and to the right of the frog: the sign of both gaps is the same as the
    // two keys', so the answer must be the same nine-heading command. The press step is spent
    // deciding which channel the gesture is, so it is taken before the keys go down.
    thumbInput.pointerDown(1, 500, 600);
    byThumb.update(STEP, thumbView.sync(thumbInput.beginStep(STEP)));
    keyInput.keyDown('KeyD');
    keyInput.keyDown('KeyW');
    for (let i = 0; i < 60; i += 1) {
      thumbInput.pointerMove(1, 540, 560);
      byKey.update(STEP, keyView.sync(keyInput.beginStep(STEP)));
      byThumb.update(STEP, thumbView.sync(thumbInput.beginStep(STEP)));
    }
    const a = frogOf(byKey.state, 'p1');
    const b = frogOf(byThumb.state, 'p1');
    expect(b.x).toBeCloseTo(a.x, 12);
    expect(b.y).toBeCloseTo(a.y, 12);
  });

  it('cannot move a frog faster with a finger than with a key', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(112));
    const input = realInput();
    const view = new InputView();
    const before = frogOf(game.state, 'p1').x;
    // A thumb slammed against the far wall: still exactly one frame of walking.
    input.pointerDown(1, 599, 999);
    input.pointerMove(1, 599, 999);
    game.update(STEP, view.sync(input.beginStep(STEP)));
    game.update(STEP, view.sync(input.beginStep(STEP)));
    const moved = Math.abs(frogOf(game.state, 'p1').x - before);
    expect(moved).toBeLessThanOrEqual(FROG_SPEED * STEP + 1e-9);
  });

  it('stands still inside the deadzone rather than holding the last direction', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(113));
    const input = realInput();
    const view = new InputView();
    const frog = frogOf(game.state, 'p1');
    // Press on the frog itself and hold past the tap window: inside the deadzone on both
    // axes, so the answer is a standstill and not "keep going the way you were".
    input.pointerDown(1, frog.x, frog.y);
    for (let i = 0; i < Math.ceil(TAP_SECONDS * 60) + 30; i += 1) {
      input.pointerMove(1, frog.x, frog.y);
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    expect(Math.abs(frog.x - BOARD_WIDTH / 2)).toBeLessThanOrEqual(STEER_DEADZONE);
    expect(Math.abs(frog.y - homeYOf('p1'))).toBeLessThanOrEqual(STEER_DEADZONE);
  });

  it('mirrors the far seat’s keys, and only when that seat is reading upside down', () => {
    for (const presentation of ['shared-screen', 'single-seat'] as const) {
      const game = new StickyTonguesGame();
      game.init(makeContext(114, null, null, presentation));
      const input = new ScriptedInput();
      input.steer('p2', 1, 0);
      for (let i = 0; i < 30; i += 1) game.update(STEP, input);
      const moved = frogOf(game.state, 'p2').x - BOARD_WIDTH / 2;
      if (presentation === 'shared-screen') expect(moved).toBeLessThan(0);
      else expect(moved).toBeGreaterThan(0);
      game.destroy();
    }
  });

  it('reads a finger in board space for both seats, with no mirror', () => {
    // The marsh is one board drawn one way up, so a finger is already over the water it
    // means whichever side of the device its owner is sitting on.
    const game = new StickyTonguesGame();
    game.init(makeContext(115));
    const input = realInput();
    const view = new InputView();
    input.pointerDown(2, 120, 200);
    for (let i = 0; i < 40; i += 1) {
      input.pointerMove(2, 120, 200);
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    const frog = frogOf(game.state, 'p2');
    expect(frog.x).toBeLessThan(BOARD_WIDTH / 2);
    expect(frog.y).toBeLessThan(homeYOf('p2') + 400);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The two presentations are one game                                                    */
/* ------------------------------------------------------------------------------------ */

describe('the two presentations are one game', () => {
  it('steps the identical match on a shared phone and on two of them', () => {
    const seen: string[] = [];
    for (const [presentation, localSeat] of [
      ['shared-screen', 'p1'],
      ['single-seat', 'p2'],
    ] as const) {
      const game = new StickyTonguesGame();
      game.init(makeContext(121, null, 'normal', presentation, localSeat));
      const input = realInput();
      const view = new InputView();
      for (let i = 0; i < 600; i += 1) {
        if (i % 40 === 0) input.pointerDown(1, 120 + ((i * 13) % 360), 620 + ((i * 7) % 300));
        if (i % 40 === 20) input.pointerUp(1);
        game.update(STEP, view.sync(input.beginStep(STEP)));
      }
      seen.push(snapshot(game));
      game.destroy();
    }
    expect(seen[0]).toBe(seen[1]);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Rendering                                                                             */
/* ------------------------------------------------------------------------------------ */

describe('rendering', () => {
  it('changes nothing, at any alpha', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(131, 'hard', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) game.update(STEP, input);
    const before = snapshot(game);
    const renderer = new RecordingRenderer();
    for (const alpha of [0, 0.25, 0.5, 0.75, 0.999]) {
      for (let i = 0; i < 24; i += 1) game.render(renderer, alpha);
    }
    expect(snapshot(game)).toBe(before);
    expect(renderer.calls.length).toBeGreaterThan(0);
  });

  it('interpolates between the last two steps, which is what alpha is for', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(132, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    const at = (alpha: number): string => {
      const renderer = new RecordingRenderer();
      game.render(renderer, alpha);
      return renderer.shapesOnly().join('\n');
    };
    expect(at(0)).not.toBe(at(0.9));
  });

  it('keeps every drawn point inside the declared logical box', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(133, 'easy', 'hard'));
    const input = new ScriptedInput();
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, input);
      if (i % 5 === 0) game.render(renderer, (i % 7) / 7);
    }
    for (const call of renderer.calls) {
      if (call.op === 'text' || call.op === 'clear') continue;
      const numbers = call.args.filter((arg): arg is number => typeof arg === 'number');
      for (const value of numbers) {
        expect(Math.abs(value)).toBeLessThanOrEqual(BOARD_HEIGHT + 1);
      }
    }
  });

  it('draws no text at all until somebody has finished a shot', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(134));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.calls.some((call) => call.op === 'text')).toBe(false);
  });

  it('turns one seat’s tally to face it, and only in shared-screen play', () => {
    for (const presentation of ['shared-screen', 'single-seat'] as const) {
      const game = new StickyTonguesGame();
      game.init(makeContext(135, 'hard', 'hard', presentation));
      const input = new ScriptedInput();
      const rotations = new Set<boolean>();
      for (let i = 0; i < 900; i += 1) {
        game.update(STEP, input);
        const renderer = new RecordingRenderer();
        game.render(renderer, 0);
        for (const call of renderer.calls) {
          if (call.op === 'pushSeatRotation') rotations.add(call.args[0] === true);
        }
      }
      if (presentation === 'shared-screen') expect(rotations.has(true)).toBe(true);
      else expect(rotations.has(true)).toBe(false);
      game.destroy();
    }
  });
});

/* ------------------------------------------------------------------------------------ */
/* The board read without colour                                                         */
/* ------------------------------------------------------------------------------------ */

describe('the board read without colour', () => {
  function busyFrame(seed: number): RecordingRenderer {
    const game = new StickyTonguesGame();
    game.init(makeContext(seed, 'hard', 'hard'));
    const input = new ScriptedInput();
    const renderer = new RecordingRenderer();
    let frames = 0;
    for (let i = 0; i < 1200 && frames < 40; i += 1) {
      game.update(STEP, input);
      if (i % 30 === 0) {
        game.render(renderer, 0);
        frames += 1;
      }
    }
    game.destroy();
    return renderer;
  }

  it('gives seat one only round marks and seat two only square ones', () => {
    const renderer = busyFrame(141);
    // `line` is shared because a tongue is a stroke either way, and `text` because rule 7
    // names a *label* as a signal in its own right — the shot tally is one, and it is turned
    // to face the seat that owns it.
    const rounds = new Set(['circle', 'strokeCircle', 'line', 'text']);
    const squares = new Set(['rect', 'strokeRect', 'line', 'text']);
    const p1 = renderer.seatCalls('p1');
    const p2 = renderer.seatCalls('p2');
    expect(p1.length).toBeGreaterThan(20);
    expect(p2.length).toBeGreaterThan(20);
    for (const call of p1) expect(rounds.has(call.op), `p1 drew ${call.op}`).toBe(true);
    for (const call of p2) expect(squares.has(call.op), `p2 drew ${call.op}`).toBe(true);
    // And each seat really does use its own family, rather than both being lines.
    expect(p1.some((call) => call.op === 'circle')).toBe(true);
    expect(p2.some((call) => call.op === 'rect')).toBe(true);
  });

  it('gives the two frogs the same area, so neither seat is the bigger target', () => {
    const renderer = busyFrame(142);
    const disc = renderer
      .seatCalls('p1')
      .find((call) => call.op === 'circle' && call.args[2] === FROG_RADIUS);
    // The body is the largest square seat two draws; the eyes and pips are smaller.
    const side = renderer
      .seatCalls('p2')
      .filter((call) => call.op === 'rect' && call.args[2] === call.args[3])
      .reduce((widest, call) => Math.max(widest, call.args[2] as number), 0);
    expect(disc).toBeDefined();
    expect(side).toBeGreaterThan(0);
    expect(side * side).toBeCloseTo(Math.PI * FROG_RADIUS * FROG_RADIUS, 6);
  });

  it('is still two different pictures once every colour is thrown away', () => {
    const renderer = busyFrame(143);
    const shapes = renderer.shapesOnly();
    expect(shapes.some((mark) => mark.startsWith('circle('))).toBe(true);
    expect(shapes.some((mark) => mark.startsWith('rect('))).toBe(true);
    // The dragonfly is neither: a pair of crossed strokes, so it can never be read as
    // either seat's frog with the colour gone.
    expect(shapes.filter((mark) => mark.startsWith('line(')).length).toBeGreaterThan(8);
  });

  it('marks a wasted shot by an outline rather than by a hue', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(144));
    const input = new ScriptedInput();
    const fresh = new RecordingRenderer();
    game.render(fresh, 0);
    const solidBefore = fresh.calls.filter((call) => call.op === 'circle').length;

    // Flick from the back line until one shot comes back empty.
    for (let shot = 0; shot < 25 && frogOf(game.state, 'p1').wasted === 0; shot += 1) {
      input.keyShot('p1');
      game.update(STEP, input);
      input.idle('p1');
      for (let i = 0; i < Math.ceil(SHOT_CYCLE_SECONDS * 60) + 2; i += 1) game.update(STEP, input);
    }
    expect(frogOf(game.state, 'p1').wasted).toBe(1);

    const after = new RecordingRenderer();
    game.render(after, 0);
    const solidAfter = after.calls.filter((call) => call.op === 'circle').length;
    expect(solidAfter).toBeLessThan(solidBefore);
    expect(after.calls.some((call) => call.op === 'strokeCircle')).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The bots are wired through                                                            */
/* ------------------------------------------------------------------------------------ */

describe('the bots are wired through', () => {
  it('plays a different match at each tier', () => {
    const seen = new Set<string>();
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const game = new StickyTonguesGame();
      game.init(makeContext(151, tier, tier));
      const input = new ScriptedInput();
      for (let i = 0; i < 600; i += 1) game.update(STEP, input);
      seen.add(snapshot(game));
      game.destroy();
    }
    expect(seen.size).toBe(3);
  });

  it('finishes a match, and two seats that never touch the screen finish one too', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(152, 'easy', 'easy'));
    const input = new ScriptedInput();
    let steps = 0;
    while (game.getScore().winner === null && steps < 60 * 600) {
      game.update(STEP, input);
      steps += 1;
    }
    expect(game.getScore().winner).not.toBeNull();
    expect(Math.max(game.getScore().p1, game.getScore().p2)).toBeLessThanOrEqual(TARGET_CATCHES);

    const idle = new StickyTonguesGame();
    idle.init(makeContext(153));
    let idleSteps = 0;
    while (idle.getScore().winner === null && idleSteps < 60 * 600) {
      idle.update(STEP, input);
      idleSteps += 1;
    }
    expect(idle.getScore().winner).toBe('draw');
  });

  it('keeps both frogs on their own banks for a whole bot match', () => {
    const game = new StickyTonguesGame();
    game.init(makeContext(154, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 1200; i += 1) {
      game.update(STEP, input);
      for (const seat of ['p1', 'p2'] as const) {
        const frog = frogOf(game.state, seat);
        expect(frog.y).toBeGreaterThanOrEqual(bankMinYOf(seat));
        expect(frog.y).toBeLessThanOrEqual(bankMaxYOf(seat));
      }
    }
  });
});
