import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext, Renderer } from '@duelbox/game-sdk';
import { ChickenJumpGame } from './game.js';
import { manifest } from './manifest.js';
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  HESITATE_SECONDS,
  LANE_HEIGHT,
  MAX_BLOCKS,
  READY_SECONDS,
  ROUND_SECONDS,
  TARGET_POINTS,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
/** Ten simulated minutes: what `apps/web/src/data/termination.test.ts` allows. */
const GUARD_STEPS = 60 * 600;

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
 * A game stepped past the opening pause, so both chickens have a block on the rope and a
 * press means something. Nothing is decided by the timing of the first block.
 */
function waiting(overrides: Partial<GameContext> = {}): {
  game: ChickenJumpGame;
  manager: InputManager;
  view: InputView;
} {
  const game = new ChickenJumpGame();
  const { manager, view } = inputs();
  game.init(context(overrides));
  for (let i = 0; i < 600 && game.match.p1.stance !== 'waiting'; i += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
  }
  expect(game.match.p1.stance).toBe('waiting');
  expect(game.match.p2.stance).toBe('waiting');
  return { game, manager, view };
}

/** Play a match out through the game itself, bounded by the guard s own ten minutes. */
function finish(
  game: ChickenJumpGame,
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

/** How many of seat one s blocks were actually cut loose, however they then landed. */
function released(game: ChickenJumpGame): number {
  const perch = game.match.p1;
  return perch.perfects + perch.landed + perch.missed + perch.slips;
}

/* ------------------------------------------------------------------ */

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(FIELD_WIDTH);
    expect(manifest.logical.height).toBe(FIELD_HEIGHT);
  });

  it('splits the device the way the two perches are stacked', () => {
    // A vertical split would put the two perches side by side and each player would be
    // reading their own one sideways.
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.category).toBe('Platform');
    expect(manifest.modes).toEqual(['friend', 'bot']);
  });

  it('offers both presentations', () => {
    expect(manifest.presentations).toEqual(['shared-screen', 'single-seat']);
  });

  it('advertises a round length a real match is in the neighbourhood of', () => {
    expect(manifest.roundSeconds).toBeGreaterThan(30);
    expect(manifest.roundSeconds).toBeLessThanOrEqual(ROUND_SECONDS);
  });

  it('tells each player which key is theirs', () => {
    // `apps/web/src/data/controls.test.ts` enforces this across the catalogue; here it
    // fails next to the game rather than next to a list of seventy manifests.
    expect(manifest.controls.keyboard).toMatch(/seat one/i);
    expect(manifest.controls.keyboard).toMatch(/seat two/i);
    expect(manifest.controls.keyboard).toMatch(/space/i);
    expect(manifest.controls.keyboard).toMatch(/enter/i);
  });

  it('never offers the two key halves as one player s choice', () => {
    // The shell does not map both halves onto the active seat — `setBoardSeat` moves
    // *pointer* ownership and touches the keyboard not at all — so a line saying
    // "Space or Enter" would be false in this game and in every other one.
    expect(manifest.controls.keyboard).not.toMatch(/\bor\b/i);
    expect(manifest.controls.keyboard).not.toMatch(/arrow|wasd|w a s d/i);
  });

  it('says where a finger has to land', () => {
    expect(manifest.controls.pointer).toMatch(/own half/i);
    expect(manifest.controls.pointer.length).toBeGreaterThan(3);
  });

  it('does not claim to be same-input-class only', () => {
    // One press is the whole input and nothing is held, so a thumb and a key are the same
    // instrument here. The parity test below is what earns this.
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});

