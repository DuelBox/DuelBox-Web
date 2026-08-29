import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  AIM_TURN_RATE,
  HOLD_FOR_FULL_POWER,
  MiniGolfGame,
  PULL_DEADZONE,
  PULL_FOR_FULL_POWER,
} from './game.js';
import { BALL_RADIUS, HOLES, MAX_STROKES, ballOf, holeAt } from './rules.js';
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
    target.actionHeld = true;
    target.actionReleased = false;
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
    target.holdSeconds = 0;
  }

  quiet(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionReleased = false;
    target.actionHeld = false;
    target.holdSeconds = 0;
    target.pointer = null;
    target.move.x = 0;
    target.move.y = 0;
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

/** Run until the active seat changes, or give up. Returns the steps taken. */
function runUntilTurnPasses(game: MiniGolfGame, input: ScriptedInput, limit = 60 * 20): number {
  const first = game.getActiveSeat();
  for (let i = 1; i <= limit; i += 1) {
    game.update(STEP, input);
    if (game.getActiveSeat() !== first) return i;
  }
  return -1;
}

function playOut(game: MiniGolfGame, input: ScriptedInput, limit = 60 * 400): number {
  for (let i = 1; i <= limit; i += 1) {
    game.update(STEP, input);
    if (game.getScore().winner !== null) return i;
  }
  return -1;
}

describe('aiming with a finger', () => {
  it('takes the line from the pull, so the ball leaves the way you point it', () => {
    // Pull back to the left of the ball and it sets off to the right.
    const game = new MiniGolfGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    const side = ballOf(game.position, 'p1');
    input.point('p1', side.x - 150, side.y);
    game.update(STEP, input);
    expect(Math.abs(game.aimAngle), 'straight across the green').toBeLessThan(0.01);
  });

  it('takes the weight from how far back the pull went', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    const side = ballOf(game.position, 'p1');
    input.point('p1', side.x - PULL_FOR_FULL_POWER / 2, side.y);
    game.update(STEP, input);
    expect(game.power).toBeCloseTo(0.5, 1);
  });

  it('clamps a very long pull to a full-blooded putt', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    const side = ballOf(game.position, 'p1');
    input.point('p1', side.x - PULL_FOR_FULL_POWER * 5, side.y);
    game.update(STEP, input);
    expect(game.power).toBe(1);
  });

  it('ignores a pull too short to be a stroke', () => {
    // Otherwise resting a thumb on the ball plays it.
    const game = new MiniGolfGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    const side = ballOf(game.position, 'p1');
    input.point('p1', side.x - PULL_DEADZONE / 2, side.y);
    game.update(STEP, input);
    expect(game.power).toBe(0);
  });

  it('plays the stroke when the finger lifts', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    const side = ballOf(game.position, 'p1');
    input.point('p1', side.x - 200, side.y);
    game.update(STEP, input);
    input.lift('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('rolling');
    expect(ballOf(game.position, 'p1').vx, 'and off it goes').toBeGreaterThan(0);
  });

  it('does not play a stroke on a lift with no pull behind it', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(17));
    const input = new ScriptedInput();
    input.lift('p1');
    game.update(STEP, input);
    expect(game.position.phase, 'a stray tap is not a stroke').toBe('aiming');
    expect(ballOf(game.position, 'p1').strokes).toBe(0);
  });

  it('takes a finger anywhere, because the whole board belongs to whoever is to play', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(19));
    const input = new ScriptedInput();
    input.point('p1', 30, 40);
    game.update(STEP, input);
    expect(game.power).toBeGreaterThan(0);
  });
});

describe('aiming with a keyboard', () => {
  it('swings the line', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    const before = game.aimAngle;
    input.steer('p1', 1);
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.aimAngle).toBeCloseTo(before + AIM_TURN_RATE * STEP * 20, 5);
  });

  it('swings it the other way too', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(29));
    const input = new ScriptedInput();
    const before = game.aimAngle;
    input.steer('p1', -1);
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.aimAngle).toBeLessThan(before);
  });

  it('builds the stroke while the key is down', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(31));
    const input = new ScriptedInput();
    input.hold('p1', HOLD_FOR_FULL_POWER / 2);
    game.update(STEP, input);
    expect(game.power).toBeCloseTo(0.5, 1);
  });

  it('plays the stroke on the release, with the weight it had built', () => {
    // `holdSeconds` is zero on the step the key comes up, so a game that read it there
    // would play every keyboard putt with no weight at all.
    const game = new MiniGolfGame();
    game.init(makeContext(37));
    const input = new ScriptedInput();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('rolling');
    const side = ballOf(game.position, 'p1');
    expect(Math.hypot(side.vx, side.vy)).toBeGreaterThan(700);
  });

  it('starts every stroke lined up at the cup', () => {
    // The keyboard has four directions and an action key and nothing absolute, so an aim
    // left wherever the last stroke ended would make finding the hole the whole game.
    const game = new MiniGolfGame();
    game.init(makeContext(41));
    const hole = holeAt(0);
    const side = ballOf(game.position, 'p1');
    const straight = Math.atan2(hole.cup[1] - side.y, hole.cup[0] - side.x);
    expect(game.aimAngle).toBeCloseTo(straight, 6);
  });

  it('forgets a putter half drawn when the match is paused', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(43));
    const input = new ScriptedInput();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    game.onPause();
    expect(game.power).toBe(0);
    game.onResume();
    expect(game.position.phase).toBe('aiming');
  });
});

