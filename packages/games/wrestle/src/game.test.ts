import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { BAR_Y, LEAN_REACH, RESET_STEPS, WrestleGame } from './game.js';
import { manifest } from './manifest.js';
import {
  ARENA_HALF,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  MAT_Y,
  MAX_ROUNDS,
  ROUNDS_TO_WIN,
  START_X,
  WIND_MAX,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
/** Ten simulated minutes, the same budget the shell's own termination guard allows. */
const TEN_MINUTES = 60 * 600;

interface MutableSeatInput {
  move: Vec2;
  pointer: Vec2 | null;
  actionPressed: boolean;
  actionHeld: boolean;
  actionReleased: boolean;
  holdSeconds: number;
}

function blankSeat(): MutableSeatInput {
  return {
    move: vec2(),
    pointer: null,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
  };
}

class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  lean(seat: SeatId, x: number): void {
    this.#mutable(seat).move.x = x;
  }

  point(seat: SeatId, x: number, y = MAT_Y): void {
    const target = this.#mutable(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  lift(seat: SeatId): void {
    this.#mutable(seat).pointer = null;
  }

  press(seat: SeatId, pressed: boolean): void {
    const target = this.#mutable(seat);
    target.actionPressed = pressed;
    target.actionHeld = pressed;
  }

  /** Held without the rising edge — what a finger already down looks like on a later step. */
  hold(seat: SeatId, held: boolean): void {
    this.#mutable(seat).actionHeld = held;
  }

  #mutable(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

type DrawArg = number | string | boolean | undefined;

interface DrawCall {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

/** Logs every call and every argument, so no draw can pass unobserved. */
class RecordingRenderer implements Renderer {
  readonly calls: DrawCall[] = [];

  clear(colour: string): void {
    this.#record('clear', colour);
  }

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#record('rect', x, y, width, height, colour);
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#record('strokeRect', x, y, width, height, lineWidth, colour);
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    this.#record('circle', x, y, radius, colour);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#record('strokeCircle', x, y, radius, lineWidth, colour);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#record('line', x1, y1, x2, y2, lineWidth, colour);
  }

  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.#record('text', value, x, y, sizePx, colour, align);
  }

  pushSeatRotation(rotated: boolean): void {
    this.#record('pushSeatRotation', rotated);
  }

  pushRotation(radians: number): void {
    this.pushSeatRotation(radians !== 0);
  }

  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  ops(op: string): readonly DrawCall[] {
    return this.calls.filter((call) => call.op === op);
  }

  #record(op: string, ...args: DrawArg[]): void {
    this.calls.push({ op, args });
  }
}

function drawnOnce(game: WrestleGame, alpha = 0): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer, alpha);
  return renderer;
}

/** Screen position of a seat's head, which is what the render tests look for. */
function headScreen(game: WrestleGame, seat: SeatId): readonly [number, number] {
  const w = game.wrestler(seat);
  return [
    ARENA_HALF + w.x + Math.sin(w.angle) * 130,
    MAT_Y - w.y - Math.cos(w.angle) * 130,
  ] as const;
}

function runToDecision(game: WrestleGame, input: InputState, limit: number): number {
  let steps = 0;
  while (game.getScore().winner === null && steps < limit) {
    game.update(STEP, input);
    steps += 1;
  }
  return steps;
}

function started(seed: number, botP1: BotDifficulty | null = null, botP2 = botP1): WrestleGame {
  const game = new WrestleGame();
  game.init(makeContext(seed, botP1, botP2));
  return game;
}

/** Play out the opening countdown so the next update is a live step. */
function openRound(game: WrestleGame, input: InputState): void {
  for (let i = 0; i < RESET_STEPS; i += 1) game.update(STEP, input);
}

