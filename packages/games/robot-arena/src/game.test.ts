import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { RobotArenaGame } from './game.js';
import { manifest } from './manifest.js';
import { ARENA, CENTRE, MAX_ROUNDS, TARGET_ROUNDS, reflect, robotOf } from './rules.js';
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

function drive(game: RobotArenaGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(ARENA);
    expect(manifest.logical.height).toBe(ARENA);
  });

  it('is a square arena, which is what makes the board its own reflection', () => {
    expect(manifest.logical.width).toBe(manifest.logical.height);
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.archetype).toBe('rt-arena');
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new RobotArenaGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });
});

describe('a person running', () => {
  it('runs the way they pull, from anywhere in their own half', () => {
    const game = new RobotArenaGame();
    const { manager, view } = inputs();
    game.init(context());
    const before = game.position.p1.x;

    // A drag rightwards, starting deep in p1's own half — nowhere near the robot.
    manager.pointerDown(0, 120, ARENA - 80);
    drive(game, view, manager, 1);
    manager.pointerMove(0, 360, ARENA - 80);
    drive(game, view, manager, 60);
    expect(game.position.p1.x).toBeGreaterThan(before + 50);
    game.destroy();
  });

  it('cannot reach into the other half', () => {
    const game = new RobotArenaGame();
    const { manager, view } = inputs();
    game.init(context());
    const before = game.position.p2.x;
    manager.pointerDown(0, 120, ARENA - 80);
    drive(game, view, manager, 1);
    manager.pointerMove(0, 400, ARENA - 80);
    drive(game, view, manager, 60);
    expect(game.position.p2.x).toBe(before);
    game.destroy();
  });

  it('runs from the keyboard, each seat on its own half', () => {
    const game = new RobotArenaGame();
    const { manager, view } = inputs();
    game.init(context());
    const p1Before = game.position.p1.x;
    const p2Before = game.position.p2.x;

    manager.keyDown('KeyD');
    manager.keyDown('ArrowLeft');
    drive(game, view, manager, 40);
    expect(game.position.p1.x).toBeGreaterThan(p1Before);
    expect(game.position.p2.x).toBeLessThan(p2Before);
    game.destroy();
  });

  it('does not run on a resting finger', () => {
    // A thumb held still inside the deadzone is a rest, not a direction.
    const game = new RobotArenaGame();
    const { manager, view } = inputs();
    game.init(context());
    const before = game.position.p1.x;
    manager.pointerDown(0, 200, ARENA - 100);
    drive(game, view, manager, 40);
    expect(game.position.p1.x).toBe(before);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new RobotArenaGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      for (; steps < 60 * 600 && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      expect(game.position.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
      game.destroy();
    }
  });

  it('finishes even with nobody touching anything', () => {
    const game = new RobotArenaGame();
    const { manager, view } = inputs();
    game.init(context());
    let steps = 0;
    for (; steps < 60 * 600 && game.getScore().winner === null; steps += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    // Two motionless robots die to the same blade at the same instant, every round, so the
    // match is a draw — the point symmetry visible in its plainest form.
    expect(game.getScore().winner).toBe('draw');
    game.destroy();
  });

  it('is level again after a second init', () => {
    const game = new RobotArenaGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 60);
    expect(game.position.rounds).toBeGreaterThan(1);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.rounds).toBe(1);
    expect(game.position.p1.x).toBe(reflect(game.position.p2.x));
    game.destroy();
  });

  it('reports rounds won, capped at the target', () => {
    const game = new RobotArenaGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    const score = game.getScore();
    expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(TARGET_ROUNDS);
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // Nothing here reads the presentation or the local seat: the board is already its own
    // reflection, so there is nothing to rotate.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new RobotArenaGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 120; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) {
          seen.push(`${game.position.p1.x.toFixed(3)}:${game.position.p2.x.toFixed(3)}`);
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

    const game = new RobotArenaGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 120; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 41 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    const limit = ARENA * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('never rotates, because the board is already the same either way up', () => {
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
    const game = new RobotArenaGame();
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
    const game = new RobotArenaGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const angle = game.position.bladeAngle;
    const x = robotOf(game.position, 'p1').x;
    for (let i = 0; i < 40; i += 1) game.render(renderer);
    expect(game.position.bladeAngle).toBe(angle);
    expect(robotOf(game.position, 'p1').x).toBe(x);
    game.destroy();
  });
});

describe('the starting marks', () => {
  it('sit on the floor, opposite each other through the centre', () => {
    const game = new RobotArenaGame();
    game.init(context());
    const p1 = game.position.p1;
    const p2 = game.position.p2;
    expect(p1.x).toBe(reflect(p2.x));
    expect(p1.y).toBe(reflect(p2.y));
    expect((p1.x + p2.x) / 2).toBe(CENTRE);
    expect((p1.y + p2.y) / 2).toBe(CENTRE);
    game.destroy();
  });
});