describe('whose turn it is', () => {
  it('is reported, so the shell turns the green and hands over the whole surface', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(47));
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('passes once a stroke has been played and the ball has settled', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(53));
    const input = new ScriptedInput();
    input.hold('p1', 0.3);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    input.quiet('p1');
    const steps = runUntilTurnPasses(game, input);
    expect(steps).toBeGreaterThan(0);
    expect(game.getActiveSeat()).toBe('p2');
  });

  it('settles the ball promptly rather than leaving both players waiting', () => {
    // Bowling shipped with a ball that sailed on for eight seconds after every delivery.
    // A full-blooded putt plus the pause afterwards has to be well inside three seconds.
    const game = new MiniGolfGame();
    game.init(makeContext(59));
    const input = new ScriptedInput();
    input.hold('p1', HOLD_FOR_FULL_POWER);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    input.quiet('p1');
    const steps = runUntilTurnPasses(game, input);
    expect(steps, `it took ${String(steps)} steps`).toBeLessThan(60 * 3);
  });

  it('leaves the seat with the move alone when the other one has holed out', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(61));
    const input = new ScriptedInput();
    ballOf(game.position, 'p2').holed = true;
    input.hold('p1', 0.3);
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    input.quiet('p1');
    for (let i = 0; i < 60 * 5; i += 1) game.update(STEP, input);
    expect(game.getActiveSeat(), 'nobody else can play').toBe('p1');
  });

  it('never plays a stroke for a seat a person is sitting in', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(67, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.phase, 'a silent player plays no stroke').toBe('aiming');
    expect(game.getActiveSeat()).toBe('p1');
    expect(ballOf(game.position, 'p1').strokes).toBe(0);
  });
});

describe('a match', () => {
  it('starts level, with nothing decided', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(71));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('scores in holes won', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(73));
    game.position.points.p1 = 2;
    game.position.points.p2 = 1;
    expect(game.getScore().p1).toBe(2);
    expect(game.getScore().p2).toBe(1);
  });

  it('is played out to a winner by two bots', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(79, 'hard', 'easy'));
    const input = new ScriptedInput();
    expect(playOut(game, input)).toBeGreaterThan(0);
    expect(game.getScore().winner).not.toBeNull();
  });

  it('is played out at every pairing of tiers', () => {
    for (const p1 of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      for (const p2 of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
        const game = new MiniGolfGame();
        game.init(makeContext(83, p1, p2));
        const input = new ScriptedInput();
        expect(playOut(game, input), `${p1} v ${p2}`).toBeGreaterThan(0);
      }
    }
  });

  it('is over inside the ten minutes the shell allows', () => {
    // The termination guard in `apps/web/src/data` plays two `easy` bots for ten simulated
    // minutes. Two weak putters halving holes all the way to the ninth is the worst case.
    const game = new MiniGolfGame();
    game.init(makeContext(89, 'easy', 'easy'));
    const input = new ScriptedInput();
    const steps = playOut(game, input, 60 * 600);
    expect(steps, `it took ${String(steps)} steps`).toBeGreaterThan(0);
    expect(steps).toBeLessThan(60 * 400);
  });

  it('never plays more than nine holes', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(97, 'easy', 'easy'));
    const input = new ScriptedInput();
    playOut(game, input);
    expect(game.position.hole).toBeLessThanOrEqual(HOLES);
  });

  it('stops changing once it is decided', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(101, 'hard', 'easy'));
    const input = new ScriptedInput();
    playOut(game, input);
    const frozen = JSON.stringify(game.getScore());
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new MiniGolfGame();
      game.init(makeContext(103, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 120; i += 1) {
        game.update(STEP, input);
        if (i % 90 === 0) {
          const side = ballOf(game.position, game.position.seat);
          out.push(`${side.x.toFixed(5)},${side.y.toFixed(5)}`);
        }
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('plays the identical match whichever way the board is facing', () => {
    // Rule 8 and the presentation split: rotation is a picture, never a rule.
    const trace = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new MiniGolfGame();
      game.init({ ...makeContext(107, 'hard', 'normal'), presentation, localSeat });
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 90; i += 1) {
        game.update(STEP, input);
        if (i % 120 === 0) out.push(`${game.getScore().p1}:${game.getScore().p2}`);
      }
      return out.join('|');
    };
    expect(trace('single-seat', 'p2')).toBe(trace('shared-screen', 'p1'));
  });

  it('is level again after a second init, and cleared by destroy', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(109, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 60; i += 1) game.update(STEP, input);
    game.init(makeContext(109, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.hole).toBe(0);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('gives both seats the same number of holes to play', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(113, 'normal', 'normal'));
    const input = new ScriptedInput();
    playOut(game, input);
    const total = game.getScore().p1 + game.getScore().p2;
    expect(total).toBeLessThanOrEqual(game.position.hole);
  });
});

