import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { RESET_STEPS, RING_OUT_TARGET, SumoPushGame } from './game.js';
import { manifest } from './manifest.js';
import { MIN_RADIUS, START_RADIUS, WRESTLER_RADIUS } from './rules.js';
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

  push(seat: SeatId, x: number, y: number): void {
    const target = seat === 'p1' ? this.#p1 : this.#p2;
    target.move.x = x;
    target.move.y = y;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = seat === 'p1' ? this.#p1 : this.#p2;
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
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

/** Logs every call and every argument, so no draw can pass unobserved. */
class RecordingRenderer implements Renderer {
  readonly calls: DrawCall[] = [];

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
    this.pushSeatRotation(radians !== 0);
  }

  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  #record(op: string, ...args: DrawArg[]): void {
    this.calls.push({ op, args });
  }
}

/** Rings stroked on the disc drawn at `(x, y)`, i.e. the belts that name a seat. */
function beltsAt(renderer: RecordingRenderer, x: number, y: number): number {
  let count = 0;
  for (const call of renderer.calls) {
    if (call.op !== 'strokeCircle') continue;
    if (call.args[0] === x && call.args[1] === y) count += 1;
  }
  return count;
}

function distanceFromCentre(game: SumoPushGame, seat: SeatId): number {
  const w = game.wrestler(seat);
  const dx = w.x - game.ring.centreX;
  const dy = w.y - game.ring.centreY;
  return Math.sqrt(dx * dx + dy * dy);
}

function runToDecision(game: SumoPushGame, input: InputState, limit: number): number {
  let steps = 0;
  while (game.getScore().winner === null && steps < limit) {
    game.update(STEP, input);
    steps += 1;
  }
  return steps;
}

