import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOARD_EXTENT,
  BOARD_ORIGIN,
  CheckersGame,
  slotAtPoint,
  slotCentre,
  squareAt,
  squareCentre,
} from './game.js';
import { BOARD_SIZE, PIECES_PER_SEAT, rowOf, slotAt, winnerOf } from './rules.js';
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

  tap(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = true;
    target.actionHeld = true;
  }

  press(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = true;
    target.actionHeld = true;
  }

  steer(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.move.x = x;
    target.move.y = y;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = false;
    target.actionHeld = false;
    target.move.x = 0;
    target.move.y = 0;
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

/** How many arguments each recorded op contributes, so args can be walked per call. */
const ARG_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  clear: 1,
  rect: 5,
  strokeRect: 6,
  circle: 4,
  strokeCircle: 5,
  line: 6,
  text: 6,
  pushSeatRotation: 1,
  pushRotation: 1,
  popSeatRotation: 0,
});

const point: Vec2 = vec2();

/**
 * The game's position, writable, for building a fixture.
 *
 * `game.position` is deliberately `Readonly` — callers and the harness read it and must
 * never steer the match through it. A handful of positions worth testing (a double jump
 * waiting, a seat with nothing left) cannot be reached by playing in any reasonable
 * number of moves, so the fixture is built directly through this, which is named for what
 * it is rather than loosening the type the whole product sees.
 *
 * No cast is needed: TypeScript ignores `readonly` modifiers when deciding assignability,
 * so the annotation alone widens it. Worth knowing — `Readonly<T>` documents intent to a
 * reader and stops an accidental write *at the property*, but it is not a wall.
 */
function fixture(game: CheckersGame): Position {
  return game.position;
}

/** Taps the square holding `slot`, in board space. */
function tapSlot(game: CheckersGame, input: ScriptedInput, seat: SeatId, slot: number): void {
  slotCentre(point, slot);
  input.tap(seat, point.x, point.y);
  game.update(STEP, input);
  input.release(seat);
  game.update(STEP, input);
}

/** Steps past the seat flip so input is accepted. */
function settle(game: CheckersGame, input: ScriptedInput, steps = 40): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, input);
}

describe('board geometry', () => {
  it('names the square under a point, and refuses points off the board', () => {
    for (let square = 0; square < BOARD_SIZE * BOARD_SIZE; square += 1) {
      squareCentre(point, Math.floor(square / BOARD_SIZE), square % BOARD_SIZE);
      expect(squareAt(point.x, point.y)).toBe(square);
    }
    expect(squareAt(BOARD_ORIGIN - 1, BOARD_ORIGIN + 1)).toBe(-1);
    expect(squareAt(BOARD_ORIGIN + 1, BOARD_ORIGIN - 1)).toBe(-1);
    expect(squareAt(0, 0)).toBe(-1);
    expect(squareAt(manifest.logical.width, manifest.logical.height)).toBe(-1);
  });

  it('maps a point to a playable slot, and light squares to none', () => {
    for (let slot = 0; slot < 32; slot += 1) {
      slotCentre(point, slot);
      expect(slotAtPoint(point.x, point.y), `slot ${String(slot)}`).toBe(slot);
    }
    // The top-left square is light, so nothing may ever be placed there.
    squareCentre(point, 0, 0);
    expect(slotAtPoint(point.x, point.y)).toBe(-1);
  });

  it('keeps the whole board inside the logical play area', () => {
    expect(BOARD_ORIGIN).toBeGreaterThan(0);
    expect(BOARD_ORIGIN + BOARD_EXTENT).toBeLessThanOrEqual(manifest.logical.width);
    expect(BOARD_ORIGIN + BOARD_EXTENT).toBeLessThanOrEqual(manifest.logical.height);
  });
});