describe('the control strings are true', () => {
  it('hops seat one on Space and nobody else', () => {
    const { game, manager, view } = waiting();
    manager.keyDown('Space');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.keyUp('Space');
    expect(game.match.p1.stance).toBe('airborne');
    expect(game.match.p1.block.free).toBe(true);
    expect(game.match.p2.stance).toBe('waiting');
    expect(game.match.p2.block.free).toBe(false);
    game.destroy();
  });

  it('hops seat two on Enter and nobody else', () => {
    const { game, manager, view } = waiting();
    manager.keyDown('Enter');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.keyUp('Enter');
    expect(game.match.p2.stance).toBe('airborne');
    expect(game.match.p1.stance).toBe('waiting');
    game.destroy();
  });

  it('cuts the block loose in the same instant it hops, as the line says', () => {
    const { game, manager, view } = waiting();
    manager.keyDown('Space');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.stance).toBe('airborne');
    expect(game.match.p1.block.free).toBe(true);
    expect(game.match.p1.air).toBe(0);
    game.destroy();
  });

  it('does nothing at all on any other key', () => {
    // The manifest says one press is the whole game and names one key a seat. Nothing is
    // held and nothing else on the keyboard is bound to anything this game reads.
    const { game, manager, view } = waiting();
    const before = { p1: game.match.p1.wait, p2: game.match.p2.wait };
    for (const key of [
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Escape',
      'Tab',
      'KeyQ',
    ]) {
      manager.keyDown(key);
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      manager.keyUp(key);
    }
    expect(game.match.p1.stance).toBe('waiting');
    expect(game.match.p2.stance).toBe('waiting');
    expect(game.match.p1.wait).toBeGreaterThan(before.p1);
    expect(game.match.p1.block.free).toBe(false);
    expect(game.match.p2.block.free).toBe(false);
    game.destroy();
  });

  it('hops once for a key left down, not sixty times a second', () => {
    // A press is an edge, so a key resting on the desk cannot hold the rope. Without that a
    // stuck key would cut every block loose the instant it was hung. The block after it is
    // hung and then hesitated away, which is what a key nobody is pressing should look like.
    const { game, manager, view } = waiting();
    manager.keyDown('Space');
    for (let i = 0; i < 240; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(released(game)).toBe(1);
    expect(game.match.p1.used).toBeGreaterThan(1);
    game.destroy();
  });

  it('hops on a tap in your own half, as the pointer line says', () => {
    const { game, manager, view } = waiting();
    // Anywhere across the width of the near half, which is what "anywhere" means.
    manager.pointerDown(0, 40, FIELD_HEIGHT - 60);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.stance).toBe('airborne');
    expect(game.match.p2.stance).toBe('waiting');
    game.destroy();
  });

  it('hops the far seat on a tap in the far half', () => {
    const { game, manager, view } = waiting();
    manager.pointerDown(0, FIELD_WIDTH - 40, 60);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p2.stance).toBe('airborne');
    expect(game.match.p1.stance).toBe('waiting');
    game.destroy();
  });

  it('counts a tap that began and ended between two frames', () => {
    const { game, manager, view } = waiting();
    manager.pointerDown(2, 300, FIELD_HEIGHT - 100);
    manager.pointerUp(2);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.stance).toBe('airborne');
    game.destroy();
  });

  it('keeps a finger that started in your half yours across the midline', () => {
    // The seats rule, exercised through the engine rather than reimplemented here.
    const { game, manager, view } = waiting();
    manager.pointerDown(3, 100, FIELD_HEIGHT - 40);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.stance).toBe('airborne');
    expect(game.match.p2.stance).toBe('waiting');
    // Dragged the whole way into the far seat s half, and it is still seat one s finger.
    manager.pointerMove(3, 100, 40);
    for (let i = 0; i < 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p2.used).toBe(1);
    expect(game.match.p2.block.free).toBe(false);
    game.destroy();
  });

  it('hops once for a finger resting on the glass, not on every frame', () => {
    const { game, manager, view } = waiting();
    manager.pointerDown(1, 200, FIELD_HEIGHT - 200);
    for (let i = 0; i < 240; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(released(game)).toBe(1);
    game.destroy();
  });

  it('plays the identical match through a thumb and through a key', () => {
    // Rule 10 in one assertion. One press is the whole input, so the two instruments have
    // nothing to differ by — and this is the test that says so rather than the comment.
    const run = (tap: boolean): string => {
      const { game, manager, view } = waiting();
      const seen: number[] = [];
      for (let i = 0; i < 60 * 40 && game.getScore().winner === null; i += 1) {
        if (i % 47 === 0) {
          if (tap) manager.pointerDown(0, 120, FIELD_HEIGHT - 120);
          else manager.keyDown('Space');
        }
        if (i % 47 === 1) {
          if (tap) manager.pointerUp(0);
          else manager.keyUp('Space');
        }
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 9 === 0) seen.push(game.match.p1.points, game.match.p1.used, game.match.p1.air);
      }
      game.destroy();
      return seen.map((value) => value.toFixed(9)).join(',');
    };
    const keyed = run(false);
    expect(keyed).toBe(run(true));
    // And it has to have been a real match rather than two empty ones.
    expect(keyed).not.toMatch(/^0[,0.]*$/);
  });
});

