import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { SeatId, Vec2 } from '@duelbox/engine';
import {
  ALIGN_COS,
  ARENA_HALF,
  AVOID_MARGIN,
  BALL_DRAG,
  BALL_RADIUS,
  BALL_SHARE,
  BASE_RADIUS,
  BEETLE_BALL_TOUCH,
  BEETLE_BUG_TOUCH,
  BEETLE_RADIUS,
  BEETLE_SPEED,
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  CELEBRATE_SECONDS,
  GRIP,
  HOLD_SECONDS,
  KICKOFF_SECONDS,
  KNOCKBACK_DRAG,
  KNOCKBACK_SPEED,
  LADYBUG_COUNT,
  LADYBUG_RADIUS,
  LADYBUG_RING_MAX,
  LADYBUG_RING_MIN,
  LADYBUG_SPEED,
  LADYBUG_TURN,
  MATCH_SECONDS,
  MAX_BALL_SPEED,
  PUSH_RATIO,
  SHY_RADIUS,
  START_OFFSET,
  STUN_SECONDS,
  TARGET_DELIVERIES,
  WALL_BOUNCE,
  WIN_CONDITION,
  baseYOf,
  beetleOf,
  botInput,
  createBotState,
  createGame,
  deliveryIn,
  driveBeetle,
  flipCaught,
  kickOff,
  otherOf,
  placeLadybugs,
  pushBall,
  pushDelta,
  resetBotState,
  resetGame,
  scoreOf,
  separate,
  step,
  stepBall,
  stepLadybugs,
  stepsFor,
  steerLadybug,
  winnerOf,
} from './rules.js';
import type { Ball, Beetle, BotDifficulty, BotProfile, Game, Ladybug } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function fresh(seed = 1): Game {
  return createGame(new Rng(seed));
}

/** Straight to live play, with nothing in the way of the thing under test. */
function live(seed = 1): Game {
  const game = fresh(seed);
  for (const bug of game.bugs) {
    bug.x = ARENA_HALF - LADYBUG_RADIUS;
    bug.y = ARENA_HALF - LADYBUG_RADIUS;
  }
  while (game.phase === 'kickoff') step(game, STEP, 0, 0, 0, 0);
  return game;
}

function placeBall(game: Game, x: number, y: number, vx = 0, vy = 0): void {
  game.ball.x = x;
  game.ball.y = y;
  game.ball.vx = vx;
  game.ball.vy = vy;
}

function beetle(x: number, y: number, vx = 0, vy = 0): Beetle {
  return { x, y, vx, vy, kx: 0, ky: 0, stun: 0, faceX: 0, faceY: 1 };
}

function ball(x: number, y: number, vx = 0, vy = 0): Ball {
  return { x, y, vx, vy };
}

/** Everything that decides a step, as a comparable string. */
function snapshot(game: Readonly<Game>): string {
  const parts: number[] = [
    game.ball.x,
    game.ball.y,
    game.ball.vx,
    game.ball.vy,
    game.p1.x,
    game.p1.y,
    game.p1.stun,
    game.p2.x,
    game.p2.y,
    game.p2.stun,
    game.score.p1,
    game.score.p2,
    game.clock,
  ];
  for (const bug of game.bugs) parts.push(bug.x, bug.y, bug.hx, bug.hy);
  return parts.join(',');
}

describe('the pit', () => {
  it('is a square centred on the origin', () => {
    expect(ARENA_HALF).toBe(400);
    expect(baseYOf('p1')).toBe(ARENA_HALF);
    expect(baseYOf('p2')).toBe(-ARENA_HALF);
    // The two bases are reflections of one another through the middle, exactly.
    expect(baseYOf('p1')).toBe(-baseYOf('p2'));
  });

  it('names its contact distances once', () => {
    expect(BEETLE_BALL_TOUCH).toBe(BEETLE_RADIUS + BALL_RADIUS);
    expect(BEETLE_BUG_TOUCH).toBe(BEETLE_RADIUS + LADYBUG_RADIUS);
  });

  it('leaves a delivery window a ball can actually reach', () => {
    // A ball cannot get nearer the wall than its own radius, so the window is the chord of
    // the base circle at that depth. If this went negative the game would be unwinnable.
    const chord = 2 * Math.sqrt(BASE_RADIUS * BASE_RADIUS - BALL_RADIUS * BALL_RADIUS);
    expect(chord).toBeGreaterThan(BALL_RADIUS * 4);
    expect(chord).toBeLessThan(ARENA_HALF); // and not so wide that it is hard to miss
    expect(Math.round(chord)).toBe(289);
  });

  it('caps the ball below one contact distance a step', () => {
    // Or a shove could carry the ball through a beetle between two discrete tests.
    expect(MAX_BALL_SPEED * STEP).toBeLessThan(BEETLE_BALL_TOUCH);
  });

  it('leaves a safe pocket inside the ladybugs’ ring', () => {
    // A beetle touching the ball stands BEETLE_BALL_TOUCH out; the ring reaches in to
    // SHY_RADIUS - BEETLE_BUG_TOUCH. The ball must be inside the pocket or possession
    // would be a coin toss rather than a reward.
    expect(SHY_RADIUS - BEETLE_BUG_TOUCH).toBeGreaterThan(BEETLE_BALL_TOUCH);
  });

  it('starts both beetles outside the ring', () => {
    expect(START_OFFSET).toBeGreaterThan(SHY_RADIUS + BEETLE_BUG_TOUCH);
  });

  it('deals no ladybug onto a beetle’s mark', () => {
    expect(LADYBUG_RING_MIN).toBeGreaterThan(START_OFFSET + BEETLE_BUG_TOUCH);
    expect(LADYBUG_RING_MAX).toBeLessThan(ARENA_HALF - LADYBUG_RADIUS);
  });

  it('lets a beetle outrun a ladybug', () => {
    expect(LADYBUG_SPEED).toBeLessThan(BEETLE_SPEED);
  });

  it('gives the ball a shove that outruns the beetle that made it', () => {
    // Below one and the ball would never leave the shell that pushed it, which is carrying.
    expect(PUSH_RATIO).toBeGreaterThan(1);
    expect(BEETLE_SPEED * PUSH_RATIO).toBeLessThan(MAX_BALL_SPEED);
  });

  it('rolls a full shove about a quarter of the pit', () => {
    const roll = (BEETLE_SPEED * PUSH_RATIO) / BALL_DRAG;
    expect(Math.round(roll)).toBe(216);
    expect(roll).toBeLessThan(ARENA_HALF);
  });

  it('shares an overlap with the ball, not with the beetle alone', () => {
    expect(BALL_SHARE).toBeGreaterThan(0.5);
    expect(BALL_SHARE).toBeLessThan(1);
  });

  it('keeps the wall dead rather than bouncy', () => {
    expect(WALL_BOUNCE).toBeGreaterThan(0);
    expect(WALL_BOUNCE).toBeLessThan(1);
  });

  it('grips the ball without carrying it', () => {
    expect(GRIP).toBeGreaterThan(0);
    expect(GRIP).toBeLessThan(1);
  });

  it('declares its win condition once, as a shared helper', () => {
    expect(WIN_CONDITION).toEqual({ kind: 'first-to', target: TARGET_DELIVERIES });
  });

  it('deals an even number of ladybugs, because they come in mirror pairs', () => {
    expect(LADYBUG_COUNT % 2).toBe(0);
  });
});

describe('stepsFor', () => {
  it('turns seconds into whole steps at the rate in hand', () => {
    expect(stepsFor(1, 1 / 60)).toBe(60);
    expect(stepsFor(1, 1 / 120)).toBe(120);
    expect(stepsFor(0.5, 1 / 60)).toBe(30);
  });

  it('never returns less than one step', () => {
    expect(stepsFor(0, 1 / 60)).toBe(1);
    expect(stepsFor(0.001, 1 / 60)).toBe(1);
    expect(stepsFor(-5, 1 / 60)).toBe(1);
  });

  it('survives a nonsense step size rather than dividing by zero', () => {
    expect(stepsFor(1, 0)).toBe(1);
    expect(stepsFor(1, Number.NaN)).toBe(1);
    expect(stepsFor(1, -1)).toBe(1);
  });

  it('rounds rather than truncating, so a delay is never systematically short', () => {
    expect(stepsFor(0.51, 1 / 60)).toBe(31);
    expect(stepsFor(0.508, 1 / 60)).toBe(30);
  });
});

