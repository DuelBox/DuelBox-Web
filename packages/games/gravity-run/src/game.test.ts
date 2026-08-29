import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { GameContext, Renderer } from '@duelbox/game-sdk';
import { GravityRunGame } from './game.js';
import { manifest } from './manifest.js';
import {
  CEILING,
  COURSE_HEIGHT,
  COURSE_WIDTH,
  FLIP_COOLDOWN,
  FLOOR,
  RACE_CELLS,
  RISE,
  ROUND_SECONDS,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
/** A point in the near seat's own lane, on its floor side and on its ceiling side. */
const NEAR_FLOOR_Y = 900;
const NEAR_CEILING_Y = 620;
/** The same two points in the far seat's lane, which is the box turned half a turn. */
const FAR_FLOOR_Y = COURSE_HEIGHT - NEAR_FLOOR_Y;
const FAR_CEILING_Y = COURSE_HEIGHT - NEAR_CEILING_Y;

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

function run(game: GravityRunGame, manager: InputManager, view: InputView, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
}

/** A renderer that answers every call and remembers every number it was given. */
function recorder(drawn: number[]): Renderer {
  const record = (...args: unknown[]): void => {
    for (const arg of args) if (typeof arg === 'number') drawn.push(arg);
  };
  const noop = (): void => undefined;
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
    expect(manifest.logical.width).toBe(COURSE_WIDTH);
    expect(manifest.logical.height).toBe(COURSE_HEIGHT);
  });

  it('splits the screen the way two lanes lie, one above the other', () => {
    // A vertical split would put the two lanes side by side, and neither would be long
    // enough to show a runner anything it had time to react to.
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.orientation).toBe('portrait');
  });

  it('claims to be fair across input families, and the flip cadence is why', () => {
    expect(manifest.sameInputClassOnly).toBe(false);
  });

  it('tells each seat which half of the keyboard is theirs', () => {
    // `controls.test.ts` in the shell enforces this across every game; asserted here too
    // so a change to the wording fails where the wording lives.
    expect(manifest.controls.keyboard).toMatch(/w a s d/i);
    expect(manifest.controls.keyboard).toMatch(/arrow/i);
    expect(manifest.controls.keyboard).toMatch(/seat/i);
    expect(manifest.controls.keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
  });
});

