import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOARD_ORIGIN_X,
  BOARD_ORIGIN_Y,
  BUBBLE_RADIUS,
  PopItGame,
  bubbleAt,
  bubbleCentre,
} from './game.js';
import { BUBBLE_COUNT, ROW_COUNT, ROW_SIZES, bubblesLeft, rowStart, sizeOf } from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

const STEP = 1 / 60;

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

  /** A finger going down at a point. */
  down(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = true;
    target.actionHeld = true;
    target.actionReleased = false;
  }

  /** The same finger moving, still down. */
  dragTo(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = false;
    target.actionHeld = true;
    target.actionReleased = false;
  }

  /**
   * The finger lifting.
   *
   * The pointer is **null** on this step, exactly as the engine reports it: a finger that
   * has left the glass has no position. Darts was caught out by a fake that kept one.
   */
  lift(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = false;
    target.actionHeld = false;
    target.actionReleased = true;
  }

  idle(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = false;
    target.actionHeld = false;
    target.actionReleased = false;
    target.move.x = 0;
    target.move.y = 0;
  }

  press(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = true;
    target.actionHeld = true;
    target.actionReleased = false;
  }

  steer(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.move.x = x;
    target.move.y = y;
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
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

type DrawArg = number | string | boolean | undefined;

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
    this.#record('pushRotation', radians);
  }
  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  #record(op: string, ...values: DrawArg[]): void {
    this.ops.push(op);
    for (const value of values) this.args.push(value);
  }
}

const point: Vec2 = vec2();

function at(row: number, index: number): { x: number; y: number } {
  bubbleCentre(point, row, index);
  return { x: point.x, y: point.y };
}

function fixture(game: PopItGame): Position {
  return game.position;
}

function settle(game: PopItGame, input: ScriptedInput, steps = 40): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, input);
}

/** Drags a run and lifts, which is how a finger makes a move. */
function dragRun(
  game: PopItGame,
  input: ScriptedInput,
  seat: SeatId,
  row: number,
  from: number,
  to: number,
): void {
  const start = at(row, from);
  input.down(seat, start.x, start.y);
  game.update(STEP, input);
  const end = at(row, to);
  input.dragTo(seat, end.x, end.y);
  game.update(STEP, input);
  input.lift(seat);
  game.update(STEP, input);
  input.idle(seat);
  game.update(STEP, input);
}

describe('the sheet on screen', () => {
  it('names the bubble under a point, and nothing between them', () => {
    for (let row = 0; row < ROW_COUNT; row += 1) {
      for (let index = 0; index < sizeOf(row); index += 1) {
        const centre = at(row, index);
        expect(bubbleAt(centre.x, centre.y)).toEqual({ row, index });
      }
    }
    // The gap between two bubbles belongs to neither, so a sloppy tap does nothing rather
    // than something surprising.
    const first = at(0, 0);
    expect(bubbleAt(first.x, first.y - BUBBLE_RADIUS * 1.5)).toBeNull();
    expect(bubbleAt(0, 0)).toBeNull();
  });

  it('keeps every bubble inside the logical play area', () => {
    for (let row = 0; row < ROW_COUNT; row += 1) {
      for (let index = 0; index < sizeOf(row); index += 1) {
        const centre = at(row, index);
        expect(centre.x - BUBBLE_RADIUS).toBeGreaterThan(0);
        expect(centre.y - BUBBLE_RADIUS).toBeGreaterThan(0);
        expect(centre.x + BUBBLE_RADIUS).toBeLessThan(manifest.logical.width);
        expect(centre.y + BUBBLE_RADIUS).toBeLessThan(manifest.logical.height);
      }
    }
    expect(BOARD_ORIGIN_X).toBeGreaterThan(0);
    expect(BOARD_ORIGIN_Y).toBeGreaterThan(0);
  });

  it('centres the whole sheet in the logical box', () => {
    // Not a nicety: `pushRotation` turns about the logical centre, so an off-centre board
    // *moves* when it rotates to face the other player. The sheet used to sit 66 units up
    // and to the left, so it jumped across the screen between turns and every tap the
    // second player aimed at it landed on nothing. It cost me a while to find, because it
    // looks perfectly fine until somebody takes their turn.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let row = 0; row < ROW_COUNT; row += 1) {
      for (let index = 0; index < sizeOf(row); index += 1) {
        const centre = at(row, index);
        minX = Math.min(minX, centre.x);
        maxX = Math.max(maxX, centre.x);
        minY = Math.min(minY, centre.y);
        maxY = Math.max(maxY, centre.y);
      }
    }
    expect((minX + maxX) / 2, 'horizontally centred').toBeCloseTo(manifest.logical.width / 2, 6);
    expect((minY + maxY) / 2, 'vertically centred').toBeCloseTo(manifest.logical.height / 2, 6);
  });

  it('puts every bubble back on itself when the board turns', () => {
    // The property the centring exists for, stated directly: a 180-degree turn about the
    // logical centre must map the sheet onto itself, or the two players are aiming at
    // boards in different places.
    const width = manifest.logical.width;
    const height = manifest.logical.height;
    for (let row = 0; row < ROW_COUNT; row += 1) {
      for (let index = 0; index < sizeOf(row); index += 1) {
        const centre = at(row, index);
        const turned = bubbleAt(width - centre.x, height - centre.y);
        expect(turned, `bubble ${String(row)},${String(index)} turned`).not.toBeNull();
      }
    }
  });

  it('centres the short rows under the widest one', () => {
    const widest = ROW_SIZES.indexOf(Math.max(...ROW_SIZES));
    const wideStart = at(widest, 0).x;
    const wideEnd = at(widest, sizeOf(widest) - 1).x;
    const wideCentre = (wideStart + wideEnd) / 2;
    for (let row = 0; row < ROW_COUNT; row += 1) {
      const centre = (at(row, 0).x + at(row, sizeOf(row) - 1).x) / 2;
      expect(centre, `row ${String(row)}`).toBeCloseTo(wideCentre, 6);
    }
  });
});

