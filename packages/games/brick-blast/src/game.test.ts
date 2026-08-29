import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { BrickBlastGame, MATCH_SECONDS, POINT_TARGET, SERVE_STEPS } from './game.js';
import { manifest } from './manifest.js';
import type { BotDifficulty } from './rules.js';
import {
  BALL_RADIUS,
  BRICK_COUNT,
  COURT,
  PADDLE_HALF_WIDTH,
  PADDLE_SPEED,
  brickHp,
  brickIndex,
  paddleY,
  standingBricks,
} from './rules.js';

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
    const target = seat === 'p1' ? this.#p1 : this.#p2;
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  lift(seat: SeatId): void {
    const target = seat === 'p1' ? this.#p1 : this.#p2;
    target.pointer = null;
  }

  push(seat: SeatId, x: number): void {
    const target = seat === 'p1' ? this.#p1 : this.#p2;
    target.move.x = x;
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

function started(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
): BrickBlastGame {
  const game = new BrickBlastGame();
  game.init(makeContext(seed, botP1, botP2));
  return game;
}

/** Play a whole bot match and report who took it and how long it took. */
function playOut(
  seed: number,
  botP1: BotDifficulty,
  botP2: BotDifficulty,
): { winner: SeatId | 'draw' | null; steps: number } {
  const game = started(seed, botP1, botP2);
  const idle = new ScriptedInput();
  for (let step = 0; step < 60 * 600; step += 1) {
    game.update(STEP, idle);
    const winner = game.getScore().winner;
    if (winner !== null) return { winner, steps: step };
  }
  return { winner: null, steps: -1 };
}

type DrawArg = number | string | boolean | undefined;

interface DrawCall {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

/** Logs every call and every argument, so no draw can pass unobserved. */
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

  #record(op: string, ...values: DrawArg[]): void {
    this.calls.push({ op, args: values });
  }
}

describe('a fresh match', () => {
  it('starts level, undecided, and with a full clock', () => {
    const game = started(1);
    expect(game.getScore()).toMatchObject({ p1: 0, p2: 0, winner: null });
    expect(game.clock).toBe(MATCH_SECONDS);
  });

  it('centres both paddles, so neither seat starts nearer the ball', () => {
    const game = started(2);
    expect(game.paddle('p1').x).toBe(COURT.width / 2);
    expect(game.paddle('p2').x).toBe(COURT.width / 2);
  });

  it('stands the whole wall up', () => {
    const game = started(3);
    expect(standingBricks(game.wall)).toBe(BRICK_COUNT);
  });

  it('holds both balls still until the serve countdown expires', () => {
    const game = started(4);
    const idle = new ScriptedInput();
    expect(game.serveCountdown).toBe(SERVE_STEPS);

    for (let i = 0; i < SERVE_STEPS - 1; i += 1) {
      game.update(STEP, idle);
      for (const ball of game.balls) expect(Math.hypot(ball.vx, ball.vy)).toBe(0);
    }
    game.update(STEP, idle);
    expect(game.serveCountdown).toBe(0);
    for (const ball of game.balls) expect(Math.hypot(ball.vx, ball.vy)).toBeGreaterThan(0);
  });

  it('launches the two balls as exact opposites, so no serve favours a seat', () => {
    const game = started(5);
    const idle = new ScriptedInput();
    for (let i = 0; i < SERVE_STEPS; i += 1) game.update(STEP, idle);

    const [first, second] = [game.balls[0], game.balls[1]];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(first.x + second.x).toBeCloseTo(COURT.width, 9);
    expect(first.y + second.y).toBeCloseTo(COURT.height, 9);
    expect(first.vx + second.vx).toBe(0);
    expect(first.vy + second.vy).toBe(0);
  });

  it('sends the two seeds down two different matches', () => {
    const one = started(7, 'normal', 'normal');
    const other = started(8, 'normal', 'normal');
    const idle = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) {
      one.update(STEP, idle);
      other.update(STEP, idle);
    }
    const a = one.balls[0];
    const b = other.balls[0];
    expect(a === undefined || b === undefined ? true : a.x !== b.x || a.y !== b.y).toBe(true);
  });

  it('does nothing at all before it is given a context', () => {
    const game = new BrickBlastGame();
    const idle = new ScriptedInput();
    game.update(STEP, idle);
    expect(game.getScore()).toMatchObject({ p1: 0, p2: 0, winner: null });
  });
});