describe('the manifest', () => {
  it('describes the game the shell has to host', () => {
    expect(manifest.id).toBe('wrestle');
    expect(manifest.name).toBe('Wrestle');
    expect(manifest.category).toBe('Arena');
    expect(manifest.archetype).toBe('rt-arena');
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.modes).toEqual(['friend', 'bot']);
    expect(manifest.presentations).toContain('shared-screen');
    expect(manifest.presentations).toContain('single-seat');
  });

  it('declares the logical box the rules actually simulate in', () => {
    expect(manifest.logical.width).toBe(ARENA_WIDTH);
    expect(manifest.logical.height).toBe(ARENA_HEIGHT);
  });

  it('gives each seat its own half of the keyboard, and says which', () => {
    const keyboard = manifest.controls.keyboard;
    expect(keyboard).toMatch(/a and d/i);
    expect(keyboard).toMatch(/arrow/i);
    expect(keyboard).toMatch(/near/i);
    expect(keyboard).toMatch(/far/i);
    // "W A S D or the arrow keys" is the lie the shell's own guard exists to catch: the
    // other half moves your opponent, it is not your alternative.
    expect(keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
  });

  it('names a pointer idiom, because this archetype has one', () => {
    expect(manifest.controls.pointer.length).toBeGreaterThan(3);
    expect(manifest.controls.pointer).toMatch(/lean/i);
    expect(manifest.controls.pointer).toMatch(/leap|jump/i);
  });

  it('never claims to have turns, because it does not', () => {
    // A real-time game that answered this would switch the shell into shared-board mode
    // and take one seat's pointer zone away.
    const game = new WrestleGame();
    expect((game as { getActiveSeat?: unknown }).getActiveSeat).toBeUndefined();
  });
});

describe('the opening', () => {
  it('stands the seats up as exact mirrors of one another', () => {
    for (const seed of [1, 2, 3, 40, 900]) {
      const game = started(seed);
      const p1 = game.wrestler('p1');
      const p2 = game.wrestler('p2');

      expect(p1.x).toBe(-START_X);
      expect(p2.x).toBe(START_X);
      expect(p1.angle).toBe(p2.angle);
      expect(p1.y).toBe(p2.y);
    }
  });

  it('holds both wrestlers still until the countdown expires', () => {
    const game = started(5);
    const input = new ScriptedInput();
    input.lean('p1', 1);
    input.press('p1', true);

    expect(game.resetCountdown).toBe(RESET_STEPS);
    const startX = game.wrestler('p1').x;
    for (let i = 0; i < RESET_STEPS; i += 1) game.update(STEP, input);

    expect(game.resetCountdown).toBe(0);
    expect(game.wrestler('p1').x).toBe(startX);

    game.update(STEP, input);
    expect(game.wrestler('p1').x).toBeGreaterThan(startX);
  });

  it('shows the first gust while the countdown runs, so nobody is surprised by it', () => {
    let found = false;
    for (const seed of [3, 5, 7, 11, 13]) {
      const game = started(seed);
      if (game.wind.strength !== 0) found = true;
      expect(Math.abs(game.wind.strength)).toBeLessThanOrEqual(WIND_MAX);
      expect(game.wind.upcoming).toBe(0);
    }
    expect(found).toBe(true);
  });

  it('sizes the round clock from the manifest, in whole steps', () => {
    const game = started(9);
    expect(game.roundSteps).toBe(0);

    game.update(STEP, new ScriptedInput());
    expect(game.roundSteps).toBe(manifest.roundSeconds * 60);
    expect(Number.isInteger(game.roundSteps)).toBe(true);
  });

  it('starts level, with nothing decided', () => {
    const score = started(9).getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
  });
});

