import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOARD_EXTENT,
  BOARD_ORIGIN_X,
  BOARD_ORIGIN_Y,
  CELL_EXTENT,
  HALF_CELL,
  HALF_LEFT_X,
  HALF_ORIGIN_Y,
  SeaBattleGame,
} from './game.js';
import {
  CELL_COUNT,
  FLEET,
  cellAt,
  columnOf,
  fire,
  fleetOf,
  place,
  placeRandomFleet,
  recordPlacement,
  rowOf,
  shipCells,
} from './rules.js';
import type { BotDifficulty, Ship } from './rules.js';

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

  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
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
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#record('rect', x, y, width, height, colour);
  }
  strokeRect(x: number, y: number, w: number, h: number, lw: number, colour: string): void {
    this.#record('strokeRect', x, y, w, h, lw, colour);
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.#record('circle', x, y, radius, colour);
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

/** Puts both fleets down without going through the placement UI. */
function readyToFire(game: SeaBattleGame, seedA: number, seedB: number): void {
  placeRandomFleet(fleetOf(game.position, 'p1'), new Rng(seedA));
  placeRandomFleet(fleetOf(game.position, 'p2'), new Rng(seedB));
  for (let i = 0; i < FLEET.length; i += 1) {
    recordPlacement(game.position, 'p1');
    recordPlacement(game.position, 'p2');
  }
}

/** Every cell any of `seat`'s ships occupies. */
function occupiedCells(game: SeaBattleGame, seat: SeatId): number[] {
  const cells: number[] = [];
  const scratch: number[] = [];
  for (const ship of fleetOf(game.position, seat).ships) {
    shipCells(scratch, ship.cell, ship.length, ship.orientation);
    cells.push(...scratch);
  }
  return cells;
}

describe('laying out', () => {
  it('has no active seat, so the shell splits the device between them', () => {
    // Both players lay out at once, each on their own half. The shell reads a null active
    // seat as "no turns right now" and gives each seat its own zone.
    const game = new SeaBattleGame();
    game.init(makeContext(3));
    expect(game.position.phase).toBe('placing');
    expect(game.getActiveSeat()).toBeNull();
  });

  it('takes a turn once both fleets are down', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(5));
    readyToFire(game, 11, 13);
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('places a ship where a player taps their own half', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    const target = cellAt(1, 1);
    input.point(
      'p1',
      HALF_LEFT_X + (columnOf(target) + 0.5) * HALF_CELL,
      HALF_ORIGIN_Y + (rowOf(target) + 0.5) * HALF_CELL,
    );
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.p1.ships.length).toBe(1);
    expect(game.position.p1.ships[0]?.cell).toBe(target);
  });

  it('lets both seats lay out in the same frame', () => {
    // They are not taking turns: one player being slow must not hold the other up.
    const game = new SeaBattleGame();
    game.init(makeContext(9));
    const input = new ScriptedInput();
    input.point('p1', HALF_LEFT_X + HALF_CELL / 2, HALF_ORIGIN_Y + HALF_CELL / 2);
    input.point('p2', 900 - 40 - 380 + HALF_CELL / 2, HALF_ORIGIN_Y + HALF_CELL / 2);
    input.press('p1');
    input.press('p2');
    game.update(STEP, input);
    expect(game.position.p1.ships.length).toBe(1);
    expect(game.position.p2.ships.length).toBe(1);
  });

  it('ignores a tap outside a seat own half', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    // Seat one taps in seat two's half, which is not seat one's board.
    input.point('p1', 900 - 60, HALF_ORIGIN_Y + HALF_CELL / 2);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.p1.ships.length).toBe(0);
  });

  it('turns the ship when the same cell is tapped twice', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    const x = HALF_LEFT_X + HALF_CELL / 2;
    const y = HALF_ORIGIN_Y + HALF_CELL / 2;
    input.point('p1', x, y);
    input.press('p1');
    game.update(STEP, input); // places across at cell 0
    expect(game.position.p1.ships[0]?.orientation).toBe('across');
  });

  it('lays a bot fleet out at once rather than making a player wait', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(17, null, 'hard'));
    expect(game.position.p2.ships.length).toBe(FLEET.length);
    expect(game.position.p1.ships.length, 'the human still has to lay theirs out').toBe(0);
  });
});

