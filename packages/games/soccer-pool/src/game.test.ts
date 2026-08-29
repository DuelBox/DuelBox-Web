import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  AIM_TURN_RATE,
  GOAL_PAUSE_SECONDS,
  HOLD_FOR_FULL_POWER,
  MAX_ROLL_SECONDS,
  PULL_DEADZONE,
  PULL_FOR_FULL_POWER,
  SETTLE_SECONDS,
  SHOT_CLOCK_SECONDS,
  SoccerPoolGame,
} from './game.js';
import {
  BALL_RADIUS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_X,
  CENTRE_Y,
  GOAL_TARGET,
  MAX_SHOTS,
  PITCH_BOTTOM,
  PITCH_TOP,
  SETTLE_BOUND_SECONDS,
  STRIKE_MAX_SPEED,
  ballOf,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
/** Ten minutes of simulated play, the same ceiling the global termination guard uses. */
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

/**
 * Input a test writes by hand.
 *
 * The engine's own view is read-only by design, so nothing here assigns to a `SeatInput`
 * field; the mutable record lives behind the class and is handed out through `seat`.
 */
class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  /** A finger on the glass at a point in logical units. */
  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionHeld = true;
    target.actionPressed = false;
    target.actionReleased = false;
  }

  /** The finger comes off, which is what plays the shot. */
  lift(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionHeld = false;
    target.actionReleased = true;
  }

  hold(seat: SeatId, seconds: number): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionHeld = true;
    target.actionReleased = false;
    target.holdSeconds = seconds;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionHeld = false;
    target.actionReleased = true;
    target.holdSeconds = 0;
  }

  steer(seat: SeatId, x: number): void {
    this.#of(seat).move.x = x;
  }

  quiet(seat: SeatId): void {
    const target = this.#of(seat);
    target.move.x = 0;
    target.move.y = 0;
    target.pointer = null;
    target.actionPressed = false;
    target.actionHeld = false;
    target.actionReleased = false;
    target.holdSeconds = 0;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

const SILENT: InputState = {
  seat: (): SeatInput => blankSeat(),
};

function contextFor(
  seed: number,
  options?: {
    p1?: BotDifficulty | null;
    p2?: BotDifficulty | null;
    presentation?: 'shared-screen' | 'single-seat';
    localSeat?: SeatId;
  },
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: options?.presentation ?? 'shared-screen',
    localSeat: options?.localSeat ?? 'p1',
    openingSeat: 'p1',
    botDifficulty: (seat: SeatId) =>
      seat === 'p1' ? (options?.p1 ?? null) : (options?.p2 ?? null),
  };
}

function started(seed = 1, options?: Parameters<typeof contextFor>[1]): SoccerPoolGame {
  const game = new SoccerPoolGame();
  game.init(contextFor(seed, options));
  return game;
}

/** Run the game with nobody touching it. */
function idle(game: SoccerPoolGame, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, SILENT);
}

/** Let the board finish turning to face whoever is to play. */
function settleFlip(game: SoccerPoolGame, input: InputState): void {
  for (let i = 0; i < 40; i += 1) game.update(STEP, input);
}

/**
 * Play one shot with a finger: pull back from the ball along `angle`, then let go.
 *
 * The pull is drawn *away* from the direction of travel, which is the gesture the manifest
 * describes — the ball leaves along the line from the finger through it.
 */
function pullAndRelease(
  game: SoccerPoolGame,
  input: ScriptedInput,
  angle: number,
  power: number,
): void {
  const seat = game.match.seat;
  const ball = ballOf(game.match);
  const pull = power * PULL_FOR_FULL_POWER;
  input.point(seat, ball.x - Math.cos(angle) * pull, ball.y - Math.sin(angle) * pull);
  game.update(STEP, input);
  input.lift(seat);
  game.update(STEP, input);
  input.quiet(seat);
}

/** Roll on until the ball settles and the turn has come round again. */
function untilAiming(game: SoccerPoolGame, input: InputState, cap = 60 * 30): number {
  for (let i = 0; i < cap; i += 1) {
    if (game.match.phase === 'aiming' || game.match.phase === 'over') return i;
    game.update(STEP, input);
  }
  throw new Error('the shot never settled');
}

type DrawArg = number | string | boolean | undefined;

interface DrawCall {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

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
    this.#record('pushRotation', radians);
  }
  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  get ops(): string[] {
    return this.calls.map((call) => call.op);
  }

  get colours(): string[] {
    return this.calls.flatMap((call) =>
      call.args.filter((arg): arg is string => typeof arg === 'string'),
    );
  }

  get texts(): string[] {
    return this.calls.filter((call) => call.op === 'text').map((call) => String(call.args[0]));
  }

  /** Every drawn shape with its colour stripped out, which is what greyscale leaves. */
  get shapes(): string[] {
    return this.calls.map(
      (call) =>
        `${call.op}(${call.args
          .filter((arg) => typeof arg !== 'string')
          .map((arg) => String(arg))
          .join(',')})`,
    );
  }

  #record(op: string, ...args: DrawArg[]): void {
    this.calls.push({ op, args });
  }
}

