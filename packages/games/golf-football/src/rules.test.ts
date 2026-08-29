import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  AIM_DEADLINE,
  AIM_RATE,
  AIM_SAMPLES,
  AIM_SWEEP,
  APRON_RADIUS,
  BALL_RADIUS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_DRAWS_PER_KICK,
  BOT_PROFILES,
  CAPTURE_OVERRUN,
  CAPTURE_SPEED,
  CENTRE_X,
  CENTRE_Y,
  CUP_RADIUS,
  GATE_HALF,
  KICKS_EACH,
  KICK_MAX_SPEED,
  MAX_ROLL_SECONDS,
  MID_GOAL,
  MIN_REACH,
  PITCH_BOTTOM,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  POSTS,
  POST_RADIUS,
  POWER_RATE,
  POWER_RISE,
  RANGE_GOAL,
  RANGE_RADIUS,
  READY_SECONDS,
  SETTLE_BOUND_SECONDS,
  SETTLE_SECONDS,
  TAP_GOAL,
  TURF_FRICTION,
  WIND_DEADLINE,
  aimSampleAt,
  ballOf,
  createBotRngs,
  createBotState,
  createMatch,
  cupCaptures,
  distanceToCup,
  driveBot,
  goalValueOf,
  kicksLeftOf,
  otherOf,
  planKick,
  powerForReach,
  pressAim,
  reachOf,
  release,
  resetMatch,
  settleMatch,
  speedForReach,
  spotXOf,
  spotYOf,
  step,
  winnerOf,
} from './rules.js';
import type { Ball, BotProfile, Match } from './rules.js';

const STEP = 1 / 60;
/** The shell's seat flip, which the ready freeze has to outlast. */
const SHELL_FLIP_SECONDS = 0.36;

/* ------------------------------------------------------------------ helpers */

/** A match with both balls parked exactly where the caller wants them. */
function pitch(
  seat: SeatId,
  own: readonly [number, number],
  rival: readonly [number, number],
): Match {
  const match = createMatch();
  resetMatch(match, seat);
  place(ballOf(match, seat), own);
  place(ballOf(match, otherOf(seat)), rival);
  // `beginKick` reads the lie, so the aim base and the goal values follow the placement.
  match.aimBase = Math.atan2(CENTRE_Y - own[1], CENTRE_X - own[0]);
  match.p1.startDistance = distanceToCup(match.p1.x, match.p1.y);
  match.p2.startDistance = distanceToCup(match.p2.x, match.p2.y);
  return match;
}

function place(ball: Ball, at: readonly [number, number]): void {
  ball.x = at[0];
  ball.y = at[1];
  ball.vx = 0;
  ball.vy = 0;
  ball.holed = false;
}

/** Kick the active seat's ball along an absolute bearing with a given gauge reading. */
function kickAt(match: Match, angle: number, power: number): void {
  match.phase = 'winding';
  match.aimBase = angle;
  match.lockedAim = 0;
  match.power = power;
  const fired = release(match, match.seat);
  expect(fired).toBe(true);
}

/** Step until the roll settles. Returns the seconds it took. */
function settle(match: Match, rate = STEP, cap = 60 * 30): number {
  for (let i = 0; i < cap; i += 1) {
    if (match.phase !== 'rolling') return i * rate;
    step(match, rate);
  }
  throw new Error('the turf never settled');
}

/** Run a whole bot-versus-bot match and hand back the finished state. */
function playMatch(
  seed: number,
  opener: SeatId,
  p1: BotProfile,
  p2: BotProfile,
  cap = 60 * 600,
): { match: Match; steps: number } {
  const match = createMatch();
  resetMatch(match, opener);
  const rngs = createBotRngs(new Rng(seed));
  const state = { p1: createBotState(), p2: createBotState() };
  for (let i = 0; i < cap; i += 1) {
    const seat = match.seat;
    driveBot(match, seat, seat === 'p1' ? p1 : p2, state[seat], rngs[seat], STEP);
    step(match, STEP);
    if (match.winner !== null) return { match, steps: i + 1 };
  }
  return { match, steps: -1 };
}

/* ------------------------------------------------------------------ the pitch */

