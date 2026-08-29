import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BowlingGame, DRAG_RANGE, HOLD_FOR_FULL_POWER, MAX_AIM, SCOREBOARD_Y } from './game.js';
import {
  FOUL_LINE_Y,
  FRAMES,
  LANE_WIDTH,
  PINS,
  laneIsStill,
  scoreOf,
  standingCount,
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

describe('aiming', () => {
  it('steers with a sideways drag', () => {
    const game = new BowlingGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    input.point('p1', LANE_WIDTH / 2, FOUL_LINE_Y);
    game.update(STEP, input);
    input.point('p1', LANE_WIDTH / 2 + DRAG_RANGE, FOUL_LINE_Y);
    game.update(STEP, input);
    expect(game.aimAngle).toBeCloseTo(MAX_AIM, 2);
  });

  it('clamps the aim so the ball is always sent up the lane', () => {
    const game = new BowlingGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    input.point('p1', LANE_WIDTH / 2, FOUL_LINE_Y);
    game.update(STEP, input);
    input.point('p1', LANE_WIDTH / 2 + DRAG_RANGE * 8, FOUL_LINE_Y);
    game.update(STEP, input);
    expect(game.aimAngle).toBeLessThanOrEqual(MAX_AIM);
  });

  it('builds power while the action key is held', () => {
    const game = new BowlingGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    input.hold('p1', HOLD_FOR_FULL_POWER / 2);
    game.update(STEP, input);
    expect(game.power).toBeCloseTo(0.5, 1);
  });

  it('bowls on release', () => {
    const game = new BowlingGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('rolling');
  });

  it('does not bowl on a release with no power behind it', () => {
    const game = new BowlingGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    input.release('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('aiming');
  });

  it('forgets a half-built run-up when the match is paused', () => {
    const game = new BowlingGame();
    game.init(makeContext(17));
    const input = new ScriptedInput();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    game.onPause();
    expect(game.power).toBe(0);
  });

  it('steers with the keyboard too', () => {
    const game = new BowlingGame();
    game.init(makeContext(19));
    const input = new ScriptedInput();
    input.steer('p1', 1);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.aimAngle).toBeGreaterThan(0);
  });
});

describe('a ball', () => {
  it('holds the pins up for a beat before counting them', () => {
    // Watching what you knocked down is most of the point of bowling, so the rack is left
    // standing for a moment before it is counted and swept.
    //
    // Checked on the frame the lane first goes still. An earlier version ran the loop
    // until the phase left `rolling` — which is *after* the pause has already elapsed, so
    // it asserted nothing.
    const game = new BowlingGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);

    let sawTheStillFrame = false;
    for (let i = 0; i < 60 * 30 && game.position.phase === 'rolling'; i += 1) {
      game.update(STEP, input);
      if (!sawTheStillFrame && laneIsStill(game.position)) {
        sawTheStillFrame = true;
        expect(game.position.rollsP1.length, 'not counted the instant it settles').toBe(0);
        // A third of a second later it must *still* be uncounted, or the pause is a
        // formality: asserting only on the settling frame cannot tell one frame of delay
        // from the intended forty-eight.
        for (let held = 0; held < 20; held += 1) game.update(STEP, input);
        expect(game.position.rollsP1.length, 'the rack is left up to be looked at').toBe(0);
      }
    }
    expect(sawTheStillFrame, 'the lane did settle').toBe(true);
    expect(game.position.rollsP1.length, 'and then it is counted').toBe(1);
  });
});

