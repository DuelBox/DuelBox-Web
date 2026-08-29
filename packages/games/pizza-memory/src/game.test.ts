import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { PizzaMemoryGame } from './game.js';
import {
  BELL_STATION,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  HAND_SPEED,
  KIND_COUNT,
  MATCH_SECONDS,
  PHASE_BUILD,
  PHASE_WATCH,
  STATION_COUNT,
  TARGET_SERVED,
  counterOf,
  railX,
  watchSeconds,
} from './rules.js';
import type { BotDifficulty, Counter } from './rules.js';

const STEP = 1 / 60;

/* --------------------------------------------------------------- scripted input */

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

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  /** Direction keys, as the engine reports them: components in [-1, 1]. */
  steer(seat: SeatId, x: number): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.move.x = x;
  }

  /** A finger down at a point in board space. */
  touch(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.move.x = 0;
    target.pointer ??= vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionHeld = true;
  }

  lift(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionHeld = false;
    target.actionReleased = true;
  }

  press(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionPressed = true;
    target.actionHeld = true;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionHeld = false;
    target.actionReleased = true;
  }

  /** The engine clears its edges every step; so does this. */
  endStep(): void {
    for (const target of [this.#p1, this.#p2]) {
      target.actionPressed = false;
      target.actionReleased = false;
    }
  }
}

/* ------------------------------------------------------------ recording renderer */

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
}

class RecordingRenderer implements Renderer {
  readonly calls: Call[] = [];

  clear(colour: string): void {
    this.calls.push({ op: 'clear', args: [colour] });
  }
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.calls.push({ op: 'rect', args: [x, y, width, height, colour] });
  }
  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.calls.push({ op: 'strokeRect', args: [x, y, width, height, lineWidth, colour] });
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.calls.push({ op: 'circle', args: [x, y, radius, colour] });
  }
  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.calls.push({ op: 'strokeCircle', args: [x, y, radius, lineWidth, colour] });
  }
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.calls.push({ op: 'line', args: [x1, y1, x2, y2, lineWidth, colour] });
  }
  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.calls.push({ op: 'text', args: [value, x, y, sizePx, colour, align] });
  }
  pushSeatRotation(rotated: boolean): void {
    this.calls.push({ op: 'pushSeatRotation', args: [rotated] });
  }
  pushRotation(radians: number): void {
    this.calls.push({ op: 'pushRotation', args: [radians] });
  }
  popSeatRotation(): void {
    this.calls.push({ op: 'popSeatRotation', args: [] });
  }
}

/** Every string either seat's own material may be drawn in. */
const SEAT_OF_COLOUR: ReadonlyMap<string, SeatId> = new Map(
  (['p1', 'p2'] as const).flatMap((seat): [string, SeatId][] => {
    const palette = SEAT_PALETTE[seat];
    return [palette.base, palette.deep, palette.tint, palette.soft].map((colour) => [colour, seat]);
  }),
);

/** The y coordinates a draw call touches, top and bottom of whatever it paints. */
function yValuesOf(call: Call): number[] {
  const [, b, c, d, e] = call.args as (number | string)[];
  switch (call.op) {
    case 'rect':
    case 'strokeRect':
      return typeof b === 'number' && typeof d === 'number' ? [b, b + d] : [];
    case 'circle':
      return typeof b === 'number' && typeof c === 'number' ? [b - c, b + c] : [];
    case 'strokeCircle':
      return typeof b === 'number' && typeof c === 'number' && typeof d === 'number'
        ? [b - c - d / 2, b + c + d / 2]
        : [];
    case 'line':
      return typeof b === 'number' && typeof d === 'number' && typeof e === 'number'
        ? [b - e / 2, b + e / 2, d - e / 2, d + e / 2]
        : [];
    default:
      return [];
  }
}

function digest(renderer: RecordingRenderer): string {
  return renderer.calls.map((call) => `${call.op}(${call.args.join(',')})`).join('|');
}