describe('the pitch', () => {
  it('is centred on the centre of the logical box, which is what the half-turn turns about', () => {
    // `Renderer.pushRotation` turns about the middle of the declared box. A pitch centred
    // anywhere else would sit differently on the screen for the two seats — rule 9.
    expect(PITCH_LEFT + PITCH_RIGHT).toBe(BOARD_WIDTH);
    expect(PITCH_TOP + PITCH_BOTTOM).toBe(BOARD_HEIGHT);
    expect(CENTRE_X).toBe(BOARD_WIDTH / 2);
    expect(CENTRE_Y).toBe(BOARD_HEIGHT / 2);
  });

  it('puts the two posts and the two spots at exact half-turns of each other', () => {
    const [left, right] = POSTS;
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(2 * CENTRE_X - left!.x).toBe(right!.x);
    expect(2 * CENTRE_Y - left!.y).toBe(right!.y);
    // Exact, not close: these are the numbers the mirror argument rests on.
    expect(2 * CENTRE_X - spotXOf('p1')).toBe(spotXOf('p2'));
    expect(2 * CENTRE_Y - spotYOf('p1')).toBe(spotYOf('p2'));
  });

  it('leaves a gate a ball fits through, with the cup most of the way across it', () => {
    const half = GATE_HALF - POST_RADIUS - BALL_RADIUS;
    expect(half).toBeGreaterThan(CUP_RADIUS);
    // The window that threads the gate and misses the cup, either side. Small on purpose:
    // getting through the posts is very nearly scoring.
    expect(half - CUP_RADIUS).toBeLessThan(CUP_RADIUS / 2);
    expect(POSTS.every((post) => distanceToCup(post.x, post.y) > CUP_RADIUS + POST_RADIUS)).toBe(
      true,
    );
  });

  it('starts both seats the same distance out, and outside the range ring', () => {
    const p1 = distanceToCup(spotXOf('p1'), spotYOf('p1'));
    const p2 = distanceToCup(spotXOf('p2'), spotYOf('p2'));
    expect(p1).toBeCloseTo(p2, 12);
    // A ball put back on its spot is worth the full three, so a tap-in cannot be farmed.
    expect(p1).toBeGreaterThan(RANGE_RADIUS);
  });

  it('cannot be tunnelled through: a post is far thicker than one step of travel', () => {
    const perStep = KICK_MAX_SPEED / 60;
    expect(perStep).toBeLessThan(2 * POST_RADIUS + 2 * BALL_RADIUS);
    // And with three times the margin, so a faster kick could not quietly introduce one.
    expect(perStep * 3).toBeLessThan(2 * POST_RADIUS + 2 * BALL_RADIUS);
  });
});

/* ------------------------------------------------------------------ the turf */

describe('the turf', () => {
  it('rolls exactly the distance the gauge promises', () => {
    // The line at y = 250 crosses no post and reaches no board, so this is a clean roll.
    for (const wanted of [60, 120, 250, 380, 500, 590]) {
      const match = pitch('p1', [55, 250], [PITCH_LEFT + 20, PITCH_BOTTOM - 20]);
      kickAt(match, 0, powerForReach(wanted));
      settle(match);
      expect(match.p1.x - 55, `asked for ${String(wanted)} units`).toBeCloseTo(wanted, 9);
    }
  });

  it('stops in the same place at 60, 90, 120 and 240 Hz', () => {
    // Rule 8, and the whole of issue #2465. The travel over a step is the exact integral of
    // a constant deceleration rather than `v · dt`, so the total roll does not drift with
    // the step size — and the bot's `powerForReach` is the exact inverse of that same law.
    const cases: readonly (readonly [number, number, number, number])[] = [
      [0, powerForReach(300), 60, 700],
      [-Math.PI / 2, powerForReach(520), 350, 840],
      [0.62, powerForReach(440), 100, 200],
      [-2.4, powerForReach(560), 620, 840],
    ];
    for (const [angle, power, x0, y0] of cases) {
      const where = (rate: number): readonly [number, number] => {
        const match = pitch('p1', [x0, y0], [PITCH_LEFT + 20, PITCH_TOP + 20]);
        kickAt(match, angle, power);
        settle(match, rate, 60 * 60);
        return [match.p1.x, match.p1.y];
      };
      const base = where(1 / 60);
      for (const rate of [1 / 90, 1 / 120, 1 / 240]) {
        const other = where(rate);
        expect(other[0], `x at ${String(Math.round(1 / rate))} Hz`).toBeCloseTo(base[0], 9);
        expect(other[1], `y at ${String(Math.round(1 / rate))} Hz`).toBeCloseTo(base[1], 9);
      }
    }
  });

  it('makes reachOf and powerForReach exact inverses inside the gauge', () => {
    for (let power = 0; power <= 1; power += 1 / 64) {
      expect(powerForReach(reachOf(power))).toBeCloseTo(power, 12);
    }
    expect(reachOf(0)).toBe(MIN_REACH);
    expect(speedForReach(0)).toBe(0);
    // Struck at the speed that rolls `d`, it has exactly `d` of turf in it.
    for (const d of [40, 300, 880]) {
      expect((speedForReach(d) * speedForReach(d)) / (2 * TURF_FRICTION)).toBeCloseTo(d, 9);
    }
  });

  it('settles inside the bound the friction model promises, however it is struck', () => {
    const rng = new Rng(31337);
    let worst = 0;
    for (let i = 0; i < 300; i += 1) {
      const match = pitch(
        'p1',
        [PITCH_LEFT + 20 + rng.float() * 580, PITCH_TOP + 20 + rng.float() * 700],
        [PITCH_LEFT + 20 + rng.float() * 580, PITCH_TOP + 20 + rng.float() * 700],
      );
      kickAt(match, rng.float() * Math.PI * 2, 1);
      worst = Math.max(worst, settle(match));
    }
    expect(worst).toBeLessThanOrEqual(SETTLE_BOUND_SECONDS + STEP);
    // The safety cap therefore never fires in play, which is the point of having it.
    expect(SETTLE_BOUND_SECONDS).toBeLessThan(MAX_ROLL_SECONDS);
  });

  it('never leaves the pitch, never rests inside a post and never rests on the cup', () => {
    const rng = new Rng(90210);
    for (let i = 0; i < 300; i += 1) {
      const match = pitch(
        'p1',
        [PITCH_LEFT + 20 + rng.float() * 580, PITCH_TOP + 20 + rng.float() * 700],
        [PITCH_LEFT + 20 + rng.float() * 580, PITCH_TOP + 20 + rng.float() * 700],
      );
      kickAt(match, rng.float() * Math.PI * 2, rng.float());
      settle(match);
      for (const ball of [match.p1, match.p2]) {
        if (ball.holed) continue;
        expect(ball.x).toBeGreaterThanOrEqual(PITCH_LEFT + BALL_RADIUS - 1e-6);
        expect(ball.x).toBeLessThanOrEqual(PITCH_RIGHT - BALL_RADIUS + 1e-6);
        expect(ball.y).toBeGreaterThanOrEqual(PITCH_TOP + BALL_RADIUS - 1e-6);
        expect(ball.y).toBeLessThanOrEqual(PITCH_BOTTOM - BALL_RADIUS + 1e-6);
        for (const post of POSTS) {
          const gap = Math.hypot(ball.x - post.x, ball.y - post.y);
          expect(gap).toBeGreaterThanOrEqual(BALL_RADIUS + POST_RADIUS - 1e-6);
        }
        // A ball at rest over the cup is captured, so nothing can park in the mouth.
        expect(distanceToCup(ball.x, ball.y)).toBeGreaterThan(CUP_RADIUS - 1e-6);
      }
    }
  });

  it('never lets a contact add energy, which is what bounds the settle', () => {
    const rng = new Rng(5150);
    for (let i = 0; i < 120; i += 1) {
      const match = pitch(
        'p1',
        [PITCH_LEFT + 40 + rng.float() * 540, PITCH_TOP + 40 + rng.float() * 660],
        [PITCH_LEFT + 40 + rng.float() * 540, PITCH_TOP + 40 + rng.float() * 660],
      );
      kickAt(match, rng.float() * Math.PI * 2, rng.float() * 0.9 + 0.1);
      let previous = Infinity;
      for (let s = 0; s < 60 * 6 && match.phase === 'rolling'; s += 1) {
        step(match, STEP);
        const energy =
          match.p1.vx * match.p1.vx +
          match.p1.vy * match.p1.vy +
          match.p2.vx * match.p2.vx +
          match.p2.vy * match.p2.vy;
        expect(energy).toBeLessThanOrEqual(previous + 1e-6);
        previous = energy;
      }
    }
  });
});

