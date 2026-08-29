import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { KingOfTheYardGame } from './game.js';
import {
  LOOSE_SECONDS,
  PLAYER_RADIUS,
  TARGET_SECONDS,
  WALL,
  YARD_HEIGHT,
  YARD_WIDTH,
} from './rules.js';
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

  idle(seat: SeatId): void {
    const target = this.#of(seat);
    target.move.x = 0;
    target.move.y = 0;
    target.pointer = null;
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

function fixture(game: KingOfTheYardGame): Position {
  return game.position;
}

describe('running', () => {
  it('moves a player with the keys', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    const before = game.position.p1.x;
    input.run('p1', 1, 0);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.position.p1.x).toBeGreaterThan(before);
  });

  it('runs toward a finger', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    const before = game.position.p1.y;
    input.point('p1', game.position.p1.x, YARD_HEIGHT - WALL);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.position.p1.y).toBeGreaterThan(before);
  });

  it('keeps both players inside the walls', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    input.run('p1', -1, -1);
    input.run('p2', 1, 1);
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.p1.x).toBeGreaterThanOrEqual(WALL + PLAYER_RADIUS - 1e-6);
    expect(game.position.p2.x).toBeLessThanOrEqual(YARD_WIDTH - WALL - PLAYER_RADIUS + 1e-6);
  });
});

describe('the match', () => {
  it('reports banked whole seconds as the score', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(11));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    fixture(game).worn.p1 = 3.7;
    expect(game.getScore().p1, 'whole seconds, so the number is readable').toBe(3);
  });

  it('plays a whole bot match to a result', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(13, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 300 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBeGreaterThanOrEqual(TARGET_SECONDS - 1);
  });

  it('stops simulating once decided', () => {
    const game = new KingOfTheYardGame();
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
      const game = new KingOfTheYardGame();
      game.init(makeContext(17, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        game.update(STEP, input);
        if (i % 30 === 0)
          out.push(`${String(Math.round(game.position.p1.x))}${game.position.wearer ?? '-'}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(19, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 120; i += 1) game.update(STEP, input);
    game.init(makeContext(19, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.wearer).toBeNull();
  });

  it('clears on destroy', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(21, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('flashes when the crown changes hands', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    for (let i = 0; i < Math.ceil(LOOSE_SECONDS / STEP) + 2; i += 1) game.update(STEP, input);
    const position = fixture(game);
    position.p1.x = position.crown.x;
    position.p1.y = position.crown.y;
    game.update(STEP, input);
    expect(game.position.wearer).toBe('p1');
    expect(game.flashing, 'a steal is announced, not left to be noticed').toBe(true);
  });
});

describe('the bot', () => {
  it('never moves the human player', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(31, null, 'hard'));
    const input = new ScriptedInput();
    const start = { x: game.position.p1.x, y: game.position.p1.y };
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.p1.x, 'a silent human stands still').toBe(start.x);
    expect(game.position.p1.y).toBe(start.y);
  });

  it('takes the crown from a human who never moves', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(33, null, 'hard'));
    const input = new ScriptedInput();
    let taken = false;
    for (let i = 0; i < 60 * 30 && !taken; i += 1) {
      game.update(STEP, input);
      if (game.position.wearer === 'p2') taken = true;
    }
    expect(taken).toBe(true);
  });
});

describe('rendering', () => {
  it('draws the yard, both players and the crown', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(41));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.base);
    expect(renderer.args, 'the crown has its own colour').toContain('#ffd54a');
  });

  it('rings the wearer, so who has it is a shape and not a number', () => {
    // Who has the crown is the only thing either player needs to know at a glance, and in
    // a chase there is no time to read a number.
    const game = new KingOfTheYardGame();
    game.init(makeContext(43));
    const loose = new RecordingRenderer();
    game.render(loose, 0);
    const before = loose.ops.filter((op) => op === 'strokeCircle').length;

    fixture(game).wearer = 'p1';
    const worn = new RecordingRenderer();
    game.render(worn, 0);
    expect(worn.ops.filter((op) => op === 'strokeCircle').length).toBeGreaterThan(before);
  });

  it('tells the two players apart by shape', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(45));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
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
    expect(p1Circles, 'p1 is a disc').toBeGreaterThan(0);
    expect(p2Rects, 'p2 is a square').toBeGreaterThan(0);
  });

  it('never rotates: one open yard, read the same way by both', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(47));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops.filter((op) => op === 'pushRotation').length).toBe(0);
  });

  it('draws nothing outside the logical play area', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(49, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(-120);
      expect(value).toBeLessThan(manifest.logical.width + 120);
    }
  });

  it('does not mutate the simulation', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(51, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = `${String(game.position.p1.x)}:${game.position.wearer ?? '-'}`;
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0);
    expect(`${String(game.position.p1.x)}:${game.position.wearer ?? '-'}`).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('king-of-the-yard');
    expect(manifest.archetype).toBe('rt-arena');
  });

  it('is fair across input families', () => {
    // rt-arena: docs/input-parity.md rules it fair. Movement is rate-based, with no
    // absolute aiming for a thumb to be better at.
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});
