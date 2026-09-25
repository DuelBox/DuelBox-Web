import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { HOLD_FOR_FULL_POWER, PULL_DEADZONE, PULL_FOR_FULL_POWER, PoolGame } from './game.js';
import { roomAlong } from './layout.js';
import {
  BALLS_PER_SIDE,
  BALL_RADIUS,
  CUE_MAX_SPEED,
  CUSHION,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  cueBall,
  normaliseAngle,
  remaining,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

interface MutableSeatInput {
  move: Vec2;
  pointer: Vec2 | null;
  actionPressed: boolean;
  actionHeld: boolean;
  actionReleased: boolean;
  holdSeconds: number;
  holdSecondsAtRelease: number;
  pointerCancelled: boolean;
}

function blankSeat(): MutableSeatInput {
  return {
    move: vec2(),
    pointer: null,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
    holdSecondsAtRelease: 0,
    pointerCancelled: false,
  };
}

class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  lift(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionHeld = false;
    target.actionReleased = true;
  }

  hold(seat: SeatId, seconds: number): void {
    const target = this.#of(seat);
    target.actionHeld = true;
    target.actionReleased = false;
    target.holdSeconds = seconds;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionHeld = false;
    target.actionReleased = true;
  }

  quiet(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionReleased = false;
    target.actionHeld = false;
    target.pointerCancelled = false;
  }

  /**
   * The gesture taken away rather than let go, exactly as `InputManager` reports it: the
   * pointer is gone, the action is not held, and — the whole point of #2480 — there is no
   * release. The engine-driven test below asserts this hand-built record matches the real
   * one, because a scripted input that lies is how sea battle's long-press stayed dead.
   */
  cancel(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionHeld = false;
    target.actionPressed = false;
    target.actionReleased = false;
    target.holdSeconds = 0;
    target.holdSecondsAtRelease = 0;
    target.pointerCancelled = true;
  }

  steer(seat: SeatId, x: number): void {
    this.#of(seat).move.x = x;
  }

  #of(seat: SeatId): MutableSeatInput {
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
    openingSeat: 'p1',
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

class RecordingRenderer implements Renderer {
  readonly calls: DrawCall[] = [];

  get ops(): string[] {
    return this.calls.map((call) => call.op);
  }

  get args(): DrawArg[] {
    return this.calls.flatMap((call) => [...call.args]);
  }

  clear(colour: string): void {
    this.#record('clear', colour);
  }
  rect(x: number, y: number, w: number, h: number, colour: string): void {
    this.#record('rect', x, y, w, h, colour);
  }
  strokeRect(x: number, y: number, w: number, h: number, lw: number, colour: string): void {
    this.#record('strokeRect', x, y, w, h, lw, colour);
  }
  circle(x: number, y: number, r: number, colour: string): void {
    this.#record('circle', x, y, r, colour);
  }
  strokeCircle(x: number, y: number, r: number, lw: number, colour: string): void {
    this.#record('strokeCircle', x, y, r, lw, colour);
  }
  line(x1: number, y1: number, x2: number, y2: number, lw: number, colour: string): void {
    this.#record('line', x1, y1, x2, y2, lw, colour);
  }
  text(v: string, x: number, y: number, size: number, colour: string, align?: TextAlign): void {
    this.#record('text', v, x, y, size, colour, align);
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

  #record(op: string, ...values: DrawArg[]): void {
    this.calls.push({ op, args: values });
  }
}

/**
 * Every drawn primitive, as the rectangle it actually covers, against the logical box.
 *
 * The game-side half of #1965's "nothing outside the safe area at any size". It has to be
 * game-side, because `e2e/safe-area.spec.ts` and `e2e/touch-targets.spec.ts` walk the DOM —
 * `document.querySelectorAll('a, button, input, [role="button"]')` — and every control and
 * every word this game shows is drawn on a canvas, where a DOM walker finds nothing at all.
 * Neither spec visits `/play/pool/` either. So "passes the safe-area spec" says nothing
 * whatever about Pool's own picture, and this is the check that does.
 *
 * The box is what the shell has already put inside the safe area: `PlaySurface.module.css`
 * pads with `max(spacing, var(--db-safe-*))`, the host measures the canvas after that and
 * passes `NO_INSETS` to `fitViewport` on purpose (docs/responsive.md), so the logical box and
 * the safe region are the same rectangle by the time this game draws into it. Staying inside
 * the box *is* staying clear of the notch, the home indicator and the gesture bands.
 *
 * What it cannot check is the *width* of a line of text: `Renderer.measureText` needs a real
 * 2D context and this suite runs in node with no DOM. Text is checked for its vertical
 * extent, which is where the bug was, and for an anchor inside the box.
 *
 * Settled orientations only. Half-way through a seat flip a board rotating about its centre
 * sweeps its corners out by root two, which is exactly why `Canvas2DRenderer.beginFrame`
 * clips, and is the engine's business rather than this game's.
 */
function outsideTheBox(renderer: RecordingRenderer): string[] {
  const { width, height } = manifest.logical;
  const offenders: string[] = [];

  function check(op: string, minX: number, minY: number, maxX: number, maxY: number): void {
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      offenders.push(`${op} drew at a non-finite coordinate`);
      return;
    }
    if (minX < -1e-6 || minY < -1e-6 || maxX > width + 1e-6 || maxY > height + 1e-6) {
      offenders.push(
        `${op} covers ${minX.toFixed(1)},${minY.toFixed(1)} to ${maxX.toFixed(1)},${maxY.toFixed(1)}`,
      );
    }
  }

  for (const call of renderer.calls) {
    const n = (index: number): number => {
      const value = call.args[index];
      return typeof value === 'number' ? value : Number.NaN;
    };
    switch (call.op) {
      case 'rect':
        check(call.op, n(0), n(1), n(0) + n(2), n(1) + n(3));
        break;
      case 'strokeRect': {
        const half = n(4) / 2;
        check(call.op, n(0) - half, n(1) - half, n(0) + n(2) + half, n(1) + n(3) + half);
        break;
      }
      case 'circle':
        check(call.op, n(0) - n(2), n(1) - n(2), n(0) + n(2), n(1) + n(2));
        break;
      case 'strokeCircle': {
        const reach = n(2) + n(3) / 2;
        check(call.op, n(0) - reach, n(1) - reach, n(0) + reach, n(1) + reach);
        break;
      }
      case 'line': {
        // The stroke's width goes along the normal, not along the line, so the corners are
        // the ends displaced perpendicular by half the width. A bounding box that padded
        // both axes would condemn a cue lying flat against a cushion that is genuinely
        // inside it.
        const dx = n(2) - n(0);
        const dy = n(3) - n(1);
        const length = Math.hypot(dx, dy);
        const half = n(4) / 2;
        const nx = length === 0 ? 0 : (-dy / length) * half;
        const ny = length === 0 ? 0 : (dx / length) * half;
        const xs = [n(0) + nx, n(0) - nx, n(2) + nx, n(2) - nx];
        const ys = [n(1) + ny, n(1) - ny, n(3) + ny, n(3) - ny];
        check(call.op, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
        break;
      }
      case 'text': {
        // `Renderer.text` takes y as the centre of the line, which is the whole of the bug
        // this catches: a 24-unit line centred on the bottom edge lost half of itself.
        const half = n(3) / 2;
        check(`text "${String(call.args[0])}"`, n(1), n(2) - half, n(1), n(2) + half);
        break;
      }
      default:
        break;
    }
  }
  return offenders;
}

describe('aiming with a finger', () => {
  it('sets the angle from the pull, so the ball goes the way you are pointing', () => {
    // Pull back to the left of the ball and it leaves to the right.
    const game = new PoolGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    const cue = cueBall(game.position);
    input.point('p1', cue.x - 120, cue.y);
    game.update(STEP, input);
    expect(Math.abs(normaliseAngle(game.aimAngle)), 'straight up the table').toBeLessThan(0.01);
  });

  it('sets the power from how far back the pull went', () => {
    const game = new PoolGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    const cue = cueBall(game.position);
    input.point('p1', cue.x - PULL_FOR_FULL_POWER / 2, cue.y);
    game.update(STEP, input);
    expect(game.power).toBeCloseTo(0.5, 1);
  });

  it('clamps a very long pull to full power', () => {
    const game = new PoolGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    const cue = cueBall(game.position);
    input.point('p1', cue.x - PULL_FOR_FULL_POWER * 4, cue.y);
    game.update(STEP, input);
    expect(game.power).toBe(1);
  });

  it('ignores a pull too short to be a shot', () => {
    // Otherwise resting a thumb on the ball fires it.
    const game = new PoolGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    const cue = cueBall(game.position);
    input.point('p1', cue.x - PULL_DEADZONE / 2, cue.y);
    game.update(STEP, input);
    expect(game.power).toBe(0);
  });

  it('strikes when the finger lifts', () => {
    const game = new PoolGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    const cue = cueBall(game.position);
    input.point('p1', cue.x - 200, cue.y);
    game.update(STEP, input);
    input.lift('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('rolling');
    expect(cueBall(game.position).vx, 'and off it goes').toBeGreaterThan(0);
  });

  it('does not strike on a lift with no pull behind it', () => {
    const game = new PoolGame();
    game.init(makeContext(17));
    const input = new ScriptedInput();
    input.lift('p1');
    game.update(STEP, input);
    expect(game.position.phase, 'a stray tap is not a shot').toBe('aiming');
  });
});

describe('aiming with a keyboard', () => {
  it('turns the cue', () => {
    const game = new PoolGame();
    game.init(makeContext(19));
    const input = new ScriptedInput();
    const before = game.aimAngle;
    input.steer('p1', 1);
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.aimAngle).toBeGreaterThan(before);
  });

  it('builds power while the key is held', () => {
    const game = new PoolGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    input.hold('p1', HOLD_FOR_FULL_POWER / 2);
    game.update(STEP, input);
    expect(game.power).toBeCloseTo(0.5, 1);
  });

  it('strikes on release', () => {
    const game = new PoolGame();
    game.init(makeContext(29));
    const input = new ScriptedInput();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('rolling');
  });

  it('forgets a half-built shot when the match is paused', () => {
    const game = new PoolGame();
    game.init(makeContext(31));
    const input = new ScriptedInput();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    game.onPause();
    expect(game.power, 'nobody comes back to a cue half drawn').toBe(0);
  });
});

describe('a cancelled gesture', () => {
  it('abandons the draw rather than freezing it', () => {
    const game = new PoolGame();
    game.init(makeContext(37));
    const input = new ScriptedInput();
    const cue = cueBall(game.position);
    input.point('p1', cue.x - PULL_FOR_FULL_POWER * 0.6, cue.y);
    game.update(STEP, input);
    expect(game.power, 'the pull loaded the cue').toBeGreaterThan(0.5);

    input.cancel('p1');
    game.update(STEP, input);
    expect(game.power, 'a gesture the browser disowned leaves nothing behind').toBe(0);
  });

  it('does not fire the abandoned shot on the next, unrelated release', () => {
    const game = new PoolGame();
    game.init(makeContext(41));
    const input = new ScriptedInput();
    const cue = cueBall(game.position);
    input.point('p1', cue.x - PULL_FOR_FULL_POWER, cue.y);
    game.update(STEP, input);
    input.cancel('p1');
    game.update(STEP, input);

    // A fresh tap that builds no power at all. Before the fix the frozen power was still
    // standing, so this released a full-blooded shot the player never aimed.
    input.quiet('p1');
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(game.position.phase, 'nothing was struck').toBe('aiming');
  });

  it('keeps the aim: a cancel drops the charge and nothing else', () => {
    const game = new PoolGame();
    game.init(makeContext(43));
    const input = new ScriptedInput();
    const cue = cueBall(game.position);
    input.point('p1', cue.x - PULL_FOR_FULL_POWER * 0.6, cue.y + PULL_FOR_FULL_POWER * 0.6);
    game.update(STEP, input);
    const aimed = game.aimAngle;

    input.cancel('p1');
    game.update(STEP, input);
    expect(game.aimAngle, 'the reticle does not move because a phone call arrived').toBe(aimed);
  });

  it('abandons the draw when the engine itself reports the cancel', () => {
    // Driven through the real InputManager rather than a literal, so the record the game
    // reads is the one the browser produces and not one this file made up.
    const manager = new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' });
    const view = new InputView();
    const game = new PoolGame();
    game.init(makeContext(47));
    const cue = cueBall(game.position);

    manager.pointerDown(1, cue.x - PULL_FOR_FULL_POWER * 0.6, cue.y);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.power, 'the pull loaded the cue').toBeGreaterThan(0.5);

    manager.pointerCancel(1);
    const cancelled = view.sync(manager.beginStep(STEP));
    expect(cancelled.seat('p1').pointerCancelled, 'the engine says the gesture was taken').toBe(
      true,
    );
    expect(cancelled.seat('p1').actionReleased, 'a cancel is never a release').toBe(false);
    game.update(STEP, cancelled);
    expect(game.power).toBe(0);
    expect(game.position.phase).toBe('aiming');
  });
});