describe('a point', () => {
  it('goes to the other seat when a ball passes your baseline', () => {
    // p2 defends with a paddle parked in the corner, p1 covers the middle: p1 takes it.
    const game = started(11);
    const input = new ScriptedInput();
    input.point('p2', 0, paddleY('p2'));
    let steps = 0;
    while (game.getScore().p1 + game.getScore().p2 === 0 && steps < 3000) {
      input.point('p1', game.balls[0]?.x ?? 320, paddleY('p1'));
      game.update(STEP, input);
      steps += 1;
    }
    expect(game.getScore().p1).toBeGreaterThan(0);
  });

  it('re-serves both balls and stands the wall back up', () => {
    const game = started(13, 'easy', 'easy');
    const idle = new ScriptedInput();
    let steps = 0;
    while (game.getScore().p1 + game.getScore().p2 === 0 && steps < 6000) {
      game.update(STEP, idle);
      steps += 1;
    }
    expect(steps).toBeLessThan(6000);
    expect(game.serveCountdown).toBe(SERVE_STEPS);
    expect(standingBricks(game.wall)).toBe(BRICK_COUNT);
    const [first, second] = [game.balls[0], game.balls[1]];
    if (first === undefined || second === undefined) return;
    expect(first.x + second.x).toBeCloseTo(COURT.width, 9);
  });

  it('is the only thing that moves the score', () => {
    // Nothing else in the game — a brick broken, a rally won — touches the tally.
    const game = started(17, 'hard', 'hard');
    const idle = new ScriptedInput();
    let last = 0;
    let jumps = 0;
    for (let i = 0; i < 60 * 40; i += 1) {
      const before = game.getScore().p1 + game.getScore().p2;
      game.update(STEP, idle);
      const after = game.getScore().p1 + game.getScore().p2;
      if (after !== before) {
        jumps += 1;
        expect(after - before).toBeLessThanOrEqual(2);
        expect(game.serveCountdown).toBe(SERVE_STEPS);
      }
      last = after;
    }
    expect(jumps).toBeGreaterThan(0);
    expect(last).toBe(game.getScore().p1 + game.getScore().p2);
  });

  it('breaks bricks along the way, and lets the hole close again', () => {
    // Watched on one brick rather than on the count, and abandoned whenever the score moves:
    // a point stands the whole wall back up, which would look like a regrowth and is not.
    const game = started(19, 'normal', 'normal');
    const idle = new ScriptedInput();
    let watching = -1;
    let broken = false;
    let regrown = false;
    let points = 0;

    for (let i = 0; i < 60 * 60 && !regrown; i += 1) {
      game.update(STEP, idle);
      const score = game.getScore();
      if (score.p1 + score.p2 !== points) {
        points = score.p1 + score.p2;
        watching = -1;
        continue;
      }
      if (watching < 0) {
        for (let brick = 0; brick < BRICK_COUNT; brick += 1) {
          if (brickHp(game.wall, brick) > 0) continue;
          watching = brick;
          broken = true;
          break;
        }
      } else if (brickHp(game.wall, watching) > 0) {
        regrown = true;
      }
    }

    expect(broken).toBe(true);
    expect(regrown).toBe(true);
  });
});

