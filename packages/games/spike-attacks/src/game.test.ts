import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { BOARD_HEIGHT, BOARD_WIDTH, ROW_X, SpikeAttacksGame } from './game.js';
import { manifest } from './manifest.js';
import { LIVES, ROW_LENGTH, START_X, WALK_SPEED } from './rules.js';
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

function drive(
  game: SpikeAttacksGame,
  view: InputView,
  manager: InputManager,
  steps: number,
): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

const noop = (): void => undefined;

function recorder(): { renderer: Parameters<SpikeAttacksGame['render']>[0]; drawn: number[] } {
  const drawn: number[] = [];
  const record = (...args: unknown[]): void => {
    for (const arg of args) if (typeof arg === 'number') drawn.push(arg);
  };
  return {
    drawn,
    renderer: {
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
    },
  };
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
  });

  it('keeps the whole row inside that box', () => {
    expect(ROW_X).toBeGreaterThan(0);
    expect(ROW_X + ROW_LENGTH).toBeLessThan(BOARD_WIDTH);
  });

  it('has no turns, even before it has been started', () => {
    // `turn-seat.test.ts` asks a freshly created game, so the answer cannot wait for init.
    const fresh = new SpikeAttacksGame();
    expect(fresh.getActiveSeat()).toBeNull();
    fresh.init(context());
    expect(fresh.getActiveSeat()).toBeNull();
    fresh.destroy();
  });

  it('tells a player which half of the keyboard is theirs', () => {
    // Two halves, two people. "W A S D or the arrow keys" is false in every game here: the
    // other half moves your opponent.
    expect(manifest.controls.keyboard).toMatch(/player one/i);
    expect(manifest.controls.keyboard).toMatch(/player two/i);
    expect(manifest.controls.keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
  });
});

describe('walking', () => {
  it('moves the seat whose key is held, and only that seat', () => {
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyD');
    drive(game, view, manager, 30);
    expect(game.position.p1.x).toBeGreaterThan(START_X);
    expect(game.position.p2.x).toBe(START_X);
    game.destroy();
  });

  it('gives the far seat its own right, through its own keys', () => {
    // The two rows are point-symmetric, so seat two's right arrow walks it towards seat
    // two's right — which is the board's left. The rules never learn that; the drawing does.
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('ArrowRight');
    drive(game, view, manager, 30);
    expect(game.position.p2.x).toBeGreaterThan(START_X);
    expect(game.position.p1.x).toBe(START_X);
    game.destroy();
  });

  it('covers exactly the same ground from a mashed key as from a held one', () => {
    /*
     * The fairness this game would otherwise have to buy with `sameInputClassOnly`. A
     * repeated press is won by whichever instrument repeats fastest — a mechanical
     * keyboard, a mouse, a thumb — and nothing about a shared viewport closes that gap.
     * Walking here is a *level*: there is no press to repeat, and asking more often does
     * not move anybody an inch further.
     */
    const held = new SpikeAttacksGame();
    const a = inputs();
    held.init(context());
    a.manager.keyDown('KeyD');
    drive(held, a.view, a.manager, 60);

    const mashed = new SpikeAttacksGame();
    const b = inputs();
    mashed.init(context());
    for (let i = 0; i < 60; i += 1) {
      // Ten presses a second, which is faster than anybody sustains.
      if (i % 6 === 0) b.manager.keyDown('KeyD');
      if (i % 6 === 3) b.manager.keyUp('KeyD');
      mashed.update(STEP, b.view.sync(b.manager.beginStep(STEP)));
    }

    // A held key walks exactly the distance the clock allows, and the mashed one strictly
    // less: it spent half the second not asking for anything.
    expect(held.position.p1.x - START_X).toBeCloseTo(WALK_SPEED * STEP * 60, 6);
    expect(mashed.position.p1.x).toBeLessThan(held.position.p1.x);
    held.destroy();
    mashed.destroy();
  });

  it('walks towards a finger, read in the seat own frame', () => {
    // The same point on the glass is a different place on the row for the two seats,
    // because the far seat is reading the board upside down.
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, 520, BOARD_HEIGHT - 80);
    manager.pointerDown(1, 520, 80);
    drive(game, view, manager, 30);
    expect(game.position.p1.x).toBeGreaterThan(START_X);
    expect(game.position.p2.x).toBeLessThan(START_X);
    game.destroy();
  });

  it('stops when it has arrived, rather than shuffling on the spot', () => {
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, ROW_X + START_X, BOARD_HEIGHT - 80);
    drive(game, view, manager, 40);
    expect(Math.abs(game.position.p1.x - START_X)).toBeLessThan(10);
    game.destroy();
  });
});

describe('a whole match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new SpikeAttacksGame();
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

  it('finishes with nobody touching anything, because the volleys keep coming', () => {
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context());
    let steps = 0;
    for (; steps < 60 * 400 && game.getScore().winner === null; steps += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.getScore().winner).toBe('draw');
    expect(game.position.p1.lives).toBe(0);
    game.destroy();
  });

  it('reports rounds won', () => {
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    const score = game.getScore();
    expect(Math.max(score.p1, score.p2)).toBeGreaterThan(0);
    game.destroy();
  });

  it('is level again after a second init', () => {
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 20);
    expect(game.position.rounds).toBeGreaterThan(1);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.rounds).toBe(1);
    expect(game.position.p1.x).toBe(START_X);
    expect(game.position.p1.lives).toBe(LIVES);
    game.destroy();
  });

  it('leaves nothing behind when it is destroyed', () => {
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    drive(game, view, manager, 600);
    game.destroy();
    expect(game.position.rounds).toBe(0);
    expect(game.position.p1.lives).toBe(LIVES);
    expect(game.position.winner).toBeNull();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new SpikeAttacksGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 31 === 0) {
          seen.push(`${game.position.p1.x.toFixed(3)}:${game.position.p2.x.toFixed(3)}`);
        }
      }
      game.destroy();
      return seen.join('|');
    };
    expect(trace('single-seat', 'p2')).toBe(trace('shared-screen', 'p1'));
  });
});

describe('rendering', () => {
  it('draws every shape near the declared box, through a whole match', () => {
    const { renderer, drawn } = recorder();
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 90; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 31 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('never writes a word, so nothing on the board needs translating', () => {
    // Which is what lets one drawing serve two people sitting at opposite ends of it: there
    // is nothing with a right way up and nothing in a language.
    let words = 0;
    const { renderer } = recorder();
    const watched = {
      ...renderer,
      text: () => {
        words += 1;
      },
    };
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 60 * 30; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 31 === 0) game.render(watched);
    }
    game.destroy();
    expect(words).toBe(0);
  });

  it('never rotates: two rows, each already the right way up for its own seat', () => {
    let rotations = 0;
    const { renderer } = recorder();
    const watched = {
      ...renderer,
      pushSeatRotation: () => {
        rotations += 1;
      },
      pushRotation: () => {
        rotations += 1;
      },
    };
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 300; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      game.render(watched);
    }
    game.destroy();
    expect(rotations).toBe(0);
  });

  it('does not move the simulation on', () => {
    const { renderer } = recorder();
    const game = new SpikeAttacksGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const where = game.position.p1.x;
    const timer = game.position.timer;
    for (let i = 0; i < 40; i += 1) game.render(renderer);
    expect(game.position.p1.x).toBe(where);
    expect(game.position.timer).toBe(timer);
    game.destroy();
  });
});