/* ------------------------------------------------------------------- contexts */

function makeContext(
  seed: number,
  p1: BotDifficulty | null = null,
  p2: BotDifficulty | null = null,
  presentation: Presentation = 'shared-screen',
  localSeat: SeatId = 'p1',
  openingSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    openingSeat,
    botDifficulty: (seat: SeatId) => (seat === 'p1' ? p1 : p2),
  };
}

function snapshot(counter: Readonly<Counter>): string {
  return [
    counter.ticket,
    counter.phase,
    counter.phaseSeconds.toFixed(9),
    [...counter.order].join(''),
    [...counter.placed].join(''),
    counter.placedCount,
    counter.hand.toFixed(9),
    counter.served,
    counter.spoiled,
  ].join('|');
}

/** Run a game until both counters are past their opening reveal. */
function pastReveal(game: PizzaMemoryGame, input: InputState): void {
  const steps = Math.ceil(watchSeconds(game.state.p1Counter.length) * 60) + 2;
  for (let i = 0; i < steps; i += 1) game.update(STEP, input);
}

/* ------------------------------------------------------------------- the contract */

describe('the contract', () => {
  it('never claims to have turns, because both cooks work at once', () => {
    const game = new PizzaMemoryGame();
    // `rt-*` games must not answer this at all: the shell reads its presence to decide
    // whether to hand the whole board and both key halves to one seat.
    expect((game as { getActiveSeat?: unknown }).getActiveSeat).toBeUndefined();
    expect(manifest.archetype).toBe('rt-split');
  });

  it('reports a score of the shape the shell expects', () => {
    const game = new PizzaMemoryGame();
    game.init(makeContext(1, 'hard', 'hard'));
    for (let i = 0; i < 60 * 200; i += 1) {
      game.update(STEP, new ScriptedInput());
      if (game.getScore().winner !== null) break;
    }
    const score = game.getScore();
    expect(Number.isInteger(score.p1)).toBe(true);
    expect(Number.isInteger(score.p2)).toBe(true);
    expect(score.p1).toBeGreaterThanOrEqual(0);
    expect(['p1', 'p2', 'draw']).toContain(score.winner);
    game.destroy();
  });

  it('does nothing at all before init and after destroy', () => {
    const game = new PizzaMemoryGame();
    const input = new ScriptedInput();
    const before = snapshot(game.state.p1Counter);
    for (let i = 0; i < 100; i += 1) game.update(STEP, input);
    expect(snapshot(game.state.p1Counter)).toBe(before);

    game.init(makeContext(2, 'hard', 'hard'));
    for (let i = 0; i < 300; i += 1) game.update(STEP, input);
    game.destroy();
    const after = snapshot(game.state.p1Counter);
    expect(game.state.p1).toBe(0);
    expect(game.state.winner).toBeNull();
    for (let i = 0; i < 100; i += 1) game.update(STEP, input);
    expect(snapshot(game.state.p1Counter)).toBe(after);
  });

  it('plays the identical match twice from the same seed', () => {
    const run = (): string => {
      const game = new PizzaMemoryGame();
      game.init(makeContext(9, 'normal', 'easy'));
      const input = new ScriptedInput();
      for (let i = 0; i < 60 * 200; i += 1) {
        game.update(STEP, input);
        if (game.getScore().winner !== null) break;
      }
      const out = `${snapshot(game.state.p1Counter)}#${snapshot(game.state.p2Counter)}`;
      game.destroy();
      return out;
    };
    expect(run()).toBe(run());
  });

  it('advertises a round length that is only advertising, and a clock that is not', () => {
    // `roundSeconds` ends nothing anywhere in this repository. The clock in rules.ts does.
    expect(manifest.roundSeconds).toBeGreaterThanOrEqual(MATCH_SECONDS);
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
    expect(manifest.modes).not.toContain('solo');
  });
});

