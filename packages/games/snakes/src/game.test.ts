import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { DRAG_DEADZONE, SnakesGame } from './game.js';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PELLET_TARGET,
  ROUND_SECONDS,
  START_SEGMENTS,
  headOf,
  normaliseAngle,
} from './rules.js';
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

describe('steering with a finger', () => {
  it('turns toward the direction of the drag', () => {
    // The *direction* of the drag, not where the finger is: the shell gives each player
    // half the screen, so a player whose snake is in the far half could not point ahead
    // of it. A relative drag works from anywhere in your own half.
    const game = new SnakesGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    const before = game.position.p1.heading;

    // Anywhere at all — the origin is wherever the thumb went down.
    input.down('p1', 100, 800);
    game.update(STEP, input);
    input.dragTo('p1', 100, 800 + DRAG_DEADZONE * 4); // pulled downward
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.position.p1.heading, 'it turned toward down').toBeGreaterThan(before);
  });

  it('ignores a drag too short to be a steer', () => {
    // Dragged **across** the snake's heading, not along it. A short drag in the direction
    // it is already facing asks for no turn at all, so it passes with the deadzone
    // deleted — which is exactly what the first version of this test did.
    const game = new SnakesGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    const before = game.position.p1.heading;
    expect(before, 'p1 starts facing along +x').toBe(0);

    input.down('p1', 100, 800);
    game.update(STEP, input);
    input.dragTo('p1', 100, 800 + DRAG_DEADZONE / 2); // straight down: a full quarter turn
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.position.p1.heading, 'a resting thumb is not a steer').toBe(before);
  });

  it('takes a fresh origin when a new touch takes over', () => {
    // Without lifting first, which is the case the guard is actually for: a second finger
    // can take over while the seat's pointer never goes null, and measuring the new drag
    // from the old origin would lurch the snake the moment a player re-grips.
    const game = new SnakesGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    input.down('p1', 100, 100);
    game.update(STEP, input);
    input.dragTo('p1', 100, 400); // a real drag, so an origin is established
    game.update(STEP, input);

    const before = game.position.p1.heading;
    // A new touch, far away, with no null frame in between.
    input.down('p1', 700, 100);
    game.update(STEP, input);
    input.dragTo('p1', 700, 100 + DRAG_DEADZONE / 2);
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.position.p1.heading, 'a short drag from the new origin steers nothing').toBeCloseTo(
      before,
      6,
    );
  });

  it('steers on the keyboard too', () => {
    const game = new SnakesGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    const before = game.position.p1.heading;
    input.steer('p1', 1);
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.position.p1.heading).toBeGreaterThan(before);
  });

  it('drives each seat from its own input', () => {
    const game = new SnakesGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    const before = { p1: game.position.p1.heading, p2: game.position.p2.heading };
    input.steer('p1', 1);
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.position.p1.heading).toBeGreaterThan(before.p1);
    expect(game.position.p2.heading, 'a silent seat holds its line').toBe(before.p2);
  });
});

describe('the arena is shared', () => {
  it('has no active seat, so the shell keeps both pointer zones', () => {
    // Both snakes move at once. A turn indicator would be a lie and rotating the arena
    // would put one player upside down.
    const game = new SnakesGame();
    game.init(makeContext(17));
    expect(game.getActiveSeat()).toBeNull();
  });

  it('never rotates', () => {
    const game = new SnakesGame();
    game.init(makeContext(19));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops).not.toContain('pushRotation');
  });
});

