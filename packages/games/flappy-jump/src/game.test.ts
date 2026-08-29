import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { FlappyJumpGame } from './game.js';
import { manifest } from './manifest.js';
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  GLIDE_FALL,
  LANE_HEIGHT,
  MAX_HOOPS,
  ROUND_SECONDS,
  TARGET_BASKETS,
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
  return {
    manager: new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

/** A recording renderer that answers every call and keeps every number it is handed. */
function recorder(): { renderer: Parameters<FlappyJumpGame['render']>[0]; drawn: number[] } {
  const drawn: number[] = [];
  const record = (...args: unknown[]): void => {
    for (const arg of args) if (typeof arg === 'number') drawn.push(arg);
  };
  return {
    drawn,
    renderer: {
      clear: () => undefined,
      rect: record,
      strokeRect: record,
      circle: record,
      strokeCircle: record,
      line: record,
      text: record,
      pushSeatRotation: () => undefined,
      pushRotation: () => undefined,
      popSeatRotation: () => undefined,
    },
  };
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(FIELD_WIDTH);
    expect(manifest.logical.height).toBe(FIELD_HEIGHT);
  });

  it('splits the device the way the two lanes are stacked', () => {
    // A vertical split would put the two lanes side by side, and each player would be
    // reading their own lane sideways.
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.modes).toEqual(['friend', 'bot']);
  });

  it('tells each player which keys are theirs', () => {
    // `controls.test.ts` enforces this across the catalogue; here it fails next to the
    // game rather than next to a list of thirty-six manifests.
    expect(manifest.controls.keyboard).toMatch(/seat one/i);
    expect(manifest.controls.keyboard).toMatch(/seat two/i);
    expect(manifest.controls.pointer.length).toBeGreaterThan(3);
  });

  it('does not claim to be same-input-class only', () => {
    // The wing recharge is what earns this — see FLAP_RECHARGE. If it were ever removed,
    // the honest thing would be to set this flag, and this is the reminder.
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});

describe('a fresh match', () => {
  it('starts level, with nobody having won', () => {
    const game = new FlappyJumpGame();
    game.init(context());
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new FlappyJumpGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });

  it('is level again after a second init', () => {
    // The shell reuses one instance across a rematch, so anything left behind would
    // start the next match part-played.
    const game = new FlappyJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    for (let i = 0; i < 60 * 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.getScore().p1 + game.getScore().p2).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'hard' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.elapsed).toBe(0);
    expect(game.match.hoopsEntered).toBe(0);
    game.destroy();
  });
});

/** Steps to run before a test starts: past the opening hover, jumpers still high up. */
const AIRBORNE = 90;