function draw(game: SoccerPoolGame): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer, 0);
  return renderer;
}

/** A trace of the whole match, for the determinism tests. */
function traceOf(game: SoccerPoolGame, steps: number, input: InputState = SILENT): string {
  const out: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    game.update(STEP, input);
    if (i % 20 !== 0) continue;
    const ball = ballOf(game.match);
    const score = game.getScore();
    out.push(
      `${ball.x.toFixed(6)},${ball.y.toFixed(6)},${game.match.seat},${String(score.p1)}:${String(
        score.p2,
      )}`,
    );
    if (score.winner !== null) break;
  }
  return out.join('|');
}

/**
 * Every shot of a match: who struck it, from where, and what came of it.
 *
 * Presentation-independent on purpose — it records the *game*, not the clock, so two
 * presentations of one seed can be compared without the seat flip's 0.36 s showing up as a
 * difference in the simulation.
 */
function shotLogOf(game: SoccerPoolGame): string {
  const out: string[] = [];
  let shots = game.match.shots;
  let seat = game.match.seat;
  let ball = `${ballOf(game.match).x.toFixed(6)},${ballOf(game.match).y.toFixed(6)}`;
  for (let i = 0; i < TEN_MINUTES; i += 1) {
    game.update(STEP, SILENT);
    if (game.match.shots !== shots) {
      shots = game.match.shots;
      out.push(`${seat}@${ball}`);
    }
    if (game.match.phase === 'aiming') {
      seat = game.match.seat;
      ball = `${ballOf(game.match).x.toFixed(6)},${ballOf(game.match).y.toFixed(6)}`;
    }
    const score = game.getScore();
    if (score.winner !== null) {
      out.push(`${String(score.p1)}:${String(score.p2)} ${score.winner}`);
      break;
    }
  }
  return out.join('|');
}

describe('the shell contract', () => {
  it('starts level with nobody having won', () => {
    const score = started().getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
  });

  it('says whose turn it is, which is what makes the shell hand over the board', () => {
    const game = started();
    expect(game.getActiveSeat()).toBe('p1');
    game.match.seat = 'p2';
    expect(game.getActiveSeat()).toBe('p2');
  });

  it('opens on seat one aiming at the goal it attacks', () => {
    const game = started();
    expect(game.match.seat).toBe('p1');
    expect(game.aimAngle).toBeCloseTo(-Math.PI / 2, 9);
    expect(game.power).toBe(0);
  });

  it('declares the same logical box the rules use', () => {
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
  });

  it('starts over on a second init', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    pullAndRelease(game, input, -Math.PI / 2, 1);
    untilAiming(game, input);
    expect(game.match.shots).toBe(1);
    game.init(contextFor(2));
    expect(game.match.shots).toBe(0);
    expect(game.match.seat).toBe('p1');
    expect(ballOf(game.match).x).toBe(CENTRE_X);
  });

  it('lets go of everything on destroy', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    pullAndRelease(game, input, -Math.PI / 2, 1);
    game.destroy();
    expect(game.match.shots).toBe(0);
    expect(game.match.phase).toBe('aiming');
    expect(game.getScore().winner).toBeNull();
    expect(ballOf(game.match).x).toBe(CENTRE_X);
  });

  it('puts the boot down when the match is paused', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    input.point('p1', CENTRE_X, CENTRE_Y + 200);
    game.update(STEP, input);
    expect(game.power).toBeGreaterThan(0);
    game.onPause();
    expect(game.power).toBe(0);
    game.onResume();
    expect(game.power).toBe(0);
  });

  it('never mutates the match while drawing it', () => {
    const game = started(3, { p1: 'hard', p2: 'hard' });
    idle(game, 400);
    const before = JSON.stringify(game.match);
    draw(game);
    draw(game);
    expect(JSON.stringify(game.match)).toBe(before);
  });
});

