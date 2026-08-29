import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { TargetPracticeGame } from './game.js';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MAX_ROUNDS,
  READY_SECONDS,
  SETTLE_SECONDS,
  SMALL_POINTS,
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
  // A turn game owns the whole pointer surface: the board turns to face whoever is shooting.
  return {
    manager: new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(
  game: TargetPracticeGame,
  view: InputView,
  manager: InputManager,
  steps: number,
): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

function tap(game: TargetPracticeGame, view: InputView, manager: InputManager, key: string): void {
  manager.keyDown(key);
  drive(game, view, manager, 2);
  manager.keyUp(key);
  drive(game, view, manager, 2);
}

/** Past the ready freeze, so the marker is live and a press means something. */
function ready(game: TargetPracticeGame, view: InputView, manager: InputManager): void {
  drive(game, view, manager, Math.ceil(READY_SECONDS * 60) + 2);
}

function playOut(game: TargetPracticeGame, view: InputView, manager: InputManager): number {
  let steps = 0;
  for (; steps < 60 * 600 && game.getScore().winner === null; steps += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
  }
  return steps;
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
    // Two bots take 44 s at `hard` and 75 s at `easy`; the number a card prints has to be on
    // the right side of that.
    expect(manifest.roundSeconds).toBeGreaterThan(60);
  });

  it('describes both instruments as the same two presses', () => {
    // Rule 10: if the pointer line described something a key cannot do, the game would be two
    // different games. The observed rule is already two taps, so there was nothing to trade
    // away here — but the manifest is where that promise is kept.
    expect(manifest.controls.keyboard).toMatch(/press/i);
    expect(manifest.controls.pointer).toMatch(/tap/i);
    expect(manifest.controls.pointer).not.toMatch(/drag|swipe|flick|hold/i);
    expect(manifest.controls.keyboard).not.toMatch(/drag|swipe|flick/i);
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});

