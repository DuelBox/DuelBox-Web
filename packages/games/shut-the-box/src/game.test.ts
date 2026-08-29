import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  ShutTheBoxGame,
  TILE_HEIGHT,
  TILE_ORIGIN_X,
  TILE_ORIGIN_Y,
  TILE_WIDTH,
  rollRect,
  tileAt,
  tileRect,
} from './game.js';
import { TILE_COUNT, openTotal } from './rules.js';
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

  move(seat: SeatId, x: number): void {
    this.#of(seat).move.x = x;
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
    this.calls.push({ op, args: values });
  }
}

/** Steps until the board has finished turning and input is accepted again. */
function settle(game: ShutTheBoxGame, input: ScriptedInput): void {
  for (let i = 0; i < 120; i += 1) game.update(STEP, input);
}

describe('the geometry', () => {
  it('maps a point in a tile to that tile', () => {
    for (let tile = 1; tile <= TILE_COUNT; tile += 1) {
      const rect = tileRect(tile);
      expect(tileAt(rect.x + rect.w / 2, rect.y + rect.h / 2)).toBe(tile);
    }
  });

  it('maps a point above or below the row to nothing', () => {
    expect(tileAt(TILE_ORIGIN_X + 10, TILE_ORIGIN_Y - 40)).toBe(0);
    expect(tileAt(TILE_ORIGIN_X + 10, TILE_ORIGIN_Y + TILE_HEIGHT + 40)).toBe(0);
  });

  it('maps a point beyond either end to nothing', () => {
    expect(tileAt(TILE_ORIGIN_X - 30, TILE_ORIGIN_Y + 10)).toBe(0);
    expect(tileAt(900, TILE_ORIGIN_Y + 10)).toBe(0);
  });

  it('maps the gap between two tiles to nothing', () => {
    // A tap that lands between tiles must not silently shut a neighbour — with a roll of
    // 3 the difference between tile 1 and tile 2 is the whole move.
    const first = tileRect(1);
    const gapX = first.x + TILE_WIDTH + 3;
    expect(tileAt(gapX, TILE_ORIGIN_Y + 10)).toBe(0);
  });

  it('puts the two roll controls side by side without overlapping', () => {
    const two = rollRect('two', true);
    const one = rollRect('one', true);
    expect(two.x + two.w, 'the second starts after the first ends').toBeLessThan(one.x);
  });

  it('centres the single roll control when there is only one', () => {
    const only = rollRect('two', false);
    expect(only.x + only.w / 2).toBeCloseTo(450, 5);
  });
});

describe('playing a turn', () => {
  it('rolls on the action key', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    settle(game, input);
    expect(game.position.phase).toBe('rolling');
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('choosing');
    expect(game.position.dice.length).toBe(2);
  });

  it('shuts a tile the moment the pick makes the roll', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    settle(game, input);
    input.press('p1');
    game.update(STEP, input);
    input.release('p1');

    const total = game.position.dice[0]! + game.position.dice[1]!;
    // Tap the single tile equal to the roll, which always exists on a full box for 2–9.
    if (total <= TILE_COUNT) {
      const rect = tileRect(total);
      input.point('p1', rect.x + rect.w / 2, rect.y + rect.h / 2);
      input.press('p1');
      game.update(STEP, input);
      expect(game.position.open[total - 1], 'it shut without a separate confirm').toBe(false);
      expect(game.position.phase, 'and went back to rolling').toBe('rolling');
    }
  });

  it('leaves the tile open while the pick is short of the roll', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    settle(game, input);
    // A roll of 12 so no single tile completes it.
    game.position.dice.length = 0;
    game.position.dice.push(6, 6);
    game.position.phase = 'choosing';

    const rect = tileRect(5);
    input.point('p1', rect.x + rect.w / 2, rect.y + rect.h / 2);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.open[4], '5 is picked, not shut').toBe(true);
    expect(game.position.picked).toContain(5);
  });

  it('ignores a tap in the gap between two tiles', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(9));
    const input = new ScriptedInput();
    settle(game, input);
    game.position.dice.length = 0;
    game.position.dice.push(6, 6);
    game.position.phase = 'choosing';

    const first = tileRect(1);
    input.point('p1', first.x + TILE_WIDTH + 3, TILE_ORIGIN_Y + 10);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.picked.length, 'nothing was picked').toBe(0);
  });

  it('hands the box to seat two when no move is possible', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    settle(game, input);
    // Only the 2 open, and a roll of 12 — nothing can be made.
    game.position.open.fill(false);
    game.position.open[1] = true;
    game.position.dice.length = 0;
    game.position.dice.push(6, 6);
    game.position.phase = 'choosing';

    for (let i = 0; i < 200 && game.position.seat === 'p1'; i += 1) game.update(STEP, input);
    expect(game.position.seat, 'the turn ended and the box changed hands').toBe('p2');
    expect(game.position.scoreP1, 'seat one was scored on the 2 it could not shut').toBe(2);
    expect(game.position.open.filter(Boolean).length, 'seat two gets a fresh box').toBe(TILE_COUNT);
  });

  it('holds the dead turn on screen before handing over', () => {
    // A handover the instant the dice land reads as the game skipping someone.
    const game = new ShutTheBoxGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    settle(game, input);
    game.position.open.fill(false);
    game.position.open[1] = true;
    game.position.dice.length = 0;
    game.position.dice.push(6, 6);
    game.position.phase = 'choosing';

    game.update(STEP, input);
    expect(game.position.seat, 'still seat one a frame later').toBe('p1');
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.position.seat, 'and half a second on').toBe('p1');
  });
});

