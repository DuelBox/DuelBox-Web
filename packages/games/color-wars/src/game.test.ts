import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOARD_EXTENT,
  BOARD_ORIGIN,
  CELL_EXTENT,
  ColorWarsGame,
  cellCentre,
  cellIndexAt,
} from './game.js';
import { CELL_COUNT, COLUMNS, ROWS, capacityOf, indexOf, winnerOf } from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

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
    openingSeat: 'p1',
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
 * `game.position` is `Readonly` for callers; a handful of positions worth testing cannot
 * be reached by playing in a reasonable number of moves.
 */
function fixture(game: ColorWarsGame): Position {
  return game.position;
}

function settle(game: ColorWarsGame, input: ScriptedInput, steps = 40): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, input);
}

function tapCell(game: ColorWarsGame, input: ScriptedInput, seat: SeatId, index: number): void {
  cellCentre(point, index);
  input.tap(seat, point.x, point.y);
  game.update(STEP, input);
  input.release(seat);
  game.update(STEP, input);
}

describe('board geometry', () => {
  it('names the cell under a point and refuses points off the board', () => {
    for (let index = 0; index < CELL_COUNT; index += 1) {
      cellCentre(point, index);
      expect(cellIndexAt(point.x, point.y)).toBe(index);
    }
    expect(cellIndexAt(BOARD_ORIGIN - 1, BOARD_ORIGIN + 1)).toBe(-1);
    expect(cellIndexAt(BOARD_ORIGIN + 1, BOARD_ORIGIN - 1)).toBe(-1);
    expect(cellIndexAt(0, 0)).toBe(-1);
    expect(cellIndexAt(manifest.logical.width, manifest.logical.height)).toBe(-1);
  });

  it('keeps the whole board inside the logical play area', () => {
    expect(BOARD_ORIGIN).toBeGreaterThan(0);
    expect(BOARD_ORIGIN + BOARD_EXTENT).toBeLessThanOrEqual(manifest.logical.width);
    expect(CELL_EXTENT * COLUMNS).toBeCloseTo(BOARD_EXTENT, 6);
    expect(CELL_EXTENT * ROWS).toBeCloseTo(BOARD_EXTENT, 6);
  });
});

describe('playing', () => {
  it('adds a dot where you tap and passes the turn', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    settle(game, input);

    const target = indexOf(2, 2);
    tapCell(game, input, 'p1', target);
    expect(game.position.cells[target]).toEqual({ owner: 'p1', dots: 1 });
    expect(game.position.toMove).toBe('p2');
  });

  it('refuses a tap on the opponent cell', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    settle(game, input);

    const enemy = indexOf(4, 4);
    const cell = fixture(game).cells[enemy];
    if (cell === undefined) throw new Error('no cell');
    cell.owner = 'p2';
    cell.dots = 1;

    tapCell(game, input, 'p1', enemy);
    expect(game.position.cells[enemy]?.dots, 'unchanged').toBe(1);
    expect(game.position.toMove, 'and the turn does not pass').toBe('p1');
  });

  it('ignores a tap off the board', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    settle(game, input);
    input.tap('p1', 10, 10);
    game.update(STEP, input);
    expect(game.position.toMove).toBe('p1');
  });

  it('accepts nothing while the board is turning', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(9));
    const input = new ScriptedInput();
    settle(game, input);
    tapCell(game, input, 'p1', indexOf(1, 1));
    expect(game.position.toMove).toBe('p2');

    // Immediately: mid-flip, so nothing is accepted.
    cellCentre(point, indexOf(3, 3));
    input.tap('p2', point.x, point.y);
    game.update(STEP, input);
    expect(
      game.position.cells[indexOf(3, 3)]?.owner,
      'a tap during the flip is ignored',
    ).toBeNull();
  });

  it('cascades through the game module exactly as the rules do', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    settle(game, input);

    const corner = indexOf(0, 0);
    const cell = fixture(game).cells[corner];
    if (cell === undefined) throw new Error('no cell');
    cell.owner = 'p1';
    cell.dots = capacityOf(corner) - 1;

    tapCell(game, input, 'p1', corner);
    expect(game.position.cells[corner]?.dots, 'the corner spent everything').toBe(0);
    expect(game.position.cells[indexOf(1, 0)]?.owner).toBe('p1');
    expect(game.position.cells[indexOf(0, 1)]?.owner).toBe('p1');
  });
});

describe('the match', () => {
  it('reports cells held as the score', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(13));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    const input = new ScriptedInput();
    settle(game, input);
    tapCell(game, input, 'p1', indexOf(2, 2));
    expect(game.getScore().p1).toBe(1);
  });

  it('names the seat to move for the shell turn indicator', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(15));
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('settles before declaring a winner, so the last cascade is seen', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(17));
    const input = new ScriptedInput();
    settle(game, input);

    const position = fixture(game);
    const cell = position.cells[indexOf(3, 3)];
    if (cell === undefined) throw new Error('no cell');
    cell.owner = 'p1';
    cell.dots = 1;
    position.moves.p1 = 1;
    position.moves.p2 = 1;
    expect(winnerOf(position), 'p2 has nothing').toBe('p1');

    game.update(STEP, input);
    expect(game.getScore().winner, 'not declared on the same step').toBeNull();
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.getScore().winner).toBe('p1');
  });

  it('plays a whole bot match to a result', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(19, 'normal', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new ColorWarsGame();
      game.init(makeContext(21, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        game.update(STEP, input);
        if (i % 30 === 0) {
          out.push(game.position.cells.map((c) => (c.owner ? c.owner[1] : '.')).join(''));
        }
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(23, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 60; i += 1) game.update(STEP, input);

    game.init(makeContext(23, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.toMove).toBe('p1');
    expect(game.position.moves).toEqual({ p1: 0, p2: 0 });
  });

  it('clears on destroy', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(25, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });
});

describe('the bot', () => {
  it('thinks for a beat rather than moving instantly', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(31, 'normal', null));
    const input = new ScriptedInput();
    game.update(STEP, input);
    expect(game.position.toMove, 'still p1 on the first step').toBe('p1');
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.position.toMove, 'and it has moved a second later').toBe('p2');
  });

  it('never plays for the human seat', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(33, null, 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.moves.p1, 'a silent human never moves').toBe(0);
    expect(game.position.toMove, 'and the game waits for them').toBe('p1');
  });
});

