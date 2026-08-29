import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { HappyBirdsGame } from './game.js';
import { manifest } from './manifest.js';
import {
  BIRD_RADIUS,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  FLIGHTS_TO_WIN,
  MATCH_SECONDS,
  MAX_FLIGHTS,
  SKY_HEIGHT,
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

function inputs(): { manager: InputManager; view: InputView } {
  return {
    manager: new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

/** A recording renderer that answers every call and keeps every number it is handed. */
function recorder(): { renderer: Parameters<HappyBirdsGame['render']>[0]; drawn: number[] } {
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

/**
 * Steps to run before a control test starts.
 *
 * Past the opening hover, so gravity is on and both birds are falling, and comfortably
 * before the first wall arrives, so nothing here is decided by a crash.
 */
const AIRBORNE = 80;

function airborne(overrides: Partial<GameContext> = {}): {
  game: HappyBirdsGame;
  manager: InputManager;
  view: InputView;
} {
  const game = new HappyBirdsGame();
  const { manager, view } = inputs();
  game.init(context(overrides));
  for (let i = 0; i < AIRBORNE; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
  return { game, manager, view };
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(FIELD_WIDTH);
    expect(manifest.logical.height).toBe(FIELD_HEIGHT);
  });

  it('splits the device the way the two skies are stacked', () => {
    // A vertical split would put the two skies side by side and each player would be
    // reading their own one sideways.
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.modes).toEqual(['friend', 'bot']);
  });

  it('tells each player which keys are theirs', () => {
    // `controls.test.ts` enforces this across the catalogue; here it fails next to the
    // game rather than next to a list of seventy manifests.
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

describe('the control strings are true', () => {
  // Control strings that lie are a recurring defect here, so each clause of both strings
  // is driven through the real input stack and checked rather than trusted.
  it('flaps seat one on Space and seat two on Enter, as the keyboard line says', () => {
    const { game, manager, view } = airborne();
    expect(game.match.p1.velocity).toBeLessThan(0);
    expect(game.match.p2.velocity).toBeLessThan(0);

    manager.keyDown('Space');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.keyUp('Space');
    expect(game.match.p1.velocity).toBeGreaterThan(0);
    // Seat one's key must not have touched seat two's bird.
    expect(game.match.p2.velocity).toBeLessThan(0);

    manager.keyDown('Enter');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.keyUp('Enter');
    expect(game.match.p2.velocity).toBeGreaterThan(0);
    game.destroy();
  });

  it('flaps seat one on W and seat two on Up, as the keyboard line says', () => {
    const { game, manager, view } = airborne();
    manager.keyDown('KeyW');
    manager.keyDown('ArrowUp');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.velocity).toBeGreaterThan(0);
    expect(game.match.p2.velocity).toBeGreaterThan(0);
    game.destroy();
  });

  it('beats once for a held up key rather than sixty times', () => {
    // W and Up are a *level*, so without an edge of its own the bird would beat on every
    // step it was held and climb at the wing speed outright.
    const { game, manager, view } = airborne();
    manager.keyDown('KeyW');
    for (let i = 0; i < 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.velocity).toBeLessThan(0);
    game.destroy();
  });

  it('dives on a held Space and merely falls on a released one', () => {
    // The other half of the keyboard line. Same tap, same instant; the only difference is
    // whether the key stayed down.
    const fly = (hold: boolean): HappyBirdsGame => {
      const { game, manager, view } = airborne();
      manager.keyDown('Space');
      for (let i = 0; i < 24; i += 1) {
        if (!hold && i === 1) manager.keyUp('Space');
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      return game;
    };
    const held = fly(true);
    const released = fly(false);
    expect(held.match.p1.velocity).toBeLessThan(released.match.p1.velocity);
    expect(held.match.p1.height).toBeLessThan(released.match.p1.height);
    held.destroy();
    released.destroy();
  });

  it('flaps on a tap in your own half, as the pointer line says', () => {
    const { game, manager, view } = airborne();
    // A touch in the bottom half belongs to p1, wherever across the width it lands.
    manager.pointerDown(0, FIELD_WIDTH / 2, FIELD_HEIGHT - 60);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.velocity).toBeGreaterThan(0);
    expect(game.match.p2.velocity).toBeLessThan(0);
    game.destroy();
  });

  it('cannot reach into the other seat s sky with a finger', () => {
    const { game, manager, view } = airborne();
    manager.pointerDown(0, FIELD_WIDTH / 2, 60);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p2.velocity).toBeGreaterThan(0);
    expect(game.match.p1.velocity).toBeLessThan(0);
    game.destroy();
  });

  it('keeps a finger that started in your half yours across the midline', () => {
    // The seats rule, exercised through the engine rather than reimplemented here.
    const { game, manager, view } = airborne();
    manager.pointerDown(3, 100, FIELD_HEIGHT - 40);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.pointerMove(3, 100, 40);
    for (let i = 0; i < 10; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    // Still p1's finger, so it is still p1 diving and p2 has been left alone.
    expect(game.match.p2.velocity).toBeLessThan(0);
    expect(game.match.p1.velocity).toBeLessThan(0);
    game.destroy();
  });

  it('tucks on a held finger and falls on a lifted one', () => {
    const fly = (hold: boolean): HappyBirdsGame => {
      const { game, manager, view } = airborne();
      manager.pointerDown(0, 100, FIELD_HEIGHT - 60);
      for (let i = 0; i < 24; i += 1) {
        if (!hold && i === 1) manager.pointerUp(0);
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      return game;
    };
    const held = fly(true);
    const lifted = fly(false);
    expect(held.match.p1.velocity).toBeLessThan(lifted.match.p1.velocity);
    expect(held.match.p1.height).toBeLessThan(lifted.match.p1.height);
    held.destroy();
    lifted.destroy();
  });

  it('climbs no faster for a masher than for a thumb at the recharge rate', () => {
    // The parity claim the whole one-button design rests on, driven through the real input
    // stack rather than through the rules: a key pressed and released on every single step
    // and a finger tapping six times a second cover the identical distance. Six a second
    // is a rate a thumb genuinely reaches, and deliberately not a multiple of the recharge
    // period, because that is the case the buffer exists for.
    const period = 10;
    const climb = (drive: (manager: InputManager, i: number) => void): number => {
      const { game, manager, view } = airborne();
      const start = game.match.p1.height;
      for (let i = 0; i < 40; i += 1) {
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

describe('a fresh match', () => {
  it('starts level, with nobody having won', () => {
    const game = new HappyBirdsGame();
    game.init(context());
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new HappyBirdsGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });

  it('hovers both birds in the middle of their own skies', () => {
    const game = new HappyBirdsGame();
    game.init(context());
    expect(game.match.p1.height).toBe(SKY_HEIGHT / 2);
    expect(game.match.p2.height).toBe(SKY_HEIGHT / 2);
    expect(game.match.phase).toBe('ready');
    game.destroy();
  });

  it('is level again after a second init', () => {
    // The shell reuses one instance across a rematch, so anything left behind would start
    // the next match part-played.
    const game = new HappyBirdsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    for (let i = 0; i < 60 * 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.flightsPlayed).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'hard' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.elapsed).toBe(0);
    expect(game.match.flightsPlayed).toBe(0);
    expect(game.match.p1.clearance).toBe(0);
    game.destroy();
  });

  it('leaves nothing behind when it is torn down', () => {
    const game = new HappyBirdsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 600; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.flightsPlayed).toBe(0);
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier, and never past the flight budget', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new HappyBirdsGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      const limit = 60 * (MATCH_SECONDS + 5);
      for (; steps < limit && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const score = game.getScore();
      expect(score.winner, `${tier} never finished`).not.toBeNull();
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(FLIGHTS_TO_WIN);
      expect(game.match.flightsPlayed).toBeLessThanOrEqual(MAX_FLIGHTS);
      game.destroy();
    }
  });

  it('finishes a match nobody plays at all', () => {
    // Two absent players fly the same absent flight, so every flight is drawn and the
    // budget is what ends it.
    const game = new HappyBirdsGame();
    const { manager, view } = inputs();
    game.init(context());
    let steps = 0;
    for (; steps < 60 * MATCH_SECONDS && game.getScore().winner === null; steps += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: 'draw' });
    expect(game.match.flightsPlayed).toBe(MAX_FLIGHTS);
    expect(steps / 60).toBeLessThan(60);
    game.destroy();
  });

  it('is won by surviving three flights and not by anything else', () => {
    const game = new HappyBirdsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: (seat: SeatId) => (seat === 'p1' ? 'hard' : 'easy') }));
    for (let i = 0; i < 60 * MATCH_SECONDS && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    const score = game.getScore();
    expect(score.winner).toBe('p1');
    expect(score.p1).toBe(FLIGHTS_TO_WIN);
    expect(score.p2).toBeLessThan(FLIGHTS_TO_WIN);
    game.destroy();
  });

  it('stops simulating once it is decided', () => {
    const game = new HappyBirdsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    for (let i = 0; i < 60 * MATCH_SECONDS && game.getScore().winner === null; i += 1) {
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
      const game = new HappyBirdsGame();
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

describe('the bots the lobby offers', () => {
  const play = (difficulty: (seat: SeatId) => BotDifficulty | null, steps: number): string => {
    const game = new HappyBirdsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: difficulty }));
    const seen: number[] = [];
    for (let i = 0; i < steps && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 15 === 0) seen.push(game.match.p1.height, game.match.p2.height);
    }
    game.destroy();
    return seen.map((n) => n.toFixed(6)).join(',');
  };

  it('plays a visibly different match on easy and on hard', () => {
    // The failure this catches is a game that accepts `botDifficulty` and ignores it, and
    // it has to show inside twenty-five seconds rather than only in the final score.
    expect(play(() => 'hard', 60 * 25)).not.toBe(play(() => 'easy', 60 * 25));
  });

  it('plays a different match with a bot than with nobody', () => {
    expect(play(() => 'normal', 60 * 25)).not.toBe(play(() => null, 60 * 25));
  });

  it('sits a bot in exactly the seat it was asked to', () => {
    const game = new HappyBirdsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: (seat: SeatId) => (seat === 'p2' ? 'hard' : null) }));
    for (let i = 0; i < 200; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    // The unoccupied seat was never touched, so its bird is on the ground; the bot's is not.
    expect(game.match.p1.height).toBe(BIRD_RADIUS);
    expect(game.match.p2.height).toBeGreaterThan(BIRD_RADIUS);
    game.destroy();
  });
});

describe('rendering', () => {
  it('draws every shape inside the declared box, at every stage of a match', () => {
    const { renderer, drawn } = recorder();
    const game = new HappyBirdsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 25; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 === 0) game.render(renderer, 0);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    // Reduced to one number and asserted once rather than asserted per value: a frame of
    // this game hands the renderer several hundred coordinates, and the assertion
    // machinery rather than the game is what would make the test slow.
    let worst = 0;
    for (const value of drawn) worst = Math.max(worst, Math.abs(value));
    // Generous, as the shared harness is: what this catches is a game drawing in a box
    // unrelated to the one it declared, not a stroke overhanging by a few units.
    expect(worst).toBeLessThanOrEqual(Math.max(FIELD_WIDTH, FIELD_HEIGHT) * 2);
  });

  it('draws into both halves of the device', () => {
    // Rule 9, as geometry: neither player may see more of the play area than the other,
    // and the way that fails first is one seat's furniture never being drawn at all.
    const { renderer, drawn } = recorder();
    const game = new HappyBirdsGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 400; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.render(renderer, 0);
    game.destroy();
    expect(drawn.some((v) => v > FIELD_HEIGHT - SKY_HEIGHT)).toBe(true);
    expect(drawn.some((v) => v < SKY_HEIGHT)).toBe(true);
  });

  it('draws a downed bird, so the pause says who lost the flight', () => {
    const { renderer, drawn } = recorder();
    const game = new HappyBirdsGame();
    const { manager, view } = inputs();
    game.init(context());
    for (let i = 0; i < 60 * 20 && game.match.phase !== 'settle'; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.match.phase).toBe('settle');
    game.render(renderer, 0);
    game.destroy();
    expect(drawn.length).toBeGreaterThan(0);
  });

  it('does not move the simulation on', () => {
    const { renderer } = recorder();
    const game = new HappyBirdsGame();
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
    const game = new HappyBirdsGame();
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
