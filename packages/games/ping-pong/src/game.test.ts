import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, envelopeFor } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { PingPongGame } from './game.js';
import { manifest } from './manifest.js';
import {
  P1_RACKET_Y,
  RACKET_MAX_X,
  RACKET_MIN_X,
  RACKET_SPEED,
  ROUND_SECONDS,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  TARGET_POINTS,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

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

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(TABLE_WIDTH);
    expect(manifest.logical.height).toBe(TABLE_HEIGHT);
  });

  it('splits the screen the way the two ends of a table are arranged', () => {
    // A vertical split would put the two seats side by side, which is not a table.
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.archetype).toBe('rt-split');
  });
});

describe('a fresh match', () => {
  it('starts level, with nobody having won', () => {
    const game = new PingPongGame();
    game.init(context());
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new PingPongGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });

  it('is level again after a second init', () => {
    // The shell reuses one instance across a rematch, so anything left behind here would
    // start the next match part-played.
    const game = new PingPongGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    for (let i = 0; i < 60 * 40; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.getScore().p1 + game.getScore().p2).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'hard' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.elapsed).toBe(0);
    game.destroy();
  });
});

describe('a person driving a racket', () => {
  it('follows a finger in their own half', () => {
    const game = new PingPongGame();
    const { manager, view } = inputs();
    game.init(context());

    // Within one lattice step, not exactly: the engine quantises every logical coordinate
    // entering it to the shared precision envelope, so that a mouse cannot aim finer than
    // a thumb. Here that is 640/200 = 3.2 units, and a game asserting an exact pointer
    // position would be asserting that the envelope is off.
    const envelope = envelopeFor(manifest.logical);

    // A touch in the bottom half belongs to p1.
    manager.pointerDown(0, RACKET_MIN_X, TABLE_HEIGHT - 120);
    for (let i = 0; i < 120; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(Math.abs(game.position.p1.x - RACKET_MIN_X)).toBeLessThanOrEqual(envelope);

    manager.pointerMove(0, RACKET_MAX_X, TABLE_HEIGHT - 120);
    for (let i = 0; i < 120; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(Math.abs(game.position.p1.x - RACKET_MAX_X)).toBeLessThanOrEqual(envelope);
    game.destroy();
  });

  it('cannot reach into the other half', () => {
    const game = new PingPongGame();
    const { manager, view } = inputs();
    game.init(context());
    const before = game.position.p2.x;
    // A finger in p1's half must never move p2's racket, however far it drags.
    manager.pointerDown(0, RACKET_MIN_X, TABLE_HEIGHT - 60);
    for (let i = 0; i < 120; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.position.p2.x).toBe(before);
    game.destroy();
  });

  it('drives from the keyboard, each seat on its own half', () => {
    const game = new PingPongGame();
    const { manager, view } = inputs();
    game.init(context());

    manager.keyDown('KeyA');
    manager.keyDown('ArrowRight');
    for (let i = 0; i < 60; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.position.p1.x).toBeLessThan(TABLE_WIDTH / 2);
    expect(game.position.p2.x).toBeGreaterThan(TABLE_WIDTH / 2);
    game.destroy();
  });

  it('never moves a racket faster from a key than from a finger', () => {
    // Input parity: the two families cover the table in the same time, because the same
    // rate limit applies to whatever asked for the move.
    const run = (drive: (manager: InputManager) => void): number => {
      const game = new PingPongGame();
      const { manager, view } = inputs();
      game.init(context());
      drive(manager);
      const start = game.position.p1.x;
      for (let i = 0; i < 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      const travelled = Math.abs(game.position.p1.x - start);
      game.destroy();
      return travelled;
    };

    const byKey = run((manager) => {
      manager.keyDown('KeyD');
    });
    const byFinger = run((manager) => {
      manager.pointerDown(0, TABLE_WIDTH, TABLE_HEIGHT - 100);
    });
    const ceiling = RACKET_SPEED * STEP * 30;
    expect(byKey).toBeLessThanOrEqual(ceiling + 1e-6);
    expect(byFinger).toBeLessThanOrEqual(ceiling + 1e-6);
    expect(byKey).toBeCloseTo(byFinger, 3);
  });
});

describe('a full match', () => {
  it('reaches a decision with two bots playing', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new PingPongGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      const limit = 60 * (ROUND_SECONDS + 5);
      for (; steps < limit && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const score = game.getScore();
      expect(score.winner, `${tier} never finished`).not.toBeNull();
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(TARGET_POINTS);
      game.destroy();
    }
  });

  it('stops simulating once it is decided', () => {
    const game = new PingPongGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 60 * (ROUND_SECONDS + 5) && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    const settled = { ...game.position.ball };
    for (let i = 0; i < 300; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.position.ball).toEqual(settled);
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // Rule 8 in one assertion: single-seat and shared-screen are two layouts of one
    // simulation, so the trace must not depend on which one the shell chose.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new PingPongGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
      const seen: number[] = [];
      for (let i = 0; i < 1800; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 60 === 0) seen.push(game.position.ball.x, game.position.ball.y);
      }
      game.destroy();
      return seen.map((n) => n.toFixed(6)).join(',');
    };
    expect(trace('single-seat', 'p2')).toBe(trace('shared-screen', 'p1'));
  });
});

describe('rendering', () => {
  it('draws every shape inside the declared box, at every stage of a point', () => {
    const drawn: number[] = [];
    const record = (...args: unknown[]): void => {
      for (const arg of args) if (typeof arg === 'number') drawn.push(arg);
    };
    const renderer = {
      clear: () => undefined,
      rect: record,
      strokeRect: record,
      circle: record,
      strokeCircle: record,
      line: record,
      text: record,
      pushSeatRotation: () => undefined,
      pushRotation: () => undefined,
      popSeatRotation: () => undefined,
    };

    const game = new PingPongGame();
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
    const limit = Math.max(TABLE_WIDTH, TABLE_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('does not move the simulation on', () => {
    const game = new PingPongGame();
    const noop = (): void => undefined;
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
    game.init(context({ botDifficulty: () => 'normal' }));
    const { manager, view } = inputs();
    for (let i = 0; i < 200; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    const before = { ...game.position.ball };
    // The interpolation alpha the contract passes is deliberately not read: nothing here
    // is drawn between two simulation states, so a frame is the state as it stands.
    for (let i = 0; i < 50; i += 1) game.render(renderer, 0);
    expect(game.position.ball).toEqual(before);
    game.destroy();
  });
});

describe('the baselines', () => {
  it('sit inside the table with room for a racket', () => {
    expect(P1_RACKET_Y).toBeGreaterThan(TABLE_HEIGHT / 2);
    expect(P1_RACKET_Y).toBeLessThan(TABLE_HEIGHT);
    expect(RACKET_MIN_X).toBeLessThan(RACKET_MAX_X);
  });
});
