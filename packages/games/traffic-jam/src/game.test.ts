import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Game, GameContext, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { CENTRE_X, CENTRE_Y, STICK_DEADZONE, TrafficJamGame, boxX, boxY } from './game.js';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ARM_X,
  ARM_Y,
  BAR,
  CAR_RADIUS,
  ROUND_SECONDS,
  SPLASH_TARGET,
  START_ALONG,
  TURN_RATE,
  wrapAngle,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

interface Call {
  readonly kind: string;
  readonly args: readonly unknown[];
}

/** A renderer that records every call, so what a frame contains can be asserted. */
function recorder(): { calls: Call[]; renderer: Renderer } {
  const calls: Call[] = [];
  const push =
    (kind: string) =>
    (...args: unknown[]): void => {
      calls.push({ kind, args });
    };
  const renderer: Renderer = {
    clear: push('clear'),
    rect: push('rect'),
    strokeRect: push('strokeRect'),
    circle: push('circle'),
    strokeCircle: push('strokeCircle'),
    line: push('line'),
    text: push('text'),
    pushSeatRotation: push('pushSeatRotation'),
    pushRotation: push('pushRotation'),
    popSeatRotation: push('popSeatRotation'),
  };
  return { calls, renderer };
}

function contextFor(options?: {
  seed?: number;
  p1?: BotDifficulty | null;
  p2?: BotDifficulty | null;
  presentation?: 'shared-screen' | 'single-seat';
  localSeat?: SeatId;
}): GameContext {
  return {
    manifest,
    rng: new Rng(options?.seed ?? 4242),
    presentation: options?.presentation ?? 'shared-screen',
    localSeat: options?.localSeat ?? 'p1',
    openingSeat: 'p1',
    botDifficulty: (seat) => (seat === 'p1' ? (options?.p1 ?? null) : (options?.p2 ?? null)),
  };
}

/** The very manager the host builds for this manifest: a horizontal split, p1 at the bottom. */
function managerFor(): InputManager {
  return new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' });
}

interface Rig {
  readonly game: TrafficJamGame;
  readonly input: InputManager;
  /** An arrow rather than a method, so destructuring it carries no `this` to lose. */
  readonly step: (count?: number) => void;
}

