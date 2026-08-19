import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { PullTheRopeGame } from './game.js';
import { manifest } from './manifest.js';
import { MARKS_TO_WIN, PULL_STRENGTH, STAMINA_MAX, WIN_DISTANCE } from './rules.js';
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

  /**
   * Mirrors InputManager.beginStep: the press edge is true for exactly one step however
   * long the action is held, which is the contract the game reads.
   */
  hold(seat: SeatId, held: boolean): void {
    const target = seat === 'p1' ? this.#p1 : this.#p2;
    target.actionPressed = held && !target.actionHeld;
    target.actionReleased = !held && target.actionHeld;
    target.actionHeld = held;
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
  presentation: Presentation = 'shared-screen',
  localSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
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
  readonly rotations: boolean[] = [];

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
    this.rotations.push(rotated);
    this.#record('pushSeatRotation', rotated);
  }

  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  count(op: string): number {
    let seen = 0;
    for (const entry of this.ops) if (entry === op) seen += 1;
    return seen;
  }

  #record(op: string, ...values: DrawArg[]): void {
    this.ops.push(op);
    for (const value of values) this.args.push(value);
  }
}

/** Runs the game until it is decided or `limit` steps have passed. */
function playUntilDecided(
  game: PullTheRopeGame,
  input: ScriptedInput,
  script: (step: number) => void,
  limit = 8000,
): number {
  let steps = 0;
  while (game.getScore().winner === null && steps < limit) {
    script(steps);
    game.update(STEP, input);
    steps += 1;
  }
  return steps;
}

describe('PullTheRopeGame taps', () => {
  it('drags the marker toward the seat that tapped', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(1));
    const input = new ScriptedInput();

    input.hold('p1', true);
    game.update(STEP, input);
    expect(game.rope.position).toBeGreaterThan(0);
    expect(game.rope.position).toBeLessThanOrEqual(PULL_STRENGTH);
    expect(game.rope.p1Stamina).toBeLessThan(game.rope.p2Stamina);
  });

  it('counts only the pressed edge, so holding the action pulls once', () => {
    const held = new PullTheRopeGame();
    held.init(makeContext(2));
    const heldInput = new ScriptedInput();
    heldInput.hold('p1', true);
    held.update(STEP, heldInput);
    const afterTap = held.rope.position;
    for (let i = 0; i < 59; i += 1) {
      heldInput.hold('p1', true);
      held.update(STEP, heldInput);
    }

    const tapped = new PullTheRopeGame();
    tapped.init(makeContext(2));
    const tappedInput = new ScriptedInput();
    tappedInput.hold('p1', true);
    tapped.update(STEP, tappedInput);
    for (let i = 0; i < 59; i += 1) {
      tappedInput.hold('p1', false);
      tapped.update(STEP, tappedInput);
    }

    expect(held.rope.position).toBe(tapped.rope.position);
    expect(held.rope.position).toBeLessThan(afterTap);
    expect(held.rope.position).toBeGreaterThan(0);
  });

  it('walks the marker up the rope when the taps keep coming', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) {
      input.hold('p1', i % 6 === 0);
      game.update(STEP, input);
    }
    expect(game.rope.position).toBeGreaterThan(120);
    expect(game.getScore().p1).toBeGreaterThanOrEqual(3);
    expect(game.getScore().p2).toBe(0);
  });

  it('lets a paced seat out-pull a masher who never lets the rope breathe', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(4));
    const input = new ScriptedInput();
    for (let i = 0; i < 1800; i += 1) {
      // p1 mashes at twenty taps a second, p2 paces at roughly the sustainable rate.
      input.hold('p1', i % 3 === 0);
      input.hold('p2', i % 18 === 0);
      game.update(STEP, input);
    }
    expect(game.rope.p1Stamina).toBeLessThan(0.05);
    expect(game.rope.p2Stamina).toBeGreaterThan(0.5);
    expect(game.rope.position).toBeLessThan(0);
    expect(game.getScore().p2).toBeGreaterThan(game.getScore().p1);
  });
});