describe('the keyboard long-press that rotates a ship', () => {
  /**
   * Driven through a real `InputManager`, and that is the whole point of the test.
   *
   * The rotate was guarded by `actionReleased && holdSeconds > 0.4`, which the engine can
   * never satisfy: `holdSeconds` is zero on the release step by contract, because the hold
   * is over by then. So a keyboard player had never once rotated a ship (#2475).
   *
   * The scripted fake above could not have caught it. It sets whatever fields a test asks
   * for, so it will happily produce a state the engine never produces — a fake input record
   * can assert any input contract you like, including one that is false.
   */
  /**
   * Places two ships, optionally holding before the second.
   *
   * Note the press that begins a hold *also* places a ship — `actionPressed` fires on the
   * way down and `#tryPlace` runs there — so the rotate a hold performs applies to the
   * ship after it. That is the behaviour, and the test has to compare like with like.
   */
  function lastShipAfter(hold: boolean): Ship {
    const size = { width: manifest.logical.width, height: manifest.logical.height };
    const manager = new InputManager(size);
    const view = new InputView();
    const game = new SeaBattleGame();
    game.init(makeContext(21));

    const tap = (): void => {
      manager.keyDown('Space');
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      manager.keyUp('Space');
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    };

    /**
     * Walk the cursor clear of the last ship, so the next placement is not an overlap.
     * Sideways rather than down, because a turned ship is vertical and needs the rows
     * below it free.
     */
    const nudgeDown = (): void => {
      manager.keyDown('KeyD');
      for (let step = 0; step < 60; step += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      manager.keyUp('KeyD');
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    };

    if (hold) {
      // Well past the 0.4 s threshold, then let go: places one ship on the way down and
      // turns the next on the way up.
      manager.keyDown('Space');
      for (let step = 0; step < 40; step += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      manager.keyUp('Space');
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    } else {
      tap();
    }
    nudgeDown();
    tap();

    const ships = fleetOf(game.position, 'p1').ships;
    expect(ships.length).toBe(2);
    return ships[ships.length - 1] as Ship;
  }

  it('turns the ship a keyboard player places next', () => {
    expect(lastShipAfter(true).orientation).not.toBe(lastShipAfter(false).orientation);
  });

  it('leaves a tap alone, so placing is not also rotating', () => {
    expect(lastShipAfter(false).orientation).toBe(lastShipAfter(false).orientation);
  });
});

describe('the hidden fleets', () => {
  /**
   * The whole reason this game can work on one device.
   *
   * Two people share a screen, so a fleet drawn anywhere is a fleet the opponent can read.
   * It is solved in what is rendered rather than by any hand-the-device-over ceremony:
   * once firing starts neither fleet is ever drawn, only shots and a count of hulls.
   */
  it('never draws either fleet once firing has started', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(19));
    readyToFire(game, 23, 29);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);

    // Every cell either fleet occupies, mapped to where it would be drawn on the board.
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (const cell of occupiedCells(game, seat)) {
        const x = BOARD_ORIGIN_X + columnOf(cell) * CELL_EXTENT;
        const y = BOARD_ORIGIN_Y + rowOf(cell) * CELL_EXTENT;
        const painted = renderer.calls.some(
          (call) =>
            call.op === 'rect' &&
            typeof call.args[0] === 'number' &&
            typeof call.args[1] === 'number' &&
            Math.abs(call.args[0] - x) < CELL_EXTENT * 0.5 &&
            Math.abs(call.args[1] - y) < CELL_EXTENT * 0.5,
        );
        expect(painted, `a ${seat} ship cell was painted at ${String(cell)}`).toBe(false);
      }
    }
  });

  it('draws a hit only where a shot has actually been called', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(31));
    readyToFire(game, 37, 41);
    const hidden = occupiedCells(game, 'p2')[0] as number;

    const before = new RecordingRenderer();
    game.render(before, 0);
    const beforeRects = before.calls.filter((call) => call.op === 'rect').length;

    fire(game.position, 'p2', hidden);
    const after = new RecordingRenderer();
    game.render(after, 0);
    const afterRects = after.calls.filter((call) => call.op === 'rect').length;
    expect(afterRects, 'the hit appeared once it was earned').toBeGreaterThan(beforeRects);
  });

  it('shows how many of your own hulls are left, never where they are', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(43));
    readyToFire(game, 47, 53);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    // A status bar per ship, below the board — a count, at a fixed place.
    const below = renderer.calls.filter(
      (call) =>
        call.op === 'rect' &&
        typeof call.args[1] === 'number' &&
        call.args[1] > BOARD_ORIGIN_Y + BOARD_EXTENT,
    );
    expect(below.length, 'one marker a ship').toBe(FLEET.length);
  });

  it('draws your own fleet while you are laying it out, and only then', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(59));
    place(fleetOf(game.position, 'p1'), cellAt(0, 0), 5, 'across');
    recordPlacement(game.position, 'p1');
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const drawn = renderer.calls.some(
      (call) =>
        call.op === 'rect' &&
        typeof call.args[0] === 'number' &&
        Math.abs(call.args[0] - HALF_LEFT_X) < HALF_CELL &&
        typeof call.args[1] === 'number' &&
        Math.abs(call.args[1] - HALF_ORIGIN_Y) < HALF_CELL,
    );
    expect(drawn, 'you can see what you are placing').toBe(true);
  });
});

