import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { HappyHipposGame } from './game.js';
import {
  BALL_RADIUS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CHOMP_CYCLE_SECONDS,
  HIPPO_MAX_X,
  HIPPO_MIN_X,
  HIPPO_SPEED,
  MATCH_SECONDS,
  POND_BOTTOM,
  TARGET_POINTS,
  hippoOf,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
type Presentation = 'shared-screen' | 'single-seat';

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

  /** Direction keys, as the engine reports them: components in [-1, 1]. */
  steer(seat: SeatId, x: number): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.move.x = x;
  }

  /** A finger going down, which the engine reports as a press as well as a position. */
  press(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = true;
    target.actionHeld = true;
  }

  /** A finger already down, sliding. No press edge. */
  drag(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = false;
    target.actionHeld = true;
  }

  /** The action key, with no pointer anywhere. */
  tapKey(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = true;
    target.actionHeld = true;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.move.x = 0;
    target.actionPressed = false;
    target.actionHeld = false;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

/* ------------------------------------------------------------------- recording */

type DrawArg = string | number | boolean | undefined;

interface Call {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

class RecordingRenderer implements Renderer {
  readonly calls: Call[] = [];

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

  /** Every call with the colour arguments dropped: the picture a greyscale player sees. */
  shapesOnly(): string[] {
    return this.calls.map(
      (call) =>
        `${call.op}(${call.args
          .filter((arg) => typeof arg !== 'string' || !/^(#|rgba?\()/.test(arg))
          .map((arg) => (typeof arg === 'number' ? arg.toFixed(2) : String(arg)))
          .join(',')})`,
    );
  }

  #record(op: string, ...args: DrawArg[]): void {
    this.calls.push({ op, args });
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
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
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

/** Everything the simulation holds, flattened, so a change anywhere shows up. */
function snapshot(game: HappyHipposGame): string {
  const state = game.state;
  return JSON.stringify({
    p1: state.p1,
    p2: state.p2,
    clock: state.clock,
    winner: state.winner,
    hippos: [state.p1Hippo, state.p2Hippo],
    balls: state.balls,
  });
}

describe('the contract', () => {
  it('never claims to have turns, because both hippos snap at once', () => {
    const game = new HappyHipposGame();
    // `rt-*` archetypes must not implement it at all — the shell reads its presence and its
    // value to decide whether to hand the whole board and both key halves to one seat.
    expect((game as { getActiveSeat?: unknown }).getActiveSeat).toBeUndefined();
  });

  it('reports a score of the shape the shell expects', () => {
    const game = new HappyHipposGame();
    game.init(makeContext(1));
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
    game.destroy();
  });

  it('does nothing at all before init and after destroy', () => {
    const game = new HappyHipposGame();
    const input = new ScriptedInput();
    input.tapKey('p1');
    // Before init: the shell may drive a game it has not started, and it must be inert.
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.state.clock).toBe(0);

    game.init(makeContext(2, 'hard', 'hard'));
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);
    expect(game.state.clock).toBeGreaterThan(0);

    game.destroy();
    expect(game.state.clock).toBe(0);
    expect(game.state.p1).toBe(0);
    expect(game.state.p2).toBe(0);
    const after = snapshot(game);
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    expect(snapshot(game)).toBe(after);
  });

  it('reads the opening seat rather than assuming seat one', () => {
    // Both hippos act from step zero, so there is no opener in the sense a turn game has one.
    // What the field decides here is which slot parity is whose colour — the one place the
    // game is not already symmetric, because replacements are drawn in slot order. A game that
    // ignored it would deal the identical pond whichever seat the SDK nominated.
    const trace = (openingSeat: SeatId): string => {
      const game = new HappyHipposGame();
      game.init(makeContext(31, 'normal', 'normal', 'shared-screen', 'p1', openingSeat));
      const input = new ScriptedInput();
      for (let i = 0; i < 600; i += 1) game.update(STEP, input);
      const result = snapshot(game);
      game.destroy();
      return result;
    };
    expect(trace('p1')).not.toBe(trace('p2'));
  });

  it('plays the identical match twice from the same seed', () => {
    const trace = (): string[] => {
      const game = new HappyHipposGame();
      game.init(makeContext(99, 'normal', 'easy'));
      const input = new ScriptedInput();
      const seen: string[] = [];
      for (let i = 0; i < 900; i += 1) {
        game.update(STEP, input);
        seen.push(snapshot(game));
      }
      game.destroy();
      return seen;
    };
    expect(trace()).toEqual(trace());
  });
});

describe('rendering', () => {
  it('changes nothing, at any alpha', () => {
    const game = new HappyHipposGame();
    game.init(makeContext(3, 'hard', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 150; i += 1) game.update(STEP, input);

    const before = snapshot(game);
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.render(renderer, 0);
      game.render(renderer, 0.5);
      game.render(renderer, 0.99);
    }
    expect(snapshot(game)).toBe(before);
    expect(renderer.calls.length).toBeGreaterThan(0);
    game.destroy();
  });

  it('interpolates between the last two steps, which is what alpha is for', () => {
    // The mouth crosses the pond at 36 units a step, so a display running above the simulation
    // rate strobes it visibly without this — and the mouth is the object a player watches.
    const game = new HappyHipposGame();
    game.init(makeContext(4, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 90; i += 1) game.update(STEP, input);

    const at = (alpha: number): string[] => {
      const renderer = new RecordingRenderer();
      game.render(renderer, alpha);
      return renderer.shapesOnly();
    };
    expect(at(0.75)).not.toEqual(at(0));
    // At alpha 1 the picture is the state as it stands; the loop contracts alpha to below 1,
    // so this is the limit rather than a frame anybody sees.
    const ball = game.state.balls.find((b) => b.live);
    expect(ball).toBeDefined();
    const drawn = at(1).filter((call) => call.startsWith('circle(') || call.startsWith('rect('));
    expect(drawn.some((call) => call.includes(ball!.x.toFixed(2)))).toBe(true);
    game.destroy();
  });

  it('draws a ball rolling back in where it is, never streaked across the pond', () => {
    // An eaten ball reappears on a side wall, which is not motion. Interpolating that would
    // draw it sliding the width of the pond in a sixtieth of a second.
    const game = new HappyHipposGame();
    game.init(makeContext(21, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, input);
      const arriving = game.state.balls.filter((b) => !b.live);
      if (arriving.length === 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0.5);
      for (const ball of arriving) {
        const near = renderer.calls.filter(
          (call) =>
            (call.op === 'strokeCircle' || call.op === 'strokeRect') &&
            typeof call.args[0] === 'number' &&
            Math.abs(call.args[0] - ball.x) < BALL_RADIUS * 2,
        );
        expect(near.length).toBeGreaterThan(0);
      }
      game.destroy();
      return;
    }
    throw new Error('no ball was ever out of play, so this test checked nothing');
  });

  it('keeps every drawn point inside the declared logical box', () => {
    const game = new HappyHipposGame();
    game.init(makeContext(5, 'easy', 'hard'));
    const input = new ScriptedInput();
    const renderer = new RecordingRenderer();
    // A generous margin: a stroke and a glyph box legitimately overhang a little. What this
    // catches is a game drawing in a box other than the one its manifest declares.
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) + 120;
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, input);
      if (i % 7 === 0) game.render(renderer, 0);
    }
    for (const call of renderer.calls) {
      for (const arg of call.args) {
        if (typeof arg !== 'number') continue;
        expect(Math.abs(arg), `${call.op} drew at ${String(arg)}`).toBeLessThanOrEqual(limit);
      }
    }
    expect(renderer.calls.length).toBeGreaterThan(100);
    game.destroy();
  });

  it('draws no text at all until somebody has taken a chomp', () => {
    const game = new HappyHipposGame();
    game.init(makeContext(6));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.calls.filter((call) => call.op === 'text')).toHaveLength(0);
    game.destroy();
  });

  it('turns one seat’s tally to face it, and only in shared-screen play', () => {
    const run = (presentation: Presentation): boolean[] => {
      const game = new HappyHipposGame();
      game.init(makeContext(7, 'hard', 'hard', presentation));
      const input = new ScriptedInput();
      const rotations: boolean[] = [];
      const renderer = new RecordingRenderer();
      for (let i = 0; i < 400; i += 1) game.update(STEP, input);
      game.render(renderer, 0);
      for (const call of renderer.calls) {
        if (call.op === 'pushSeatRotation') rotations.push(call.args[0] === true);
      }
      game.destroy();
      return rotations;
    };
    // Two seats, so two push/pop pairs a frame whatever the presentation.
    expect(run('shared-screen')).toEqual([false, true]);
    expect(run('single-seat')).toEqual([false, false]);
  });
});