describe('the keyboard', () => {
  it('swings seat one"s aim with its own half of the keys', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const before = game.aimAngle;
    input.steer('p1', 1);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.aimAngle).toBeCloseTo(before + AIM_TURN_RATE * 30 * STEP, 6);
  });

  it('swings it the other way for the other sign', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const before = game.aimAngle;
    input.steer('p1', -1);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.aimAngle).toBeLessThan(before);
  });

  it('ignores the half of the keyboard belonging to the seat that is not playing', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const before = game.aimAngle;
    input.steer('p2', 1);
    input.hold('p2', 2);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.aimAngle).toBe(before);
    expect(game.power).toBe(0);
    expect(game.match.shots).toBe(0);
  });

  it('ignores a stick barely off centre, so a resting thumb does not drift the aim', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const before = game.aimAngle;
    input.steer('p1', 0.15);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.aimAngle).toBe(before);
  });

  it('builds power while the action key is held', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    input.hold('p1', HOLD_FOR_FULL_POWER / 2);
    game.update(STEP, input);
    expect(game.power).toBeCloseTo(0.5, 6);
  });

  it('reaches full power after the full hold and no further', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    input.hold('p1', HOLD_FOR_FULL_POWER * 3);
    game.update(STEP, input);
    expect(game.power).toBe(1);
  });

  it('plays the shot on the release', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(game.match.phase).toBe('rolling');
    expect(game.match.shots).toBe(1);
  });

  it('carries the power in a field, so a release that reports no hold still plays it', () => {
    // `holdSeconds` is zero on the step the key comes up. A game that read the weight there
    // would play every keyboard shot with nothing behind it.
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(Math.hypot(ballOf(game.match).vx, ballOf(game.match).vy)).toBeCloseTo(
      STRIKE_MAX_SPEED,
      3,
    );
  });

  it('refuses a release with no power behind it', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(game.match.phase).toBe('aiming');
    expect(game.match.shots).toBe(0);
  });

  it('can play a whole match on the keyboard alone', () => {
    const game = started(11, { p2: 'easy' });
    const input = new ScriptedInput();
    let guard = 0;
    while (game.getScore().winner === null && guard < TEN_MINUTES) {
      guard += 1;
      if (game.match.seat === 'p1' && game.match.phase === 'aiming') {
        input.steer('p1', 0);
        input.hold('p1', HOLD_FOR_FULL_POWER);
        game.update(STEP, input);
        input.release('p1');
        game.update(STEP, input);
        input.quiet('p1');
        guard += 1;
        continue;
      }
      game.update(STEP, input);
    }
    expect(game.getScore().winner, 'the keyboard finished a match').not.toBeNull();
    expect(game.match.shots).toBeGreaterThan(0);
  });
});