/* ------------------------------------------------------------------ the cup */

describe('the cup', () => {
  it('states its overrun as the exact turf a ball has left in it', () => {
    expect(CAPTURE_OVERRUN).toBeCloseTo((CAPTURE_SPEED * CAPTURE_SPEED) / (2 * TURF_FRICTION), 12);
    expect(speedForReach(CAPTURE_OVERRUN)).toBeCloseTo(CAPTURE_SPEED, 9);
  });

  it('takes a ball aimed to die inside the overrun and spits out one aimed past it', () => {
    const range = 300;
    const inside = pitch('p1', [CENTRE_X, CENTRE_Y + range], [PITCH_LEFT + 20, PITCH_TOP + 20]);
    kickAt(inside, -Math.PI / 2, powerForReach(range + CAPTURE_OVERRUN * 0.6));
    settle(inside);
    expect(inside.p1.holed, 'a kick that dies just past the cup drops').toBe(true);

    const past = pitch('p1', [CENTRE_X, CENTRE_Y + range], [PITCH_LEFT + 20, PITCH_TOP + 20]);
    kickAt(past, -Math.PI / 2, powerForReach(range + CAPTURE_OVERRUN * 1.6));
    settle(past);
    expect(past.p1.holed, 'a kick battered at the goal runs through').toBe(false);
  });

  it('takes a ball that stops over it however slowly it got there', () => {
    expect(cupCaptures(CENTRE_X + CUP_RADIUS - 1, CENTRE_Y, 0, 0)).toBe(true);
    expect(cupCaptures(CENTRE_X + CUP_RADIUS + 1, CENTRE_Y, 0, 0)).toBe(false);
    expect(cupCaptures(CENTRE_X, CENTRE_Y, CAPTURE_SPEED - 1, 0)).toBe(true);
    expect(cupCaptures(CENTRE_X, CENTRE_Y, CAPTURE_SPEED + 1, 0)).toBe(false);
  });
});

/* ------------------------------------------------------------------ the two dials */

describe('the ready freeze', () => {
  it('outlasts the shell seat flip, which is the whole reason it is in the rules', () => {
    // The shell turns the pitch to face whoever is kicking and refuses a person's input for
    // 0.36 s. A bot does not go through the shell, so without this it would get all of it.
    expect(READY_SECONDS).toBeGreaterThan(SHELL_FLIP_SECONDS);
    // And the margin is worth something: in the flip alone the needle would cover this
    // much of its gauge, which is what the bot would be given for nothing.
    const covered = (SHELL_FLIP_SECONDS * AIM_RATE) / (2 * AIM_SWEEP);
    expect(covered).toBeGreaterThan(0.25);
  });

  it('parks both dials, and refuses a press, until it lifts', () => {
    const match = createMatch();
    resetMatch(match, 'p1');
    expect(match.phase).toBe('ready');
    for (let i = 0; i < Math.floor(READY_SECONDS * 60); i += 1) {
      expect(pressAim(match, 'p1'), 'a press during the freeze does nothing').toBe(false);
      expect(match.aim).toBe(-AIM_SWEEP);
      step(match, STEP);
    }
    step(match, STEP);
    expect(match.phase).toBe('aiming');
  });

  it('parks the needle at an end of its sweep, never pointing at the cup', () => {
    const match = createMatch();
    resetMatch(match, 'p2');
    // Parked at zero the needle would already be on the cup the step the freeze lifted, and
    // an instant press would be a free perfect line.
    expect(match.aim).toBe(-AIM_SWEEP);
    expect(Math.abs(match.aim)).toBe(AIM_SWEEP);
  });
});

