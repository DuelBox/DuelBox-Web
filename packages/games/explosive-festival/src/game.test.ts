import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext } from '@duelbox/game-sdk';
import { ExplosiveFestivalGame } from './game.js';
import { manifest } from './manifest.js';
import {
  CARRIAGE_MIN_X,
  FUSE,
  GROUND,
  LANTERNS,
  MIN_RANGE,
  OPENING,
  ROCKETS,
  lanternsOf,
  launcherOf,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

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
  // A real-time game keeps its two pointer zones: both seats act at once, so a touch belongs
  // to the half it went down in. This is what `GameHost` builds for an `rt-*` game.
  return {
    manager: new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(
  game: ExplosiveFestivalGame,
  view: InputView,
  manager: InputManager,
  steps: number,
): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** Past the opening freeze, so the carts are rolling and a press means something. */
function open(game: ExplosiveFestivalGame, view: InputView, manager: InputManager): void {
  drive(game, view, manager, Math.ceil(OPENING / STEP) + 2);
}

function playOut(game: ExplosiveFestivalGame, view: InputView, manager: InputManager): number {
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
    expect(manifest.logical.width).toBe(GROUND);
    expect(manifest.logical.height).toBe(GROUND);
  });

  it('is a real-time arena with a zone each', () => {
    expect(manifest.archetype).toBe('rt-arena');
    // Not `shared-board`: `GameHost` gives every `rt-*` game two pointer zones whatever the
    // manifest says, and each seat's cart lives on its own end of the device.
    expect(manifest.zoneSplit).toBe('horizontal');
  });

  it('advertises a round long enough to hold a match', () => {
    // Two bots take about 24 seconds and the longest match anybody can play is 56.
    expect(manifest.roundSeconds).toBeGreaterThan(24);
  });

  it('describes both instruments as the same press, and points at nothing', () => {
    // Rule 10: if the pointer line described something a key cannot do, this would be two
    // different games. It is a press and a release on both.
    expect(manifest.controls.keyboard).toMatch(/hold|press/i);
    expect(manifest.controls.pointer).toMatch(/press/i);
    expect(manifest.controls.pointer).not.toMatch(/drag|swipe|flick|aim at|tap the/i);
    expect(manifest.controls.keyboard).toMatch(/player one/i);
    expect(manifest.controls.keyboard).toMatch(/player two/i);
  });
});

describe('whose turn it is', () => {
  it('is nobody, so the shell keeps its two pointer zones', () => {
    // `apps/web/src/data/turn-seat.test.ts` reads the value; a real-time game that named a seat
    // would put the shell into shared-board mode and take one seat's pointer zone away. This
    // one does not implement the method at all, which says the same thing and cannot later be
    // made to say something else by an edit inside it.
    const game: Game = new ExplosiveFestivalGame();
    game.init(context());
    expect(typeof game.getActiveSeat).toBe('undefined');
    expect(game.getActiveSeat?.() ?? null).toBeNull();
    game.destroy();
  });
});