describe('a fresh match', () => {
  it('starts level, with nobody having won', () => {
    const game = new ChickenJumpGame();
    game.init(context());
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    // `apps/web/src/data/turn-seat.test.ts` reads the value rather than the method, and a
    // real-time game that named an active seat would take one seat s half of the glass away.
    const game = new ChickenJumpGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });

  it('stands both chickens on an empty rope before the first block', () => {
    const game = new ChickenJumpGame();
    game.init(context());
    expect(game.match.p1.stance).toBe('resting');
    expect(game.match.p1.rest).toBe(READY_SECONDS);
    expect(game.match.p1.block.live).toBe(false);
    expect(game.match.p2.block.live).toBe(false);
    game.destroy();
  });

  it('gives both seats the same budget', () => {
    const game = new ChickenJumpGame();
    game.init(context());
    expect(game.match.p1.used).toBe(0);
    expect(game.match.p2.used).toBe(0);
    game.destroy();
  });

  it('is level again after a second init, so a rematch is a fresh match', () => {
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    finish(game, manager, view);
    expect(game.match.p1.used).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'hard' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.elapsed).toBe(0);
    expect(game.match.p1.used).toBe(0);
    expect(game.match.drawn).toBe(0);
    game.destroy();
  });

  it('leaves nothing behind when it is torn down', () => {
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 600; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.p1.used).toBe(0);
  });

  it('can be torn down and stood back up while a match is running', () => {
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 300; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.destroy();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 300; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.used).toBeGreaterThan(0);
    game.destroy();
  });
});