describe('the two dials', () => {
  it('gives a needle crossing more than the 1.2 s a timing gauge must run for', () => {
    // docs/input-idiom.md: a timing game's meter must have a period long enough that 30 ms
    // of device latency is under 3% of the window.
    const crossing = (2 * AIM_SWEEP) / AIM_RATE;
    expect(crossing).toBeGreaterThan(1.2);
    expect(0.03 / crossing).toBeLessThan(0.03);
  });

  it('puts a lattice finer than the cup under both dials', () => {
    // Cup Pong's lesson: a needle can only be stopped on a whole frame, so if the grid is
    // coarser than the target then whether a kick goes in is decided by where the lattice
    // happens to fall rather than by the press.
    const range = distanceToCup(spotXOf('p1'), spotYOf('p1'));
    const needleLattice = (AIM_RATE / 60) * range;
    expect((2 * CUP_RADIUS) / needleLattice).toBeGreaterThan(8);
    const gaugeLattice = POWER_RATE * (reachOf(1) - reachOf(0)) * STEP;
    expect((CUP_RADIUS + CAPTURE_OVERRUN) / gaugeLattice).toBeGreaterThan(7);
  });

  it('makes the two dials the same size of decision', () => {
    const range = distanceToCup(spotXOf('p1'), spotYOf('p1'));
    const needleSeconds = CUP_RADIUS / (AIM_RATE * range);
    const gaugeSeconds =
      (CUP_RADIUS + CAPTURE_OVERRUN) / 2 / (POWER_RATE * (reachOf(1) - reachOf(0)));
    // Within a factor of 1.5, so neither press is the one that decides everything.
    expect(
      Math.max(needleSeconds, gaugeSeconds) / Math.min(needleSeconds, gaugeSeconds),
    ).toBeLessThan(1.5);
  });

  it('sweeps the needle to both ends and turns it round', () => {
    const match = createMatch();
    resetMatch(match, 'p1');
    settleReady(match);
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < Math.ceil((4 * AIM_SWEEP) / AIM_RATE / STEP) + 4; i += 1) {
      step(match, STEP);
      low = Math.min(low, match.aim);
      high = Math.max(high, match.aim);
    }
    expect(low).toBeCloseTo(-AIM_SWEEP, 6);
    expect(high).toBeCloseTo(AIM_SWEEP, 6);
  });

  it('is a press, then a hold, then a release — and a same-step tap is the feeblest kick', () => {
    const match = createMatch();
    resetMatch(match, 'p1');
    settleReady(match);
    expect(release(match, 'p1'), 'a release before a press does nothing').toBe(false);
    expect(pressAim(match, 'p2'), 'the other seat cannot press').toBe(false);
    expect(pressAim(match, 'p1')).toBe(true);
    expect(match.phase).toBe('winding');
    expect(match.power).toBe(0);
    expect(pressAim(match, 'p1'), 'a second press does nothing').toBe(false);
    const from = { x: match.p1.x, y: match.p1.y };
    expect(release(match, 'p1')).toBe(true);
    settle(match);
    // A press and a release on the same step is an ordinary tap on most devices, and it is
    // a legal kick: the shortest one there is.
    expect(Math.hypot(match.p1.x - from.x, match.p1.y - from.y)).toBeCloseTo(MIN_REACH, 6);
  });

  it('fills the gauge at the rate it advertises', () => {
    const match = createMatch();
    resetMatch(match, 'p1');
    settleReady(match);
    pressAim(match, 'p1');
    for (let i = 0; i < Math.round(POWER_RISE / 2 / STEP); i += 1) step(match, STEP);
    expect(match.power).toBeCloseTo(0.5, 2);
    for (let i = 0; i < Math.round(POWER_RISE / STEP); i += 1) step(match, STEP);
    expect(match.power).toBe(1);
  });
});

function settleReady(match: Match): void {
  while (match.phase === 'ready') step(match, STEP);
}

/* ------------------------------------------------------------------ the turn machine */

describe('a turn', () => {
  it('kicks on its own if nobody ever presses, so a match moves with no input at all', () => {
    // `input-fuzz.test.ts` drives every game with a storm and no bots. Nothing but these
    // two deadlines forces either press.
    const match = createMatch();
    resetMatch(match, 'p1');
    let phases = 0;
    for (
      let i = 0;
      i < Math.ceil((READY_SECONDS + AIM_DEADLINE + WIND_DEADLINE + 1) / STEP);
      i += 1
    ) {
      const before = match.phase;
      step(match, STEP);
      if (match.phase !== before) phases += 1;
    }
    expect(match.kicks, 'the deadlines fired and the ball was kicked').toBe(1);
    expect(phases).toBeGreaterThanOrEqual(3);
  });

  it('finishes a whole match on the deadlines alone', () => {
    const match = createMatch();
    resetMatch(match, 'p2');
    let steps = 0;
    while (match.winner === null && steps < 60 * 600) {
      step(match, STEP);
      steps += 1;
    }
    expect(match.winner).not.toBeNull();
    expect(match.kicks).toBe(KICKS_EACH * 2);
  });

  it('opens with the seat the SDK names, not with p1', () => {
    for (const opener of ['p1', 'p2'] as const) {
      const match = createMatch();
      resetMatch(match, opener);
      expect(match.seat).toBe(opener);
    }
  });

  it('alternates strictly and gives both seats exactly the same number of kicks', () => {
    for (const opener of ['p1', 'p2'] as const) {
      const { match } = playMatch(4242, opener, BOT_PROFILES.normal, BOT_PROFILES.easy);
      expect(match.winner).not.toBeNull();
      expect(match.kicksBy.p1).toBe(KICKS_EACH);
      expect(match.kicksBy.p2).toBe(KICKS_EACH);
      expect(kicksLeftOf(match, 'p1')).toBe(0);
      expect(kicksLeftOf(match, 'p2')).toBe(0);
    }
  });

  it('holds the result on the pitch before it hands over', () => {
    const match = pitch('p1', [CENTRE_X, CENTRE_Y + 300], [PITCH_LEFT + 20, PITCH_TOP + 20]);
    kickAt(match, -Math.PI / 2, powerForReach(300 + CAPTURE_OVERRUN * 0.5));
    settle(match);
    expect(match.phase).toBe('settling');
    expect(match.seat).toBe('p1');
    for (let i = 0; i < Math.ceil(SETTLE_SECONDS / STEP) + 2; i += 1) step(match, STEP);
    expect(match.seat).toBe('p2');
    expect(match.phase).toBe('ready');
  });
});