describe('lifting and placing', () => {
  it('lifts a piece on the first press and moves it on the second', () => {
    const game = new CheckersGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    settle(game, input);

    const from = slotAt(5, 0);
    const to = slotAt(4, 1);
    tapSlot(game, input, 'p1', from);
    expect(game.selected, 'the first press lifts').toBe(from);

    tapSlot(game, input, 'p1', to);
    expect(game.selected, 'the second press places').toBe(-1);
    expect(fixture(game).slots[to]?.seat).toBe('p1');
    expect(fixture(game).slots[from]).toBeNull();
    expect(game.position.toMove, 'and the turn passes').toBe('p2');
  });

  it('re-lifts when a different piece of your own is pressed', () => {
    // A player changing their mind is the common case; making them press twice to undo a
    // selection is a worse answer than believing the second press.
    const game = new CheckersGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    settle(game, input);

    const first = slotAt(5, 0);
    const second = slotAt(5, 2);
    tapSlot(game, input, 'p1', first);
    expect(game.selected).toBe(first);
    tapSlot(game, input, 'p1', second);
    expect(game.selected, 'the second piece is now lifted').toBe(second);
    expect(game.position.toMove, 'and nothing has moved').toBe('p1');
  });

  it('puts a lifted piece down when pressed again', () => {
    const game = new CheckersGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    settle(game, input);
    const slot = slotAt(5, 0);
    tapSlot(game, input, 'p1', slot);
    expect(game.selected).toBe(slot);
    tapSlot(game, input, 'p1', slot);
    expect(game.selected, 'pressing the lifted piece puts it down').toBe(-1);
  });

  it('ignores a press on a light square', () => {
    const game = new CheckersGame();
    game.init(makeContext(9));
    const input = new ScriptedInput();
    settle(game, input);
    squareCentre(point, 0, 0);
    input.tap('p1', point.x, point.y);
    game.update(STEP, input);
    expect(game.selected).toBe(-1);
    expect(game.position.toMove).toBe('p1');
  });

  it('ignores a press on an illegal destination', () => {
    const game = new CheckersGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    settle(game, input);
    const from = slotAt(5, 0);
    tapSlot(game, input, 'p1', from);
    // Three rows up is not a move any piece can make.
    tapSlot(game, input, 'p1', slotAt(2, 1));
    expect(fixture(game).slots[from]?.seat, 'the piece has not moved').toBe('p1');
    expect(game.selected, 'and it is still lifted').toBe(from);
  });

  it('ignores a press on the opponent pieces', () => {
    const game = new CheckersGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    settle(game, input);
    tapSlot(game, input, 'p1', slotAt(2, 1));
    expect(game.selected, "p1 cannot lift p2's piece").toBe(-1);
  });

  it('accepts nothing while the board is turning', () => {
    // The square under a finger is moving, so a tap would name one nobody meant.
    const game = new CheckersGame();
    game.init(makeContext(15));
    const input = new ScriptedInput();
    settle(game, input);
    // A legal move, which hands over to p2 and starts the flip.
    tapSlot(game, input, 'p1', slotAt(5, 0));
    tapSlot(game, input, 'p1', slotAt(4, 1));
    expect(game.position.toMove).toBe('p2');

    // Immediately: mid-flip, so nothing is accepted.
    slotCentre(point, slotAt(2, 1));
    input.tap('p2', point.x, point.y);
    game.update(STEP, input);
    expect(game.selected, 'a tap during the flip is ignored').toBe(-1);
  });
});

describe('the compulsory capture', () => {
  it('will not let a player make a quiet move when a capture exists', () => {
    const game = new CheckersGame();
    game.init(makeContext(17));
    const input = new ScriptedInput();
    settle(game, input);

    // Set up a capture for p1 by hand, then try to move a different piece.
    fixture(game).slots[slotAt(4, 1)] = { seat: 'p2', kind: 'man' };
    const idle = slotAt(5, 4);
    tapSlot(game, input, 'p1', idle);
    tapSlot(game, input, 'p1', slotAt(4, 5));
    expect(game.position.toMove, 'the quiet move is refused').toBe('p1');
    expect(fixture(game).slots[idle]?.seat).toBe('p1');
  });

  it('keeps the same seat on a jump chain, with the piece already lifted', () => {
    const game = new CheckersGame();
    game.init(makeContext(19));
    const input = new ScriptedInput();
    settle(game, input);

    // A clean board with a double jump waiting.
    fixture(game).slots.fill(null);
    const from = slotAt(5, 2);
    fixture(game).slots[from] = { seat: 'p1', kind: 'man' };
    fixture(game).slots[slotAt(4, 1)] = { seat: 'p2', kind: 'man' };
    fixture(game).slots[slotAt(2, 1)] = { seat: 'p2', kind: 'man' };
    fixture(game).toMove = 'p1';

    tapSlot(game, input, 'p1', from);
    tapSlot(game, input, 'p1', slotAt(3, 0));
    expect(game.position.toMove, 'a chain does not pass the turn').toBe('p1');
    expect(game.selected, 'and the chaining piece stays lifted').toBe(slotAt(3, 0));

    tapSlot(game, input, 'p1', slotAt(1, 2));
    expect(game.position.toMove).toBe('p2');
    expect(game.selected).toBe(-1);
  });

  it('refuses to lift another piece mid-chain', () => {
    const game = new CheckersGame();
    game.init(makeContext(21));
    const input = new ScriptedInput();
    settle(game, input);

    fixture(game).slots.fill(null);
    const chainer = slotAt(5, 2);
    const other = slotAt(5, 6);
    fixture(game).slots[chainer] = { seat: 'p1', kind: 'man' };
    fixture(game).slots[other] = { seat: 'p1', kind: 'man' };
    fixture(game).slots[slotAt(4, 1)] = { seat: 'p2', kind: 'man' };
    fixture(game).slots[slotAt(2, 1)] = { seat: 'p2', kind: 'man' };
    fixture(game).toMove = 'p1';

    tapSlot(game, input, 'p1', chainer);
    tapSlot(game, input, 'p1', slotAt(3, 0));
    expect(game.position.chain).toBe(slotAt(3, 0));

    // Observed on the step of the press itself, not after. The chain re-selects the
    // chaining piece at the top of every update, so stepping once more hides the
    // difference entirely — the first version of this test did exactly that and passed
    // whether or not the guard existed.
    slotCentre(point, other);
    input.tap('p1', point.x, point.y);
    game.update(STEP, input);
    expect(game.selected, 'the chaining piece is still the lifted one').toBe(slotAt(3, 0));

    input.release('p1');
    game.update(STEP, input);
    expect(game.selected, 'and still is a step later').toBe(slotAt(3, 0));
  });
});