/* ------------------------------------------------------------------- rendering */

describe('rendering', () => {
  it('changes nothing, at any alpha', () => {
    const game = new PizzaMemoryGame();
    game.init(makeContext(3, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);
    const before = `${snapshot(game.state.p1Counter)}#${snapshot(game.state.p2Counter)}`;
    const renderer = new RecordingRenderer();
    for (const alpha of [0, 0.25, 0.5, 0.99]) game.render(renderer, alpha);
    expect(`${snapshot(game.state.p1Counter)}#${snapshot(game.state.p2Counter)}`).toBe(before);
    expect(renderer.calls.length).toBeGreaterThan(80);
    game.destroy();
  });

  it('interpolates the hand between the last two steps, which is what alpha is for', () => {
    const game = new PizzaMemoryGame();
    game.init(makeContext(4));
    const input = new ScriptedInput();
    input.touch('p1', railX('p1', BELL_STATION), 930);
    for (let i = 0; i < 6; i += 1) game.update(STEP, input);
    const at = (alpha: number): string => {
      const renderer = new RecordingRenderer();
      game.render(renderer, alpha);
      return digest(renderer);
    };
    expect(at(0)).not.toBe(at(0.9));
    game.destroy();
  });

  it('keeps every drawn point inside the declared logical box', () => {
    const game = new PizzaMemoryGame();
    game.init(makeContext(5, 'easy', 'hard'));
    const input = new ScriptedInput();
    const renderer = new RecordingRenderer();
    // A generous margin: a stroke legitimately overhangs a little. What this catches is a
    // game drawing in a box other than the one its manifest declares.
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) + 120;
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, input);
      if (i % 7 === 0) game.render(renderer, 0);
    }
    for (const call of renderer.calls) {
      for (const arg of call.args) {
        if (typeof arg !== 'number') continue;
        expect(Math.abs(arg), `${call.op} drew at ${String(arg)}`).toBeLessThanOrEqual(limit);
      }
    }
    expect(renderer.calls.length).toBeGreaterThan(300);
    game.destroy();
  });

  it('draws no text at all, ever', () => {
    // Nothing on this counter has to be read, in any language. Rule 7's strongest form.
    const game = new PizzaMemoryGame();
    game.init(makeContext(6, 'easy', 'easy'));
    const input = new ScriptedInput();
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 60 * 200; i += 1) {
      game.update(STEP, input);
      if (i % 5 === 0) game.render(renderer, 0);
      if (game.getScore().winner !== null) break;
    }
    game.render(renderer, 0);
    expect(renderer.calls.filter((call) => call.op === 'text')).toHaveLength(0);
    game.destroy();
  });

  it('never rotates the board, because neither counter is ever read upside down', () => {
    const game = new PizzaMemoryGame();
    game.init(makeContext(7, 'hard', 'hard'));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.calls.filter((call) => call.op.includes('Rotation'))).toHaveLength(0);
    game.destroy();
  });
});

/* ------------------------------------------------------------------- controls */