/**
 * Rule 7, and here it is the game rather than a finish on it: the entire scoring rule is "two
 * for your kind, minus one for theirs", so a player who cannot separate the two kinds cannot
 * play at all.
 */
describe('the board read without colour', () => {
  it('draws seat one’s balls round and seat two’s square, at their own positions', () => {
    const game = new HappyHipposGame();
    game.init(makeContext(8));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);

    const circles = renderer.calls.filter(
      (call) => call.op === 'circle' && call.args[2] === BALL_RADIUS,
    );
    const balls = game.state.balls.filter((ball) => ball.live);
    const p1Balls = balls.filter((ball) => ball.seat === 'p1');
    const p2Balls = balls.filter((ball) => ball.seat === 'p2');
    expect(p1Balls.length).toBeGreaterThan(0);
    expect(p2Balls.length).toBeGreaterThan(0);

    // Every one of seat one's balls is a disc of exactly the ball radius, and none of seat
    // two's is: the two are told apart by outline, with nothing but shape to go on.
    for (const ball of p1Balls) {
      expect(circles.some((c) => c.args[0] === ball.x && c.args[1] === ball.y)).toBe(true);
    }
    for (const ball of p2Balls) {
      expect(circles.some((c) => c.args[0] === ball.x && c.args[1] === ball.y)).toBe(false);
      // …and is a square of equal area centred on the same point.
      const half = BALL_RADIUS * (Math.sqrt(Math.PI) / 2);
      expect(
        renderer.calls.some(
          (call) =>
            call.op === 'rect' &&
            call.args[0] === ball.x - half &&
            call.args[1] === ball.y - half &&
            call.args[2] === half * 2,
        ),
      ).toBe(true);
    }
    game.destroy();
  });

  it('is still two different pictures once every colour is thrown away', () => {
    // The real question rule 7 asks: with the palette gone, is what seat one owns still
    // distinguishable from what seat two owns? Both hippos are drawn in the same frame, so a
    // renderer that leaned on colour would produce two identical shape sequences.
    const game = new HappyHipposGame();
    game.init(makeContext(9));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const shapes = renderer.shapesOnly();
    const discs = shapes.filter((call) => call.startsWith('circle(')).length;
    const boxes = shapes.filter((call) => call.startsWith('rect(')).length;
    expect(discs).toBeGreaterThan(3);
    expect(boxes).toBeGreaterThan(3);
    game.destroy();
  });

  it('gives seat one only round glyphs and seat two only square ones', () => {
    // The catalogue's rule-7 harness attributes each drawn shape to a seat by its colour and
    // then asks whether the two seats' *shapes* differ. This is the same question asked here,
    // where a failure points at a line rather than at a slug: every shape drawn in seat one's
    // palette must be round, and every shape drawn in seat two's must be square.
    const game = new HappyHipposGame();
    game.init(makeContext(22, 'normal', 'normal'));
    const input = new ScriptedInput();
    const round = new Set<string>();
    const square = new Set<string>();
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, input);
      if (i % 11 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      for (const call of renderer.calls) {
        if (call.op === 'line' || call.op === 'text') continue;
        const colour = call.args[call.args.length - 1];
        if (typeof colour !== 'string') continue;
        if (colour === SEAT_PALETTE.p1.base || colour === SEAT_PALETTE.p1.deep) round.add(call.op);
        if (colour === SEAT_PALETTE.p2.base || colour === SEAT_PALETTE.p2.deep) square.add(call.op);
      }
    }
    expect([...round].sort()).toEqual(['circle', 'strokeCircle']);
    expect([...square].sort()).toEqual(['rect', 'strokeRect']);
    game.destroy();
  });

  it('marks a ball that is not in play by its fill, not by its colour', () => {
    const game = new HappyHipposGame();
    game.init(makeContext(10, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, input);
      const arriving = game.state.balls.filter((ball) => !ball.live);
      if (arriving.length === 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      for (const ball of arriving) {
        // Outline only: no filled shape anywhere near a ball that cannot be eaten.
        const filled = renderer.calls.filter(
          (call) =>
            (call.op === 'circle' || call.op === 'rect') &&
            typeof call.args[0] === 'number' &&
            typeof call.args[1] === 'number' &&
            Math.abs(call.args[0] - ball.x) < BALL_RADIUS &&
            Math.abs(call.args[1] - ball.y) < BALL_RADIUS,
        );
        expect(filled).toHaveLength(0);
      }
      game.destroy();
      return;
    }
    throw new Error('no ball was ever out of play, so this test checked nothing');
  });
});