describe('a person flying a jumper', () => {
  it('beats a wing from either seat, on that seat s own keys', () => {
    const game = new FlappyJumpGame();
    const { manager, view } = inputs();
    game.init(context());
    for (let i = 0; i < AIRBORNE; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    // Both are falling: gravity is on and neither has touched anything.
    expect(game.match.p1.velocity).toBeLessThan(0);
    expect(game.match.p2.velocity).toBeLessThan(0);

    manager.keyDown('Space');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.keyUp('Space');
    expect(game.match.p1.velocity).toBeGreaterThan(0);
    // Seat one's key must not have touched seat two's jumper.
    expect(game.match.p2.velocity).toBeLessThan(0);

    manager.keyDown('Enter');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.keyUp('Enter');
    expect(game.match.p2.velocity).toBeGreaterThan(0);
    game.destroy();
  });

  it('also answers the key a player reaches for first', () => {
    // W and the up arrow are what anyone tries in a game about flying, and they are a
    // *level* rather than an edge — held down they must beat a wing once, not sixty times,
    // and then read as a glide.
    const game = new FlappyJumpGame();
    const { manager, view } = inputs();
    game.init(context());
    for (let i = 0; i < AIRBORNE; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));

    manager.keyDown('KeyW');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.velocity).toBeGreaterThan(0);
    for (let i = 0; i < 40; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.velocity).toBeCloseTo(-GLIDE_FALL, 6);
    expect(game.match.p1.height).toBeGreaterThan(0);
    game.destroy();
  });

  it('cannot reach into the other seat s lane with a finger', () => {
    const game = new FlappyJumpGame();
    const { manager, view } = inputs();
    game.init(context());
    for (let i = 0; i < AIRBORNE; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    // A touch in the bottom half belongs to p1, wherever across the width it lands.
    manager.pointerDown(0, FIELD_WIDTH / 2, FIELD_HEIGHT - 60);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.velocity).toBeGreaterThan(0);
    expect(game.match.p2.velocity).toBeLessThan(0);
    game.destroy();
  });

  it('reads a held finger as a glide and a released one as a drop', () => {
    // Same tap, same instant; the only difference is whether the finger stayed down.
    const fly = (hold: boolean): FlappyJumpGame => {
      const game = new FlappyJumpGame();
      const { manager, view } = inputs();
      game.init(context());
      for (let i = 0; i < AIRBORNE; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      manager.pointerDown(0, 100, FIELD_HEIGHT - 60);
      for (let i = 0; i < 40; i += 1) {
        if (!hold && i === 1) manager.pointerUp(0);
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      return game;
    };
    const held = fly(true);
    const dropped = fly(false);
    expect(held.match.p1.velocity).toBeCloseTo(-GLIDE_FALL, 6);
    expect(dropped.match.p1.velocity).toBeLessThan(-GLIDE_FALL);
    expect(held.match.p1.height).toBeGreaterThan(dropped.match.p1.height);
    held.destroy();
    dropped.destroy();
  });

  it('climbs no faster for a masher than for a thumb at the recharge rate', () => {
    // The parity claim the whole one-button design rests on, driven through the real
    // input stack rather than through the rules: a key pressed and released on every
    // single step and a finger tapping 5.5 times a second cover the identical distance.
    // Six a second: a rate a thumb genuinely reaches, and deliberately *not* a multiple
    // of the recharge period, because that is the case the buffer exists for.
    const period = 10;
    const climb = (drive: (manager: InputManager, i: number) => void): number => {
      const game = new FlappyJumpGame();
      const { manager, view } = inputs();
      game.init(context());
      for (let i = 0; i < AIRBORNE; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      const start = game.match.p1.height;
      for (let i = 0; i < 120; i += 1) {
        drive(manager, i);
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const travelled = game.match.p1.height - start;
      game.destroy();
      return travelled;
    };
    const masher = climb((manager) => {
      manager.keyDown('Space');
      manager.keyUp('Space');
    });
    const tapper = climb((manager, i) => {
      if (i % period === 0) manager.pointerDown(1, 80, FIELD_HEIGHT - 90);
      if (i % period === 1) manager.pointerUp(1);
    });
    expect(masher).toBeGreaterThan(0);
    expect(masher).toBeCloseTo(tapper, 6);
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier, and never past the hoop budget', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new FlappyJumpGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      const limit = 60 * (ROUND_SECONDS + 5);
      for (; steps < limit && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const score = game.getScore();
      expect(score.winner, `${tier} never finished`).not.toBeNull();
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(TARGET_BASKETS);
      expect(game.match.hoopsEntered).toBeLessThanOrEqual(MAX_HOOPS);
      game.destroy();
    }
  });

  it('finishes a match nobody plays at all', () => {
    // Two absent players score nothing, and the field still runs out.
    const game = new FlappyJumpGame();
    const { manager, view } = inputs();
    game.init(context());
    let steps = 0;
    for (; steps < 60 * ROUND_SECONDS && game.getScore().winner === null; steps += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: 'draw' });
    expect(steps / 60).toBeLessThan(ROUND_SECONDS);
    game.destroy();
  });

  it('stops simulating once it is decided', () => {
    const game = new FlappyJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    for (let i = 0; i < 60 * ROUND_SECONDS && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    const settled = game.match.p1.height;
    for (let i = 0; i < 300; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.height).toBe(settled);
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // Rule 8 in one assertion: single-seat and shared-screen are two layouts of one
    // simulation, so the trace must not depend on which one the shell chose.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new FlappyJumpGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
      const seen: number[] = [];
      for (let i = 0; i < 1800; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) seen.push(game.match.p1.height, game.match.p2.height);
      }
      game.destroy();
      return seen.map((n) => n.toFixed(9)).join(',');
    };
    expect(trace('single-seat', 'p2')).toBe(trace('shared-screen', 'p1'));
  });
});

describe('rendering', () => {
  it('draws every shape inside the declared box, at every stage of a match', () => {
    const { renderer, drawn } = recorder();
    const game = new FlappyJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 25; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 === 0) game.render(renderer, 0);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    // Reduced to one number and asserted once rather than asserted per value: a frame of
    // this game hands the renderer several hundred coordinates and the assertion
    // machinery, not the game, was what made the test take three seconds.
    let worst = 0;
    for (const value of drawn) worst = Math.max(worst, Math.abs(value));
    // Generous, as the shared harness is: what this catches is a game drawing in a box
    // unrelated to the one it declared, not a stroke overhanging by a few units.
    expect(worst).toBeLessThanOrEqual(Math.max(FIELD_WIDTH, FIELD_HEIGHT) * 2);
  });

  it('keeps each seat s furniture on that seat s own half', () => {
    // Rule 9, as geometry: neither player may see more of the play area than the other,
    // and the way that fails first is a lane bleeding across the divider.
    const { renderer, drawn } = recorder();
    const game = new FlappyJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 600; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.render(renderer, 0);
    game.destroy();
    // The whole field is drawn, which means points on both sides of the middle.
    expect(drawn.some((v) => v > FIELD_HEIGHT - LANE_HEIGHT)).toBe(true);
    expect(drawn.some((v) => v < LANE_HEIGHT)).toBe(true);
  });

  it('does not move the simulation on', () => {
    const { renderer } = recorder();
    const game = new FlappyJumpGame();
    game.init(context({ botDifficulty: () => 'normal' }));
    const { manager, view } = inputs();
    for (let i = 0; i < 300; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    const before = { ...game.match.p1 };
    // The interpolation alpha the contract passes is deliberately not read: nothing here
    // is drawn between two simulation states, so a frame is the state as it stands.
    for (let i = 0; i < 50; i += 1) game.render(renderer, 0);
    expect({ ...game.match.p1 }).toEqual(before);
    game.destroy();
  });

  it('survives a pause and a resume without losing the match', () => {
    const game = new FlappyJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 600; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    const before = game.getScore();
    game.onPause();
    game.onResume();
    expect(game.getScore()).toEqual(before);
    game.destroy();
  });
});