describe('the controls', () => {
  /**
   * A round of seed 21 played out three ways at once, for forty live steps.
   *
   * Every claim about the controls in here is a comparison against the idle run rather
   * than against a bare number, because a round is never still: the gust blows on both
   * bodies from the first live step, so "this key does that" only means anything as a
   * difference from what the weather was doing anyway.
   */
  function threeWays(): {
    idle: WrestleGame;
    near: WrestleGame;
    far: WrestleGame;
  } {
    const idle = started(21);
    const idleInput = new ScriptedInput();
    const near = started(21);
    const nearInput = new ScriptedInput();
    nearInput.lean('p1', 1);
    const far = started(21);
    const farInput = new ScriptedInput();
    farInput.lean('p2', -1);

    for (let i = 0; i < RESET_STEPS + 40; i += 1) {
      idle.update(STEP, idleInput);
      near.update(STEP, nearInput);
      far.update(STEP, farInput);
    }
    return { idle, near, far };
  }

  it('leans the near seat with its own keys, and only its own', () => {
    const { idle, near } = threeWays();

    expect(near.wrestler('p1').angle).toBeGreaterThan(idle.wrestler('p1').angle);
    expect(near.wrestler('p1').x).toBeGreaterThan(idle.wrestler('p1').x);
    // The far seat is exactly where the gust alone left it, to the last bit: one seat's
    // keys never reach the other seat's body.
    expect(near.wrestler('p2').angle).toBe(idle.wrestler('p2').angle);
    expect(near.wrestler('p2').x).toBe(idle.wrestler('p2').x);
  });

  it('leans the far seat with its own keys, by the same amount the other way', () => {
    const { idle, near, far } = threeWays();

    // What each key bought, over and above the gust both seats were already feeling. The
    // gust is not mirrored within a round — it blows one way on both bodies — so the
    // mirror claim is about the two answers, not about the two poses. `rules.test.ts`
    // proves the physics mirrors bit for bit once the wind is mirrored too.
    const nearGain = near.wrestler('p1').angle - idle.wrestler('p1').angle;
    const farGain = far.wrestler('p2').angle - idle.wrestler('p2').angle;
    const nearTravel = near.wrestler('p1').x - idle.wrestler('p1').x;
    const farTravel = far.wrestler('p2').x - idle.wrestler('p2').x;

    expect(nearGain).toBeGreaterThan(0);
    expect(farGain).toBeCloseTo(-nearGain, 12);
    expect(farTravel).toBeCloseTo(-nearTravel, 9);
  });

  it('leans towards the side of the wrestler a finger is on', () => {
    const right = started(31);
    const rightInput = new ScriptedInput();
    // Seat one stands at screen x = ARENA_HALF - START_X; a finger well to its right.
    rightInput.point('p1', ARENA_HALF - START_X + LEAN_REACH * 2);
    const left = started(31);
    const leftInput = new ScriptedInput();
    leftInput.point('p1', ARENA_HALF - START_X - LEAN_REACH * 2);

    openRound(right, rightInput);
    openRound(left, leftInput);
    for (let i = 0; i < 40; i += 1) {
      right.update(STEP, rightInput);
      left.update(STEP, leftInput);
    }

    expect(right.wrestler('p1').angle).toBeGreaterThan(0);
    expect(left.wrestler('p1').angle).toBeLessThan(0);
  });

  it('reads a finger the same way whichever half of the glass it is on', () => {
    // The seats own a half of the device each and the mat is shared, so a lean is read
    // from the finger's x and never from which half it landed in.
    const high = started(31);
    const highInput = new ScriptedInput();
    highInput.point('p1', ARENA_HALF, 10);
    const low = started(31);
    const lowInput = new ScriptedInput();
    lowInput.point('p1', ARENA_HALF, ARENA_HEIGHT - 10);

    openRound(high, highInput);
    openRound(low, lowInput);
    for (let i = 0; i < 40; i += 1) {
      high.update(STEP, highInput);
      low.update(STEP, lowInput);
    }

    expect(low.wrestler('p1').angle).toBe(high.wrestler('p1').angle);
  });

  it('lets a finger override the keys rather than fighting them', () => {
    const game = started(31);
    const input = new ScriptedInput();
    input.lean('p1', -1);
    input.point('p1', ARENA_HALF - START_X + LEAN_REACH * 2);
    openRound(game, input);
    for (let i = 0; i < 40; i += 1) game.update(STEP, input);

    expect(game.wrestler('p1').angle).toBeGreaterThan(0);
  });

  it('falls back to the keys the moment the finger is lifted', () => {
    const game = started(31);
    const input = new ScriptedInput();
    input.point('p1', ARENA_HALF - START_X + LEAN_REACH * 2);
    openRound(game, input);
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    input.lift('p1');
    input.lean('p1', -1);
    for (let i = 0; i < 40; i += 1) game.update(STEP, input);

    expect(game.wrestler('p1').angle).toBeLessThan(0);
  });

  it('leaps on the pressed edge, and not once a step while it is held', () => {
    const game = started(41);
    const input = new ScriptedInput();
    openRound(game, input);

    input.press('p1', true);
    game.update(STEP, input);
    expect(game.wrestler('p1').stance).toBe('airborne');

    // Held down for a whole minute of frames: the wrestler still has to land and wait.
    let launches = 0;
    let wasGrounded = false;
    for (let i = 0; i < 300; i += 1) {
      game.update(STEP, input);
      const stance = game.wrestler('p1').stance;
      if (wasGrounded && stance === 'airborne') launches += 1;
      wasGrounded = stance === 'grounded';
    }

    expect(launches).toBeGreaterThan(0);
    expect(launches).toBeLessThan(8);
  });

  it('ignores a press that is not on the edge', () => {
    const game = started(41);
    const input = new ScriptedInput();
    openRound(game, input);
    input.hold('p1', true);
    game.update(STEP, input);

    expect(game.wrestler('p1').stance).toBe('grounded');
  });
});

