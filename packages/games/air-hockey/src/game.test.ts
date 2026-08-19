import { describe, it, expect } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { AirHockeyGame, SERVE_STEPS } from './game.js';
import { manifest } from './manifest.js';
import { MALLET_RADIUS, TABLE } from './rules.js';
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
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

type DrawArg = number | string | boolean | undefined;

/** Logs every call and every argument, so no draw can pass unobserved. */
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

  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  #record(op: string, ...values: DrawArg[]): void {
    this.ops.push(op);
    for (const value of values) this.args.push(value);
  }
}

describe('AirHockeyGame', () => {
  it('runs a headless match through to a decided score', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(4711));

    const input = new ScriptedInput();
    // Both mallets parked in their own corners, well clear of the goal mouths, so the
    // match resolves on serves alone and the run terminates.
    input.point('p1', 60, 940);
    input.point('p2', 540, 60);

    let steps = 0;
    while (game.getScore().winner === null && steps < 40_000) {
      game.update(STEP, input);
      steps += 1;
    }

    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBe(7);
    expect(Math.min(score.p1, score.p2)).toBeLessThan(7);
    expect(score.winner).toBe(score.p1 > score.p2 ? 'p1' : 'p2');
  });

  it('stops simulating once the match is decided', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(4711));
    const input = new ScriptedInput();
    input.point('p1', 60, 940);
    input.point('p2', 540, 60);

    let steps = 0;
    while (game.getScore().winner === null && steps < 40_000) {
      game.update(STEP, input);
      steps += 1;
    }
    const decided = game.getScore();
    const p1 = decided.p1;
    const p2 = decided.p2;
    const x = game.puck.x;

    for (let i = 0; i < 300; i += 1) game.update(STEP, input);

    expect(game.getScore().p1).toBe(p1);
    expect(game.getScore().p2).toBe(p2);
    expect(game.puck.x).toBe(x);
  });

  it('holds the puck on the centre spot until the serve countdown expires', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(9));
    const idle = new ScriptedInput();

    expect(game.serveCountdown).toBe(SERVE_STEPS);
    for (let i = 0; i < SERVE_STEPS; i += 1) game.update(STEP, idle);

    expect(game.serveCountdown).toBe(0);
    expect(game.puck.x).toBe(TABLE.width / 2);
    expect(game.puck.y).toBe(TABLE.height / 2);
    expect(Math.hypot(game.puck.vx, game.puck.vy)).toBeGreaterThan(0);

    game.update(STEP, idle);
    expect(game.puck.y).not.toBe(TABLE.height / 2);
  });

  it('leaves idle mallets exactly where they started', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(5));
    const idle = new ScriptedInput();
    const startY = game.mallet('p1').y;

    for (let i = 0; i < SERVE_STEPS; i += 1) game.update(STEP, idle);

    expect(game.mallet('p1').x).toBe(TABLE.width / 2);
    expect(game.mallet('p1').y).toBe(startY);
  });

  it('keeps a bot seat inside its own half and gets it moving', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(2024, null, 'normal'));
    const input = new ScriptedInput();
    input.point('p1', 300, 940);

    const startY = game.mallet('p2').y;
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, input);
      expect(game.mallet('p2').y).toBeLessThanOrEqual(TABLE.height / 2 - MALLET_RADIUS + 1e-9);
      expect(game.mallet('p2').y).toBeGreaterThanOrEqual(MALLET_RADIUS - 1e-9);
    }
    expect(game.mallet('p2').y).not.toBe(startY);
  });

  it('replays identically from the same seed and the same inputs', () => {
    function run(): number[] {
      const game = new AirHockeyGame();
      game.init(makeContext(777, 'hard', 'easy'));
      const input = new ScriptedInput();
      for (let i = 0; i < 2400; i += 1) game.update(STEP, input);
      const score = game.getScore();
      return [
        game.puck.x,
        game.puck.y,
        game.puck.vx,
        game.puck.vy,
        game.mallet('p1').x,
        game.mallet('p1').y,
        game.mallet('p2').x,
        game.mallet('p2').y,
        score.p1,
        score.p2,
      ];
    }
    expect(run()).toEqual(run());
  });

  it('renders without touching simulation state', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(13, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);

    const before = [
      game.puck.x,
      game.puck.y,
      game.puck.vx,
      game.puck.vy,
      game.mallet('p1').x,
      game.mallet('p2').x,
    ];
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    game.render(renderer, 0.5);
    game.render(renderer, 0.999);

    expect(renderer.ops.length).toBeGreaterThan(0);
    expect(renderer.ops[0]).toBe('clear');
    for (const value of renderer.args) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
    expect([
      game.puck.x,
      game.puck.y,
      game.puck.vx,
      game.puck.vy,
      game.mallet('p1').x,
      game.mallet('p2').x,
    ]).toEqual(before);
  });

  it('ignores updates after destroy', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);

    const y = game.puck.y;
    game.destroy();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    expect(game.puck.y).toBe(y);
  });

  it('clears mallet momentum across a pause so resuming is not read as a swing', () => {
    const game = new AirHockeyGame();
    game.init(makeContext(21));
    const input = new ScriptedInput();
    input.point('p1', 100, 600);
    game.update(STEP, input);
    expect(Math.hypot(game.mallet('p1').vx, game.mallet('p1').vy)).toBeGreaterThan(0);

    game.onPause();
    expect(game.mallet('p1').vx).toBe(0);
    expect(game.mallet('p1').vy).toBe(0);
    game.onResume();
    expect(game.mallet('p1').vx).toBe(0);
  });
});