describe('a full match', () => {
  it('reaches a decision at every tier, inside the budget', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new ChickenJumpGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      const steps = finish(game, manager, view);
      expect(game.getScore().winner, `${tier} never finished`).not.toBeNull();
      expect(steps / 60, `${tier} took too long`).toBeLessThan(ROUND_SECONDS);
      expect(game.match.p1.used).toBeLessThanOrEqual(MAX_BLOCKS);
      expect(game.match.p2.used).toBeLessThanOrEqual(MAX_BLOCKS);
      game.destroy();
    }
  });

  it('finishes a match nobody plays at all', () => {
    // The property a stacking game has to earn: nothing arrives on its own, so two people
    // who never press must still run out of blocks rather than sit there.
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context());
    const steps = finish(game, manager, view);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: 'draw' });
    expect(game.match.p1.used).toBe(MAX_BLOCKS);
    expect(game.match.p2.used).toBe(MAX_BLOCKS);
    expect(steps / 60).toBeLessThan(ROUND_SECONDS);
    game.destroy();
  });

  it('finishes a match both people mash from the first frame', () => {
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context());
    const steps = finish(game, manager, view, () => {
      manager.keyDown('Space');
      manager.keyUp('Space');
      manager.keyDown('Enter');
      manager.keyUp('Enter');
    });
    expect(game.getScore().winner).not.toBeNull();
    expect(steps / 60).toBeLessThan(ROUND_SECONDS);
    game.destroy();
  });

  it('is won by reaching the target and not by anything else', () => {
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: (seat: SeatId) => (seat === 'p1' ? 'hard' : 'easy') }));
    finish(game, manager, view);
    const score = game.getScore();
    expect(score.winner).toBe('p1');
    expect(score.p1).toBeGreaterThanOrEqual(TARGET_POINTS);
    expect(score.p2).toBeLessThan(TARGET_POINTS);
    game.destroy();
  });

  it('reports the same score the perches hold', () => {
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      expect(score.p1).toBe(game.match.p1.points);
      expect(score.p2).toBe(game.match.p2.points);
    }
    game.destroy();
  });

  it('stops simulating once it is decided', () => {
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    finish(game, manager, view);
    const settled = JSON.stringify(game.match);
    for (let i = 0; i < 300; i += 1) {
      manager.keyDown('Space');
      manager.keyUp('Space');
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(JSON.stringify(game.match)).toBe(settled);
    game.destroy();
  });

  it('plays the identical match from the same seed, whatever the presentation', () => {
    // Rule 8 in one assertion: single-seat and shared-screen are two layouts of one
    // simulation, so the trace must not depend on which one the shell chose.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new ChickenJumpGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
      const seen: number[] = [];
      for (let i = 0; i < 1800; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 17 === 0) seen.push(game.match.p1.points, game.match.p2.points, game.match.elapsed);
      }
      game.destroy();
      return seen.map((value) => value.toFixed(9)).join(',');
    };
    expect(trace('single-seat', 'p2')).toBe(trace('shared-screen', 'p1'));
  });

  it('answers a storm of random presses without ever refusing to move', () => {
    // What `apps/web/src/data/input-fuzz.test.ts` asks of every game: four simulated
    // minutes of nonsense must not throw, and must be able to move the score.
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    const rng = new Rng(4242);
    game.init(context());
    let matches = 0;
    let moved = 0;
    let last = '0:0';
    for (let i = 0; i < 60 * 240; i += 1) {
      if (rng.bool(0.03)) manager.keyDown('Space');
      if (rng.bool(0.03)) manager.keyUp('Space');
      if (rng.bool(0.03))
        manager.pointerDown(0, rng.float() * FIELD_WIDTH, rng.float() * FIELD_HEIGHT);
      if (rng.bool(0.03)) manager.pointerUp(0);
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      expect(Number.isFinite(score.p1)).toBe(true);
      const shown = `${score.p1}:${score.p2}`;
      if (shown !== last) moved += 1;
      last = shown;
      if (score.winner !== null) {
        matches += 1;
        game.init(context({ rng: new Rng(i + 1) }));
        last = '0:0';
      }
    }
    expect(matches).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0);
    game.destroy();
  });
});

describe('the bots the lobby offers', () => {
  const play = (difficulty: (seat: SeatId) => BotDifficulty | null, steps: number): string => {
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: difficulty }));
    const seen: number[] = [];
    for (let i = 0; i < steps && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 === 0) seen.push(game.match.p1.used, game.match.p1.points, game.match.p1.air);
    }
    game.destroy();
    return seen.map((value) => value.toFixed(6)).join(',');
  };

  it('plays a visibly different match on easy and on hard', () => {
    expect(play(() => 'hard', 60 * 12)).not.toBe(play(() => 'easy', 60 * 12));
  });

  it('plays a different match on normal than on either of the others', () => {
    expect(play(() => 'normal', 60 * 12)).not.toBe(play(() => 'easy', 60 * 12));
    expect(play(() => 'normal', 60 * 12)).not.toBe(play(() => 'hard', 60 * 12));
  });

  it('plays a different match with a bot than with nobody', () => {
    expect(play(() => 'normal', 60 * 12)).not.toBe(play(() => null, 60 * 12));
  });

  it('sits a bot in exactly the seat it was asked to', () => {
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: (seat: SeatId) => (seat === 'p2' ? 'hard' : null) }));
    for (let i = 0; i < 60 * 12; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    // The empty seat never pressed, so every one of its blocks was cut down unreleased.
    expect(game.match.p1.losses).toBe(game.match.p1.used - 1);
    expect(game.match.p1.points).toBe(0);
    expect(game.match.p2.points).toBeGreaterThan(0);
    game.destroy();
  });

  it('beats an absent player with any tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new ChickenJumpGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: (seat: SeatId) => (seat === 'p1' ? tier : null) }));
      finish(game, manager, view);
      expect(game.getScore().winner, `${tier} lost to nobody`).toBe('p1');
      game.destroy();
    }
  });
});