describe('rounds and scoring', () => {
  /**
   * Seat one leans in and leaps at its opponent; seat two never touches a control.
   *
   * The shove is the only thing on the mat that can put a head down here — a leap is not
   * a self-knockout, because `JUMP_SPIN` was cut to a fifth for exactly that reason — so
   * a round decided inside the clock was decided by one wrestler flooring the other.
   */
  function pressHome(game: WrestleGame, input: ScriptedInput, limit = 6000): number {
    input.lean('p1', 1);
    input.press('p1', true);
    let steps = 0;
    while (game.getScore().p1 === 0 && steps < limit) {
      game.update(STEP, input);
      steps += 1;
    }
    return steps;
  }

  it('gives the round to the seat still standing when the other lands on its head', () => {
    const game = started(4711);
    const steps = pressHome(game, new ScriptedInput());

    expect(steps).toBeLessThan(6000);
    // Inside the round clock, so this was a fall rather than the steadiness tie-break the
    // clock falls back on.
    expect(steps).toBeLessThan(game.roundSteps);
    expect(game.getScore().p1).toBe(1);
    expect(game.getScore().p2).toBe(0);
  });

  it('counts rounds won, not falls or seconds', () => {
    const game = started(4711);
    const input = new ScriptedInput();
    input.lean('p1', 1);
    input.press('p1', true);
    runToDecision(game, input, TEN_MINUTES);

    const score = game.getScore();
    expect(score.winner).toBe('p1');
    expect(score.p1).toBe(ROUNDS_TO_WIN);
    expect(score.p2).toBeLessThan(ROUNDS_TO_WIN);
    // Three rounds, not five: the match stops on the round that settles it rather than
    // playing out a fixture list.
    expect(game.roundsPlayed).toBe(ROUNDS_TO_WIN);
  });

  it('stands both wrestlers back up between rounds', () => {
    const game = started(4711);
    const steps = pressHome(game, new ScriptedInput());

    expect(steps).toBeLessThan(6000);
    expect(game.resetCountdown).toBe(RESET_STEPS);
    expect(game.wrestler('p1').x).toBe(-START_X);
    expect(game.wrestler('p2').x).toBe(START_X);
    expect(game.wrestler('p1').stance).toBe('grounded');
    // The loser is stood back up too, and its steadiness starts the next round level:
    // a round is not carried into the one after it.
    expect(game.wrestler('p2').stance).toBe('grounded');
    expect(game.wrestler('p2').wobble).toBe(0);
    expect(game.roundsPlayed).toBe(1);
    expect(game.roundElapsed).toBe(0);
  });

  it('ends a match in which neither seat ever touches a control', () => {
    // Two motionless wrestlers is the standoff a physics game has to be able to end. The
    // round clock settles each round and the match is over after five of them, whatever
    // the mat looks like.
    const game = started(99);
    const idle = new ScriptedInput();

    const steps = runToDecision(game, idle, TEN_MINUTES);

    expect(steps).toBeLessThan(TEN_MINUTES);
    expect(game.getScore().winner).not.toBeNull();
    expect(game.roundsPlayed).toBeLessThanOrEqual(MAX_ROUNDS);
  });

  it('draws a match that two motionless wrestlers fight to a standstill', () => {
    // Both are stood up exactly mirrored and feel the same wind at the same instant, so
    // neither is ever the steadier and no round is ever awarded.
    const game = started(99);
    runToDecision(game, new ScriptedInput(), TEN_MINUTES);

    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBe('draw');
  });

  it('never runs past its round limit, whoever is playing', () => {
    for (const seed of [1, 77, 4711, 20260824]) {
      const game = started(seed, 'easy');
      runToDecision(game, new ScriptedInput(), TEN_MINUTES);

      expect(game.getScore().winner).not.toBeNull();
      expect(game.roundsPlayed).toBeLessThanOrEqual(MAX_ROUNDS);
    }
  });

  it('stops simulating once the match is decided', () => {
    const game = started(4711);
    const input = new ScriptedInput();
    input.lean('p1', 1);
    input.press('p1', true);
    runToDecision(game, input, TEN_MINUTES);

    const decided = game.getScore();
    const p1 = decided.p1;
    const p2 = decided.p2;
    const x = game.wrestler('p1').x;

    for (let i = 0; i < 300; i += 1) game.update(STEP, input);

    expect(game.getScore().p1).toBe(p1);
    expect(game.getScore().p2).toBe(p2);
    expect(game.wrestler('p1').x).toBe(x);
  });
});