/* ------------------------------------------------------------------ scoring */

describe('scoring', () => {
  it('values a goal by where the ball stood when the kick was taken', () => {
    const ball: Ball = { x: 0, y: 0, vx: 0, vy: 0, startDistance: 0, holed: false };
    ball.startDistance = RANGE_RADIUS + 1;
    expect(goalValueOf(ball)).toBe(RANGE_GOAL);
    ball.startDistance = APRON_RADIUS + 1;
    expect(goalValueOf(ball)).toBe(MID_GOAL);
    ball.startDistance = APRON_RADIUS - 1;
    expect(goalValueOf(ball)).toBe(TAP_GOAL);
    expect(RANGE_GOAL).toBeGreaterThan(MID_GOAL);
    expect(MID_GOAL).toBeGreaterThan(TAP_GOAL);
    expect(APRON_RADIUS).toBeLessThan(RANGE_RADIUS);
  });

  it('puts a holed ball back on its own spot, which is worth the full three', () => {
    const match = pitch('p1', [CENTRE_X, CENTRE_Y + 300], [PITCH_LEFT + 20, PITCH_TOP + 20]);
    kickAt(match, -Math.PI / 2, powerForReach(300 + CAPTURE_OVERRUN * 0.5));
    settle(match);
    expect(match.points.p1).toBe(RANGE_GOAL);
    expect(match.rangeGoals.p1).toBe(1);
    expect(match.holedRange.p1).toBeCloseTo(300, 6);
    for (let i = 0; i < Math.ceil(SETTLE_SECONDS / STEP) + 1; i += 1) step(match, STEP);
    expect(match.p1.holed).toBe(false);
    expect(match.p1.x).toBe(spotXOf('p1'));
    expect(match.p1.y).toBe(spotYOf('p1'));
    expect(distanceToCup(match.p1.x, match.p1.y)).toBeGreaterThan(RANGE_RADIUS);
  });

  it('gives a ball knocked in by the other player to the player it belongs to', () => {
    // The rule that gives a clearance its price: shoving their ball out of the mouth is the
    // obvious move, and shoving it *in* hands them the goal.
    const match = pitch('p1', [CENTRE_X, CENTRE_Y + 260], [CENTRE_X, CENTRE_Y + 120]);
    kickAt(match, -Math.PI / 2, powerForReach(260));
    settle(match);
    expect(match.p2.holed, 'p2 was pushed into the cup').toBe(true);
    expect(match.points.p2).toBeGreaterThan(0);
    expect(match.points.p1).toBe(0);
  });

  it('scores both balls when both drop on one kick', () => {
    // Rare and reachable: found by a 37 000-kick search, and worth a test because the
    // book-keeping loops over both seats rather than only over the kicker. p1 clips a ball
    // already sitting in the mouth, knocks it in, and follows it in — and the two goals are
    // valued separately, from where each of them stood.
    const match = pitch('p1', [463.1908, 619.4698], [304.9398, 502.0736]);
    kickAt(match, -2.1983600079046592, 0.5039278268814087);
    settle(match);
    expect(match.p1.holed).toBe(true);
    expect(match.p2.holed).toBe(true);
    expect(match.points.p1).toBe(MID_GOAL);
    expect(match.points.p2).toBe(TAP_GOAL);
  });

  it('settles on points, then goals from range, then the range they came from', () => {
    const match = createMatch();
    const ends = (
      p1: number,
      p2: number,
      r1: number,
      r2: number,
      h1: number,
      h2: number,
    ): Match['winner'] => {
      match.points.p1 = p1;
      match.points.p2 = p2;
      match.rangeGoals.p1 = r1;
      match.rangeGoals.p2 = r2;
      match.holedRange.p1 = h1;
      match.holedRange.p2 = h2;
      settleMatch(match);
      return match.winner;
    };
    expect(ends(7, 5, 0, 3, 0, 900)).toBe('p1');
    expect(ends(5, 7, 3, 0, 900, 0)).toBe('p2');
    expect(ends(6, 6, 2, 1, 0, 900)).toBe('p1');
    expect(ends(6, 6, 1, 2, 900, 0)).toBe('p2');
    expect(ends(6, 6, 2, 2, 901, 900)).toBe('p1');
    expect(ends(6, 6, 2, 2, 900, 901)).toBe('p2');
    expect(ends(6, 6, 2, 2, 900, 900)).toBe('draw');
    expect(winnerOf(match)).toBe('draw');
  });

  it('barely ever draws, because the last tiebreak is a real number', () => {
    // On the score alone two `hard` seats finish level 14.2% of the time and the counted
    // tiebreak only takes it to 14.1% — the count is very nearly the score again. This is
    // what the summed range fixed. See SPEC.md.
    let draws = 0;
    const runs = 60;
    for (let s = 0; s < runs; s += 1) {
      const { match } = playMatch(
        1000003 + s * 7919,
        s % 2 === 0 ? 'p1' : 'p2',
        BOT_PROFILES.hard,
        BOT_PROFILES.hard,
      );
      if (match.winner === 'draw') draws += 1;
    }
    expect(draws / runs).toBeLessThan(0.05);
  });
});