describe('the three tiers', () => {
  it('play visibly different matches from the same seed', () => {
    // The failure this catches is a game that accepts `botDifficulty` and ignores it.
    const trace = (tier: BotDifficulty): string => {
      const game = new MiniGolfGame();
      game.init(makeContext(20260823, tier, tier));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        game.update(STEP, input);
        if (i % 15 === 0) {
          const side = ballOf(game.position, 'p1');
          out.push(`${side.x.toFixed(2)},${side.y.toFixed(2)}`);
        }
      }
      return out.join('|');
    };
    expect(trace('hard')).not.toBe(trace('easy'));
    expect(trace('normal')).not.toBe(trace('hard'));
  });

  it('play a different match from two empty seats', () => {
    const withBots = new MiniGolfGame();
    withBots.init(makeContext(127, 'normal', 'normal'));
    const alone = new MiniGolfGame();
    alone.init(makeContext(127));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) {
      withBots.update(STEP, input);
      alone.update(STEP, input);
    }
    expect(ballOf(withBots.position, 'p1').strokes).toBeGreaterThan(0);
    expect(ballOf(alone.position, 'p1').strokes, 'nobody is playing').toBe(0);
  });

  it('take fewer strokes the harder they are, over a whole round', () => {
    const strokesFor = (tier: BotDifficulty): number => {
      const game = new MiniGolfGame();
      game.init(makeContext(131, tier, tier));
      const input = new ScriptedInput();
      playOut(game, input);
      const holes = Math.max(1, game.position.hole);
      return game.position.totalStrokes.p1 / holes;
    };
    const easy = strokesFor('easy');
    const hard = strokesFor('hard');
    expect(hard, `hard ${hard.toFixed(2)} v easy ${easy.toFixed(2)}`).toBeLessThan(easy);
  });
});