describe('a fresh match', () => {
  it('starts level, with nobody having won', () => {
    const game = new GravityRunGame();
    game.init(context());
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
  });

  it('has no turns, so the shell keeps a pointer zone for each seat', () => {
    const game = new GravityRunGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });

  it('is level again after a second init', () => {
    // The shell reuses one instance across a rematch, so anything left behind here would
    // start the next race part-run.
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    run(game, manager, view, 600);
    expect(game.getScore().p1 + game.getScore().p2).toBeGreaterThan(0);

    game.init(context({ botDifficulty: () => 'hard' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.elapsed).toBe(0);
    game.destroy();
  });

  it('leaves nothing behind when it is destroyed', () => {
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    run(game, manager, view, 600);
    game.destroy();
    expect(game.match.p1.distance).toBe(0);
    expect(game.match.p2.distance).toBe(0);
    expect(game.match.elapsed).toBe(0);
    expect(game.getScore().winner).toBeNull();
  });
});

describe('a person steering a runner', () => {
  it('sends the runner to the half of their own lane they touched', () => {
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, 300, NEAR_CEILING_Y);
    run(game, manager, view, 40);
    expect(game.match.p1.pull).toBe(CEILING);
    expect(game.match.p1.height).toBe(RISE);

    manager.pointerMove(0, 300, NEAR_FLOOR_Y);
    run(game, manager, view, 40);
    expect(game.match.p1.pull).toBe(FLOOR);
    game.destroy();
  });

  it('reads the far seat from the far seat, so their floor is the top of the device', () => {
    // Two people at opposite ends of one device. The far lane is the near lane turned half
    // a turn, so each player's floor is the edge of the box nearest them.
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, 300, FAR_CEILING_Y);
    run(game, manager, view, 40);
    expect(game.match.p2.pull).toBe(CEILING);

    manager.pointerMove(0, 300, FAR_FLOOR_Y);
    run(game, manager, view, 40);
    expect(game.match.p2.pull).toBe(FLOOR);
    game.destroy();
  });

  it('cannot reach into the other seat’s lane', () => {
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.pointerDown(0, 300, NEAR_CEILING_Y);
    run(game, manager, view, 60);
    expect(game.match.p1.pull).toBe(CEILING);
    expect(game.match.p2.pull).toBe(FLOOR);
    expect(game.match.p2.height).toBe(0);
    game.destroy();
  });

  it('gives each seat its own half of the keyboard, un-mirrored', () => {
    // The whole keyboard path, and the reason it needs no mirror: `W` is seat one's up and
    // the up arrow is seat two's up whichever way up either of them is sitting.
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('KeyW');
    manager.keyDown('ArrowUp');
    run(game, manager, view, 40);
    expect(game.match.p1.pull).toBe(CEILING);
    expect(game.match.p2.pull).toBe(CEILING);

    manager.keyUp('KeyW');
    manager.keyUp('ArrowUp');
    manager.keyDown('KeyS');
    manager.keyDown('ArrowDown');
    run(game, manager, view, 40);
    expect(game.match.p1.pull).toBe(FLOOR);
    expect(game.match.p2.pull).toBe(FLOOR);
    game.destroy();
  });

  it('flips on the action key, which is what the genre asks for', () => {
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('Space');
    run(game, manager, view, 1);
    expect(game.match.p1.pull).toBe(CEILING);
    expect(game.match.p2.pull).toBe(FLOOR);
    game.destroy();
  });

  it('keeps a tap that lands inside the lockout, and spends it exactly once', () => {
    // Without the latch a player has to press again at the instant the lockout ends, and
    // the game becomes one about timing a press rather than about choosing a moment.
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('Space');
    run(game, manager, view, 1);
    manager.keyUp('Space');
    expect(game.match.p1.pull).toBe(CEILING);
    // A tap while the lockout is still running: kept, and spent by the flip it releases.
    manager.keyDown('Space');
    run(game, manager, view, 1);
    manager.keyUp('Space');
    expect(game.match.p1.pull).toBe(CEILING);
    run(game, manager, view, Math.ceil(FLIP_COOLDOWN / STEP) + 2);
    expect(game.match.p1.pull).toBe(FLOOR);
    // And exactly once: nothing is left over to flip it a third time.
    run(game, manager, view, 40);
    expect(game.match.p1.pull).toBe(FLOOR);
    game.destroy();
  });

  it('flips no faster for being mashed than for being held', () => {
    // Input parity in one assertion. A keyboard repeats faster than a thumb can leave the
    // glass; the flip cadence is what stops that deciding the race.
    //
    // Measured over the first second, which the runner spends inside the opening cells:
    // nothing can catch it there, so the two runs are comparing flips and nothing else.
    const flipsFrom = (drive: (manager: InputManager, step: number) => void): number => {
      const game = new GravityRunGame();
      const { manager, view } = inputs();
      game.init(context());
      let flips = 0;
      let pull = game.match.p1.pull;
      for (let i = 0; i < 60; i += 1) {
        drive(manager, i);
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (game.match.p1.pull !== pull) {
          flips += 1;
          pull = game.match.p1.pull;
        }
      }
      expect(game.match.p1.falls).toBe(0);
      game.destroy();
      return flips;
    };

    const held = flipsFrom((manager, step) => {
      if (step === 0) manager.keyDown('Space');
    });
    const mashed = flipsFrom((manager, step) => {
      if (step % 4 === 0) manager.keyDown('Space');
      if (step % 4 === 2) manager.keyUp('Space');
    });
    expect(held).toBeGreaterThan(3);
    expect(mashed).toBe(held);
    // And neither beats the cadence, however hard the key is worked.
    expect(held).toBeLessThanOrEqual(Math.ceil(1 / FLIP_COOLDOWN) + 1);
  });

  it('does not flip on the first step back from a pause', () => {
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context());
    manager.keyDown('Space');
    run(game, manager, view, 1);
    // A second press inside the lockout, latched and not yet spent.
    run(game, manager, view, 1);
    expect(game.match.p1.pull).toBe(CEILING);
    game.onPause();
    manager.clear();
    game.onResume();
    run(game, manager, view, 60);
    expect(game.match.p1.pull).toBe(CEILING);
    game.destroy();
  });
});