/* ------------------------------------------------------------------ mirror symmetry */

/**
 * The half-turn: the map that takes one seat's world to the other's.
 *
 * Snowball Throw measured seat one at 64.3% and bisecting found two defects nothing else in
 * the repository could see — a tie broken in *board* coordinates, and a threshold on a knife
 * edge. Both are invisible to a unit test and to a win-rate ladder. What finds them is this:
 * take a pitch, turn it half round, swap the seats, and require the result to be the turned
 * image of the original.
 */
function turn(match: Match): Match {
  const mirrored = createMatch();
  resetMatch(mirrored, otherOf(match.seat));
  for (const seat of ['p1', 'p2'] as const) {
    const from = ballOf(match, seat);
    const to = ballOf(mirrored, otherOf(seat));
    to.x = 2 * CENTRE_X - from.x;
    to.y = 2 * CENTRE_Y - from.y;
    to.vx = -from.vx;
    to.vy = -from.vy;
    to.startDistance = from.startDistance;
    to.holed = from.holed;
  }
  mirrored.phase = match.phase;
  mirrored.aimBase = match.aimBase + Math.PI;
  mirrored.lockedAim = match.lockedAim;
  mirrored.aim = match.aim;
  mirrored.power = match.power;
  mirrored.hold = match.hold;
  mirrored.clock = match.clock;
  return mirrored;
}

describe('the half-turn between the seats', () => {
  it('steps a mirrored pitch to the mirrored answer, over hundreds of random kicks', () => {
    const rng = new Rng(20260829);
    let contacts = 0;
    let goals = 0;
    for (let i = 0; i < 400; i += 1) {
      const own: [number, number] = [
        PITCH_LEFT + 25 + rng.float() * 570,
        PITCH_TOP + 25 + rng.float() * 690,
      ];
      // A third of the kicks are aimed at the cup with a plausible weight and a third put
      // the other ball squarely in the way, so the mirror is checked on the events that
      // actually happen in a match rather than only on kicks that reach nothing.
      const toCup = Math.atan2(CENTRE_Y - own[1], CENTRE_X - own[0]);
      const range = distanceToCup(own[0], own[1]);
      const mode = i % 3;
      const angle = mode === 0 ? rng.float() * Math.PI * 2 : toCup + (rng.float() - 0.5) * 0.16;
      const power =
        mode === 0 ? rng.float() : powerForReach(range + (rng.float() - 0.2) * CAPTURE_OVERRUN * 2);
      const rival: [number, number] =
        mode === 2
          ? [
              own[0] + Math.cos(angle) * (60 + rng.float() * (range - 60)),
              own[1] + Math.sin(angle) * (60 + rng.float() * (range - 60)),
            ]
          : [PITCH_LEFT + 25 + rng.float() * 570, PITCH_TOP + 25 + rng.float() * 690];
      if (Math.hypot(own[0] - rival[0], own[1] - rival[1]) < BALL_RADIUS * 2.5) continue;
      if (distanceToCup(rival[0], rival[1]) < CUP_RADIUS + BALL_RADIUS) continue;

      const forward = pitch('p1', own, rival);
      const back = turn(forward);
      kickAt(forward, angle, power);
      kickAt(back, angle + Math.PI, power);
      settle(forward);
      settle(back);

      for (const seat of ['p1', 'p2'] as const) {
        const a = ballOf(forward, seat);
        const b = ballOf(back, otherOf(seat));
        expect(b.holed, `holed, kick ${String(i)}`).toBe(a.holed);
        expect(2 * CENTRE_X - b.x, `x, kick ${String(i)}`).toBeCloseTo(a.x, 6);
        expect(2 * CENTRE_Y - b.y, `y, kick ${String(i)}`).toBeCloseTo(a.y, 6);
      }
      expect(back.points.p2).toBe(forward.points.p1);
      expect(back.points.p1).toBe(forward.points.p2);
      if (forward.p1.holed || forward.p2.holed) goals += 1;
      if (Math.hypot(forward.p2.x - rival[0], forward.p2.y - rival[1]) > 1) contacts += 1;
    }
    // Not a vacuous mirror of two pitches on which nothing ever happened.
    expect(goals, 'some of these kicks went in').toBeGreaterThan(20);
    expect(contacts, 'some of these kicks hit the other ball').toBeGreaterThan(20);
  });

  it('makes the bot choose the mirrored kick, to the bit', () => {
    // The decision, not just the physics. A bot that ranked its lines in board coordinates
    // would pass every test above and still hand one seat the easier way round a post.
    const rng = new Rng(24680);
    const profiles = [BOT_PROFILES.easy, BOT_PROFILES.normal, BOT_PROFILES.hard];
    for (let i = 0; i < 400; i += 1) {
      const own: [number, number] = [
        PITCH_LEFT + 25 + rng.float() * 570,
        PITCH_TOP + 25 + rng.float() * 690,
      ];
      const rival: [number, number] = [
        PITCH_LEFT + 25 + rng.float() * 570,
        PITCH_TOP + 25 + rng.float() * 690,
      ];
      const profile = profiles[i % profiles.length]!;
      const forward = pitch('p1', own, rival);
      const back = turn(forward);

      const a = createBotState();
      const b = createBotState();
      planKick(forward, 'p1', profile, a, new Rng(99));
      planKick(back, 'p2', profile, b, new Rng(99));
      // Exact equality: both are the same offset off their own line to the cup, and the
      // press moments derive from the same arithmetic.
      expect(b.wantAim, `line, pitch ${String(i)}`).toBe(a.wantAim);
      expect(b.wantPower, `weight, pitch ${String(i)}`).toBeCloseTo(a.wantPower, 9);
      expect(b.lineTimer, `press moment, pitch ${String(i)}`).toBeCloseTo(a.lineTimer, 9);
    }
  });

  it('samples the needle antisymmetrically, so a tie either way round a post is exact', () => {
    // The tie between `+phi` and `-phi` is an everyday event, not a measure-zero one: a ball
    // on the centre line has two identical ways past the posts. Generated as `(i - mid) *
    // step` the two are exact negations, so the tie is exact and the first index takes it
    // for both seats. Written as `-sweep + i * step` they would differ in the last bit and
    // the two seats would break it differently.
    const mid = (AIM_SAMPLES - 1) / 2;
    expect(AIM_SAMPLES % 2).toBe(1);
    expect(aimSampleAt(mid)).toBe(0);
    for (let k = 1; k <= mid; k += 1) {
      expect(aimSampleAt(mid - k)).toBe(-aimSampleAt(mid + k));
    }
    expect(Math.abs(aimSampleAt(0))).toBeCloseTo(AIM_SWEEP, 12);
  });
});