describe('dragging a run', () => {
  it('presses every bubble from where the finger went down to where it lifted', () => {
    const game = new PopItGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    settle(game, input);

    dragRun(game, input, 'p1', 2, 1, 3);
    expect(bubblesLeft(game.position)).toBe(BUBBLE_COUNT - 3);
    expect(game.position.toMove).toBe('p2');
  });

  it('commits on the lift, when the pointer is already gone', () => {
    // The engine reports no pointer on the step a finger leaves the glass, and the lift is
    // when a run commits. Darts was caught by a test double that kept the pointer.
    const game = new PopItGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    settle(game, input);

    const start = at(0, 0);
    input.down('p1', start.x, start.y);
    game.update(STEP, input);
    expect(game.run, 'the run has begun').toEqual({ row: 0, from: 0, to: 0 });
    expect(bubblesLeft(game.position), 'and nothing is down yet').toBe(BUBBLE_COUNT);

    input.lift('p1');
    game.update(STEP, input);
    expect(bubblesLeft(game.position), 'the lift presses it').toBe(BUBBLE_COUNT - 1);
    expect(game.run).toBeNull();
  });

  it('accepts a quick tap, where the press and the release land on one step', () => {
    // What most touchscreen taps look like. Handling the release as an `else` to the
    // press meant a tap began a run and never finished it, and nothing happened at all
    // unless you held long enough to straddle two steps — the exact bug this codebase
    // shipped once before, in its very first game.
    const game = new PopItGame();
    game.init(makeContext(6));
    const input = new ScriptedInput();
    settle(game, input);

    const spot = at(1, 1);
    const seat = input.seat('p1') as unknown as {
      pointer: Vec2 | null;
      actionPressed: boolean;
      actionHeld: boolean;
      actionReleased: boolean;
    };
    seat.pointer = vec2();
    seat.pointer.x = spot.x;
    seat.pointer.y = spot.y;
    seat.actionPressed = true;
    seat.actionReleased = true;
    seat.actionHeld = false;
    game.update(STEP, input);

    expect(bubblesLeft(game.position), 'one tap, one bubble').toBe(BUBBLE_COUNT - 1);
    expect(game.position.toMove).toBe('p2');
  });

  it('does not extend a run into another row', () => {
    const game = new PopItGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    settle(game, input);

    const start = at(2, 1);
    input.down('p1', start.x, start.y);
    game.update(STEP, input);
    const elsewhere = at(3, 2);
    input.dragTo('p1', elsewhere.x, elsewhere.y);
    game.update(STEP, input);
    expect(game.run, 'the run stays in the row it began in').toEqual({ row: 2, from: 1, to: 1 });
  });

  it('drags backwards as happily as forwards', () => {
    const game = new PopItGame();
    game.init(makeContext(9));
    const input = new ScriptedInput();
    settle(game, input);
    dragRun(game, input, 'p1', 2, 3, 1);
    expect(bubblesLeft(game.position), 'three bubbles, right to left').toBe(BUBBLE_COUNT - 3);
  });

  it('refuses to begin on a bubble already down', () => {
    const game = new PopItGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    settle(game, input);
    dragRun(game, input, 'p1', 0, 0, 0);
    const before = bubblesLeft(game.position);
    // The board turns to face p2 after p1's move, and input is refused for the whole
    // flip. Without waiting it out, this test passed for the wrong reason entirely.
    settle(game, input, 90);

    // The board has turned to face p2, so the *device* point that lands on the pressed
    // bubble is the mirrored one. Aiming at the unrotated position hits bubble 4,2 — which
    // is a perfectly legal place to start, and made this assertion mean nothing.
    const board = at(0, 0);
    const same = {
      x: manifest.logical.width - board.x,
      y: manifest.logical.height - board.y,
    };
    input.down('p2', same.x, same.y);
    game.update(STEP, input);
    expect(game.run, 'no run begins on a pressed bubble').toBeNull();
    input.lift('p2');
    game.update(STEP, input);
    expect(bubblesLeft(game.position)).toBe(before);
  });

  it('ignores a finger that goes down between the bubbles', () => {
    const game = new PopItGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    settle(game, input);
    input.down('p1', 10, 10);
    game.update(STEP, input);
    expect(game.run).toBeNull();
  });

  it('accepts nothing while the sheet is turning', () => {
    const game = new PopItGame();
    game.init(makeContext(15));
    const input = new ScriptedInput();
    settle(game, input);
    dragRun(game, input, 'p1', 0, 0, 0);
    expect(game.position.toMove).toBe('p2');

    const spot = at(4, 0);
    input.down('p2', spot.x, spot.y);
    game.update(STEP, input);
    expect(game.run, 'a touch during the flip is ignored').toBeNull();
  });

  it('forgets a half-chosen run across a pause', () => {
    const game = new PopItGame();
    game.init(makeContext(17));
    const input = new ScriptedInput();
    settle(game, input);
    const start = at(1, 0);
    input.down('p1', start.x, start.y);
    game.update(STEP, input);
    expect(game.run).not.toBeNull();

    game.onPause();
    game.onResume();
    expect(game.run, 'coming back to a selection you cannot remember is worse').toBeNull();
  });
});