describe('PullTheRopeGame terminal states', () => {
  it('gives p1 the match exactly on the win line', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    const steps = playUntilDecided(game, input, (step) => {
      input.hold('p1', step % 2 === 0);
    });

    expect(game.getScore().winner).toBe('p1');
    expect(game.rope.position).toBe(WIN_DISTANCE);
    expect(game.getScore().p1).toBe(MARKS_TO_WIN);
    expect(game.getScore().p2).toBe(0);
    expect(steps).toBeLessThan(game.roundSteps);
  });

  it('gives p2 the match exactly on the win line', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(12));
    const input = new ScriptedInput();
    playUntilDecided(game, input, (step) => {
      input.hold('p2', step % 2 === 0);
    });

    expect(game.getScore().winner).toBe('p2');
    expect(game.rope.position).toBe(-WIN_DISTANCE);
    expect(game.getScore().p2).toBe(MARKS_TO_WIN);
  });

  it('never declares a winner before the marker reaches a line', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    for (let i = 0; i < 4000; i += 1) {
      input.hold('p1', i % 2 === 0);
      game.update(STEP, input);
      if (game.getScore().winner !== null) {
        expect(Math.abs(game.rope.position)).toBe(WIN_DISTANCE);
        break;
      }
      expect(Math.abs(game.rope.position)).toBeLessThan(WIN_DISTANCE);
    }
    expect(game.getScore().winner).toBe('p1');
  });

  it('stops simulating once the match is decided', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(14));
    const input = new ScriptedInput();
    playUntilDecided(game, input, (step) => {
      input.hold('p1', step % 2 === 0);
    });

    const position = game.rope.position;
    const elapsed = game.elapsedSteps;
    for (let i = 0; i < 300; i += 1) {
      input.hold('p1', i % 2 === 0);
      game.update(STEP, input);
    }

    expect(game.rope.position).toBe(position);
    expect(game.elapsedSteps).toBe(elapsed);
    expect(game.getScore().winner).toBe('p1');
  });

  it('settles on the marks held when the round clock expires', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(15));
    const input = new ScriptedInput();
    const steps = playUntilDecided(game, input, (step) => {
      // One tap a second: enough to hold ground, never enough to reach the line.
      input.hold('p1', step % 60 === 0);
    });

    expect(steps).toBe(game.roundSteps);
    expect(game.getScore().winner).toBe('p1');
    expect(game.getScore().p1).toBeGreaterThanOrEqual(3);
    expect(game.getScore().p1).toBeLessThan(MARKS_TO_WIN);
    expect(game.getScore().p2).toBe(0);
  });

  it('calls a rope neither seat ever moved a draw', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(16));
    const input = new ScriptedInput();
    const steps = playUntilDecided(game, input, () => {});

    expect(steps).toBe(game.roundSteps);
    expect(game.getScore().winner).toBe('draw');
    expect(game.getScore().p1).toBe(0);
    expect(game.getScore().p2).toBe(0);
    expect(game.rope.position).toBe(0);
  });
});

describe('PullTheRopeGame bots', () => {
  it('lets a bot seat pull the rope out on its own', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(21, null, 'normal'));
    const input = new ScriptedInput();
    playUntilDecided(game, input, () => {});

    expect(game.getScore().winner).toBe('p2');
    expect(game.getScore().p2).toBe(MARKS_TO_WIN);
    expect(game.rope.position).toBe(-WIN_DISTANCE);
  });

  it('gives the harder tier the ground over the easier one', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(22, 'easy', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 3000; i += 1) game.update(STEP, input);

    expect(game.rope.position).toBeLessThan(0);
  });

  it('leaves a bot no way to pull harder than a player', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(23, 'hard', null));
    const input = new ScriptedInput();
    let biggest = 0;
    let previous = 0;
    for (let i = 0; i < 1200; i += 1) {
      game.update(STEP, input);
      const gained = game.rope.position - previous;
      if (gained > biggest) biggest = gained;
      previous = game.rope.position;
    }
    expect(biggest).toBeLessThanOrEqual(PULL_STRENGTH);
  });
});

