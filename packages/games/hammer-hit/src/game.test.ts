import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { HammerHitGame } from './game.js';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  FLIP_SECONDS,
  MAX_ROUNDS,
  READY_SECONDS,
  SETTLE_SECONDS,
  SWEEP,
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
  // A turn game owns the whole pointer surface: the board turns to face whoever is
  // swinging, so the far half of it belongs to them too.
  return {
    manager: new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(game: HammerHitGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

function tap(game: HammerHitGame, view: InputView, manager: InputManager, key: string): void {
  manager.keyDown(key);
  drive(game, view, manager, 2);
  manager.keyUp(key);
  drive(game, view, manager, 2);
}

/** Run out the ready pause so the needle is live and a press would land. */
function toLive(game: HammerHitGame, view: InputView, manager: InputManager): void {
  for (let i = 0; i < 200 && game.position.phase === 'ready'; i += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
  }
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

  it('tells each person which key is theirs', () => {
    // There is one keyboard between two people and nothing remaps it, so a legend that
    // named keys without naming a seat would be telling both players the same thing.
    expect(manifest.controls.keyboard).toMatch(/player one/i);
    expect(manifest.controls.keyboard).toMatch(/player two/i);
    expect(manifest.controls.keyboard).toMatch(/Space/);
    expect(manifest.controls.keyboard).toMatch(/Enter/);
  });
});

describe('whose turn it is', () => {
  it('is reported, so the shell turns the board and hands over the whole surface', () => {
    const game = new HammerHitGame();
    game.init(context());
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('passes once the puck has landed and settled', () => {
    const game = new HammerHitGame();
    const { manager, view } = inputs();
    game.init(context());

    toLive(game, view, manager);
    tap(game, view, manager, 'Space');
    expect(game.position.phase).not.toBe('winding');

    drive(game, view, manager, Math.round(60 * (SETTLE_SECONDS + 2)));
    expect(game.getActiveSeat()).toBe('p2');
    game.destroy();
  });
});

describe('a person swinging', () => {
  it('swings on their own key and not the other one', () => {
    const game = new HammerHitGame();
    const { manager, view } = inputs();
    game.init(context());
    toLive(game, view, manager);

    tap(game, view, manager, 'Enter');
    expect(game.position.phase).toBe('winding');

    tap(game, view, manager, 'Space');
    expect(game.position.phase).not.toBe('winding');
    game.destroy();
  });

  it('swings from a tap anywhere, because there is nothing to point at', () => {
    const game = new HammerHitGame();
    const { manager, view } = inputs();
    game.init(context());
    toLive(game, view, manager);
    manager.pointerDown(0, 60, 60);
    drive(game, view, manager, 2);
    expect(game.position.phase).not.toBe('winding');
    game.destroy();
  });

  it('is ignored while the board is part-way round, and loses nothing by it', () => {
    // The needle a player is reading would be moving under them mid-flip, so a tap would
    // name a moment they did not mean. The ready pause outlasts the flip, so by the time
    // the board has settled the wind-up has not started — which is the whole point: the
    // refusal costs the person nothing, and the bot is refused for exactly as long.
    const game = new HammerHitGame();
    const { manager, view } = inputs();
    game.init(context());

    toLive(game, view, manager);
    tap(game, view, manager, 'Space');

    let handedOver = false;
    for (let i = 0; i < 60 * 20 && !handedOver; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      handedOver = game.getActiveSeat() === 'p2';
    }
    expect(handedOver, 'the turn never passed').toBe(true);

    // Mid-flip: refused, and the needle has not moved.
    tap(game, view, manager, 'Enter');
    expect(game.position.phase, 'a press landed while the board was turning').toBe('ready');
    expect(game.position.needle).toBe(-SWEEP);

    // A whole flip later, still nothing has been wound.
    drive(game, view, manager, Math.round(FLIP_SECONDS * 60) + 1);
    expect(game.position.wind).toBe(0);
    expect(game.position.needle).toBe(-SWEEP);

    // Once the pause is out: taken.
    drive(game, view, manager, Math.round(READY_SECONDS * 60));
    expect(game.position.phase).toBe('winding');
    tap(game, view, manager, 'Enter');
    expect(game.position.phase).not.toBe('winding');
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new HammerHitGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      for (; steps < 60 * 600 && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      expect(game.position.rounds).toBeLessThanOrEqual(MAX_ROUNDS + 1);
      game.destroy();
    }
  });

  it('gives both seats the same number of swings', () => {
    const game = new HammerHitGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.position.p1Swings).toBe(game.position.p2Swings);
    expect(game.position.p1Swings).toBeGreaterThanOrEqual(4);
    game.destroy();
  });

  it('is level again after a second init', () => {
    const game = new HammerHitGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 20);
    expect(game.position.p1Swings).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.p1Swings).toBe(0);
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // The flip runs in one presentation and not the other. Nothing in the simulation may
    // depend on it, or a phone and a laptop would step two different matches.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new HammerHitGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'hard' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 100; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) {
          const score = game.getScore();
          seen.push(
            `${String(score.p1)}:${String(score.p2)}:${game.position.needle.toFixed(4)}:${String(game.position.wind)}`,
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

    const game = new HammerHitGame();
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
    const game = new HammerHitGame();
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
    // Every number this game has is drawn as a length or a shape: the totals as two bars
    // out of the middle, the wind-up as a row of pips, the score for a swing as how far
    // the puck climbed. A digit has a top, and this board is read from both ends.
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
    const game = new HammerHitGame();
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
    const game = new HammerHitGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const needle = game.position.needle;
    const score = game.getScore().p1;
    for (let i = 0; i < 40; i += 1) game.render(renderer);
    expect(game.position.needle).toBe(needle);
    expect(game.getScore().p1).toBe(score);
    game.destroy();
  });
});
