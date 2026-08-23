import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { BOARD_HEIGHT, BOARD_WIDTH, FruitDuelGame } from './game.js';
import { manifest } from './manifest.js';
import { MAX_ROUNDS, bladeAt, isFalseStart } from './rules.js';
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

function drive(game: FruitDuelGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** Step the game until the subject is on screen. */
function toShowing(game: FruitDuelGame, view: InputView, manager: InputManager): void {
  for (let i = 0; i < 600 && game.position.phase === 'waiting'; i += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
  }
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new FruitDuelGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });
});

describe('a press', () => {
  it('cuts for the seat that made it, and only that seat', () => {
    const game = new FruitDuelGame();
    const { manager, view } = inputs();
    game.init(context());
    toShowing(game, view, manager);

    manager.keyDown('Space');
    drive(game, view, manager, 1);
    manager.keyUp('Space');
    expect(bladeAt(game.position, 'p1')).toBeGreaterThanOrEqual(0);
    expect(bladeAt(game.position, 'p2')).toBe(-1);
    game.destroy();
  });

  it('cuts from a tap anywhere in that seat half', () => {
    const game = new FruitDuelGame();
    const { manager, view } = inputs();
    game.init(context());
    toShowing(game, view, manager);

    // Bottom half belongs to p1, top half to p2.
    manager.pointerDown(0, 100, BOARD_HEIGHT - 60);
    manager.pointerDown(1, 540, 60);
    drive(game, view, manager, 1);
    expect(bladeAt(game.position, 'p1')).toBeGreaterThanOrEqual(0);
    expect(bladeAt(game.position, 'p2')).toBeGreaterThanOrEqual(0);
    game.destroy();
  });

  it('is an edge, so a key held through a round does not cut the next one', () => {
    const game = new FruitDuelGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('Space');
    // Long enough to pass the false start, the reveal, and into a fresh round.
    drive(game, view, manager, 60 * 6);
    expect(game.position.rounds).toBeGreaterThan(1);
    expect(bladeAt(game.position, 'p1')).toBe(-1);
    game.destroy();
  });

  it('before the subject appears is a false start', () => {
    const game = new FruitDuelGame();
    const { manager, view } = inputs();
    game.init(context());
    expect(game.position.phase).toBe('waiting');
    manager.keyDown('Enter');
    drive(game, view, manager, 1);
    manager.keyUp('Enter');
    expect(isFalseStart(bladeAt(game.position, 'p2'))).toBe(true);
    drive(game, view, manager, 2);
    expect(game.getScore().p1).toBe(1);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new FruitDuelGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      for (; steps < 60 * 400 && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      expect(game.position.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
      game.destroy();
    }
  });

  it('finishes even with nobody touching anything', () => {
    const game = new FruitDuelGame();
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
    const game = new FruitDuelGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 30);
    expect(game.position.rounds).toBeGreaterThan(1);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.rounds).toBe(1);
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // Nothing here reads the presentation or the local seat: the subject is radially
    // symmetric and each seat's verdict is drawn on its own side, so there is nothing to
    // rotate and nothing to mirror.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new FruitDuelGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'hard' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 150; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) {
          const score = game.getScore();
          seen.push(`${String(score.p1)}:${String(score.p2)}:${game.position.subject}`);
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

    const game = new FruitDuelGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 150; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 29 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('draws no text at all', () => {
    // Every verdict is a shape — tick, cross, arrow, bar — and the subject is a disc with
    // pips. Nothing on this board needs translating, and nothing has a right way up, which
    // is what lets one drawing serve two people sitting opposite each other.
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
    const game = new FruitDuelGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 13 === 0) game.render(renderer);
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
    const game = new FruitDuelGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const before = game.position.timer;
    const rounds = game.position.rounds;
    for (let i = 0; i < 40; i += 1) game.render(renderer);
    expect(game.position.timer).toBe(before);
    expect(game.position.rounds).toBe(rounds);
    game.destroy();
  });
});
