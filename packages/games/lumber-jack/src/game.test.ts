import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext, Renderer } from '@duelbox/game-sdk';
import { LumberjackGame } from './game.js';
import { manifest } from './manifest.js';
import {
  LEFT,
  RIGHT,
  ROUND_SECONDS,
  SWING_SLOW,
  TARGET_LOGS,
  YARD_HEIGHT,
  YARD_WIDTH,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
/** A point well inside a seat's own half, so the pointer is unambiguously theirs. */
const NEAR_Y = YARD_HEIGHT - 140;
const FAR_Y = 140;

function context(overrides: Partial<GameContext> = {}): GameContext {
  return {
    manifest,
    rng: new Rng(20260823),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: () => null,
    ...overrides,
  };
}

function inputs(): { manager: InputManager; view: InputView } {
  return {
    manager: new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function run(game: LumberjackGame, manager: InputManager, view: InputView, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** A renderer that answers every call and remembers every number it was given. */
function recorder(drawn: number[]): Renderer {
  const record = (...args: unknown[]): void => {
    for (const arg of args) if (typeof arg === 'number') drawn.push(arg);
  };
  const noop = (): void => undefined;
  return {
    clear: noop,
    rect: record,
    strokeRect: record,
    circle: record,
    strokeCircle: record,
    line: record,
    text: record,
    pushSeatRotation: noop,
    pushRotation: noop,
    popSeatRotation: noop,
  };
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(YARD_WIDTH);
    expect(manifest.logical.height).toBe(YARD_HEIGHT);
  });

  it('splits the screen the way two trees stand, one above the other', () => {
    // A vertical split would put the two yards side by side, and neither seat would have
    // a full-width tree with room to stand either side of it.
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.orientation).toBe('portrait');
  });

  it('claims to be fair across input families, and the cadence is why', () => {
    expect(manifest.sameInputClassOnly).toBe(false);
  });

  it('tells each seat which half of the keyboard is theirs', () => {
    // `controls.test.ts` in the shell enforces this across every game; asserted here too
    // so a change to the wording fails where the wording lives.
    expect(manifest.controls.keyboard).toMatch(/a and d/i);
    expect(manifest.controls.keyboard).toMatch(/arrow/i);
    expect(manifest.controls.keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
  });
});

describe('a fresh match', () => {
  it('starts level, with nobody having won', () => {
    const game = new LumberjackGame();
    game.init(context());
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new LumberjackGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });

  it('does not fell a log before the first swing has had time to land', () => {
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyD');
    run(game, manager, view, Math.floor((SWING_SLOW / STEP) * 0.5));
    expect(game.getScore().p1).toBe(0);
    game.destroy();
  });

  it('is level again after a second init', () => {
    // The shell reuses one instance across a rematch, so anything left behind here would
    // start the next match part-felled.
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    run(game, manager, view, 600);
    expect(game.getScore().p1 + game.getScore().p2).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'hard' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.elapsed).toBe(0);
    game.destroy();
  });

  it('leaves nothing behind when it is destroyed', () => {
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    run(game, manager, view, 600);
    game.destroy();
    expect(game.match.p1.cut).toBe(0);
    expect(game.match.p2.cut).toBe(0);
    expect(game.match.elapsed).toBe(0);
    expect(game.getScore().winner).toBeNull();
  });
});

