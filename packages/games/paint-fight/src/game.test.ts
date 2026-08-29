import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { DRAG_DEADZONE, PaintFightGame } from './game.js';
import { BOARD_HEIGHT, BOARD_WIDTH, CELLS, ROUND_SECONDS, countBare, countOwned } from './rules.js';
import type { BotDifficulty } from './rules.js';

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

  down(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = true;
  }

  dragTo(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = false;
  }

  lift(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = false;
  }

  steer(seat: SeatId, x: number): void {
    this.#of(seat).move.x = x;
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

describe('steering', () => {
  it('turns toward the direction of the drag', () => {
    const game = new PaintFightGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    const before = game.position.p1.heading;
    input.down('p1', 100, 900);
    game.update(STEP, input);
    input.dragTo('p1', 100, 900 + DRAG_DEADZONE * 4); // pulled downward
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.position.p1.heading).toBeGreaterThan(before);
  });

  it('ignores a drag too short to be a steer', () => {
    // Dragged **across** the heading, not along it: a short drag in the direction it is
    // already facing asks for no turn whether the deadzone exists or not.
    const game = new PaintFightGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    const before = game.position.p1.heading;
    expect(before, 'p1 starts facing along +x').toBe(0);
    input.down('p1', 100, 900);
    game.update(STEP, input);
    input.dragTo('p1', 100, 900 + DRAG_DEADZONE / 2);
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.position.p1.heading).toBe(before);
  });

  it('takes a fresh origin when a new touch takes over', () => {
    const game = new PaintFightGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    input.down('p1', 100, 100);
    game.update(STEP, input);
    input.dragTo('p1', 100, 400);
    game.update(STEP, input);

    const before = game.position.p1.heading;
    input.down('p1', 800, 100);
    game.update(STEP, input);
    input.dragTo('p1', 800, 100 + DRAG_DEADZONE / 2);
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.position.p1.heading).toBeCloseTo(before, 6);
  });

  it('steers on the keyboard too, each seat from its own keys', () => {
    const game = new PaintFightGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    const before = { p1: game.position.p1.heading, p2: game.position.p2.heading };
    input.steer('p1', 1);
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.position.p1.heading).toBeGreaterThan(before.p1);
    expect(game.position.p2.heading, 'a silent seat holds its line').toBe(before.p2);
  });
});

describe('the board is shared', () => {
  it('has no active seat, so the shell keeps both pointer zones', () => {
    const game = new PaintFightGame();
    game.init(makeContext(13));
    expect(game.getActiveSeat()).toBeNull();
  });

  it('never rotates', () => {
    const game = new PaintFightGame();
    game.init(makeContext(17));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops).not.toContain('pushRotation');
  });
});

describe('the match', () => {
  it('starts with a bare board', () => {
    const game = new PaintFightGame();
    game.init(makeContext(19));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(countBare(game.position)).toBe(CELLS);
  });

  it('reports cells painted', () => {
    const game = new PaintFightGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.getScore().p1).toBe(countOwned(game.position, 'p1'));
    expect(game.getScore().p1).toBeGreaterThan(0);
  });

  it('always ends on the clock, because nobody can be eliminated', () => {
    const game = new PaintFightGame();
    game.init(makeContext(29, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * (ROUND_SECONDS + 20) && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('stops changing once it is decided', () => {
    const game = new PaintFightGame();
    game.init(makeContext(31, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * (ROUND_SECONDS + 20) && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = JSON.stringify(game.getScore());
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new PaintFightGame();
      game.init(makeContext(37, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 30; i += 1) {
        game.update(STEP, input);
        if (i % 120 === 0) out.push(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init and clears on destroy', () => {
    const game = new PaintFightGame();
    game.init(makeContext(41, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 20; i += 1) game.update(STEP, input);
    game.init(makeContext(41, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(countBare(game.position)).toBe(CELLS);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('never steers for a human seat', () => {
    const game = new PaintFightGame();
    game.init(makeContext(43, null, 'hard'));
    const input = new ScriptedInput();
    const before = game.position.p1.heading;
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.position.p1.heading, 'a silent human holds its line').toBe(before);
  });
});

describe('rendering', () => {
  it('draws every cell of the board', () => {
    const game = new PaintFightGame();
    game.init(makeContext(47));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const cells = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[2] === 40 && call.args[3] === 40,
    ).length;
    expect(cells).toBe(CELLS);
  });

  it('tells the two colours apart with the colour removed', () => {
    // Rule 7, and the case that matters: two blocks of flat colour side by side are the
    // whole picture in this game.
    const game = new PaintFightGame();
    game.init(makeContext(53));
    const input = new ScriptedInput();
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer);

    const dots = renderer.calls.filter(
      (call) => call.op === 'circle' && call.args[3] === SEAT_PALETTE.p1.deep && call.args[2] === 4,
    ).length;
    const bars = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[3] === 6 && call.args[4] === SEAT_PALETTE.p2.deep,
    ).length;
    expect(dots, 'p1 cells carry a dot').toBeGreaterThan(0);
    expect(bars, 'p2 cells carry a bar').toBeGreaterThan(0);
    expect(dots).toBe(countOwned(game.position, 'p1'));
    expect(bars).toBe(countOwned(game.position, 'p2'));
  });

  it('shows which way each roller is pointing', () => {
    const game = new PaintFightGame();
    game.init(makeContext(59));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const p1 = game.position.p1;
    expect(
      renderer.calls.some(
        (call) => call.op === 'line' && call.args[0] === p1.x && call.args[1] === p1.y,
      ),
    ).toBe(true);
  });

  it('shows the score as one bar, not two numbers', () => {
    // What a player needs to know is who is ahead and by how much, which a bar says at a
    // glance and two numbers do not — and the bare share between them says how much is
    // still to play for.
    const game = new PaintFightGame();
    game.init(makeContext(61));
    const input = new ScriptedInput();
    for (let i = 0; i < 240; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const bars = renderer.calls.filter(
      (call) =>
        call.op === 'rect' &&
        call.args[3] === 26 &&
        typeof call.args[1] === 'number' &&
        call.args[1] > BOARD_HEIGHT,
    );
    expect(bars.length, 'p1, bare and p2').toBe(3);
    const total = bars.reduce(
      (sum, call) => sum + (typeof call.args[2] === 'number' ? call.args[2] : 0),
      0,
    );
    expect(total, 'the three add up to the whole bar').toBeCloseTo(BOARD_WIDTH - 80, 4);
  });

  it('counts the clock down', () => {
    const game = new PaintFightGame();
    game.init(makeContext(67));
    const full = new RecordingRenderer();
    game.render(full);
    expect(full.args).toContain(`${String(ROUND_SECONDS)}s`);

    game.position.elapsed = ROUND_SECONDS - 5;
    const later = new RecordingRenderer();
    game.render(later);
    expect(later.args).toContain('5s');
  });

  it('draws nothing outside the logical box', () => {
    const game = new PaintFightGame();
    game.init(makeContext(71, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 1200; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    for (const call of renderer.calls) {
      if (call.op === 'text') continue;
      for (const value of call.args) {
        if (typeof value !== 'number') continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-60);
        expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(1140);
      }
    }
  });

  it('does not mutate the position', () => {
    const game = new PaintFightGame();
    game.init(makeContext(73, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.position);
    game.render(new RecordingRenderer());
    game.render(new RecordingRenderer());
    expect(JSON.stringify(game.position)).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('paint-fight');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
  });
});