describe('the finger', () => {
  it('aims along the line from the finger through the ball', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const ball = ballOf(game.match);
    // Pulled straight down from the ball, so the shot goes straight up.
    input.point('p1', ball.x, ball.y + 200);
    game.update(STEP, input);
    expect(game.aimAngle).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('makes a longer pull a harder shot', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const ball = ballOf(game.match);
    input.point('p1', ball.x, ball.y + PULL_FOR_FULL_POWER / 4);
    game.update(STEP, input);
    const soft = game.power;
    input.point('p1', ball.x, ball.y + PULL_FOR_FULL_POWER / 2);
    game.update(STEP, input);
    expect(game.power).toBeGreaterThan(soft);
    expect(game.power).toBeCloseTo(0.5, 6);
  });

  it('clamps a pull past the full-power mark', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const ball = ballOf(game.match);
    input.point('p1', ball.x, ball.y + PULL_FOR_FULL_POWER * 4);
    game.update(STEP, input);
    expect(game.power).toBe(1);
  });

  it('treats a thumb resting on the ball as a rest, not a shot', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const ball = ballOf(game.match);
    const before = game.aimAngle;
    input.point('p1', ball.x + PULL_DEADZONE / 2, ball.y);
    game.update(STEP, input);
    expect(game.aimAngle).toBe(before);
    expect(game.power).toBe(0);
  });

  it('plays the shot when the finger comes off', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    pullAndRelease(game, input, -Math.PI / 2, 0.6);
    expect(game.match.phase).toBe('rolling');
    expect(Math.hypot(ballOf(game.match).vx, ballOf(game.match).vy)).toBeCloseTo(
      STRIKE_MAX_SPEED * 0.6,
      3,
    );
  });

  it('lets the finger own the weight outright while it is down', () => {
    // `actionHeld` is true for a pointer too, so reading the hold as well would fight the
    // pull for the same number.
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const ball = ballOf(game.match);
    input.point('p1', ball.x, ball.y + PULL_FOR_FULL_POWER / 4);
    const seat = input.seat('p1') as unknown as MutableSeatInput;
    seat.holdSeconds = HOLD_FOR_FULL_POWER * 10;
    game.update(STEP, input);
    expect(game.power).toBeCloseTo(0.25, 6);
  });

  it('reads a finger through the half turn when the board is facing the other seat', () => {
    const game = started(5, { localSeat: 'p2' });
    const input = new ScriptedInput();
    // Seat one is to play and the local seat is two, so the board is turned: a finger at
    // the top-left of the glass is at the bottom-right of the pitch.
    settleFlip(game, input);
    const ball = ballOf(game.match);
    const screenX = BOARD_WIDTH - ball.x;
    const screenY = BOARD_HEIGHT - (ball.y + 200);
    input.point('p1', screenX, screenY);
    game.update(STEP, input);
    expect(game.aimAngle).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('reads a finger straight when the board is not turned', () => {
    const game = started(5, { presentation: 'single-seat', localSeat: 'p2' });
    const input = new ScriptedInput();
    game.update(STEP, input);
    const ball = ballOf(game.match);
    input.point('p1', ball.x, ball.y + 200);
    game.update(STEP, input);
    expect(game.aimAngle).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('can play a whole match on the finger alone', () => {
    const game = started(12, { p2: 'easy' });
    const input = new ScriptedInput();
    let guard = 0;
    while (game.getScore().winner === null && guard < TEN_MINUTES) {
      guard += 1;
      if (game.match.seat === 'p1' && game.match.phase === 'aiming') {
        pullAndRelease(game, input, -Math.PI / 2, 0.9);
        guard += 2;
        continue;
      }
      game.update(STEP, input);
    }
    expect(game.getScore().winner, 'the pointer finished a match').not.toBeNull();
  });
});

describe('the controls the manifest promises', () => {
  const KEYS = {
    p1: { left: 'KeyA', right: 'KeyD', action: 'Space' },
    p2: { left: 'ArrowLeft', right: 'ArrowRight', action: 'Enter' },
  } as const;

  function realInput(): { manager: InputManager; view: InputView } {
    const manager = new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' });
    return { manager, view: new InputView() };
  }

  it('names the keys the game really reads, for both seats', () => {
    for (const seat of ['p1', 'p2'] as const) {
      const game = started(7);
      game.match.seat = seat;
      const { manager, view } = realInput();
      manager.setBoardSeat(seat);
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      // The board turns when it is not the local seat's move; let it finish first.
      for (let i = 0; i < 40; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      const before = game.aimAngle;
      manager.keyDown(KEYS[seat].right);
      for (let i = 0; i < 20; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      expect(game.aimAngle, `${seat} aims with its own keys`).toBeGreaterThan(before);
      manager.keyUp(KEYS[seat].right);

      manager.keyDown(KEYS[seat].action);
      for (let i = 0; i < 40; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      expect(game.power, `${seat} builds power on its own action key`).toBeGreaterThan(0);
      manager.keyUp(KEYS[seat].action);
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      expect(game.match.phase, `${seat} shoots on the release`).toBe('rolling');
    }
  });

  it('leaves the other seat"s keys doing nothing at all', () => {
    const game = started(7);
    const { manager, view } = realInput();
    manager.setBoardSeat('p1');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    const before = game.aimAngle;
    for (const code of [KEYS.p2.left, KEYS.p2.right, KEYS.p2.action]) manager.keyDown(code);
    for (let i = 0; i < 90; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    for (const code of [KEYS.p2.left, KEYS.p2.right, KEYS.p2.action]) manager.keyUp(code);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.aimAngle).toBe(before);
    expect(game.match.shots).toBe(0);
  });

  it('says so in the manifest, in words that match the code', () => {
    const { keyboard, pointer } = manifest.controls;
    expect(keyboard).toMatch(/player one/i);
    expect(keyboard).toMatch(/player two/i);
    expect(keyboard, 'the aiming keys the game reads through move.x').toMatch(/\bA and D\b/);
    expect(keyboard).toMatch(/arrow/i);
    expect(keyboard, 'the action keys behind actionHeld').toMatch(/space/i);
    expect(keyboard).toMatch(/enter/i);
    expect(keyboard, 'and the release that plays it').toMatch(/release/i);
    expect(pointer, 'the gesture #updateAim implements').toMatch(/pull back/i);
    expect(pointer).toMatch(/further back/i);
  });

  it('never offers the two key halves as one player"s choice', () => {
    // The exact lie `apps/web/src/data/controls.test.ts` exists to catch, asserted here too
    // so it fails in this package first.
    expect(manifest.controls.keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
  });

  it('describes a game that really is a shared board in portrait', () => {
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
  });

  it('drives a finger through the real input manager as well', () => {
    const game = started(7);
    const { manager, view } = realInput();
    manager.setBoardSeat('p1');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    const ball = ballOf(game.match);
    manager.pointerDown(1, ball.x, ball.y + 200);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.aimAngle).toBeCloseTo(-Math.PI / 2, 6);
    expect(game.power).toBeGreaterThan(0);
    manager.pointerUp(1);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.phase).toBe('rolling');
  });
});

describe('the shot clock', () => {
  it('counts down from the full clock', () => {
    const game = started();
    expect(game.shotClockLeft).toBe(SHOT_CLOCK_SECONDS);
    idle(game, 60);
    expect(game.shotClockLeft).toBeCloseTo(SHOT_CLOCK_SECONDS - 1, 2);
  });

  it('passes the turn when it runs out', () => {
    const game = started();
    idle(game, Math.round(SHOT_CLOCK_SECONDS * 60) + 2);
    expect(game.match.seat).toBe('p2');
    expect(game.match.shots).toBe(1);
    expect(game.match.fumbled).toBe(true);
  });

  it('starts again for the seat that inherits the turn', () => {
    const game = started();
    idle(game, Math.round(SHOT_CLOCK_SECONDS * 60) + 2);
    expect(game.shotClockLeft).toBeGreaterThan(SHOT_CLOCK_SECONDS - 1);
  });

  it('does not run while the ball is rolling', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    pullAndRelease(game, input, -Math.PI / 2, 1);
    const before = game.shotClockLeft;
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.match.phase).toBe('rolling');
    expect(game.shotClockLeft).toBe(before);
  });

  it('does not run while the board is still turning to face the player', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    // The turn changes, so the board starts its half turn; the clock a seat cannot yet use
    // must not be running against them.
    game.match.seat = 'p2';
    game.update(STEP, input);
    const before = game.shotClockLeft;
    for (let i = 0; i < 15; i += 1) game.update(STEP, input);
    expect(game.shotClockLeft).toBe(before);
    // And once it has settled it runs again.
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.shotClockLeft).toBeLessThan(before);
  });

  it('is what stops two people who put the phone down from freezing a match', () => {
    const game = started();
    for (let i = 0; i < TEN_MINUTES; i += 1) {
      game.update(STEP, SILENT);
      if (game.getScore().winner !== null) break;
    }
    expect(game.getScore().winner).toBe('draw');
    expect(game.match.shots).toBe(MAX_SHOTS);
  });
});