describe('a fresh pit', () => {
  it('starts level, with the clock full and nobody having won', () => {
    const game = fresh();
    expect(game.score.p1).toBe(0);
    expect(game.score.p2).toBe(0);
    expect(game.clock).toBe(MATCH_SECONDS);
    expect(winnerOf(game)).toBeNull();
    expect(game.phase).toBe('kickoff');
  });

  it('puts the ball in the middle and the beetles on their own marks', () => {
    const game = fresh();
    expect(game.ball.x).toBe(0);
    expect(game.ball.y).toBe(0);
    expect(game.p1.y).toBe(START_OFFSET);
    expect(game.p2.y).toBe(-START_OFFSET);
    expect(game.p1.x).toBe(0);
    expect(game.p2.x).toBe(0);
  });

  it('faces each beetle at the ball', () => {
    const game = fresh();
    expect(game.p1.faceY).toBeLessThan(0);
    expect(game.p2.faceY).toBeGreaterThan(0);
  });

  it('is the same pit for the same seed', () => {
    expect(snapshot(fresh(9))).toBe(snapshot(fresh(9)));
  });

  it('is a different pit for a different seed', () => {
    expect(snapshot(fresh(9))).not.toBe(snapshot(fresh(10)));
  });

  it('deals every ladybug inside the pit', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      for (const bug of fresh(seed).bugs) {
        expect(Math.abs(bug.x)).toBeLessThanOrEqual(ARENA_HALF - LADYBUG_RADIUS);
        expect(Math.abs(bug.y)).toBeLessThanOrEqual(ARENA_HALF - LADYBUG_RADIUS);
      }
    }
  });

  it('deals them in the band it says it does', () => {
    for (let seed = 1; seed < 40; seed += 1) {
      for (const bug of fresh(seed).bugs) {
        const radius = Math.hypot(bug.x, bug.y);
        expect(radius).toBeGreaterThanOrEqual(LADYBUG_RING_MIN - 1e-9);
        expect(radius).toBeLessThanOrEqual(LADYBUG_RING_MAX + 1e-9);
      }
    }
  });

  it('gives every ladybug a unit heading', () => {
    for (let seed = 1; seed < 20; seed += 1) {
      for (const bug of fresh(seed).bugs) {
        expect(Math.hypot(bug.hx, bug.hy)).toBeCloseTo(1, 12);
      }
    }
  });
});

describe('the ladybugs are dealt in mirror pairs', () => {
  it('reflects the second of each pair through the middle of the pit', () => {
    for (let seed = 1; seed < 60; seed += 1) {
      const game = fresh(seed);
      for (let pair = 0; pair * 2 < game.bugs.length; pair += 1) {
        const first = game.bugs[pair * 2]!;
        const second = game.bugs[pair * 2 + 1]!;
        // To the bit: this is a sign flip, not a subtraction from a corner.
        expect(second.x).toBe(-first.x);
        expect(second.y).toBe(-first.y);
        expect(second.hx).toBe(-first.hx);
        expect(second.hy).toBe(-first.hy);
      }
    }
  });

  it('means the opening board is the same board from either end', () => {
    // Turn the pit half a turn and every ladybug lands on another ladybug, both beetles
    // land on each other's marks and the ball lands on itself. That is the whole answer to
    // "was one player's pit kinder".
    for (let seed = 1; seed < 30; seed += 1) {
      const game = fresh(seed);
      for (const bug of game.bugs) {
        const twin = game.bugs.find((other) => other.x === -bug.x && other.y === -bug.y);
        expect(twin).toBeDefined();
      }
      // `===` rather than toBe, which is Object.is and separates +0 from -0.
      expect(game.p1.y === -game.p2.y).toBe(true);
      expect(game.p1.x === -game.p2.x).toBe(true);
      expect(game.ball.x).toBe(0);
      expect(game.ball.y).toBe(0);
    }
  });

  it('draws two values a pair and no more', () => {
    const counting = new Rng(4);
    const spent = new Rng(4);
    const game = fresh(1);
    placeLadybugs(game, counting);
    for (let i = 0; i < (LADYBUG_COUNT / 2) * 2; i += 1) spent.float();
    expect(counting.save()).toEqual(spent.save());
  });
});

describe('driving a beetle', () => {
  it('moves it at its own speed and no faster', () => {
    const subject = beetle(0, 0);
    driveBeetle(subject, 1, 0, STEP);
    expect(subject.x).toBeCloseTo(BEETLE_SPEED * STEP, 9);
    expect(subject.y).toBe(0);
  });

  it('does not let a diagonal outrun a straight line', () => {
    const straight = beetle(0, 0);
    const diagonal = beetle(0, 0);
    driveBeetle(straight, 1, 0, STEP);
    driveBeetle(diagonal, 1, 1, STEP);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(Math.hypot(straight.x, straight.y), 9);
  });

  it('keeps a gentle push gentle', () => {
    const soft = beetle(0, 0);
    driveBeetle(soft, 0.5, 0, STEP);
    expect(soft.x).toBeCloseTo(BEETLE_SPEED * STEP * 0.5, 9);
  });

  it('stands still for no input at all', () => {
    const idle = beetle(10, 20);
    driveBeetle(idle, 0, 0, STEP);
    expect(idle.x).toBe(10);
    expect(idle.y).toBe(20);
    expect(idle.vx).toBe(0);
    expect(idle.vy).toBe(0);
  });

  it('reports the velocity it actually realised, not the one it wanted', () => {
    const pressed = beetle(ARENA_HALF - BEETLE_RADIUS, 0);
    driveBeetle(pressed, 1, 0, STEP);
    // Pinned against the wall: it wanted 300 and got nothing, and the shove maths must know.
    expect(pressed.vx).toBe(0);
  });

  it('stays inside the pit whatever it is told to do', () => {
    const wanderer = beetle(0, 0);
    for (let i = 0; i < 600; i += 1) driveBeetle(wanderer, 1, 1, STEP);
    expect(wanderer.x).toBeLessThanOrEqual(ARENA_HALF - BEETLE_RADIUS);
    expect(wanderer.y).toBeLessThanOrEqual(ARENA_HALF - BEETLE_RADIUS);
  });

  it('faces the way it is going', () => {
    const walker = beetle(0, 0);
    driveBeetle(walker, 0, -1, STEP);
    expect(walker.faceY).toBeCloseTo(-1, 9);
    driveBeetle(walker, 1, 0, STEP);
    expect(walker.faceX).toBeCloseTo(1, 9);
  });

  it('keeps facing the same way when it stops', () => {
    const walker = beetle(0, 0);
    driveBeetle(walker, 1, 0, STEP);
    driveBeetle(walker, 0, 0, STEP);
    expect(walker.faceX).toBeCloseTo(1, 9);
  });

  it('ignores the stick while it is on its back', () => {
    const flipped = beetle(0, 0);
    flipped.stun = 10;
    driveBeetle(flipped, 1, 0, STEP);
    expect(flipped.x).toBe(0);
    expect(flipped.stun).toBe(9);
  });

  it('skids while it is down, and the skid decays analytically', () => {
    const flipped = beetle(0, 0);
    flipped.stun = 60;
    flipped.kx = KNOCKBACK_SPEED;
    driveBeetle(flipped, 0, 0, STEP);
    const decay = Math.exp(-KNOCKBACK_DRAG * STEP);
    expect(flipped.kx).toBeCloseTo(KNOCKBACK_SPEED * decay, 9);
    expect(flipped.x).toBeCloseTo((KNOCKBACK_SPEED * (1 - decay)) / KNOCKBACK_DRAG, 9);
  });

  it('carries a skid far enough to clear the bug that made it', () => {
    const flipped = beetle(0, 0);
    flipped.stun = stepsFor(STUN_SECONDS, STEP);
    flipped.kx = KNOCKBACK_SPEED;
    while (flipped.stun > 0) driveBeetle(flipped, 0, 0, STEP);
    expect(flipped.x).toBeGreaterThan(KNOCKBACK_SPEED / KNOCKBACK_DRAG - 1);
    expect(flipped.x + BEETLE_BUG_TOUCH).toBeGreaterThan(BEETLE_BUG_TOUCH * 1.8);
  });

  it('drops the skid the moment it is back on its feet', () => {
    const flipped = beetle(0, 0);
    flipped.stun = 1;
    flipped.kx = KNOCKBACK_SPEED;
    driveBeetle(flipped, 0, 0, STEP);
    expect(flipped.stun).toBe(0);
    driveBeetle(flipped, 0, 0, STEP);
    expect(flipped.kx).toBe(0);
  });

  it('counts the stun down by whole steps, so a residue cannot add a frame', () => {
    const flipped = beetle(0, 0);
    const steps = stepsFor(STUN_SECONDS, STEP);
    flipped.stun = steps;
    for (let i = 0; i < steps; i += 1) {
      expect(flipped.stun).toBeGreaterThan(0);
      driveBeetle(flipped, 0, 0, STEP);
    }
    expect(flipped.stun).toBe(0);
  });

  it('does not divide by a zero step', () => {
    const subject = beetle(3, 4);
    driveBeetle(subject, 1, 0, 0);
    expect(Number.isFinite(subject.vx)).toBe(true);
    expect(subject.vx).toBe(0);
  });
});