describe('a shot', () => {
  function shoot(game: PoolGame, input: ScriptedInput, angle: number, power: number): void {
    // Aim with the keyboard so the test does not depend on where the cue ball is.
    const cue = cueBall(game.position);
    cue.vx = Math.cos(angle) * 1500 * power;
    cue.vy = Math.sin(angle) * 1500 * power;
    game.position.phase = 'rolling';
    // Read through a function so the assignment above does not narrow the type: `update`
    // is what changes it, and TypeScript cannot see that.
    const stillRolling = (): boolean => game.position.phase === 'rolling';
    for (let i = 0; i < 60 * 40; i += 1) {
      game.update(STEP, input);
      if (!stillRolling()) break;
    }
  }

  it('runs the table and hands back to aiming', () => {
    const game = new PoolGame();
    game.init(makeContext(37));
    const input = new ScriptedInput();
    shoot(game, input, 0, 1);
    expect(game.position.phase, 'the table settled').toBe('aiming');
  });

  it('passes the turn when nothing of yours goes down', () => {
    const game = new PoolGame();
    game.init(makeContext(41));
    const input = new ScriptedInput();
    // Straight up the table into the cushion, hitting nothing.
    const cue = cueBall(game.position);
    cue.y = TABLE_HEIGHT - 60;
    shoot(game, input, Math.PI, 0.5);
    expect(game.position.seat).toBe('p2');
  });
});