describe('the controls', () => {
  it('walks the hand with a key at the speed the rules allow and no faster', () => {
    const game = new PizzaMemoryGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    input.steer('p1', 1);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.state.p1Counter.hand).toBeCloseTo(HAND_SPEED * 30 * STEP, 6);
    game.destroy();
  });

  it('follows a finger without letting it teleport the hand', () => {
    const game = new PizzaMemoryGame();
    game.init(makeContext(12));
    const input = new ScriptedInput();
    input.touch('p1', railX('p1', BELL_STATION), 930);
    game.update(STEP, input);
    expect(game.state.p1Counter.hand).toBeCloseTo(HAND_SPEED * STEP, 9);
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.state.p1Counter.hand).toBe(BELL_STATION);
    game.destroy();
  });

  it('reads a finger against each seat’s own rail', () => {
    for (const seat of ['p1', 'p2'] as const) {
      for (let station = 0; station < STATION_COUNT; station += 1) {
        const game = new PizzaMemoryGame();
        game.init(makeContext(13));
        const input = new ScriptedInput();
        input.touch(seat, railX(seat, station), seat === 'p1' ? 930 : 70);
        for (let i = 0; i < 120; i += 1) game.update(STEP, input);
        expect(counterOf(game.state, seat).hand).toBe(station);
        game.destroy();
      }
    }
  });

  it('mirrors the far seat’s keys, and only when that seat reads the board upside down', () => {
    const drift = (presentation: Presentation, localSeat: SeatId): number => {
      const game = new PizzaMemoryGame();
      game.init(makeContext(14, null, null, presentation, localSeat));
      const input = new ScriptedInput();
      // Park the hand in the middle of the rail first, so it can move either way.
      input.touch('p2', railX('p2', 3), 70);
      for (let i = 0; i < 120; i += 1) game.update(STEP, input);
      const from = game.state.p2Counter.hand;
      input.steer('p2', 1);
      for (let i = 0; i < 20; i += 1) game.update(STEP, input);
      const moved = game.state.p2Counter.hand - from;
      game.destroy();
      return moved;
    };
    // Seat two is reading the device upside down, so its "right" is the board's left — and
    // its own rail runs the other way across the board, so the two cancel: pressing right
    // walks the hand up the rail, exactly as it does for seat one.
    expect(drift('shared-screen', 'p1')).toBeGreaterThan(0);
    // On its own device seat two reads the board the right way up, and the mapping is the
    // same in both presentations for whichever seat is local — which is what the parity
    // harness checks and what this pins.
    expect(drift('shared-screen', 'p2')).toBeLessThan(0);
    expect(drift('single-seat', 'p2')).toBe(drift('shared-screen', 'p2'));
  });

  it('places on the release and not on the press, for a key and for a finger alike', () => {
    for (const family of ['key', 'finger'] as const) {
      const game = new PizzaMemoryGame();
      game.init(makeContext(15));
      const input = new ScriptedInput();
      pastReveal(game, input);
      expect(game.state.p1Counter.phase).toBe(PHASE_BUILD);

      if (family === 'key') input.press('p1');
      else input.touch('p1', railX('p1', 0), 930);
      game.update(STEP, input);
      input.endStep();
      expect(game.state.p1Counter.placedCount, `${family} placed on the press`).toBe(0);

      if (family === 'key') input.release('p1');
      else input.lift('p1');
      game.update(STEP, input);
      input.endStep();
      expect(game.state.p1Counter.placedCount, `${family} did not place on the release`).toBe(1);
      game.destroy();
    }
  });

  it('answers a key and a thumb with the same pizza', () => {
    // Rule 10 in this game's own terms: the same order, built with the two instruments,
    // must produce the same counter.
    const build = (family: 'key' | 'finger'): string => {
      const game = new PizzaMemoryGame();
      game.init(makeContext(16));
      const input = new ScriptedInput();
      const wanted = [...game.state.p1Counter.order].slice(0, game.state.p1Counter.length);
      pastReveal(game, input);
      for (const kind of [...wanted, BELL_STATION]) {
        if (family === 'finger') {
          input.touch('p1', railX('p1', kind), 930);
          for (let i = 0; i < 90; i += 1) game.update(STEP, input);
          input.lift('p1');
        } else {
          const target = kind;
          for (let i = 0; i < 200; i += 1) {
            const hand = game.state.p1Counter.hand;
            if (Math.abs(hand - target) < 1e-9) break;
            input.steer('p1', hand < target ? 1 : -1);
            game.update(STEP, input);
            input.endStep();
          }
          input.steer('p1', 0);
          input.press('p1');
          game.update(STEP, input);
          input.endStep();
          input.release('p1');
        }
        game.update(STEP, input);
        input.endStep();
      }
      const out = `${game.state.p1Counter.served}:${game.state.p1Counter.spoiled}`;
      game.destroy();
      return out;
    };
    expect(build('key')).toBe('1:0');
    expect(build('finger')).toBe('1:0');
  });

  it('ignores a finger while the order is still on the pizza', () => {
    const game = new PizzaMemoryGame();
    game.init(makeContext(17));
    const input = new ScriptedInput();
    expect(game.state.p1Counter.phase).toBe(PHASE_WATCH);
    input.touch('p1', railX('p1', 2), 930);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    input.lift('p1');
    game.update(STEP, input);
    expect(game.state.p1Counter.placedCount).toBe(0);
    // The hand did move, though: pre-positioning during the reveal is deliberate skill.
    expect(game.state.p1Counter.hand).toBeGreaterThan(0);
    game.destroy();
  });
});