describe('the controls', () => {
  it('walks a hippo with the keys, at the speed the rules allow and no faster', () => {
    const game = new HappyHipposGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    const start = hippoOf(game.state, 'p1').x;
    input.steer('p1', 1);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(hippoOf(game.state, 'p1').x).toBeCloseTo(start + HIPPO_SPEED * STEP * 30, 6);
    game.destroy();
  });

  it('follows a finger without letting it teleport the hippo', () => {
    const game = new HappyHipposGame();
    game.init(makeContext(12));
    const input = new ScriptedInput();
    const start = hippoOf(game.state, 'p1').x;
    input.press('p1', HIPPO_MAX_X, POND_BOTTOM + 40);
    game.update(STEP, input);
    expect(hippoOf(game.state, 'p1').x).toBeCloseTo(start + HIPPO_SPEED * STEP, 6);
    expect(hippoOf(game.state, 'p1').targetX).toBe(HIPPO_MAX_X);
    game.destroy();
  });

  it('reads a finger in board space for both seats, with no mirror', () => {
    // The pond is one shared board drawn in one orientation, so a finger is already over the
    // water it is pointing at whichever side of the device its owner sits on. Mirroring here
    // would send the far seat's hippo the wrong way, which is the bug this pins down.
    const game = new HappyHipposGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    // Dragged, not tapped: a finger held down is a steer, and a fresh press every step would
    // keep both hippos mid-chomp and unable to walk anywhere at all.
    input.drag('p1', HIPPO_MIN_X, POND_BOTTOM + 40);
    input.drag('p2', HIPPO_MIN_X, 60);
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    expect(hippoOf(game.state, 'p1').x).toBeCloseTo(HIPPO_MIN_X, 6);
    expect(hippoOf(game.state, 'p2').x).toBeCloseTo(HIPPO_MIN_X, 6);
    game.destroy();
  });

  it('mirrors the far seat’s keys, and only when that seat is reading upside down', () => {
    const walk = (presentation: Presentation): number => {
      const game = new HappyHipposGame();
      game.init(makeContext(14, null, null, presentation));
      const input = new ScriptedInput();
      const start = hippoOf(game.state, 'p2').x;
      input.steer('p2', 1);
      for (let i = 0; i < 20; i += 1) game.update(STEP, input);
      const moved = hippoOf(game.state, 'p2').x - start;
      game.destroy();
      return moved;
    };
    // Seat two sits opposite, so its "right" is the board's left — but only on a shared screen.
    expect(walk('shared-screen')).toBeLessThan(0);
    expect(walk('single-seat')).toBeGreaterThan(0);
  });

  it('takes a chomp on the press and not again until the finger is lifted', () => {
    const game = new HappyHipposGame();
    game.init(makeContext(15));
    const input = new ScriptedInput();
    input.press('p1', 300, POND_BOTTOM + 40);
    game.update(STEP, input);
    expect(hippoOf(game.state, 'p1').chomping).toBe(true);

    // Held down for far longer than a whole cycle: still one chomp, because the engine gives
    // a press edge and this game reads the edge.
    input.drag('p1', 300, POND_BOTTOM + 40);
    let starts = 0;
    let wasChomping = true;
    for (let i = 0; i < 300; i += 1) {
      game.update(STEP, input);
      const now = hippoOf(game.state, 'p1').chomping;
      if (now && !wasChomping) starts += 1;
      wasChomping = now;
    }
    expect(starts).toBe(0);
    game.destroy();
  });

  it('answers a key and a thumb with the same chomp', () => {
    const rhythm = (useKey: boolean): number => {
      const game = new HappyHipposGame();
      game.init(makeContext(16));
      const input = new ScriptedInput();
      let chomps = 0;
      let wasChomping = false;
      const period = Math.round(CHOMP_CYCLE_SECONDS / STEP) + 2;
      for (let i = 0; i < 600; i += 1) {
        if (i % period === 0) {
          if (useKey) input.tapKey('p1');
          else input.press('p1', 300, POND_BOTTOM + 40);
        } else {
          input.release('p1');
        }
        game.update(STEP, input);
        const now = hippoOf(game.state, 'p1').chomping;
        if (now && !wasChomping) chomps += 1;
        wasChomping = now;
      }
      game.destroy();
      return chomps;
    };
    expect(rhythm(true)).toBe(rhythm(false));
    expect(rhythm(true)).toBeGreaterThan(5);
  });
});

