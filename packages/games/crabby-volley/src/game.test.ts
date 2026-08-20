import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { CrabbyVolleyGame } from './game.js';
import { COURT_WIDTH, FLOOR_Y, NET_X, TARGET_POINTS, halfOf } from './rules.js';
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

  steer(seat: SeatId, x: number): void {
    this.#of(seat).move.x = x;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  press(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionPressed = true;
    target.actionHeld = true;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionPressed = false;
    target.actionHeld = false;
    target.actionReleased = true;
  }

  idle(seat: SeatId): void {
    const target = this.#of(seat);
    target.move.x = 0;
    target.pointer = null;
    target.actionPressed = false;
    target.actionHeld = false;
    target.actionReleased = false;
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

describe('the controls', () => {
  it('walks a crab along its own half', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    const before = game.position.p1.x;
    input.steer('p1', 1);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.position.p1.x).toBeGreaterThan(before);
  });

  it('never lets a crab past the net, however long a key is held', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    input.steer('p1', 1);
    input.steer('p2', -1);
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.p1.x).toBeLessThan(NET_X);
    expect(game.position.p2.x).toBeGreaterThan(NET_X);
  });

  it('walks toward a finger on your own half', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    const half = halfOf('p1');
    input.point('p1', half.min, FLOOR_Y);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.position.p1.x, 'it walked left toward the finger').toBeLessThan(
      (half.min + half.max) / 2,
    );
  });

  it('will not let a finger drag a crab across the net', () => {
    // Pointing at the far side walks the crab to its own edge and stops. The rule lives in
    // `steer` alone — a second copy in the game module was redundant, which a mutation of
    // it failing no test is exactly how I noticed.
    const game = new CrabbyVolleyGame();
    game.init(makeContext(9));
    const input = new ScriptedInput();
    input.point('p1', COURT_WIDTH - 10, FLOOR_Y);
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.p1.x).toBeLessThanOrEqual(halfOf('p1').max + 1e-6);
  });

  it('jumps once per press, not once per step', () => {
    // A held button pumping the crab up the screen would make jumping the whole game.
    const game = new CrabbyVolleyGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    input.press('p1');
    game.update(STEP, input);
    const rising = game.position.p1.vy;
    expect(rising).toBeLessThan(0);

    // Held for a while: it must come back down rather than climbing.
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    expect(game.position.p1.y, 'back on the sand').toBe(FLOOR_Y);
  });

  it('does not jump for a button still held across a pause', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    input.press('p1');
    game.onPause();
    game.onResume();
    game.update(STEP, input);
    expect(game.position.p1.vy, 'the still-down button did nothing').toBe(0);

    input.release('p1');
    game.update(STEP, input);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.p1.vy, 'and a genuine press still jumps').toBeLessThan(0);
  });
});

describe('the match', () => {
  it('starts level with no winner', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(21));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('plays a whole bot match to a result', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(23, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const score = game.getScore();
    expect(score.winner, 'somebody reaches the target').not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBe(TARGET_POINTS);
  });

  it('stops simulating once decided', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(25, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = `${String(game.getScore().p1)}:${String(game.getScore().p2)}`;
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new CrabbyVolleyGame();
      game.init(makeContext(27, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 90; i += 1) {
        game.update(STEP, input);
        if (i % 30 === 0) {
          out.push(
            `${String(Math.round(game.position.ball.x))},${String(Math.round(game.position.ball.y))}`,
          );
        }
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(29, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 120; i += 1) game.update(STEP, input);
    game.init(makeContext(29, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('clears on destroy', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(31, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('keeps the ball inside the court, always', () => {
    // The one thing a physics game must never do is lose its ball.
    const game = new CrabbyVolleyGame();
    game.init(makeContext(33, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
      const ball = game.position.ball;
      expect(Number.isFinite(ball.x) && Number.isFinite(ball.y), `step ${String(i)}`).toBe(true);
      expect(ball.x).toBeGreaterThanOrEqual(0);
      expect(ball.x).toBeLessThanOrEqual(COURT_WIDTH);
      expect(ball.y).toBeGreaterThanOrEqual(0);
      expect(ball.y).toBeLessThanOrEqual(manifest.logical.height);
    }
  });
});

describe('the bot', () => {
  it('never moves the human crab', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(41, null, 'hard'));
    const input = new ScriptedInput();
    const start = game.position.p1.x;
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.p1.x, 'a silent human stands still').toBe(start);
  });

  it('moves its own crab', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(43, null, 'hard'));
    const input = new ScriptedInput();
    const start = game.position.p2.x;
    let moved = false;
    for (let i = 0; i < 600 && !moved; i += 1) {
      game.update(STEP, input);
      if (game.position.p2.x !== start) moved = true;
    }
    expect(moved).toBe(true);
  });
});

describe('rendering', () => {
  it('draws the court, the net, both crabs and the ball', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(51));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.base);
    expect(renderer.args, 'the ball has its own colour').toContain('#ffd23f');
  });

  it('never rotates: a side-by-side court reads the same way for both players', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(53));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops.filter((op) => op === 'pushRotation').length).toBe(0);
    expect(renderer.ops.filter((op) => op === 'pushSeatRotation').length).toBe(0);
  });

  it('tells the two crabs apart by shape', () => {
    // In a fast game with two shapes bouncing about, the silhouette is what a player
    // actually tracks — rule 7 is doing real work here.
    const game = new CrabbyVolleyGame();
    game.init(makeContext(55));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    let cursor = 0;
    let p1Circles = 0;
    let p2Rects = 0;
    for (const op of renderer.ops) {
      if (op === 'circle' && renderer.args[cursor + 3] === SEAT_PALETTE.p1.base) p1Circles += 1;
      if (op === 'rect' && renderer.args[cursor + 4] === SEAT_PALETTE.p2.base) p2Rects += 1;
      cursor +=
        op === 'clear'
          ? 1
          : op === 'circle'
            ? 4
            : op === 'strokeCircle'
              ? 5
              : op === 'rect'
                ? 5
                : op === 'strokeRect'
                  ? 6
                  : op === 'line'
                    ? 6
                    : op === 'text'
                      ? 6
                      : 1;
    }
    expect(p1Circles, 'p1 is round').toBeGreaterThan(0);
    expect(p2Rects, 'p2 is squared off').toBeGreaterThan(0);
  });

  it('draws nothing outside the logical play area', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(57, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(-150);
      expect(value).toBeLessThan(manifest.logical.width + 150);
    }
  });

  it('does not mutate the simulation', () => {
    const game = new CrabbyVolleyGame();
    game.init(makeContext(59, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = `${String(game.position.ball.x)}:${String(game.position.p1.x)}`;
    game.render(new RecordingRenderer());
    game.render(new RecordingRenderer());
    expect(`${String(game.position.ball.x)}:${String(game.position.p1.x)}`).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('crabby-volley');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.zoneSplit, 'two halves side by side').toBe('vertical');
  });

  it('is fair across input families', () => {
    // rt-split: docs/input-parity.md rules it fair cross-device. Moving is rate-based
    // rather than absolute, and jumping is one button.
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});