describe('a full race', () => {
  it('reaches a decision with two bots running it, at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = new GravityRunGame();
      const { manager, view } = inputs();
      game.init(context({ botDifficulty: () => tier }));
      let steps = 0;
      const limit = 60 * (ROUND_SECONDS + 5);
      for (; steps < limit && game.getScore().winner === null; steps += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const score = game.getScore();
      expect(score.winner, `${tier} never finished`).not.toBeNull();
      expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(RACE_CELLS);
      game.destroy();
    }
  });

  it('stops simulating once it is decided', () => {
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 60 * (ROUND_SECONDS + 5) && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    const settled = game.getScore();
    const held = game.match.p1.distance;
    run(game, manager, view, 300);
    expect(game.getScore()).toEqual(settled);
    expect(game.match.p1.distance).toBe(held);
    game.destroy();
  });

  it('runs the identical race from the same seed, whatever the presentation', () => {
    // Rule 8 in one assertion: single-seat and shared-screen are two layouts of one
    // simulation, so nothing in this game may branch on which the shell chose — and
    // nothing does, because the lane is symmetric under the half turn between the seats.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new GravityRunGame();
      const { manager, view } = inputs();
      game.init(context({ presentation, localSeat, botDifficulty: () => 'normal' }));
      const seen: number[] = [];
      for (let i = 0; i < 1500; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        if (i % 30 === 0) {
          seen.push(game.match.p1.distance, game.match.p2.distance, game.match.p1.height);
        }
      }
      game.destroy();
      return seen.map((n) => n.toFixed(9)).join(',');
    };
    expect(trace('single-seat', 'p2')).toBe(trace('shared-screen', 'p1'));
  });

  it('replays a fixed pointer trace to the identical score', () => {
    const play = (): string => {
      const game = new GravityRunGame();
      const { manager, view } = inputs();
      game.init(context());
      const script = new Rng(31337);
      for (let i = 0; i < 2400; i += 1) {
        if (i % 11 === 0) {
          manager.pointerDown(0, script.float() * COURSE_WIDTH, 500 + script.float() * 500);
          manager.pointerDown(1, script.float() * COURSE_WIDTH, script.float() * 500);
        }
        if (i % 11 === 5) {
          manager.pointerUp(0);
          manager.pointerUp(1);
        }
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const score = game.getScore();
      game.destroy();
      return `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}`;
    };
    expect(play()).toBe(play());
  });
});