describe('the shove', () => {
  const out: Vec2 = vec2();

  it('does nothing when the beetle is not touching the ball', () => {
    pushDelta(beetle(0, 0, BEETLE_SPEED, 0), ball(BEETLE_BALL_TOUCH + 1, 0), out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('does nothing when the beetle is retreating', () => {
    pushDelta(beetle(0, 0, -BEETLE_SPEED, 0), ball(BEETLE_BALL_TOUCH - 1, 0), out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('drives the ball to the beetle’s speed times the ratio', () => {
    pushDelta(beetle(0, 0, BEETLE_SPEED, 0), ball(BEETLE_BALL_TOUCH - 1, 0), out);
    expect(out.x).toBeCloseTo(BEETLE_SPEED * PUSH_RATIO, 9);
    expect(out.y).toBeCloseTo(0, 9);
  });

  it('is a target, not a shove: a ball already leaving faster gets nothing', () => {
    pushDelta(
      beetle(0, 0, BEETLE_SPEED, 0),
      ball(BEETLE_BALL_TOUCH - 1, 0, BEETLE_SPEED * PUSH_RATIO + 10, 0),
      out,
    );
    expect(out.x).toBe(0);
  });

  it('tops a slow ball up to the target rather than adding to it', () => {
    pushDelta(beetle(0, 0, BEETLE_SPEED, 0), ball(BEETLE_BALL_TOUCH - 1, 0, 100, 0), out);
    expect(out.x).toBeCloseTo(BEETLE_SPEED * PUSH_RATIO - 100, 9);
  });

  it('does not accumulate over a long contact', () => {
    // Sixty steps of contact must leave the ball at the target speed, not at sixty times it.
    const rolling = ball(BEETLE_BALL_TOUCH - 1, 0);
    for (let i = 0; i < 60; i += 1) {
      pushDelta(beetle(0, 0, BEETLE_SPEED, 0), rolling, out);
      rolling.vx += out.x;
      rolling.vy += out.y;
    }
    expect(rolling.vx).toBeLessThanOrEqual(BEETLE_SPEED * PUSH_RATIO + 1e-9);
  });

  it('rolls the ball sideways with the shell’s grip', () => {
    // Pressing straight up while walking right: the ball takes GRIP of the sideways motion.
    pushDelta(beetle(0, 0, BEETLE_SPEED, 0), ball(0, -(BEETLE_BALL_TOUCH - 1)), out);
    expect(Math.abs(out.x)).toBeCloseTo(BEETLE_SPEED * GRIP, 9);
  });

  it('never grips a ball backwards', () => {
    // A ball already sliding faster sideways than the shell is not slowed by the shell.
    pushDelta(
      beetle(0, 0, BEETLE_SPEED, 0),
      ball(0, -(BEETLE_BALL_TOUCH - 1), BEETLE_SPEED, 0),
      out,
    );
    expect(out.x).toBe(0);
  });

  it('shoves nothing when both are exactly on top of each other and still', () => {
    pushDelta(beetle(0, 0), ball(0, 0), out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('shoves along its own heading from dead centre', () => {
    pushDelta(beetle(0, 0, 0, BEETLE_SPEED), ball(0, 0), out);
    expect(out.y).toBeGreaterThan(0);
    expect(out.x).toBeCloseTo(0, 9);
  });

  it('reads the state and never writes it', () => {
    const pusher = beetle(0, 0, BEETLE_SPEED, 0);
    const target = ball(BEETLE_BALL_TOUCH - 1, 0);
    const before = JSON.stringify([pusher, target]);
    pushDelta(pusher, target, out);
    expect(JSON.stringify([pusher, target])).toBe(before);
  });
});

describe('two beetles shoving at once', () => {
  it('cancels exactly when they press from opposite sides', () => {
    const game = live();
    placeBall(game, 0, 0);
    game.p1.x = 0;
    game.p1.y = BEETLE_BALL_TOUCH - 1;
    game.p1.vy = -BEETLE_SPEED;
    game.p2.x = 0;
    game.p2.y = -(BEETLE_BALL_TOUCH - 1);
    game.p2.vy = BEETLE_SPEED;
    pushBall(game);
    expect(game.ball.vy).toBeCloseTo(0, 9);
  });

  it('does not depend on which seat is looked at first', () => {
    const forward = live(3);
    const swapped = live(3);
    placeBall(forward, 5, 0);
    placeBall(swapped, 5, 0);
    forward.p1.x = -30;
    forward.p1.vx = BEETLE_SPEED;
    forward.p2.x = 80;
    forward.p2.vx = -BEETLE_SPEED;
    // The same two shoves, with the seats' roles exchanged.
    swapped.p2.x = -30;
    swapped.p2.vx = BEETLE_SPEED;
    swapped.p1.x = 80;
    swapped.p1.vx = -BEETLE_SPEED;
    pushBall(forward);
    pushBall(swapped);
    expect(forward.ball.vx).toBe(swapped.ball.vx);
    expect(forward.ball.vy).toBe(swapped.ball.vy);
  });

  it('caps the ball however hard the pair hit it', () => {
    const game = live();
    placeBall(game, 0, 0, MAX_BALL_SPEED, MAX_BALL_SPEED);
    game.p1.x = -(BEETLE_BALL_TOUCH - 1);
    game.p1.vx = BEETLE_SPEED;
    game.p2.y = -(BEETLE_BALL_TOUCH - 1);
    game.p2.vy = BEETLE_SPEED;
    pushBall(game);
    expect(Math.hypot(game.ball.vx, game.ball.vy)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-9);
  });
});

describe('the rolling ball', () => {
  it('decays as a rate, so two half steps land where one whole step does', () => {
    const halves = ball(0, 0, 400, 250);
    const whole = ball(0, 0, 400, 250);
    stepBall(halves, STEP);
    stepBall(halves, STEP);
    stepBall(whole, STEP * 2);
    expect(halves.x).toBeCloseTo(whole.x, 9);
    expect(halves.y).toBeCloseTo(whole.y, 9);
    expect(halves.vx).toBeCloseTo(whole.vx, 9);
    expect(halves.vy).toBeCloseTo(whole.vy, 9);
  });

  it('and the same at three different rates', () => {
    const sixty = ball(0, 0, 500, 0);
    const oneTwenty = ball(0, 0, 500, 0);
    for (let i = 0; i < 60; i += 1) stepBall(sixty, 1 / 60);
    for (let i = 0; i < 120; i += 1) stepBall(oneTwenty, 1 / 120);
    expect(sixty.x).toBeCloseTo(oneTwenty.x, 6);
    expect(sixty.vx).toBeCloseTo(oneTwenty.vx, 9);
  });

  it('rolls the distance the drag says it will', () => {
    const rolling = ball(0, 0, 320, 0);
    for (let i = 0; i < 60 * 20; i += 1) stepBall(rolling, STEP);
    expect(rolling.x).toBeCloseTo(320 / BALL_DRAG, 3);
  });

  it('stops rather than creeping for ever', () => {
    const rolling = ball(0, 0, 200, 0);
    for (let i = 0; i < 60 * 30; i += 1) stepBall(rolling, STEP);
    expect(Math.abs(rolling.vx)).toBeLessThan(1e-6);
  });

  it('bounces off a wall, keeping only part of its speed', () => {
    const rolling = ball(ARENA_HALF - BALL_RADIUS - 1, 0, 400, 0);
    stepBall(rolling, STEP);
    expect(rolling.x).toBe(ARENA_HALF - BALL_RADIUS);
    // The drag is applied over the step before the wall is met, so the speed the wall
    // reverses is the decayed one, not the one the ball started with.
    const arriving = 400 * Math.exp(-BALL_DRAG * STEP);
    expect(rolling.vx).toBeCloseTo(-arriving * WALL_BOUNCE, 6);
    expect(Math.abs(rolling.vx)).toBeLessThan(400);
  });

  it('never leaves the pit, however hard it is hit', () => {
    const rolling = ball(0, 0, MAX_BALL_SPEED, MAX_BALL_SPEED);
    for (let i = 0; i < 4000; i += 1) {
      stepBall(rolling, STEP);
      expect(Math.abs(rolling.x)).toBeLessThanOrEqual(ARENA_HALF - BALL_RADIUS);
      expect(Math.abs(rolling.y)).toBeLessThanOrEqual(ARENA_HALF - BALL_RADIUS);
    }
  });

  it('bounces the same off either wall', () => {
    const right = ball(ARENA_HALF - BALL_RADIUS - 1, 0, 400, 0);
    const left = ball(-(ARENA_HALF - BALL_RADIUS - 1), 0, -400, 0);
    stepBall(right, STEP);
    stepBall(left, STEP);
    expect(right.x).toBe(-left.x);
    expect(right.vx).toBe(-left.vx);
  });
});

describe('a ladybug', () => {
  function bug(x: number, y: number, hx: number, hy: number): Ladybug {
    return { x, y, hx, hy };
  }

  it('walks forward at its own speed', () => {
    const walker = bug(0, 0, 1, 0);
    steerLadybug(walker, 1000, 0, STEP);
    expect(walker.x).toBeCloseTo(LADYBUG_SPEED * STEP, 9);
  });

  it('turns no faster than its turn rate', () => {
    const walker = bug(0, 0, 1, 0);
    steerLadybug(walker, 0, -1000, STEP);
    const turned = Math.acos(Math.min(1, walker.hx));
    expect(turned).toBeLessThanOrEqual(LADYBUG_TURN * STEP + 1e-12);
    expect(turned).toBeGreaterThan(0);
  });

  it('turns the short way round', () => {
    const clockwise = bug(0, 0, 1, 0);
    steerLadybug(clockwise, 0, 1000, STEP);
    expect(clockwise.hy).toBeGreaterThan(0);
    const other = bug(0, 0, 1, 0);
    steerLadybug(other, 0, -1000, STEP);
    expect(other.hy).toBeLessThan(0);
  });

  it('keeps its heading exactly one unit long over thousands of turns', () => {
    const walker = bug(0, 0, 1, 0);
    const rng = new Rng(12);
    for (let i = 0; i < 5000; i += 1) {
      steerLadybug(walker, (rng.float() - 0.5) * 800, (rng.float() - 0.5) * 800, STEP);
      expect(Math.hypot(walker.hx, walker.hy)).toBeCloseTo(1, 10);
    }
  });

  it('turns back at a wall', () => {
    const walker = bug(ARENA_HALF - LADYBUG_RADIUS - 1, 0, 1, 0);
    steerLadybug(walker, 1000, 0, STEP);
    expect(walker.x).toBe(ARENA_HALF - LADYBUG_RADIUS);
    expect(walker.hx).toBeLessThan(0);
  });

  it('stays inside the pit for ever', () => {
    const walker = bug(0, 0, 1, 0.3);
    const rng = new Rng(5);
    for (let i = 0; i < 8000; i += 1) {
      steerLadybug(walker, (rng.float() - 0.5) * 1600, (rng.float() - 0.5) * 1600, STEP);
      expect(Math.abs(walker.x)).toBeLessThanOrEqual(ARENA_HALF - LADYBUG_RADIUS);
      expect(Math.abs(walker.y)).toBeLessThanOrEqual(ARENA_HALF - LADYBUG_RADIUS);
    }
  });

  it('holds a ring around the ball rather than diving at it', () => {
    const game = live(2);
    placeBall(game, 0, 0);
    for (const one of game.bugs) {
      one.x = 350;
      one.y = 0;
      one.hx = -1;
      one.hy = 0;
    }
    let nearest = Infinity;
    for (let i = 0; i < 60 * 12; i += 1) {
      stepLadybugs(game, STEP);
      for (const one of game.bugs) nearest = Math.min(nearest, Math.hypot(one.x, one.y));
    }
    // It gets near the ring and does not settle on the ball itself.
    expect(nearest).toBeLessThan(SHY_RADIUS + 60);
    expect(nearest).toBeGreaterThan(BEETLE_BALL_TOUCH - BEETLE_BUG_TOUCH);
  });

  it('follows the ball when the ball moves', () => {
    const game = live(2);
    placeBall(game, 300, 300);
    for (const one of game.bugs) {
      one.x = -300;
      one.y = -300;
      one.hx = 1;
      one.hy = 1;
    }
    const before = Math.hypot(game.bugs[0]!.x - 300, game.bugs[0]!.y - 300);
    for (let i = 0; i < 60 * 4; i += 1) stepLadybugs(game, STEP);
    const after = Math.hypot(game.bugs[0]!.x - 300, game.bugs[0]!.y - 300);
    expect(after).toBeLessThan(before);
  });
});

describe('separating what overlaps', () => {
  it('pushes a ball out of a beetle', () => {
    const game = live();
    game.p1.x = 0;
    game.p1.y = 0;
    placeBall(game, 10, 0);
    separate(game);
    const gap = Math.hypot(game.ball.x - game.p1.x, game.ball.y - game.p1.y);
    expect(gap).toBeGreaterThan(10);
  });

  it('moves the beetle too, so it cannot walk through the ball', () => {
    const game = live();
    game.p1.x = 0;
    game.p1.y = 0;
    placeBall(game, 10, 0);
    separate(game);
    expect(game.p1.x).toBeLessThan(0);
  });

  it('gives the ball the larger share of the correction', () => {
    const game = live();
    game.p1.x = 0;
    game.p1.y = 0;
    placeBall(game, 10, 0);
    const wasBall = game.ball.x;
    const wasBeetle = game.p1.x;
    separate(game);
    expect(game.ball.x - wasBall).toBeGreaterThan(Math.abs(game.p1.x - wasBeetle));
    expect(BALL_SHARE).toBeGreaterThan(0.5);
  });

  it('leaves a ball squeezed evenly between two beetles exactly where it is', () => {
    const game = live();
    placeBall(game, 0, 0);
    game.p1.x = 0;
    game.p1.y = BEETLE_BALL_TOUCH - 20;
    game.p2.x = 0;
    game.p2.y = -(BEETLE_BALL_TOUCH - 20);
    separate(game);
    expect(game.ball.y).toBeCloseTo(0, 12);
  });

  it('pushes two overlapping beetles apart, equally', () => {
    const game = live();
    placeBall(game, 350, 350);
    game.p1.x = -10;
    game.p1.y = 0;
    game.p2.x = 10;
    game.p2.y = 0;
    separate(game);
    expect(game.p1.x).toBeLessThan(-10);
    expect(game.p2.x).toBeGreaterThan(10);
    expect(game.p1.x + game.p2.x).toBeCloseTo(0, 12);
  });

  it('never pushes anything out of the pit', () => {
    const game = live();
    game.p1.x = ARENA_HALF - BEETLE_RADIUS;
    game.p1.y = ARENA_HALF - BEETLE_RADIUS;
    placeBall(game, ARENA_HALF - BALL_RADIUS, ARENA_HALF - BALL_RADIUS);
    game.p2.x = ARENA_HALF - BEETLE_RADIUS - 5;
    game.p2.y = ARENA_HALF - BEETLE_RADIUS;
    separate(game);
    expect(Math.abs(game.ball.x)).toBeLessThanOrEqual(ARENA_HALF - BALL_RADIUS);
    expect(Math.abs(game.p1.y)).toBeLessThanOrEqual(ARENA_HALF - BEETLE_RADIUS);
    expect(Math.abs(game.p2.y)).toBeLessThanOrEqual(ARENA_HALF - BEETLE_RADIUS);
  });

  it('does nothing at all when nothing overlaps', () => {
    const game = live();
    placeBall(game, 0, 0);
    game.p1.x = 300;
    game.p2.x = -300;
    const before = snapshot(game);
    separate(game);
    expect(snapshot(game)).toBe(before);
  });
});

describe('being flipped', () => {
  it('flips a beetle a ladybug touches', () => {
    const game = live();
    game.p1.x = 0;
    game.p1.y = 0;
    game.bugs[0]!.x = BEETLE_BUG_TOUCH - 1;
    game.bugs[0]!.y = 0;
    flipCaught(game, STEP);
    expect(game.p1.stun).toBe(stepsFor(STUN_SECONDS, STEP));
  });

  it('leaves a beetle a hair outside the ring alone', () => {
    const game = live();
    game.p1.x = 0;
    game.p1.y = 0;
    game.bugs[0]!.x = BEETLE_BUG_TOUCH;
    game.bugs[0]!.y = 0;
    flipCaught(game, STEP);
    expect(game.p1.stun).toBe(0);
  });

  it('skids it away from the bug that caught it', () => {
    const game = live();
    game.p1.x = 0;
    game.p1.y = 0;
    game.bugs[0]!.x = 10;
    game.bugs[0]!.y = 0;
    flipCaught(game, STEP);
    expect(game.p1.kx).toBeCloseTo(-KNOCKBACK_SPEED, 9);
  });

  it('cannot flip a beetle that is already down', () => {
    const game = live();
    game.p1.x = 0;
    game.p1.y = 0;
    game.p1.stun = 4;
    game.bugs[0]!.x = 0;
    game.bugs[0]!.y = 0;
    flipCaught(game, STEP);
    expect(game.p1.stun).toBe(4);
  });

  it('flips each beetle independently of the other', () => {
    const game = live();
    game.p1.x = 0;
    game.p1.y = 0;
    game.p2.x = 300;
    game.p2.y = 300;
    for (const bug of game.bugs) {
      bug.x = -350;
      bug.y = -350;
    }
    game.bugs[0]!.x = 0;
    game.bugs[0]!.y = 0;
    flipCaught(game, STEP);
    expect(game.p1.stun).toBeGreaterThan(0);
    expect(game.p2.stun).toBe(0);
  });

  it('flips once even when two bugs are on it', () => {
    const game = live();
    game.p1.x = 0;
    game.p1.y = 0;
    game.bugs[0]!.x = 5;
    game.bugs[0]!.y = 0;
    game.bugs[1]!.x = -5;
    game.bugs[1]!.y = 0;
    flipCaught(game, STEP);
    expect(game.p1.stun).toBe(stepsFor(STUN_SECONDS, STEP));
  });

  it('lasts the same number of seconds at any step rate', () => {
    const sixty = live();
    const oneTwenty = live();
    for (const game of [sixty, oneTwenty]) {
      game.p1.x = 0;
      game.p1.y = 0;
      game.bugs[0]!.x = 0;
      game.bugs[0]!.y = 0;
    }
    flipCaught(sixty, 1 / 60);
    flipCaught(oneTwenty, 1 / 120);
    expect(sixty.p1.stun / 60).toBeCloseTo(oneTwenty.p1.stun / 120, 9);
    expect(sixty.p1.stun / 60).toBeCloseTo(STUN_SECONDS, 9);
  });
});

describe('delivering the ball', () => {
  it('is a delivery once the ball is inside a base', () => {
    expect(deliveryIn(ball(0, ARENA_HALF - BALL_RADIUS))).toBe('p1');
    expect(deliveryIn(ball(0, -(ARENA_HALF - BALL_RADIUS)))).toBe('p2');
  });

  it('is not a delivery in the middle of the pit', () => {
    expect(deliveryIn(ball(0, 0))).toBeNull();
  });

  it('counts a ball exactly on the ring: one rule, no epsilon', () => {
    expect(deliveryIn(ball(0, ARENA_HALF - BASE_RADIUS))).toBe('p1');
    expect(deliveryIn(ball(0, ARENA_HALF - BASE_RADIUS - 1e-9))).toBeNull();
  });

  it('reads the same distance from either end', () => {
    for (let x = -300; x <= 300; x += 25) {
      for (let y = -390; y <= 390; y += 25) {
        const near = deliveryIn(ball(x, y));
        const far = deliveryIn(ball(-x, -y));
        expect(far).toBe(near === null ? null : otherOf(near));
      }
    }
  });

  it('has a window the ball can be shoved into from the middle', () => {
    const rolling = ball(0, 0, 0, MAX_BALL_SPEED);
    let delivered: SeatId | null = null;
    for (let i = 0; i < 600 && delivered === null; i += 1) {
      stepBall(rolling, STEP);
      delivered = deliveryIn(rolling);
    }
    expect(delivered).toBe('p1');
  });

  it('never claims both bases at once', () => {
    // The two are 800 apart and 150 across; nothing can be in both.
    expect(ARENA_HALF * 2).toBeGreaterThan(BASE_RADIUS * 2);
  });
});

describe('a step of the match', () => {
  it('holds still through the opening pause and then plays', () => {
    const game = fresh(3);
    expect(game.phase).toBe('kickoff');
    const opening = stepsFor(KICKOFF_SECONDS, STEP);
    for (let i = 0; i < opening; i += 1) {
      expect(game.phase).toBe('kickoff');
      expect(game.p1.y).toBe(START_OFFSET);
      step(game, STEP, 0, -1, 0, 1);
    }
    expect(game.phase).toBe('live');
  });

  it('lets the ladybugs keep hunting through the pause', () => {
    const game = fresh(3);
    const before = `${game.bugs[0]!.x},${game.bugs[0]!.y}`;
    step(game, STEP, 0, 0, 0, 0);
    expect(`${game.bugs[0]!.x},${game.bugs[0]!.y}`).not.toBe(before);
  });

  it('cannot flip a beetle standing on its mark during a pause', () => {
    const game = fresh(3);
    game.bugs[0]!.x = game.p1.x;
    game.bugs[0]!.y = game.p1.y;
    step(game, STEP, 0, 0, 0, 0);
    expect(game.p1.stun).toBe(0);
  });

  it('runs the clock down in every phase, pauses included', () => {
    const game = fresh(3);
    const opening = game.clock;
    step(game, STEP, 0, 0, 0, 0);
    expect(game.clock).toBeCloseTo(opening - STEP, 12);
    expect(game.phase).toBe('kickoff');
  });

  it('moves both beetles from one call', () => {
    const game = live(4);
    const p1 = game.p1.x;
    const p2 = game.p2.x;
    step(game, STEP, 1, 0, -1, 0);
    expect(game.p1.x).toBeGreaterThan(p1);
    expect(game.p2.x).toBeLessThan(p2);
  });

  it('scores a delivery, and leaves the ball in the base to be seen', () => {
    const game = live(5);
    placeBall(game, 0, ARENA_HALF - BALL_RADIUS);
    step(game, STEP, 0, 0, 0, 0);
    expect(game.score.p1).toBe(1);
    expect(game.phase).toBe('celebrate');
    expect(game.ball.y).toBeGreaterThan(ARENA_HALF - BASE_RADIUS);
    expect(game.scorer).toBe('p1');
  });

  it('stops the ball dead when it is delivered', () => {
    const game = live(5);
    placeBall(game, 0, ARENA_HALF - BALL_RADIUS, 0, 300);
    step(game, STEP, 0, 0, 0, 0);
    expect(game.ball.vx).toBe(0);
    expect(game.ball.vy).toBe(0);
  });

  it('scores it once, not once a step', () => {
    const game = live(5);
    placeBall(game, 0, ARENA_HALF - BALL_RADIUS);
    for (let i = 0; i < 30; i += 1) step(game, STEP, 0, 0, 0, 0);
    expect(game.score.p1).toBe(1);
  });

  it('puts everything back on its mark after the celebration', () => {
    const game = live(5);
    placeBall(game, 0, ARENA_HALF - BALL_RADIUS);
    const total = stepsFor(CELEBRATE_SECONDS, STEP) + stepsFor(HOLD_SECONDS, STEP) + 2;
    for (let i = 0; i < total; i += 1) step(game, STEP, 0, 0, 0, 0);
    expect(game.ball.x).toBe(0);
    expect(game.ball.y).toBe(0);
    expect(game.p1.y).toBe(START_OFFSET);
    expect(game.p2.y).toBe(-START_OFFSET);
    expect(game.phase).toBe('live');
  });

  it('rights a flipped beetle at the kick-off', () => {
    const game = live(5);
    game.p1.stun = 99;
    placeBall(game, 0, ARENA_HALF - BALL_RADIUS);
    const total = stepsFor(CELEBRATE_SECONDS, STEP) + stepsFor(HOLD_SECONDS, STEP) + 2;
    for (let i = 0; i < total; i += 1) step(game, STEP, 0, 0, 0, 0);
    expect(game.p1.stun).toBe(0);
  });

  it('pays the seat whose base the ball reached, not the one that shoved it', () => {
    // An own goal is a real way to lose a point, and the rule says nothing about who pushed.
    const game = live(6);
    placeBall(game, 0, -(ARENA_HALF - BALL_RADIUS));
    step(game, STEP, 0, 0, 0, 0);
    expect(game.score.p2).toBe(1);
    expect(game.score.p1).toBe(0);
  });

  it('ends the match on the target, through the shared helper', () => {
    const game = live(7);
    for (let i = 0; i < TARGET_DELIVERIES; i += 1) {
      placeBall(game, 0, ARENA_HALF - BALL_RADIUS);
      step(game, STEP, 0, 0, 0, 0);
      if (game.winner !== null) break;
      const total = stepsFor(CELEBRATE_SECONDS, STEP) + stepsFor(HOLD_SECONDS, STEP) + 2;
      for (let j = 0; j < total; j += 1) step(game, STEP, 0, 0, 0, 0);
    }
    expect(game.score.p1).toBe(TARGET_DELIVERIES);
    expect(winnerOf(game)).toBe('p1');
    expect(game.phase).toBe('over');
  });

  it('leaves a decided match exactly as it fell', () => {
    const game = live(7);
    game.score.p1 = TARGET_DELIVERIES - 1;
    placeBall(game, 0, ARENA_HALF - BALL_RADIUS);
    step(game, STEP, 0, 0, 0, 0);
    expect(winnerOf(game)).toBe('p1');
    const frozen = snapshot(game);
    for (let i = 0; i < 120; i += 1) step(game, STEP, 1, 1, -1, -1);
    expect(snapshot(game)).toBe(frozen);
  });

  it('does not tidy the ball away when the whistle goes during a celebration', () => {
    const game = live(9);
    placeBall(game, 0, ARENA_HALF - BALL_RADIUS);
    step(game, STEP, 0, 0, 0, 0);
    expect(game.phase).toBe('celebrate');
    game.clock = STEP;
    for (let i = 0; i < stepsFor(CELEBRATE_SECONDS, STEP) + 2; i += 1) {
      step(game, STEP, 0, 0, 0, 0);
    }
    expect(game.winner).not.toBeNull();
    expect(deliveryIn(game.ball)).toBe('p1');
  });

  it('settles a level match on the clock as a draw', () => {
    const game = live(8);
    game.clock = STEP;
    step(game, STEP, 0, 0, 0, 0);
    expect(game.clock).toBe(0);
    expect(winnerOf(game)).toBe('draw');
  });

  it('gives the clock to whoever is ahead when it expires', () => {
    const game = live(8);
    game.score.p2 = 1;
    game.clock = STEP;
    step(game, STEP, 0, 0, 0, 0);
    expect(winnerOf(game)).toBe('p2');
  });

  it('never lets the clock go negative', () => {
    const game = live(8);
    game.clock = STEP / 4;
    step(game, STEP, 0, 0, 0, 0);
    expect(game.clock).toBe(0);
  });

  it('is the same match from the same seed, step for step', () => {
    const a = fresh(21);
    const b = fresh(21);
    const rng = new Rng(99);
    for (let i = 0; i < 900; i += 1) {
      const ax = rng.float() * 2 - 1;
      const ay = rng.float() * 2 - 1;
      const bx = rng.float() * 2 - 1;
      const by = rng.float() * 2 - 1;
      step(a, STEP, ax, ay, bx, by);
      step(b, STEP, ax, ay, bx, by);
      expect(snapshot(a)).toBe(snapshot(b));
    }
  });

  it('is a different match from a different seed', () => {
    const a = fresh(21);
    const b = fresh(22);
    for (let i = 0; i < 300; i += 1) {
      step(a, STEP, 1, -1, -1, 1);
      step(b, STEP, 1, -1, -1, 1);
    }
    expect(snapshot(a)).not.toBe(snapshot(b));
  });
});

describe('the pit is the same from either end, to the bit', () => {
  /** The half-turn: every position and velocity negated, and the two seats exchanged. */
  function mirrored(source: Readonly<Game>): Game {
    const copy = createGame(new Rng(1));
    const flip = (from: Readonly<Beetle>, to: Beetle): void => {
      to.x = -from.x;
      to.y = -from.y;
      to.vx = -from.vx;
      to.vy = -from.vy;
      to.kx = -from.kx;
      to.ky = -from.ky;
      to.stun = from.stun;
      to.faceX = -from.faceX;
      to.faceY = -from.faceY;
    };
    flip(source.p1, copy.p2);
    flip(source.p2, copy.p1);
    copy.ball.x = -source.ball.x;
    copy.ball.y = -source.ball.y;
    copy.ball.vx = -source.ball.vx;
    copy.ball.vy = -source.ball.vy;
    for (let i = 0; i < source.bugs.length; i += 1) {
      const from = source.bugs[i]!;
      const to = copy.bugs[i]!;
      to.x = -from.x;
      to.y = -from.y;
      to.hx = -from.hx;
      to.hy = -from.hy;
    }
    copy.score.p1 = source.score.p2;
    copy.score.p2 = source.score.p1;
    copy.phase = source.phase;
    copy.clock = source.clock;
    copy.hold = source.hold;
    copy.pending = source.pending;
    copy.scorer = source.scorer === null ? null : otherOf(source.scorer);
    copy.winner = source.winner === 'p1' ? 'p2' : source.winner === 'p2' ? 'p1' : source.winner;
    return copy;
  }

  it('reflects a scripted match exactly, positions and velocities alike', () => {
    const upright = fresh(77);
    const upside = mirrored(upright);
    const rng = new Rng(31);
    for (let i = 0; i < 2400; i += 1) {
      const ax = rng.float() * 2 - 1;
      const ay = rng.float() * 2 - 1;
      const bx = rng.float() * 2 - 1;
      const by = rng.float() * 2 - 1;
      step(upright, STEP, ax, ay, bx, by);
      step(upside, STEP, -bx, -by, -ax, -ay);
      // `===` rather than Object.is: a mirror does flip the sign of a zero, and +0 and -0
      // are the same number. Everything else is compared to the last bit.
      expect(upside.ball.x === -upright.ball.x).toBe(true);
      expect(upside.ball.y === -upright.ball.y).toBe(true);
      expect(upside.ball.vx === -upright.ball.vx).toBe(true);
      expect(upside.ball.vy === -upright.ball.vy).toBe(true);
      expect(upside.p2.x === -upright.p1.x).toBe(true);
      expect(upside.p2.y === -upright.p1.y).toBe(true);
      expect(upside.p1.x === -upright.p2.x).toBe(true);
      expect(upside.p1.y === -upright.p2.y).toBe(true);
    }
  });

  it('reflects the ladybugs too', () => {
    const upright = fresh(78);
    const upside = mirrored(upright);
    for (let i = 0; i < 900; i += 1) {
      step(upright, STEP, 1, 0, 0, 1);
      step(upside, STEP, 0, -1, -1, 0);
      for (let b = 0; b < upright.bugs.length; b += 1) {
        expect(upside.bugs[b]!.x === -upright.bugs[b]!.x).toBe(true);
        expect(upside.bugs[b]!.y === -upright.bugs[b]!.y).toBe(true);
        expect(upside.bugs[b]!.hx === -upright.bugs[b]!.hx).toBe(true);
        expect(upside.bugs[b]!.hy === -upright.bugs[b]!.hy).toBe(true);
      }
    }
  });

  it('reflects the score and the winner through a whole decided match', () => {
    const upright = fresh(1234);
    const upside = mirrored(upright);
    const aim = vec2();
    for (let i = 0; i < 60 * 90 && upright.winner === null; i += 1) {
      // One seat shepherding the ball home against an idle opponent, so deliveries really
      // happen. The script is read off the UPRIGHT pit and handed to the mirror negated,
      // rather than each pit steering itself — which would prove nothing.
      shepherd(upright, 'p1', aim);
      step(upright, STEP, aim.x, aim.y, 0, 0);
      step(upside, STEP, 0, 0, -aim.x, -aim.y);
      expect(upside.score.p2).toBe(upright.score.p1);
      expect(upside.score.p1).toBe(upright.score.p2);
    }
    expect(upright.winner).not.toBeNull();
    expect(upright.score.p1 + upright.score.p2).toBeGreaterThan(0);
    expect(upside.winner).toBe(
      upright.winner === 'p1' ? 'p2' : upright.winner === 'p2' ? 'p1' : upright.winner,
    );
  });
});

/**
 * A hand-written player: get behind the ball, then shove it home. The same two jobs the bot
 * does, written out plainly so a test can drive a match to a real delivery without a bot.
 */
function shepherd(game: Readonly<Game>, seat: SeatId, out: Vec2): void {
  const self = beetleOf(game, seat);
  const baseY = baseYOf(seat);
  let outX = game.ball.x;
  let outY = game.ball.y - baseY;
  const outLength = Math.hypot(outX, outY) || 1;
  outX /= outLength;
  outY /= outLength;
  const sideX = self.x - game.ball.x;
  const sideY = self.y - game.ball.y;
  const sideLength = Math.hypot(sideX, sideY) || 1;
  const lined = (sideX / sideLength) * outX + (sideY / sideLength) * outY >= 0.6;
  const targetX = lined ? game.ball.x - outX * 45 : game.ball.x + outX * 81;
  const targetY = lined ? game.ball.y - outY * 45 : game.ball.y + outY * 81;
  const aimX = targetX - self.x;
  const aimY = targetY - self.y;
  const aimLength = Math.hypot(aimX, aimY) || 1;
  out.x = aimX / aimLength;
  out.y = aimY / aimLength;
}

describe('termination', () => {
  /** The arithmetic, written out: nothing in the rules can add a step to this. */
  const CEILING = MATCH_SECONDS * 60 + 1;

  it('cannot outlast the clock, and the clock is not extended by anything', () => {
    expect(CEILING).toBeLessThan(60 * 600); // the guard suite's ten-minute ceiling
    expect(CEILING).toBe(3601);
  });

  it('ends a match nobody plays, as a draw', () => {
    const game = fresh(7);
    let steps = 0;
    for (; steps < CEILING + 60 && game.winner === null; steps += 1) {
      step(game, STEP, 0, 0, 0, 0);
    }
    expect(game.winner).toBe('draw');
    expect(steps).toBeLessThanOrEqual(CEILING);
  });

  it('ends a match of two bots, from many seeds', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const played = playBots(seed * 101, tier, tier);
        expect(played.steps).toBeLessThanOrEqual(CEILING);
        expect(played.winner).not.toBeNull();
      }
    }
  });

  it('ends a match where both seats shove the ball at the same wall', () => {
    const game = fresh(11);
    let steps = 0;
    for (; steps < CEILING + 60 && game.winner === null; steps += 1) {
      step(game, STEP, 1, 1, 1, 1);
    }
    expect(game.winner).not.toBeNull();
    expect(steps).toBeLessThanOrEqual(CEILING);
  });

  it('ends a match where both seats hide in opposite corners', () => {
    const game = fresh(12);
    let steps = 0;
    for (; steps < CEILING + 60 && game.winner === null; steps += 1) {
      step(game, STEP, -1, -1, 1, 1);
    }
    expect(game.winner).not.toBeNull();
    expect(steps).toBeLessThanOrEqual(CEILING);
  });
});

/** One bot match, driven exactly as `DungBattleGame` drives it. */
function playBots(
  seed: number,
  p1: BotDifficulty | BotProfile | null,
  p2: BotDifficulty | BotProfile | null,
): {
  winner: SeatId | 'draw' | null;
  steps: number;
  deliveries: { p1: number; p2: number };
  score: { p1: number; p2: number };
} {
  const source = new Rng(seed);
  const game = createGame(new Rng(source.next() | 0));
  const rng: Record<SeatId, Rng> = {
    p1: new Rng(source.next() | 0),
    p2: new Rng(source.next() | 0),
  };
  const profiles: Record<SeatId, BotProfile | null> = {
    p1: typeof p1 === 'string' ? BOT_PROFILES[p1] : p1,
    p2: typeof p2 === 'string' ? BOT_PROFILES[p2] : p2,
  };
  const state = { p1: createBotState(), p2: createBotState() };
  const drive: Record<SeatId, Vec2> = { p1: vec2(), p2: vec2() };
  const deliveries = { p1: 0, p2: 0 };
  let seen: SeatId | null = null;
  let steps = 0;
  for (; steps < MATCH_SECONDS * 60 + 1 && game.winner === null; steps += 1) {
    for (const seat of ['p1', 'p2'] as const) {
      const profile = profiles[seat];
      if (profile === null) {
        drive[seat].x = 0;
        drive[seat].y = 0;
      } else {
        botInput(drive[seat], game, seat, profile, state[seat], rng[seat], STEP);
      }
    }
    step(game, STEP, drive.p1.x, drive.p1.y, drive.p2.x, drive.p2.y);
    // Reconstructed from the ball's own position rather than from the game's counter: a
    // counter can be wrong in exactly the way the rule it counts is wrong.
    const inside = deliveryIn(game.ball);
    if (inside !== null && seen === null) deliveries[inside] += 1;
    seen = inside;
  }
  return {
    winner: game.winner,
    steps,
    deliveries,
    score: { p1: game.score.p1, p2: game.score.p2 },
  };
}

describe('the bot', () => {
  const out: Vec2 = vec2();

  it('offers three tiers', () => {
    expect(Object.keys(BOT_PROFILES).sort()).toEqual(['easy', 'hard', 'normal']);
  });

  it('orders every knob it has', () => {
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.wander).toBeGreaterThan(BOT_PROFILES.normal.wander);
    expect(BOT_PROFILES.normal.wander).toBeGreaterThan(BOT_PROFILES.hard.wander);
    expect(BOT_PROFILES.easy.behind).toBeLessThan(BOT_PROFILES.normal.behind);
    expect(BOT_PROFILES.normal.behind).toBeLessThan(BOT_PROFILES.hard.behind);
  });

  it('keeps every knob inside the range it means something over', () => {
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(profile.behind).toBeGreaterThan(0);
      expect(profile.behind).toBeLessThanOrEqual(1);
      expect(profile.reaction).toBeGreaterThan(0);
      expect(profile.wander).toBeGreaterThanOrEqual(0);
      expect(profile.wander).toBeLessThan(Math.PI);
    }
  });

  it('carries no knob it does not use', () => {
    // Caution and lead were both swept and both measured flat; see the note in rules.ts.
    expect(Object.keys(BOT_PROFILES.normal).sort()).toEqual(['behind', 'reaction', 'wander']);
  });

  it('returns a unit vector', () => {
    const game = live(31);
    const state = createBotState();
    const rng = new Rng(4);
    for (let i = 0; i < 400; i += 1) {
      botInput(out, game, 'p1', BOT_PROFILES.hard, state, rng, STEP);
      const length = Math.hypot(out.x, out.y);
      expect(length).toBeLessThanOrEqual(1 + 1e-9);
      if (length > 0) expect(length).toBeCloseTo(1, 9);
      step(game, STEP, out.x, out.y, 0, 0);
    }
  });

  it('draws exactly two values per decision, on every path', () => {
    for (const tier of TIERS) {
      const game = live(32);
      const state = createBotState();
      const counting = new Rng(8);
      let decisions = 0;
      for (let i = 0; i < 600; i += 1) {
        const before = state.cooldown;
        botInput(out, game, 'p1', BOT_PROFILES[tier], state, counting, STEP);
        if (state.cooldown > before) decisions += 1;
        step(game, STEP, out.x, out.y, 0, 0);
      }
      const spent = new Rng(8);
      for (let i = 0; i < decisions * BOT_DRAWS_PER_DECISION; i += 1) spent.float();
      expect(counting.save()).toEqual(spent.save());
      expect(decisions).toBeGreaterThan(3);
    }
  });

  it('holds its decision between decisions', () => {
    const game = live(33);
    const state = createBotState();
    const rng = new Rng(9);
    botInput(out, game, 'p1', BOT_PROFILES.easy, state, rng, STEP);
    const held = `${out.x},${out.y}`;
    // Easy re-decides three times a second, so the next step must reuse the same vector.
    botInput(out, game, 'p1', BOT_PROFILES.easy, state, rng, STEP);
    expect(`${out.x},${out.y}`).toBe(held);
  });

  it('re-decides more often the sharper the tier', () => {
    const counts: number[] = [];
    for (const tier of TIERS) {
      const game = live(34);
      const state = createBotState();
      const rng = new Rng(10);
      let decisions = 0;
      for (let i = 0; i < 600; i += 1) {
        const before = state.cooldown;
        botInput(out, game, 'p1', BOT_PROFILES[tier], state, rng, STEP);
        if (state.cooldown > before) decisions += 1;
        step(game, STEP, out.x, out.y, 0, 0);
      }
      counts.push(decisions);
    }
    expect(counts[0]!).toBeLessThan(counts[1]!);
    expect(counts[1]!).toBeLessThan(counts[2]!);
  });

  it('never writes to the pit it is reading', () => {
    const game = live(35);
    const state = createBotState();
    const before = snapshot(game);
    for (let i = 0; i < 50; i += 1) {
      botInput(out, game, 'p1', BOT_PROFILES.hard, state, new Rng(i), STEP);
    }
    expect(snapshot(game)).toBe(before);
  });

  it('walks round to the far side of the ball rather than shoving it away from home', () => {
    // p1's base is at +y. Standing between the ball and it, a shove would send the ball the
    // wrong way, so the sharp tier must not be driving straight at the ball.
    const game = live(36);
    placeBall(game, 0, 0);
    game.p1.x = 0;
    game.p1.y = 150;
    const state = createBotState();
    botInput(out, game, 'p1', BOT_PROFILES.hard, state, new Rng(3), STEP);
    expect(out.y).toBeGreaterThan(-0.9);
  });

  it('shoves straight home once it is behind the ball', () => {
    const game = live(37);
    placeBall(game, 0, 0);
    game.p1.x = 0;
    game.p1.y = -BEETLE_BALL_TOUCH;
    const state = createBotState();
    botInput(out, game, 'p1', BOT_PROFILES.hard, state, new Rng(3), STEP);
    expect(out.y).toBeGreaterThan(0.5);
  });

  it('gives a bug in its way a wide enough berth to be visible', () => {
    const clear = live(38);
    const blocked = live(38);
    for (const game of [clear, blocked]) {
      placeBall(game, 0, -200);
      game.p1.x = 0;
      game.p1.y = 0;
      for (const bug of game.bugs) {
        bug.x = 900;
        bug.y = 900;
      }
    }
    blocked.bugs[0]!.x = 0;
    blocked.bugs[0]!.y = -(BEETLE_BUG_TOUCH + AVOID_MARGIN / 2);
    blocked.bugs[0]!.hx = 0;
    blocked.bugs[0]!.hy = 0;
    const a = createBotState();
    const b = createBotState();
    const clearAim = vec2();
    botInput(clearAim, clear, 'p1', BOT_PROFILES.hard, a, new Rng(1), STEP);
    botInput(out, blocked, 'p1', BOT_PROFILES.hard, b, new Rng(1), STEP);
    expect(Math.abs(out.x)).toBeGreaterThan(Math.abs(clearAim.x));
  });

  it('is not pulled off its run by a bug behind it', () => {
    const game = live(39);
    placeBall(game, 0, -200);
    game.p1.x = 0;
    game.p1.y = 0;
    for (const bug of game.bugs) {
      bug.x = 900;
      bug.y = 900;
    }
    game.bugs[0]!.x = 0;
    game.bugs[0]!.y = BEETLE_BUG_TOUCH + 10;
    game.bugs[0]!.hx = 0;
    game.bugs[0]!.hy = 1;
    const state = createBotState();
    botInput(out, game, 'p1', BOT_PROFILES.hard, state, new Rng(1), STEP);
    expect(Math.abs(out.x)).toBeLessThan(0.5);
  });

  it('reads the alignment threshold from its own skill', () => {
    // The clumsy tier believes it is behind the ball from much further round than the
    // sharp one does, which is the same mistake expressed once.
    const clumsy = ALIGN_COS * BOT_PROFILES.easy.behind - (1 - BOT_PROFILES.easy.behind);
    const sharp = ALIGN_COS * BOT_PROFILES.hard.behind - (1 - BOT_PROFILES.hard.behind);
    expect(clumsy).toBeLessThan(sharp);
    expect(sharp).toBe(ALIGN_COS);
  });

  it('resets to nothing held', () => {
    const state = createBotState();
    state.cooldown = 5;
    state.aimX = 1;
    resetBotState(state);
    expect(state).toEqual({ cooldown: 0, aimX: 0, aimY: 0 });
  });
});

describe('the ladder, measured', () => {
  /**
   * Deliberately small — twelve seeds a cell, both seat orders — because this runs on every
   * commit. The numbers in SPEC.md come from 200 matches a cell across three independent
   * seed families; what is asserted here is the *order*, with enough margin that noise at
   * this sample cannot flip it.
   */
  function series(a: BotDifficulty, b: BotDifficulty, count = 12): number {
    let wins = 0;
    let decided = 0;
    for (let seed = 1; seed <= count; seed += 1) {
      for (const swapped of [false, true]) {
        const played = swapped ? playBots(seed * 101, b, a) : playBots(seed * 101, a, b);
        if (played.winner === null || played.winner === 'draw') continue;
        decided += 1;
        if ((played.winner === 'p1') !== swapped) wins += 1;
      }
    }
    return decided === 0 ? 0.5 : wins / decided;
  }

  it('has hard beating normal beating easy', () => {
    expect(series('hard', 'normal')).toBeGreaterThan(0.55);
    expect(series('normal', 'easy')).toBeGreaterThan(0.6);
    expect(series('hard', 'easy')).toBeGreaterThan(0.75);
  });

  it('is level when a tier meets itself', () => {
    const level = series('normal', 'normal');
    expect(level).toBeGreaterThan(0.3);
    expect(level).toBeLessThan(0.7);
  });
});

describe('the thing the game is about actually happens', () => {
  /**
   * The headline verb, counted from **sampled ball positions** rather than from the score.
   *
   * Spin War shipped with its core mechanic impossible and passed every global guard,
   * because a match still ended and still reported a winner. So this counts deliveries the
   * way an observer would: it watches the ball cross into a base. If the two ever disagree,
   * one of them is lying and the test says which.
   */
  it('delivers the ball several times a match, at every tier', () => {
    for (const tier of TIERS) {
      let total = 0;
      let empty = 0;
      for (let seed = 1; seed <= 20; seed += 1) {
        const played = playBots(seed * 101, tier, tier);
        const count = played.deliveries.p1 + played.deliveries.p2;
        total += count;
        if (count === 0) empty += 1;
        expect(count).toBe(played.score.p1 + played.score.p2);
      }
      expect(total / 20).toBeGreaterThan(2.5);
      expect(empty).toBeLessThan(3);
    }
  });

  it('delivers at both ends', () => {
    let toP1 = 0;
    let toP2 = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const played = playBots(seed * 101, 'normal', 'normal');
      toP1 += played.deliveries.p1;
      toP2 += played.deliveries.p2;
    }
    expect(toP1).toBeGreaterThan(5);
    expect(toP2).toBeGreaterThan(5);
  });

  it('needs a player: nobody delivers anything by accident', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const played = playBots(seed * 101, null, null);
      expect(played.deliveries.p1 + played.deliveries.p2).toBe(0);
      expect(played.winner).toBe('draw');
    }
  });

  it('is a mechanic a lone bot can perform against nobody', () => {
    // A delivery cannot depend on the opponent making a mistake.
    let total = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      total += playBots(seed * 101, 'hard', null).deliveries.p1;
    }
    expect(total).toBeGreaterThanOrEqual(8 * TARGET_DELIVERIES);
  });
});

