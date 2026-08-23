import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { BOARD_HEIGHT, BOARD_WIDTH, BrokenTilesGame, directionOf, tileCentre } from './game.js';
import { manifest } from './manifest.js';
import { COLUMNS, ROWS, START_TILE, TARGET_ROUNDS, TILES, skaterOf } from './rules.js';
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

function drive(game: BrokenTilesGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** Run past the grace period. */
function toRunning(game: BrokenTilesGame, view: InputView, manager: InputManager): void {
  for (let i = 0; i < 600 && game.position.phase === 'grace'; i += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
  }
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new BrokenTilesGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });
});

describe('the two floors', () => {
  it('fit inside their own halves without meeting', () => {
    // Seven tiles of 76 came to 532 units against a 500-unit half, and the two floors would
    // have overlapped across the middle of the board.
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const point = { x: 0, y: 0 };
      for (let tile = 0; tile < TILES; tile += 1) {
        tileCentre(seat, tile, point);
        expect(point.x).toBeGreaterThan(0);
        expect(point.x).toBeLessThan(BOARD_WIDTH);
        if (seat === 'p1') expect(point.y).toBeGreaterThan(BOARD_HEIGHT / 2);
        else expect(point.y).toBeLessThan(BOARD_HEIGHT / 2);
      }
    }
  });

  it('are square, and the two are the same size', () => {
    expect(COLUMNS).toBe(ROWS);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    tileCentre('p1', 0, a);
    tileCentre('p1', TILES - 1, b);
    const width = b.x - a.x;
    const height = b.y - a.y;
    expect(width).toBeCloseTo(height, 6);

    tileCentre('p2', 0, a);
    tileCentre('p2', TILES - 1, b);
    expect(b.x - a.x).toBeCloseTo(width, 6);
  });
});

describe('reading a push', () => {
  it('picks the dominant axis, and rejects a rest', () => {
    expect(directionOf(0, -1)).toBe(0);
    expect(directionOf(-1, 0)).toBe(1);
    expect(directionOf(0, 1)).toBe(2);
    expect(directionOf(1, 0)).toBe(3);
    // A diagonal is read as whichever way was pushed further, never rejected.
    expect(directionOf(0.9, -1)).toBe(0);
    expect(directionOf(1, -0.9)).toBe(3);
    expect(directionOf(0, 0)).toBe(-1);
    expect(directionOf(0.1, 0.1)).toBe(-1);
  });
});

describe('a person skating', () => {
  it('moves on their own keys and not the other seat', () => {
    const game = new BrokenTilesGame();
    const { manager, view } = inputs();
    game.init(context());
    toRunning(game, view, manager);

    manager.keyDown('KeyD');
    drive(game, view, manager, 4);
    expect(skaterOf(game.position, 'p1').at).toBe(START_TILE + 1);
    expect(skaterOf(game.position, 'p2').at).toBe(START_TILE);
    game.destroy();
  });

  it('skates from a drag in that seat own half', () => {
    const game = new BrokenTilesGame();
    const { manager, view } = inputs();
    game.init(context());
    toRunning(game, view, manager);

    manager.pointerDown(0, 200, BOARD_HEIGHT - 60);
    drive(game, view, manager, 2);
    manager.pointerMove(0, 400, BOARD_HEIGHT - 60);
    drive(game, view, manager, 4);
    expect(skaterOf(game.position, 'p1').at).toBe(START_TILE + 1);
    expect(skaterOf(game.position, 'p2').at).toBe(START_TILE);
    game.destroy();
  });

  it('covers the same ground from a mashed key as from a held one', () => {
    /*
     * The input-fairness claim. A game where running were a repeat rate would be won by
     * whichever instrument repeats fastest, which is why Road Dodge had to declare itself
     * same-input-class-only. Here the step cooldown is the only pace there is.
     */
    const run = (mash: boolean): number => {
      const game = new BrokenTilesGame();
      const { manager, view } = inputs();
      game.init(context());
      toRunning(game, view, manager);
      const start = skaterOf(game.position, 'p1').at;
      let travelled = 0;
      let previous = start;
      for (let i = 0; i < 60; i += 1) {
        // Alternate right and left so the skater does not run out of floor either way.
        const key = Math.floor(i / 12) % 2 === 0 ? 'KeyD' : 'KeyA';
        if (mash) {
          if (i % 3 === 0) manager.keyDown(key);
          if (i % 3 === 1) manager.keyUp(key);
        } else if (i % 12 === 0) {
          manager.keyUp('KeyD');
          manager.keyUp('KeyA');
          manager.keyDown(key);
        }
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        const now = skaterOf(game.position, 'p1').at;
        if (now !== previous) travelled += 1;
        previous = now;
      }
      game.destroy();
      return travelled;
    };
    const held = run(false);
    const mashed = run(true);
    expect(held).toBeGreaterThan(3);
    // Never *more* from mashing. Equal is the point; fewer is fine, since a mashed key
    // spends part of its time released.
    expect(mashed).toBeLessThanOrEqual(held);
  });

  it('does nothing on a finger resting inside the deadzone', () => {
    const game = new BrokenTilesGame();
    const { manager, view } = inputs();
    game.init(context());
    toRunning(game, view, manager);
    manager.pointerDown(0, 200, BOARD_HEIGHT - 60);
    drive(game, view, manager, 30);
    expect(skaterOf(game.position, 'p1').at).toBe(START_TILE);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new BrokenTilesGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      for (; steps < 60 * 400 && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      const score = game.getScore();
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(TARGET_ROUNDS);
      game.destroy();
    }
  });

  it('finishes with nobody touching anything, and it is a draw', () => {
    // Two motionless skaters go through their own middle tile at the same instant, every
    // round — the clearest statement of the two floors being identical.
    const game = new BrokenTilesGame();
    const { manager, view } = inputs();
    game.init(context());
    let steps = 0;
    for (; steps < 60 * 400 && game.getScore().winner === null; steps += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: 'draw' });
    game.destroy();
  });

  it('is level again after a second init', () => {
    const game = new BrokenTilesGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 30);
    expect(game.position.rounds).toBeGreaterThan(1);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.rounds).toBe(1);
    expect(skaterOf(game.position, 'p1').at).toBe(START_TILE);
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new BrokenTilesGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) {
          seen.push(`${String(game.position.p1.at)}:${String(game.position.p2.at)}`);
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

    const game = new BrokenTilesGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 40; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 53 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('draws no text at all', () => {
    let texts = 0;
    const renderer = {
      clear: noop,
      rect: noop,
      strokeRect: noop,
      circle: noop,
      strokeCircle: noop,
      line: noop,
      text: () => {
        texts += 1;
      },
      pushSeatRotation: noop,
      pushRotation: noop,
      popSeatRotation: noop,
    };
    const game = new BrokenTilesGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 60 * 30; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 19 === 0) game.render(renderer);
    }
    game.destroy();
    expect(texts).toBe(0);
  });

  it('never rotates: the two floors are drawn where their own players sit', () => {
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
    const game = new BrokenTilesGame();
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
    const game = new BrokenTilesGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const at = game.position.p1.at;
    const ice = game.position.p1Floor.join(',');
    for (let i = 0; i < 40; i += 1) game.render(renderer);
    expect(game.position.p1.at).toBe(at);
    expect(game.position.p1Floor.join(',')).toBe(ice);
    game.destroy();
  });
});