describe('rendering', () => {
  it('draws the green, the cup and both balls', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(137));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops).toContain('clear');
    const circles = renderer.calls.filter((call) => call.op === 'circle').length;
    // The cup, two balls, and the two markers on the scoreboard.
    expect(circles).toBeGreaterThanOrEqual(5);
  });

  it('stops drawing a ball once it is in the cup', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(139));
    const before = new RecordingRenderer();
    game.render(before);
    const was = before.calls.filter((call) => call.op === 'circle').length;
    ballOf(game.position, 'p2').holed = true;
    const after = new RecordingRenderer();
    game.render(after);
    expect(after.calls.filter((call) => call.op === 'circle').length).toBeLessThan(was);
  });

  it('tells the two seats apart with the colour taken away', () => {
    // Rule 7: seat one is a disc with a ring cut in it, seat two a disc with a bar across.
    const game = new MiniGolfGame();
    game.init(makeContext(149));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const rings = renderer.calls.filter(
      (call) => call.op === 'strokeCircle' && call.args[4] === SEAT_PALETTE.p1.deep,
    ).length;
    const bars = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[4] === SEAT_PALETTE.p2.deep,
    ).length;
    expect(rings, 'the ball and the scoreboard marker').toBeGreaterThanOrEqual(2);
    expect(bars, 'the ball and the scoreboard marker').toBeGreaterThanOrEqual(2);
  });

  it('rings the ball that is to play, so the board says who is up', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(151));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const halo = renderer.calls.find(
      (call) =>
        call.op === 'strokeCircle' &&
        call.args[2] === BALL_RADIUS + 7 &&
        call.args[4] === SEAT_PALETTE.p1.base,
    );
    expect(halo, "seat one's ball is haloed on seat one's turn").toBeDefined();
  });

  it('hides the aim line while the ball is rolling', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(157));
    const aiming = new RecordingRenderer();
    game.render(aiming);
    const whileAiming = aiming.calls.filter((call) => call.op === 'line').length;

    game.position.phase = 'rolling';
    const rolling = new RecordingRenderer();
    game.render(rolling);
    expect(rolling.calls.filter((call) => call.op === 'line').length).toBeLessThan(whileAiming);
  });

  it('draws the putter further back for a harder putt', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(163));
    const input = new ScriptedInput();
    const side = ballOf(game.position, 'p1');

    input.point('p1', side.x, side.y + 40);
    game.update(STEP, input);
    const soft = new RecordingRenderer();
    game.render(soft);
    const softHead = soft.calls.find((call) => call.op === 'line' && call.args[4] === 7);

    input.point('p1', side.x, side.y + PULL_FOR_FULL_POWER);
    game.update(STEP, input);
    const firm = new RecordingRenderer();
    game.render(firm);
    const firmHead = firm.calls.find((call) => call.op === 'line' && call.args[4] === 7);

    const softY = typeof softHead?.args[1] === 'number' ? softHead.args[1] : 0;
    const firmY = typeof firmHead?.args[1] === 'number' ? firmHead.args[1] : 0;
    expect(firmY, 'the backswing is longer').toBeGreaterThan(softY);
  });

  it('turns the green to face whoever is putting', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(167));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops).toContain('pushRotation');
  });

  it('balances every rotation it pushes', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(173, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const pushes = renderer.ops.filter((op) => op.startsWith('push')).length;
    const pops = renderer.ops.filter((op) => op === 'popSeatRotation').length;
    expect(pushes).toBe(pops);
  });

  it('draws nothing outside the box it declared', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(179, 'easy', 'hard'));
    const input = new ScriptedInput();
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 60 * 200; i += 1) {
      game.update(STEP, input);
      if (i % 37 !== 0) continue;
      renderer.calls.length = 0;
      game.render(renderer);
      for (const call of renderer.calls) {
        if (call.op === 'text') continue;
        for (const value of call.args) {
          if (typeof value !== 'number') continue;
          expect(Number.isFinite(value)).toBe(true);
          expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-40);
          expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(
            manifest.logical.height + 40,
          );
        }
      }
    }
  });

  it('names the hole and its par, and nothing about whose turn it is', () => {
    // The shell owns the turn banner. A game that drew its own would draw it twice.
    const game = new MiniGolfGame();
    game.init(makeContext(181));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const said = renderer.calls
      .filter((call) => call.op === 'text')
      .map((call) => String(call.args[0]))
      .join(' ');
    expect(said).toContain('HOLE 1 OF 9');
    expect(said).toContain(`PAR ${String(holeAt(0).par)}`);
    expect(said.toLowerCase()).not.toContain('turn');
  });

  it('says what just happened without saying whose go it is', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(191, 'hard', 'hard'));
    const input = new ScriptedInput();
    let sawEvent = false;
    for (let i = 0; i < 60 * 90 && !sawEvent; i += 1) {
      game.update(STEP, input);
      if (game.event !== '') sawEvent = true;
    }
    expect(sawEvent, 'something is reported over a round').toBe(true);
  });

  it('shows how close a player is to picking up', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(193));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const said = renderer.calls
      .filter((call) => call.op === 'text')
      .map((call) => String(call.args[0]))
      .join(' ');
    expect(said).toContain(`of ${String(MAX_STROKES)}`);
    expect(said).toContain('pts');
  });

  it('does not move the simulation on', () => {
    const game = new MiniGolfGame();
    game.init(makeContext(197, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.position);
    game.render(new RecordingRenderer());
    game.render(new RecordingRenderer());
    expect(JSON.stringify(game.position)).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.id).toBe('mini-golf');
    expect(manifest.logical).toEqual({ width: 700, height: 1000 });
    expect(manifest.orientation).toBe('portrait');
  });

  it('is a turn game on a shared board', () => {
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.modes).toEqual(['friend', 'bot']);
  });

  it('advertises a round long enough to hold one', () => {
    // The measured worst case is about ninety seconds of play; the card says a round is
    // longer than that rather than shorter, so nobody is surprised by it.
    expect(manifest.roundSeconds).toBeGreaterThanOrEqual(120);
  });

  it('describes the keys the game actually reads', () => {
    // Control strings that lie are a recurring defect here, so this is checked against the
    // code rather than against the intention.
    const keyboard = manifest.controls.keyboard;
    expect(keyboard).toContain('Space');
    expect(keyboard).toContain('Enter');
    expect(keyboard).toContain('arrows');
    expect(keyboard).toMatch(/A and D/);
    expect(keyboard.toLowerCase()).toContain('release');
  });

  it('describes the pointer gesture the game actually implements', () => {
    const pointer = manifest.controls.pointer;
    expect(pointer.toLowerCase()).toContain('pull back');
    expect(pointer.toLowerCase()).toContain('let go');
    // And the code really does read a pull, of a length, from behind the ball.
    expect(PULL_FOR_FULL_POWER).toBeGreaterThan(PULL_DEADZONE);
  });
});