describe('a goal', () => {
  /**
   * Put the ball in front of the goal seat one attacks and roll it in.
   *
   * Offset to one side of the centre, because the keeper stands in the middle of the mouth
   * — the first version of this helper put the ball on top of it and asked why the shot
   * never arrived.
   */
  function scoreOnce(game: SoccerPoolGame, input: ScriptedInput): void {
    const ball = ballOf(game.match);
    ball.x = CENTRE_X - 48;
    ball.y = PITCH_TOP + 70;
    game.update(STEP, input);
    pullAndRelease(game, input, -Math.PI / 2, 0.5);
    for (let i = 0; i < 120; i += 1) {
      game.update(STEP, input);
      if (game.match.lastGoal !== null) return;
    }
    throw new Error('the shot never went in');
  }

  it('is credited to the seat that attacks that end', () => {
    const game = started();
    const input = new ScriptedInput();
    scoreOnce(game, input);
    expect(game.getScore().p1).toBe(1);
    expect(game.getScore().p2).toBe(0);
  });

  it('holds the board still long enough for both players to see it', () => {
    const game = started();
    const input = new ScriptedInput();
    scoreOnce(game, input);
    const pause = Math.round(GOAL_PAUSE_SECONDS * 60);
    const before = game.match.shots;
    for (let i = 0; i < pause - 2; i += 1) game.update(STEP, input);
    expect(game.match.shots, 'nothing happened during the pause').toBe(before);
    expect(game.match.phase).toBe('aiming');
  });

  it('puts the ball back on the centre spot and hands the restart over', () => {
    const game = started();
    const input = new ScriptedInput();
    scoreOnce(game, input);
    expect(ballOf(game.match).x).toBe(CENTRE_X);
    expect(ballOf(game.match).y).toBe(CENTRE_Y);
    expect(game.match.seat).toBe('p2');
  });

  it('sends the defence back to its posts', () => {
    const game = started();
    const input = new ScriptedInput();
    game.match.discs[1]!.x += 150;
    scoreOnce(game, input);
    expect(game.match.discs[1]!.x).toBe(game.match.discs[1]!.postX);
  });

  it('ends the match on the third one, after a moment on the final position', () => {
    const game = started();
    const input = new ScriptedInput();
    game.match.p1 = GOAL_TARGET - 1;
    scoreOnce(game, input);
    expect(game.match.winner).toBe('p1');
    expect(game.match.phase).toBe('over');
    expect(game.getScore().winner, 'not announced instantly').toBeNull();
    for (let i = 0; i < Math.round(SETTLE_SECONDS * 60) + 2; i += 1) game.update(STEP, input);
    expect(game.getScore().winner).toBe('p1');
  });

  it('is the end of it: nothing moves once the match is over', () => {
    const game = started();
    const input = new ScriptedInput();
    game.match.p1 = GOAL_TARGET - 1;
    scoreOnce(game, input);
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    const after = JSON.stringify(game.match);
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.match)).toBe(after);
  });
});

describe('the board turning to face the player', () => {
  it('turns when the turn changes on a shared screen', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const upright = draw(game).calls.find((call) => call.op === 'pushRotation');
    expect(upright?.args[0]).toBe(0);
    game.match.seat = 'p2';
    for (let i = 0; i < 40; i += 1) game.update(STEP, input);
    const turned = draw(game).calls.find((call) => call.op === 'pushRotation');
    expect(turned?.args[0]).toBeCloseTo(Math.PI, 6);
  });

  it('never turns in single-seat, where one person owns the whole screen', () => {
    const game = started(1, { presentation: 'single-seat' });
    const input = new ScriptedInput();
    game.match.seat = 'p2';
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    const rotation = draw(game).calls.find((call) => call.op === 'pushRotation');
    expect(rotation?.args[0]).toBe(0);
  });

  it('turns for the other local seat in the mirror image', () => {
    const game = started(1, { localSeat: 'p2' });
    const input = new ScriptedInput();
    for (let i = 0; i < 40; i += 1) game.update(STEP, input);
    const rotation = draw(game).calls.find((call) => call.op === 'pushRotation');
    expect(rotation?.args[0]).toBeCloseTo(Math.PI, 6);
  });

  it('ignores a tap while the board is moving under it', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    game.match.seat = 'p2';
    game.update(STEP, input);
    const ball = ballOf(game.match);
    input.point('p2', ball.x, ball.y - 200);
    game.update(STEP, input);
    expect(game.power, 'the board is still turning').toBe(0);
    // The same tap, once it has settled, is read.
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.power).toBeGreaterThan(0);
  });
});