/* ------------------------------------------------------------------ the bot */

describe('the bot', () => {
  it('draws exactly the same number of values per kick, whatever it decides', () => {
    const rng = new Rng(1234);
    for (let i = 0; i < 60; i += 1) {
      const match = pitch(
        'p1',
        [PITCH_LEFT + 25 + rng.float() * 570, PITCH_TOP + 25 + rng.float() * 690],
        [PITCH_LEFT + 25 + rng.float() * 570, PITCH_TOP + 25 + rng.float() * 690],
      );
      const counter = new CountingRng(7 + i);
      planKick(match, 'p1', BOT_PROFILES.easy, createBotState(), counter);
      expect(counter.draws).toBe(BOT_DRAWS_PER_KICK);
    }
  });

  it('presses within a bounded number of steps, always', () => {
    // It counts down to a moment; it never watches for a position. Watching for one hangs:
    // the wanted value turns round with the needle and the two never meet. Cup Pong went
    // into exactly that on seed 2 of its first harness run.
    const rng = new Rng(31415);
    for (let i = 0; i < 200; i += 1) {
      const match = pitch(
        'p1',
        [PITCH_LEFT + 25 + rng.float() * 570, PITCH_TOP + 25 + rng.float() * 690],
        [PITCH_LEFT + 25 + rng.float() * 570, PITCH_TOP + 25 + rng.float() * 690],
      );
      match.phase = 'ready';
      match.hold = READY_SECONDS;
      const state = createBotState();
      const bot = new Rng(500 + i);
      let steps = 0;
      while (match.kicks === 0 && steps < 60 * 30) {
        driveBot(match, 'p1', BOT_PROFILES.easy, state, bot, STEP);
        step(match, STEP);
        steps += 1;
      }
      expect(match.kicks, `pitch ${String(i)} never produced a kick`).toBe(1);
      expect(steps * STEP).toBeLessThanOrEqual(READY_SECONDS + AIM_DEADLINE + WIND_DEADLINE + 0.1);
    }
  });

  it('plays the identical opening kick whoever it is playing against', () => {
    // A generator per seat, so a seat's play is a function of its own seed and nothing else.
    // In this game the two seats are genuinely coupled — a kick moves the other ball — so one
    // shared stream would make a seat's randomness a function of its opponent's play, and a
    // `normal` bot would be a different `normal` bot depending on who it was up against.
    for (let seed = 0; seed < 40; seed += 1) {
      const versusEasy = openingKick(9000 + seed, BOT_PROFILES.normal, BOT_PROFILES.easy);
      const versusHard = openingKick(9000 + seed, BOT_PROFILES.normal, BOT_PROFILES.hard);
      expect(versusHard.vx, `seed ${String(seed)}`).toBe(versusEasy.vx);
      expect(versusHard.vy, `seed ${String(seed)}`).toBe(versusEasy.vy);
    }
  });

  it('plays the identical match for the identical seed', () => {
    const a = playMatch(555, 'p1', BOT_PROFILES.hard, BOT_PROFILES.normal);
    const b = playMatch(555, 'p1', BOT_PROFILES.hard, BOT_PROFILES.normal);
    expect(b.steps).toBe(a.steps);
    expect(b.match.points).toEqual(a.match.points);
    expect(b.match.holedRange).toEqual(a.match.holedRange);
    expect(b.match.p1.x).toBe(a.match.p1.x);
    expect(b.match.p2.y).toBe(a.match.p2.y);
  });

  it('climbs: hard beats normal beats easy, from both chairs', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as const) {
      const rate = duel(16, BOT_PROFILES[strong], BOT_PROFILES[weak]);
      expect(rate, `${strong} v ${weak} measured ${(rate * 100).toFixed(1)}%`).toBeGreaterThan(
        0.65,
      );
    }
  });

  it('is level against itself, from both opening seats', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      // 120 matches a tier, so one standard error is 4.6 points: this is a guard against a
      // seat effect large enough to matter, not a measurement. SPEC.md carries the real
      // numbers, taken over 2000 matches a tier.
      const share = seatOneShare(60, BOT_PROFILES[tier]);
      expect(share, `${tier} gave seat one ${(share * 100).toFixed(1)}%`).toBeGreaterThan(0.33);
      expect(share, `${tier} gave seat one ${(share * 100).toFixed(1)}%`).toBeLessThan(0.67);
    }
  });

  it('finishes two easy bots far inside ten simulated minutes', () => {
    // `apps/web/src/data/termination.test.ts` asserts this at the shell. The weakest pairing
    // is the one that finds positions nothing resolves, so it is the one measured here.
    let worst = 0;
    for (let s = 0; s < 40; s += 1) {
      const { steps } = playMatch(
        1000003 + s * 7919,
        s % 2 === 0 ? 'p1' : 'p2',
        BOT_PROFILES.easy,
        BOT_PROFILES.easy,
      );
      expect(steps).toBeGreaterThan(0);
      worst = Math.max(worst, steps);
    }
    expect(worst, `the longest easy-versus-easy match took ${String(worst)} steps`).toBeLessThan(
      60 * 120,
    );
  });
});