describe('the wind', () => {
  function windTrace(seed: number, steps = 60 * 30): number[] {
    const game = started(seed, 'normal');
    const input = new ScriptedInput();
    const trace: number[] = [];
    for (let i = 0; i < steps; i += 1) {
      game.update(STEP, input);
      if (i % 30 === 0) trace.push(game.wind.strength);
    }
    return trace;
  }

  it('comes out of the seeded stream, so a match replays its own forecast', () => {
    expect(windTrace(20260824)).toEqual(windTrace(20260824));
  });

  it('differs between seeds, so two matches are not the same weather', () => {
    expect(windTrace(20260824)).not.toEqual(windTrace(20260825));
  });

  it('stays inside the strength the game admits to, all match', () => {
    const game = started(4242, 'hard');
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, input);
      expect(Math.abs(game.wind.strength)).toBeLessThanOrEqual(WIND_MAX);
      expect(Math.abs(game.wind.upcoming)).toBeLessThanOrEqual(WIND_MAX);
    }
  });

  it('announces the next gust before it arrives, and never before that', () => {
    const game = started(808, 'normal');
    const input = new ScriptedInput();
    let telegraphs = 0;
    let quiet = 0;
    for (let i = 0; i < 60 * 30; i += 1) {
      game.update(STEP, input);
      if (game.wind.warning > 0) {
        telegraphs += 1;
        expect(game.wind.warning).toBeLessThanOrEqual(1);
      } else {
        quiet += 1;
        expect(game.wind.upcoming).toBe(0);
      }
    }

    expect(telegraphs).toBeGreaterThan(0);
    expect(quiet).toBeGreaterThan(telegraphs);
  });

  it('turns the wind round between rounds rather than blowing one seat about all match', () => {
    // Whichever way a match's first round starts, the next one starts the other way. A
    // wind that always blew the same way at the start of a round was measured at 41/59
    // between two identical hard bots; this is the line that fixed it.
    const game = started(31337, 'easy');
    const input = new ScriptedInput();
    const firstGust: number[] = [];
    let round = -1;
    for (let i = 0; i < TEN_MINUTES; i += 1) {
      game.update(STEP, input);
      // The round that decides the match opens no round after it, and the forecast it
      // leaves standing belongs to the round just finished — counting it here would read
      // the last gust twice and call the repeat a failure to turn round.
      if (game.getScore().winner !== null) break;
      if (game.roundsPlayed !== round && game.resetCountdown === 0) {
        round = game.roundsPlayed;
        firstGust.push(game.wind.strength);
      }
    }

    expect(firstGust.length).toBeGreaterThan(1);
    for (let i = 0; i + 1 < firstGust.length; i += 1) {
      expect((firstGust[i] ?? 0) * (firstGust[i + 1] ?? 0)).toBeLessThanOrEqual(0);
    }
  });
});