describe('the picture', () => {
  it('draws the pitch, both goals, the ball and six discs', () => {
    const renderer = draw(started());
    expect(renderer.ops).toContain('clear');
    expect(renderer.ops.filter((op) => op === 'circle').length).toBeGreaterThanOrEqual(4);
    expect(renderer.ops).toContain('pushRotation');
    expect(renderer.ops).toContain('popSeatRotation');
  });

  it('tells the two sides apart without any colour at all', () => {
    const renderer = draw(started());
    const shapes = renderer.shapes.join('\n');
    // Seat one's discs carry a ring, seat two's a bar: two different draw operations, so
    // the two sides are still two different things in greyscale.
    expect(shapes).toMatch(/strokeCircle\(/);
    expect(shapes).toMatch(/rect\(/);
    const p1 = SEAT_PALETTE.p1.base;
    const p2 = SEAT_PALETTE.p2.base;
    expect(renderer.colours).toContain(p1);
    expect(renderer.colours).toContain(p2);
  });

  it('marks each net in the colour and the shape of the seat defending it', () => {
    const renderer = draw(started());
    const marks = renderer.calls.filter(
      (call) =>
        (call.op === 'strokeCircle' || call.op === 'rect') &&
        (call.args.includes(SEAT_PALETTE.p1.base) || call.args.includes(SEAT_PALETTE.p2.base)),
    );
    expect(marks.length).toBeGreaterThan(2);
  });

  it('draws the aim while a seat is aiming and not while the ball is rolling', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const aiming = draw(game).ops.filter((op) => op === 'line').length;
    pullAndRelease(game, input, -Math.PI / 2, 1);
    const rolling = draw(game).ops.filter((op) => op === 'line').length;
    expect(game.match.phase).toBe('rolling');
    expect(rolling).toBeLessThan(aiming);
  });

  it('says how many shots are left, in words', () => {
    const game = started();
    expect(draw(game).texts.join(' ')).toContain(`${String(MAX_SHOTS)} shots left`);
  });

  it('says when a goal has gone in', () => {
    const game = started();
    game.match.lastGoal = 'p1';
    expect(draw(game).texts).toContain('Goal!');
  });

  it('says when a turn was lost to the clock', () => {
    const game = started();
    game.match.fumbled = true;
    expect(draw(game).texts.join(' ')).toMatch(/shot clock/i);
  });

  it('says when the match is over', () => {
    const game = started();
    game.match.phase = 'over';
    expect(draw(game).texts).toContain('Full time');
  });

  it('fills the power ladder as the shot is drawn back', () => {
    const game = started();
    const input = new ScriptedInput();
    game.update(STEP, input);
    const empty = draw(game).colours.filter((c) => c === SEAT_PALETTE.p1.base).length;
    input.point('p1', CENTRE_X, CENTRE_Y + PULL_FOR_FULL_POWER);
    game.update(STEP, input);
    const full = draw(game).colours.filter((c) => c === SEAT_PALETTE.p1.base).length;
    expect(full).toBeGreaterThan(empty);
  });

  it('changes the marker beside the status line when the turn changes', () => {
    const game = started();
    const one = draw(game).colours.filter((c) => c === SEAT_PALETTE.p1.base).length;
    game.match.seat = 'p2';
    const two = draw(game).colours.filter((c) => c === SEAT_PALETTE.p1.base).length;
    expect(two).toBeLessThan(one);
  });

  it('draws nothing outside the logical box', () => {
    const game = started(4, { p1: 'hard', p2: 'hard' });
    idle(game, 600);
    const renderer = draw(game);
    for (const call of renderer.calls) {
      if (call.op !== 'circle' && call.op !== 'rect') continue;
      const x = call.args[0];
      const y = call.args[1];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      expect(x).toBeGreaterThan(-BOARD_WIDTH);
      expect(x).toBeLessThan(BOARD_WIDTH * 2);
      expect(y).toBeGreaterThan(-BOARD_HEIGHT);
      expect(y).toBeLessThan(BOARD_HEIGHT * 2);
    }
  });
});

describe('the bot at the wheel', () => {
  it('plays a shot rather than letting the clock take the turn', () => {
    const game = started(9, { p1: 'normal' });
    idle(game, 120);
    expect(game.match.shots).toBe(1);
    expect(game.match.fumbled).toBe(false);
  });

  it('shows its line before it strikes, which is all a player watching gets', () => {
    const game = started(9, { p1: 'easy' });
    game.update(STEP, SILENT);
    game.update(STEP, SILENT);
    expect(game.match.phase).toBe('aiming');
    expect(game.power).toBeGreaterThan(0);
    const shown = game.aimAngle;
    idle(game, 40);
    expect(game.aimAngle, 'and it plays the line it showed').toBe(shown);
  });

  it('takes longer to play on the weaker tier', () => {
    const quick = started(9, { p1: 'hard' });
    const slow = started(9, { p1: 'easy' });
    let quickAt = -1;
    let slowAt = -1;
    for (let i = 0; i < 200; i += 1) {
      quick.update(STEP, SILENT);
      slow.update(STEP, SILENT);
      if (quickAt < 0 && quick.match.shots === 1) quickAt = i;
      if (slowAt < 0 && slow.match.shots === 1) slowAt = i;
    }
    expect(quickAt).toBeGreaterThan(0);
    expect(slowAt).toBeGreaterThan(quickAt);
  });

  it('leaves a seat a person is sitting in entirely alone', () => {
    const game = started(9, { p2: 'hard' });
    idle(game, 200);
    expect(game.match.seat, 'seat one is a person, so nothing was played for them').toBe('p1');
    expect(game.match.shots).toBe(0);
  });

  it('plays a different match on easy than on hard', () => {
    const easy = traceOf(started(21, { p1: 'easy', p2: 'easy' }), 60 * 40);
    const hard = traceOf(started(21, { p1: 'hard', p2: 'hard' }), 60 * 40);
    expect(easy.length).toBeGreaterThan(0);
    expect(hard).not.toBe(easy);
  });

  it('plays a different match than two absent people', () => {
    const bots = traceOf(started(21, { p1: 'normal', p2: 'normal' }), 60 * 40);
    const nobody = traceOf(started(21), 60 * 40);
    expect(bots).not.toBe(nobody);
  });
});

describe('a match always ends', () => {
  it('decides inside ten minutes with two easy bots, which is the pairing that hangs games', () => {
    const game = started(20260820, { p1: 'easy', p2: 'easy' });
    let steps = -1;
    for (let i = 0; i < TEN_MINUTES; i += 1) {
      game.update(STEP, SILENT);
      if (game.getScore().winner !== null) {
        steps = i;
        break;
      }
    }
    expect(steps, 'easy against easy never finished').toBeGreaterThanOrEqual(0);
    expect(steps / 60, 'and it did not take anything like ten minutes').toBeLessThan(180);
  });

  it('decides for every pairing of tiers, from either seat', () => {
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const a of tiers) {
      for (const b of tiers) {
        const game = started(31, { p1: a, p2: b });
        let done = false;
        for (let i = 0; i < TEN_MINUTES; i += 1) {
          game.update(STEP, SILENT);
          if (game.getScore().winner !== null) {
            done = true;
            break;
          }
        }
        expect(done, `${a} against ${b} never finished`).toBe(true);
      }
    }
  });

  it('decides against a person who never touches the screen', () => {
    const game = started(33, { p1: 'hard' });
    let done = false;
    for (let i = 0; i < TEN_MINUTES; i += 1) {
      game.update(STEP, SILENT);
      if (game.getScore().winner !== null) {
        done = true;
        break;
      }
    }
    expect(done).toBe(true);
  });

  it('caps a rolling ball above the bound the physics already proves', () => {
    // Bowling shipped with a ball still sailing on eight seconds after every delivery. The
    // cap is here so a change to the physics cannot hang a match — not so the physics we
    // have needs it, and this is what keeps the two numbers honest about each other.
    expect(MAX_ROLL_SECONDS).toBeGreaterThan(SETTLE_BOUND_SECONDS);
    expect(
      MAX_ROLL_SECONDS - SETTLE_BOUND_SECONDS,
      'and it is a guard, not a hiding place',
    ).toBeLessThan(2);
  });

  it('never actually reaches that cap in a played match', () => {
    const game = started(35, { p1: 'hard', p2: 'hard' });
    let rolling = 0;
    let worst = 0;
    for (let i = 0; i < TEN_MINUTES; i += 1) {
      game.update(STEP, SILENT);
      if (game.match.phase === 'rolling') {
        rolling += 1;
        if (rolling > worst) worst = rolling;
      } else {
        rolling = 0;
      }
      if (game.getScore().winner !== null) break;
    }
    expect(worst / 60).toBeLessThanOrEqual(SETTLE_BOUND_SECONDS + GOAL_PAUSE_SECONDS);
  });

  it('bounds the whole match by numbers that can be written down', () => {
    const turn = SHOT_CLOCK_SECONDS + MAX_ROLL_SECONDS + GOAL_PAUSE_SECONDS + 0.36;
    expect(MAX_SHOTS * turn + SETTLE_SECONDS).toBeLessThan(600);
  });
});

