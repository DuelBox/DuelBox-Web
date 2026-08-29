import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId, TextAlign } from '@duelbox/engine';
import type { GameContext, Renderer } from '@duelbox/game-sdk';
import { BasketballGame } from './game.js';
import { manifest } from './manifest.js';
import {
  COURT_HEIGHT,
  COURT_WIDTH,
  POSSESSIONS,
  READY_SECONDS,
  SHOTS_PER_POSSESSION,
  topOfKeyY,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

function context(overrides: Partial<GameContext> = {}): GameContext {
  return {
    manifest,
    rng: new Rng(20260824),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: () => null,
    ...overrides,
  };
}

/**
 * The pointer surface the shell really gives this game.
 *
 * A turn game owns all of it: `GameHost` reads `getActiveSeat` and switches the split to
 * `'shared'`, because the court turns to face whoever is shooting and its far side would
 * otherwise sit in the other seat's zone. The keyboard is *not* remapped with it —
 * `setBoardSeat` moves pointer ownership and touches the key bindings not at all.
 */
function inputs(): { manager: InputManager; view: InputView } {
  return {
    manager: new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(game: BasketballGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** One press of a bound key, held for two steps and released for two. */
function tap(game: BasketballGame, view: InputView, manager: InputManager, key: string): void {
  manager.keyDown(key);
  drive(game, view, manager, 2);
  manager.keyUp(key);
  drive(game, view, manager, 2);
}

/** Past the ready freeze and the board flip, so a press means something. */
function ready(game: BasketballGame, view: InputView, manager: InputManager): void {
  drive(game, view, manager, Math.ceil(READY_SECONDS * 60) + 4);
}

/** Run until the ball changes hands, and report whether it did. */
function untilHandover(game: BasketballGame, view: InputView, manager: InputManager): boolean {
  const first = game.getActiveSeat();
  for (let i = 0; i < 60 * 30; i += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    if (game.getActiveSeat() !== first) return true;
  }
  return false;
}

function playOut(game: BasketballGame, view: InputView, manager: InputManager): number {
  let steps = 0;
  for (; steps < 60 * 600 && game.getScore().winner === null; steps += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
  }
  return steps;
}

const noop = (): void => undefined;

/**
 * A renderer that reports every call to one function.
 *
 * Named parameters rather than a rest tuple: `text` takes a string colour among its numbers,
 * so a `(value: string, ...rest: number[])` signature is not a `Renderer` at all.
 */
function recorder(record: (...args: unknown[]) => void): Renderer {
  return {
    clear: (colour: string) => {
      record(colour);
    },
    rect: (x: number, y: number, w: number, h: number, colour: string) => {
      record(x, y, w, h, colour);
    },
    strokeRect: (x: number, y: number, w: number, h: number, lw: number, colour: string) => {
      record(x, y, w, h, lw, colour);
    },
    circle: (x: number, y: number, r: number, colour: string) => {
      record(x, y, r, colour);
    },
    strokeCircle: (x: number, y: number, r: number, lw: number, colour: string) => {
      record(x, y, r, lw, colour);
    },
    line: (x1: number, y1: number, x2: number, y2: number, lw: number, colour: string) => {
      record(x1, y1, x2, y2, lw, colour);
    },
    text: (
      value: string,
      x: number,
      y: number,
      size: number,
      colour: string,
      align?: TextAlign,
    ) => {
      record(value, x, y, size, colour, align);
    },
    pushSeatRotation: noop,
    pushRotation: noop,
    popSeatRotation: noop,
  };
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(COURT_WIDTH);
    expect(manifest.logical.height).toBe(COURT_HEIGHT);
  });

  it('is a turn game on a shared board', () => {
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.zoneSplit).toBe('shared-board');
  });

  it('advertises a round long enough to hold a match', () => {
    // Two normal bots take about 43 seconds of simulated play, and the weakest pair the
    // longest at a little over 70. The number a card prints has to be on that side of it.
    expect(manifest.roundSeconds).toBeGreaterThanOrEqual(60);
  });

  it('names the key each seat really shoots with, and not the other seat one', () => {
    // Nothing remaps the two keyboard halves — `setBoardSeat` moves *pointer* ownership when
    // the turn changes and leaves the bindings alone. So a control line that offered both
    // halves to whoever is shooting would be false, and the seat that read it would press a
    // key that does nothing.
    expect(DEFAULT_BINDINGS.p1.action).toBe('Space');
    expect(DEFAULT_BINDINGS.p2.action).toBe('Enter');
    expect(manifest.controls.keyboard).toMatch(/player one[^,]*space/i);
    expect(manifest.controls.keyboard).toMatch(/player two[^,]*enter/i);
    expect(manifest.controls.keyboard).not.toMatch(/arrow|w a s d/i);
  });

  it('describes both instruments as the same two presses', () => {
    // Rule 10: if the pointer line described something a key cannot do, this would be two
    // different games depending on what the player happened to be holding.
    expect(manifest.controls.keyboard).toMatch(/first[^.]*second/i);
    expect(manifest.controls.pointer).toMatch(/tap/i);
    expect(manifest.controls.pointer).toMatch(/first[^.]*second/i);
    // It says so out loud rather than merely omitting it: a player who has met a shot meter
    // before will try to drag one, and a line that only fails to mention dragging reads as
    // having left it out. Nothing in `#take` looks at the pointer's position at all.
    expect(manifest.controls.pointer).toMatch(/nothing to drag/i);
    expect(manifest.controls.pointer).not.toMatch(/swipe|flick|\bhold\b/i);
  });
});