class CountingRng extends Rng {
  draws = 0;

  override next(): number {
    this.draws += 1;
    return super.next();
  }
}

/** The velocity seat one's opening kick left with. p1 opens, so its lie is untouched. */
function openingKick(seed: number, p1: BotProfile, p2: BotProfile): { vx: number; vy: number } {
  const match = createMatch();
  resetMatch(match, 'p1');
  const rngs = createBotRngs(new Rng(seed));
  const state = { p1: createBotState(), p2: createBotState() };
  for (let i = 0; i < 60 * 20; i += 1) {
    const seat = match.seat;
    driveBot(match, seat, seat === 'p1' ? p1 : p2, state[seat], rngs[seat], STEP);
    step(match, STEP);
    if (match.kicks === 1) return { vx: match.p1.vx, vy: match.p1.vy };
  }
  throw new Error('seat one never kicked');
}

/** `a`'s share of decided matches, played from both chairs and both opening seats. */
function duel(seeds: number, a: BotProfile, b: BotProfile): number {
  let aWins = 0;
  let bWins = 0;
  for (let s = 0; s < seeds; s += 1) {
    const seed = 1000003 + s * 7919;
    for (const opener of ['p1', 'p2'] as const) {
      const first = playMatch(seed, opener, a, b).match.winner;
      if (first === 'p1') aWins += 1;
      else if (first === 'p2') bWins += 1;
      const second = playMatch(seed, opener, b, a).match.winner;
      if (second === 'p2') aWins += 1;
      else if (second === 'p1') bWins += 1;
    }
  }
  return aWins / (aWins + bWins);
}

/** Seat one's share of decided matches at equal skill, from both opening seats. */
function seatOneShare(seeds: number, profile: BotProfile): number {
  let one = 0;
  let two = 0;
  for (let s = 0; s < seeds; s += 1) {
    for (const opener of ['p1', 'p2'] as const) {
      const winner = playMatch(1000003 + s * 7919, opener, profile, profile).match.winner;
      if (winner === 'p1') one += 1;
      else if (winner === 'p2') two += 1;
    }
  }
  return one / (one + two);
}

/* ------------------------------------------------------------------ the module's own guards */

describe('the constants', () => {
  it('keeps the difficulty ladder monotone in every knob it ships', () => {
    const tiers = ['easy', 'normal', 'hard'] as const;
    for (let i = 1; i < tiers.length; i += 1) {
      const worse = BOT_PROFILES[tiers[i - 1]!];
      const better = BOT_PROFILES[tiers[i]!];
      expect(better.timing).toBeLessThan(worse.timing);
      expect(better.blunder).toBeLessThan(worse.blunder);
      // `overshoot` has an interior optimum — a kick that dies short leaves a cheap tap-in —
      // so the tiers all sit on the far side of it and climb towards it. Measured: 82.1% at
      // 28, 80.4% at 36, 72.1% at 48, 45.6% at 70. See SPEC.md.
      expect(better.overshoot).toBeLessThan(worse.overshoot);
    }
    // `easy` is deliberately over the line at which a ball still drops: it batters the ball
    // at the goal and it runs through, which is what a bad player does.
    expect(BOT_PROFILES.easy.overshoot).toBeGreaterThan(CAPTURE_OVERRUN);
    expect(BOT_PROFILES.hard.overshoot).toBeLessThan(CAPTURE_OVERRUN);
  });

  it('never lets a bot press more finely than a person could', () => {
    // Rule 6. Every tier's error is several frames wide, so none of them can stop a needle
    // more precisely than a hand can.
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      expect(BOT_PROFILES[tier].timing).toBeGreaterThan(4 * STEP);
    }
  });
});
