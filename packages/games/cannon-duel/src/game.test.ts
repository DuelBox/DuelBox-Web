import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { CannonDuelGame } from './game.js';
import { manifest } from './manifest.js';
import { BOARD_HEIGHT, BOARD_WIDTH, MAX_VOLLEYS, SETTLE_SECONDS, TARGET_HITS } from './rules.js';
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
  // A turn game owns the whole pointer surface: the board turns to face whoever is firing.
  return {
    manager: new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(game: CannonDuelGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

function tap(game: CannonDuelGame, view: InputView, manager: InputManager, key: string): void {
  manager.keyDown(key);
  drive(game, view, manager, 2);
  manager.keyUp(key);
  drive(game, view, manager, 2);
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
    const game = new CannonDuelGame();
    game.init(context());
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('passes once a shot has landed and settled', () => {
    const game = new CannonDuelGame();
    const { manager, view } = inputs();
    game.init(context());

    tap(game, view, manager, 'Space');
    expect(game.position.phase).toBe('powering');
    tap(game, view, manager, 'Space');
    expect(game.position.phase).toBe('flying');

    drive(game, view, manager, Math.round(60 * (SETTLE_SECONDS + 4)));
    expect(game.getActiveSeat()).toBe('p2');
    game.destroy();
  });
});

describe('a person firing', () => {
  it('fires on their own key and not the other one', () => {
    const game = new CannonDuelGame();
    const { manager, view } = inputs();
    game.init(context());

    tap(game, view, manager, 'Enter');
    expect(game.position.phase).toBe('aiming');

    tap(game, view, manager, 'Space');
    expect(game.position.phase).toBe('powering');
    game.destroy();
  });

  it('fires from a tap anywhere, because there is nothing to point at', () => {
    const game = new CannonDuelGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, 60, 60);
    drive(game, view, manager, 2);
    expect(game.position.phase).toBe('powering');
    game.destroy();
  });

  it('is ignored while the board is part-way round', () => {
    // The needle a player is reading is moving under them mid-flip, so a tap would name a
    // moment they did not mean. Timed against the handover rather than guessed at: the
    // press goes in on the very step the turn passes, which is the step the flip begins.
    const game = new CannonDuelGame();
    const { manager, view } = inputs();
    game.init(context());

    tap(game, view, manager, 'Space');
    tap(game, view, manager, 'Space');

    // Run until the turn passes to seat two, which is when the board starts turning.
    let handedOver = false;
    for (let i = 0; i < 60 * 20 && !handedOver; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      handedOver = game.getActiveSeat() === 'p2';
    }
    expect(handedOver, 'the turn never passed').toBe(true);
    expect(game.position.phase).toBe('aiming');

    // Mid-flip: refused.
    tap(game, view, manager, 'Enter');
    expect(game.position.phase, 'a press landed while the board was turning').toBe('aiming');

    // Once it has settled: taken.
    drive(game, view, manager, 60);
    tap(game, view, manager, 'Enter');
    expect(game.position.phase).toBe('powering');
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new CannonDuelGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      for (; steps < 60 * 600 && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      expect(game.position.volleys).toBeLessThanOrEqual(MAX_VOLLEYS + 1);
      game.destroy();
    }
  });

  it('gives both seats the same number of shots', () => {
    const game = new CannonDuelGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.position.p1Shots).toBe(game.position.p2Shots);
    game.destroy();
  });

  it('never reports more hits than the target', () => {
    const game = new CannonDuelGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(TARGET_HITS + 1);
    }
    game.destroy();
  });

  it('is level again after a second init', () => {
    const game = new CannonDuelGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 40);
    expect(game.position.p1Shots).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.p1Shots).toBe(0);
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new CannonDuelGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'hard' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 100; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) {
          const score = game.getScore();
          seen.push(`${String(score.p1)}:${String(score.p2)}:${game.position.wind.toFixed(2)}`);
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

    const game = new CannonDuelGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 120; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 37 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('balances every rotation it pushes', () => {
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
    const game = new CannonDuelGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      game.render(renderer);
      expect(depth).toBe(0);
    }
    game.destroy();
  });

  it('draws no text at all', () => {
    // The wind is drawn as an arrow whose length is its strength, the hits as pips, and the
    // gauges as needles. Nothing here needs reading, so nothing needs translating.
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
    const game = new CannonDuelGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 17 === 0) game.render(renderer);
    }
    game.destroy();
    expect(texts).toBe(0);
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
    const game = new CannonDuelGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const aim = game.position.aim;
    const wind = game.position.wind;
    for (let i = 0; i < 40; i += 1) game.render(renderer);
    expect(game.position.aim).toBe(aim);
    expect(game.position.wind).toBe(wind);
    game.destroy();
  });
});