describe('whose turn it is', () => {
  it('is reported, so the shell turns the court and hands over the whole surface', () => {
    const game = new BasketballGame();
    game.init(context());
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('passes once a shot has been missed into the other half', () => {
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    expect(untilHandover(game, view, manager), 'the ball never changed hands').toBe(true);
    expect(game.getActiveSeat()).toBe('p2');
    expect(game.court.ball.y).toBe(topOfKeyY('p2'));
    game.destroy();
  });
});

describe('a person shooting', () => {
  it('shoots on their own key and not on the other seat one', () => {
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context());
    ready(game, view, manager);
    expect(game.court.phase).toBe('aiming');

    tap(game, view, manager, 'Enter');
    expect(game.court.phase, "seat two's key moved seat one's ball").toBe('aiming');

    tap(game, view, manager, 'Space');
    expect(game.court.phase).toBe('charging');
    tap(game, view, manager, 'Space');
    expect(game.court.phase).toBe('flying');
    game.destroy();
  });

  it('gives seat two the other key, and only once it is their turn', () => {
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: (seat: SeatId) => (seat === 'p1' ? 'easy' : null) }));
    expect(untilHandover(game, view, manager)).toBe(true);
    // The shell hands the surface over with the turn; the keys stay where they are.
    manager.setBoardSeat('p2');
    ready(game, view, manager);

    tap(game, view, manager, 'Space');
    expect(game.court.phase, "seat one's key moved seat two's ball").toBe('aiming');
    tap(game, view, manager, 'Enter');
    expect(game.court.phase).toBe('charging');
    game.destroy();
  });

  it('shoots from a tap anywhere, including the far half, because nothing is pointed at', () => {
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context());
    ready(game, view, manager);
    // Deep in the half seat one does *not* own on a divided surface. A turn game has no
    // divided surface, which is the whole reason the split is switched.
    manager.pointerDown(0, 40, 40);
    drive(game, view, manager, 2);
    expect(game.court.phase).toBe('charging');
    manager.pointerUp(0);
    drive(game, view, manager, 2);
    game.destroy();
  });

  it('is refused during the ready freeze, which is the rules and not the shell', () => {
    // The freeze lives in `rules.ts` on purpose: `seatView` reports no rotation at all in
    // single-seat play, so a freeze keyed off the flip would step two different matches on a
    // phone playing remotely and on one passed across a table.
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context());
    drive(game, view, manager, 4);
    tap(game, view, manager, 'Space');
    expect(game.court.phase).toBe('ready');
    game.destroy();
  });

  it('is ignored while the court is part-way round', () => {
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: (seat: SeatId) => (seat === 'p1' ? 'easy' : null) }));
    expect(untilHandover(game, view, manager)).toBe(true);
    manager.setBoardSeat('p2');

    // Mid-flip: refused, and the needle has not started moving either.
    tap(game, view, manager, 'Enter');
    expect(game.court.phase, 'a press landed while the court was turning').toBe('ready');

    ready(game, view, manager);
    tap(game, view, manager, 'Enter');
    expect(game.court.phase).toBe('charging');
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new BasketballGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      playOut(game, view, manager);
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      expect(game.court.possession).toBe(POSSESSIONS);
      game.destroy();
    }
  });

  it('gives both seats the same number of possessions, whatever they do with them', () => {
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: (seat: SeatId) => (seat === 'p1' ? 'hard' : 'easy') }));
    playOut(game, view, manager);
    // Shots may differ — a rebound extends a possession — but never by more than the cap.
    expect(game.court.p1Shots).toBeLessThanOrEqual((POSSESSIONS / 2) * SHOTS_PER_POSSESSION);
    expect(game.court.p2Shots).toBeLessThanOrEqual((POSSESSIONS / 2) * SHOTS_PER_POSSESSION);
    expect(game.court.p1Shots).toBeGreaterThanOrEqual(POSSESSIONS / 2);
    expect(game.court.p2Shots).toBeGreaterThanOrEqual(POSSESSIONS / 2);
    game.destroy();
  });

  it('reports a score that only ever agrees with the court', () => {
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 120 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      expect(score.p1).toBe(game.court.p1Points);
      expect(score.p2).toBe(game.court.p2Points);
    }
    game.destroy();
  });

  it('takes the three tiers seriously', () => {
    // The shell offers three; a game that read the tier and ignored it would type-check.
    const points = (tier: BotDifficulty): number => {
      const game = new BasketballGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      playOut(game, view, manager);
      const score = game.getScore();
      game.destroy();
      return score.p1 + score.p2;
    };
    expect(points('hard')).toBeGreaterThan(points('easy'));
  });

  it('is level again after a second init', () => {
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 30);
    expect(game.court.p1Shots).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.court.p1Shots).toBe(0);
    expect(game.court.possession).toBe(1);
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('leaves nothing of itself behind when it is torn down', () => {
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    playOut(game, view, manager);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.court.phase).toBe('ready');
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // The seat flip is a *drawing*, and this is what proves it: single-seat play rotates
    // nothing at all, so anything that read the flip would step a different match here.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new BasketballGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'hard' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 45; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 15 === 0) {
          const score = game.getScore();
          seen.push(
            `${String(score.p1)}:${String(score.p2)}:${game.court.aim.toFixed(6)}:${game.court.ball.x.toFixed(4)}`,
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
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 90; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 17 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    // The aim line is deliberately drawn a full gauge long from wherever the ball lies, so
    // it runs off the floor and the renderer clips it. Everything else sits on the court.
    const limit = Math.max(COURT_WIDTH, COURT_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('balances every rotation it pushes', () => {
    let depth = 0;
    const renderer: Renderer = {
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
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      game.render(renderer);
      expect(depth).toBe(0);
    }
    game.destroy();
  });

  it('draws no text at all', () => {
    // Rule 7: possessions are pips, the shot clock is pips, a make is a ring and a miss a
    // cross. Nothing here needs reading, so nothing here needs translating.
    let texts = 0;
    const renderer: Renderer = {
      ...recorder(noop),
      text: () => {
        texts += 1;
      },
    };
    const game = new BasketballGame();
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
    // Rule 7 from the other side: seat one is drawn round and seat two square, on the pips
    // both seats always have, so a greyscale screen still says which end is whose.
    const shapes = { circles: 0, rects: 0 };
    const renderer: Renderer = {
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
    const game = new BasketballGame();
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
    const game = new BasketballGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const aim = game.court.aim;
    const power = game.court.power;
    const x = game.court.ball.x;
    for (let i = 0; i < 40; i += 1) game.render(renderer);
    expect(game.court.aim).toBe(aim);
    expect(game.court.power).toBe(power);
    expect(game.court.ball.x).toBe(x);
    game.destroy();
  });
});