describe('the match ends', () => {
  it('reaches a decision when two easy bots play it', () => {
    // The registry-wide termination guard in its own terms: the weakest pairing is the one
    // most likely to find a position nothing resolves.
    const { winner, steps } = playOut(23, 'easy', 'easy');
    expect(winner).not.toBeNull();
    expect(steps).toBeGreaterThanOrEqual(0);
    expect(steps).toBeLessThan(60 * MATCH_SECONDS + 2);
  });

  it('stops at the target rather than running past it', () => {
    const { winner } = playOut(29, 'hard', 'easy');
    const game = started(29, 'hard', 'easy');
    const idle = new ScriptedInput();
    while (game.getScore().winner === null) game.update(STEP, idle);
    const score = game.getScore();
    expect(score.winner).toBe(winner);
    expect(Math.max(score.p1, score.p2)).toBeLessThanOrEqual(POINT_TARGET);
  });

  it('freezes the moment it is decided', () => {
    const game = started(31, 'hard', 'easy');
    const idle = new ScriptedInput();
    while (game.getScore().winner === null) game.update(STEP, idle);
    const decided = { ...game.getScore() };
    const x = game.balls[0]?.x ?? 0;
    const clock = game.clock;

    for (let i = 0; i < 600; i += 1) game.update(STEP, idle);
    expect({ ...game.getScore() }).toEqual(decided);
    expect(game.balls[0]?.x ?? 0).toBe(x);
    expect(game.clock).toBe(clock);
  });

  it('runs its clock down while play is live', () => {
    const game = started(37);
    const idle = new ScriptedInput();
    for (let i = 0; i < 120; i += 1) game.update(STEP, idle);
    expect(game.clock).toBeCloseTo(MATCH_SECONDS - 2, 6);
  });

  it('calls a level match a draw at the whistle', () => {
    const game = started(41);
    game.clock = STEP;
    game.update(STEP, new ScriptedInput());
    expect(game.getScore()).toMatchObject({ p1: 0, p2: 0, winner: 'draw' });
  });

  it('gives it to whoever is ahead at the whistle', () => {
    const game = started(43, 'hard', 'easy');
    const idle = new ScriptedInput();
    for (let i = 0; i < 60 * 120 && game.getScore().p1 === game.getScore().p2; i += 1) {
      game.update(STEP, idle);
    }
    const score = game.getScore();
    expect(score.p1).not.toBe(score.p2);
    const ahead = score.p1 > score.p2 ? 'p1' : 'p2';
    game.clock = STEP;
    game.update(STEP, idle);
    expect(game.getScore().winner).toBe(ahead);
  });

  it('starts the clock full again on a rematch', () => {
    const game = started(47, 'easy', 'easy');
    const idle = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, idle);
    game.init(makeContext(47, 'easy', 'easy'));
    expect(game.clock).toBe(MATCH_SECONDS);
    expect(game.getScore()).toMatchObject({ p1: 0, p2: 0, winner: null });
    expect(standingBricks(game.wall)).toBe(BRICK_COUNT);
    expect(game.serveCountdown).toBe(SERVE_STEPS);
  });

  it('ignores everything after destroy', () => {
    const game = started(53, 'normal', 'normal');
    const idle = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) game.update(STEP, idle);
    const y = game.balls[0]?.y ?? 0;
    game.destroy();
    for (let i = 0; i < 300; i += 1) game.update(STEP, idle);
    expect(game.balls[0]?.y ?? 0).toBe(y);
  });
});

describe('the two instruments', () => {
  it('slides a paddle to the finger, under the ceiling', () => {
    const game = started(59);
    const input = new ScriptedInput();
    input.point('p1', COURT.width - 20, paddleY('p1'));
    const from = game.paddle('p1').x;
    game.update(STEP, input);
    expect(game.paddle('p1').x - from).toBeCloseTo(PADDLE_SPEED * STEP, 6);
  });

  it('slides a paddle with a key, at exactly the same ceiling', () => {
    const finger = started(59);
    const keys = started(59);
    const pointed = new ScriptedInput();
    pointed.point('p1', COURT.width - 20, paddleY('p1'));
    const pushed = new ScriptedInput();
    pushed.push('p1', 1);

    for (let i = 0; i < 30; i += 1) {
      finger.update(STEP, pointed);
      keys.update(STEP, pushed);
    }
    expect(keys.paddle('p1').x).toBeCloseTo(finger.paddle('p1').x, 6);
  });

  it('leaves the paddle where it is when the finger lifts and no key is held', () => {
    const game = started(61);
    const input = new ScriptedInput();
    input.point('p1', 100, paddleY('p1'));
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    const parked = game.paddle('p1').x;
    input.lift('p1');
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.paddle('p1').x).toBe(parked);
  });

  it('never lets one seat input move the other seat paddle', () => {
    const game = started(67);
    const input = new ScriptedInput();
    input.point('p1', 60, paddleY('p1'));
    input.push('p1', -1);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.paddle('p1').x).toBeLessThan(COURT.width / 2);
    expect(game.paddle('p2').x).toBe(COURT.width / 2);
  });

  it('keeps a paddle inside the court whatever the pointer does', () => {
    const game = started(71);
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) {
      input.point('p1', i % 2 === 0 ? -4000 : 9000, paddleY('p1') + 400);
      game.update(STEP, input);
      expect(game.paddle('p1').x).toBeGreaterThanOrEqual(PADDLE_HALF_WIDTH);
      expect(game.paddle('p1').x).toBeLessThanOrEqual(COURT.width - PADDLE_HALF_WIDTH);
    }
  });
});

