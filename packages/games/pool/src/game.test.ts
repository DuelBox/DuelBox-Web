import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { HOLD_FOR_FULL_POWER, PULL_DEADZONE, PULL_FOR_FULL_POWER, PoolGame } from './game.js';
import {
  BALLS_PER_SIDE,
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
    game.render(renderer);
    const circles = renderer.calls.filter((call) => call.op === 'circle').length;
    // Six pockets plus sixteen balls, and no ball is potted yet.
    expect(circles).toBeGreaterThanOrEqual(6 + 16);
  });

  it('stops drawing a ball once it is potted', () => {
    const game = new PoolGame();
    game.init(makeContext(79));
    const before = new RecordingRenderer();
    game.render(before);
    const circlesBefore = before.calls.filter((call) => call.op === 'circle').length;

    const first = game.position.balls.find((b) => b.kind === 'p1');
    if (first === undefined) throw new Error('no fixture');
    first.potted = true;
    const after = new RecordingRenderer();
    game.render(after);
    expect(after.calls.filter((call) => call.op === 'circle').length).toBeLessThan(circlesBefore);
  });

  it('tells the two sides apart with the colour removed', () => {
    // Rule 7: p1's balls carry a ring, p2's a stripe.
    const game = new PoolGame();
    game.init(makeContext(83));
    const renderer = new RecordingRenderer();
    game.render(renderer);
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
    game.render(soft);
    const softLine = soft.calls.find((call) => call.op === 'line' && call.args[4] === 7);

    input.point('p1', cue.x - PULL_FOR_FULL_POWER, cue.y);
    game.update(STEP, input);
    const hard = new RecordingRenderer();
    game.render(hard);
    const hardLine = hard.calls.find((call) => call.op === 'line' && call.args[4] === 7);

    const softX = typeof softLine?.args[0] === 'number' ? softLine.args[0] : 0;
    const hardX = typeof hardLine?.args[0] === 'number' ? hardLine.args[0] : 0;
    expect(hardX, 'the cue is drawn further back').toBeLessThan(softX);
  });

  it('hides the aim line while the table is rolling', () => {
    const game = new PoolGame();
    game.init(makeContext(97));
    const aiming = new RecordingRenderer();
    game.render(aiming);
    const linesAiming = aiming.calls.filter((call) => call.op === 'line').length;

    game.position.phase = 'rolling';
    const rolling = new RecordingRenderer();
    game.render(rolling);
    expect(rolling.calls.filter((call) => call.op === 'line').length).toBeLessThan(linesAiming);
  });

  it('turns the table to face whoever is shooting', () => {
    const game = new PoolGame();
    game.init(makeContext(101));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops).toContain('pushRotation');
  });

  it('draws nothing outside the logical box', () => {
    const game = new PoolGame();
    game.init(makeContext(103, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 3000; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    for (const call of renderer.calls) {
      if (call.op === 'text') continue;
      for (const value of call.args) {
        if (typeof value !== 'number') continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-360);
        expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(TABLE_WIDTH + 360);
      }
    }
  });

  it('does not mutate the position', () => {
    const game = new PoolGame();
    game.init(makeContext(107, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.position);
    game.render(new RecordingRenderer());
    game.render(new RecordingRenderer());
    expect(JSON.stringify(game.position)).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('pool');
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.logical.width).toBe(TABLE_WIDTH);
  });
});
