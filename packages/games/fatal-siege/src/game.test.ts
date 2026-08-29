import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext } from '@duelbox/game-sdk';
import { FatalSiegeGame } from './game.js';
import { manifest } from './manifest.js';
import {
  BOARD,
  DEPTH,
  MARCH_SPEED,
  OPENING,
  RANGE_MAX,
  RANGE_MIN,
  SOLDIERS,
  SPAWN_INTERVAL,
  sideOf,
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
  // A real-time game keeps its two pointer zones: both seats act at once, so a touch belongs to
  // the half it went down in. This is what `GameHost` builds for an `rt-*` game.
  return {
    manager: new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function drive(game: FatalSiegeGame, view: InputView, manager: InputManager, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** Past the opening freeze, so the guns are traversing and a press means something. */
function openUp(game: FatalSiegeGame, view: InputView, manager: InputManager): void {
  drive(game, view, manager, Math.ceil(OPENING / STEP) + 2);
}

function playOut(game: FatalSiegeGame, view: InputView, manager: InputManager): number {
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

/** Every string either seat is allowed to be drawn in, the way `greyscale.test.ts` reads them. */
const SEAT_COLOURS = new Map<string, SeatId>(
  (['p1', 'p2'] as const).flatMap((seat): [string, SeatId][] => {
    const palette = SEAT_PALETTE[seat];
    return [palette.base, palette.deep, palette.tint, palette.soft].map((colour) => [colour, seat]);
  }),
);

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(BOARD);
    expect(manifest.logical.height).toBe(BOARD);
  });

  it('is a real-time arena with a zone each', () => {
    expect(manifest.archetype).toBe('rt-arena');
    // Not `shared-board`: `GameHost` gives every `rt-*` game two pointer zones whatever the
    // manifest says, and each seat's wall stands at its own end of the device.
    expect(manifest.zoneSplit).toBe('horizontal');
  });

  it('advertises a round long enough to hold the longest match there is', () => {
    // The army is the clock, so this is not a guess: no match can run past the moment the last
    // soldier reaches a gate.
    const longest = OPENING + (SOLDIERS - 1) * SPAWN_INTERVAL + DEPTH / MARCH_SPEED;
    expect(manifest.roundSeconds).toBeGreaterThanOrEqual(Math.ceil(longest));
    expect(manifest.roundSeconds).toBeLessThan(Math.ceil(longest) + 5);
  });

  it('describes both instruments as the same press, and points at nothing', () => {
    // Rule 10: if the pointer line described something a key cannot do, this would be two
    // different games. It is a press and a release on both.
    expect(manifest.controls.keyboard).toMatch(/hold|press/i);
    expect(manifest.controls.pointer).toMatch(/press/i);
    expect(manifest.controls.pointer).not.toMatch(/drag|swipe|flick|aim at|tap the/i);
    expect(manifest.controls.keyboard).toMatch(/player one/i);
    expect(manifest.controls.keyboard).toMatch(/player two/i);
    expect(manifest.sameInputClassOnly).toBe(false);
  });

  it('offers a way to start it alone and a way to start it together', () => {
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
    expect(manifest.presentations).toContain('shared-screen');
    expect(manifest.presentations).toContain('single-seat');
  });
});

describe('whose turn it is', () => {
  it('is nobody, so the shell keeps its two pointer zones', () => {
    // `apps/web/src/data/turn-seat.test.ts` reads the value; a real-time game that named a seat
    // would put the shell into shared-board mode and take one seat's pointer zone away. This one
    // does not implement the method at all, which says the same thing and cannot later be made
    // to say something else by an edit inside it.
    const game: Game = new FatalSiegeGame();
    game.init(context());
    expect(typeof game.getActiveSeat).toBe('undefined');
    expect(game.getActiveSeat?.() ?? null).toBeNull();
    game.destroy();
  });
});

