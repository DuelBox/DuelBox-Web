import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { GameContext, Renderer } from '@duelbox/game-sdk';
import { TheLastSashimiGame } from './game.js';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MAX_ROUNDS,
  ONIGIRI_POINTS,
  READY_SECONDS,
  SETTLE_SECONDS,
  TURN_SECONDS,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

function context(overrides: Partial<GameContext> = {}): GameContext {
  return {
    manifest,
    rng: new Rng(20260829),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: () => null,
    ...overrides,
  };
}

function inputs(): { manager: InputManager; view: InputView } {
  // A turn game owns the whole pointer surface: the board turns to face whoever is eating.
  return {
    manager: new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(
  game: TheLastSashimiGame,
  view: InputView,
  manager: InputManager,
  steps: number,
): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

function tap(game: TheLastSashimiGame, view: InputView, manager: InputManager, key: string): void {
  manager.keyDown(key);
  drive(game, view, manager, 2);
  manager.keyUp(key);
  drive(game, view, manager, 2);
}

/** Past the ready freeze, so the chopsticks are live and a press means something. */
function ready(game: TheLastSashimiGame, view: InputView, manager: InputManager): void {
  drive(game, view, manager, Math.ceil(READY_SECONDS * 60) + 2);
}

function playOut(game: TheLastSashimiGame, view: InputView, manager: InputManager): number {
  let steps = 0;
  for (; steps < 60 * 600 && game.getScore().winner === null; steps += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
  }
  return steps;
}

const noop = (): void => undefined;

function recorder(record: (...args: unknown[]) => void): Renderer {
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

describe('whose turn it is', () => {
  it('is reported, so the shell turns the board and hands over the whole surface', () => {
    const game = new TheLastSashimiGame();
    game.init(context());
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('starts with the seat the shell nominated, not always seat one', () => {
    // Issue #2466. On a shared belt the opener genuinely picks first, so this is not a formality
    // here — see the course rule in `rules.ts` for what it is worth.
    const game = new TheLastSashimiGame();
    game.init(context({ openingSeat: 'p2' }));
    expect(game.getActiveSeat()).toBe('p2');
    game.destroy();
  });

  it('passes once the turn has run out and settled', () => {
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context());
    drive(game, view, manager, Math.ceil((READY_SECONDS + TURN_SECONDS + SETTLE_SECONDS) * 60) + 8);
    expect(game.getActiveSeat()).toBe('p2');
    game.destroy();
  });
});

describe('a person eating', () => {
  it('presses on their own key and not the other one', () => {
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context());
    ready(game, view, manager);

    tap(game, view, manager, 'Enter');
    expect(game.counter.bites).toBe(0);

    tap(game, view, manager, 'Space');
    expect(game.counter.bites).toBe(1);
    game.destroy();
  });

  it('presses from a tap anywhere, because there is nothing to point at', () => {
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context());
    ready(game, view, manager);
    manager.pointerDown(0, 60, 60);
    drive(game, view, manager, 2);
    expect(game.counter.bites).toBe(1);
    game.destroy();
  });

  it('is refused during the ready freeze, which is the rules and not the shell', () => {
    // The freeze is in `rules.ts` on purpose: `seatView` reports no rotation in single-seat play,
    // so a freeze that keyed off the flip would step two different matches.
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context());
    drive(game, view, manager, 4);
    tap(game, view, manager, 'Space');
    expect(game.counter.phase).toBe('ready');
    expect(game.counter.bites).toBe(0);
    game.destroy();
  });

  it('is ignored while the board is part-way round', () => {
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context());
    let handedOver = false;
    for (let i = 0; i < 60 * 20 && !handedOver; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      handedOver = game.getActiveSeat() === 'p2';
    }
    expect(handedOver, 'the turn never passed').toBe(true);

    // Mid-flip: refused, and the rules would have refused it anyway — which is the point. The
    // ready freeze outlasts the flip, so this gate never costs a press the simulation wanted.
    tap(game, view, manager, 'Enter');
    expect(game.counter.bites).toBe(0);

    ready(game, view, manager);
    tap(game, view, manager, 'Enter');
    expect(game.counter.bites).toBe(1);
    game.destroy();
  });

  it('spends the turn if no press ever comes', () => {
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context());
    drive(game, view, manager, 60 * 10);
    expect(game.counter.p1Turns).toBeGreaterThan(0);
    expect(game.getScore().p1).toBe(0);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier, from either opening seat', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      for (const openingSeat of ['p1', 'p2'] as SeatId[]) {
        const game = new TheLastSashimiGame();
        const { manager, view } = inputs();
        game.init(context({ botDifficulty: () => tier, openingSeat }));
        playOut(game, view, manager);
        expect(game.getScore().winner, `${tier} from ${openingSeat} never finished`).not.toBeNull();
        expect(game.counter.round).toBeLessThanOrEqual(MAX_ROUNDS);
        game.destroy();
      }
    }
  });

  it('gives both seats the same number of turns', () => {
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    playOut(game, view, manager);
    expect(game.counter.p1Turns).toBe(game.counter.p2Turns);
    game.destroy();
  });

  it('never reports a score no run of presses could have produced', () => {
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      const counter = game.counter;
      expect(score.p1).toBe(counter.p1Points);
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(
        MAX_ROUNDS * counter.slots.length * ONIGIRI_POINTS,
      );
    }
    game.destroy();
  });

  it('takes different tiers seriously', () => {
    // The shell offers three; a game that read the tier and ignored it would type-check.
    const perTurn = (tier: BotDifficulty): number => {
      const game = new TheLastSashimiGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      playOut(game, view, manager);
      const score = game.getScore();
      const turns = game.counter.p1Turns + game.counter.p2Turns;
      game.destroy();
      return (score.p1 + score.p2) / turns;
    };
    expect(perTurn('hard')).toBeGreaterThan(perTurn('easy'));
  });

  it('is level again after a second init', () => {
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 20);
    expect(game.counter.p1Turns).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.counter.p1Turns).toBe(0);
    expect(game.counter.clock).toBe(0);
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // The seat flip is a *drawing*, and this is what proves it: single-seat play rotates nothing
    // at all, so anything that read the flip would step a different match here.
    const trace = (presentation: Presentation, localSeat: SeatId): string => {
      const game = new TheLastSashimiGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'hard' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 40; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 15 === 0) {
          const score = game.getScore();
          seen.push(
            `${String(score.p1)}:${String(score.p2)}:${game.counter.clock.toFixed(5)}:${String(game.counter.bites)}`,
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

    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 17 === 0) game.render(renderer, 0);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    const limit = Math.max(BOARD_WIDTH, BOARD_HEIGHT);
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
    } as unknown as Renderer;
    const game = new TheLastSashimiGame();
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
    // Rule 7: points are pips, the two plates are told apart by outline, and an outcome is a
    // ring or a cross. Nothing here needs reading, so nothing needs translating.
    let texts = 0;
    const renderer = {
      ...recorder(noop),
      text: () => {
        texts += 1;
      },
    } as unknown as Renderer;
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 === 0) game.render(renderer, 0);
    }
    game.destroy();
    expect(texts).toBe(0);
  });

  it('tells the two seats apart by shape as well as by colour, in every frame', () => {
    // Rule 7 from the seats' side, and the check `greyscale.test.ts` performs: seat one's owned
    // marks are round and seat two's square, and both are on screen every frame — a turn game
    // whose board belongs wholly to whoever is to move cannot be judged at all.
    const shapes = { p1: 0, p2: 0 };
    const count = (colour: unknown, seat: 'p1' | 'p2'): void => {
      const palette = SEAT_PALETTE[seat];
      if (
        colour === palette.base ||
        colour === palette.deep ||
        colour === palette.tint ||
        colour === palette.soft
      ) {
        shapes[seat] += 1;
      }
    };
    const renderer = {
      ...recorder(noop),
      circle: (_x: number, _y: number, _r: number, colour: string) => {
        count(colour, 'p1');
        // A circle in seat two's colour would break the discriminator entirely.
        expect(colour).not.toBe(SEAT_PALETTE.p2.base);
      },
      strokeCircle: (_x: number, _y: number, _r: number, _w: number, colour: string) => {
        count(colour, 'p1');
        expect(colour).not.toBe(SEAT_PALETTE.p2.base);
      },
      rect: (_x: number, _y: number, _w: number, _h: number, colour: string) => {
        count(colour, 'p2');
        expect(colour).not.toBe(SEAT_PALETTE.p1.base);
      },
      strokeRect: (_x: number, _y: number, _w: number, _h: number, _l: number, colour: string) => {
        count(colour, 'p2');
        expect(colour).not.toBe(SEAT_PALETTE.p1.base);
      },
    };
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 30; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 7 !== 0) continue;
      shapes.p1 = 0;
      shapes.p2 = 0;
      game.render(renderer, 0);
      expect(shapes.p1, 'seat one drew nothing of its own this frame').toBeGreaterThan(0);
      expect(shapes.p2, 'seat two drew nothing of its own this frame').toBeGreaterThan(0);
    }
    game.destroy();
  });

  it('tells the two plates apart by outline, not only by colour', () => {
    // A slice is a rectangle and a rice ball is a triangle drawn from three lines, so the thing
    // a player is choosing between is legible in greyscale as well as the seats are.
    const kinds = { rects: 0, lines: 0 };
    const renderer = {
      ...recorder(noop),
      rect: () => {
        kinds.rects += 1;
      },
      line: () => {
        kinds.lines += 1;
      },
    } as unknown as Renderer;
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60);
    game.render(renderer, 0);
    game.destroy();
    expect(kinds.rects).toBeGreaterThan(4);
    expect(kinds.lines).toBeGreaterThan(4);
  });

  it('does not move the simulation on', () => {
    const renderer = recorder(noop);
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const clock = game.counter.clock;
    const bites = game.counter.bites;
    for (let i = 0; i < 40; i += 1) game.render(renderer, 0);
    expect(game.counter.clock).toBe(clock);
    expect(game.counter.bites).toBe(bites);
    game.destroy();
  });

  it('draws the same picture at every render alpha, because it interpolates nothing', () => {
    const at = (alpha: number): string => {
      const drawn: number[] = [];
      const renderer = recorder((...args: unknown[]) => {
        for (const arg of args) if (typeof arg === 'number') drawn.push(arg);
      });
      const game = new TheLastSashimiGame();
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
    const game = new TheLastSashimiGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 20);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.counter.clock).toBe(0);
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60);
    expect(game.counter.clock).toBeGreaterThan(0);
    game.destroy();
  });
});
