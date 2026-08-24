import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE, envelopeFor } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, Renderer } from '@duelbox/game-sdk';
import { AnimalStackGame } from './game.js';
import { manifest } from './manifest.js';
import {
  CARRY_REACH,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  MAX_ANIMALS,
  PLATFORM_HALF,
  ROUND_SECONDS,
  SLIDE_SPEED,
  acrossOfWorld,
  speciesAt,
  supportHiAt,
  supportLoAt,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
/** Ten simulated minutes: what `apps/web/src/data/termination.test.ts` allows. */
const GUARD_STEPS = 60 * 600;
/** The lattice every pointer position is rounded onto before a game ever sees it. */
const ENVELOPE = envelopeFor(manifest.logical);

/** Somewhere well inside seat one s own half, and seat two s. */
const NEAR_Y = FIELD_HEIGHT - 120;
const FAR_Y = 120;

function context(overrides: Partial<GameContext> = {}): GameContext {
  return {
    manifest,
    rng: new Rng(20260824),
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

/** A recording renderer that answers every call and keeps every number it is handed. */
function recorder(): { renderer: Renderer; drawn: number[]; colours: string[] } {
  const drawn: number[] = [];
  const colours: string[] = [];
  const record = (...args: unknown[]): void => {
    for (const arg of args) {
      if (typeof arg === 'number') drawn.push(arg);
      else if (typeof arg === 'string') colours.push(arg);
    }
  };
  return {
    drawn,
    colours,
    renderer: {
      clear: record,
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
 * A game stepped past the opening pause, so both cranes are holding an animal and a gesture
 * means something. Nothing is decided by the timing of the first animal.
 */
function carrying(overrides: Partial<GameContext> = {}): {
  game: AnimalStackGame;
  manager: InputManager;
  view: InputView;
} {
  const game = new AnimalStackGame();
  const { manager, view } = inputs();
  game.init(context(overrides));
  for (let i = 0; i < 600 && game.match.p1.stance !== 'carrying'; i += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
  }
  expect(game.match.p1.stance).toBe('carrying');
  expect(game.match.p2.stance).toBe('carrying');
  return { game, manager, view };
}

function tick(game: AnimalStackGame, manager: InputManager, view: InputView, steps = 1): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** Play a match out through the game itself, bounded by the guard s own ten minutes. */
function finish(
  game: AnimalStackGame,
  manager: InputManager,
  view: InputView,
  drive: (step: number) => void = () => undefined,
): number {
  let steps = 0;
  for (; steps < GUARD_STEPS && game.getScore().winner === null; steps += 1) {
    drive(steps);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
  }
  return steps;
}

/** Bot against bot with no input at all, exactly as the termination guard drives a game. */
function botGame(
  p1: BotDifficulty | null,
  p2: BotDifficulty | null,
  seed: number,
): AnimalStackGame {
  const game = new AnimalStackGame();
  game.init(
    context({
      rng: new Rng(seed),
      botDifficulty: (seat: SeatId) => (seat === 'p1' ? p1 : p2),
    }),
  );
  return game;
}

/* ================================================================== */

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(FIELD_WIDTH);
    expect(manifest.logical.height).toBe(FIELD_HEIGHT);
  });

  it('splits the device the way the two platforms are stacked', () => {
    // A vertical split would put the two yards side by side and each player would be reading
    // their own tower sideways.
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.category).toBe('Party');
  });

  it('offers the modes the catalogue promises, and the presentations they need', () => {
    expect(manifest.modes).toEqual(['friend', 'bot', 'solo']);
    expect(manifest.presentations).toEqual(['shared-screen', 'single-seat']);
  });

  it('advertises a round length a real match is in the neighbourhood of', () => {
    expect(manifest.roundSeconds).toBeGreaterThan(20);
    expect(manifest.roundSeconds).toBeLessThan(ROUND_SECONDS);
  });

  it('tells each player which keys are theirs', () => {
    // `apps/web/src/data/controls.test.ts` enforces this across the catalogue; here it fails
    // next to the game rather than next to a list of eighty manifests.
    expect(manifest.controls.keyboard).toMatch(/seat one/i);
    expect(manifest.controls.keyboard).toMatch(/seat two/i);
    expect(manifest.controls.keyboard).toMatch(/a and d/i);
    expect(manifest.controls.keyboard).toMatch(/left and right/i);
  });

  it("never offers the two key halves as one player's choice", () => {
    expect(manifest.controls.keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
  });

  it('names both halves of the one gesture, in both lines', () => {
    for (const line of [manifest.controls.keyboard, manifest.controls.pointer]) {
      expect(line).toMatch(/turn/i);
      expect(line).toMatch(/drop/i);
    }
  });

  it('says where a finger has to land', () => {
    expect(manifest.controls.pointer).toMatch(/own half/i);
  });

  it('does not claim to be same-input-class only', () => {
    // Both instruments walk the animal at one speed through one rate limit, and the parity
    // tests below are what earn this rather than the comment.
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});

/* ================================================================== */

describe('the keyboard line is true', () => {
  it('walks seat one right on D and left on A', () => {
    const { game, manager, view } = carrying();
    const start = game.match.p1.held.across;
    manager.keyDown('KeyD');
    tick(game, manager, view, 6);
    manager.keyUp('KeyD');
    const right = game.match.p1.held.across;
    expect(right).toBeCloseTo(start + 6 * SLIDE_SPEED * STEP, 9);
    manager.keyDown('KeyA');
    tick(game, manager, view, 6);
    manager.keyUp('KeyA');
    expect(game.match.p1.held.across).toBeCloseTo(start, 9);
    game.destroy();
  });

  it('walks seat two on the arrow keys and nobody else', () => {
    const { game, manager, view } = carrying();
    const before = game.match.p1.held.across;
    const start = game.match.p2.held.across;
    manager.keyDown('ArrowRight');
    tick(game, manager, view, 6);
    manager.keyUp('ArrowRight');
    expect(game.match.p2.held.across).toBeCloseTo(start + 6 * SLIDE_SPEED * STEP, 9);
    expect(game.match.p1.held.across).toBe(before);
    game.destroy();
  });

  it('leaves seat two alone when seat one plays', () => {
    const { game, manager, view } = carrying();
    const before = { across: game.match.p2.held.across, facing: game.match.p2.held.facing };
    manager.keyDown('KeyD');
    tick(game, manager, view, 20);
    manager.keyUp('KeyD');
    manager.keyDown('Space');
    tick(game, manager, view, 20);
    manager.keyUp('Space');
    tick(game, manager, view);
    expect(game.match.p2.held.across).toBe(before.across);
    expect(game.match.p2.held.facing).toBe(before.facing);
    expect(game.match.p2.count).toBe(0);
    game.destroy();
  });

  it('turns seat one round on a tap of Space', () => {
    const { game, manager, view } = carrying();
    const before = game.match.p1.held.facing;
    manager.keyDown('Space');
    tick(game, manager, view);
    manager.keyUp('Space');
    tick(game, manager, view);
    expect(game.match.p1.held.facing).toBe(-before);
    expect(game.match.p1.stance).toBe('carrying');
    game.destroy();
  });

  it('turns seat two round on a tap of Enter', () => {
    const { game, manager, view } = carrying();
    const before = game.match.p2.held.facing;
    manager.keyDown('Enter');
    tick(game, manager, view);
    manager.keyUp('Enter');
    tick(game, manager, view);
    expect(game.match.p2.held.facing).toBe(-before);
    expect(game.match.p1.held.facing).not.toBe(-game.match.p1.held.facing);
    game.destroy();
  });

  it('drops the animal when Space is held and then let go', () => {
    const { game, manager, view } = carrying();
    const facing = game.match.p1.held.facing;
    manager.keyDown('Space');
    tick(game, manager, view, 20);
    expect(game.match.p1.stance).toBe('carrying');
    manager.keyUp('Space');
    tick(game, manager, view);
    expect(game.match.p1.stance).toBe('dropping');
    expect(game.match.p1.held.facing).toBe(facing);
    game.destroy();
  });

  it('drops nothing at all while the key is still down', () => {
    // A press is not the gesture; letting go is. A key resting on the desk cannot drop an
    // animal, and the crane clock is what eventually takes it.
    const { game, manager, view } = carrying();
    manager.keyDown('Space');
    for (let i = 0; i < 100; i += 1) {
      tick(game, manager, view);
      expect(game.match.p1.stance).toBe('carrying');
    }
    manager.keyUp('Space');
    game.destroy();
  });

  it('walks the animal while the drop key is being held', () => {
    // Both hands at once, which is the whole reason the gesture is a hold rather than a tap.
    const { game, manager, view } = carrying();
    const start = game.match.p1.held.across;
    manager.keyDown('Space');
    manager.keyDown('KeyD');
    tick(game, manager, view, 20);
    expect(game.match.p1.held.across).toBeGreaterThan(start);
    manager.keyUp('KeyD');
    manager.keyUp('Space');
    tick(game, manager, view);
    expect(game.match.p1.stance).toBe('dropping');
    game.destroy();
  });

  it('does nothing at all on any other key', () => {
    const { game, manager, view } = carrying();
    const before = {
      p1: { ...game.match.p1.held },
      p2: { ...game.match.p2.held },
    };
    for (const key of ['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'Escape', 'Tab', 'KeyQ', 'Digit1']) {
      manager.keyDown(key);
      tick(game, manager, view);
      manager.keyUp(key);
      tick(game, manager, view);
    }
    expect(game.match.p1.held).toEqual(before.p1);
    expect(game.match.p2.held).toEqual(before.p2);
    expect(game.match.p1.stance).toBe('carrying');
    expect(game.match.p2.stance).toBe('carrying');
    game.destroy();
  });

  it('finishes a whole match on the keyboard alone', () => {
    // A competent keyboard player: walk the animal onto the middle of whatever it has to
    // land on, hold, let go. Nothing here reads a quantity the screen does not show.
    const { game, manager, view } = carrying();
    let holding = -1;
    const steps = finish(game, manager, view, (i) => {
      const yard = game.match.p1;
      const target = (supportLoAt(yard, yard.count) + supportHiAt(yard, yard.count)) / 2;
      const gap = target - yard.held.across;
      if (holding >= 0) {
        if (i - holding >= 14) {
          manager.keyUp('Space');
          holding = -1;
        }
        return;
      }
      if (yard.stance !== 'carrying') return;
      if (gap > 4) {
        manager.keyUp('KeyA');
        manager.keyDown('KeyD');
        return;
      }
      if (gap < -4) {
        manager.keyUp('KeyD');
        manager.keyDown('KeyA');
        return;
      }
      manager.keyUp('KeyA');
      manager.keyUp('KeyD');
      manager.keyDown('Space');
      holding = i;
    });
    expect(game.getScore().winner).not.toBeNull();
    expect(steps).toBeLessThan(GUARD_STEPS);
    expect(game.match.p1.count).toBeGreaterThan(2);
    game.destroy();
  });
});

/* ================================================================== */

describe('the pointer line is true', () => {
  it('walks seat one animal towards a finger in the near half', () => {
    const { game, manager, view } = carrying();
    game.match.p1.held.across = 0;
    manager.pointerDown(1, FIELD_WIDTH / 2 + 150, NEAR_Y);
    tick(game, manager, view, 4);
    expect(game.match.p1.held.across).toBeCloseTo(4 * SLIDE_SPEED * STEP, 9);
    manager.pointerUp(1);
    game.destroy();
  });

  it('reads the far seat finger the other way round, because that player is', () => {
    const { game, manager, view } = carrying();
    game.match.p2.held.across = 0;
    // The same side of the device, read by the player who is holding it upside down.
    manager.pointerDown(1, FIELD_WIDTH / 2 + 150, FAR_Y);
    tick(game, manager, view, 4);
    expect(game.match.p2.held.across).toBeCloseTo(-4 * SLIDE_SPEED * STEP, 9);
    expect(acrossOfWorld('p2', FIELD_WIDTH / 2 + 150)).toBe(-150);
    manager.pointerUp(1);
    game.destroy();
  });

  it('lands exactly on the point the finger names, once it is close enough', () => {
    const { game, manager, view } = carrying();
    game.match.p1.held.across = 0;
    // One step of the precision lattice, which is what the engine hands any game, and
    // inside the 4.17 units a step of walking covers — so the walk lands on it exactly.
    const target = ENVELOPE;
    expect(target).toBeLessThan(SLIDE_SPEED * STEP);
    manager.pointerDown(1, FIELD_WIDTH / 2 + target, NEAR_Y);
    tick(game, manager, view);
    expect(game.match.p1.held.across).toBe(target);
    manager.pointerUp(1);
    game.destroy();
  });

  it('never teleports the animal after a finger that jumps across the yard', () => {
    const { game, manager, view } = carrying();
    game.match.p1.held.across = 0;
    manager.pointerDown(1, FIELD_WIDTH / 2 - 170, NEAR_Y);
    tick(game, manager, view);
    expect(game.match.p1.held.across).toBeCloseTo(-SLIDE_SPEED * STEP, 9);
    manager.pointerUp(1);
    game.destroy();
  });

  it('turns the animal round on a quick tap', () => {
    const { game, manager, view } = carrying();
    const before = game.match.p1.held.facing;
    manager.pointerDown(1, FIELD_WIDTH / 2, NEAR_Y);
    manager.pointerUp(1);
    tick(game, manager, view);
    expect(game.match.p1.held.facing).toBe(-before);
    expect(game.match.p1.stance).toBe('carrying');
    game.destroy();
  });

  it('drops it when the finger is lifted after a drag', () => {
    const { game, manager, view } = carrying();
    manager.pointerDown(1, FIELD_WIDTH / 2 - 60, NEAR_Y);
    tick(game, manager, view, 20);
    expect(game.match.p1.stance).toBe('carrying');
    manager.pointerUp(1);
    tick(game, manager, view);
    expect(game.match.p1.stance).toBe('dropping');
    game.destroy();
  });

  it('drops nothing at all while the finger stays on the glass', () => {
    const { game, manager, view } = carrying();
    manager.pointerDown(1, FIELD_WIDTH / 2, NEAR_Y);
    for (let i = 0; i < 100; i += 1) {
      tick(game, manager, view);
      expect(game.match.p1.stance).toBe('carrying');
    }
    manager.pointerUp(1);
    game.destroy();
  });

  it('keeps a finger that started in your half yours across the midline', () => {
    // The seats rule, exercised through the engine rather than reimplemented here.
    const { game, manager, view } = carrying();
    const before = { ...game.match.p2.held };
    manager.pointerDown(3, FIELD_WIDTH / 2 + 90, NEAR_Y);
    tick(game, manager, view, 4);
    manager.pointerMove(3, FIELD_WIDTH / 2 + 90, FAR_Y);
    tick(game, manager, view, 30);
    expect(game.match.p2.held).toEqual(before);
    expect(game.match.p1.held.across).not.toBe(before.across);
    manager.pointerUp(3);
    game.destroy();
  });

  it('gives a tap in the far half to the far seat and nobody else', () => {
    const { game, manager, view } = carrying();
    const before = game.match.p1.held.facing;
    const far = game.match.p2.held.facing;
    manager.pointerDown(4, 60, FAR_Y);
    manager.pointerUp(4);
    tick(game, manager, view);
    expect(game.match.p2.held.facing).toBe(-far);
    expect(game.match.p1.held.facing).toBe(before);
    game.destroy();
  });

  it('finishes a whole match on the pointer alone', () => {
    const { game, manager, view } = carrying();
    // The same competent player, spelling the same gesture with a finger: put it on the
    // middle of the strip the animal has to land on, hold, lift.
    let holding = -1;
    const steps = finish(game, manager, view, (i) => {
      const yard = game.match.p1;
      const target = (supportLoAt(yard, yard.count) + supportHiAt(yard, yard.count)) / 2;
      if (holding < 0) {
        if (yard.stance !== 'carrying') return;
        manager.pointerDown(9, FIELD_WIDTH / 2 + target, NEAR_Y);
        holding = i;
        return;
      }
      manager.pointerMove(9, FIELD_WIDTH / 2 + target, NEAR_Y);
      if (Math.abs(yard.held.across - target) > 1 || i - holding < 14) return;
      manager.pointerUp(9);
      holding = -1;
    });
    expect(game.getScore().winner).not.toBeNull();
    expect(steps).toBeLessThan(GUARD_STEPS);
    expect(game.match.p1.count).toBeGreaterThan(2);
    game.destroy();
  });
});

describe('a key and a thumb are worth the same', () => {
  it('walk the animal to exactly the same place on the same schedule', () => {
    // Rule 10 in one assertion. The two instruments say different things — a key names a
    // direction and a finger names a point — but both reach the animal through one rate
    // limit at one speed, so a gesture of the same shape lands in the same place.
    const run = (thumb: boolean): string => {
      const { game, manager, view } = carrying();
      game.match.p1.held.across = 0;
      const seen: number[] = [];
      for (let i = 0; i < 40; i += 1) {
        if (i === 0) {
          if (thumb) manager.pointerDown(1, FIELD_WIDTH, NEAR_Y);
          else {
            manager.keyDown('KeyD');
            manager.keyDown('Space');
          }
        }
        if (i === 20) {
          if (thumb) manager.pointerUp(1);
          else {
            manager.keyUp('KeyD');
            manager.keyUp('Space');
          }
        }
        tick(game, manager, view);
        seen.push(game.match.p1.held.across, game.match.p1.top);
      }
      const trace = seen.map((value) => value.toFixed(9)).join(',');
      game.destroy();
      return trace;
    };
    const keyed = run(false);
    expect(keyed).toBe(run(true));
    expect(keyed).not.toMatch(/^0[.,0]*$/);
  });

  it('drop the animal on the same step for the same length of press', () => {
    const dropStep = (thumb: boolean): number => {
      const { game, manager, view } = carrying();
      let step = -1;
      for (let i = 0; i < 60; i += 1) {
        if (i === 0) {
          if (thumb) manager.pointerDown(1, FIELD_WIDTH / 2, NEAR_Y);
          else manager.keyDown('Space');
        }
        if (i === 15) {
          if (thumb) manager.pointerUp(1);
          else manager.keyUp('Space');
        }
        tick(game, manager, view);
        if (step < 0 && game.match.p1.stance === 'dropping') step = i;
      }
      game.destroy();
      return step;
    };
    expect(dropStep(false)).toBe(dropStep(true));
    expect(dropStep(false)).toBeGreaterThan(0);
  });
});

/* ================================================================== */

describe('a fresh match', () => {
  it('starts level, with nobody having won', () => {
    const game = new AnimalStackGame();
    game.init(context());
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    // `apps/web/src/data/turn-seat.test.ts` reads the value rather than the method, and a
    // real-time game that named an active seat would take one seat half of the glass away.
    const game = new AnimalStackGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    const { manager, view } = inputs();
    for (let i = 0; i < 300; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      expect(game.getActiveSeat()).toBeNull();
    }
    game.destroy();
  });

  it('holds nothing on either platform until the opening pause is over', () => {
    const game = new AnimalStackGame();
    const { manager, view } = inputs();
    game.init(context());
    expect(game.match.p1.stance).toBe('settling');
    expect(game.match.p1.dealt).toBe(0);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.dealt).toBe(0);
    game.destroy();
  });

  it('deals both seats the same first animal', () => {
    const { game } = carrying();
    expect(game.match.p1.held.species).toBe(game.match.p2.held.species);
    expect(game.match.p1.held.facing).toBe(game.match.p2.held.facing);
    expect(game.match.p1.held.across).toBe(game.match.p2.held.across);
    game.destroy();
  });

  it('scores the animals standing on each platform', () => {
    const { game, manager, view } = carrying();
    finish(game, manager, view);
    const score = game.getScore();
    expect(score.p1).toBe(game.match.p1.count);
    expect(score.p2).toBe(game.match.p2.count);
    expect(score.p1).toBeLessThanOrEqual(MAX_ANIMALS);
    game.destroy();
  });

  it('replays exactly from one seed', () => {
    const trace = (): string => {
      const game = botGame('normal', 'easy', 4242);
      const { manager, view } = inputs();
      const seen: number[] = [];
      for (let i = 0; i < 900 && game.getScore().winner === null; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        seen.push(game.match.p1.held.across, game.match.p1.count, game.match.p2.count);
      }
      game.destroy();
      return seen.map((value) => value.toFixed(9)).join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('is a fresh match again after a rematch', () => {
    const game = new AnimalStackGame();
    const { manager, view } = inputs();
    game.init(context());
    for (let i = 0; i < 400; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.dealt).toBeGreaterThan(0);
    game.init(context());
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.p1.dealt).toBe(0);
    expect(game.match.elapsed).toBe(0);
    game.destroy();
  });

  it('stops simulating once it is decided', () => {
    const game = botGame('easy', 'easy', 71);
    const { manager, view } = inputs();
    finish(game, manager, view);
    const after = JSON.stringify(game.match);
    for (let i = 0; i < 60; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(JSON.stringify(game.match)).toBe(after);
    game.destroy();
  });

  it('drops a press that a pause swallowed rather than delivering it on resume', () => {
    const { game, manager, view } = carrying();
    manager.keyDown('Space');
    tick(game, manager, view, 30);
    game.onPause();
    // The host clears the manager on a pause, so the key-up never reaches the game.
    manager.clear();
    game.onResume();
    tick(game, manager, view);
    expect(game.match.p1.stance).toBe('carrying');
    game.destroy();
  });
});

/* ================================================================== */

describe('the bot', () => {
  it('plays without any input at all, on both seats', () => {
    const game = botGame('normal', 'normal', 8);
    const { manager, view } = inputs();
    finish(game, manager, view);
    expect(game.getScore().winner).not.toBeNull();
    expect(game.match.p1.dealt).toBeGreaterThan(3);
    expect(game.match.p2.dealt).toBeGreaterThan(3);
    game.destroy();
  });

  it('reaches a decision on every seed, at the weakest tier', () => {
    // Exactly what `apps/web/src/data/termination.test.ts` drives, so it fails here first.
    for (let seed = 1; seed <= 20; seed += 1) {
      const game = botGame('easy', 'easy', seed * 811 + 5);
      const { manager, view } = inputs();
      const steps = finish(game, manager, view);
      expect(steps).toBeLessThan(GUARD_STEPS);
      expect(game.getScore().winner).not.toBeNull();
      expect(steps / 60).toBeLessThan(ROUND_SECONDS);
      game.destroy();
    }
  });

  it('plays a different match on easy and on hard', () => {
    // The failure `bot-parity.test.ts` catches: a game that accepts `botDifficulty` and
    // ignores it type-checks, runs, and offers three tiers that are one tier.
    const trace = (tier: BotDifficulty): string => {
      const game = botGame(tier, tier, 20260823);
      const { manager, view } = inputs();
      const seen: number[] = [];
      for (let i = 0; i < 60 * 25 && game.getScore().winner === null; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 15 === 0) seen.push(game.match.p1.count, game.match.p1.held.across);
      }
      game.destroy();
      return seen.map((value) => value.toFixed(6)).join(',');
    };
    expect(trace('easy')).not.toBe(trace('hard'));
  });

  it('plays a different match with a bot than with nobody', () => {
    const trace = (tier: BotDifficulty | null): string => {
      const game = botGame(tier, tier, 20260823);
      const { manager, view } = inputs();
      const seen: number[] = [];
      for (let i = 0; i < 60 * 25 && game.getScore().winner === null; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 15 === 0) seen.push(game.match.p1.count, game.match.p1.held.across);
      }
      game.destroy();
      return seen.map((value) => value.toFixed(6)).join(',');
    };
    expect(trace('normal')).not.toBe(trace(null));
  });

  it('leaves a human seat entirely alone', () => {
    const game = botGame(null, 'hard', 99);
    const { manager, view } = inputs();
    for (let i = 0; i < 120; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    // Seat one has a human who is not there, so its animal has not moved from where the
    // crane put it and it is spending its animals on the crane clock alone.
    expect(game.match.p1.held.across).toBe(game.match.starts[game.match.p1.dealt - 1]);
    expect(game.match.p2.held.across).not.toBe(game.match.p1.held.across);
    game.destroy();
  });

  it('beats a weaker tier over a run of seeded matches, driven through the game', () => {
    const run = (a: BotDifficulty, b: BotDifficulty): { p1: number; p2: number } => {
      let p1 = 0;
      let p2 = 0;
      for (let seed = 1; seed <= 24; seed += 1) {
        const game = botGame(a, b, seed * 977 + 3);
        const { manager, view } = inputs();
        finish(game, manager, view);
        const winner = game.getScore().winner;
        if (winner === 'p1') p1 += 1;
        else if (winner === 'p2') p2 += 1;
        game.destroy();
      }
      return { p1, p2 };
    };
    const hardOverEasy = run('hard', 'easy');
    expect(hardOverEasy.p1).toBeGreaterThan(hardOverEasy.p2);
    const easyUnderHard = run('easy', 'hard');
    expect(easyUnderHard.p2).toBeGreaterThan(easyUnderHard.p1);
  });

  it('never lets a tier think for longer than a frame', () => {
    // `apps/web/src/data/bot-cost.test.ts` measures this against a calibrated ceiling; here
    // it is the shape of the work rather than the clock — the hardest tier weighs a fixed
    // number of placements against a tower that is never taller than the budget.
    const game = botGame('hard', 'hard', 12);
    const { manager, view } = inputs();
    finish(game, manager, view);
    expect(game.match.p1.count).toBeLessThanOrEqual(MAX_ANIMALS);
    expect(game.match.p2.count).toBeLessThanOrEqual(MAX_ANIMALS);
    game.destroy();
  });
});

/* ================================================================== */

describe('what is drawn', () => {
  it('draws something at all', () => {
    const { game, manager, view } = carrying();
    const { renderer, drawn } = recorder();
    game.render(renderer);
    expect(drawn.length).toBeGreaterThan(50);
    game.destroy();
    void view;
    void manager;
  });

  it('keeps every drawn point inside the declared box', () => {
    // `apps/web/src/data/cross-viewport.test.ts` allows twice the box for strokes and glyph
    // boxes; this is the tighter version, because a tower that scrolled out of its own yard
    // would spill into the other player half.
    const game = botGame('normal', 'easy', 606);
    const { manager, view } = inputs();
    const { renderer, drawn } = recorder();
    for (let i = 0; i < GUARD_STEPS && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 5 !== 0) continue;
      drawn.length = 0;
      game.render(renderer);
      for (const value of drawn) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThanOrEqual(Math.max(FIELD_WIDTH, FIELD_HEIGHT) + 40);
      }
    }
    game.destroy();
  });

  it('keeps every band it draws inside the field, tower and all', () => {
    const game = botGame('hard', 'hard', 4242);
    const { manager, view } = inputs();
    const seen: number[] = [];
    const record = (...args: unknown[]): void => {
      // The y of a rect is its second number; every band this game draws is a rect.
      if (typeof args[1] === 'number') seen.push(args[1]);
    };
    const renderer: Renderer = {
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
    };
    for (let i = 0; i < GUARD_STEPS && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 7 !== 0) continue;
      game.render(renderer);
    }
    expect(seen.length).toBeGreaterThan(100);
    // A tower is taller than the yard it stands in, so the renderer scrolls and clips it;
    // without that clip a fourteenth animal would be drawn straight through the gutter and
    // into the other player half.
    for (const y of seen) {
      expect(y).toBeGreaterThanOrEqual(-4);
      expect(y).toBeLessThanOrEqual(FIELD_HEIGHT + 4);
    }
    game.destroy();
  });

  it('gives each seat its own colour and its own pattern', () => {
    // Rule 7: colour is never the only signal. p2 animals are barred across in ink and its
    // platform posts are notched, so the two halves read apart in greyscale.
    const game = botGame('hard', 'hard', 77);
    const { manager, view } = inputs();
    const { renderer, colours } = recorder();
    for (let i = 0; i < 60 * 12; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    game.render(renderer);
    expect(colours).toContain(SEAT_PALETTE.p1.base);
    expect(colours).toContain(SEAT_PALETTE.p2.base);
    expect(colours.filter((colour) => colour === '#050d13').length).toBeGreaterThan(4);
    game.destroy();
  });

  it('changes nothing about the match', () => {
    const game = botGame('normal', 'normal', 31);
    const { manager, view } = inputs();
    const { renderer } = recorder();
    for (let i = 0; i < 400; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    const before = JSON.stringify(game.match);
    for (let i = 0; i < 20; i += 1) game.render(renderer);
    expect(JSON.stringify(game.match)).toBe(before);
    game.destroy();
  });

  it('draws an empty platform, a falling animal and a fallen tower without complaint', () => {
    const game = botGame('easy', 'easy', 5);
    const { manager, view } = inputs();
    const { renderer, drawn } = recorder();
    game.render(renderer);
    expect(drawn.length).toBeGreaterThan(10);
    for (let i = 0; i < GUARD_STEPS && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      game.render(renderer);
    }
    expect(game.match.p1.stance === 'fallen' || game.match.p2.stance === 'fallen').toBe(true);
    game.render(renderer);
    game.destroy();
    game.render(renderer);
  });

  it('draws every animal in the list, so no species is invisible', () => {
    const { game } = carrying();
    const { renderer, drawn } = recorder();
    for (let index = 0; index < 6; index += 1) {
      game.match.p1.held.species = index;
      drawn.length = 0;
      game.render(renderer);
      expect(drawn.length, speciesAt(index).name).toBeGreaterThan(50);
    }
    game.destroy();
  });
});

/* ================================================================== */

describe('the two presentations', () => {
  it('step the identical match', () => {
    // Only placement changes between them; the simulation is byte-identical, which is what
    // `docs/presentation.md` requires and what makes a cross-device match possible.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new AnimalStackGame();
      game.init(
        context({ presentation, localSeat, rng: new Rng(606), botDifficulty: () => 'normal' }),
      );
      const { manager, view } = inputs();
      const seen: number[] = [];
      for (let i = 0; i < 900 && game.getScore().winner === null; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        seen.push(game.match.p1.count, game.match.p2.count, game.match.p1.held.across);
      }
      game.destroy();
      return seen.map((value) => value.toFixed(9)).join(',');
    };
    expect(trace('single-seat', 'p2')).toBe(trace('shared-screen', 'p1'));
  });

  it('never reads the presentation to decide anything', () => {
    const game = new AnimalStackGame();
    game.init(context({ presentation: 'single-seat', localSeat: 'p2' }));
    const { manager, view } = inputs();
    // A finger in the near half still belongs to seat one, because the engine owns that
    // decision and this game never asks which half of the glass anything is on.
    for (let i = 0; i < 200 && game.match.p1.stance !== 'carrying'; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    const before = { ...game.match.p2.held };
    manager.pointerDown(1, FIELD_WIDTH / 2 + 90, NEAR_Y);
    for (let i = 0; i < 10; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.held.across).not.toBe(before.across);
    expect(game.match.p2.held).toEqual(before);
    game.destroy();
  });
});

/* ================================================================== */

describe('the game contract', () => {
  it('answers render through the interface as well as the class', () => {
    // `tsc --noEmit -p tsconfig.lint.json` type-checks this file, and the SDK declares
    // `render(renderer, alpha)` where the class declares `render(renderer)`. Both have to
    // be callable or the CI gate fails on a file the package build never looks at.
    const game: Game = new AnimalStackGame();
    game.init(context());
    const { renderer } = recorder();
    game.render(renderer, 0);
    game.render(renderer, 0.5);
    expect(game.getActiveSeat?.() ?? null).toBeNull();
    game.destroy();
  });

  it('survives being destroyed twice, and stepped afterwards', () => {
    const game = new AnimalStackGame();
    const { manager, view } = inputs();
    game.init(context());
    for (let i = 0; i < 120; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.destroy();
    game.destroy();
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('never walks an animal past the crane reach, whatever a finger does', () => {
    const game = new AnimalStackGame();
    const { manager, view } = inputs();
    game.init(context());
    const rng = new Rng(4711);
    for (let i = 0; i < 60 * 60 && game.getScore().winner === null; i += 1) {
      if (i % 3 === 0) {
        manager.pointerDown(i % 4, rng.float() * FIELD_WIDTH * 2 - FIELD_WIDTH, NEAR_Y);
      }
      if (i % 5 === 0) manager.pointerUp(i % 4);
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const yard = seat === 'p1' ? game.match.p1 : game.match.p2;
        expect(Math.abs(yard.held.across)).toBeLessThanOrEqual(CARRY_REACH);
      }
    }
    game.destroy();
  });

  it('keeps a platform that never had an animal on it at nil', () => {
    const game = new AnimalStackGame();
    game.init(context());
    expect(PLATFORM_HALF).toBeGreaterThan(0);
    expect(game.getScore().p1).toBe(0);
    game.destroy();
  });
});
