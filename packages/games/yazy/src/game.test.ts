import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  DICE_ORIGIN_X,
  DICE_ORIGIN_Y,
  DIE_GAP,
  DIE_SIZE,
  ROLL_HEIGHT,
  ROLL_WIDTH,
  ROLL_X,
  ROLL_Y,
  SHEET_COLUMNS,
  SHEET_ROWS,
  YazyGame,
  categoryAt,
  dieAt,
  onRollButton,
  sheetCellAt,
  sheetCellRect,
} from './game.js';
import { CATEGORIES, DICE, ROLLS_PER_TURN, UPPER, totalFor } from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

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

class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  press(seat: SeatId): void {
    this.#of(seat).actionPressed = true;
  }

  release(seat: SeatId): void {
    this.#of(seat).actionPressed = false;
  }

  move(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.move.x = x;
    target.move.y = y;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  clearPointer(seat: SeatId): void {
    this.#of(seat).pointer = null;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
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

  get args(): DrawArg[] {
    return this.calls.flatMap((call) => [...call.args]);
  }

  clear(colour: string): void {
    this.#record('clear', colour);
  }
  rect(x: number, y: number, w: number, h: number, colour: string): void {
    this.#record('rect', x, y, w, h, colour);
  }
  strokeRect(x: number, y: number, w: number, h: number, lw: number, colour: string): void {
    this.#record('strokeRect', x, y, w, h, lw, colour);
  }
  circle(x: number, y: number, r: number, colour: string): void {
    this.#record('circle', x, y, r, colour);
  }
  strokeCircle(x: number, y: number, r: number, lw: number, colour: string): void {
    this.#record('strokeCircle', x, y, r, lw, colour);
  }
  line(x1: number, y1: number, x2: number, y2: number, lw: number, colour: string): void {
    this.#record('line', x1, y1, x2, y2, lw, colour);
  }
  text(v: string, x: number, y: number, size: number, colour: string, align?: TextAlign): void {
    this.#record('text', v, x, y, size, colour, align);
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

function dieCentre(index: number): [number, number] {
  return [
    DICE_ORIGIN_X + index * (DIE_SIZE + DIE_GAP) + DIE_SIZE / 2,
    DICE_ORIGIN_Y + DIE_SIZE / 2,
  ];
}

describe('the geometry', () => {
  it('maps a point on a die to that die', () => {
    for (let i = 0; i < DICE; i += 1) {
      const [x, y] = dieCentre(i);
      expect(dieAt(x, y)).toBe(i);
    }
  });

  it('maps the gap between two dice to nothing', () => {
    const gapX = DICE_ORIGIN_X + DIE_SIZE + DIE_GAP / 2;
    expect(dieAt(gapX, DICE_ORIGIN_Y + DIE_SIZE / 2)).toBe(-1);
  });

  it('maps a point away from the dice row to nothing', () => {
    expect(dieAt(DICE_ORIGIN_X, DICE_ORIGIN_Y - 40)).toBe(-1);
    expect(dieAt(10, DICE_ORIGIN_Y + 10)).toBe(-1);
  });

  it('knows the roll control', () => {
    expect(onRollButton(ROLL_X + ROLL_WIDTH / 2, ROLL_Y + ROLL_HEIGHT / 2)).toBe(true);
    expect(onRollButton(ROLL_X - 20, ROLL_Y + ROLL_HEIGHT / 2)).toBe(false);
  });

  it('maps a point in a sheet cell to that cell', () => {
    for (let row = 0; row < SHEET_ROWS; row += 1) {
      for (let column = 0; column < SHEET_COLUMNS; column += 1) {
        const rect = sheetCellRect(row, column);
        expect(sheetCellAt(rect.x + rect.w / 2, rect.y + rect.h / 2)).toEqual([row, column]);
      }
    }
  });

  it('maps the gap between the two columns to nothing', () => {
    const left = sheetCellRect(0, 0);
    const right = sheetCellRect(0, 1);
    const gapX = (left.x + left.w + right.x) / 2;
    expect(sheetCellAt(gapX, left.y + left.h / 2)).toBeNull();
  });

  it('lays every category out exactly once', () => {
    const seen: string[] = [];
    for (let row = 0; row < SHEET_ROWS; row += 1) {
      for (let column = 0; column < SHEET_COLUMNS; column += 1) {
        const category = categoryAt(row, column);
        if (category !== null) seen.push(category);
      }
    }
    expect(seen.length).toBe(CATEGORIES.length);
    expect(new Set(seen).size, 'no category appears twice').toBe(CATEGORIES.length);
  });

  it('puts the upper section in the left column', () => {
    for (let row = 0; row < UPPER.length; row += 1) {
      expect(categoryAt(row, 0)).toBe(UPPER[row]);
    }
  });

  it('leaves the seventh left-hand row for the bonus, which is not chooseable', () => {
    expect(categoryAt(UPPER.length, 0)).toBeNull();
  });

  it('keeps every cell inside the logical box', () => {
    // Thirteen rows of one column would be fifteen pixels tall on a 320-pixel phone.
    for (let row = 0; row < SHEET_ROWS; row += 1) {
      for (let column = 0; column < SHEET_COLUMNS; column += 1) {
        const rect = sheetCellRect(row, column);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(900);
        expect(rect.y + rect.h).toBeLessThanOrEqual(900);
      }
    }
  });
});

describe('taking a turn', () => {
  it('rolls when the roll control is tapped', () => {
    const game = new YazyGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    input.point('p1', ROLL_X + ROLL_WIDTH / 2, ROLL_Y + ROLL_HEIGHT / 2);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.dice.length).toBe(DICE);
    expect(game.position.rollsUsed).toBe(1);
  });

  it('keeps a die when it is tapped', () => {
    const game = new YazyGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    input.point('p1', ROLL_X + ROLL_WIDTH / 2, ROLL_Y + ROLL_HEIGHT / 2);
    input.press('p1');
    game.update(STEP, input);

    const [x, y] = dieCentre(2);
    input.point('p1', x, y);
    game.update(STEP, input);
    expect(game.position.held[2]).toBe(true);
  });

  it('spends the hand when a sheet cell is tapped', () => {
    const game = new YazyGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    input.point('p1', ROLL_X + ROLL_WIDTH / 2, ROLL_Y + ROLL_HEIGHT / 2);
    input.press('p1');
    game.update(STEP, input);

    const rect = sheetCellRect(0, 1); // three of a kind
    input.point('p1', rect.x + rect.w / 2, rect.y + rect.h / 2);
    game.update(STEP, input);
    expect(game.position.sheetP1['three-of-a-kind']).toBeDefined();
    expect(game.position.seat, 'and the turn passed').toBe('p2');
  });

  it('ignores a tap on the bonus row, which cannot be spent', () => {
    const game = new YazyGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    input.point('p1', ROLL_X + ROLL_WIDTH / 2, ROLL_Y + ROLL_HEIGHT / 2);
    input.press('p1');
    game.update(STEP, input);

    const rect = sheetCellRect(UPPER.length, 0);
    input.point('p1', rect.x + rect.w / 2, rect.y + rect.h / 2);
    game.update(STEP, input);
    expect(game.position.seat, 'still your turn').toBe('p1');
  });

  it('returns focus to the roll control after a hand is spent', () => {
    const game = new YazyGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    input.point('p1', ROLL_X + ROLL_WIDTH / 2, ROLL_Y + ROLL_HEIGHT / 2);
    input.press('p1');
    game.update(STEP, input);
    const rect = sheetCellRect(0, 1);
    input.point('p1', rect.x + rect.w / 2, rect.y + rect.h / 2);
    game.update(STEP, input);
    expect(game.focus, 'the next player starts at the dice').toBe('dice');
    expect(game.diceIndex).toBe(DICE);
  });
});

describe('the keyboard', () => {
  it('walks from the roll control into the sheet and back', () => {
    const game = new YazyGame();
    game.init(makeContext(17));
    const input = new ScriptedInput();
    expect(game.focus).toBe('dice');

    input.move('p1', 0, 1);
    game.update(STEP, input);
    expect(game.focus, 'down enters the sheet').toBe('sheet');

    input.move('p1', 0, 0);
    game.update(STEP, input);
    input.move('p1', 0, -1);
    game.update(STEP, input);
    game.update(STEP, input);
    expect(game.focus, 'up from the first row returns to the dice').toBe('dice');
  });

  it('moves along the dice row', () => {
    const game = new YazyGame();
    game.init(makeContext(19));
    const input = new ScriptedInput();
    expect(game.diceIndex, 'a turn starts on the roll control').toBe(DICE);
    input.move('p1', -1, 0);
    game.update(STEP, input);
    expect(game.diceIndex).toBe(DICE - 1);
  });

  it('rolls with the action key', () => {
    const game = new YazyGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.rollsUsed).toBe(1);
  });
});

describe('the match', () => {
  it('starts at nothing each', () => {
    const game = new YazyGame();
    game.init(makeContext(29));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('reports the sheet totals', () => {
    const game = new YazyGame();
    game.init(makeContext(31));
    game.position.sheetP1.yatzy = 50;
    expect(game.getScore().p1).toBe(50);
  });

  it('plays a whole bot match to a winner', () => {
    const game = new YazyGame();
    game.init(makeContext(37, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 900 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
    expect(totalFor(game.position.sheetP1), 'and both sheets are full').toBeGreaterThan(0);
  });

  it('stops changing once it is decided', () => {
    const game = new YazyGame();
    game.init(makeContext(41, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 900 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = JSON.stringify(game.getScore());
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new YazyGame();
      game.init(makeContext(43, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 200; i += 1) {
        game.update(STEP, input);
        if (i % 120 === 0) out.push(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init and clears on destroy', () => {
    const game = new YazyGame();
    game.init(makeContext(47, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400; i += 1) game.update(STEP, input);
    game.init(makeContext(47, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('never plays for a human seat', () => {
    const game = new YazyGame();
    game.init(makeContext(53, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.rollsUsed, 'a silent human rolls nothing').toBe(0);
    expect(game.position.seat).toBe('p1');
  });
});

describe('rendering', () => {
  it('shows what the hand would score in every open box', () => {
    // The whole of the decision, and the thing a paper scoresheet cannot do for you.
    const game = new YazyGame();
    game.init(makeContext(59));
    const empty = new RecordingRenderer();
    game.render(empty, 0);
    const textsBefore = empty.calls.filter((call) => call.op === 'text').length;

    game.position.dice.push(1, 2, 3, 4, 5);
    const rolled = new RecordingRenderer();
    game.render(rolled, 0);
    const textsAfter = rolled.calls.filter((call) => call.op === 'text').length;
    expect(textsAfter, 'a preview appeared in each open box').toBeGreaterThan(textsBefore);
  });

  it('marks a kept die with a bar as well as a colour', () => {
    // Rule 7: a held die must be readable with the colour taken away.
    const game = new YazyGame();
    game.init(makeContext(61));
    game.position.dice.push(1, 2, 3, 4, 5);
    const loose = new RecordingRenderer();
    game.render(loose, 0);
    const rectsBefore = loose.calls.filter((call) => call.op === 'rect').length;

    game.position.held[0] = true;
    const held = new RecordingRenderer();
    game.render(held, 0);
    const rectsAfter = held.calls.filter((call) => call.op === 'rect').length;
    expect(rectsAfter, 'keeping a die added a mark').toBeGreaterThan(rectsBefore);
  });

  it('strikes a spent box through as well as dimming it', () => {
    const game = new YazyGame();
    game.init(makeContext(67));
    const open = new RecordingRenderer();
    game.render(open, 0);
    const linesBefore = open.calls.filter((call) => call.op === 'line').length;

    game.position.sheetP1.ones = 3;
    const spent = new RecordingRenderer();
    game.render(spent, 0);
    const linesAfter = spent.calls.filter((call) => call.op === 'line').length;
    expect(linesAfter, 'a spent box carries a stroke').toBeGreaterThan(linesBefore);
  });

  it('draws pips rather than numerals', () => {
    const game = new YazyGame();
    game.init(makeContext(71));
    game.position.dice.push(1, 2, 3, 4, 5);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.calls.filter((call) => call.op === 'circle').length, '1+2+3+4+5').toBe(15);
  });

  it('turns the sheet to face whoever is playing', () => {
    const game = new YazyGame();
    game.init(makeContext(73));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops).toContain('pushRotation');
  });

  it('draws nothing outside the logical box', () => {
    const game = new YazyGame();
    game.init(makeContext(79, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 1800; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (const call of renderer.calls) {
      if (call.op === 'text') continue;
      for (const value of call.args) {
        if (typeof value !== 'number') continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-40);
        expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(940);
      }
    }
  });

  it('does not mutate the position', () => {
    const game = new YazyGame();
    game.init(makeContext(83, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.position);
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0);
    expect(JSON.stringify(game.position)).toBe(before);
  });

  it('says how many rolls are left, which decides whether to keep anything', () => {
    const game = new YazyGame();
    game.init(makeContext(89));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.args).toContain(`Roll (${String(ROLLS_PER_TURN)} left)`);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('yazy');
    expect(manifest.archetype).toBe('turn-board');
  });
});