describe('the match', () => {
  it('reports captures as the score', () => {
    const game = new CheckersGame();
    game.init(makeContext(23));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    fixture(game).slots[slotAt(2, 1)] = null;
    expect(game.getScore().p1, 'a missing p2 piece is a p1 capture').toBe(1);
  });

  it('names the seat to move for the shell turn indicator', () => {
    const game = new CheckersGame();
    game.init(makeContext(25));
    expect(game.getActiveSeat()).toBe('p1');
    const input = new ScriptedInput();
    settle(game, input);
    tapSlot(game, input, 'p1', slotAt(5, 0));
    tapSlot(game, input, 'p1', slotAt(4, 1));
    expect(game.getActiveSeat()).toBe('p2');
  });

  it('settles before declaring a winner, so the last move is seen', () => {
    const game = new CheckersGame();
    game.init(makeContext(27));
    const input = new ScriptedInput();
    settle(game, input);

    fixture(game).slots.fill(null);
    fixture(game).slots[slotAt(5, 0)] = { seat: 'p1', kind: 'man' };
    fixture(game).toMove = 'p2';
    expect(winnerOf(game.position), 'p2 has nothing left').toBe('p1');

    game.update(STEP, input);
    expect(game.getScore().winner, 'not declared on the same step').toBeNull();
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.getScore().winner).toBe('p1');
  });

  it('plays a whole bot match without an illegal position', () => {
    const game = new CheckersGame();
    game.init(makeContext(29, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 90 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
      const pieces = game.position.slots.filter((slot) => slot !== null).length;
      expect(pieces).toBeLessThanOrEqual(PIECES_PER_SEAT * 2);
      expect(pieces).toBeGreaterThan(0);
    }
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new CheckersGame();
      game.init(makeContext(31, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 40; i += 1) {
        game.update(STEP, input);
        if (i % 30 === 0) out.push(game.position.slots.map((s) => (s ? s.seat[1] : '.')).join(''));
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts a fresh game on init rather than carrying the last one', () => {
    const game = new CheckersGame();
    game.init(makeContext(33, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 30; i += 1) game.update(STEP, input);

    game.init(makeContext(33, 'easy', 'easy'));
    expect(game.getScore(), 'a rematch starts level').toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.toMove).toBe('p1');
    expect(game.selected).toBe(-1);
  });

  it('clears on destroy', () => {
    const game = new CheckersGame();
    game.init(makeContext(35));
    game.destroy();
    expect(game.getScore().winner).toBeNull();
    expect(game.selected).toBe(-1);
  });
});

describe('the bot', () => {
  it('never touches the human seat pieces', () => {
    const game = new CheckersGame();
    game.init(makeContext(41, null, 'normal'));
    const input = new ScriptedInput();
    settle(game, input);
    // p1 is human and has not moved, so its back two rows are untouched.
    for (let slot = 0; slot < 32; slot += 1) {
      if (rowOf(slot) < 6) continue;
      expect(fixture(game).slots[slot]?.seat, `slot ${String(slot)}`).toBe('p1');
    }
  });

  it('thinks for a beat rather than moving instantly', () => {
    // A bot that answers on the same step looks like a bug, not an opponent.
    const game = new CheckersGame();
    game.init(makeContext(43, 'normal', null));
    const input = new ScriptedInput();
    game.update(STEP, input);
    expect(game.position.toMove, 'still p1 on the first step').toBe('p1');
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.position.toMove, 'and it has moved by a second later').toBe('p2');
  });
});

describe('rendering', () => {
  it('draws the board, both seats and the crowns', () => {
    const game = new CheckersGame();
    game.init(makeContext(51));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.base);
    expect(renderer.ops.filter((op) => op === 'pushRotation').length).toBe(1);
    expect(renderer.ops.filter((op) => op === 'popSeatRotation').length).toBe(1);
  });

  it('puts every piece on a dark square', () => {
    // Checkers is played on the dark squares only, and the classic bug in the mapping is
    // an off-by-one on odd rows that puts half the pieces on the light ones. Reading it
    // off a screenshot is genuinely hard — I misread one and spent a while chasing a bug
    // that was not there — so this asks the renderer directly.
    const game = new CheckersGame();
    game.init(makeContext(63));
    const renderer = new RecordingRenderer();
    game.render(renderer);

    const dark: { x: number; y: number; w: number; h: number }[] = [];
    const discs: { x: number; y: number }[] = [];
    let cursor = 0;
    for (const op of renderer.ops) {
      if (op === 'rect') {
        const [x, y, w, h, colour] = renderer.args.slice(cursor, cursor + 5);
        if (colour === '#7a5a3c' && typeof x === 'number' && typeof y === 'number') {
          dark.push({ x, y, w: w as number, h: h as number });
        }
      }
      if (op === 'circle') {
        const [x, y, r] = renderer.args.slice(cursor, cursor + 4);
        if (typeof r === 'number' && r > 20 && typeof x === 'number' && typeof y === 'number') {
          discs.push({ x, y });
        }
      }
      cursor += ARG_COUNTS[op] ?? 0;
    }

    expect(dark.length, 'half the board is playable').toBe(32);
    expect(discs.length, "p1's twelve men are discs").toBe(PIECES_PER_SEAT);
    for (const disc of discs) {
      const on = dark.some(
        (r) => disc.x > r.x && disc.x < r.x + r.w && disc.y > r.y && disc.y < r.y + r.h,
      );
      expect(on, `a disc at ${String(Math.round(disc.x))},${String(Math.round(disc.y))}`).toBe(true);
    }
  });

  it('tells the two seats apart by shape, not only colour', () => {
    // Rule 7. p1's pieces are discs and p2's are eight-sided, so the board survives
    // greyscale — and which way a piece may move depends on whose it is.
    const game = new CheckersGame();
    game.init(makeContext(53));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const circles = renderer.ops.filter((op) => op === 'circle').length;
    const rects = renderer.ops.filter((op) => op === 'rect').length;
    // 32 dark squares plus the felt, and p2's twelve pieces are three bars-pairs each.
    expect(circles, 'p1 draws discs').toBeGreaterThanOrEqual(PIECES_PER_SEAT);
    expect(rects, 'p2 draws bars the discs do not').toBeGreaterThan(33);
  });

  it('marks the pieces that are forced to capture', () => {
    // Capturing is compulsory, so a player who has not spotted a capture finds every
    // other move refused with no explanation. The marker turns a mystery into a rule.
    const game = new CheckersGame();
    game.init(makeContext(55));
    const plain = new RecordingRenderer();
    game.render(plain);
    const before = plain.args.filter((value) => value === '#ffc94a').length;
    expect(before, 'nothing is forced in the opening position').toBe(0);

    fixture(game).slots[slotAt(4, 1)] = { seat: 'p2', kind: 'man' };
    const forced = new RecordingRenderer();
    game.render(forced);
    const after = forced.args.filter((value) => value === '#ffc94a').length;
    expect(after, 'the piece that must jump is ringed').toBeGreaterThan(0);
  });

  it('shows where a lifted piece may go', () => {
    const game = new CheckersGame();
    game.init(makeContext(57));
    const input = new ScriptedInput();
    settle(game, input);
    const before = new RecordingRenderer();
    game.render(before);

    tapSlot(game, input, 'p1', slotAt(5, 2));
    const after = new RecordingRenderer();
    game.render(after);
    expect(after.args.filter((v) => v === 'rgba(255, 255, 255, 0.62)').length).toBeGreaterThan(
      before.args.filter((v) => v === 'rgba(255, 255, 255, 0.62)').length,
    );
  });

  it('draws nothing outside the logical play area', () => {
    const game = new CheckersGame();
    game.init(makeContext(59, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(-200);
      expect(value).toBeLessThan(manifest.logical.width + 200);
    }
  });

  it('does not mutate the position', () => {
    const game = new CheckersGame();
    game.init(makeContext(61, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) game.update(STEP, input);
    const before = game.position.slots.map((s) => (s ? `${s.seat}${s.kind}` : '.')).join('');
    // Rendered twice, because a render that mutates usually does so on the second pass.
    game.render(new RecordingRenderer());
    game.render(new RecordingRenderer());
    expect(game.position.slots.map((s) => (s ? `${s.seat}${s.kind}` : '.')).join('')).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('checkers');
    expect(manifest.archetype).toBe('turn-board');
    expect(manifest.zoneSplit).toBe('shared-board');
  });

  it('is fair across input families, so it does not restrict them', () => {
    // turn-board: discrete targets, no time pressure. A square is a square.
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});