describe('the match', () => {
  it('starts at nothing each', () => {
    const game = new BowlingGame();
    game.init(makeContext(29));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('reports the scored total, bonuses and all', () => {
    const game = new BowlingGame();
    game.init(makeContext(31));
    game.position.rollsP1.push(10, 4, 3);
    expect(game.getScore().p1).toBe(scoreOf([10, 4, 3]));
  });

  it('plays a whole bot match to a winner', () => {
    const game = new BowlingGame();
    game.init(makeContext(37, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 900 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
    expect(game.position.frameP1).toBe(FRAMES);
  });

  it('stops changing once it is decided', () => {
    const game = new BowlingGame();
    game.init(makeContext(41, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 900 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = JSON.stringify(game.getScore());
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new BowlingGame();
      game.init(makeContext(43, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 200; i += 1) {
        game.update(STEP, input);
        if (i % 120 === 0) out.push(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init and clears on destroy', () => {
    const game = new BowlingGame();
    game.init(makeContext(47, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400; i += 1) game.update(STEP, input);
    game.init(makeContext(47, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('never bowls for a human seat', () => {
    const game = new BowlingGame();
    game.init(makeContext(53, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.phase, 'a silent human bowls nothing').toBe('aiming');
    expect(game.position.seat).toBe('p1');
  });
});

describe('rendering', () => {
  it('draws every pin still on the deck', () => {
    const game = new BowlingGame();
    game.init(makeContext(59));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const discs = renderer.calls.filter((call) => call.op === 'circle').length;
    expect(discs, 'ten pins and a ball').toBeGreaterThanOrEqual(PINS + 1);
  });

  it('tells a standing pin from a fallen one without the colour', () => {
    // Rule 7: standing is a filled disc, fallen is a faint outline.
    const game = new BowlingGame();
    game.init(makeContext(61));
    const standing = new RecordingRenderer();
    game.render(standing, 0);
    const filledBefore = standing.calls.filter((call) => call.op === 'circle').length;

    const pin = game.position.pins[0];
    if (pin === undefined) throw new Error('no fixture');
    pin.down = true;
    const fallen = new RecordingRenderer();
    game.render(fallen, 0);
    expect(fallen.calls.filter((call) => call.op === 'circle').length).toBeLessThan(filledBefore);
  });

  it('marks the two seats apart on the ball', () => {
    const game = new BowlingGame();
    game.init(makeContext(67));
    const p1 = new RecordingRenderer();
    game.render(p1, 0);
    expect(p1.args).toContain(SEAT_PALETTE.p1.base);

    game.position.seat = 'p2';
    const p2 = new RecordingRenderer();
    game.render(p2, 0);
    expect(p2.args).toContain(SEAT_PALETTE.p2.base);
  });

  it('shows a frame by frame scoreboard, not just a total', () => {
    // A frame's value is not known when it is bowled, so a player has to see which frames
    // are still open.
    const game = new BowlingGame();
    game.init(makeContext(71));
    game.position.rollsP1.push(10, 3, 4);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.args, 'a strike reads as an X').toContain('X');
    expect(renderer.args, 'and an unbowled frame as a dash').toContain('–');
  });

  it('shows a spare as a slash', () => {
    const game = new BowlingGame();
    game.init(makeContext(73));
    game.position.rollsP1.push(7, 3);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.args).toContain('7 /');
  });

  it('hides the aim line while the ball is rolling', () => {
    const game = new BowlingGame();
    game.init(makeContext(79));
    const aiming = new RecordingRenderer();
    game.render(aiming, 0);
    const before = aiming.calls.filter((call) => call.op === 'line').length;
    game.position.phase = 'rolling';
    const rolling = new RecordingRenderer();
    game.render(rolling, 0);
    expect(rolling.calls.filter((call) => call.op === 'line').length).toBeLessThan(before);
  });

  it('turns the lane to face whoever is bowling', () => {
    const game = new BowlingGame();
    game.init(makeContext(83));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops).toContain('pushRotation');
  });

  it('draws nothing outside the logical box', () => {
    const game = new BowlingGame();
    game.init(makeContext(89, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 3000; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (const call of renderer.calls) {
      if (call.op === 'text') continue;
      for (const value of call.args) {
        if (typeof value !== 'number') continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-260);
        expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(1060);
      }
    }
  });

  it('does not mutate the position', () => {
    const game = new BowlingGame();
    game.init(makeContext(97, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.position);
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0);
    expect(JSON.stringify(game.position)).toBe(before);
  });

  it('keeps the scoreboard inside the box', () => {
    expect(SCOREBOARD_Y).toBeLessThan(manifest.logical.height);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('bowling');
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.logical.width).toBe(LANE_WIDTH);
  });

  it('leaves standing pins to be counted', () => {
    const game = new BowlingGame();
    game.init(makeContext(101));
    expect(standingCount(game.position)).toBe(PINS);
  });
});