describe('whose turn it is', () => {
  it('is reported, so the shell turns the board and hands over the whole surface', () => {
    const game = new TargetPracticeGame();
    game.init(context());
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('starts with the seat the shell nominated, not always seat one', () => {
    // Issue #2466: the SDK alternates `openingSeat` across the rounds of a best-of so
    // first-mover advantage washes out, and a game that assumed `p1` would undo that.
    const game = new TargetPracticeGame();
    game.init(context({ openingSeat: 'p2' }));
    expect(game.getActiveSeat()).toBe('p2');
    game.destroy();
  });

  it('passes once a shot has landed and settled', () => {
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context());

    ready(game, view, manager);
    tap(game, view, manager, 'Space');
    expect(game.range.phase).toBe('laying');
    tap(game, view, manager, 'Space');
    expect(game.range.phase).toBe('flying');

    drive(game, view, manager, Math.round(60 * (SETTLE_SECONDS + 3)));
    expect(game.getActiveSeat()).toBe('p2');
    game.destroy();
  });
});

describe('a person shooting', () => {
  it('shoots on their own key and not the other one', () => {
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context());
    ready(game, view, manager);

    tap(game, view, manager, 'Enter');
    expect(game.range.phase).toBe('aiming');

    tap(game, view, manager, 'Space');
    expect(game.range.phase).toBe('laying');
    game.destroy();
  });

  it('shoots from a tap anywhere, because there is nothing to point at', () => {
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context());
    ready(game, view, manager);
    manager.pointerDown(0, 60, 60);
    drive(game, view, manager, 2);
    expect(game.range.phase).toBe('laying');
    game.destroy();
  });

  it('is refused during the ready freeze, which is the rules and not the shell', () => {
    // The freeze is in `rules.ts` on purpose: `seatView` reports no rotation in single-seat
    // play, so a freeze that keyed off the flip would step two different matches.
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context());
    drive(game, view, manager, 4);
    tap(game, view, manager, 'Space');
    expect(game.range.phase).toBe('ready');
    game.destroy();
  });

  it('is ignored while the board is part-way round', () => {
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context());
    ready(game, view, manager);
    tap(game, view, manager, 'Space');
    tap(game, view, manager, 'Space');

    let handedOver = false;
    for (let i = 0; i < 60 * 20 && !handedOver; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      handedOver = game.getActiveSeat() === 'p2';
    }
    expect(handedOver, 'the turn never passed').toBe(true);

    // Mid-flip: refused, and the marker has not started moving either.
    tap(game, view, manager, 'Enter');
    expect(game.range.phase, 'a press landed while the board was turning').toBe('ready');
    expect(game.range.marker).toBe(0);

    // Once it has settled and the freeze has lifted: taken.
    ready(game, view, manager);
    tap(game, view, manager, 'Enter');
    expect(game.range.phase).toBe('laying');
    game.destroy();
  });

  it('spends the turn if neither press ever comes', () => {
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context());
    drive(game, view, manager, 60 * 10);
    expect(game.range.p1Turns).toBeGreaterThan(0);
    expect(game.getScore().p1).toBe(0);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier, from either opening seat', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      for (const openingSeat of ['p1', 'p2'] as SeatId[]) {
        const game = new TargetPracticeGame();
        const { manager, view } = inputs();
        game.init(context({ botDifficulty: () => tier, openingSeat }));
        playOut(game, view, manager);
        expect(game.getScore().winner, `${tier} from ${openingSeat} never finished`).not.toBeNull();
        expect(game.range.round).toBeLessThanOrEqual(MAX_ROUNDS);
        game.destroy();
      }
    }
  });

  it('gives both seats the same number of shots', () => {
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    playOut(game, view, manager);
    expect(game.range.p1Turns).toBe(game.range.p2Turns);
    game.destroy();
  });

  it('never reports a score a shot could not have produced', () => {
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(MAX_ROUNDS * SMALL_POINTS);
      expect(Math.min(score.p1, score.p2)).toBeGreaterThanOrEqual(0);
    }
    game.destroy();
  });

  it('takes different tiers seriously', () => {
    // The shell offers three; a game that read the tier and ignored it would type-check.
    const perTurn = (tier: BotDifficulty): number => {
      const game = new TargetPracticeGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      playOut(game, view, manager);
      const score = game.getScore();
      const turns = game.range.p1Turns + game.range.p2Turns;
      game.destroy();
      return (score.p1 + score.p2) / turns;
    };
    expect(perTurn('hard')).toBeGreaterThan(perTurn('easy'));
  });

  it('is level again after a second init', () => {
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 30);
    expect(game.range.p1Turns).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.range.p1Turns).toBe(0);
    expect(game.range.clock).toBe(0);
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // The seat flip is a *drawing*, and this is what proves it: single-seat play rotates
    // nothing at all, so anything that read the flip would step a different match here.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new TargetPracticeGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'hard' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 45; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 15 === 0) {
          const score = game.getScore();
          seen.push(
            `${String(score.p1)}:${String(score.p2)}:${game.range.marker.toFixed(6)}:${game.range.clock.toFixed(4)}`,
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

    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 17 === 0) game.render(renderer, 0);
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
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      game.render(renderer, 0);
      expect(depth).toBe(0);
    }
    game.destroy();
  });

  it('draws no text at all', () => {
    // Rule 7: points are pips, the two sizes are told apart by size and by a collar, and a
    // hit is a ring. Nothing here needs reading, so nothing needs translating.
    let texts = 0;
    const renderer = {
      ...recorder(noop),
      text: () => {
        texts += 1;
      },
    };
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 === 0) game.render(renderer, 0);
    }
    game.destroy();
    expect(texts).toBe(0);
  });

  it('tells the two seats apart by shape as well as by colour', () => {
    // Rule 7 from the other side: seat one is drawn round and seat two square, so a greyscale
    // screen still says which lane and which score is whose. Counted on the pips, which are
    // the one thing both seats always have.
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
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60);
    game.render(renderer, 0);
    game.destroy();
    expect(shapes.circles).toBeGreaterThan(10);
    expect(shapes.rects).toBeGreaterThan(10);
  });

  it('does not move the simulation on', () => {
    const renderer = recorder(noop);
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const marker = game.range.marker;
    const clock = game.range.clock;
    for (let i = 0; i < 40; i += 1) game.render(renderer, 0);
    expect(game.range.marker).toBe(marker);
    expect(game.range.clock).toBe(clock);
  });

  it('draws the same picture at every render alpha, because it interpolates nothing', () => {
    const at = (alpha: number): string => {
      const drawn: number[] = [];
      const renderer = recorder((...args: unknown[]) => {
        for (const arg of args) if (typeof arg === 'number') drawn.push(arg);
      });
      const game = new TargetPracticeGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => 'normal' }));
      drive(game, view, manager, 137);
      game.render(renderer, alpha);
      game.destroy();
      return drawn.join(',');
    };
    expect(at(0)).toBe(at(0.75));
  });

  it('releases nothing it needs on destroy, and can be stood back up', () => {
    const game = new TargetPracticeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 20);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60);
    expect(game.range.clock).toBeGreaterThan(0);
    game.destroy();
  });
});