describe('a person', () => {
  it('stops their own gun on their own key and not the other one', () => {
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context());
    openUp(game, view, manager);

    manager.keyDown('Enter');
    drive(game, view, manager, 1);
    expect(sideOf(game.siege, 'p1').turret.aiming).toBe(false);
    expect(sideOf(game.siege, 'p2').turret.aiming).toBe(true);

    manager.keyDown('Space');
    drive(game, view, manager, 1);
    expect(sideOf(game.siege, 'p1').turret.aiming).toBe(true);
    game.destroy();
  });

  it('fires by letting go, and the shot goes where the charge had reached', () => {
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context());
    openUp(game, view, manager);

    manager.keyDown('Space');
    drive(game, view, manager, 20);
    const turret = sideOf(game.siege, 'p1').turret;
    const road = turret.u;
    const range = turret.range;
    expect(range).toBeGreaterThan(RANGE_MIN);

    manager.keyUp('Space');
    drive(game, view, manager, 1);
    expect(turret.loaded).toBe(false);
    expect(sideOf(game.siege, 'p1').shots[0]?.u).toBe(road);
    expect(sideOf(game.siege, 'p1').shots[0]?.range).toBe(range);
    game.destroy();
  });

  it('presses in their own half, and a touch there is never the other seat', () => {
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context());
    openUp(game, view, manager);

    // Seat one owns the lower half under a horizontal split. There is nothing to point at, so
    // the position of the touch carries no information at all — which is exactly why a split
    // surface costs this game nothing.
    manager.pointerDown(1, 120, BOARD - 60);
    drive(game, view, manager, 1);
    expect(sideOf(game.siege, 'p1').turret.aiming).toBe(true);
    expect(sideOf(game.siege, 'p2').turret.aiming).toBe(false);

    manager.pointerDown(2, BOARD - 120, 60);
    drive(game, view, manager, 1);
    expect(sideOf(game.siege, 'p2').turret.aiming).toBe(true);
    game.destroy();
  });

  it('gets the same shot from a touch anywhere in their own half', () => {
    // A press has no coordinates, so every road and every distance is reachable from anywhere in
    // a seat's own zone. This is the archetype defect the design exists to avoid: an absolute
    // pointer would make the far half of the arena unreachable for one of the two seats.
    const shot = (x: number, y: number): string => {
      const game = new FatalSiegeGame();
      const { manager, view } = inputs();
      game.init(context());
      openUp(game, view, manager);
      manager.pointerDown(1, x, y);
      drive(game, view, manager, 24);
      manager.pointerUp(1);
      drive(game, view, manager, 1);
      const fired = sideOf(game.siege, 'p1').shots[0];
      const description = `${String(fired?.u)}:${String(fired?.range)}`;
      game.destroy();
      return description;
    };
    expect(shot(20, BOARD - 20)).toBe(shot(BOARD - 20, BOARD / 2 + 20));
  });

  it('is never ignored, even when the tap is over inside one frame', () => {
    // On a touchscreen most taps begin and end between two steps: the engine reports them as
    // pressed and released with `actionHeld` never true. Swallowing them outright would look
    // like the game refusing the pointer.
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context());
    openUp(game, view, manager);
    manager.pointerDown(1, 200, BOARD - 100);
    manager.pointerUp(1);
    drive(game, view, manager, 1);
    expect(sideOf(game.siege, 'p1').turret.aiming).toBe(true);
    drive(game, view, manager, 1);
    // And the release the very next step is a shot at the bottom of the charge: a flick drops
    // one at the foot of your own wall, which is a rule, where nothing at all is not.
    expect(sideOf(game.siege, 'p1').turret.loaded).toBe(false);
    expect(sideOf(game.siege, 'p1').shots[0]?.range).toBe(RANGE_MIN);
    game.destroy();
  });

  it('gets no free press for holding through the opening freeze', () => {
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('Space');
    openUp(game, view, manager);
    expect(sideOf(game.siege, 'p1').turret.aiming).toBe(false);
    expect(sideOf(game.siege, 'p1').turret.u).toBeGreaterThan(0);
    game.destroy();
  });

  it('still finishes the match if they never touch the device at all', () => {
    // The army is the clock, through the whole stack rather than only in the rules.
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context());
    const steps = playOut(game, view, manager);
    expect(game.getScore().winner).toBe('draw');
    expect(steps * STEP).toBeLessThan(
      OPENING + (SOLDIERS - 1) * SPAWN_INTERVAL + DEPTH / MARCH_SPEED + 0.5,
    );
    game.destroy();
  });

  it('finishes in the same time holding the control down for the whole match', () => {
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('Space');
    manager.keyDown('Enter');
    const steps = playOut(game, view, manager);
    expect(game.getScore().winner).not.toBeNull();
    expect(steps * STEP).toBeLessThan(
      OPENING + (SOLDIERS - 1) * SPAWN_INTERVAL + DEPTH / MARCH_SPEED + 0.5,
    );
    // A held control fires at the top of the charge every time, so it does score — badly.
    for (const shot of sideOf(game.siege, 'p1').shots) {
      if (shot.state !== 0) expect(shot.range).toBe(RANGE_MAX);
    }
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier', () => {
    for (const tier of TIERS) {
      const game = new FatalSiegeGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      playOut(game, view, manager);
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      game.destroy();
    }
  });

  it('spends the whole army on both fields, whoever is playing', () => {
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: (seat) => (seat === 'p1' ? 'hard' : null) }));
    playOut(game, view, manager);
    for (const seat of ['p1', 'p2'] as const) {
      const side = sideOf(game.siege, seat);
      expect(side.smashed + side.through).toBe(SOLDIERS);
    }
    game.destroy();
  });

  it('never reports more ground than the army is worth', () => {
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    for (let i = 0; i < 60 * 40 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(SOLDIERS * 3);
    }
    game.destroy();
  });

  it('takes different tiers seriously', () => {
    // The shell offers three; a game that read the tier and ignored it would type-check.
    const ground = (tier: BotDifficulty): number => {
      const game = new FatalSiegeGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      playOut(game, view, manager);
      const score = game.getScore();
      game.destroy();
      return score.p1 + score.p2;
    };
    expect(ground('hard')).toBeGreaterThan(ground('easy'));
  });

  it('reads the opening seat the shell hands it, and moves both guns together', () => {
    // Real-time games may ignore `context.openingSeat`; this one reads it because it moves
    // *both* guns to the same end of their own rails, which changes the match without changing
    // who is favoured — the two remain exact half-turn images of one another on the board.
    const first = new FatalSiegeGame();
    first.init(context({ openingSeat: 'p1' }));
    const second = new FatalSiegeGame();
    second.init(context({ openingSeat: 'p2' }));
    expect(first.siege.p1.turret.u).toBe(first.siege.p2.turret.u);
    expect(second.siege.p1.turret.u).toBe(second.siege.p2.turret.u);
    expect(first.siege.p1.turret.u).not.toBe(second.siege.p1.turret.u);
    first.destroy();
    second.destroy();
  });

  it('deals the wave from the match seed and nothing the bots do', () => {
    const wave = (difficulty: BotDifficulty): string => {
      const game = new FatalSiegeGame();
      game.init(context({ botDifficulty: () => difficulty }));
      const dealt = game.siege.wave.join(',');
      game.destroy();
      return dealt;
    };
    expect(wave('easy')).toBe(wave('hard'));
  });

  it('is level again after a second init', () => {
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 60 * 12);
    expect(game.getScore().p1 + game.getScore().p2).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.siege.phase).toBe('opening');
    expect(game.siege.released).toBe(0);
    game.destroy();
  });

  it('leaves nothing behind when it is torn down', () => {
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    drive(game, view, manager, 60 * 12);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    for (const seat of ['p1', 'p2'] as const) {
      const side = sideOf(game.siege, seat);
      expect(side.through).toBe(0);
      for (const shot of side.shots) expect(shot.state).toBe(0);
      for (const soldier of side.soldiers) expect(soldier.alive).toBe(false);
    }
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // Nothing in this package reads the presentation, and this is what proves it: single-seat
    // play rotates nothing at all, so anything that keyed off a seat flip would step a different
    // match here.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new FatalSiegeGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'hard' }));
      const seen: string[] = [];
      for (let i = 0; i < 60 * 34 && game.getScore().winner === null; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 15 !== 0) continue;
        const score = game.getScore();
        seen.push(
          `${String(score.p1)}:${String(score.p2)}:` +
            `${game.siege.p1.turret.u.toFixed(4)}:${game.siege.p2.turret.range.toFixed(4)}`,
        );
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
    // Tighter than the platform's own logical-size guard, which allows twice the box for strokes
    // and glyph boxes. Nothing here needs the slack: every mark, edge to edge, lands inside the
    // board the manifest declares.
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    const seeX = (value: number): void => {
      bounds.minX = Math.min(bounds.minX, value);
      bounds.maxX = Math.max(bounds.maxX, value);
    };
    const seeY = (value: number): void => {
      bounds.minY = Math.min(bounds.minY, value);
      bounds.maxY = Math.max(bounds.maxY, value);
    };
    const box = (x: number, y: number, w: number, h: number): void => {
      seeX(x);
      seeX(x + w);
      seeY(y);
      seeY(y + h);
    };
    const disc = (x: number, y: number, radius: number): void => {
      seeX(x - radius);
      seeX(x + radius);
      seeY(y - radius);
      seeY(y + radius);
    };
    const renderer = {
      ...recorder(noop),
      rect: box,
      strokeRect: box,
      circle: disc,
      strokeCircle: disc,
      line: (x1: number, y1: number, x2: number, y2: number) => {
        seeX(x1);
        seeX(x2);
        seeY(y1);
        seeY(y2);
      },
    };

    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 34; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 13 === 0) game.render(renderer, 0);
    }
    game.destroy();

    expect(bounds.minX).toBeGreaterThanOrEqual(0);
    expect(bounds.minY).toBeGreaterThanOrEqual(0);
    expect(bounds.maxX).toBeLessThanOrEqual(BOARD);
    expect(bounds.maxY).toBeLessThanOrEqual(BOARD);
    // And it actually drew across the whole board, rather than passing by drawing nothing.
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(BOARD * 0.9);
    expect(bounds.maxY - bounds.minY).toBeGreaterThan(BOARD * 0.9);
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
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      game.render(renderer, 0);
      // Zero throughout, because the board is point-symmetric and never turns: pushing a
      // rotation would be the seat flip a shared board does not need.
      expect(depth).toBe(0);
    }
    game.destroy();
  });

  it('draws no text at all', () => {
    // Rule 7: soldiers are shapes, the wall's damage is notches, the charge is a ring the size
    // of the blast. Nothing needs reading, so nothing needs translating for the player sitting
    // the other way up.
    let texts = 0;
    const renderer = {
      ...recorder(noop),
      text: () => {
        texts += 1;
      },
    };
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 34; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 === 0) game.render(renderer, 0);
    }
    game.destroy();
    expect(texts).toBe(0);
  });

  it('never draws one seat’s material with the other seat’s primitive', () => {
    // The local form of `apps/web/src/data/greyscale.test.ts`, and stronger than it: every mark
    // in seat one's palette is a circle and every mark in seat two's is a rectangle, over a
    // whole match. There is no glyph the two seats share at all, so a greyscale screen still
    // says which half of the board is whose.
    const kinds: Record<SeatId, Set<string>> = { p1: new Set(), p2: new Set() };
    let neutral = 0;
    const note =
      (kind: string) =>
      (colour: string): void => {
        const seat = SEAT_COLOURS.get(colour);
        if (seat === undefined) neutral += 1;
        else kinds[seat].add(kind);
      };
    const renderer = {
      ...recorder(noop),
      rect: (_x: number, _y: number, _w: number, _h: number, colour: string) =>
        note('rect')(colour),
      strokeRect: (_x: number, _y: number, _w: number, _h: number, _lw: number, colour: string) =>
        note('rect')(colour),
      circle: (_x: number, _y: number, _r: number, colour: string) => note('circle')(colour),
      strokeCircle: (_x: number, _y: number, _r: number, _lw: number, colour: string) =>
        note('circle')(colour),
      line: (_x1: number, _y1: number, _x2: number, _y2: number, _lw: number, colour: string) =>
        note('line')(colour),
    };
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 34; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 7 === 0) game.render(renderer, 0);
    }
    game.destroy();

    expect([...kinds.p1].sort()).toEqual(['circle']);
    expect([...kinds.p2].sort()).toEqual(['rect']);
    expect(neutral).toBeGreaterThan(0);
  });

  it('draws the two seats as exact mirror images when neither is touched', () => {
    // Rule 9 through the renderer rather than through the rules: with both guns untouched the
    // picture is its own half-turn, so neither seat sees more of the play area than the other
    // and neither has the easier half. Marks are compared as multisets of `(kind, size)` at a
    // point and its opposite number through the centre.
    const marks: string[] = [];
    const at = (kind: string, x: number, y: number, ...dims: number[]): void => {
      marks.push(
        `${kind}@${x.toFixed(4)},${y.toFixed(4)}:${dims.map((d) => d.toFixed(4)).join(',')}`,
      );
    };
    const flip = (mark: string): string => {
      const [head, dims] = mark.split(':') as [string, string];
      const [kind, point] = head.split('@') as [string, string];
      const [x, y] = point.split(',').map(Number) as [number, number];
      return `${kind}@${(BOARD - x).toFixed(4)},${(BOARD - y).toFixed(4)}:${dims}`;
    };
    const renderer = {
      ...recorder(noop),
      rect: (x: number, y: number, w: number, h: number) => at('box', x + w / 2, y + h / 2, w, h),
      strokeRect: (x: number, y: number, w: number, h: number, lw: number) =>
        at('sbox', x + w / 2, y + h / 2, w, h, lw),
      circle: (x: number, y: number, r: number) => at('box', x, y, 2 * r, 2 * r),
      strokeCircle: (x: number, y: number, r: number, lw: number) =>
        at('sbox', x, y, 2 * r, 2 * r, lw),
      line: (x1: number, y1: number, x2: number, y2: number, lw: number) =>
        at('line', (x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1), Math.abs(y2 - y1), lw),
    };
    // The seat shapes differ on purpose (rule 7), so a circle and a square of the same size
    // count as the same mark here: this test is about *placement*, and the shape difference is
    // what the test above asserts.
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context());
    let reached = 0;
    for (const frame of [40, 400, 1200, 1900]) {
      drive(game, view, manager, frame - reached);
      reached = frame;
      marks.length = 0;
      game.render(renderer, 0);
      expect(marks.length).toBeGreaterThan(20);
      expect(marks.map(flip).sort(), `frame ${String(frame)}`).toEqual([...marks].sort());
    }
    game.destroy();
  });

  it('does not move the simulation on', () => {
    const renderer = recorder(noop);
    const game = new FatalSiegeGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    drive(game, view, manager, 200);
    const before = JSON.stringify(game.siege);
    for (let i = 0; i < 40; i += 1) game.render(renderer, i / 40);
    expect(JSON.stringify(game.siege)).toBe(before);
  });
});