describe('the match', () => {
  it('starts with nothing eaten', () => {
    const game = new SnakesGame();
    game.init(makeContext(23));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('reports pellets eaten', () => {
    const game = new SnakesGame();
    game.init(makeContext(29));
    game.position.p1.eaten = 4;
    expect(game.getScore().p1).toBe(4);
  });

  it('plays a whole bot round to a winner', () => {
    const game = new SnakesGame();
    game.init(makeContext(31, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('calls the round when the clock runs out', () => {
    // Two cautious snakes circling their own halves would never meet, and `roundSeconds`
    // in the manifest is read only by the catalogue card — it ends nothing.
    //
    // Wound forward rather than played out: a bot round that happens to end in a crash
    // passes without ever reaching this path, which is what the first version did.
    const game = new SnakesGame();
    game.init(makeContext(37, 'hard', 'hard'));
    const input = new ScriptedInput();
    game.position.elapsed = ROUND_SECONDS - STEP;
    game.position.p1.eaten = 3;
    game.position.p2.eaten = 1;

    for (let i = 0; i < 200 && game.getScore().winner === null; i += 1) game.update(STEP, input);
    expect(game.getScore().winner, 'decided on pellets eaten').toBe('p1');
  });

  it('stops changing once it is decided', () => {
    const game = new SnakesGame();
    game.init(makeContext(41, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = JSON.stringify(game.getScore());
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new SnakesGame();
      game.init(makeContext(43, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 40; i += 1) {
        game.update(STEP, input);
        if (i % 60 === 0) out.push(headOf(game.position.p1).x.toFixed(6));
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init and clears on destroy', () => {
    const game = new SnakesGame();
    game.init(makeContext(47, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 120; i += 1) game.update(STEP, input);
    game.init(makeContext(47, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.p1.body.length).toBe(START_SEGMENTS);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('never steers for a human seat', () => {
    const game = new SnakesGame();
    game.init(makeContext(53, null, 'hard'));
    const input = new ScriptedInput();
    const before = game.position.p1.heading;
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.position.p1.heading, 'a silent human holds its line').toBe(before);
  });
});

describe('rendering', () => {
  it('draws the arena, both snakes and every pellet', () => {
    const game = new SnakesGame();
    game.init(makeContext(59));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const discs = renderer.calls.filter((call) => call.op === 'circle').length;
    expect(discs, 'two bodies plus the pellets').toBeGreaterThan(START_SEGMENTS);
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.base);
  });

  it('tells the two snakes apart with the colour removed', () => {
    // Rule 7, and the case that matters most: two snakes tangled together on screen.
    const game = new SnakesGame();
    game.init(makeContext(61));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const rings = renderer.calls.filter(
      (call) => call.op === 'strokeCircle' && call.args[4] === SEAT_PALETTE.p1.deep,
    ).length;
    const bars = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[4] === SEAT_PALETTE.p2.deep,
    ).length;
    expect(rings, 'seat one is ringed').toBeGreaterThan(0);
    expect(bars, 'seat two is barred, on every segment').toBeGreaterThan(START_SEGMENTS - 2);
  });

  it('shows which way each snake is pointing', () => {
    const game = new SnakesGame();
    game.init(makeContext(67));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const p1 = headOf(game.position.p1);
    const pointing = renderer.calls.some(
      (call) => call.op === 'line' && call.args[0] === p1.x && call.args[1] === p1.y,
    );
    expect(pointing).toBe(true);
  });

  it('dims a dead snake rather than removing it', () => {
    // The wreck is still in the way, so it has to stay on screen.
    const game = new SnakesGame();
    game.init(makeContext(71));
    // Counted across the whole body, not just "more than before". The head alone changes
    // colour either way, so `> 0` passes with the body left bright — which is what the
    // first version of this asserted.
    const alive = new RecordingRenderer();
    game.render(alive);
    expect(
      alive.args.filter((a) => a === SEAT_PALETTE.p1.soft).length,
      'nothing is dimmed while it lives',
    ).toBe(0);

    game.position.p1.alive = false;
    const dead = new RecordingRenderer();
    game.render(dead);
    expect(
      dead.args.filter((a) => a === SEAT_PALETTE.p1.soft).length,
      'the whole wreck is dimmed, not only its head',
    ).toBeGreaterThanOrEqual(START_SEGMENTS);
  });

  it('shows the score and the target', () => {
    const game = new SnakesGame();
    game.init(makeContext(73));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.args).toContain(`0 — 0   first to ${String(PELLET_TARGET)}`);
  });

  it('shows the round clock running down', () => {
    const game = new SnakesGame();
    game.init(makeContext(79));
    const widest = (renderer: RecordingRenderer): number => {
      let best = 0;
      for (const call of renderer.calls) {
        if (call.op !== 'rect') continue;
        const [, y, w, h] = call.args;
        if (typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number') continue;
        if (h > 10 || y < ARENA_HEIGHT / 2) continue;
        best = Math.max(best, w);
      }
      return best;
    };
    const full = new RecordingRenderer();
    game.render(full);
    const before = widest(full);
    expect(before, 'the bar is there').toBeGreaterThan(0);

    game.position.elapsed = ROUND_SECONDS / 2;
    const half = new RecordingRenderer();
    game.render(half);
    expect(widest(half), 'and it shortens').toBeLessThan(before);
  });

  it('draws nothing outside the logical box', () => {
    const game = new SnakesGame();
    game.init(makeContext(83, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 1800; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    for (const call of renderer.calls) {
      if (call.op === 'text') continue;
      for (const value of call.args) {
        if (typeof value !== 'number') continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-60);
        expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(ARENA_WIDTH + 60);
      }
    }
  });

  it('does not mutate the position', () => {
    const game = new SnakesGame();
    game.init(makeContext(89, 'normal', 'normal'));
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
    expect(manifest.id).toBe('snakes');
    expect(manifest.archetype).toBe('rt-arena');
    expect(manifest.logical.width).toBe(ARENA_WIDTH);
    expect(normaliseAngle(0)).toBe(0);
  });
});