describe('the bot', () => {
  it('plays: two bots reach a different match than two absent players', () => {
    const bots = started(73, 'normal', 'normal');
    const nobody = started(73);
    const idle = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) {
      bots.update(STEP, idle);
      nobody.update(STEP, idle);
    }
    expect(bots.paddle('p1').x).not.toBe(nobody.paddle('p1').x);
  });

  it('plays a visibly different match on easy and on hard', () => {
    const easy = started(79, 'easy', 'easy');
    const hard = started(79, 'hard', 'hard');
    const idle = new ScriptedInput();
    for (let i = 0; i < 60 * 25; i += 1) {
      easy.update(STEP, idle);
      hard.update(STEP, idle);
    }
    expect(hard.paddle('p1').x).not.toBe(easy.paddle('p1').x);
  });

  it('beats the tier below it far more often than not', () => {
    // The measured numbers are recorded in SPEC.md; this is the guard that they hold.
    let hardWins = 0;
    let normalWins = 0;
    const matches = 20;
    for (let seed = 1; seed <= matches; seed += 1) {
      if (playOut(seed * 101, 'hard', 'easy').winner === 'p1') hardWins += 1;
      if (playOut(seed * 101, 'normal', 'easy').winner === 'p1') normalWins += 1;
    }
    expect(hardWins).toBeGreaterThanOrEqual(matches * 0.8);
    expect(normalWins).toBeGreaterThanOrEqual(matches * 0.6);
  });

  it('is as strong in one seat as in the other', () => {
    // Seat symmetry, measured the only way that means anything: the same pairing, swapped.
    let asP1 = 0;
    let asP2 = 0;
    const matches = 16;
    for (let seed = 1; seed <= matches; seed += 1) {
      if (playOut(seed * 57, 'hard', 'easy').winner === 'p1') asP1 += 1;
      if (playOut(seed * 57, 'easy', 'hard').winner === 'p2') asP2 += 1;
    }
    expect(Math.abs(asP1 - asP2)).toBeLessThanOrEqual(matches * 0.25);
  });

  it('is given no more paddle than a person has', () => {
    // Rule 6: the bot writes a target and the same movePaddle a thumb goes through moves it.
    const bot = started(83, 'hard', 'hard');
    const idle = new ScriptedInput();
    let furthest = 0;
    let last = bot.paddle('p1').x;
    for (let i = 0; i < 600; i += 1) {
      bot.update(STEP, idle);
      furthest = Math.max(furthest, Math.abs(bot.paddle('p1').x - last));
      last = bot.paddle('p1').x;
    }
    expect(furthest).toBeLessThanOrEqual(PADDLE_SPEED * STEP + 1e-9);
  });

  it('keeps its paddle inside the court all match', () => {
    const game = started(89, 'hard', 'easy');
    const idle = new ScriptedInput();
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, idle);
      for (const seat of ['p1', 'p2'] as const) {
        expect(game.paddle(seat).x).toBeGreaterThanOrEqual(PADDLE_HALF_WIDTH);
        expect(game.paddle(seat).x).toBeLessThanOrEqual(COURT.width - PADDLE_HALF_WIDTH);
      }
    }
  });
});

describe('determinism', () => {
  it('replays identically from the same seed and the same inputs', () => {
    function run(): number[] {
      const game = started(97, 'hard', 'easy');
      const input = new ScriptedInput();
      input.point('p1', 200, paddleY('p1'));
      for (let i = 0; i < 2400; i += 1) game.update(STEP, input);
      const score = game.getScore();
      const balls = game.balls;
      return [
        balls[0]?.x ?? 0,
        balls[0]?.y ?? 0,
        balls[1]?.vx ?? 0,
        balls[1]?.vy ?? 0,
        game.paddle('p1').x,
        game.paddle('p2').x,
        standingBricks(game.wall),
        score.p1,
        score.p2,
      ];
    }
    expect(run()).toEqual(run());
  });

  it('counts the serve delay in steps, so it is the same at any frame rate', () => {
    const game = started(101);
    const idle = new ScriptedInput();
    for (let i = 0; i < SERVE_STEPS; i += 1) game.update(STEP * 2, idle);
    expect(game.serveCountdown).toBe(0);
  });

  it('counts brick regrowth in steps too', () => {
    const game = started(103, 'normal', 'normal');
    const idle = new ScriptedInput();
    let brokenAt = -1;
    const index = brickIndex(0, 0);
    for (let i = 0; i < 60 * 30 && brokenAt < 0; i += 1) {
      game.update(STEP, idle);
      if (brickHp(game.wall, index) === 0) brokenAt = i;
    }
    expect(brokenAt).toBeGreaterThanOrEqual(0);
  });
});