describe('helpers', () => {
  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('hands back the right beetle and the right score', () => {
    const game = live(40);
    game.score.p2 = 2;
    expect(beetleOf(game, 'p1')).toBe(game.p1);
    expect(beetleOf(game, 'p2')).toBe(game.p2);
    expect(scoreOf(game, 'p2')).toBe(2);
    expect(scoreOf(game, 'p1')).toBe(0);
  });

  it('resets a played match back to a fresh one', () => {
    const game = live(41);
    for (let i = 0; i < 600; i += 1) step(game, STEP, 1, 0, -1, 0);
    game.score.p1 = 2;
    resetGame(game, new Rng(41));
    expect(game.score.p1).toBe(0);
    expect(game.clock).toBe(MATCH_SECONDS);
    expect(game.winner).toBeNull();
    expect(game.ball.x).toBe(0);
    expect(game.phase).toBe('kickoff');
  });

  it('sizes a pause only when a step tells it how long a step is', () => {
    const game = fresh(42);
    kickOff(game, 0.5);
    expect(game.pending).toBe(0.5);
    expect(game.hold).toBe(0);
    step(game, 1 / 120, 0, 0, 0, 0);
    expect(game.pending).toBe(0);
    expect(game.hold).toBe(stepsFor(0.5, 1 / 120) - 1);
  });

  it('pauses for the same number of seconds at any rate', () => {
    const sixty = fresh(43);
    const oneTwenty = fresh(43);
    kickOff(sixty, 0.5);
    kickOff(oneTwenty, 0.5);
    let a = 0;
    while (sixty.phase === 'kickoff') {
      step(sixty, 1 / 60, 0, 0, 0, 0);
      a += 1;
    }
    let b = 0;
    while (oneTwenty.phase === 'kickoff') {
      step(oneTwenty, 1 / 120, 0, 0, 0, 0);
      b += 1;
    }
    expect(a / 60).toBeCloseTo(b / 120, 9);
  });
});
