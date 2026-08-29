import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { CupPongGame } from './game.js';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CUPS_PER_RACK,
  READY_SECONDS,
  ROUNDS,
  SETTLE_SECONDS,
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
  // A turn game owns the whole pointer surface: the table turns to face whoever is throwing.
  return {
    manager: new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(game: CupPongGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

function tap(game: CupPongGame, view: InputView, manager: InputManager, key: string): void {
  manager.keyDown(key);
  drive(game, view, manager, 2);
  manager.keyUp(key);
  drive(game, view, manager, 2);
}

/** Past the ready freeze, so the needle is live and a press means something. */
function ready(game: CupPongGame, view: InputView, manager: InputManager): void {
  drive(game, view, manager, Math.ceil(READY_SECONDS * 60) + 2);
}

const noop = (): void => undefined;

function recorder(record: (...args: unknown[]) => void) {
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
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
  });

  it('is a turn game on a shared board', () => {
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.zoneSplit).toBe('shared-board');
  });

  it('advertises a round long enough to hold a match', () => {
    // Two bots take about 43 seconds of simulated play; the number a card prints has to be
    // on the right side of that.
    expect(manifest.roundSeconds).toBeGreaterThan(60);
  });

  it('describes both instruments as the same two presses', () => {
    // Rule 10: if the pointer line described something a key cannot do, the game would be
    // two different games.
    expect(manifest.controls.keyboard).toMatch(/press/i);
    expect(manifest.controls.pointer).toMatch(/tap/i);
    expect(manifest.controls.pointer).not.toMatch(/drag|swipe|flick/i);
  });
});

describe('whose turn it is', () => {
  it('is reported, so the shell turns the table and hands over the whole surface', () => {
    const game = new CupPongGame();
    game.init(context());
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('passes once a throw has landed and settled', () => {
    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context());

    ready(game, view, manager);
    tap(game, view, manager, 'Space');
    expect(game.table.phase).toBe('throwing');
    tap(game, view, manager, 'Space');
    expect(game.table.phase).toBe('flying');

    drive(game, view, manager, Math.round(60 * (SETTLE_SECONDS + 3)));
    expect(game.getActiveSeat()).toBe('p2');
    game.destroy();
  });
});

describe('a person throwing', () => {
  it('throws on their own key and not the other one', () => {
    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context());
    ready(game, view, manager);

    tap(game, view, manager, 'Enter');
    expect(game.table.phase).toBe('aiming');

    tap(game, view, manager, 'Space');
    expect(game.table.phase).toBe('throwing');
    game.destroy();
  });

  it('throws from a tap anywhere, because there is nothing to point at', () => {
    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context());
    ready(game, view, manager);
    manager.pointerDown(0, 60, 60);
    drive(game, view, manager, 2);
    expect(game.table.phase).toBe('throwing');
    game.destroy();
  });

  it('is refused during the ready freeze, which is the rules and not the shell', () => {
    // The freeze is in `rules.ts` on purpose: `seatView` reports no rotation in single-seat
    // play, so a freeze that keyed off the flip would step two different matches.
    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context());
    drive(game, view, manager, 4);
    tap(game, view, manager, 'Space');
    expect(game.table.phase).toBe('ready');
    game.destroy();
  });

  it('is ignored while the table is part-way round', () => {
    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context());
    ready(game, view, manager);
    tap(game, view, manager, 'Space');
    tap(game, view, manager, 'Space');

    // Run until the turn passes to seat two, which is when the table starts turning.
    let handedOver = false;
    for (let i = 0; i < 60 * 20 && !handedOver; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      handedOver = game.getActiveSeat() === 'p2';
    }
    expect(handedOver, 'the turn never passed').toBe(true);

    // Mid-flip: refused, and the needle has not started moving either.
    tap(game, view, manager, 'Enter');
    expect(game.table.phase, 'a press landed while the table was turning').toBe('ready');

    // Once it has settled and the freeze has lifted: taken.
    ready(game, view, manager);
    tap(game, view, manager, 'Enter');
    expect(game.table.phase).toBe('throwing');
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new CupPongGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      for (; steps < 60 * 600 && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      expect(game.table.round).toBeLessThanOrEqual(ROUNDS);
      game.destroy();
    }
  });

  it('gives both seats the same number of throws', () => {
    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.table.p1Throws).toBe(game.table.p2Throws);
    game.destroy();
  });

  it('never reports more cups than a rack holds', () => {
    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(CUPS_PER_RACK);
    }
    game.destroy();
  });

  it('takes different tiers seriously', () => {
    // The shell offers three; a game that read the tier and ignored it would type-check.
    const cups = (tier: BotDifficulty): number => {
      const game = new CupPongGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const score = game.getScore();
      game.destroy();
      return score.p1 + score.p2;
    };
    expect(cups('hard')).toBeGreaterThan(cups('easy'));
  });

  it('is level again after a second init', () => {
    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 30);
    expect(game.table.p1Throws).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.table.p1Throws).toBe(0);
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // The seat flip is a *drawing*, and this is what proves it: single-seat play rotates
    // nothing at all, so anything that read the flip would step a different match here.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new CupPongGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'hard' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 45; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 15 === 0) {
          const score = game.getScore();
          seen.push(
            `${String(score.p1)}:${String(score.p2)}:${game.table.aim.toFixed(6)}:${game.table.ball.x.toFixed(4)}`,
          );
        }
      }
      game.destroy();
      return seen.join('|');
    };
    expect(trace('single-seat', 'p2')).toBe(trace('shared-screen', 'p1'));
    expect(trace('single-seat', 'p1')).toBe(trace('shared-screen', 'p1'));
  });
});

describe('rendering', () => {
  it('draws every shape inside the declared box, through a whole match', () => {
    const drawn: number[] = [];
    const renderer = recorder((...args: unknown[]) => {
      for (const arg of args) if (typeof arg === 'number') drawn.push(arg);
    });

    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 17 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('balances every rotation it pushes', () => {
    let depth = 0;
    const renderer = {
      ...recorder(noop),
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
    const game = new CupPongGame();
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
    // Rule 7: cups taken are pips, a clean drop is a filled pip, the throw is a line and a
    // marker on the table. Nothing here needs reading, so nothing needs translating.
    let texts = 0;
    const renderer = {
      ...recorder(noop),
      text: () => {
        texts += 1;
      },
    };
    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 === 0) game.render(renderer);
    }
    game.destroy();
    expect(texts).toBe(0);
  });

  it('tells the two seats apart by shape as well as by colour', () => {
    // Rule 7 again, from the other side: seat one is drawn round and seat two square, so a
    // greyscale screen still says which end of the table is whose. Counted on the pips,
    // which are the one thing on the table both seats always have.
    const shapes = { circles: 0, rects: 0 };
    const renderer = {
      ...recorder(noop),
      circle: () => {
        shapes.circles += 1;
      },
      strokeCircle: () => {
        shapes.circles += 1;
      },
      rect: () => {
        shapes.rects += 1;
      },
      strokeRect: () => {
        shapes.rects += 1;
      },
    };
    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60);
    game.render(renderer);
    game.destroy();
    expect(shapes.circles).toBeGreaterThan(6);
    expect(shapes.rects).toBeGreaterThan(6);
  });

  it('does not move the simulation on', () => {
    const renderer = recorder(noop);
    const game = new CupPongGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const aim = game.table.aim;
    const strength = game.table.strength;
    for (let i = 0; i < 40; i += 1) game.render(renderer);
    expect(game.table.aim).toBe(aim);
    expect(game.table.strength).toBe(strength);
    game.destroy();
  });
});