describe('the bot', () => {
  it('gets a bot seat moving under its own steering', () => {
    const game = started(2024, null, 'normal');
    // The same seed with nobody in either seat, which is what the weather alone does. A
    // bot seat has to be somewhere else, or the difficulty is not wired to anything.
    const weather = started(2024);
    const input = new ScriptedInput();
    // One live second: long enough for the bot to have committed to a direction, short
    // enough that it has not yet crossed the mat and laid a hand on the empty seat.
    for (let i = 0; i < RESET_STEPS + 60; i += 1) {
      game.update(STEP, input);
      weather.update(STEP, input);
    }

    expect(Math.abs(game.wrestler('p2').x - weather.wrestler('p2').x)).toBeGreaterThan(1);
    // Both matches are still in their opening round, so both are under the same gust: the
    // seat nobody is sitting in is exactly where that gust left it.
    expect(game.wrestler('p1').x).toBe(weather.wrestler('p1').x);
  });

  it('leaves an empty seat empty', () => {
    const game = started(2024);
    const input = new ScriptedInput();
    for (let i = 0; i < RESET_STEPS + 120; i += 1) game.update(STEP, input);

    const p1 = game.wrestler('p1');
    const p2 = game.wrestler('p2');
    // Two seats nobody is steering, under one gust that blows on both alike: they lean by
    // the same amount, carry the same speed, and are still exactly as far apart as they
    // stood up. The wind moves them — it is a wrestling mat, not a vacuum — but nothing
    // has steered either one.
    expect(p1.angle).toBe(p2.angle);
    expect(p1.vx).toBe(p2.vx);
    expect(p2.x - p1.x).toBe(START_X * 2);
    expect(p1.stance).toBe('grounded');
    expect(p2.stance).toBe('grounded');
  });

  it('finishes a match between two easy bots inside ten simulated minutes', () => {
    // The weakest pairing is the one that finds positions nothing resolves, which is why
    // the shell's own guard uses it too.
    for (const seed of [20260820, 1, 4711, 90210]) {
      const game = started(seed, 'easy');
      const steps = runToDecision(game, new ScriptedInput(), TEN_MINUTES);

      expect(steps, `seed ${String(seed)}`).toBeLessThan(TEN_MINUTES);
      expect(game.getScore().winner).not.toBeNull();
    }
  });

  it('plays a different match on easy and on hard from the same seed', () => {
    function trace(tier: BotDifficulty): string {
      const game = started(20260823, tier, tier);
      const input = new ScriptedInput();
      const seen: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        game.update(STEP, input);
        if (i % 15 === 0) seen.push(game.wrestler('p1').x.toFixed(4));
      }
      return seen.join('|');
    }

    expect(trace('hard')).not.toBe(trace('easy'));
  });

  it('wins more often the harder it is', () => {
    function wins(a: BotDifficulty, b: BotDifficulty, matches = 40): number {
      let won = 0;
      for (let i = 0; i < matches; i += 1) {
        const game = started(1000 + i * 37, a, b);
        runToDecision(game, new ScriptedInput(), TEN_MINUTES);
        if (game.getScore().winner === 'p1') won += 1;
      }
      return won / matches;
    }

    // Measured over forty seeded matches a pairing; the numbers are in SPEC.md.
    expect(wins('hard', 'easy')).toBeGreaterThan(0.65);
    expect(wins('normal', 'easy')).toBeGreaterThan(0.6);
    expect(wins('hard', 'normal')).toBeGreaterThan(0.55);
  });

  it('gives neither seat an edge when the two tiers are the same', () => {
    // The seat-fairness measurement at the level a player feels it. The physics is proved
    // mirror-exact in rules.test.ts; this is the check that the match around it — the
    // wind schedule, the round order, the order the two seats are read in — did not
    // reintroduce a bias the physics does not have.
    let p1 = 0;
    let decided = 0;
    for (let i = 0; i < 60; i += 1) {
      const game = started(500 + i * 101, 'normal');
      runToDecision(game, new ScriptedInput(), TEN_MINUTES);
      const winner = game.getScore().winner;
      if (winner === 'draw' || winner === null) continue;
      decided += 1;
      if (winner === 'p1') p1 += 1;
    }

    expect(decided).toBeGreaterThan(40);
    expect(p1 / decided).toBeGreaterThan(0.3);
    expect(p1 / decided).toBeLessThan(0.7);
  });

  it('replays identically from the same seed', () => {
    function run(): number[] {
      const game = started(777, 'hard', 'easy');
      const input = new ScriptedInput();
      for (let i = 0; i < 1800; i += 1) game.update(STEP, input);
      const p1 = game.wrestler('p1');
      const p2 = game.wrestler('p2');
      const score = game.getScore();
      return [
        p1.x,
        p1.y,
        p1.angle,
        p1.spin,
        p2.x,
        p2.y,
        p2.angle,
        p2.spin,
        game.wind.strength,
        score.p1,
        score.p2,
      ];
    }

    const first = run();
    expect(first).toEqual(run());
    for (const value of first) expect(Number.isFinite(value)).toBe(true);
  });
});

