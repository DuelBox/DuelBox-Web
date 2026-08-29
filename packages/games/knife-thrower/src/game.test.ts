import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { KnifeThrowerGame } from './game.js';
import { manifest } from './manifest.js';
import { BOARD_HEIGHT, BOARD_WIDTH, MAX_KNIVES, MAX_THROWS, SETTLE_SECONDS } from './rules.js';
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
  // A turn-based game owns the whole pointer surface: the host passes `shared`, never a
  // split, because the board turns to face whoever is to move.
  return {
    manager: new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(
  game: KnifeThrowerGame,
  view: InputView,
  manager: InputManager,
  steps: number,
): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
  });

  it('is a turn game on a shared board', () => {
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.zoneSplit).toBe('shared-board');
  });
});

describe('whose turn it is', () => {
  it('is reported, so the shell turns the board and hands over the whole surface', () => {
    // `turn-seat.test.ts` checks every turn-* game answers this. A game that did not would
    // be treated as real-time: half the device would be dead to a finger and the arrow
    // keys would drive the player who is not playing.
    const game = new KnifeThrowerGame();
    game.init(context());
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('passes to the other seat once a throw has settled', () => {
    const game = new KnifeThrowerGame();
    const { manager, view } = inputs();
    game.init(context());

    manager.keyDown('Space');
    drive(game, view, manager, 2);
    manager.keyUp('Space');
    expect(game.position.phase).toBe('flying');

    drive(game, view, manager, 60 * 3);
    expect(game.getActiveSeat()).toBe('p2');
    game.destroy();
  });
});

describe('a person throwing', () => {
  it('throws on their own key and not on the other one', () => {
    const game = new KnifeThrowerGame();
    const { manager, view } = inputs();
    game.init(context());

    // Seat two's key, on seat one's turn: nothing happens.
    manager.keyDown('Enter');
    drive(game, view, manager, 4);
    manager.keyUp('Enter');
    expect(game.position.phase).toBe('aiming');
    expect(game.position.throws).toBe(0);

    manager.keyDown('Space');
    drive(game, view, manager, 2);
    manager.keyUp('Space');
    expect(game.position.throws).toBe(1);
    game.destroy();
  });

  it('throws from a tap anywhere, because there is nothing to aim', () => {
    const game = new KnifeThrowerGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, 90, 90);
    drive(game, view, manager, 2);
    expect(game.position.throws).toBe(1);
    game.destroy();
  });

  it('is ignored while the board is part-way round', () => {
    // The log a player is reading is moving under them mid-flip, so a tap would name a
    // moment they did not mean.
    const game = new KnifeThrowerGame();
    const { manager, view } = inputs();
    game.init(context());

    manager.keyDown('Space');
    drive(game, view, manager, 2);
    manager.keyUp('Space');
    // Through the flight and into the settle, so the flip to seat two is running.
    drive(game, view, manager, Math.round(60 * (SETTLE_SECONDS + 0.4)));

    const before = game.position.throws;
    manager.keyDown('Enter');
    drive(game, view, manager, 2);
    manager.keyUp('Enter');
    expect(game.position.throws).toBe(before);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new KnifeThrowerGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      for (; steps < 60 * 400 && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      expect(game.position.throws).toBeLessThanOrEqual(MAX_THROWS);
      game.destroy();
    }
  });

  it('gives both seats the same number of throws', () => {
    const game = new KnifeThrowerGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.position.p1Throws).toBe(game.position.p2Throws);
    game.destroy();
  });

  it('is level again after a second init', () => {
    const game = new KnifeThrowerGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 60);
    expect(game.position.throws).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.throws).toBe(0);
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // Rule 8: the presentation changes the layout and never the simulation.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new KnifeThrowerGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'hard' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 120; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) {
          const score = game.getScore();
          seen.push(
            `${String(score.p1)}:${String(score.p2)}:${String(game.position.knives.length)}`,
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

  function recorder(drawn: number[]) {
    const record = (...args: unknown[]): void => {
      for (const arg of args) if (typeof arg === 'number') drawn.push(arg);
    };
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

  it('draws every shape inside the declared box, throughout a match', () => {
    const drawn: number[] = [];
    const renderer = recorder(drawn);
    const game = new KnifeThrowerGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    // Sampled every 37 steps rather than every 11. The board carries eight knives, twenty
    // score pips and a flight, so a frame here is several times the draw calls of a lighter
    // game — at one render in eleven this took 5.2 s on a loaded machine and failed the
    // five-second timeout. Three hundred frames spread across a whole match still cover
    // every phase, and cost a fifth of the time.
    for (let i = 0; i < 60 * 200; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 37 === 0) game.render(renderer, 0);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('balances every rotation it pushes', () => {
    // An unbalanced push leaves the *next* game the shell loads drawing sideways.
    let depth = 0;
    const renderer = {
      clear: noop,
      rect: noop,
      strokeRect: noop,
      circle: noop,
      strokeCircle: noop,
      line: noop,
      text: noop,
      pushSeatRotation: () => {
        depth += 1;
      },
      pushRotation: () => {
        depth += 1;
      },
      popSeatRotation: () => {
        depth -= 1;
      },
    };
    const game = new KnifeThrowerGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      game.render(renderer, 0);
      expect(depth).toBe(0);
    }
    game.destroy();
  });

  it('does not move the simulation on', () => {
    const drawn: number[] = [];
    const renderer = recorder(drawn);
    const game = new KnifeThrowerGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const before = game.position.spin;
    const knives = game.position.knives.length;
    for (let i = 0; i < 40; i += 1) game.render(renderer, 0);
    expect(game.position.spin).toBe(before);
    expect(game.position.knives).toHaveLength(knives);
    game.destroy();
  });
});

describe('the opening log', () => {
  it('is already dressed, so the first throw is no easier than any other', () => {
    const game = new KnifeThrowerGame();
    game.init(context());
    expect(game.position.knives.length).toBeGreaterThan(MAX_KNIVES - 3);
    game.destroy();
  });
});
