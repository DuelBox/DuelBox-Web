import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { FrogsFightGame } from './game.js';
import { manifest } from './manifest.js';
import { PAD_X, POND, P1_HOME, P2_HOME, TARGET_POINTS, mirrorPad } from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

function context(overrides: Partial<GameContext> = {}): GameContext {
  return {
    manifest,
    rng: new Rng(20260823),
    presentation: 'shared-screen',
    localSeat: 'p1',
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

function drive(game: FrogsFightGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(POND);
    expect(manifest.logical.height).toBe(POND);
  });

  it('is a square pond, which is what makes the board its own reflection', () => {
    expect(manifest.logical.width).toBe(manifest.logical.height);
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.archetype).toBe('rt-arena');
  });

  it('gives each seat its own half of the keyboard, and says so', () => {
    expect(manifest.controls.keyboard).toMatch(/W A S D/);
    expect(manifest.controls.keyboard).toMatch(/player one/);
    expect(manifest.controls.keyboard).toMatch(/player two/);
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new FrogsFightGame();
    // Asked before init as well, because that is when the shell first asks it.
    expect(game.getActiveSeat()).toBeNull();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });
});

describe('a person hopping', () => {
  it('hops the way they pull, from anywhere in their own half', () => {
    const game = new FrogsFightGame();
    const { manager, view } = inputs();
    game.init(context());
    // A drag rightwards, started deep in p1's own half and nowhere near the frog.
    manager.pointerDown(0, 120, POND - 60);
    drive(game, view, manager, 1);
    manager.pointerMove(0, 360, POND - 60);
    drive(game, view, manager, 60);
    expect(game.position.p1.pad).not.toBe(P1_HOME);
    expect(PAD_X[game.position.p1.pad]!).toBeGreaterThan(PAD_X[P1_HOME]!);
    game.destroy();
  });

  it('cannot reach into the other half', () => {
    const game = new FrogsFightGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, 120, POND - 60);
    drive(game, view, manager, 1);
    manager.pointerMove(0, 400, POND - 60);
    drive(game, view, manager, 60);
    expect(game.position.p2.pad).toBe(P2_HOME);
    game.destroy();
  });

  it('hops from the keyboard, each seat on its own half', () => {
    const game = new FrogsFightGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyD');
    manager.keyDown('ArrowLeft');
    drive(game, view, manager, 40);
    expect(PAD_X[game.position.p1.pad]!).toBeGreaterThan(PAD_X[P1_HOME]!);
    expect(PAD_X[game.position.p2.pad]!).toBeLessThan(PAD_X[P2_HOME]!);
    game.destroy();
  });

  it('keeps hopping while a direction is held', () => {
    const game = new FrogsFightGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyW');
    drive(game, view, manager, 180);
    // Three hops up the pond in three seconds, which is a held key carrying a frog rather
    // than one hop and a stop.
    expect(game.position.p1.pad).toBeLessThan(P1_HOME - 5);
    game.destroy();
  });

  it('does not hop on a resting finger', () => {
    const game = new FrogsFightGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, 200, POND - 100);
    drive(game, view, manager, 60);
    expect(game.position.p1.pad).toBe(P1_HOME);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new FrogsFightGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const score = game.getScore();
      expect(score.winner, `${tier} never finished`).not.toBeNull();
      expect(Math.max(score.p1, score.p2)).toBeGreaterThanOrEqual(TARGET_POINTS);
      game.destroy();
    }
  });

  it('finishes even with nobody touching anything', () => {
    const game = new FrogsFightGame();
    const { manager, view } = inputs();
    game.init(context());
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    // Two frogs that never move catch nothing, and the pond still runs out of bugs.
    expect(game.getScore().winner).toBe('draw');
    game.destroy();
  });

  it('is level again after a second init', () => {
    const game = new FrogsFightGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 10);
    expect(game.position.served).toBeGreaterThan(1);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.served).toBe(0);
    expect(game.position.p1.pad).toBe(mirrorPad(game.position.p2.pad));
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // Nothing here reads the presentation or the local seat: the pond is already its own
    // reflection, so there is nothing to rotate and nothing to mirror.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new FrogsFightGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 20; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) {
          const score = game.getScore();
          seen.push(
            `${String(game.position.p1.pad)}:${String(game.position.p2.pad)}:${String(score.p1)}:${String(score.p2)}`,
          );
        }
      }
      game.destroy();
      return seen.join('|');
    };
    expect(trace('single-seat', 'p2')).toBe(trace('shared-screen', 'p1'));
  });
});

describe('rendering', () => {
  const noop = (): void => undefined;

  it('draws every shape inside the declared box, through a whole match', () => {
    const drawn: number[] = [];
    const record = (...args: unknown[]): void => {
      for (const arg of args) if (typeof arg === 'number') drawn.push(arg);
    };
    const renderer = {
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

    const game = new FrogsFightGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 25; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 41 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    const limit = POND * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('never rotates, because the pond is already the same either way up', () => {
    let rotations = 0;
    const renderer = {
      clear: noop,
      rect: noop,
      strokeRect: noop,
      circle: noop,
      strokeCircle: noop,
      line: noop,
      text: noop,
      pushSeatRotation: () => {
        rotations += 1;
      },
      pushRotation: () => {
        rotations += 1;
      },
      popSeatRotation: noop,
    };
    const game = new FrogsFightGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      game.render(renderer);
    }
    game.destroy();
    expect(rotations).toBe(0);
  });

  it('does not move the simulation on', () => {
    const renderer = {
      clear: noop,
      rect: noop,
      strokeRect: noop,
      circle: noop,
      strokeCircle: noop,
      line: noop,
      text: noop,
      pushSeatRotation: noop,
      pushRotation: noop,
      popSeatRotation: noop,
    };
    const game = new FrogsFightGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const pad = game.position.p1.pad;
    const served = game.position.served;
    for (let i = 0; i < 40; i += 1) game.render(renderer);
    expect(game.position.p1.pad).toBe(pad);
    expect(game.position.served).toBe(served);
    game.destroy();
  });
});