describe('the match', () => {
  it('starts with nothing shut by either seat', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(17));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('reports the tiles shut, so the HUD counts up as a player does well', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(19));
    game.position.scoreP1 = 9; // nine left standing, so thirty-six shut
    expect(game.getScore().p1).toBe(36);
  });

  it('plays two full bot turns and reaches a winner', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(23, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('stops changing once it is decided', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(29, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = JSON.stringify(game.getScore());
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new ShutTheBoxGame();
      game.init(makeContext(31, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 120; i += 1) {
        game.update(STEP, input);
        if (i % 60 === 0) out.push(String(openTotal(game.position)));
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init and clears on destroy', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(37, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200; i += 1) game.update(STEP, input);
    game.init(makeContext(37, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });
});

describe('the bot', () => {
  it('never plays for a human seat', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(41, null, 'hard'));
    const input = new ScriptedInput();
    settle(game, input);
    const before = openTotal(game.position);
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(openTotal(game.position), 'a silent human shuts nothing').toBe(before);
    expect(game.position.seat).toBe('p1');
  });
});

describe('rendering', () => {
  it('draws all nine tiles', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(43));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (let tile = 1; tile <= TILE_COUNT; tile += 1) {
      const rect = tileRect(tile);
      const drawn = renderer.calls.some(
        (call) => call.op === 'rect' && call.args[0] === rect.x && call.args[1] === rect.y,
      );
      expect(drawn, `tile ${String(tile)} is drawn`).toBe(true);
    }
  });

  it('numbers every tile', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(45));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (let tile = 1; tile <= TILE_COUNT; tile += 1) {
      const labelled = renderer.calls.some(
        (call) => call.op === 'text' && call.args[0] === String(tile),
      );
      expect(labelled, `tile ${String(tile)} shows its number`).toBe(true);
    }
  });

  it('strikes a shut tile through, so the box reads in greyscale', () => {
    // Rule 7. A shut tile that differed only in fill would be invisible to a player who
    // cannot separate the two greys.
    const game = new ShutTheBoxGame();
    game.init(makeContext(47));
    const before = new RecordingRenderer();
    game.render(before, 0);
    const linesBefore = before.calls.filter((call) => call.op === 'line').length;

    game.position.open[3] = false;
    const after = new RecordingRenderer();
    game.render(after, 0);
    const linesAfter = after.calls.filter((call) => call.op === 'line').length;
    expect(linesAfter, 'shutting a tile added a stroke through it').toBeGreaterThan(linesBefore);
  });

  it('draws the dice as pips rather than numerals', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(49));
    game.position.dice.length = 0;
    game.position.dice.push(5, 3);
    game.position.phase = 'choosing';
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const pips = renderer.calls.filter((call) => call.op === 'circle').length;
    expect(pips, 'five pips and three').toBe(8);
  });

  it('shows the roll controls only when there is a roll to make', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(51));
    const rolling = new RecordingRenderer();
    game.render(rolling, 0);
    expect(rolling.args).toContain('Roll two');

    game.position.phase = 'choosing';
    const choosing = new RecordingRenderer();
    game.render(choosing, 0);
    expect(choosing.args, 'the button goes once the dice are down').not.toContain('Roll two');
  });

  it('offers one die only once the high tiles are shut', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(53));
    const full = new RecordingRenderer();
    game.render(full, 0);
    expect(full.args, 'the 9 is standing').not.toContain('Roll one');

    game.position.open.fill(false);
    game.position.open[0] = true;
    game.position.open[2] = true;
    const low = new RecordingRenderer();
    game.render(low, 0);
    expect(low.args).toContain('Roll one');
  });

  it('marks the active seat on the frame', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(55));
    const p1 = new RecordingRenderer();
    game.render(p1, 0);
    expect(p1.args).toContain(SEAT_PALETTE.p1.base);

    game.position.seat = 'p2';
    const p2 = new RecordingRenderer();
    game.render(p2, 0);
    expect(p2.args).toContain(SEAT_PALETTE.p2.base);
  });

  it('turns the board to face whoever is playing', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(57));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops, 'a turn-based board rotates').toContain('pushRotation');
  });

  it('does not mutate the position', () => {
    const game = new ShutTheBoxGame();
    game.init(makeContext(59, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.position);
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0);
    expect(JSON.stringify(game.position)).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('shut-the-box');
    expect(manifest.archetype).toBe('turn-board');
  });
});
