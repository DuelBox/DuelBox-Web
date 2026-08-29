import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BeachBallGame } from './game.js';
import {
  COURT_HEIGHT,
  COURT_WIDTH,
  MATCH_SECONDS,
  NET_Y,
  PLAYER_SPEED,
  TARGET_POINTS,
  halfOf,
  readyY,
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

  steer(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.move.x = x;
    target.move.y = y;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  lift(seat: SeatId): void {
    this.#of(seat).pointer = null;
  }

  press(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionPressed = true;
    target.actionHeld = true;
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

/** Every draw call, in order, with its arguments flattened alongside. */
class RecordingRenderer implements Renderer {
  readonly ops: string[] = [];
  readonly args: DrawArg[] = [];
  readonly calls: { op: string; values: DrawArg[] }[] = [];

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

  #record(op: string, ...values: DrawArg[]): void {
    this.ops.push(op);
    for (const value of values) this.args.push(value);
    this.calls.push({ op, values });
  }
}

function drawnOnce(game: BeachBallGame, alpha = 0): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer, alpha);
  return renderer;
}

describe('the controls', () => {
  it('runs a player with the movement keys', () => {
    const game = new BeachBallGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    const startX = game.match.p1.x;
    const startY = game.match.p1.y;
    input.steer('p1', 1, 1);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.match.p1.x).toBeGreaterThan(startX);
    expect(game.match.p1.y).toBeGreaterThan(startY);
  });

  it('gives each seat its own half of the keyboard', () => {
    // The two halves are two people: seat one's keys must not move seat two.
    const game = new BeachBallGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    const start = game.match.p2.x;
    input.steer('p1', 1, 0);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.match.p2.x, 'seat two did not move').toBe(start);
  });

  it('never lets a key hold a player across the net', () => {
    const game = new BeachBallGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    input.steer('p1', 0, -1);
    input.steer('p2', 0, 1);
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    expect(game.match.p1.y).toBeGreaterThan(NET_Y);
    expect(game.match.p2.y).toBeLessThan(NET_Y);
  });

  it('runs toward a finger in your own half', () => {
    const game = new BeachBallGame();
    game.init(makeContext(9));
    const input = new ScriptedInput();
    input.point('p1', halfOf('p1').minX, halfOf('p1').maxY);
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.match.p1.x).toBeLessThan(COURT_WIDTH / 2);
    expect(game.match.p1.y).toBeGreaterThan(readyY('p1'));
  });

  it('will not let a finger drag a player across the net', () => {
    // Pointing at the far side runs the player up to their own line and stops. The rule lives
    // in `movePlayer` alone — a second copy in the game module would be a second place for it
    // to be wrong.
    const game = new BeachBallGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    input.point('p1', 300, 20);
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    expect(game.match.p1.y).toBeGreaterThanOrEqual(halfOf('p1').minY - 1e-9);
  });

  it('answers a finger and a key at the same speed', () => {
    const byKey = new BeachBallGame();
    byKey.init(makeContext(13));
    const keys = new ScriptedInput();
    keys.steer('p1', 0, 1);

    const byThumb = new BeachBallGame();
    byThumb.init(makeContext(13));
    const finger = new ScriptedInput();
    finger.point('p1', byThumb.match.p1.x, COURT_HEIGHT);

    for (let i = 0; i < 20; i += 1) {
      byKey.update(STEP, keys);
      byThumb.update(STEP, finger);
    }
    expect(byThumb.match.p1.y).toBeCloseTo(byKey.match.p1.y, 6);
  });

  it('stands still for a finger already on the player', () => {
    const game = new BeachBallGame();
    game.init(makeContext(15));
    const input = new ScriptedInput();
    input.point('p1', game.match.p1.x, game.match.p1.y);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.match.p1.x).toBe(COURT_WIDTH / 2);
  });

  it('stops when the finger lifts and no key is down', () => {
    const game = new BeachBallGame();
    game.init(makeContext(17));
    const input = new ScriptedInput();
    input.point('p1', halfOf('p1').minX, 900);
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    const held = game.match.p1.x;
    input.lift('p1');
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.match.p1.x).toBe(held);
  });

  it('ignores the action button, because this game has none', () => {
    // The manifest promises movement and nothing else; a button that quietly did something
    // would make the pointer stronger than the keyboard, since a finger down *is* the action.
    const game = new BeachBallGame();
    game.init(makeContext(19));
    const input = new ScriptedInput();
    const startX = game.match.p1.x;
    const startY = game.match.p1.y;
    input.press('p1');
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.match.p1.x).toBe(startX);
    expect(game.match.p1.y).toBe(startY);
  });

  it('never moves anybody faster than the declared speed', () => {
    const game = new BeachBallGame();
    game.init(makeContext(21));
    const input = new ScriptedInput();
    input.steer('p1', 1, 1);
    let previousX = game.match.p1.x;
    let previousY = game.match.p1.y;
    for (let i = 0; i < 120; i += 1) {
      game.update(STEP, input);
      const moved = Math.hypot(game.match.p1.x - previousX, game.match.p1.y - previousY);
      expect(moved).toBeLessThanOrEqual(PLAYER_SPEED * STEP + 1e-9);
      previousX = game.match.p1.x;
      previousY = game.match.p1.y;
    }
  });
});