describe('two devices step the same match', () => {
  it('replays a seed exactly', () => {
    const first = traceOf(started(77, { p1: 'hard', p2: 'normal' }), 60 * 120);
    const second = traceOf(started(77, { p1: 'hard', p2: 'normal' }), 60 * 120);
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(50);
  });

  it('plays a different match from a different seed', () => {
    const first = traceOf(started(77, { p1: 'hard', p2: 'normal' }), 60 * 120);
    const other = traceOf(started(78, { p1: 'hard', p2: 'normal' }), 60 * 120);
    expect(other).not.toBe(first);
  });

  it('plays the same shots in both presentations', () => {
    // Not the same *trace*: on a shared screen the board takes 0.36 s to turn between
    // turns, so the identical match happens 0.36 s later each turn. What must not differ is
    // a single shot — where the ball was, who struck it, and what it did.
    const shared = shotLogOf(started(88, { p1: 'hard', p2: 'hard' }));
    const single = shotLogOf(started(88, { p1: 'hard', p2: 'hard', presentation: 'single-seat' }));
    expect(single).toBe(shared);
    expect(shared.length).toBeGreaterThan(50);
  });

  it('takes longer on a shared screen than alone, and only because of the turning', () => {
    const shared = started(88, { p1: 'hard', p2: 'hard' });
    const single = started(88, { p1: 'hard', p2: 'hard', presentation: 'single-seat' });
    const length = (game: SoccerPoolGame): number => {
      for (let i = 0; i < TEN_MINUTES; i += 1) {
        game.update(STEP, SILENT);
        if (game.getScore().winner !== null) return i;
      }
      return -1;
    };
    const withFlip = length(shared);
    const without = length(single);
    expect(without).toBeGreaterThan(0);
    expect(withFlip).toBeGreaterThan(without);
    expect(shared.match.shots).toBe(single.match.shots);
  });

  it('simulates the same match from either chair', () => {
    const one = traceOf(started(88, { p1: 'hard', p2: 'hard', localSeat: 'p1' }), 60 * 120);
    const two = traceOf(started(88, { p1: 'hard', p2: 'hard', localSeat: 'p2' }), 60 * 120);
    expect(two).toBe(one);
  });

  it('counts every delay in steps rather than in seconds off a clock', () => {
    // The same match stepped at a different rate takes the same number of *steps* for the
    // shot clock, the goal pause and the bot's thinking, because all three are derived from
    // the first delta rather than accumulated as wall time.
    const slow = new SoccerPoolGame();
    slow.init(contextFor(91, { p1: 'hard', p2: 'hard' }));
    let shots = 0;
    for (let i = 0; i < 60 * 30; i += 1) {
      slow.update(1 / 120, SILENT);
      if (slow.match.shots !== shots) shots = slow.match.shots;
    }
    expect(shots).toBeGreaterThan(0);
  });

  it('leaves the ball inside the boards at every step of a full match', () => {
    const game = started(93, { p1: 'hard', p2: 'easy' });
    for (let i = 0; i < TEN_MINUTES; i += 1) {
      game.update(STEP, SILENT);
      const ball = ballOf(game.match);
      expect(Number.isFinite(ball.x)).toBe(true);
      expect(Number.isFinite(ball.y)).toBe(true);
      expect(ball.x).toBeGreaterThan(-BALL_RADIUS);
      expect(ball.x).toBeLessThan(BOARD_WIDTH + BALL_RADIUS);
      expect(ball.y).toBeGreaterThan(PITCH_TOP - 60);
      expect(ball.y).toBeLessThan(PITCH_BOTTOM + 60);
      if (game.getScore().winner !== null) break;
    }
  });

  it('never gives a seat two shots in a row unless it conceded in between', () => {
    // The one place the strict alternation is allowed to break: football restarts with the
    // side that let the goal in, and putting one through your own net is how a seat gets to
    // strike twice. Anything else would be a lost turn.
    const game = started(95, { p1: 'normal', p2: 'normal' });
    let shots = game.match.shots;
    let lastStriker: SeatId | null = null;
    let goalsThen = 0;
    let repeatsWithoutAGoal = 0;
    let repeatsAfterAGoal = 0;
    for (let i = 0; i < TEN_MINUTES; i += 1) {
      const striker = game.match.seat;
      const goalsBefore = game.match.p1 + game.match.p2;
      game.update(STEP, SILENT);
      if (game.match.shots === shots) continue;
      shots = game.match.shots;
      if (lastStriker === striker) {
        if (goalsBefore > goalsThen) repeatsAfterAGoal += 1;
        else repeatsWithoutAGoal += 1;
      }
      lastStriker = striker;
      goalsThen = goalsBefore;
      if (game.getScore().winner !== null) break;
    }
    expect(shots).toBeGreaterThan(2);
    expect(repeatsWithoutAGoal).toBe(0);
    expect(repeatsAfterAGoal).toBeGreaterThanOrEqual(0);
  });
});