describe('the two presentations are one game', () => {
  it('steps the identical match on a shared phone and on two of them', () => {
    // Rule: only placement, rotation and control mapping may differ. Driven through the
    // pointer, which is absolute in both, the simulation must not diverge by a bit.
    const trace = (presentation: Presentation, localSeat: SeatId): string[] => {
      const game = new HappyHipposGame();
      game.init(makeContext(17, null, 'normal', presentation, localSeat));
      const input = new ScriptedInput();
      const seen: string[] = [];
      for (let i = 0; i < 900; i += 1) {
        const x = HIPPO_MIN_X + ((i * 37) % (HIPPO_MAX_X - HIPPO_MIN_X));
        if (i % 50 === 0) input.press('p1', x, POND_BOTTOM + 40);
        else input.drag('p1', x, POND_BOTTOM + 40);
        game.update(STEP, input);
        seen.push(snapshot(game));
      }
      game.destroy();
      return seen;
    };
    expect(trace('single-seat', 'p1')).toEqual(trace('shared-screen', 'p1'));
  });
});

describe('the bots are wired through', () => {
  it('plays a different match at each tier', () => {
    const trace = (tier: BotDifficulty): string => {
      const game = new HappyHipposGame();
      game.init(makeContext(18, tier, tier));
      const input = new ScriptedInput();
      for (let i = 0; i < 600; i += 1) game.update(STEP, input);
      const result = snapshot(game);
      game.destroy();
      return result;
    };
    expect(trace('easy')).not.toBe(trace('normal'));
    expect(trace('normal')).not.toBe(trace('hard'));
  });

  it('finishes a match, and two seats that never touch the screen finish one too', () => {
    const game = new HappyHipposGame();
    game.init(makeContext(19, 'easy', 'easy'));
    const input = new ScriptedInput();
    let steps = 0;
    while (game.getScore().winner === null) {
      game.update(STEP, input);
      steps += 1;
      expect(steps).toBeLessThan(60 * 600);
    }
    expect(Math.max(game.getScore().p1, game.getScore().p2)).toBeGreaterThanOrEqual(TARGET_POINTS);
    game.destroy();

    const idle = new HappyHipposGame();
    idle.init(makeContext(20));
    let idleSteps = 0;
    while (idle.getScore().winner === null) {
      idle.update(STEP, input);
      idleSteps += 1;
      expect(idleSteps).toBeLessThan(60 * 600);
    }
    expect(idle.getScore().winner).toBe('draw');
    expect(idle.state.clock).toBeGreaterThanOrEqual(MATCH_SECONDS);
    idle.destroy();
  });
});