describe('pause and resume', () => {
  it('forgets the motion a player had when it stopped', () => {
    // A shot takes some of the runner with it, so a key still down across a pause must not
    // read as a sprint into the ball on the first step back.
    const game = new BeachBallGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    input.steer('p1', 1, 0);
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.match.p1.vx).toBeGreaterThan(0);
    game.onPause();
    expect(game.match.p1.vx).toBe(0);
    game.onResume();
    expect(game.match.p1.vx).toBe(0);
  });

  it('does not smear the ball across the court on the frame it comes back', () => {
    const game = new BeachBallGame();
    game.init(makeContext(25, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    game.onPause();
    game.onResume();
    const at0 = drawnOnce(game, 0).args.join(',');
    const at1 = drawnOnce(game, 1).args.join(',');
    expect(at1, 'nothing left to interpolate').toBe(at0);
  });
});

describe('the match', () => {
  it('starts level with no winner', () => {
    const game = new BeachBallGame();
    game.init(makeContext(31));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('plays a whole bot match to a result', () => {
    const game = new BeachBallGame();
    game.init(makeContext(33, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBe(TARGET_POINTS);
  });

  it('scores even when neither seat touches a control', () => {
    // The serve is timed rather than triggered, and gravity finishes every point — so a
    // match progresses with nobody playing at all. That is what the fuzz guard relies on.
    const game = new BeachBallGame();
    game.init(makeContext(35));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 60; i += 1) game.update(STEP, input);
    const score = game.getScore();
    expect(score.p1 + score.p2).toBeGreaterThan(0);
  });

  it('stops simulating once it is decided', () => {
    const game = new BeachBallGame();
    game.init(makeContext(37, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = drawnOnce(game).args.join(',');
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(drawnOnce(game).args.join(',')).toBe(frozen);
  });

  it('is called on the clock even if nobody reaches three', () => {
    const game = new BeachBallGame();
    game.init(makeContext(39));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * (MATCH_SECONDS + 5) && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new BeachBallGame();
      game.init(makeContext(41, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 90; i += 1) {
        game.update(STEP, input);
        if (i % 30 === 0) {
          const ball = game.match.ball;
          out.push(
            `${String(Math.round(ball.x))},${String(Math.round(ball.y))},${String(Math.round(ball.z))}`,
          );
        }
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new BeachBallGame();
    game.init(makeContext(43, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 120; i += 1) game.update(STEP, input);
    game.init(makeContext(43, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.elapsed).toBe(0);
  });

  it('clears on destroy', () => {
    const game = new BeachBallGame();
    game.init(makeContext(45, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('keeps the ball on the court, always', () => {
    const game = new BeachBallGame();
    game.init(makeContext(47, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
      const ball = game.match.ball;
      expect(Number.isFinite(ball.x + ball.y + ball.z), `step ${String(i)}`).toBe(true);
      expect(ball.x).toBeGreaterThan(-COURT_WIDTH);
      expect(ball.x).toBeLessThan(COURT_WIDTH * 2);
      expect(ball.z).toBeGreaterThanOrEqual(0);
      expect(ball.z).toBeLessThan(2000);
    }
  });

  it('hands back the same score object rather than a fresh one each step', () => {
    // The shell reads this every frame; allocating a record per frame is the thing rule 5 is
    // about, and this is the one place a game is asked for state per frame.
    const game = new BeachBallGame();
    game.init(makeContext(49));
    expect(game.getScore()).toBe(game.getScore());
  });

  it('has no turn to report, being real-time', () => {
    const game = new BeachBallGame();
    game.init(makeContext(51));
    expect((game as { getActiveSeat?: () => SeatId | null }).getActiveSeat).toBeUndefined();
  });
});

describe('the bot', () => {
  it('never moves the human player', () => {
    // Only a serve moves a silent human, because a serve puts everybody back on their marks.
    const game = new BeachBallGame();
    game.init(makeContext(61, null, 'hard'));
    const input = new ScriptedInput();
    let wasRally = game.match.phase === 'rally';
    let previousX = game.match.p1.x;
    let previousY = game.match.p1.y;
    let rallySteps = 0;
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, input);
      const isRally = game.match.phase === 'rally';
      if (wasRally && isRally) {
        rallySteps += 1;
        expect(game.match.p1.x, 'a silent human stands still').toBe(previousX);
        expect(game.match.p1.y).toBe(previousY);
      }
      wasRally = isRally;
      previousX = game.match.p1.x;
      previousY = game.match.p1.y;
    }
    expect(rallySteps, 'and there were rallies to stand still through').toBeGreaterThan(300);
  });

  it('moves its own player', () => {
    const game = new BeachBallGame();
    game.init(makeContext(63, null, 'hard'));
    const input = new ScriptedInput();
    const startX = game.match.p2.x;
    const startY = game.match.p2.y;
    let moved = false;
    for (let i = 0; i < 900 && !moved; i += 1) {
      game.update(STEP, input);
      if (game.match.p2.x !== startX || game.match.p2.y !== startY) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('plays a different match on easy than on hard from the same seed', () => {
    const trace = (tier: BotDifficulty): string => {
      const game = new BeachBallGame();
      game.init(makeContext(20260823, tier, tier));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        game.update(STEP, input);
        if (i % 15 === 0) out.push(drawnOnce(game).args.join(','));
      }
      return out.join('#');
    };
    expect(trace('hard')).not.toBe(trace('easy'));
  });

  it('plays a different match with a bot than with nobody', () => {
    const trace = (tier: BotDifficulty | null): string => {
      const game = new BeachBallGame();
      game.init(makeContext(20260823, tier, tier));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        game.update(STEP, input);
        if (i % 15 === 0) out.push(`${String(game.match.p2.x)},${String(game.match.p2.y)}`);
      }
      return out.join('#');
    };
    expect(trace('normal')).not.toBe(trace(null));
  });

  it('beats a seat nobody is playing', () => {
    const game = new BeachBallGame();
    game.init(makeContext(65, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 300 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).toBe('p2');
  });
});

describe('rendering', () => {
  it('draws the sand, the net, both players and the ball', () => {
    const game = new BeachBallGame();
    game.init(makeContext(71));
    const renderer = drawnOnce(game);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.base);
    expect(renderer.ops.filter((op) => op === 'line').length, 'the net is hatched').toBeGreaterThan(
      4,
    );
  });

  it('never rotates: a court split across the middle reads the same for both', () => {
    const game = new BeachBallGame();
    game.init(makeContext(73));
    const renderer = drawnOnce(game);
    expect(renderer.ops.filter((op) => op === 'pushRotation').length).toBe(0);
    expect(renderer.ops.filter((op) => op === 'pushSeatRotation').length).toBe(0);
  });

  it('tells the two players apart by shape as well as colour', () => {
    // Rule 7. In a game where both ends of the court hold one moving thing, the silhouette
    // is what a player actually tracks, and it survives a greyscale screen.
    const game = new BeachBallGame();
    game.init(makeContext(75));
    const renderer = drawnOnce(game);
    const p1Discs = renderer.calls.filter(
      (call) => call.op === 'circle' && call.values[3] === SEAT_PALETTE.p1.base,
    );
    const p2Squares = renderer.calls.filter(
      (call) => call.op === 'rect' && call.values[4] === SEAT_PALETTE.p2.base,
    );
    expect(p1Discs.length, 'p1 is a disc').toBeGreaterThan(0);
    expect(p2Squares.length, 'p2 is a square').toBeGreaterThan(0);
  });

  it('gives each half the same markings, so neither seat reads a different court', () => {
    const game = new BeachBallGame();
    game.init(makeContext(77));
    const renderer = drawnOnce(game);
    const attackLines = renderer.calls.filter(
      (call) => call.op === 'line' && call.values[1] === call.values[3] && call.values[4] === 3,
    );
    expect(attackLines.length, 'one attack line each side').toBe(2);
    const ys = attackLines.map((call) => Number(call.values[1]));
    expect(ys[0]! + ys[1]!, 'and they mirror about the net').toBe(COURT_HEIGHT);
  });

  it('draws the ball bigger the higher it is, with its shadow sliding out', () => {
    const low = new BeachBallGame();
    low.init(makeContext(79));
    low.match.ball.z = 0;
    const lowBall = drawnOnce(low, 1)
      .calls.filter((call) => call.op === 'circle')
      .pop()!;

    const high = new BeachBallGame();
    high.init(makeContext(79));
    high.match.ball.z = 120;
    const highCircles = drawnOnce(high, 1).calls.filter((call) => call.op === 'circle');
    const highBall = highCircles.pop()!;
    const highShadow = highCircles.pop()!;

    expect(Number(highBall.values[2]), 'a high ball is drawn larger').toBeGreaterThan(
      Number(lowBall.values[2]),
    );
    expect(Number(highShadow.values[0]), 'and its shadow is off to one side').toBeGreaterThan(
      Number(highBall.values[0]),
    );
  });

  it('throws the shadow along the shared axis, so neither seat reads height better', () => {
    const game = new BeachBallGame();
    game.init(makeContext(81));
    game.match.ball.z = 110;
    const circles = drawnOnce(game, 1).calls.filter((call) => call.op === 'circle');
    const ball = circles.pop()!;
    const shadow = circles.pop()!;
    expect(Number(shadow.values[1]), 'the shadow never moves along y').toBe(Number(ball.values[1]));
  });

  it('interpolates between steps rather than jumping', () => {
    const game = new BeachBallGame();
    game.init(makeContext(83, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    expect(drawnOnce(game, 0).args.join(',')).not.toBe(drawnOnce(game, 1).args.join(','));
  });

  it('draws nothing far outside the logical play area', () => {
    const game = new BeachBallGame();
    game.init(makeContext(85, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    for (const value of drawnOnce(game, 0.5).args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(-200);
      expect(value).toBeLessThan(manifest.logical.height + 200);
    }
  });

  it('does not mutate the simulation', () => {
    const game = new BeachBallGame();
    game.init(makeContext(87, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = `${String(game.match.ball.x)}:${String(game.match.p1.y)}`;
    drawnOnce(game, 0.4);
    drawnOnce(game, 0.9);
    expect(`${String(game.match.ball.x)}:${String(game.match.p1.y)}`).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('beach-ball');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.category).toBe('Sports');
    expect(manifest.zoneSplit, 'a half of the court each, across the middle').toBe('horizontal');
    expect(manifest.modes).toEqual(['friend', 'bot']);
  });

  it('declares the logical box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(COURT_WIDTH);
    expect(manifest.logical.height).toBe(COURT_HEIGHT);
  });

  it('tells the truth about the keyboard', () => {
    // Control strings that lie are a known recurring bug here; Mini Soccer shipped five.
    const { keyboard } = manifest.controls;
    expect(keyboard).toMatch(/w a s d/i);
    expect(keyboard).toMatch(/arrow/i);
    expect(keyboard, 'and it names which half belongs to whom').toMatch(/near|far/i);
    expect(keyboard, 'it promises running, and running is all there is').toMatch(/run/i);
    expect(keyboard).not.toMatch(/jump|press|space|enter|hit|swing/i);
  });

  it('tells the truth about the pointer', () => {
    const { pointer } = manifest.controls;
    expect(pointer).toMatch(/drag/i);
    expect(pointer).toMatch(/own half/i);
    expect(pointer, 'no tap-to-do-anything, because there is nothing to tap').not.toMatch(/tap/i);
  });

  it('is fair across input families', () => {
    // Running is rate-based and both instruments ask for a direction at the same speed limit.
    expect(manifest.sameInputClassOnly).toBe(false);
  });

  it('advertises a round length the match can actually reach', () => {
    expect(manifest.roundSeconds).toBeLessThanOrEqual(MATCH_SECONDS);
  });
});
