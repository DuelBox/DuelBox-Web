import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { BOARD_HEIGHT, BOARD_WIDTH, SlotCarsGame } from './game.js';
import { manifest } from './manifest.js';
import { CRAWL, LAPS, RACE_LENGTH, THROTTLE } from './rules.js';
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

function drive(game: SlotCarsGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new SlotCarsGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });
});

describe('the throttle', () => {
  it('is held, and a held key drives the car', () => {
    const game = new SlotCarsGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('Space');
    drive(game, view, manager, 30);
    expect(game.position.p1.speed).toBeGreaterThan(CRAWL);
    expect(game.position.p2.speed).toBe(CRAWL);
    game.destroy();
  });

  it('reaches the same speed from a mashed key as from a held one', () => {
    /*
     * The fairness this game would otherwise have. A repeated tap is won by whichever
     * instrument repeats fastest — a mouse, a mechanical keyboard, a thumb — which is why
     * Road Dodge had to declare itself same-input-class-only. Power here is a *level*, not
     * an event, so there is no rate in it to win.
     */
    const held = new SlotCarsGame();
    const a = inputs();
    held.init(context());
    a.manager.keyDown('Space');
    drive(held, a.view, a.manager, 60);

    const mashed = new SlotCarsGame();
    const b = inputs();
    mashed.init(context());
    for (let i = 0; i < 60; i += 1) {
      // Ten presses a second, which is faster than anyone sustains.
      if (i % 6 === 0) b.manager.keyDown('Space');
      if (i % 6 === 3) b.manager.keyUp('Space');
      mashed.update(STEP, b.view.sync(b.manager.beginStep(STEP)));
    }

    // The mashed one is *slower*, never faster: it spent half the time off the throttle.
    expect(mashed.position.p1.speed).toBeLessThanOrEqual(held.position.p1.speed + 1e-9);
    expect(held.position.p1.speed).toBeCloseTo(CRAWL + THROTTLE * STEP * 60, 4);
    held.destroy();
    mashed.destroy();
  });

  it('is held by a finger resting anywhere in that seat half', () => {
    const game = new SlotCarsGame();
    const { manager, view } = inputs();
    game.init(context());
    // Bottom half belongs to p1.
    manager.pointerDown(0, 80, BOARD_HEIGHT - 60);
    drive(game, view, manager, 30);
    expect(game.position.p1.speed).toBeGreaterThan(CRAWL);
    expect(game.position.p2.speed).toBe(CRAWL);
    game.destroy();
  });

  it('lets go the moment the key does', () => {
    const game = new SlotCarsGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('Space');
    drive(game, view, manager, 60);
    const top = game.position.p1.speed;
    manager.keyUp('Space');
    drive(game, view, manager, 20);
    expect(game.position.p1.speed).toBeLessThan(top);
    game.destroy();
  });
});

describe('a full race', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new SlotCarsGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      for (; steps < 60 * 400 && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      game.destroy();
    }
  });

  it('finishes with nobody touching anything, because the motor never stops', () => {
    const game = new SlotCarsGame();
    const { manager, view } = inputs();
    game.init(context());
    let steps = 0;
    for (; steps < 60 * 400 && game.getScore().winner === null; steps += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.getScore().winner).toBe('draw');
    expect(game.position.p1.distance).toBeGreaterThanOrEqual(RACE_LENGTH);
    game.destroy();
  });

  it('reports laps completed', () => {
    const game = new SlotCarsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      expect(score.p1).toBeLessThanOrEqual(LAPS - 1);
      expect(score.p2).toBeLessThanOrEqual(LAPS - 1);
    }
    game.destroy();
  });

  it('is level again after a second init', () => {
    const game = new SlotCarsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 10);
    expect(game.position.p1.distance).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.p1.distance).toBe(0);
    expect(game.position.elapsed).toBe(0);
    game.destroy();
  });

  it('plays the identical race from the same seed, whatever the presentation', () => {
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new SlotCarsGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) {
          seen.push(
            `${game.position.p1.distance.toFixed(3)}:${game.position.p2.distance.toFixed(3)}`,
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

  it('draws every shape inside the declared box, through a whole race', () => {
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

    const game = new SlotCarsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 40; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 61 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('keeps the whole circuit on the board', () => {
    // The track is scaled from its own integrated extent rather than assumed, so changing a
    // corner radius in rules.ts cannot leave the drawing hanging off the edge. Checked on
    // the road itself, which is the widest thing drawn.
    const points: number[][] = [];
    const noopRenderer = {
      clear: noop,
      rect: noop,
      strokeRect: noop,
      circle: (x: number, y: number, radius: number) => {
        points.push([x, y, radius]);
      },
      strokeCircle: noop,
      line: noop,
      text: noop,
      pushSeatRotation: noop,
      pushRotation: noop,
      popSeatRotation: noop,
    };
    const game = new SlotCarsGame();
    game.init(context());
    game.render(noopRenderer);
    game.destroy();

    expect(points.length).toBeGreaterThan(50);
    for (const [x, y, radius] of points as [number, number, number][]) {
      expect(x - radius).toBeGreaterThanOrEqual(-2);
      expect(x + radius).toBeLessThanOrEqual(BOARD_WIDTH + 2);
      expect(y - radius).toBeGreaterThanOrEqual(-2);
      expect(y + radius).toBeLessThanOrEqual(BOARD_HEIGHT + 2);
    }
  });

  it('never rotates: one circuit, read from both sides', () => {
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
    const game = new SlotCarsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 300; i += 1) {
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
    const game = new SlotCarsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const distance = game.position.p1.distance;
    for (let i = 0; i < 40; i += 1) game.render(renderer);
    expect(game.position.p1.distance).toBe(distance);
    game.destroy();
  });
});