describe('a person swinging an axe', () => {
  it('chops the side of their own tree that they touched', () => {
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, 60, NEAR_Y);
    run(game, manager, view, 60);
    expect(game.match.p1.side).toBe(LEFT);
    expect(game.match.p1.cut).toBeGreaterThan(0);
    game.destroy();
  });

  it('reads the far seat from the far seat, so their left is the device right', () => {
    // Two people at opposite ends of one device. The far seat's yard is the near seat's
    // turned half a turn, so reaching for the branch on *their* left is a touch on the
    // side of the glass nearest their own right hand.
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, YARD_WIDTH - 60, FAR_Y);
    run(game, manager, view, 60);
    expect(game.match.p2.side).toBe(LEFT);
    game.destroy();
  });

  it('cannot reach into the other seat’s yard', () => {
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context());
    const before = game.match.p2.side;
    manager.pointerDown(0, 60, NEAR_Y);
    run(game, manager, view, 120);
    expect(game.match.p2.side).toBe(before);
    expect(game.match.p2.cut).toBe(0);
    game.destroy();
  });

  it('gives each seat its own half of the keyboard, un-mirrored', () => {
    // The whole keyboard path, and the reason it needs no mirror: `A` is seat one's left
    // and the left arrow is seat two's left whichever way up either of them is sitting.
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyA');
    manager.keyDown('ArrowLeft');
    run(game, manager, view, 60);
    expect(game.match.p1.side).toBe(LEFT);
    expect(game.match.p2.side).toBe(LEFT);
    game.destroy();
  });

  it('keeps a tap that lands mid-swing, and spends it exactly once', () => {
    // Without the latch a player has to press at the instant the cooldown ends, and the
    // game becomes one about timing a press rather than choosing a side.
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyD');
    run(game, manager, view, 1);
    manager.keyUp('KeyD');
    run(game, manager, view, 300);
    expect(game.match.p1.cut).toBe(1);
    game.destroy();
  });

  it('chops no faster for being mashed than for being held', () => {
    // Input parity in one assertion. A keyboard repeats faster than a thumb can leave the
    // glass; the cadence is what stops that deciding the match.
    const logsFrom = (drive: (manager: InputManager, step: number) => void): number => {
      const game = new LumberjackGame();
      const { manager, view } = inputs();
      game.init(context());
      for (let i = 0; i < 600; i += 1) {
        drive(manager, i);
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const cut = game.match.p1.cut;
      game.destroy();
      return cut;
    };

    const held = logsFrom((manager, step) => {
      if (step === 0) manager.keyDown('KeyD');
    });
    const mashed = logsFrom((manager, step) => {
      if (step % 4 === 0) manager.keyDown('KeyD');
      if (step % 4 === 2) manager.keyUp('KeyD');
    });
    expect(held).toBeGreaterThan(5);
    expect(mashed).toBe(held);
  });

  it('does not swing on the first step back from a pause', () => {
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyD');
    run(game, manager, view, 1);
    manager.keyUp('KeyD');
    game.onPause();
    manager.clear();
    game.onResume();
    run(game, manager, view, 300);
    expect(game.match.p1.cut).toBe(0);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision with two bots playing, at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new LumberjackGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      const limit = 60 * (ROUND_SECONDS + 5);
      for (; steps < limit && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const score = game.getScore();
      expect(score.winner, `${tier} never finished`).not.toBeNull();
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(TARGET_LOGS);
      game.destroy();
    }
  });

  it('stops simulating once it is decided', () => {
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 60 * (ROUND_SECONDS + 5) && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    const settled = game.getScore();
    run(game, manager, view, 300);
    expect(game.getScore()).toEqual(settled);
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // Rule 8 in one assertion: single-seat and shared-screen are two layouts of one
    // simulation, so nothing in this game may branch on which the shell chose — and
    // nothing does, because the yard is symmetric under the half turn between the seats.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new LumberjackGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
      const seen: number[] = [];
      for (let i = 0; i < 1800; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) seen.push(game.match.p1.cut, game.match.p2.cut, game.match.p1.cooldown);
      }
      game.destroy();
      return seen.map((n) => n.toFixed(9)).join(',');
    };
    expect(trace('single-seat', 'p2')).toBe(trace('shared-screen', 'p1'));
  });

  it('replays a fixed pointer trace to the identical score', () => {
    const play = (): string => {
      const game = new LumberjackGame();
      const { manager, view } = inputs();
      game.init(context());
      const script = new Rng(31337);
      for (let i = 0; i < 2400; i += 1) {
        if (i % 9 === 0) {
          manager.pointerDown(0, script.float() * YARD_WIDTH, NEAR_Y);
          manager.pointerDown(1, script.float() * YARD_WIDTH, FAR_Y);
        }
        if (i % 9 === 4) {
          manager.pointerUp(0);
          manager.pointerUp(1);
        }
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const score = game.getScore();
      game.destroy();
      return `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}`;
    };
    expect(play()).toBe(play());
  });
});

