import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { MiniSoccerGame } from './game.js';
import {
  BALL_RADIUS,
  MATCH_SECONDS,
  PITCH_HEIGHT,
  PITCH_WIDTH,
  PLAYER_RADIUS,
  WALL,
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

  run(seat: SeatId, x: number, y: number): void {
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

/** Runs the kick-off pause out. */
function goLive(game: MiniSoccerGame, input: ScriptedInput): void {
  for (let i = 0; i < 200 && game.position.phase !== 'playing'; i += 1) game.update(STEP, input);
}

describe('running', () => {
  it('moves a player with the keys', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    goLive(game, input);
    const before = game.position.p1.x;
    input.run('p1', 1, 0);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.position.p1.x).toBeGreaterThan(before);
  });

  it('runs toward a finger', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    goLive(game, input);
    const before = game.position.p1.y;
    input.point('p1', game.position.p1.x, PITCH_HEIGHT - WALL);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.position.p1.y).toBeGreaterThan(before);
  });

  it('keeps both players on the pitch', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    goLive(game, input);
    input.run('p1', -1, -1);
    input.run('p2', 1, 1);
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.p1.x).toBeGreaterThanOrEqual(WALL + PLAYER_RADIUS - 1e-6);
    expect(game.position.p2.y).toBeLessThanOrEqual(PITCH_HEIGHT - WALL - PLAYER_RADIUS + 1e-6);
  });
});

describe('the match', () => {
  it('starts goalless with a full clock', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(11));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.clock).toBe(MATCH_SECONDS);
  });

  it('plays a whole bot match to the whistle', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(13, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 300 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
    expect(game.position.clock).toBe(0);
  });

  it('stops simulating once the whistle has gone', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(15, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 300 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = `${String(game.getScore().p1)}:${String(game.getScore().p2)}`;
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new MiniSoccerGame();
      game.init(makeContext(17, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        game.update(STEP, input);
        if (i % 30 === 0) out.push(String(Math.round(game.position.ball.x)));
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(19, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 120; i += 1) game.update(STEP, input);
    game.init(makeContext(19, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.clock).toBe(MATCH_SECONDS);
  });

  it('clears on destroy', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(21, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });
});

describe('the bot', () => {
  it('never moves the human player', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(31, null, 'hard'));
    const input = new ScriptedInput();
    goLive(game, input);
    const start = { x: game.position.p1.x, y: game.position.p1.y };
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.p1.x, 'a silent human stands still').toBe(start.x);
    expect(game.position.p1.y).toBe(start.y);
  });

  it('scores against a human who never moves', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(33, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200 && game.getScore().p2 === 0; i += 1) game.update(STEP, input);
    expect(game.getScore().p2, 'an unopposed bot finds the goal').toBeGreaterThan(0);
  });
});

describe('rendering', () => {
  it('draws the pitch, both players, the ball and both goals', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(41));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.base);
    expect(renderer.args, 'the ball has its own colour').toContain('#f7f9f4');
  });

  it('paints each goal in the colour of the seat defending it', () => {
    // Which way you are shooting is the thing a new player gets wrong first.
    const game = new MiniSoccerGame();
    game.init(makeContext(43));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.args).toContain(SEAT_PALETTE.p1.deep);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.deep);
  });

  it('shows the clock, because the whistle decides the match', () => {
    // The shell shows the score; nobody shows the time, and a player who cannot see how
    // long is left cannot decide whether to attack or hold.
    const game = new MiniSoccerGame();
    game.init(makeContext(45));
    const input = new ScriptedInput();
    goLive(game, input);
    const widthOfClock = (): number => {
      const renderer = new RecordingRenderer();
      game.render(renderer);
      let widest = 0;
      for (const call of renderer.calls) {
        if (call.op !== 'rect') continue;
        const [, y, w, , colour] = call.args;
        // The bar sits above the touchline; the unfilled track is drawn in ink beneath it.
        if (typeof y !== 'number' || typeof w !== 'number' || y >= WALL) continue;
        if (colour === '#0a150d') continue;
        widest = Math.max(widest, w);
      }
      return widest;
    };
    const full = widthOfClock();
    for (let i = 0; i < 60 * 20; i += 1) game.update(STEP, input);
    expect(widthOfClock(), 'the clock is visibly shorter').toBeLessThan(full);
  });

  it('tells the two players apart with the colour removed', () => {
    // Rule 7. p1 is a disc, p2 a square; a greyscale reader has to have something other
    // than the palette to go on, and these two are the only bodies that move.
    const game = new MiniSoccerGame();
    game.init(makeContext(46));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const p1 = game.position.p1;
    const p2 = game.position.p2;
    const discAtP1 = renderer.calls.some(
      (call) =>
        call.op === 'circle' &&
        call.args[0] === p1.x &&
        call.args[1] === p1.y &&
        call.args[2] === PLAYER_RADIUS,
    );
    const squareAtP2 = renderer.calls.some(
      (call) =>
        call.op === 'rect' &&
        call.args[0] === p2.x - PLAYER_RADIUS &&
        call.args[2] === PLAYER_RADIUS * 2 &&
        call.args[3] === PLAYER_RADIUS * 2,
    );
    expect(discAtP1, 'p1 is drawn as a disc').toBe(true);
    expect(squareAtP2, 'p2 is drawn as a square').toBe(true);
  });

  it('never rotates: one pitch, read the same way by both', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(47));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops.filter((op) => op === 'pushRotation').length).toBe(0);
  });

  it('draws nothing outside the logical play area', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(49, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(-120);
      expect(value).toBeLessThan(PITCH_WIDTH + 120);
    }
  });

  it('does not mutate the simulation', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(51, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = `${String(game.position.ball.x)}:${String(game.position.clock)}`;
    game.render(new RecordingRenderer());
    game.render(new RecordingRenderer());
    expect(`${String(game.position.ball.x)}:${String(game.position.clock)}`).toBe(before);
  });

  it('keeps the ball drawn inside the pitch', () => {
    const game = new MiniSoccerGame();
    game.init(makeContext(53, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, input);
      expect(game.position.ball.y).toBeGreaterThanOrEqual(-BALL_RADIUS);
      expect(game.position.ball.y).toBeLessThanOrEqual(PITCH_HEIGHT + BALL_RADIUS);
    }
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('mini-soccer');
    expect(manifest.archetype).toBe('rt-split');
  });

  it('is fair across input families', () => {
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});
