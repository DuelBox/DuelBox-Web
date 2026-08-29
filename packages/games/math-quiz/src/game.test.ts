import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { BOARD_HEIGHT, BOARD_WIDTH, MathQuizGame } from './game.js';
import { manifest } from './manifest.js';
import { ANSWER_COUNT, QUESTIONS, QUESTION_SECONDS, REVEAL_SECONDS, answerOf } from './rules.js';
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

function drive(game: MathQuizGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** The key each seat presses for the answer in the given diamond slot. */
const KEYS: Record<SeatId, readonly string[]> = {
  p1: ['KeyW', 'KeyA', 'KeyS', 'KeyD'],
  p2: ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'],
};

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new MathQuizGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });
});

describe('the four keys name the four answers', () => {
  it('maps each seat to its own half of the keyboard', () => {
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      for (let slot = 0; slot < ANSWER_COUNT; slot += 1) {
        const game = new MathQuizGame();
        const { manager, view } = inputs();
        game.init(context());
        manager.keyDown(KEYS[seat][slot]!);
        drive(game, view, manager, 2);
        expect(answerOf(game.position, seat), `${seat} slot ${String(slot)}`).toBe(slot);
        game.destroy();
      }
    }
  });

  it('never lets one seat answer for the other', () => {
    const game = new MathQuizGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyW');
    drive(game, view, manager, 2);
    expect(answerOf(game.position, 'p1')).toBe(0);
    expect(answerOf(game.position, 'p2')).toBe(-1);
    game.destroy();
  });

  it('answers once for a key held down', () => {
    // The answer cannot be changed anyway, but a held key must not consume the next
    // question the instant it appears.
    const game = new MathQuizGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyW');
    // Long enough for the first question to time out and the next to arrive. p1's answer
    // may well have been wrong, and a wrong answer waits for the other player rather than
    // ending the question, so this is the whole question clock plus the reveal.
    drive(game, view, manager, Math.round(60 * (QUESTION_SECONDS + REVEAL_SECONDS + 1)));
    // The second question is up, and it must still be waiting for a fresh press.
    expect(game.position.asked).toBeGreaterThan(1);
    expect(answerOf(game.position, 'p1')).toBe(-1);
    game.destroy();
  });
});

describe('a finger', () => {
  it('answers by tapping a tile in the near half', () => {
    const game = new MathQuizGame();
    const { manager, view } = inputs();
    game.init(context());
    // The "down" tile of p1's diamond: below the diamond centre, in the bottom half.
    manager.pointerDown(0, BOARD_WIDTH / 2, BOARD_HEIGHT / 2 + (BOARD_HEIGHT / 2) * 0.52 + 118);
    drive(game, view, manager, 2);
    expect(answerOf(game.position, 'p1')).toBe(2);
    game.destroy();
  });

  it('answers by tapping the mirrored tile in the far half', () => {
    // The far panel is the near one turned half a turn, so its "down" tile is the near
    // one reflected through the centre of the board.
    const nearX = BOARD_WIDTH / 2;
    const nearY = BOARD_HEIGHT / 2 + (BOARD_HEIGHT / 2) * 0.52 + 118;
    const game = new MathQuizGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, BOARD_WIDTH - nearX, BOARD_HEIGHT - nearY);
    drive(game, view, manager, 2);
    expect(answerOf(game.position, 'p2')).toBe(2);
    expect(answerOf(game.position, 'p1')).toBe(-1);
    game.destroy();
  });

  it('ignores a tap that is not on a tile', () => {
    const game = new MathQuizGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, 8, BOARD_HEIGHT - 8);
    drive(game, view, manager, 2);
    expect(answerOf(game.position, 'p1')).toBe(-1);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new MathQuizGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      for (; steps < 60 * 400 && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      expect(game.position.asked).toBe(QUESTIONS);
      game.destroy();
    }
  });

  it('is level again after a second init', () => {
    const game = new MathQuizGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    drive(game, view, manager, 60 * 40);
    expect(game.position.asked).toBeGreaterThan(1);

    game.init(context({ botDifficulty: () => 'hard' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.asked).toBe(1);
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new MathQuizGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 200; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 40 === 0) {
          const score = game.getScore();
          seen.push(`${String(score.p1)}:${String(score.p2)}:${String(game.position.asked)}`);
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

    const game = new MathQuizGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 200; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 9 === 0) game.render(renderer, 0);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('balances every rotation it pushes', () => {
    // Two panels are drawn under two rotations every frame; an unbalanced pair would leave
    // the next game the shell loads drawing sideways.
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
    const game = new MathQuizGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 400; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      game.render(renderer, 0);
      expect(depth).toBe(0);
    }
    game.destroy();
  });
});