describe('rendering', () => {
  it('draws every shape inside the declared box, at every stage of a match', () => {
    const drawn: number[] = [];
    const renderer = recorder(drawn);
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 40; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 7 === 0) game.render(renderer, 0);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    // Generous, as the shared harness is: what this catches is a game drawing in a box
    // unrelated to the one it declared, not a stroke overhanging by a few units.
    const limit = Math.max(YARD_WIDTH, YARD_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('keeps every shape a seat owns inside that seat’s own half', () => {
    // Rule 9: neither player may ever see more of the play area than the other, and the
    // two halves are that promise made concrete. A tree drawn across the divider would be
    // standing in the other player's reading space — which is exactly what happens if the
    // falling-tree lift ever exceeds the headroom left above the stack.
    //
    // Checked on rectangles, where the extent is unambiguous, over a whole match so the
    // check meets a stunned seat, a full tally bar and a tree mid-drop.
    const rects: number[][] = [];
    const noop = (): void => undefined;
    const renderer: Renderer = {
      clear: noop,
      rect: (x, y, width, height) => rects.push([x, y, width, height]),
      strokeRect: noop,
      circle: noop,
      strokeCircle: noop,
      line: noop,
      text: noop,
      pushSeatRotation: noop,
      pushRotation: noop,
      popSeatRotation: noop,
    };

    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    const middle = YARD_HEIGHT / 2;
    let checked = 0;
    for (let i = 0; i < 1800; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 !== 0) continue;
      rects.length = 0;
      game.render(renderer, 0);
      for (const [x, y, width, height] of rects as [number, number, number, number][]) {
        // The divider is the one shape that belongs to neither seat and straddles both.
        if (width === YARD_WIDTH && height <= 6) continue;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + width).toBeLessThanOrEqual(YARD_WIDTH);
        expect(
          y >= middle || y + height <= middle,
          `a ${String(width)}x${String(height)} rect at y=${String(y)} crosses the divider`,
        ).toBe(true);
        checked += 1;
      }
    }
    game.destroy();
    expect(checked).toBeGreaterThan(500);
  });

  it('does not move the simulation on', () => {
    const drawn: number[] = [];
    const renderer = recorder(drawn);
    const game = new LumberjackGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    run(game, manager, view, 200);
    const before = { ...game.match.p1 };
    // The interpolation alpha the contract passes is deliberately not read: nothing here
    // is drawn between two simulation states, so a frame is the state as it stands.
    for (let i = 0; i < 50; i += 1) game.render(renderer, 0);
    expect(game.match.p1).toEqual(before);
    game.destroy();
  });

  it('draws both seats, and draws them differently', () => {
    // Rule 7 has to be visible in the calls: two identical seats would produce the same
    // shapes twice, and the only difference would be the colour string.
    const shapes: string[] = [];
    const note =
      (kind: string) =>
      (...args: unknown[]): void => {
        shapes.push(`${kind}:${args.map((a) => (typeof a === 'string' ? a : '')).join('')}`);
      };
    const renderer: Renderer = {
      clear: () => undefined,
      rect: note('rect'),
      strokeRect: note('strokeRect'),
      circle: note('circle'),
      strokeCircle: note('strokeCircle'),
      line: note('line'),
      text: note('text'),
      pushSeatRotation: () => undefined,
      pushRotation: () => undefined,
      popSeatRotation: () => undefined,
    };
    const game = new LumberjackGame();
    game.init(context());
    game.render(renderer, 0);
    game.destroy();
    // The near seat's head is a disc with a disc inside it; the far seat's is a square
    // inside a square. Two circles on the board, and both of them belong to seat one.
    expect(shapes.filter((shape) => shape.startsWith('circle')).length).toBe(2);
  });
});

describe('the layout', () => {
  it('gives each seat exactly half the box', () => {
    expect(YARD_HEIGHT % 2).toBe(0);
    expect(RIGHT).toBe(-LEFT);
  });
});