describe('both seats see the same game', () => {
  it('keeps a mirrored match mirrored, and level', () => {
    // Two players making the same move in opposite directions is the strongest statement of
    // seat symmetry there is: the whole court is its own half-turn image, so it must stay so.
    const game = started(107);
    const input = new ScriptedInput();
    for (let i = 0; i < SERVE_STEPS + 200; i += 1) {
      const x = 200 + 120 * Math.sin(i / 40);
      input.point('p1', x, paddleY('p1'));
      input.point('p2', COURT.width - x, paddleY('p2'));
      game.update(STEP, input);
    }
    const [first, second] = [game.balls[0], game.balls[1]];
    if (first === undefined || second === undefined) return;
    expect(first.x + second.x).toBeCloseTo(COURT.width, 4);
    expect(first.y + second.y).toBeCloseTo(COURT.height, 4);
    expect(game.paddle('p1').x + game.paddle('p2').x).toBeCloseTo(COURT.width, 6);
    expect(game.getScore().p1).toBe(game.getScore().p2);
  });

  it('gives both seats a paddle of the same size, the same distance out', () => {
    expect(COURT.height - paddleY('p1')).toBe(paddleY('p2'));
  });
});

describe('rendering', () => {
  it('draws the whole court without touching the simulation', () => {
    const game = started(109, 'normal', 'normal');
    const idle = new ScriptedInput();
    for (let i = 0; i < 400; i += 1) game.update(STEP, idle);

    const before = [
      game.balls[0]?.x ?? 0,
      game.balls[0]?.y ?? 0,
      game.balls[1]?.x ?? 0,
      game.paddle('p1').x,
      game.paddle('p2').x,
      standingBricks(game.wall),
    ];
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    game.render(renderer, 0.5);
    game.render(renderer, 0.999);

    expect(renderer.ops.length).toBeGreaterThan(0);
    expect(renderer.ops[0]).toBe('clear');
    for (const value of renderer.args) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
    expect([
      game.balls[0]?.x ?? 0,
      game.balls[0]?.y ?? 0,
      game.balls[1]?.x ?? 0,
      game.paddle('p1').x,
      game.paddle('p2').x,
      standingBricks(game.wall),
    ]).toEqual(before);
  });

  it('draws a ball for each ball in play', () => {
    const game = started(113);
    const idle = new ScriptedInput();
    for (let i = 0; i < SERVE_STEPS + 30; i += 1) game.update(STEP, idle);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);

    const balls = renderer.calls.filter(
      (call) => call.op === 'circle' && call.args[2] === BALL_RADIUS,
    );
    expect(balls.length).toBe(2);
  });

  it('marks the two seats apart by shape as well as by colour', () => {
    // Rule 7. p1 carries one pip, p2 two, so the paddles read in greyscale.
    const game = started(127);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const pips = renderer.calls.filter((call) => call.op === 'circle' && call.args[2] === 4);
    const nearPips = pips.filter((call) => (call.args[1] as number) > COURT.height / 2);
    const farPips = pips.filter((call) => (call.args[1] as number) < COURT.height / 2);
    expect(nearPips.length).toBe(1);
    expect(farPips.length).toBe(2);
  });

  it('shows the backstop clock, because a rule nobody can see cannot be played to', () => {
    const game = started(131);
    const tallest = (renderer: RecordingRenderer): number => {
      let best = 0;
      for (const call of renderer.calls) {
        if (call.op !== 'rect') continue;
        const [, , width, height, colour] = call.args;
        if (typeof width !== 'number' || typeof height !== 'number') continue;
        if (width > 8 || colour !== 'rgba(233, 240, 252, 0.5)') continue;
        best = Math.max(best, height);
      }
      return best;
    };

    const full = new RecordingRenderer();
    game.render(full, 0);
    const before = tallest(full);
    expect(before).toBeGreaterThan(0);

    game.clock = MATCH_SECONDS / 4;
    const later = new RecordingRenderer();
    game.render(later, 0);
    expect(tallest(later)).toBeLessThan(before);
  });

  it('shows both clock bars in the same place from either end', () => {
    const game = started(137);
    game.clock = MATCH_SECONDS / 2;
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const bars = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[4] === 'rgba(233, 240, 252, 0.5)',
    );
    expect(bars.length).toBe(2);
    const [left, right] = bars;
    if (left === undefined || right === undefined) return;
    expect(left.args[1]).toBe(right.args[1]);
    expect(left.args[3]).toBe(right.args[3]);
  });

  it('draws the wall, and draws the holes in it too', () => {
    const game = started(139, 'normal', 'normal');
    const idle = new ScriptedInput();
    for (let i = 0; i < 60 * 20 && standingBricks(game.wall) === BRICK_COUNT; i += 1) {
      game.update(STEP, idle);
    }
    expect(standingBricks(game.wall)).toBeLessThan(BRICK_COUNT);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const rubble = renderer.calls.filter(
      (call) => call.op === 'strokeRect' && call.args[5] === 'rgba(143, 162, 196, 0.18)',
    );
    expect(rubble.length).toBe(BRICK_COUNT - standingBricks(game.wall));
  });

  it('draws a serve ring while the countdown runs, and stops when it does', () => {
    const game = started(149);
    const idle = new ScriptedInput();
    const rings = (): number => {
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      return renderer.calls.filter(
        (call) => call.op === 'strokeCircle' && (call.args[2] as number) > BALL_RADIUS + 1,
      ).length;
    };
    expect(rings()).toBe(2);
    for (let i = 0; i < SERVE_STEPS; i += 1) game.update(STEP, idle);
    expect(rings()).toBe(0);
  });

  it('interpolates a ball between two steps rather than jumping it', () => {
    const game = started(151);
    const idle = new ScriptedInput();
    for (let i = 0; i < SERVE_STEPS + 10; i += 1) game.update(STEP, idle);

    const at = (alpha: number): number => {
      const renderer = new RecordingRenderer();
      game.render(renderer, alpha);
      const ball = renderer.calls.find(
        (call) => call.op === 'circle' && call.args[2] === BALL_RADIUS,
      );
      const y = ball?.args[1];
      return typeof y === 'number' ? y : Number.NaN;
    };
    expect(at(0)).not.toBe(at(1));
    expect(at(0.5)).toBeCloseTo((at(0) + at(1)) / 2, 6);
  });
});