function rig(options?: Parameters<typeof contextFor>[0]): Rig {
  const game = new TrafficJamGame();
  game.init(contextFor(options));
  const input = managerFor();
  const view = new InputView();
  const step = (count = 1): void => {
    for (let i = 0; i < count; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
  };
  return { game, input, step };
}

/**
 * The wave rows of one frame, picked out by *when* they are drawn rather than by colour.
 *
 * The water goes down before the island does, and the only lines in front of the first
 * kerb rectangle are its waves — so this identifies them without a test having to know a
 * colour string, which would fail on a repaint rather than on a regression.
 */
function waveLines(): readonly Call[] {
  const { game } = rig();
  const { calls, renderer } = recorder();
  game.render(renderer, 0);
  const firstRect = calls.findIndex((call) => call.kind === 'rect');
  expect(firstRect).toBeGreaterThan(0);
  return calls.slice(0, firstRect).filter((call) => call.kind === 'line');
}

function headingOf(game: TrafficJamGame, seat: SeatId): number {
  return seat === 'p1' ? game.match.p1.heading : game.match.p2.heading;
}

/** Where a car is pointing as a unit vector, which is what a direction key is asking for. */
function facing(game: TrafficJamGame, seat: SeatId): { x: number; y: number } {
  const heading = headingOf(game, seat);
  return { x: Math.cos(heading), y: Math.sin(heading) };
}

describe('the manifest', () => {
  it('describes the game the code actually is', () => {
    expect(manifest.id).toBe('traffic-jam');
    expect(manifest.name).toBe('Traffic Jam');
    expect(manifest.archetype).toBe('rt-race');
    expect(manifest.category).toBe('Puzzle');
    expect(manifest.modes).toEqual(['friend', 'bot']);
    expect(manifest.presentations).toEqual(['shared-screen', 'single-seat']);
  });

  it('declares the box the simulation is actually sized in', () => {
    expect(manifest.logical.width).toBe(ARENA_WIDTH);
    expect(manifest.logical.height).toBe(ARENA_HEIGHT);
    expect(manifest.orientation).toBe('portrait');
  });

  it('declares the split the host will really give it', () => {
    // A game with no active seat gets a zoned split from GameHost, and a horizontal one
    // unless it asked for vertical. Saying `shared-board` here would be a manifest that
    // disagrees with the surface the player actually touches.
    expect(manifest.zoneSplit).toBe('horizontal');
  });

  it('advertises a round length in the neighbourhood of a real match', () => {
    expect(manifest.roundSeconds).toBeGreaterThan(20);
    expect(manifest.roundSeconds).toBeLessThan(ROUND_SECONDS);
  });

  it('says something to both input families', () => {
    expect(manifest.controls.keyboard.length).toBeGreaterThan(3);
    expect(manifest.controls.pointer.length).toBeGreaterThan(3);
  });

  it("never offers the two key halves as one player's choice", () => {
    // The exact check `controls.test.ts` runs across the whole catalogue.
    const { keyboard } = manifest.controls;
    expect(keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
    expect(keyboard).toMatch(/player one|player two|seat|left|right|near|far/i);
    expect(keyboard).toMatch(/w a s d|\ba and d\b|left and right/i);
  });

  it('does not claim to be unfair across input families', () => {
    // Every instrument names a direction and nothing else, and they all turn the car at
    // one rate. There is no press to repeat, so there is nothing to repeat faster.
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});

describe('the contract', () => {
  it('starts a match level and undecided', () => {
    const { game } = rig();
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
  });

  it('never claims to have turns', () => {
    const game = new TrafficJamGame();
    expect(game.getActiveSeat()).toBeNull();
    game.init(contextFor());
    expect(game.getActiveSeat()).toBeNull();
  });

  it('puts the cars on their marks at init', () => {
    const { game } = rig();
    expect(game.match.p1.y).toBe(START_ALONG);
    expect(game.match.p2.y).toBe(-START_ALONG);
    expect(game.match.p1.x).toBe(-game.match.p2.x);
  });

  it('draws a frame before anything has been stepped', () => {
    const game = new TrafficJamGame();
    const { calls, renderer } = recorder();
    expect(() => {
      game.render(renderer, 0);
    }).not.toThrow();
    expect(calls.length).toBeGreaterThan(0);
  });

  it('draws a frame after it has been torn down', () => {
    const { game } = rig();
    game.destroy();
    const { calls, renderer } = recorder();
    game.render(renderer, 0);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('is quiet once it has been torn down', () => {
    const { game, step } = rig({ p1: 'hard', p2: 'hard' });
    step(120);
    game.destroy();
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
    expect(game.match.elapsed).toBe(0);
    expect(game.match.traffic.some((lorry) => lorry.active)).toBe(false);
  });

  it('stands back up after being torn down', () => {
    const game = new TrafficJamGame();
    game.init(contextFor({ seed: 5 }));
    const view = new InputView();
    const input = managerFor();
    for (let i = 0; i < 200; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    game.destroy();
    game.init(contextFor({ seed: 5 }));
    expect(game.match.p1.y).toBe(START_ALONG);
    expect(game.match.elapsed).toBe(0);
    expect(() => {
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }).not.toThrow();
  });

  it('hands the shell the score as splashes caused', () => {
    const { game, step } = rig();
    game.match.p2.x = ARM_X + 500;
    step();
    expect(game.getScore().p1).toBe(1);
    expect(game.getScore().p2).toBe(0);
  });

  it('stops stepping once somebody has won', () => {
    const { game, step } = rig();
    game.match.p1Score = SPLASH_TARGET - 1;
    game.match.p2.x = ARM_X + 500;
    step();
    expect(game.getScore().winner).toBe('p1');
    const frozen = game.match.p1.x;
    step(60);
    expect(game.match.p1.x).toBe(frozen);
  });

  it('reaches a decision with two bots inside the round clock', () => {
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const p1 of tiers) {
      for (const p2 of tiers) {
        const { game, step } = rig({ p1, p2, seed: 606 });
        let steps = 0;
        for (; steps < 60 * 200; steps += 1) {
          step();
          if (game.getScore().winner !== null) break;
        }
        expect(game.getScore().winner, `${p1} v ${p2}`).not.toBeNull();
        expect(game.match.elapsed).toBeLessThanOrEqual(ROUND_SECONDS);
      }
    }
  });
});

/**
 * Put one car in the middle of the junction at rest.
 *
 * A car is always driving, so a key held for a second from the starting mark runs out of
 * road and the bout restarts underneath the assertion. From the junction there is a second
 * of room in every direction, and the tests below check `bouts` to prove they got it.
 */
function parkAtJunction(game: TrafficJamGame, seat: SeatId): void {
  const car = seat === 'p1' ? game.match.p1 : game.match.p2;
  car.x = 0;
  car.y = 0;
  car.vx = 0;
  car.vy = 0;
}

describe('the keyboard', () => {
  it('steers player one with W A S D, exactly as the manifest says', () => {
    const cases: readonly [string, number, number][] = [
      ['KeyD', 1, 0],
      ['KeyA', -1, 0],
      ['KeyS', 0, 1],
      ['KeyW', 0, -1],
    ];
    for (const [code, wantX, wantY] of cases) {
      const { game, input, step } = rig();
      parkAtJunction(game, 'p1');
      input.keyDown(code);
      step(60);
      expect(game.match.bouts, code).toBe(0);
      const face = facing(game, 'p1');
      expect(face.x, code).toBeCloseTo(wantX, 3);
      expect(face.y, code).toBeCloseTo(wantY, 3);
    }
  });

  it('steers player two with the arrow keys, exactly as the manifest says', () => {
    const cases: readonly [string, number, number][] = [
      ['ArrowRight', 1, 0],
      ['ArrowLeft', -1, 0],
      ['ArrowDown', 0, 1],
      ['ArrowUp', 0, -1],
    ];
    for (const [code, wantX, wantY] of cases) {
      const { game, input, step } = rig();
      parkAtJunction(game, 'p2');
      input.keyDown(code);
      step(60);
      expect(game.match.bouts, code).toBe(0);
      const face = facing(game, 'p2');
      expect(face.x, code).toBeCloseTo(wantX, 3);
      expect(face.y, code).toBeCloseTo(wantY, 3);
    }
  });

  it('turns at exactly the turn rate, whichever key it is', () => {
    const cases: readonly [string, SeatId, number, number][] = [
      ['KeyD', 'p1', 1, 0],
      ['KeyA', 'p1', -1, 0],
      ['KeyS', 'p1', 0, 1],
      ['KeyW', 'p1', 0, -1],
      ['ArrowRight', 'p2', 1, 0],
      ['ArrowLeft', 'p2', -1, 0],
      ['ArrowDown', 'p2', 0, 1],
      ['ArrowUp', 'p2', 0, -1],
    ];
    const steps = 20;
    for (const [code, seat, wantX, wantY] of cases) {
      const { game, input, step } = rig();
      const target = Math.atan2(wantY, wantX);
      const before = Math.abs(wrapAngle(target - headingOf(game, seat)));
      input.keyDown(code);
      step(steps);
      const after = Math.abs(wrapAngle(target - headingOf(game, seat)));
      const owed = Math.min(before, TURN_RATE * steps * STEP);
      expect(before - after, code).toBeCloseTo(owed, 6);
    }
  });

  it("never lets one seat's keys touch the other seat's car", () => {
    const { game, input, step } = rig();
    const p2Before = headingOf(game, 'p2');
    input.keyDown('KeyD');
    step(60);
    expect(headingOf(game, 'p2')).toBe(p2Before);

    const other = rig();
    const p1Before = headingOf(other.game, 'p1');
    other.input.keyDown('ArrowRight');
    other.step(60);
    expect(headingOf(other.game, 'p1')).toBe(p1Before);
  });

  it('leaves a car driving the way it was pointed when the key is let go', () => {
    const { game, input, step } = rig();
    parkAtJunction(game, 'p1');
    input.keyDown('KeyD');
    step(30);
    const held = headingOf(game, 'p1');
    input.keyUp('KeyD');
    step(20);
    expect(game.match.bouts).toBe(0);
    expect(headingOf(game, 'p1')).toBe(held);
  });

  it('never out-runs one key with two', () => {
    const single = rig();
    single.input.keyDown('KeyD');
    single.step(6);
    const diagonal = rig();
    diagonal.input.keyDown('KeyD');
    diagonal.input.keyDown('KeyS');
    diagonal.step(6);
    // Both turn at exactly the turn rate; two keys only change where they are turning to.
    const one = Math.abs(wrapAngle(headingOf(single.game, 'p1') + Math.PI / 2));
    const two = Math.abs(wrapAngle(headingOf(diagonal.game, 'p1') + Math.PI / 2));
    expect(two).toBeLessThanOrEqual(one + 1e-9);
  });

  it('is enough on its own to finish a match', () => {
    const { game, input, step } = rig({ p2: 'easy' });
    input.keyDown('KeyW');
    let steps = 0;
    for (; steps < 60 * 200; steps += 1) {
      step();
      if (game.getScore().winner !== null) break;
    }
    expect(game.getScore().winner).not.toBeNull();
  });
});

describe('the pointer', () => {
  it('plants a stick where the finger lands in your own half', () => {
    const { game, input, step } = rig();
    input.pointerDown(1, 300, 800);
    step();
    expect(game.stick('p1').down).toBe(true);
    expect(game.stick('p2').down).toBe(false);
  });

  it('turns the car the way the finger drags', () => {
    const { game, input, step } = rig();
    input.pointerDown(1, 300, 800);
    step();
    input.pointerMove(1, 480, 800);
    step(90);
    const face = facing(game, 'p1');
    expect(face.x).toBeCloseTo(1, 3);
    expect(face.y).toBeCloseTo(0, 3);
  });

  it('turns the far seat the same way for the same drag, with no mirror', () => {
    // The board is shared and both players are looking at the same glass, so a thumb that
    // drags towards the top of the device sends the car towards the top of the device
    // whichever end of it the thumb belongs to.
    const { game, input, step } = rig();
    input.pointerDown(1, 300, 200);
    step();
    input.pointerMove(1, 480, 200);
    step(90);
    const face = facing(game, 'p2');
    expect(face.x).toBeCloseTo(1, 3);
    expect(face.y).toBeCloseTo(0, 3);
  });

  it('says nothing while the finger is still inside the deadzone', () => {
    const { game, input, step } = rig();
    input.pointerDown(1, 300, 800);
    step();
    const before = headingOf(game, 'p1');
    input.pointerMove(1, 300 + STICK_DEADZONE - 3, 800);
    step(30);
    expect(headingOf(game, 'p1')).toBe(before);
  });

  it('answers the moment the finger is past the deadzone', () => {
    const { game, input, step } = rig();
    input.pointerDown(1, 300, 800);
    step();
    const before = headingOf(game, 'p1');
    input.pointerMove(1, 300 + STICK_DEADZONE + 12, 800);
    step();
    expect(headingOf(game, 'p1')).not.toBe(before);
  });

  it('reads only the direction, so a nudge and a sweep are worth the same', () => {
    const nudge = rig();
    nudge.input.pointerDown(1, 300, 800);
    nudge.step();
    nudge.input.pointerMove(1, 330, 800);
    nudge.step(30);

    const sweep = rig();
    sweep.input.pointerDown(1, 300, 800);
    sweep.step();
    sweep.input.pointerMove(1, 597, 800);
    sweep.step(30);

    expect(headingOf(sweep.game, 'p1')).toBe(headingOf(nudge.game, 'p1'));
  });

  it('keeps the seat it started in when the drag crosses the midline', () => {
    // The engine owns this; the game must not sort pointers itself.
    const { game, input, step } = rig();
    input.pointerDown(1, 500, 900);
    step();
    input.pointerMove(1, 100, 100);
    step(30);
    expect(game.stick('p1').down).toBe(true);
    expect(game.stick('p2').down).toBe(false);
    expect(headingOf(game, 'p2')).toBe(-Math.PI / 2 + Math.PI);
  });

  it('gives the upper half to player two and the lower to player one', () => {
    const { game, input, step } = rig();
    input.pointerDown(1, 200, 900);
    input.pointerDown(2, 400, 100);
    step();
    expect(game.stick('p1').down).toBe(true);
    expect(game.stick('p2').down).toBe(true);
    expect(game.stick('p1').originY).toBeGreaterThan(CENTRE_Y);
    expect(game.stick('p2').originY).toBeLessThan(CENTRE_Y);
  });

  it('drops the stick when the finger lifts, and the keys have it again', () => {
    const { game, input, step } = rig();
    input.pointerDown(1, 300, 800);
    step();
    input.pointerUp(1);
    step(2);
    expect(game.stick('p1').down).toBe(false);
    input.keyDown('KeyD');
    step(90);
    expect(facing(game, 'p1').x).toBeCloseTo(1, 3);
  });

  it('wins over a key that is being held at the same time', () => {
    const { game, input, step } = rig();
    input.keyDown('KeyD');
    input.pointerDown(1, 300, 800);
    step();
    const before = headingOf(game, 'p1');
    step(30);
    // A finger resting inside its deadzone is a player saying "hold this line", and that
    // is an answer rather than an absence of one.
    expect(headingOf(game, 'p1')).toBe(before);
  });

  it('starts a fresh stick where the finger lands the second time', () => {
    const { game, input, step } = rig();
    input.pointerDown(1, 200, 700);
    step();
    input.pointerUp(1);
    step(2);
    input.pointerDown(1, 400, 900);
    step();
    // Within the engine's precision lattice, which rounds every pointer onto a three-unit
    // grid so a mouse cannot aim finer than a thumb.
    expect(Math.abs(game.stick('p1').originX - 400)).toBeLessThanOrEqual(3);
    expect(Math.abs(game.stick('p1').originY - 900)).toBeLessThanOrEqual(3);
  });

  it('is enough on its own to finish a match', () => {
    const { game, input, step } = rig({ p2: 'easy' });
    input.pointerDown(1, 300, 800);
    step();
    input.pointerMove(1, 300, 640);
    let steps = 0;
    for (; steps < 60 * 200; steps += 1) {
      step();
      if (game.getScore().winner !== null) break;
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('survives a finger the browser reports somewhere impossible', () => {
    const { game, input, step } = rig();
    input.pointerDown(1, 300, 800);
    step();
    input.pointerMove(1, 1e9, -1e9);
    expect(() => {
      step(30);
    }).not.toThrow();
    expect(Number.isFinite(game.match.p1.x)).toBe(true);
    const { renderer } = recorder();
    expect(() => {
      game.render(renderer, 0);
    }).not.toThrow();
  });
});

describe('a pause', () => {
  it('drops both sticks, so a finger that moved while away cannot jerk the car', () => {
    const { game, input, step } = rig();
    input.pointerDown(1, 300, 800);
    step();
    expect(game.stick('p1').down).toBe(true);
    game.onPause();
    expect(game.stick('p1').down).toBe(false);
    expect(game.stick('p2').down).toBe(false);
  });

  it('leaves the momentum exactly where it stood', () => {
    const { game, step } = rig({ p1: 'normal', p2: 'normal' });
    step(200);
    const before = { x: game.match.p1.x, vx: game.match.p1.vx, heading: game.match.p1.heading };
    game.onPause();
    game.onResume();
    expect(game.match.p1.x).toBe(before.x);
    expect(game.match.p1.vx).toBe(before.vx);
    expect(game.match.p1.heading).toBe(before.heading);
  });
});

describe('the picture', () => {
  it('draws the whole board inside the declared box', () => {
    const { game, step } = rig({ p1: 'hard', p2: 'hard' });
    const { calls, renderer } = recorder();
    for (let i = 0; i < 400; i += 1) {
      step();
      game.render(renderer, 0);
    }
    const limit = Math.max(ARENA_WIDTH, ARENA_HEIGHT) * 2;
    for (const call of calls) {
      for (const arg of call.args) {
        if (typeof arg !== 'number') continue;
        expect(Math.abs(arg), `${call.kind} drew at ${String(arg)}`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('maps the junction to the middle of the box and nothing else', () => {
    expect(boxX(0)).toBe(CENTRE_X);
    expect(boxY(0)).toBe(CENTRE_Y);
    expect(boxX(ARM_X) - boxX(-ARM_X)).toBe(ARM_X * 2);
    expect(boxY(ARM_Y) - boxY(-ARM_Y)).toBe(ARM_Y * 2);
  });

  it('keeps the island inside the box at every flood', () => {
    const { game } = rig();
    for (let step = 0; step <= 10; step += 1) {
      game.match.flood = step / 10;
      const { calls, renderer } = recorder();
      game.render(renderer, 0);
      expect(calls.length).toBeGreaterThan(0);
    }
    expect(boxX(-ARM_X)).toBeGreaterThanOrEqual(0);
    expect(boxX(ARM_X)).toBeLessThanOrEqual(ARENA_WIDTH);
    expect(boxY(-ARM_Y)).toBeGreaterThanOrEqual(0);
    expect(boxY(ARM_Y)).toBeLessThanOrEqual(ARENA_HEIGHT);
  });

  it('gives the two cars different silhouettes, not just different colours', () => {
    // Rule 7. Both cars are put in the same attitude on opposite sides of the board and
    // their markings compared shape for shape, relative to their own centres.
    const { game } = rig();
    game.match.p1.x = -200;
    game.match.p1.y = -300;
    game.match.p1.heading = 0;
    game.match.p2.x = 200;
    game.match.p2.y = -300;
    game.match.p2.heading = 0;
    for (const lorry of game.match.traffic) lorry.active = false;
    const { calls, renderer } = recorder();
    game.render(renderer, 0);

    function marksFor(seat: SeatId, cx: number, cy: number): number[][] {
      const base = SEAT_PALETTE[seat].base;
      // The body is the one line drawn in that seat's own colour; the nose and the roof
      // marking follow it immediately, which is the order `#drawCar` lays them down in.
      const body = calls.findIndex((call) => call.kind === 'line' && call.args[5] === base);
      expect(body, `${seat} body was never drawn`).toBeGreaterThanOrEqual(0);
      const marks: number[][] = [];
      for (let i = body + 1; i < body + 4; i += 1) {
        const call = calls[i];
        if (call === undefined) break;
        marks.push([
          Number(call.args[0]) - cx,
          Number(call.args[1]) - cy,
          Number(call.args[2]) - cx,
          Number(call.args[3]) - cy,
        ]);
      }
      return marks;
    }

    const p1Marks = marksFor('p1', boxX(-200), boxY(-300));
    const p2Marks = marksFor('p2', boxX(200), boxY(-300));
    expect(p1Marks.length).toBe(3);
    expect(p2Marks.length).toBe(3);
    expect(p1Marks).not.toEqual(p2Marks);
    // And specifically: one seat carries a chevron, whose arms slope away from the nose;
    // the other carries bars straight across the roof, which at this heading are exactly
    // perpendicular to it. Both read in silhouette and both read in greyscale.
    for (const arm of p1Marks.slice(1)) {
      expect(Math.abs(arm[0]! - arm[2]!)).toBeGreaterThan(1);
    }
    for (const bar of p2Marks.slice(1)) {
      expect(Math.abs(bar[0]! - bar[2]!)).toBeLessThan(1e-9);
    }
  });

  it('shows a car in the water differently from a car on the road', () => {
    const { game } = rig();
    const dry = recorder();
    game.render(dry.renderer, 0);
    game.match.p1.inWater = true;
    game.match.p1.sink = 0.5;
    const wet = recorder();
    game.render(wet.renderer, 0);
    expect(wet.calls.length).toBeGreaterThan(dry.calls.length);
    // Ripples and a strike-through, rather than the same shape in another colour.
    expect(wet.calls.filter((call) => call.kind === 'strokeCircle').length).toBeGreaterThan(
      dry.calls.filter((call) => call.kind === 'strokeCircle').length,
    );
  });

  it('draws a stick only while a thumb is on the glass', () => {
    const { game, input, step } = rig();
    const before = recorder();
    game.render(before.renderer, 0);
    input.pointerDown(1, 300, 800);
    step();
    const during = recorder();
    game.render(during.renderer, 0);
    expect(during.calls.length).toBeGreaterThan(before.calls.length);
  });

  it('shows how much road the flood has already taken', () => {
    const { game } = rig();
    const dry = recorder();
    game.render(dry.renderer, 0);
    const dryGhosts = dry.calls.filter((call) => call.kind === 'strokeRect').length;
    game.match.flood = 0.5;
    const wet = recorder();
    game.render(wet.renderer, 0);
    expect(wet.calls.filter((call) => call.kind === 'strokeRect').length).toBeGreaterThan(
      dryGhosts,
    );
  });

  it('staggers the wave rows, rather than drawing every one of them alike', () => {
    // The stagger used to be read off `y` — `(y / 52) % 2 === 0` on rows starting at 26 —
    // which is never true, so every row took the same inset and the branch was dead.
    const insets = new Set(waveLines().map((call) => Number(call.args[0])));
    expect(insets.size).toBeGreaterThan(2);
  });

  it('lays the water down as its own half turn, like the island', () => {
    // The far seat reads the same board upside down, so the sea it is looking at has to be
    // the same sea. Every wave segment must have a partner at its 180° image.
    const waves = waveLines();
    expect(waves.length).toBeGreaterThan(0);
    const starts = new Set(waves.map((call) => `${String(call.args[0])},${String(call.args[1])}`));
    for (const call of waves) {
      const x = Number(call.args[2]);
      const y = Number(call.args[3]);
      // The far end of one segment is the near end of its partner, rotated about the middle.
      const partner = `${String(ARENA_WIDTH - x)},${String(ARENA_HEIGHT - y)}`;
      expect(starts.has(partner), `no half-turn partner for ${partner}`).toBe(true);
    }
  });

  it('never reads the presentation or the local seat', () => {
    // Rule 10 held by there being no branch to get wrong rather than by branching right.
    function frame(presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string {
      const game = new TrafficJamGame();
      game.init(contextFor({ seed: 91, p1: 'normal', p2: 'hard', presentation, localSeat }));
      const input = managerFor();
      const view = new InputView();
      const { calls, renderer } = recorder();
      for (let i = 0; i < 300; i += 1) {
        game.update(STEP, view.sync(input.beginStep(STEP)));
      }
      game.render(renderer, 0);
      return calls.map((call) => `${call.kind}:${call.args.join(',')}`).join('|');
    }
    expect(frame('single-seat', 'p2')).toBe(frame('shared-screen', 'p1'));
  });

  it('never rotates the world for one seat and not the other', () => {
    // A shared board is read from both ends of the device by design; a seat rotation here
    // would show one player the board and the other player the back of it.
    const { game, step } = rig({ p1: 'normal', p2: 'normal' });
    const { calls, renderer } = recorder();
    step(120);
    game.render(renderer, 0);
    expect(calls.some((call) => call.kind === 'pushSeatRotation')).toBe(false);
    expect(calls.some((call) => call.kind === 'pushRotation')).toBe(false);
  });

  it('never writes a word on the board', () => {
    // Half the players are reading the device upside down, so nothing on it is language.
    const { game, step } = rig({ p1: 'easy', p2: 'easy' });
    const { calls, renderer } = recorder();
    for (let i = 0; i < 300; i += 1) {
      step();
      game.render(renderer, 0);
    }
    expect(calls.some((call) => call.kind === 'text')).toBe(false);
  });
});

describe('the bot through the contract', () => {
  function trace(p1: BotDifficulty | null, p2: BotDifficulty | null, seed = 777): string {
    const game = new TrafficJamGame();
    game.init(contextFor({ seed, p1, p2 }));
    const input = managerFor();
    const view = new InputView();
    const rows: string[] = [];
    for (let i = 0; i < 60 * 25; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      if (i % 15 !== 0) continue;
      const score = game.getScore();
      rows.push(
        `${game.match.p1.x.toFixed(4)}:${game.match.p1.y.toFixed(4)}:` +
          `${String(score.p1)}:${String(score.p2)}`,
      );
      if (score.winner !== null) break;
    }
    game.destroy();
    return rows.join('|');
  }

  it('plays differently on easy and on hard', () => {
    expect(trace('hard', 'normal')).not.toBe(trace('easy', 'normal'));
  });

  it('plays differently from an empty seat', () => {
    expect(trace('normal', 'normal')).not.toBe(trace(null, null));
  });

  it('plays the identical match twice from one seed', () => {
    expect(trace('normal', 'hard', 31)).toBe(trace('normal', 'hard', 31));
  });

  it('plays a different match from a different seed', () => {
    expect(trace('normal', 'hard', 31)).not.toBe(trace('normal', 'hard', 32));
  });

  it('drives a car that a human never touches', () => {
    const { game, step } = rig({ p1: 'normal' });
    const before = { x: game.match.p1.x, y: game.match.p1.y };
    step(120);
    expect(game.match.p1.x !== before.x || game.match.p1.y !== before.y).toBe(true);
  });

  it('leaves an unoccupied seat to drive itself straight on', () => {
    const { game, step } = rig();
    const heading = game.match.p2.heading;
    step(40);
    expect(game.match.p2.heading).toBe(heading);
    expect(game.match.p2.y).toBeGreaterThan(-START_ALONG);
  });

  it('costs the same handful of arithmetic on every step', () => {
    // `bot-cost.test.ts` measures this for the whole catalogue; this is the local claim
    // that there is no search here to get out of hand.
    const { game, step } = rig({ p1: 'hard', p2: 'hard' });
    expect(() => {
      step(60 * 60);
    }).not.toThrow();
    expect(game.getScore().winner).not.toBeNull();
  });
});

describe('the whole game, driven the way a person drives it', () => {
  it('lets a thumb crash the other car into the water', () => {
    // The headline verb, end to end through the contract: a human seat that chases the
    // other car and shoulders it off the road.
    const game = new TrafficJamGame();
    game.init(contextFor({ seed: 12345, p2: 'easy' }));
    const input = managerFor();
    const view = new InputView();
    let rammed = 0;
    let sank = 0;
    input.pointerDown(1, 300, 800);
    for (let i = 0; i < 60 * 200; i += 1) {
      // The thumb chases the rival: a drag from the base towards wherever it is now,
      // which is exactly what a player does and nothing a player could not do.
      const target = game.match.p2;
      const self = game.match.p1;
      const dx = target.x - self.x;
      const dy = target.y - self.y;
      const length = Math.hypot(dx, dy) || 1;
      input.pointerMove(1, 300 + (dx / length) * 90, 800 + (dy / length) * 90);
      const before = game.match.p2.splashes;
      game.update(STEP, view.sync(input.beginStep(STEP)));
      if (game.match.p1.blame === 'rival') rammed += 1;
      if (game.match.p2.splashes > before && game.match.p2.blame === 'rival') sank += 1;
      if (game.getScore().winner !== null) break;
    }
    expect(rammed, 'a chasing thumb never once made contact').toBeGreaterThan(0);
    expect(sank, 'a chasing thumb never once put the other car in the water').toBeGreaterThan(0);
    game.destroy();
  });

  it('lets the keyboard do it too', () => {
    let sank = 0;
    for (let seed = 0; seed < 12 && sank === 0; seed += 1) {
      const game = new TrafficJamGame();
      game.init(contextFor({ seed: 500 + seed * 97, p2: 'easy' }));
      const input = managerFor();
      const view = new InputView();
      let held: string | null = null;
      for (let i = 0; i < 60 * 200; i += 1) {
        const dx = game.match.p2.x - game.match.p1.x;
        const dy = game.match.p2.y - game.match.p1.y;
        const want =
          Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'KeyD' : 'KeyA') : dy > 0 ? 'KeyS' : 'KeyW';
        if (want !== held) {
          if (held !== null) input.keyUp(held);
          input.keyDown(want);
          held = want;
        }
        const before = game.match.p2.splashes;
        game.update(STEP, view.sync(input.beginStep(STEP)));
        if (game.match.p2.splashes > before && game.match.p2.blame === 'rival') sank += 1;
        if (game.getScore().winner !== null) break;
      }
      game.destroy();
    }
    expect(sank, 'a chasing keyboard never once put the other car in the water').toBeGreaterThan(0);
  });

  it('answers a storm of nonsense without falling over', () => {
    const { game, input, step } = rig({ p2: 'normal' });
    const rng = new Rng(2024);
    for (let i = 0; i < 60 * 120; i += 1) {
      if (rng.float() < 0.06)
        input.pointerDown(i % 5, rng.float() * 900 - 150, rng.float() * 1400 - 200);
      if (rng.float() < 0.05) input.pointerMove(i % 5, rng.float() * 900, rng.float() * 1400);
      if (rng.float() < 0.05) input.pointerUp(i % 5);
      if (rng.float() < 0.04) input.keyDown('KeyW');
      if (rng.float() < 0.04) input.keyUp('KeyA');
      if (rng.float() < 0.01) game.onPause();
      if (rng.float() < 0.01) game.onResume();
      step();
      if (game.getScore().winner !== null) break;
    }
    expect(Number.isFinite(game.match.p1.x)).toBe(true);
    expect(Number.isFinite(game.match.p2.y)).toBe(true);
    const { renderer } = recorder();
    expect(() => {
      game.render(renderer, 0);
    }).not.toThrow();
  });

  it('keeps both cars on the board or in the water, never anywhere else', () => {
    const { game, step } = rig({ p1: 'hard', p2: 'easy' });
    for (let i = 0; i < 60 * 90; i += 1) {
      step();
      for (const car of [game.match.p1, game.match.p2]) {
        expect(Number.isFinite(car.x)).toBe(true);
        expect(Math.abs(car.x)).toBeLessThan(ARENA_WIDTH * 4);
        expect(Math.abs(car.y)).toBeLessThan(ARENA_HEIGHT * 4);
      }
      if (game.getScore().winner !== null) break;
    }
  });

  it('never lets a car sit still on the road', () => {
    const { game, step } = rig();
    for (let i = 0; i < 200; i += 1) {
      step();
      if (game.match.phase !== 'driving') break;
      expect(Math.hypot(game.match.p1.vx, game.match.p1.vy)).toBeGreaterThan(0);
    }
  });
});

describe('the game as the shell sees it', () => {
  it('is a Game, and answers every method the contract names', () => {
    const game: Game = new TrafficJamGame();
    game.init(contextFor());
    // Called through the interface, so the alpha the contract declares is the one passed.
    const { renderer } = recorder();
    game.update(STEP, new InputView().sync(managerFor().beginStep(STEP)));
    game.render(renderer, 0);
    game.onPause();
    game.onResume();
    expect(game.getScore().winner).toBeNull();
    expect(game.getActiveSeat?.()).toBeNull();
    game.destroy();
  });

  it('reports a draw rather than nothing when the clock finds the two level', () => {
    const { game, step } = rig();
    game.match.elapsed = ROUND_SECONDS - STEP / 2;
    step();
    expect(game.getScore().winner).toBe('draw');
  });

  it('keeps the score and the water in step', () => {
    const { game, step } = rig({ p1: 'normal', p2: 'normal' });
    for (let i = 0; i < 60 * 120; i += 1) {
      step();
      expect(game.getScore().p1 + game.getScore().p2).toBe(
        game.match.p1.splashes + game.match.p2.splashes,
      );
      if (game.getScore().winner !== null) break;
    }
  });

  it('never lets the score run past the target', () => {
    const { game, step } = rig({ p1: 'hard', p2: 'easy' });
    for (let i = 0; i < 60 * 200; i += 1) {
      step();
      expect(game.getScore().p1).toBeLessThanOrEqual(SPLASH_TARGET);
      expect(game.getScore().p2).toBeLessThanOrEqual(SPLASH_TARGET);
      if (game.getScore().winner !== null) break;
    }
  });

  it('starts both cars far enough from the water to have a chance', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const { game } = rig({ seed });
      expect(Math.abs(game.match.p1.x)).toBeLessThan(BAR - CAR_RADIUS);
      expect(Math.abs(game.match.p2.x)).toBeLessThan(BAR - CAR_RADIUS);
    }
  });
});