describe('SumoPushGame', () => {
  it('gives the match to the seat still standing when the other drives itself out', () => {
    const game = new SumoPushGame();
    game.init(makeContext(4711));
    const input = new ScriptedInput();
    // p2 starts on the far side of the ring and runs away from p1, straight over the edge.
    input.push('p2', 0, -1);

    const steps = runToDecision(game, input, 6000);

    const score = game.getScore();
    expect(steps).toBeLessThan(6000);
    expect(score.winner).toBe('p1');
    expect(score.p1).toBe(RING_OUT_TARGET);
    expect(score.p2).toBe(0);
  });

  it('accepts a pointer as a direction to drive in', () => {
    const game = new SumoPushGame();
    game.init(makeContext(31));
    const input = new ScriptedInput();
    input.point('p2', 400, 5);

    const steps = runToDecision(game, input, 6000);

    expect(steps).toBeLessThan(6000);
    expect(game.getScore().winner).toBe('p1');
  });

  it('ends a bout in which neither seat ever moves, and counts a double fall for both', () => {
    const game = new SumoPushGame();
    game.init(makeContext(99));
    const idle = new ScriptedInput();

    const steps = runToDecision(game, idle, 20_000);

    const score = game.getScore();
    expect(steps).toBeLessThan(20_000);
    // Both start the identical distance out, so the closing ring passes them in the same
    // step and neither seat can be handed the round by test order.
    expect(score.p1).toBe(RING_OUT_TARGET);
    expect(score.p2).toBe(RING_OUT_TARGET);
    expect(score.winner).toBe('draw');
  });

  it('settles a bot against a bot rather than letting the pair circle for ever', () => {
    const game = new SumoPushGame();
    game.init(makeContext(808, 'normal', 'normal'));

    const steps = runToDecision(game, new ScriptedInput(), 12_000);

    const score = game.getScore();
    expect(steps).toBeLessThan(12_000);
    expect(score.winner).not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBe(RING_OUT_TARGET);
  });

  it('holds both wrestlers still until the opening countdown expires', () => {
    const game = new SumoPushGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    input.push('p1', 1, 0);

    expect(game.resetCountdown).toBe(RESET_STEPS);
    const startX = game.wrestler('p1').x;
    for (let i = 0; i < RESET_STEPS; i += 1) game.update(STEP, input);

    expect(game.resetCountdown).toBe(0);
    expect(game.wrestler('p1').x).toBe(startX);

    game.update(STEP, input);
    expect(game.wrestler('p1').x).toBeGreaterThan(startX);
  });

  it('starts both seats the same distance from the middle', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const game = new SumoPushGame();
      game.init(makeContext(seed));
      expect(distanceFromCentre(game, 'p1')).toBeCloseTo(distanceFromCentre(game, 'p2'), 9);
    }
  });

  it('regrows the ring and resets both wrestlers after a ring-out', () => {
    const game = new SumoPushGame();
    game.init(makeContext(21));
    const input = new ScriptedInput();
    input.push('p2', 0, -1);

    let steps = 0;
    while (game.getScore().p1 === 0 && steps < 2000) {
      game.update(STEP, input);
      steps += 1;
    }

    expect(game.getScore().p1).toBe(1);
    expect(game.resetCountdown).toBe(RESET_STEPS);
    expect(game.ring.radius).toBeLessThan(START_RADIUS);
    expect(distanceFromCentre(game, 'p2')).toBeLessThan(game.ring.radius);

    for (let i = 0; i < RESET_STEPS; i += 1) game.update(STEP, input);

    expect(game.resetCountdown).toBe(0);
    expect(game.ring.radius).toBe(START_RADIUS);
  });

  it('keeps the ring between its minimum and its starting size all match', () => {
    const game = new SumoPushGame();
    game.init(makeContext(808, 'normal', 'normal'));
    const input = new ScriptedInput();

    for (let i = 0; i < 4000; i += 1) {
      game.update(STEP, input);
      expect(game.ring.radius).toBeGreaterThanOrEqual(MIN_RADIUS);
      expect(game.ring.radius).toBeLessThanOrEqual(START_RADIUS);
    }
  });

  it('gets a bot seat moving under its own steering', () => {
    const game = new SumoPushGame();
    game.init(makeContext(2024, null, 'normal'));
    const input = new ScriptedInput();

    const startX = game.wrestler('p2').x;
    const startY = game.wrestler('p2').y;
    for (let i = 0; i < RESET_STEPS + 90; i += 1) game.update(STEP, input);

    const p2 = game.wrestler('p2');
    const moved = Math.abs(p2.x - startX) + Math.abs(p2.y - startY);
    expect(moved).toBeGreaterThan(1);
  });

  it('stops simulating once the match is decided', () => {
    const game = new SumoPushGame();
    game.init(makeContext(4711));
    const input = new ScriptedInput();
    input.push('p2', 0, -1);
    runToDecision(game, input, 6000);

    const decided = game.getScore();
    const p1 = decided.p1;
    const p2 = decided.p2;
    const x = game.wrestler('p2').x;
    const radius = game.ring.radius;

    for (let i = 0; i < 300; i += 1) game.update(STEP, input);

    expect(game.getScore().p1).toBe(p1);
    expect(game.getScore().p2).toBe(p2);
    expect(game.wrestler('p2').x).toBe(x);
    expect(game.ring.radius).toBe(radius);
  });

  it('replays identically from the same seed and the same inputs', () => {
    function run(): number[] {
      const game = new SumoPushGame();
      game.init(makeContext(777, 'hard', 'easy'));
      const input = new ScriptedInput();
      for (let i = 0; i < 1800; i += 1) game.update(STEP, input);
      const score = game.getScore();
      const p1 = game.wrestler('p1');
      const p2 = game.wrestler('p2');
      return [
        p1.x,
        p1.y,
        p1.vx,
        p1.vy,
        p2.x,
        p2.y,
        p2.vx,
        p2.vy,
        game.ring.radius,
        score.p1,
        score.p2,
      ];
    }

    const first = run();
    expect(first).toEqual(run());
    for (const value of first) expect(Number.isFinite(value)).toBe(true);
  });

  it('tells the seats apart by belt count, not by colour alone', () => {
    const game = new SumoPushGame();
    game.init(makeContext(13));
    const renderer = new RecordingRenderer();

    game.render(renderer, 0);

    expect(renderer.calls[0]?.op).toBe('clear');
    expect(beltsAt(renderer, game.wrestler('p1').x, game.wrestler('p1').y)).toBe(1);
    expect(beltsAt(renderer, game.wrestler('p2').x, game.wrestler('p2').y)).toBe(2);
  });

  it('draws the ring at the radius the rule uses', () => {
    const game = new SumoPushGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    for (let i = 0; i < RESET_STEPS + 120; i += 1) game.update(STEP, input);

    const renderer = new RecordingRenderer();
    game.render(renderer, 1);

    const edge = renderer.calls.find(
      (call) =>
        call.op === 'strokeCircle' &&
        call.args[0] === game.ring.centreX &&
        call.args[1] === game.ring.centreY &&
        call.args[2] === game.ring.radius,
    );
    expect(edge).toBeDefined();
    expect(game.ring.radius).toBeLessThan(START_RADIUS);
  });

  it('renders without touching simulation state', () => {
    const game = new SumoPushGame();
    game.init(makeContext(13, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);

    const p1 = game.wrestler('p1');
    const p2 = game.wrestler('p2');
    const before = [p1.x, p1.y, p1.vx, p1.vy, p2.x, p2.y, p2.vx, p2.vy, game.ring.radius];

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    game.render(renderer, 0.5);
    game.render(renderer, 0.999);

    expect(renderer.calls.length).toBeGreaterThan(0);
    for (const call of renderer.calls) {
      for (const value of call.args) {
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect([p1.x, p1.y, p1.vx, p1.vy, p2.x, p2.y, p2.vx, p2.vy, game.ring.radius]).toEqual(before);
  });

  it('keeps both discs inside the play area while a bout is live', () => {
    const game = new SumoPushGame();
    game.init(makeContext(64, 'hard', 'hard'));
    const input = new ScriptedInput();

    for (let i = 0; i < 1200; i += 1) {
      game.update(STEP, input);
      for (const seat of ['p1', 'p2'] as const) {
        expect(distanceFromCentre(game, seat)).toBeLessThan(START_RADIUS + WRESTLER_RADIUS * 4);
      }
    }
  });

  it('ignores updates after destroy', () => {
    const game = new SumoPushGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    input.push('p1', 1, 0);
    for (let i = 0; i < RESET_STEPS + 60; i += 1) game.update(STEP, input);

    const x = game.wrestler('p1').x;
    game.destroy();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);

    expect(game.wrestler('p1').x).toBe(x);
  });

  it('resumes a pause exactly where it stood', () => {
    const game = new SumoPushGame();
    game.init(makeContext(21));
    const input = new ScriptedInput();
    input.push('p1', 1, 0);
    for (let i = 0; i < RESET_STEPS + 30; i += 1) game.update(STEP, input);

    const p1 = game.wrestler('p1');
    const before = [p1.x, p1.y, p1.vx, p1.vy];
    game.onPause();
    game.onResume();

    expect([p1.x, p1.y, p1.vx, p1.vy]).toEqual(before);
  });
});