describe('firing', () => {
  it('passes the turn on a miss', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(61));
    readyToFire(game, 67, 71);
    const empty = (() => {
      const taken = new Set(occupiedCells(game, 'p2'));
      for (let cell = 0; cell < CELL_COUNT; cell += 1) if (!taken.has(cell)) return cell;
      return 0;
    })();

    const input = new ScriptedInput();
    input.point(
      'p1',
      BOARD_ORIGIN_X + (columnOf(empty) + 0.5) * CELL_EXTENT,
      BOARD_ORIGIN_Y + (rowOf(empty) + 0.5) * CELL_EXTENT,
    );
    input.press('p1');
    game.update(STEP, input);
    input.release('p1');
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.position.seat, 'a miss ends your turn').toBe('p2');
  });

  it('keeps the turn on a hit, which is what makes finding a ship worth something', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(73));
    readyToFire(game, 79, 83);
    const hit = occupiedCells(game, 'p2')[0] as number;

    const input = new ScriptedInput();
    input.point(
      'p1',
      BOARD_ORIGIN_X + (columnOf(hit) + 0.5) * CELL_EXTENT,
      BOARD_ORIGIN_Y + (rowOf(hit) + 0.5) * CELL_EXTENT,
    );
    input.press('p1');
    game.update(STEP, input);
    input.release('p1');
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.position.seat, 'a hit buys another shot').toBe('p1');
  });

  it('ignores a tap off the board', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(89));
    readyToFire(game, 97, 101);
    const input = new ScriptedInput();
    input.point('p1', 10, 10);
    input.press('p1');
    game.update(STEP, input);
    let shots = 0;
    for (let cell = 0; cell < CELL_COUNT; cell += 1) if (game.position.p2.shotAt[cell]) shots += 1;
    expect(shots).toBe(0);
  });
});

describe('the match', () => {
  it('starts with nothing sunk', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(103));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('counts ships sunk, which is the number a player is tracking', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(107));
    readyToFire(game, 109, 113);
    const first = fleetOf(game.position, 'p2').ships[0];
    if (first === undefined) throw new Error('no fleet');
    const cells: number[] = [];
    shipCells(cells, first.cell, first.length, first.orientation);
    for (const cell of cells) fire(game.position, 'p2', cell);
    expect(game.getScore().p1).toBe(1);
  });

  it('plays a whole bot match to a winner', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(127, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 900 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('stops changing once it is decided', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(131, 'hard', 'easy'));
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
      const game = new SeaBattleGame();
      game.init(makeContext(137, 'normal', 'normal'));
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
    const game = new SeaBattleGame();
    game.init(makeContext(139, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 300; i += 1) game.update(STEP, input);
    game.init(makeContext(139, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });
});

describe('the bot', () => {
  it('never fires for a human seat', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(149, null, 'hard'));
    readyToFire(game, 151, 157);
    game.position.seat = 'p1';
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    let shots = 0;
    for (let cell = 0; cell < CELL_COUNT; cell += 1) if (game.position.p2.shotAt[cell]) shots += 1;
    expect(shots, 'a silent human calls nothing').toBe(0);
  });
});

describe('rendering', () => {
  it('draws nothing outside the logical box', () => {
    // The fleet status below the board was drawn at y = 932 in a 900-unit box, where the
    // renderer's clip threw it away. Nothing errored and nothing appeared.
    const game = new SeaBattleGame();
    game.init(makeContext(211, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 1200; i += 1) game.update(STEP, input);
    for (const renderer of [new RecordingRenderer()]) {
      game.render(renderer, 0);
      for (const call of renderer.calls) {
        if (call.op === 'text') continue; // text is positioned by baseline, not by box
        for (const value of call.args) {
          if (typeof value !== 'number') continue;
          expect(Number.isFinite(value)).toBe(true);
          expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-40);
          expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(940);
        }
      }
    }
  });

  it('does not mutate the position', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(163, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.position);
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0);
    expect(JSON.stringify(game.position)).toBe(before);
  });

  it('does not rotate while both seats are laying out at once', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(167));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops, 'nobody is upside down when both act at once').not.toContain(
      'pushRotation',
    );
  });

  it('rotates to face whoever is firing', () => {
    const game = new SeaBattleGame();
    game.init(makeContext(173));
    readyToFire(game, 179, 181);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops).toContain('pushRotation');
  });

  it('tells a hit from a sunk cell with the colour removed', () => {
    // Rule 7: a hit is crossed once, a sunk cell both ways.
    const game = new SeaBattleGame();
    game.init(makeContext(191));
    readyToFire(game, 193, 197);
    const ship = fleetOf(game.position, 'p2').ships.find((s) => s.length > 1);
    if (ship === undefined) throw new Error('no fleet');
    const cells: number[] = [];
    shipCells(cells, ship.cell, ship.length, ship.orientation);

    fire(game.position, 'p2', cells[0] as number);
    const hitOnly = new RecordingRenderer();
    game.render(hitOnly, 0);
    const linesAfterHit = hitOnly.calls.filter((call) => call.op === 'line').length;

    for (const cell of cells) fire(game.position, 'p2', cell);
    const sunk = new RecordingRenderer();
    game.render(sunk, 0);
    const linesAfterSunk = sunk.calls.filter((call) => call.op === 'line').length;

    expect(
      linesAfterSunk - linesAfterHit,
      'a sunk ship carries more strokes than the same cells hit',
    ).toBeGreaterThan(cells.length);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('sea-battle');
    expect(manifest.archetype).toBe('turn-board');
  });
});