describe('PullTheRopeGame lifecycle', () => {
  it('replays identically from the same seed and the same input trace', () => {
    interface Snapshot {
      position: number;
      p1Stamina: number;
      p2Stamina: number;
      p1: number;
      p2: number;
      winner: SeatId | 'draw' | null;
      elapsed: number;
    }

    function run(seed: number): Snapshot {
      const game = new PullTheRopeGame();
      game.init(makeContext(seed, null, 'hard'));
      const input = new ScriptedInput();
      for (let i = 0; i < 1800; i += 1) {
        input.hold('p1', i % 9 < 2);
        game.update(STEP, input);
      }
      const score = game.getScore();
      return {
        position: game.rope.position,
        p1Stamina: game.rope.p1Stamina,
        p2Stamina: game.rope.p2Stamina,
        p1: score.p1,
        p2: score.p2,
        winner: score.winner,
        elapsed: game.elapsedSteps,
      };
    }

    expect(run(777)).toEqual(run(777));
    expect(run(777)).not.toEqual(run(778));
  });

  it('renders without touching simulation state', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(31, null, 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 400; i += 1) {
      input.hold('p1', i % 7 === 0);
      game.update(STEP, input);
    }

    const before = [game.rope.position, game.rope.p1Stamina, game.rope.p2Stamina];
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    game.render(renderer, 0.5);
    game.render(renderer, 0.999);

    expect(renderer.ops.length).toBeGreaterThan(0);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.count('pushSeatRotation')).toBe(renderer.count('popSeatRotation'));
    for (const value of renderer.args) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
    expect([game.rope.position, game.rope.p1Stamina, game.rope.p2Stamina]).toEqual(before);
  });

  it('draws a full board before the first update', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(32));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);

    expect(renderer.rotations).toEqual([false]);
    for (const value of renderer.args) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('turns the board round for a lone p2, and never for a shared screen', () => {
    const lone = new PullTheRopeGame();
    lone.init(makeContext(33, null, null, 'single-seat', 'p2'));
    const loneRenderer = new RecordingRenderer();
    lone.render(loneRenderer, 0);
    expect(loneRenderer.rotations).toEqual([true]);

    const shared = new PullTheRopeGame();
    shared.init(makeContext(33, null, null, 'shared-screen', 'p2'));
    const sharedRenderer = new RecordingRenderer();
    shared.render(sharedRenderer, 0);
    expect(sharedRenderer.rotations).toEqual([false]);
  });

  it('carries the state across a pause and keeps playing after it', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(34));
    const input = new ScriptedInput();
    for (let i = 0; i < 120; i += 1) {
      input.hold('p1', i % 10 === 0);
      game.update(STEP, input);
    }

    const position = game.rope.position;
    game.onPause();
    game.onResume();
    expect(game.rope.position).toBe(position);

    input.hold('p1', true);
    game.update(STEP, input);
    expect(game.rope.position).toBeGreaterThan(position);
  });

  it('ignores updates after destroy', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(35));
    const input = new ScriptedInput();
    for (let i = 0; i < 200; i += 1) {
      input.hold('p1', i % 5 === 0);
      game.update(STEP, input);
    }

    const position = game.rope.position;
    game.destroy();
    for (let i = 0; i < 200; i += 1) {
      input.hold('p1', i % 2 === 0);
      game.update(STEP, input);
    }
    expect(game.rope.position).toBe(position);
  });

  it('starts a fresh match from a re-init', () => {
    const game = new PullTheRopeGame();
    game.init(makeContext(36));
    const input = new ScriptedInput();
    playUntilDecided(game, input, (step) => {
      input.hold('p1', step % 2 === 0);
    });
    expect(game.getScore().winner).toBe('p1');

    game.init(makeContext(36));
    expect(game.getScore().winner).toBeNull();
    expect(game.getScore().p1).toBe(0);
    expect(game.rope.position).toBe(0);
    expect(game.rope.p1Stamina).toBe(STAMINA_MAX);
    expect(game.elapsedSteps).toBe(0);
  });
});
