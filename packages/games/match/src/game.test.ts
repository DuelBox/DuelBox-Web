import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { BOARD, MatchRushGame, SYMBOL_RADIUS, slotPosition } from './game.js';
import { manifest } from './manifest.js';
import { MAX_ROUNDS, SET_SIZE, foundOf, lockOf, setOf } from './rules.js';
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

function drive(game: MatchRushGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** Which slot in a seat's set holds the common symbol. */
function answerFor(game: MatchRushGame, seat: SeatId): number {
  return setOf(game.position, seat).indexOf(game.position.common);
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(BOARD);
    expect(manifest.logical.height).toBe(BOARD);
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new MatchRushGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });
});

describe('the two fans', () => {
  it('sit in their own halves, so each seat can reach its own', () => {
    const point = { x: 0, y: 0 };
    for (let slot = 0; slot < SET_SIZE; slot += 1) {
      slotPosition('p1', slot, point);
      expect(point.y - SYMBOL_RADIUS, `p1 slot ${String(slot)}`).toBeGreaterThan(BOARD / 2);
      slotPosition('p2', slot, point);
      expect(point.y + SYMBOL_RADIUS, `p2 slot ${String(slot)}`).toBeLessThan(BOARD / 2);
    }
  });

  it('are the same arrangement turned half a turn', () => {
    // Which is what lets one board serve two people sitting opposite each other with nothing
    // rotated, and why the same ring index is the same place relative to each of them.
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    for (let slot = 0; slot < SET_SIZE; slot += 1) {
      slotPosition('p1', slot, a);
      slotPosition('p2', slot, b);
      expect(a.x + b.x).toBeCloseTo(BOARD, 6);
      expect(a.y + b.y).toBeCloseTo(BOARD, 6);
    }
  });

  it('keeps every symbol on the board', () => {
    const point = { x: 0, y: 0 };
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (let slot = 0; slot < SET_SIZE; slot += 1) {
        slotPosition(seat, slot, point);
        expect(point.x - SYMBOL_RADIUS).toBeGreaterThanOrEqual(0);
        expect(point.x + SYMBOL_RADIUS).toBeLessThanOrEqual(BOARD);
        expect(point.y - SYMBOL_RADIUS).toBeGreaterThanOrEqual(0);
        expect(point.y + SYMBOL_RADIUS).toBeLessThanOrEqual(BOARD);
      }
    }
  });
});

describe('a finger', () => {
  it('touches the symbol under it, in that seat own half', () => {
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context());
    const slot = answerFor(game, 'p1');
    const point = { x: 0, y: 0 };
    slotPosition('p1', slot, point);

    manager.pointerDown(0, point.x, point.y);
    drive(game, view, manager, 2);
    expect(foundOf(game.position, 'p1')).toBe(slot);
    expect(foundOf(game.position, 'p2')).toBe(-1);
    game.destroy();
  });

  it('cannot reach into the other half', () => {
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context());
    const point = { x: 0, y: 0 };
    slotPosition('p2', answerFor(game, 'p2'), point);
    // A finger in p2's half belongs to p2, so p1 gains nothing by aiming there.
    manager.pointerDown(0, point.x, point.y);
    drive(game, view, manager, 2);
    expect(foundOf(game.position, 'p1')).toBe(-1);
    game.destroy();
  });

  it('is ignored between the symbols', () => {
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, BOARD / 2, BOARD - 30);
    drive(game, view, manager, 2);
    expect(foundOf(game.position, 'p1')).toBe(-1);
    expect(lockOf(game.position, 'p1')).toBe(0);
    game.destroy();
  });

  it('costs a lockout on the wrong symbol', () => {
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context());
    const wrong = (answerFor(game, 'p1') + 1) % SET_SIZE;
    const point = { x: 0, y: 0 };
    slotPosition('p1', wrong, point);
    manager.pointerDown(0, point.x, point.y);
    drive(game, view, manager, 2);
    expect(lockOf(game.position, 'p1')).toBeGreaterThan(0);
    game.destroy();
  });
});

describe('the keyboard', () => {
  it('walks the ring and confirms, for each seat on its own keys', () => {
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context());
    expect(game.cursorOf('p1')).toBe(0);

    manager.keyDown('KeyD');
    drive(game, view, manager, 2);
    manager.keyUp('KeyD');
    drive(game, view, manager, 2);
    expect(game.cursorOf('p1')).toBe(1);
    expect(game.cursorOf('p2')).toBe(0);

    manager.keyDown('ArrowRight');
    drive(game, view, manager, 2);
    manager.keyUp('ArrowRight');
    drive(game, view, manager, 2);
    expect(game.cursorOf('p2')).toBe(1);
    game.destroy();
  });

  it('wraps round the ring rather than stopping at the end', () => {
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyA');
    drive(game, view, manager, 2);
    manager.keyUp('KeyA');
    drive(game, view, manager, 2);
    expect(game.cursorOf('p1')).toBe(SET_SIZE - 1);
    game.destroy();
  });

  it('moves one place for a key held down', () => {
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyD');
    drive(game, view, manager, 120);
    expect(game.cursorOf('p1')).toBe(1);
    game.destroy();
  });

  it('touches what the cursor is on', () => {
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context());
    const target = answerFor(game, 'p1');
    for (let i = 0; i < target; i += 1) {
      manager.keyDown('KeyD');
      drive(game, view, manager, 2);
      manager.keyUp('KeyD');
      drive(game, view, manager, 2);
    }
    expect(game.cursorOf('p1')).toBe(target);
    manager.keyDown('Space');
    drive(game, view, manager, 2);
    expect(foundOf(game.position, 'p1')).toBe(target);
    game.destroy();
  });

  it('carries on from where a finger left the cursor', () => {
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context());
    const slot = (answerFor(game, 'p1') + 2) % SET_SIZE;
    const point = { x: 0, y: 0 };
    slotPosition('p1', slot, point);
    manager.pointerDown(0, point.x, point.y);
    drive(game, view, manager, 2);
    expect(game.cursorOf('p1')).toBe(slot);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new MatchRushGame();
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

  it('finishes with nobody touching anything', () => {
    const game = new MatchRushGame();
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
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 30);
    expect(game.position.rounds).toBeGreaterThan(1);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.rounds).toBe(1);
    expect(game.cursorOf('p1')).toBe(0);
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new MatchRushGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'hard' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 100; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) {
          const score = game.getScore();
          seen.push(`${String(score.p1)}:${String(score.p2)}:${game.position.p1Set.join('')}`);
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

    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 31 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(BOARD * 2);
  });

  it('draws no text at all', () => {
    // A number has a top, and this board is read from both ends. Everything countable here
    // is a pip.
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
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 60 * 40; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 17 === 0) game.render(renderer);
    }
    game.destroy();
    expect(texts).toBe(0);
  });

  it('never rotates: the board is already the same either way up', () => {
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
    const game = new MatchRushGame();
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
    const game = new MatchRushGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const rounds = game.position.rounds;
    const timer = game.position.timer;
    for (let i = 0; i < 40; i += 1) game.render(renderer);
    expect(game.position.rounds).toBe(rounds);
    expect(game.position.timer).toBe(timer);
    game.destroy();
  });
});