describe('the match', () => {
  it('starts with nothing potted', () => {
    const game = new PoolGame();
    game.init(makeContext(43));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('counts balls potted, which goes up', () => {
    const game = new PoolGame();
    game.init(makeContext(47));
    const first = game.position.balls.find((b) => b.kind === 'p1');
    if (first === undefined) throw new Error('no fixture');
    first.potted = true;
    expect(game.getScore().p1).toBe(1);
    expect(remaining(game.position, 'p1')).toBe(BALLS_PER_SIDE - 1);
  });

  it('plays a whole bot frame to a winner', () => {
    const game = new PoolGame();
    game.init(makeContext(53, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 2000 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('stops changing once it is decided', () => {
    const game = new PoolGame();
    game.init(makeContext(59, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 2000 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = JSON.stringify(game.getScore());
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new PoolGame();
      game.init(makeContext(61, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 200; i += 1) {
        game.update(STEP, input);
        if (i % 120 === 0) out.push(cueBall(game.position).x.toFixed(4));
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init and clears on destroy', () => {
    const game = new PoolGame();
    game.init(makeContext(67, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400; i += 1) game.update(STEP, input);
    game.init(makeContext(67, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('never shoots for a human seat', () => {
    const game = new PoolGame();
    game.init(makeContext(71, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.phase, 'a silent human takes no shot').toBe('aiming');
    expect(game.position.seat).toBe('p1');
  });
});

describe('rendering', () => {
  it('draws the table, the pockets and every ball still up', () => {
    const game = new PoolGame();
    game.init(makeContext(73));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const circles = renderer.calls.filter((call) => call.op === 'circle').length;
    // Six pockets plus sixteen balls, and no ball is potted yet.
    expect(circles).toBeGreaterThanOrEqual(6 + 16);
  });

  it('stops drawing a ball once it is potted', () => {
    const game = new PoolGame();
    game.init(makeContext(79));
    const before = new RecordingRenderer();
    game.render(before, 0);
    const circlesBefore = before.calls.filter((call) => call.op === 'circle').length;

    const first = game.position.balls.find((b) => b.kind === 'p1');
    if (first === undefined) throw new Error('no fixture');
    first.potted = true;
    const after = new RecordingRenderer();
    game.render(after, 0);
    expect(after.calls.filter((call) => call.op === 'circle').length).toBeLessThan(circlesBefore);
  });

  it('tells the two sides apart with the colour removed', () => {
    // Rule 7: p1's balls carry a ring, p2's a stripe.
    const game = new PoolGame();
    game.init(makeContext(83));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const rings = renderer.calls.filter(
      (call) => call.op === 'strokeCircle' && call.args[4] === SEAT_PALETTE.p1.deep,
    ).length;
    const stripes = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[4] === SEAT_PALETTE.p2.deep,
    ).length;
    expect(rings, 'seven rings for seat one').toBeGreaterThanOrEqual(BALLS_PER_SIDE);
    expect(stripes, 'seven stripes for seat two').toBeGreaterThanOrEqual(BALLS_PER_SIDE);
  });

  it('shows the cue drawn further back for a harder shot', () => {
    // A player reads power from the cue's position rather than from a number.
    const game = new PoolGame();
    game.init(makeContext(89));
    const input = new ScriptedInput();
    const cue = cueBall(game.position);

    input.point('p1', cue.x - 40, cue.y);
    game.update(STEP, input);
    const soft = new RecordingRenderer();
    game.render(soft, 0);
    const softLine = soft.calls.find((call) => call.op === 'line' && call.args[4] === 7);

    input.point('p1', cue.x - PULL_FOR_FULL_POWER, cue.y);
    game.update(STEP, input);
    const hard = new RecordingRenderer();
    game.render(hard, 0);
    const hardLine = hard.calls.find((call) => call.op === 'line' && call.args[4] === 7);

    const softX = typeof softLine?.args[0] === 'number' ? softLine.args[0] : 0;
    const hardX = typeof hardLine?.args[0] === 'number' ? hardLine.args[0] : 0;
    expect(hardX, 'the cue is drawn further back').toBeLessThan(softX);
  });

  it('hides the aim line while the table is rolling', () => {
    const game = new PoolGame();
    game.init(makeContext(97));
    const aiming = new RecordingRenderer();
    game.render(aiming, 0);
    const linesAiming = aiming.calls.filter((call) => call.op === 'line').length;

    game.position.phase = 'rolling';
    const rolling = new RecordingRenderer();
    game.render(rolling, 0);
    expect(rolling.calls.filter((call) => call.op === 'line').length).toBeLessThan(linesAiming);
  });

  it('turns the table to face whoever is shooting', () => {
    const game = new PoolGame();
    game.init(makeContext(101));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops).toContain('pushRotation');
  });

  it('draws nothing outside the logical box', () => {
    const game = new PoolGame();
    game.init(makeContext(103, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 3000; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(outsideTheBox(renderer)).toEqual([]);
  });

  it('does not mutate the position', () => {
    const game = new PoolGame();
    game.init(makeContext(107, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.position);
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0);
    expect(JSON.stringify(game.position)).toBe(before);
  });
});

/**
 * #1965, at the level of the whole game rather than of one placement function.
 *
 * `layout.test.ts` holds the geometry; this holds what a player actually gets when the two
 * of them are wired together — a finger that has run out of screen, a cue ball flat against
 * a cushion, and a foul message that used to be half missing.
 */
describe('correct at every screen size', () => {
  /** The cue ball, moved somewhere legal, with the table left otherwise untouched. */
  function placeCue(game: PoolGame, x: number, y: number): void {
    const cue = cueBall(game.position);
    cue.x = x;
    cue.y = y;
    cue.vx = 0;
    cue.vy = 0;
  }

  /**
   * Aim along (dx, dy) as hard as the table allows, by pulling far past the edge of the box.
   *
   * Deliberately *past* it: that is what the host delivers. It captures the pointer on
   * pointer-down and converts with `viewportToLogical`, which clamps nothing, so a drag that
   * leaves the canvas keeps arriving with logical coordinates outside the play area.
   */
  function pullPast(game: PoolGame, input: ScriptedInput, dx: number, dy: number): void {
    const cue = cueBall(game.position);
    input.point('p1', cue.x - dx * 4000, cue.y - dy * 4000);
    game.update(STEP, input);
  }

  /**
   * Aim along (dx, dy) with the finger on the very last point of the canvas behind the ball.
   *
   * The distinction from {@link pullPast} is the whole point and it is easy to lose: a pull
   * of four thousand units saturates any power scale, so a test written that way passes just
   * as happily with the flat 260-unit draw that could not be reached at all. This one asks
   * the real question — what can a finger that has *stayed on the glass* achieve?
   */
  function pullToTheEdge(game: PoolGame, input: ScriptedInput, dx: number, dy: number): void {
    const cue = cueBall(game.position);
    const room = roomAlong(cue.x, cue.y, -dx, -dy, manifest.logical);
    input.point('p1', cue.x - dx * room, cue.y - dy * room);
    game.update(STEP, input);
  }

  it('shows the whole foul message rather than the top half of it', () => {
    const game = new PoolGame();
    game.init(makeContext(211));
    game.position.fouled = true;
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);

    const foul = renderer.calls.find(
      (call) => call.op === 'text' && call.args[0] === 'Foul — cue ball replaced',
    );
    expect(foul, 'the message is drawn at all').toBeDefined();
    expect(outsideTheBox(renderer), 'the message was clipped by the frame').toEqual([]);
  });

  it('keeps the whole picture inside the box with the cue ball on any cushion', () => {
    // Every rail and both corners, aimed all the way round, at the hardest shot the table
    // allows. This is where a fixed-length cue drawn back by a fixed amount went off the
    // board and the frame clip quietly removed it.
    const rail = CUSHION + 15;
    const places: readonly (readonly [number, number])[] = [
      [rail, TABLE_HEIGHT / 2],
      [TABLE_WIDTH - rail, TABLE_HEIGHT / 2],
      [TABLE_WIDTH / 2, rail],
      [TABLE_WIDTH / 2, TABLE_HEIGHT - rail],
      [rail, rail],
      [TABLE_WIDTH - rail, TABLE_HEIGHT - rail],
    ];
    const offenders: string[] = [];
    for (const [x, y] of places) {
      for (let i = 0; i < 16; i += 1) {
        const angle = (i / 16) * Math.PI * 2;
        const game = new PoolGame();
        game.init(makeContext(223));
        placeCue(game, x, y);
        const input = new ScriptedInput();
        pullPast(game, input, Math.cos(angle), Math.sin(angle));
        const renderer = new RecordingRenderer();
        game.render(renderer, 0);
        for (const complaint of outsideTheBox(renderer)) {
          offenders.push(`${String(x)},${String(y)} at ${angle.toFixed(2)}: ${complaint}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads a pull the same whether or not there is screen beside the board', () => {
    // The fairness half of #1965. On a 4K desktop the letterbox bars either side of a
    // 1.5625 box are enormous and a drag into them used to keep building power; on a phone
    // where the canvas meets the glass the same shot was unavailable. Both now stop at the
    // edge of the play area, so both get the same shot.
    // The cue ball on the left rail, which is where the two used to differ: 49 units of
    // canvas behind it and a draw that asked for 260.
    const atTheEdge = new PoolGame();
    atTheEdge.init(makeContext(227));
    placeCue(atTheEdge, CUSHION + BALL_RADIUS, 300);
    const edgeInput = new ScriptedInput();
    edgeInput.point('p1', 0, 300);
    atTheEdge.update(STEP, edgeInput);

    const wayPast = new PoolGame();
    wayPast.init(makeContext(227));
    placeCue(wayPast, CUSHION + BALL_RADIUS, 300);
    const pastInput = new ScriptedInput();
    pastInput.point('p1', -2000, 300);
    wayPast.update(STEP, pastInput);

    expect(atTheEdge.power, 'the last point of the canvas is a full shot').toBe(1);
    expect(wayPast.power, 'and beyond it buys nothing').toBe(atTheEdge.power);
    expect(wayPast.aimAngle).toBe(atTheEdge.aimAngle);
  });

  it('lets a ball tight on the cushion be struck as hard as one in the middle', () => {
    // The playability half. A resting ball is at least 49 units from the edge of the box and
    // a flat 260-unit draw does not fit in 49, so playing firmly off a rail meant dragging
    // to a point that was not on the canvas — into the band where a phone reads a system
    // gesture and answers with `pointercancel`, which since #2480 correctly throws the shot
    // away. Full power now lives at the edge of the play area, wherever the ball is.
    const tight = new PoolGame();
    tight.init(makeContext(229));
    placeCue(tight, CUSHION + BALL_RADIUS, TABLE_HEIGHT / 2);
    const input = new ScriptedInput();
    // To the edge of the canvas and not one unit past it: the finger stays on the glass.
    pullToTheEdge(tight, input, 1, 0);
    expect(tight.power, 'a short draw off the rail is still a full shot').toBe(1);

    input.lift('p1');
    tight.update(STEP, input);
    expect(tight.position.phase).toBe('rolling');
    expect(Math.hypot(cueBall(tight.position).vx, cueBall(tight.position).vy)).toBeCloseTo(
      CUE_MAX_SPEED,
      6,
    );
  });

  it('still refuses a tap on a ball that is tight on the cushion', () => {
    // The deadzone is absolute and stays absolute: a short draw costs resolution, never the
    // rule that resting a thumb on the ball is not a shot.
    const game = new PoolGame();
    game.init(makeContext(233));
    placeCue(game, CUSHION + BALL_RADIUS, TABLE_HEIGHT / 2);
    const input = new ScriptedInput();
    const cue = cueBall(game.position);
    input.point('p1', cue.x - PULL_DEADZONE / 2, cue.y);
    game.update(STEP, input);
    expect(game.power).toBe(0);
    input.lift('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('aiming');
  });

  it('is unmoved by anything a resize can do to it', () => {
    // "Rotating or resizing mid-match preserves the simulation exactly", from this game's
    // side of the line. A resize reaches the renderer (`renderer.setViewport`) and nothing
    // else — `PoolGame` holds no viewport, no screen size and no pixel — so the strongest
    // statement available here is that the match is identical whether it is drawn or not,
    // and identical whichever renderer draws it. The end-to-end property is covered by
    // `apps/web/src/data/cross-viewport.test.ts`, which drives this game at five viewports
    // including a notched phone and requires bit-identical traces, and by `e2e/resize.spec.ts`.
    function trace(render: boolean): string {
      const game = new PoolGame();
      game.init(makeContext(239, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 2400; i += 1) {
        game.update(STEP, input);
        if (render) game.render(new RecordingRenderer(), 0);
        if (i % 60 === 0) out.push(JSON.stringify(game.position.balls));
      }
      return out.join('|');
    }
    expect(trace(true)).toBe(trace(false));
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('pool');
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.logical.width).toBe(TABLE_WIDTH);
  });
});