describe('rendering', () => {
  it('draws every shape inside the declared box, at every stage of a match', () => {
    const { renderer, drawn } = recorder();
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 25; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 7 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    // Reduced to one number and asserted once: a frame hands the renderer several hundred
    // coordinates, and the assertion machinery rather than the game is what would be slow.
    let worst = 0;
    for (const value of drawn) worst = Math.max(worst, Math.abs(value));
    expect(worst).toBeLessThanOrEqual(Math.max(FIELD_WIDTH, FIELD_HEIGHT) * 2);
  });

  it('draws into both halves of the device', () => {
    // Rule 9, as geometry: neither player may see more of the play area than the other, and
    // the way that fails first is one seat s furniture never being drawn at all.
    const { renderer, drawn } = recorder();
    const { game, manager, view } = waiting({ botDifficulty: () => 'normal' });
    for (let i = 0; i < 200; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.render(renderer);
    game.destroy();
    expect(drawn.some((value) => value > FIELD_HEIGHT - LANE_HEIGHT)).toBe(true);
    expect(drawn.some((value) => value < LANE_HEIGHT)).toBe(true);
  });

  it('gives the two seats a signal beyond their colour', () => {
    // Rule 7. Seat two s furniture is notched and barred in ink, which is a shape the near
    // seat s is not — so the two towers are told apart in greyscale.
    const { renderer, colours } = recorder();
    const { game, manager, view } = waiting({ botDifficulty: () => 'hard' });
    for (let i = 0; i < 60 * 12; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.render(renderer);
    game.destroy();
    expect(colours).toContain(SEAT_PALETTE.p1.base);
    expect(colours).toContain(SEAT_PALETTE.p2.base);
    // The ink used for seat two s notches and bars, drawn nowhere on seat one s tower.
    expect(colours.filter((colour) => colour === '#06101a').length).toBeGreaterThan(2);
  });

  it('draws the shadow the bot reads, so nothing it knows is hidden', () => {
    // CLAUDE.md rule 6, as a drawing: `stopPointOf` is the one number the bot s policy
    // turns on, and it is on the screen whenever a block is on the rope.
    const { renderer, drawn } = recorder();
    const { game } = waiting();
    const before = drawn.length;
    game.render(renderer);
    const withBlock = drawn.length - before;
    game.destroy();

    const bare = recorder();
    const other = new ChickenJumpGame();
    other.init(context());
    other.render(bare.renderer);
    const withoutBlock = bare.drawn.length;
    other.destroy();
    expect(withBlock).toBeGreaterThan(withoutBlock);
  });

  it('draws a landing flash, so a block that was lost reads at a glance', () => {
    const { renderer, drawn } = recorder();
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context());
    for (let i = 0; i < 600 && game.match.p1.last === 'none'; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(game.match.p1.last).toBe('lost');
    game.render(renderer);
    game.destroy();
    expect(drawn.length).toBeGreaterThan(0);
  });

  it('draws a tower that has grown taller than the pole', () => {
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    finish(game, manager, view);
    const { renderer, drawn } = recorder();
    game.render(renderer);
    expect(drawn.length).toBeGreaterThan(0);
    game.destroy();
  });

  it('does not move the simulation on', () => {
    const { renderer } = recorder();
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 300; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    const before = JSON.stringify(game.match);
    for (let i = 0; i < 50; i += 1) game.render(renderer);
    expect(JSON.stringify(game.match)).toBe(before);
    game.destroy();
  });

  it('survives a pause and a resume without losing the match', () => {
    const game = new ChickenJumpGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 600; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    const before = game.getScore();
    game.onPause();
    game.onResume();
    expect(game.getScore()).toEqual(before);
    game.destroy();
  });

  it('does not let a pause become a free block', () => {
    // The hesitation clock is the termination guarantee, so a pause that reset it would be
    // an unbounded match wearing a pause menu.
    const { game, manager, view } = waiting();
    for (let i = 0; i < 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    const waited = game.match.p1.wait;
    game.onPause();
    game.onResume();
    expect(game.match.p1.wait).toBe(waited);
    expect(game.match.p1.wait).toBeLessThan(HESITATE_SECONDS);
    game.destroy();
  });
});