describe('the keyboard', () => {
  it('takes two presses: one to begin the run and one to end it', () => {
    const game = new PopItGame();
    game.init(makeContext(21));
    const input = new ScriptedInput();
    settle(game, input);

    input.press('p1');
    game.update(STEP, input);
    input.idle('p1');
    game.update(STEP, input);
    expect(game.run, 'the first press begins it').not.toBeNull();
    expect(bubblesLeft(game.position), 'and nothing is down yet').toBe(BUBBLE_COUNT);

    input.press('p1');
    game.update(STEP, input);
    input.idle('p1');
    game.update(STEP, input);
    expect(bubblesLeft(game.position), 'the second press commits it').toBeLessThan(BUBBLE_COUNT);
    expect(game.run).toBeNull();
  });
});

describe('the match', () => {
  it('reports bubbles pressed as the score', () => {
    const game = new PopItGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    settle(game, input);
    dragRun(game, input, 'p1', 2, 0, 2);
    expect(game.getScore().p1).toBe(3);
  });

  it('names the seat to move', () => {
    const game = new PopItGame();
    game.init(makeContext(25));
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('settles before declaring a winner', () => {
    const game = new PopItGame();
    game.init(makeContext(27));
    const input = new ScriptedInput();
    settle(game, input);
    const position = fixture(game);
    position.popped.fill(true);
    position.popped[0] = false;
    position.toMove = 'p1';

    dragRun(game, input, 'p1', 0, 0, 0);
    expect(game.getScore().winner, 'not on the same step').toBeNull();
    for (let i = 0; i < 140; i += 1) game.update(STEP, input);
    expect(game.getScore().winner, 'whoever did not press last').toBe('p2');
  });

  it('plays a whole bot match to a result', () => {
    const game = new PopItGame();
    game.init(makeContext(29, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 300 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner, 'the perfect player wins from the full sheet').toBe('p1');
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new PopItGame();
      game.init(makeContext(31, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 120; i += 1) {
        game.update(STEP, input);
        if (i % 20 === 0) out.push(game.position.popped.map((p) => (p ? '1' : '0')).join(''));
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new PopItGame();
    game.init(makeContext(33, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 90; i += 1) game.update(STEP, input);
    game.init(makeContext(33, 'easy', 'easy'));
    expect(bubblesLeft(game.position)).toBe(BUBBLE_COUNT);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('clears on destroy', () => {
    const game = new PopItGame();
    game.init(makeContext(35, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.run).toBeNull();
  });
});

describe('the bot', () => {
  it('never presses for the human seat', () => {
    const game = new PopItGame();
    game.init(makeContext(41, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(bubblesLeft(game.position), 'a silent human means a silent board').toBe(BUBBLE_COUNT);
    expect(game.position.toMove).toBe('p1');
  });

  it('thinks for a beat rather than pressing instantly', () => {
    const game = new PopItGame();
    game.init(makeContext(43, 'normal', null));
    const input = new ScriptedInput();
    game.update(STEP, input);
    expect(game.position.toMove).toBe('p1');
    for (let i = 0; i < 140; i += 1) game.update(STEP, input);
    expect(game.position.toMove).toBe('p2');
  });
});

describe('rendering', () => {
  it('draws every bubble', () => {
    const game = new PopItGame();
    game.init(makeContext(51));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops[0]).toBe('clear');
    const circles = renderer.ops.filter((op) => op === 'circle').length;
    expect(circles, 'one per bubble').toBe(BUBBLE_COUNT);
  });

  it('draws a pressed bubble smaller and darker than one still up', () => {
    // Up against down is the whole board, so it may not rest on a shade alone: a pressed
    // bubble is visibly sunken too.
    const game = new PopItGame();
    game.init(makeContext(53));
    const position = fixture(game);
    position.popped[rowStart(0)] = true;

    const renderer = new RecordingRenderer();
    game.render(renderer);
    const radii: number[] = [];
    let cursor = 0;
    for (const op of renderer.ops) {
      if (op === 'circle') {
        const radius = renderer.args[cursor + 2];
        if (typeof radius === 'number') radii.push(radius);
      }
      cursor += op === 'clear' ? 1 : op === 'circle' ? 4 : op === 'strokeCircle' ? 5 : op === 'rect' ? 5 : op === 'strokeRect' ? 6 : op === 'line' ? 6 : op === 'text' ? 6 : op === 'popSeatRotation' ? 0 : 1;
    }
    const distinct = new Set(radii.map((r) => Math.round(r)));
    expect(distinct.size, 'pressed and unpressed are different sizes').toBeGreaterThan(1);
  });

  it('shows the run being chosen in the seat colour', () => {
    const game = new PopItGame();
    game.init(makeContext(55));
    const input = new ScriptedInput();
    settle(game, input);
    const before = new RecordingRenderer();
    game.render(before);
    expect(before.args).not.toContain(SEAT_PALETTE.p1.base);

    const start = at(2, 1);
    input.down('p1', start.x, start.y);
    game.update(STEP, input);
    const after = new RecordingRenderer();
    game.render(after);
    expect(after.args, 'the chosen run is marked in the mover colour').toContain(
      SEAT_PALETTE.p1.base,
    );
  });

  it('draws nothing outside the logical play area', () => {
    const game = new PopItGame();
    game.init(makeContext(57, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(-120);
      expect(value).toBeLessThan(manifest.logical.width + 120);
    }
  });

  it('does not mutate the position', () => {
    const game = new PopItGame();
    game.init(makeContext(59, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = game.position.popped.join('');
    game.render(new RecordingRenderer());
    game.render(new RecordingRenderer());
    expect(game.position.popped.join('')).toBe(before);
  });
});

describe('the manifest', () => {
  it('is turn-based, whatever the catalogue used to say', () => {
    // The catalogue had it as `rt-split`, which the rule it ships with contradicts in its
    // first three words: "players take turns".
    expect(manifest.archetype).toBe('turn-board');
    expect(manifest.id).toBe('pop-it');
  });

  it('is fair across input families', () => {
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});