describe('a person', () => {
  it('stops their own cart on their own key and not the other one', () => {
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context());
    open(game, view, manager);

    manager.keyDown('Enter');
    drive(game, view, manager, 1);
    expect(launcherOf(game.ground, 'p1').aiming).toBe(false);
    expect(launcherOf(game.ground, 'p2').aiming).toBe(true);

    manager.keyDown('Space');
    drive(game, view, manager, 1);
    expect(launcherOf(game.ground, 'p1').aiming).toBe(true);
    game.destroy();
  });

  it('fires by letting go, and the rocket goes where the sight was', () => {
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context());
    open(game, view, manager);

    manager.keyDown('Space');
    drive(game, view, manager, 20);
    const column = launcherOf(game.ground, 'p1').x;
    const range = launcherOf(game.ground, 'p1').range;
    expect(range).toBeGreaterThan(MIN_RANGE);

    manager.keyUp('Space');
    drive(game, view, manager, 1);
    expect(launcherOf(game.ground, 'p1').rockets).toBe(ROCKETS - 1);
    expect(game.ground.rockets[0]?.x).toBe(column);
    game.destroy();
  });

  it('presses in their own half, and a touch there is never the other seat', () => {
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context());
    open(game, view, manager);

    // Seat one owns the lower half under a horizontal split. There is nothing to point at, so
    // the position of the touch carries no information at all — which is exactly why a split
    // surface costs this game nothing.
    manager.pointerDown(1, 120, GROUND - 60);
    drive(game, view, manager, 1);
    expect(launcherOf(game.ground, 'p1').aiming).toBe(true);
    expect(launcherOf(game.ground, 'p2').aiming).toBe(false);

    manager.pointerDown(2, GROUND - 120, 60);
    drive(game, view, manager, 1);
    expect(launcherOf(game.ground, 'p2').aiming).toBe(true);
    game.destroy();
  });

  it('gets the same shot from a touch on the far side of their own half', () => {
    // A press has no coordinates, so every column on the ground is reachable from anywhere in
    // a seat's own zone. This is the archetype defect the design exists to avoid: an absolute
    // pointer would make the far half of the arena unreachable for one of the two seats.
    const shot = (x: number, y: number): string => {
      const game = new ExplosiveFestivalGame();
      const { manager, view } = inputs();
      game.init(context());
      open(game, view, manager);
      manager.pointerDown(1, x, y);
      drive(game, view, manager, 24);
      manager.pointerUp(1);
      drive(game, view, manager, 1);
      const rocket = game.ground.rockets[0];
      const description = `${String(rocket?.x)}:${String(rocket?.toY)}`;
      game.destroy();
      return description;
    };
    expect(shot(20, GROUND - 20)).toBe(shot(GROUND - 20, GROUND / 2 + 20));
  });

  it('is never ignored, even when the tap is over inside one frame', () => {
    // On a touchscreen most taps begin and end between two steps: the engine reports them as
    // pressed and released with `actionHeld` never true. Swallowing them outright would look
    // like the game refusing the pointer.
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context());
    open(game, view, manager);
    manager.pointerDown(1, 200, GROUND - 100);
    manager.pointerUp(1);
    drive(game, view, manager, 1);
    expect(launcherOf(game.ground, 'p1').aiming).toBe(true);
    drive(game, view, manager, 1);
    // And the release the very next step is a rocket at the bottom of the gauge: a flick puts
    // one down at your own feet, which is a rule, where nothing at all is not.
    expect(launcherOf(game.ground, 'p1').rockets).toBe(ROCKETS - 1);
    game.destroy();
  });

  it('gets no free press for holding through the opening freeze', () => {
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('Space');
    open(game, view, manager);
    expect(launcherOf(game.ground, 'p1').aiming).toBe(false);
    expect(launcherOf(game.ground, 'p1').x).toBeGreaterThan(CARRIAGE_MIN_X);
    game.destroy();
  });

  it('still finishes the match if they never touch the device at all', () => {
    // The fuse, through the whole stack rather than only in the rules.
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context());
    const steps = playOut(game, view, manager);
    expect(game.getScore().winner).not.toBeNull();
    expect(steps * STEP).toBeLessThan(ROCKETS * (FUSE + 0.45) + OPENING + 2);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of TIERS) {
      const game = new ExplosiveFestivalGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      playOut(game, view, manager);
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      game.destroy();
    }
  });

  it('spends both stocks, whoever is playing', () => {
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: (seat) => (seat === 'p1' ? 'hard' : null) }));
    playOut(game, view, manager);
    expect(game.ground.p1.rockets).toBe(0);
    expect(game.ground.p2.rockets).toBe(0);
    game.destroy();
  });

  it('never reports more lanterns than a field holds', () => {
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    for (let i = 0; i < 60 * 90 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(LANTERNS);
    }
    game.destroy();
  });

  it('takes different tiers seriously', () => {
    // The shell offers three; a game that read the tier and ignored it would type-check.
    const taken = (tier: BotDifficulty): number => {
      const game = new ExplosiveFestivalGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      playOut(game, view, manager);
      const score = game.getScore();
      game.destroy();
      return score.p1 + score.p2;
    };
    expect(taken('hard')).toBeGreaterThan(taken('easy'));
  });

  it('reads the opening seat the shell hands it', () => {
    // Real-time games may ignore `context.openingSeat`; this one reads it because the two cart
    // arrangements are exact mirrors, so it moves the match without favouring anybody.
    const first = new ExplosiveFestivalGame();
    first.init(context({ openingSeat: 'p1' }));
    const second = new ExplosiveFestivalGame();
    second.init(context({ openingSeat: 'p2' }));
    expect(first.ground.p1.x).toBe(second.ground.p2.x);
    expect(first.ground.p2.x).toBe(second.ground.p1.x);
    first.destroy();
    second.destroy();
  });

  it('is level again after a second init', () => {
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 12);
    expect(game.ground.p1.rockets).toBeLessThan(ROCKETS);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.ground.p1.rockets).toBe(ROCKETS);
    expect(game.ground.phase).toBe('opening');
    game.destroy();
  });

  it('leaves nothing behind when it is torn down', () => {
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    drive(game, view, manager, 60 * 12);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.ground.p1.rockets).toBe(ROCKETS);
    for (const rocket of game.ground.rockets) expect(rocket.state).toBe(0);
    for (const lantern of lanternsOf(game.ground, 'p1')) expect(lantern.standing).toBe(true);
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // Nothing in this package reads the presentation, and this is what proves it: single-seat
    // play rotates nothing at all, so anything that keyed off a seat flip would step a
    // different match here.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new ExplosiveFestivalGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'hard' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 30; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 15 === 0) {
          const score = game.getScore();
          seen.push(
            `${String(score.p1)}:${String(score.p2)}:${game.ground.p1.x.toFixed(4)}:${game.ground.p2.range.toFixed(4)}`,
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
    // Tighter than the platform's own logical-size guard, which allows twice the box for
    // strokes and glyph boxes. Nothing here needs the slack: every mark, edge to edge, lands
    // inside the ground the manifest declares.
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    const seeX = (value: number): void => {
      bounds.minX = Math.min(bounds.minX, value);
      bounds.maxX = Math.max(bounds.maxX, value);
    };
    const seeY = (value: number): void => {
      bounds.minY = Math.min(bounds.minY, value);
      bounds.maxY = Math.max(bounds.maxY, value);
    };
    const renderer = {
      ...recorder(noop),
      rect: (x: number, y: number, w: number, h: number) => {
        seeX(x);
        seeX(x + w);
        seeY(y);
        seeY(y + h);
      },
      strokeRect: (x: number, y: number, w: number, h: number) => {
        seeX(x);
        seeX(x + w);
        seeY(y);
        seeY(y + h);
      },
      circle: (x: number, y: number, radius: number) => {
        seeX(x - radius);
        seeX(x + radius);
        seeY(y - radius);
        seeY(y + radius);
      },
      strokeCircle: (x: number, y: number, radius: number) => {
        seeX(x - radius);
        seeX(x + radius);
        seeY(y - radius);
        seeY(y + radius);
      },
      line: (x1: number, y1: number, x2: number, y2: number) => {
        seeX(x1);
        seeX(x2);
        seeY(y1);
        seeY(y2);
      },
    };

    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 40; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 13 === 0) game.render(renderer, 0);
    }
    game.destroy();

    expect(bounds.minX).toBeGreaterThanOrEqual(0);
    expect(bounds.minY).toBeGreaterThanOrEqual(0);
    expect(bounds.maxX).toBeLessThanOrEqual(GROUND);
    expect(bounds.maxY).toBeLessThanOrEqual(GROUND);
    // And it actually drew across the whole ground, rather than passing by drawing nothing.
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(GROUND * 0.9);
    expect(bounds.maxY - bounds.minY).toBeGreaterThan(GROUND * 0.9);
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
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      game.render(renderer, 0);
      // Zero throughout, because the ground is point-symmetric and never turns: pushing a
      // rotation would be the seat flip a shared board does not need.
      expect(depth).toBe(0);
    }
    game.destroy();
  });

  it('draws no text at all', () => {
    // Rule 7: lanterns are shapes, the tally is pips, the fuse is a mark whose length is what
    // is left of it, and the sight is a ring the size of the blast. Nothing needs reading, so
    // nothing needs translating for the player sitting the other way up.
    let texts = 0;
    const renderer = {
      ...recorder(noop),
      text: () => {
        texts += 1;
      },
    };
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 40; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 === 0) game.render(renderer, 0);
    }
    game.destroy();
    expect(texts).toBe(0);
  });

  it('tells the two seats apart by shape as well as by colour', () => {
    // Seat one is round and seat two square, everywhere: lanterns, carts, rockets and pips. A
    // greyscale screen still says which half of the ground is whose.
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
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 90);
    game.render(renderer, 0);
    game.destroy();
    expect(shapes.circles).toBeGreaterThan(LANTERNS);
    expect(shapes.rects).toBeGreaterThan(LANTERNS);
  });

  it('does not move the simulation on', () => {
    const renderer = recorder(noop);
    const game = new ExplosiveFestivalGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const before = JSON.stringify(game.ground);
    for (let i = 0; i < 40; i += 1) game.render(renderer, i / 40);
    expect(JSON.stringify(game.ground)).toBe(before);
  });
});