describe('rendering', () => {
  it('draws every shape inside the declared box, at every stage of a race', () => {
    const drawn: number[] = [];
    const renderer = recorder(drawn);
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    for (let i = 0; i < 60 * 30; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 7 === 0) game.render(renderer);
    }
    game.destroy();

    expect(drawn.length).toBeGreaterThan(0);
    // Generous, as the shared harness is: what this catches is a game drawing in a box
    // unrelated to the one it declared, not a stroke overhanging by a few units.
    const limit = Math.max(COURSE_WIDTH, COURSE_HEIGHT) * 2;
    for (const value of drawn) expect(Math.abs(value)).toBeLessThanOrEqual(limit);
  });

  it('keeps every shape a seat owns inside that seat’s own half', () => {
    // Rule 9: neither player may ever see more of the play area than the other, and the
    // two halves are that promise made concrete. A lane drawn across the divider would be
    // running through the other player's reading space — and a course that scrolled past
    // the end of its own window would be showing one seat what the other cannot see.
    //
    // Checked on rectangles, where the extent is unambiguous, over a whole race so the
    // check meets a fallen runner, a full tally bar and the finish line coming into view.
    const rects: number[][] = [];
    const noop = (): void => undefined;
    const renderer: Renderer = {
      clear: noop,
      rect: (x, y, width, height) => rects.push([x, y, width, height]),
      strokeRect: noop,
      circle: noop,
      strokeCircle: noop,
      line: noop,
      text: noop,
      pushSeatRotation: noop,
      pushRotation: noop,
      popSeatRotation: noop,
    };

    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'hard' }));
    const middle = COURSE_HEIGHT / 2;
    let checked = 0;
    for (let i = 0; i < 60 * 30 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 !== 0) continue;
      rects.length = 0;
      game.render(renderer);
      for (const [x, y, width, height] of rects as [number, number, number, number][]) {
        // The divider is the one shape that belongs to neither seat and straddles both.
        if (width === COURSE_WIDTH && height <= 6) continue;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + width).toBeLessThanOrEqual(COURSE_WIDTH);
        expect(
          y >= middle || y + height <= middle,
          `a ${String(width)}x${String(height)} rect at y=${String(y)} crosses the divider`,
        ).toBe(true);
        checked += 1;
      }
    }
    game.destroy();
    expect(checked).toBeGreaterThan(500);
  });

  it('does not move the simulation on', () => {
    const drawn: number[] = [];
    const renderer = recorder(drawn);
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'normal' }));
    run(game, manager, view, 200);
    const before = { ...game.match.p1 };
    // The interpolation alpha the contract passes is deliberately not read: every moving
    // thing here is already a continuous value the simulation carries, so a frame is the
    // state as it stands.
    for (let i = 0; i < 50; i += 1) game.render(renderer);
    expect(game.match.p1).toEqual(before);
    game.destroy();
  });

  it('draws both seats, and draws them differently', () => {
    // Rule 7 has to be visible in the calls: two identical seats would produce the same
    // shapes twice and the only difference would be the colour string.
    const shapes: string[] = [];
    const note =
      (kind: string) =>
      (...args: unknown[]): void => {
        shapes.push(`${kind}:${args.map((a) => (typeof a === 'string' ? a : '')).join('')}`);
      };
    const renderer: Renderer = {
      clear: () => undefined,
      rect: note('rect'),
      strokeRect: note('strokeRect'),
      circle: note('circle'),
      strokeCircle: note('strokeCircle'),
      line: note('line'),
      text: note('text'),
      pushSeatRotation: () => undefined,
      pushRotation: () => undefined,
      popSeatRotation: () => undefined,
    };
    const game = new GravityRunGame();
    game.init(context());
    game.render(renderer);
    game.destroy();
    // The near seat's runner is a disc inside a disc; the far seat's is a square with a
    // bar across it. Two circles on the board, and both of them belong to seat one.
    expect(shapes.filter((shape) => shape.startsWith('circle')).length).toBe(2);
  });

  it('says nothing in words, so neither seat has to read it upside down', () => {
    const said: string[] = [];
    const noop = (): void => undefined;
    const renderer: Renderer = {
      clear: noop,
      rect: noop,
      strokeRect: noop,
      circle: noop,
      strokeCircle: noop,
      line: noop,
      text: (value: string) => said.push(value),
      pushSeatRotation: noop,
      pushRotation: noop,
      popSeatRotation: noop,
    };
    const game = new GravityRunGame();
    const { manager, view } = inputs();
    game.init(context({ botDifficulty: () => 'easy' }));
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 13 === 0) game.render(renderer);
    }
    game.destroy();
    expect(said).toEqual([]);
  });
});

describe('the layout', () => {
  it('gives each seat exactly half the box', () => {
    expect(COURSE_HEIGHT % 2).toBe(0);
    expect(CEILING).toBe(-FLOOR);
  });
});