/* --------------------------------------------------------- the two presentations */

describe('the two presentations are one game', () => {
  it('steps the identical match on a shared phone and on two of them', () => {
    const run = (presentation: Presentation): string => {
      const game = new PizzaMemoryGame();
      game.init(makeContext(21, null, 'normal', presentation, 'p1'));
      const input = new ScriptedInput();
      const script = new Rng(4242);
      for (let i = 0; i < 60 * 90; i += 1) {
        if (i % 11 === 0) input.steer('p1', script.int(-1, 2));
        if (i % 17 === 0) input.press('p1');
        if (i % 17 === 6) input.release('p1');
        game.update(STEP, input);
        input.endStep();
        if (game.getScore().winner !== null) break;
      }
      const out = `${snapshot(game.state.p1Counter)}#${snapshot(game.state.p2Counter)}`;
      game.destroy();
      return out;
    };
    expect(run('single-seat')).toBe(run('shared-screen'));
  });
});

/* ------------------------------------------------------------------- the bots */

describe('the bots are wired through', () => {
  it('plays a different match at each tier', () => {
    const play = (tier: BotDifficulty): number => {
      const game = new PizzaMemoryGame();
      game.init(makeContext(31, tier, tier));
      const input = new ScriptedInput();
      for (let i = 0; i < 60 * 200; i += 1) {
        game.update(STEP, input);
        if (game.getScore().winner !== null) break;
      }
      const served = game.state.p1Counter.served + game.state.p2Counter.served;
      game.destroy();
      return served;
    };
    expect(play('easy')).toBeLessThan(play('hard'));
  });

  it('finishes a match, and two seats that never touch the screen finish one too', () => {
    for (const [p1, p2] of [
      ['easy', 'easy'],
      [null, null],
      ['hard', null],
    ] as const) {
      const game = new PizzaMemoryGame();
      game.init(makeContext(32, p1, p2));
      const input = new ScriptedInput();
      let steps = 0;
      for (; steps < 60 * 600; steps += 1) {
        game.update(STEP, input);
        if (game.getScore().winner !== null) break;
      }
      expect(game.getScore().winner, `${String(p1)} v ${String(p2)}`).not.toBeNull();
      expect(steps).toBeLessThanOrEqual(MATCH_SECONDS * 60 + 4);
      game.destroy();
    }
  });

  it('hands the bot streams out by role, so a seed and its opposite opening are mirrors', () => {
    // The whole of this game's seat-balance argument, at the level the shell actually runs.
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      let p1Wins = 0;
      let decided = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const results = (['p1', 'p2'] as const).map((opener) => {
          const game = new PizzaMemoryGame();
          game.init(makeContext(seed * 7919, tier, tier, 'shared-screen', 'p1', opener));
          const input = new ScriptedInput();
          for (let i = 0; i < 60 * 200; i += 1) {
            game.update(STEP, input);
            if (game.getScore().winner !== null) break;
          }
          const out = {
            winner: game.getScore().winner,
            p1: snapshot(game.state.p1Counter),
            p2: snapshot(game.state.p2Counter),
          };
          game.destroy();
          return out;
        });
        const [forward, back] = results;
        expect(back!.p1).toBe(forward!.p2);
        expect(back!.p2).toBe(forward!.p1);
        for (const winner of [forward!.winner, back!.winner]) {
          if (winner === 'p1') {
            p1Wins += 1;
            decided += 1;
          } else if (winner === 'p2') decided += 1;
        }
      }
      expect(decided).toBeGreaterThan(50);
      expect(p1Wins / decided, `${tier} seat-one share`).toBe(0.5);
    }
  });

  it('reaches the target rather than always running the clock out', () => {
    let byTarget = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const game = new PizzaMemoryGame();
      game.init(makeContext(seed * 13, 'hard', 'hard'));
      const input = new ScriptedInput();
      for (let i = 0; i < 60 * 200; i += 1) {
        game.update(STEP, input);
        if (game.getScore().winner !== null) break;
      }
      const score = game.getScore();
      if (Math.max(score.p1, score.p2) >= TARGET_SERVED) byTarget += 1;
      game.destroy();
    }
    expect(byTarget, 'the target is unreachable, so it is decoration').toBeGreaterThan(10);
  });

  it('never puts a topping on the rail that does not exist', () => {
    const game = new PizzaMemoryGame();
    game.init(makeContext(33, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200; i += 1) {
      game.update(STEP, input);
      for (const seat of ['p1', 'p2'] as const) {
        const counter = counterOf(game.state, seat);
        for (let slot = 0; slot < counter.placedCount; slot += 1) {
          const kind = counter.placed[slot] ?? -1;
          expect(kind).toBeGreaterThanOrEqual(0);
          expect(kind).toBeLessThan(KIND_COUNT);
        }
      }
      if (game.getScore().winner !== null) break;
    }
    game.destroy();
  });

  it('keeps each seat’s own material inside that seat’s own half of the board', () => {
    // Rule 9 in this game's terms: neither cook can see more of their own counter than the
    // other, and neither one's material strays across the line into the other's zone.
    const game = new PizzaMemoryGame();
    game.init(makeContext(34, 'hard', 'easy'));
    const input = new ScriptedInput();
    const owned = { p1: 0, p2: 0 };
    for (let frame = 0; frame < 200; frame += 1) {
      for (let i = 0; i < 6; i += 1) game.update(STEP, input);
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      for (const call of renderer.calls) {
        const colour = call.args.find((arg) => typeof arg === 'string');
        const seat = SEAT_OF_COLOUR.get(String(colour));
        if (seat === undefined) continue;
        owned[seat] += 1;
        for (const y of yValuesOf(call)) {
          if (seat === 'p1')
            expect(y, `${call.op} at ${String(y)}`).toBeGreaterThan(BOARD_HEIGHT / 2);
          else expect(y, `${call.op} at ${String(y)}`).toBeLessThan(BOARD_HEIGHT / 2);
        }
      }
      if (game.getScore().winner !== null) break;
    }
    expect(owned.p1).toBeGreaterThan(100);
    expect(owned.p2).toBeGreaterThan(100);
    game.destroy();
  });

  it('costs the two counters the identical number of marks on an identical ticket', () => {
    // The two counters are one counter and its half-turn image, so on the opening ticket —
    // which both seats are dealt alike — neither is drawn with more ink than the other.
    const game = new PizzaMemoryGame();
    game.init(makeContext(35, 'hard', 'hard'));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const owned = { p1: 0, p2: 0 };
    for (const call of renderer.calls) {
      const seat = SEAT_OF_COLOUR.get(String(call.args.find((arg) => typeof arg === 'string')));
      if (seat !== undefined) owned[seat] += 1;
    }
    expect(owned.p1).toBeGreaterThan(10);
    expect(owned.p2).toBe(owned.p1);
    game.destroy();
  });
});