describe('the drawing', () => {
  it('clears before it draws anything else', () => {
    const game = started(13);
    expect(drawnOnce(game).calls[0]?.op).toBe('clear');
  });

  it('tells the seats apart by head shape, not by colour alone', () => {
    const game = started(13);
    const renderer = drawnOnce(game);
    const [x1, y1] = headScreen(game, 'p1');
    const [x2, y2] = headScreen(game, 'p2');

    // Seat one is a disc; seat two is a square. Both survive greyscale.
    const disc = renderer.ops('circle').some((call) => call.args[0] === x1 && call.args[1] === y1);
    const square = renderer
      .ops('rect')
      .some((call) => call.args[0] === x2 - 26 && call.args[1] === y2 - 26);

    expect(disc).toBe(true);
    expect(square).toBe(true);
  });

  it('gives each wrestler a stripe count of its own, and a numeral on the mat', () => {
    const game = started(13);
    const renderer = drawnOnce(game);
    const labels = renderer.ops('text').map((call) => call.args[0]);

    expect(labels).toContain('1');
    expect(labels).toContain('2');
  });

  it('draws the mat line at exactly the height the fall predicate tests', () => {
    const game = started(13);
    const renderer = drawnOnce(game);
    const floor = renderer
      .ops('line')
      .find((call) => call.args[1] === MAT_Y && call.args[3] === MAT_Y);

    expect(floor).toBeDefined();
  });

  it('draws the wind that is blowing, and the one that has been announced', () => {
    const game = started(808, 'normal');
    const input = new ScriptedInput();
    let telegraphed = drawnOnce(game).calls.length;
    for (let i = 0; i < 60 * 30; i += 1) {
      game.update(STEP, input);
      if (game.wind.warning > 0) {
        telegraphed = drawnOnce(game).calls.length;
        break;
      }
    }
    const quiet = drawnOnce(started(808, 'normal')).calls.length;

    // The announced gust adds a second row of chevrons and a countdown, so a telegraphed
    // frame is strictly busier than a quiet one: the arrow and the bot's knowledge appear
    // together or not at all.
    expect(telegraphed).toBeGreaterThan(quiet);
  });

  it('interpolates between steps rather than snapping', () => {
    const game = started(21, 'hard');
    const input = new ScriptedInput();
    for (let i = 0; i < RESET_STEPS + 90; i += 1) game.update(STEP, input);

    const early = drawnOnce(game, 0).calls.map((call) => call.args.join(','));
    const late = drawnOnce(game, 0.9).calls.map((call) => call.args.join(','));

    expect(late).not.toEqual(early);
  });

  it('renders without touching simulation state', () => {
    const game = started(13, 'normal');
    const input = new ScriptedInput();
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);

    const p1 = game.wrestler('p1');
    const p2 = game.wrestler('p2');
    const before = [p1.x, p1.y, p1.angle, p1.spin, p2.x, p2.y, p2.angle, p2.spin];

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    game.render(renderer, 0.5);
    game.render(renderer, 0.999);

    expect(renderer.calls.length).toBeGreaterThan(0);
    expect([p1.x, p1.y, p1.angle, p1.spin, p2.x, p2.y, p2.angle, p2.spin]).toEqual(before);
  });

  it('never draws a number that is not finite', () => {
    const game = started(64, 'hard');
    const input = new ScriptedInput();
    for (let i = 0; i < 1200; i += 1) {
      game.update(STEP, input);
      if (i % 97 !== 0) continue;
      for (const call of drawnOnce(game, 0.5).calls) {
        for (const value of call.args) {
          if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  it('rules each steadiness bar to its own spacing, so neither needs a colour read', () => {
    // Rule 7 for the one number a round can be decided on. The bars sit at the two ends
    // of the same row, so a player glancing up has to know which is theirs without
    // matching a hue: p1's is ruled coarse and p2's fine, and that survives greyscale.
    const game = started(13);
    const renderer = drawnOnce(game);
    const ticks = renderer
      .ops('line')
      .filter((call) => call.args[0] === call.args[2] && call.args[1] === BAR_Y);
    const near = ticks.filter((call) => Number(call.args[0]) < ARENA_HALF).length;
    const far = ticks.length - near;

    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it('never rotates the mat, and leaves the rotation stack balanced', () => {
    // One shared board seen the same way up by both seats, so nothing here is ever turned
    // round — and whatever a future edit does push, it has to pop.
    const game = started(13);
    const renderer = drawnOnce(game);
    const pushes = renderer.ops('pushSeatRotation').length;
    const pops = renderer.ops('popSeatRotation').length;

    expect(pushes).toBe(0);
    expect(pops).toBe(pushes);
  });
});

describe('the lifecycle', () => {
  it('ignores updates after destroy', () => {
    const game = started(3);
    const input = new ScriptedInput();
    input.lean('p1', 1);
    openRound(game, input);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);

    const x = game.wrestler('p1').x;
    game.destroy();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);

    expect(game.wrestler('p1').x).toBe(x);
  });

  it('resumes a pause exactly where it stood', () => {
    const game = started(21);
    const input = new ScriptedInput();
    input.lean('p1', 1);
    openRound(game, input);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);

    const p1 = game.wrestler('p1');
    const before = [p1.x, p1.y, p1.angle, p1.spin];
    game.onPause();
    game.onResume();

    expect([p1.x, p1.y, p1.angle, p1.spin]).toEqual(before);
  });

  it('starts a fresh match on a second init', () => {
    const game = started(4711);
    const input = new ScriptedInput();
    input.lean('p1', 1);
    input.press('p1', true);
    runToDecision(game, input, TEN_MINUTES);
    expect(game.getScore().winner).not.toBeNull();

    game.init(makeContext(4711));
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
    expect(game.roundsPlayed).toBe(0);
    expect(game.wrestler('p1').x).toBe(-START_X);
  });

  it('survives being stepped with a zero delta', () => {
    const game = started(7);
    const input = new ScriptedInput();
    for (let i = 0; i < 10; i += 1) game.update(0, input);

    expect(game.getScore().winner).toBeNull();
    expect(game.wrestler('p1').x).toBe(-START_X);
  });
});