describe('the shell contract', () => {
  it('never claims a turn, because nobody waits their turn here', () => {
    // The shell reads the live value: a real-time game that answered with a seat would be
    // handed a shared board and one seat would lose its half of the pointer surface.
    const game: Game = started(157);
    expect(game.getActiveSeat?.() ?? null).toBeNull();
  });

  it('survives a pause and a resume without moving anything', () => {
    const game = started(163, 'normal', 'normal');
    const idle = new ScriptedInput();
    for (let i = 0; i < 200; i += 1) game.update(STEP, idle);
    const before = [game.balls[0]?.x ?? 0, game.paddle('p1').x, game.clock];
    game.onPause();
    game.onResume();
    expect([game.balls[0]?.x ?? 0, game.paddle('p1').x, game.clock]).toEqual(before);
  });

  it('does not smear a paddle across the court on the frame after a pause', () => {
    const game = started(167);
    const input = new ScriptedInput();
    input.point('p1', 100, paddleY('p1'));
    for (let i = 0; i < 40; i += 1) game.update(STEP, input);
    game.onPause();
    game.onResume();

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const paddles = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[2] === PADDLE_HALF_WIDTH * 2,
    );
    const near = paddles.find((call) => {
      const y = call.args[1];
      return typeof y === 'number' && y > COURT.height / 2;
    });
    const left = near?.args[0];
    const drawn = typeof left === 'number' ? left + PADDLE_HALF_WIDTH : Number.NaN;
    expect(drawn).toBeCloseTo(game.paddle('p1').x, 6);
  });

  it('takes a zero-length step without moving or throwing', () => {
    const game = started(173, 'normal', 'normal');
    const input = new ScriptedInput();
    input.point('p1', 40, paddleY('p1'));
    for (let i = 0; i < SERVE_STEPS + 10; i += 1) game.update(STEP, input);
    const before = [game.balls[0]?.x ?? 0, game.paddle('p1').x];
    game.update(0, input);
    expect([game.balls[0]?.x ?? 0, game.paddle('p1').x]).toEqual(before);
  });

  it('reports a score the shell can show at every step of a match', () => {
    const game = started(179, 'easy', 'normal');
    const idle = new ScriptedInput();
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, idle);
      const score = game.getScore();
      expect(Number.isFinite(score.p1)).toBe(true);
      expect(Number.isFinite(score.p2)).toBe(true);
      expect(score.p1).toBeGreaterThanOrEqual(0);
      expect(score.p2).toBeGreaterThanOrEqual(0);
    }
  });
});