describe('rendering', () => {
  it('draws the grid and both seats', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(41));
    const position = fixture(game);
    const a = position.cells[indexOf(1, 1)];
    const b = position.cells[indexOf(4, 4)];
    if (!a || !b) throw new Error('no cells');
    a.owner = 'p1';
    a.dots = 1;
    b.owner = 'p2';
    b.dots = 1;

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.base);
    expect(renderer.ops.filter((op) => op === 'pushRotation').length).toBe(1);
    expect(renderer.ops.filter((op) => op === 'popSeatRotation').length).toBe(1);
  });

  it('rings a cell that is one dot from bursting', () => {
    // Counting three dots against four across a six-by-six grid under time pressure is
    // exactly what a player should not have to do, and knowing which cells are primed is
    // the whole game. The ring says it in shape, so it survives greyscale.
    const game = new ColorWarsGame();
    game.init(makeContext(43));
    const position = fixture(game);

    // Compared at the *same* number of dots. Raising the dot count was the first version
    // and it proved nothing: every extra dot draws its own outline stroke, so the count
    // went up whether or not the ring existed.
    //
    // A corner bursts at two, so one dot already primes it. A middle cell bursts at four,
    // so one dot there is quiet. Same single dot, opposite states.
    const corner = indexOf(0, 0);
    const middle = indexOf(2, 2);
    expect(capacityOf(corner), 'the fixture depends on this').toBe(2);
    expect(capacityOf(middle)).toBe(4);

    const quiet = position.cells[middle];
    if (!quiet) throw new Error('no cell');
    quiet.owner = 'p1';
    quiet.dots = 1;
    const before = new RecordingRenderer();
    game.render(before, 0);
    const ringsBefore = before.ops.filter((op) => op === 'strokeCircle').length;

    quiet.owner = null;
    quiet.dots = 0;
    const primed = position.cells[corner];
    if (!primed) throw new Error('no cell');
    primed.owner = 'p1';
    primed.dots = 1;
    const after = new RecordingRenderer();
    game.render(after, 0);
    const ringsAfter = after.ops.filter((op) => op === 'strokeCircle').length;

    expect(ringsAfter, 'a primed cell draws a ring the quiet one does not').toBe(ringsBefore + 1);
  });

  it('tells the two seats apart by shape as well as colour', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(45));
    const position = fixture(game);
    const p1Cell = position.cells[indexOf(1, 1)];
    if (!p1Cell) throw new Error('no cell');
    p1Cell.owner = 'p1';
    p1Cell.dots = 1;
    const p1Render = new RecordingRenderer();
    game.render(p1Render, 0);
    const p1Circles = p1Render.ops.filter((op) => op === 'circle').length;

    p1Cell.owner = 'p2';
    const p2Render = new RecordingRenderer();
    game.render(p2Render, 0);
    const p2Circles = p2Render.ops.filter((op) => op === 'circle').length;

    expect(p1Circles, "p1's dots are round").toBeGreaterThan(p2Circles);
  });

  it('draws a dot for every dot held, up to four', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(47));
    const position = fixture(game);
    const middle = indexOf(2, 2);
    const cell = position.cells[middle];
    if (!cell) throw new Error('no cell');
    cell.owner = 'p1';

    const dotsDrawn = (): number => {
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      let cursor = 0;
      let count = 0;
      for (const op of renderer.ops) {
        if (op === 'circle') {
          const radius = renderer.args[cursor + 2];
          if (typeof radius === 'number' && radius < CELL_EXTENT * 0.2) count += 1;
        }
        cursor += ARG_COUNTS[op] ?? 0;
      }
      return count;
    };

    for (let dots = 1; dots <= 4; dots += 1) {
      cell.dots = dots;
      expect(dotsDrawn(), `${String(dots)} dots`).toBe(dots);
    }
  });

  it('draws nothing outside the logical play area', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(49, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(-200);
      expect(value).toBeLessThan(manifest.logical.width + 200);
    }
  });

  it('does not mutate the position', () => {
    const game = new ColorWarsGame();
    game.init(makeContext(51, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = game.position.cells.map((c) => `${c.owner ?? '.'}${String(c.dots)}`).join('');
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0);
    expect(game.position.cells.map((c) => `${c.owner ?? '.'}${String(c.dots)}`).join('')).toBe(
      before,
    );
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('color-wars');
    expect(manifest.archetype).toBe('turn-board');
    expect(manifest.zoneSplit).toBe('shared-board');
  });

  it('is fair across input families', () => {
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});
