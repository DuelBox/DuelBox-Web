import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  AIR_RATE,
  BOT_PROFILES,
  CHEST_MIN_SPEED,
  CHEST_TOP,
  CONTACT_COOLDOWN,
  EXTRA_SECONDS,
  FOOT_LOFT,
  FOOT_SPEED,
  FOOT_TOP,
  GOAL_CEILING,
  GOAL_HALF_W,
  GOAL_TARGET,
  GRAVITY,
  HEAD_LOFT,
  HEAD_SPEED,
  HEAD_TOP,
  MATCH_SECONDS,
  MAX_BALL_SPEED,
  PITCH_HALF_H,
  PITCH_HALF_W,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  POST_RADIUS,
  RAIL_X,
  RAIL_Y,
  ROLL_RATE,
  STOP_SPEED,
  advanceBall,
  attackSign,
  botHeading,
  createBotState,
  createMatch,
  drive,
  goalLineOf,
  kickOff,
  otherOf,
  step,
  strike,
  surfaceAt,
  winnerOf,
} from './rules.js';
import type { Ball, BotDifficulty, BotProfile, Match, Phase, Player } from './rules.js';

const STEP = 1 / 60;

function ball(x: number, y: number, z: number, vx: number, vy: number, vz: number): Ball {
  return { x, y, z, vx, vy, vz };
}

function copyBall(source: Readonly<Ball>): Ball {
  return { ...source };
}

/**
 * Equal, treating `-0` and `0` as the same number.
 *
 * `Object.is` separates them and nothing else in JavaScript does: `-0 === 0`, `-0 < 0` is
 * false, `Math.hypot(-0, y)` is `Math.hypot(0, y)`, and every comparison in `rules.ts`
 * that a signed zero could reach reads it the same way either way. Negating a mirrored
 * position turns one into the other for free, so a comparator that told them apart would
 * report a difference that no line of the simulation can observe — which is a fact about
 * `Object.is` rather than about the game.
 */
function same(a: number, b: number): boolean {
  return Object.is(a + 0, b + 0);
}

function phaseOf(match: Readonly<Match>): Phase {
  return match.phase;
}

function playerOf(match: Readonly<Match>, seat: SeatId): Readonly<Player> {
  return seat === 'p1' ? match.p1 : match.p2;
}

/** One match of bot against bot, driven exactly as `game.ts` drives it. */
function playBots(
  tierP1: BotDifficulty,
  tierP2: BotDifficulty,
  seed: number,
  maxSteps = 60 * 600,
): { winner: SeatId | 'draw' | null; steps: number; p1: number; p2: number } {
  const rng = new Rng(seed);
  const match = createMatch(rng);
  const botP1 = createBotState();
  const botP2 = createBotState();
  const heading = { x: 0, y: 0 };
  let steps = 0;
  for (; steps < maxSteps; steps += 1) {
    if (winnerOf(match) !== null) break;
    botHeading(heading, match, botP1, 'p1', BOT_PROFILES[tierP1], STEP, rng.float());
    drive(match, 'p1', heading.x, heading.y, STEP);
    botHeading(heading, match, botP2, 'p2', BOT_PROFILES[tierP2], STEP, rng.float());
    drive(match, 'p2', heading.x, heading.y, STEP);
    step(match, STEP, rng);
  }
  return { winner: winnerOf(match), steps, p1: match.score.p1, p2: match.score.p2 };
}

/**
 * ## The mirror test, written first
 *
 * The lesson three games paid for: mirror a board, mirror the inputs, run both, and
 * require the results to be mirror images. It is the only instrument that finds a seat
 * bias whose whole magnitude lives in the last bits of a float, and it found nothing here
 * because the pitch is written about its own centre — which is the point. A property you
 * can only get by construction is one you should assert by construction.
 */
describe('the half-turn is an exact symmetry of the whole simulation', () => {
  function mirrorMatch(match: Readonly<Match>): Match {
    const flip = (p: Readonly<Player>): Player => ({
      x: -p.x,
      y: -p.y,
      vx: -p.vx,
      vy: -p.vy,
      cooldown: p.cooldown,
    });
    return {
      p1: flip(match.p2),
      p2: flip(match.p1),
      ball: {
        x: -match.ball.x,
        y: -match.ball.y,
        z: match.ball.z,
        vx: -match.ball.vx,
        vy: -match.ball.vy,
        vz: match.ball.vz,
      },
      phase: match.phase,
      clock: match.clock,
      hold: match.hold,
      extra: match.extra,
      scorer: match.scorer === null ? null : otherOf(match.scorer),
      lastSurface: match.lastSurface,
      lastToucher: match.lastToucher === null ? null : otherOf(match.lastToucher),
      flash: match.flash,
      score: { p1: match.score.p2, p2: match.score.p1 },
    };
  }

  function differences(a: Readonly<Match>, b: Readonly<Match>): string[] {
    const out: string[] = [];
    for (const seat of ['p1', 'p2'] as const) {
      const left = a[seat];
      const right = b[seat];
      for (const field of ['x', 'y', 'vx', 'vy', 'cooldown'] as const) {
        if (!same(left[field], right[field])) {
          out.push(`${seat}.${field}: ${String(left[field])} vs ${String(right[field])}`);
        }
      }
    }
    for (const field of ['x', 'y', 'z', 'vx', 'vy', 'vz'] as const) {
      if (!same(a.ball[field], b.ball[field])) {
        out.push(`ball.${field}: ${String(a.ball[field])} vs ${String(b.ball[field])}`);
      }
    }
    if (a.phase !== b.phase) out.push(`phase: ${a.phase} vs ${b.phase}`);
    if (!same(a.clock, b.clock)) out.push('clock');
    if (a.scorer !== b.scorer) out.push(`scorer: ${String(a.scorer)} vs ${String(b.scorer)}`);
    if (a.score.p1 !== b.score.p1 || a.score.p2 !== b.score.p2) out.push('score');
    return out;
  }

  const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('steps a mirrored board to a mirrored state, bit for bit', () => {
    let checked = 0;
    for (let trial = 0; trial < 220; trial += 1) {
      const rng = new Rng(90_000 + trial);
      const first = createMatch(rng);
      first.phase = 'playing';
      first.ball.x = (rng.float() - 0.5) * 2 * (RAIL_X - 10);
      first.ball.y = (rng.float() - 0.5) * 2 * (RAIL_Y - 10);
      first.ball.z = rng.float() * 140;
      first.ball.vx = (rng.float() - 0.5) * 2 * 900;
      first.ball.vy = (rng.float() - 0.5) * 2 * 900;
      first.ball.vz = (rng.float() - 0.5) * 2 * 600;
      first.p1.x = (rng.float() - 0.5) * 2 * 200;
      first.p1.y = (rng.float() - 0.5) * 2 * 380;
      first.p2.x = (rng.float() - 0.5) * 2 * 200;
      first.p2.y = (rng.float() - 0.5) * 2 * 380;

      const second = mirrorMatch(first);
      const nearBot = createBotState();
      const farBot = createBotState();
      const mirrorNear = createBotState();
      const mirrorFar = createBotState();
      const heading = { x: 0, y: 0 };
      const rolls = new Rng(trial + 7);
      // Held apart so a kick-off draw in one cannot advance the other's stream.
      const firstRng = new Rng(5);
      const secondRng = new Rng(5);
      const nearTier = BOT_PROFILES[TIERS[trial % 3]!];
      const farTier = BOT_PROFILES[TIERS[(trial + 1) % 3]!];

      for (let i = 0; i < 200; i += 1) {
        const nearRoll = rolls.float();
        const farRoll = rolls.float();
        botHeading(heading, first, nearBot, 'p1', nearTier, STEP, nearRoll);
        drive(first, 'p1', heading.x, heading.y, STEP);
        botHeading(heading, first, farBot, 'p2', farTier, STEP, farRoll);
        drive(first, 'p2', heading.x, heading.y, STEP);
        // The bots go with their **roles**, not with their seats: the mirrored board's
        // seat two is the original's seat one, so it gets that tier and that roll.
        botHeading(heading, second, mirrorFar, 'p1', farTier, STEP, farRoll);
        drive(second, 'p1', heading.x, heading.y, STEP);
        botHeading(heading, second, mirrorNear, 'p2', nearTier, STEP, nearRoll);
        drive(second, 'p2', heading.x, heading.y, STEP);
        step(first, STEP, firstRng);
        step(second, STEP, secondRng);
        checked += 1;
        const found = differences(mirrorMatch(first), second);
        expect(found, `trial ${String(trial)} step ${String(i)}`).toEqual([]);
        // Read through a function so the checker does not narrow `phase` to the literal it
        // was assigned above; `step` changes it and TypeScript cannot see that it does.
        if (phaseOf(first) !== 'playing') break;
      }
    }
    // Guarding nothing is the failure mode of a test like this one.
    expect(checked).toBeGreaterThan(20_000);
  });

  it('gives a mirrored board a mirrored heading, at every tier', () => {
    const out = { x: 0, y: 0 };
    for (let trial = 0; trial < 400; trial += 1) {
      const rng = new Rng(4000 + trial);
      const match = createMatch(rng);
      match.phase = 'playing';
      match.ball.x = (rng.float() - 0.5) * 400;
      match.ball.y = (rng.float() - 0.5) * 800;
      match.ball.z = rng.float() * 120;
      match.ball.vx = (rng.float() - 0.5) * 1400;
      match.ball.vy = (rng.float() - 0.5) * 1400;
      match.ball.vz = (rng.float() - 0.5) * 800;
      match.p1.x = (rng.float() - 0.5) * 400;
      match.p1.y = (rng.float() - 0.5) * 700;
      match.p2.x = (rng.float() - 0.5) * 400;
      match.p2.y = (rng.float() - 0.5) * 700;
      const mirrored = mirrorMatch(match);
      const roll = rng.float();
      for (const tier of TIERS) {
        botHeading(out, match, createBotState(), 'p1', BOT_PROFILES[tier], STEP, roll);
        const nearX = out.x;
        const nearY = out.y;
        botHeading(out, mirrored, createBotState(), 'p2', BOT_PROFILES[tier], STEP, roll);
        expect(same(out.x, -nearX), `${tier} heading x on trial ${String(trial)}`).toBe(true);
        expect(same(out.y, -nearY), `${tier} heading y on trial ${String(trial)}`).toBe(true);
      }
    }
  });
});

/**
 * ## The integrator
 *
 * Rule 8 says a phone and a laptop must step the identical match. The fixed timestep is 60
 * Hz everywhere today, so nothing in the product depends on this — which is exactly why it
 * is worth asserting: it is the property that stops being true silently.
 */
describe('the ball is integrated exactly', () => {
  const SHOTS: readonly (readonly [string, Ball])[] = [
    ['a foot drive up the pitch', ball(0, 200, 0, 0, -FOOT_SPEED, FOOT_LOFT)],
    ['a header across the pitch', ball(-100, 100, 60, 380, -380, HEAD_LOFT)],
    ['a ball rolling due east', ball(0, 0, 0, 500, 0, 0)],
    ['a lofted diagonal', ball(50, -80, 20, -300, 640, 420)],
  ];
  const RATES = [60, 90, 120, 240];
  const DURATION = 2;

  function runAt(source: Readonly<Ball>, hz: number): Ball {
    const moving = copyBall(source);
    const dt = 1 / hz;
    const steps = Math.round(DURATION * hz);
    for (let i = 0; i < steps; i += 1) advanceBall(moving, dt);
    return moving;
  }

  function gap(a: Readonly<Ball>, b: Readonly<Ball>): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  it('lands in the same place at 60, 90, 120 and 240 Hz', () => {
    let worst = 0;
    for (const [name, shot] of SHOTS) {
      const reference = runAt(shot, RATES[0]!);
      for (const hz of RATES.slice(1)) {
        const distance = gap(runAt(shot, hz), reference);
        worst = Math.max(worst, distance);
        expect(distance, `${name} at ${String(hz)} Hz`).toBeLessThan(1e-9);
      }
    }
    // Recorded rather than merely bounded: the SPEC quotes this figure.
    expect(worst).toBeLessThan(1e-9);
  });

  it('reaches the same place in one call as in ninety', () => {
    for (const [name, shot] of SHOTS) {
      const stepped = runAt(shot, 60);
      const oneCall = copyBall(shot);
      advanceBall(oneCall, DURATION);
      expect(gap(oneCall, stepped), name).toBeLessThan(1e-9);
    }
  });

  it('rolls exactly the distance the drag law says', () => {
    // Started against the near rail and rolling away from it, along the halfway line so
    // that no goal and no post is in the way. Every speed here stops short of the far rail,
    // which is what makes the roll a *free* roll and the closed form the whole answer.
    for (const speed of [120, 300, 640]) {
      const rolling = ball(-RAIL_X, 0, 0, speed, 0, 0);
      const predicted = (speed - STOP_SPEED) / ROLL_RATE;
      const start = rolling.x;
      for (let i = 0; i < 900; i += 1) {
        advanceBall(rolling, STEP);
        if (rolling.vx === 0 && rolling.vy === 0) break;
      }
      expect(rolling.x, `speed ${String(speed)} reached the far rail`).toBeLessThan(RAIL_X);
      expect(rolling.x - start).toBeCloseTo(predicted, 9);
    }
  });

  it('bounces to the height gravity says it will', () => {
    for (const launch of [200, 400, HEAD_LOFT]) {
      const flying = ball(0, 0, 0, 0, 0, launch);
      let peak = 0;
      for (let i = 0; i < 200; i += 1) {
        advanceBall(flying, STEP);
        peak = Math.max(peak, flying.z);
        if (flying.z === 0 && i > 2) break;
      }
      // Sampled on a 60 Hz grid, so the true peak is never quite caught; the bound is the
      // most a step of free fall can hide.
      const exact = (launch * launch) / (2 * GRAVITY);
      expect(peak).toBeLessThanOrEqual(exact + 1e-9);
      expect(peak).toBeGreaterThan(exact - 0.5 * GRAVITY * STEP * STEP);
    }
  });

  it('never lets the ball leave the pitch, however hard it is hit', () => {
    const rng = new Rng(31);
    for (let trial = 0; trial < 400; trial += 1) {
      const flying = ball(
        (rng.float() - 0.5) * 2 * (RAIL_X - 1),
        (rng.float() - 0.5) * 2 * (RAIL_Y - 1),
        rng.float() * 120,
        (rng.float() - 0.5) * 2 * MAX_BALL_SPEED,
        (rng.float() - 0.5) * 2 * MAX_BALL_SPEED,
        (rng.float() - 0.5) * 2 * 700,
      );
      for (let i = 0; i < 300; i += 1) {
        if (advanceBall(flying, STEP) !== null) break;
        expect(Math.abs(flying.x)).toBeLessThanOrEqual(RAIL_X + 1e-9);
        expect(Math.abs(flying.y)).toBeLessThanOrEqual(RAIL_Y + 1e-9);
        expect(flying.z).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('always makes progress, even resting exactly on a post at contact distance', () => {
    // The regression. A ball whose centre sits a last-bit outside the touching distance is
    // reported as an impact at time zero by the swept test and as *not touching* by an
    // overlap test, so the event loop resolved an event nothing then resolved: no motion,
    // no time consumed, and the whole step eaten by the iteration guard. This is that
    // state, taken from the run that found it.
    const stalled = ball(
      110.65820941476646,
      -435.07656736737533,
      2.890659968818022,
      -688.4579899760424,
      -568.7039811531774,
      117.5926022058613,
    );
    const before = { ...stalled };
    advanceBall(stalled, STEP);
    const moved = Math.hypot(stalled.x - before.x, stalled.y - before.y);
    // A ball at 893 units a second covers about fifteen in a step; a stalled one covers
    // nothing at all.
    expect(moved).toBeGreaterThan(1);
  });

  it('never leaves the ball inside a post', () => {
    const rng = new Rng(77);
    for (let trial = 0; trial < 500; trial += 1) {
      // Aimed into the goalmouth from close range, which is where posts are met.
      const shot = ball(
        (rng.float() - 0.5) * 2 * (GOAL_HALF_W + 40),
        -PITCH_HALF_H + 60 + rng.float() * 120,
        rng.float() * 60,
        (rng.float() - 0.5) * 2 * 700,
        -rng.float() * MAX_BALL_SPEED,
        (rng.float() - 0.5) * 400,
      );
      for (let i = 0; i < 40; i += 1) {
        if (advanceBall(shot, STEP) !== null) break;
        for (const side of [-GOAL_HALF_W, GOAL_HALF_W]) {
          const away = Math.hypot(shot.x - side, shot.y + PITCH_HALF_H);
          expect(away).toBeGreaterThanOrEqual(POST_RADIUS);
        }
      }
    }
  });

  it('cannot tunnel a post, at the fastest the game allows', () => {
    // A post is 7 units of radius against a ball that covers 17 in a step at the cap, and
    // the mouth is open right beside it — so a post the simulation failed to see is not a
    // cosmetic miss, it is a goal. Fired dead at the near post of the far goal.
    const shot = ball(GOAL_HALF_W, 0, 0, 0, -MAX_BALL_SPEED, 0);
    let conceded: SeatId | null = null;
    let turnedBack = false;
    for (let i = 0; i < 90 && conceded === null; i += 1) {
      conceded = advanceBall(shot, STEP);
      if (shot.vy > 0) turnedBack = true;
      expect(Math.hypot(shot.x - GOAL_HALF_W, shot.y + PITCH_HALF_H)).toBeGreaterThanOrEqual(
        POST_RADIUS,
      );
    }
    expect(conceded, 'a shot dead at the post went in').toBeNull();
    expect(turnedBack, 'a shot dead at the post was never turned back').toBe(true);

    // The control: the same shot a stride inside the post is a goal, so the assertion
    // above is about the post rather than about the goal being unreachable.
    const inside = ball(GOAL_HALF_W - 40, 0, 0, 0, -MAX_BALL_SPEED, 0);
    let went: SeatId | null = null;
    for (let i = 0; i < 90 && went === null; i += 1) went = advanceBall(inside, STEP);
    expect(went).toBe('p2');
  });
});

describe('the goal', () => {
  it('counts a ball under the bar and inside the posts', () => {
    const shot = ball(0, 0, 0, 0, -FOOT_SPEED, 0);
    let conceded: SeatId | null = null;
    for (let i = 0; i < 300 && conceded === null; i += 1) conceded = advanceBall(shot, STEP);
    expect(conceded).toBe('p2');
  });

  it('turns a ball above the bar away rather than out of play', () => {
    // Launched so it is still climbing as it reaches the line: over the bar, off the net.
    const shot = ball(0, -PITCH_HALF_H + 120, GOAL_CEILING + 20, 0, -600, 200);
    let conceded: SeatId | null = null;
    for (let i = 0; i < 30 && conceded === null; i += 1) conceded = advanceBall(shot, STEP);
    expect(conceded).toBeNull();
    expect(shot.vy).toBeGreaterThan(0);
    expect(Math.abs(shot.y)).toBeLessThanOrEqual(RAIL_Y);
  });

  it('turns a ball wide of the posts away', () => {
    const shot = ball(GOAL_HALF_W + 60, 0, 0, 0, -FOOT_SPEED, 0);
    let conceded: SeatId | null = null;
    for (let i = 0; i < 120 && conceded === null; i += 1) conceded = advanceBall(shot, STEP);
    expect(conceded).toBeNull();
  });

  it("gives each seat the goal that is the other's half-turn", () => {
    expect(goalLineOf('p1')).toBe(-goalLineOf('p2'));
    expect(attackSign('p1')).toBe(-attackSign('p2'));
  });
});

/**
 * ## Every part of your body
 *
 * The catalogue row's whole demand, as three assertions about three different outcomes
 * from the same contact geometry.
 */
describe('the three contact surfaces', () => {
  function standing(x: number, y: number): Player {
    return { x, y, vx: 0, vy: 0, cooldown: 0 };
  }

  it('picks the surface from the height of the ball', () => {
    expect(surfaceAt(0)).toBe('foot');
    expect(surfaceAt(FOOT_TOP)).toBe('foot');
    expect(surfaceAt(FOOT_TOP + 0.001)).toBe('chest');
    expect(surfaceAt(CHEST_TOP)).toBe('chest');
    expect(surfaceAt(CHEST_TOP + 0.001)).toBe('head');
    expect(surfaceAt(HEAD_TOP)).toBe('head');
    expect(surfaceAt(HEAD_TOP + 0.001)).toBeNull();
  });

  it('shoots hardest and flattest off the foot', () => {
    const hit = ball(0, -40, 10, 0, 0, 0);
    strike(hit, standing(0, 0), 'foot');
    expect(Math.hypot(hit.vx, hit.vy)).toBeCloseTo(FOOT_SPEED, 6);
    expect(hit.vz).toBe(FOOT_LOFT);
    expect(hit.vy).toBeLessThan(0);
  });

  it('kills the pace and the height off the chest', () => {
    const hit = ball(0, -40, 50, 0, -900, -300);
    strike(hit, standing(0, 0), 'chest');
    expect(Math.hypot(hit.vx, hit.vy)).toBeLessThan(FOOT_SPEED / 2);
    expect(Math.hypot(hit.vx, hit.vy)).toBeGreaterThanOrEqual(CHEST_MIN_SPEED - 1e-9);
    expect(hit.vz).toBe(0);
  });

  it('lofts it over a body off the head', () => {
    const hit = ball(0, -40, 80, 0, 0, 0);
    strike(hit, standing(0, 0), 'head');
    expect(Math.hypot(hit.vx, hit.vy)).toBeCloseTo(HEAD_SPEED, 6);
    expect(hit.vz).toBe(HEAD_LOFT);
    // The point of a header: it clears a player standing in the way.
    let cleared = false;
    for (let i = 0; i < 60; i += 1) {
      advanceBall(hit, STEP);
      if (hit.z > HEAD_TOP) cleared = true;
    }
    expect(cleared).toBe(true);
  });

  it("takes some of the striker's run, so the approach is worth something", () => {
    const still = ball(0, -40, 10, 0, 0, 0);
    strike(still, standing(0, 0), 'foot');
    const running = ball(0, -40, 10, 0, 0, 0);
    strike(running, { x: 0, y: 0, vx: 200, vy: 0, cooldown: 0 }, 'foot');
    expect(running.vx).toBeGreaterThan(still.vx);
  });

  it('never puts more than the cap into the ball', () => {
    const hit = ball(0, -40, 10, 0, 0, 0);
    strike(hit, { x: 0, y: 0, vx: 4000, vy: 4000, cooldown: 0 }, 'foot');
    expect(Math.hypot(hit.vx, hit.vy)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-9);
  });

  it('lets a high ball fly clean over a player who cannot reach it', () => {
    const rng = new Rng(12);
    const match = createMatch(rng);
    match.phase = 'playing';
    match.p1.x = 0;
    match.p1.y = 0;
    match.p2.x = 0;
    match.p2.y = 300;
    match.ball.x = 0;
    match.ball.y = -160;
    match.ball.z = HEAD_TOP + 32;
    match.ball.vx = 0;
    match.ball.vy = 500;
    match.ball.vz = 400;
    for (let i = 0; i < 30; i += 1) {
      step(match, STEP, rng);
      expect(match.ball.z, 'the ball dropped into reach on the way').toBeGreaterThan(HEAD_TOP);
    }
    // It went past seat one without being touched.
    expect(match.lastToucher).toBeNull();
    expect(match.ball.y).toBeGreaterThan(0);
  });

  it('does not let one player strike the ball on consecutive steps', () => {
    const rng = new Rng(13);
    const match = createMatch(rng);
    match.phase = 'playing';
    match.p1.x = 0;
    match.p1.y = 0;
    match.p2.x = 0;
    match.p2.y = 400;
    match.ball.x = 0;
    match.ball.y = -PLAYER_RADIUS - 8;
    match.ball.z = 0;
    match.ball.vx = 0;
    match.ball.vy = 40;
    let touches = 0;
    for (let i = 0; i < 12; i += 1) {
      const before = match.p1.cooldown;
      step(match, STEP, rng);
      if (match.p1.cooldown > before) touches += 1;
    }
    expect(touches).toBe(1);
    expect(match.p1.cooldown).toBeLessThanOrEqual(CONTACT_COOLDOWN);
  });
});

describe('the match', () => {
  it('is deterministic on a seed', () => {
    const first = playBots('normal', 'normal', 77);
    const second = playBots('normal', 'normal', 77);
    expect(second).toEqual(first);
  });

  it('puts both seats the same distance from a kick-off, mirrored about the spot', () => {
    const rng = new Rng(3);
    const match = createMatch(rng);
    kickOff(match, rng);
    expect(same(match.p1.x, -match.p2.x)).toBe(true);
    expect(same(match.p1.y, -match.p2.y)).toBe(true);
    expect(match.ball.x).toBe(0);
    expect(match.ball.y).toBe(0);
    expect(match.ball.z).toBe(0);
  });

  it('ends on the whistle when somebody is ahead', () => {
    const rng = new Rng(4);
    const match = createMatch(rng);
    match.phase = 'playing';
    match.score.p1 = 2;
    match.score.p2 = 1;
    match.clock = STEP / 2;
    expect(step(match, STEP, rng)).toBe('over');
    expect(winnerOf(match)).toBe('p1');
  });

  it('goes to golden goal when the whistle finds it level, and once only', () => {
    const rng = new Rng(5);
    const match = createMatch(rng);
    match.phase = 'playing';
    match.clock = STEP / 2;
    step(match, STEP, rng);
    expect(match.extra).toBe(true);
    expect(match.clock).toBeCloseTo(EXTRA_SECONDS, 9);
    expect(winnerOf(match)).toBeNull();

    match.clock = STEP / 2;
    expect(step(match, STEP, rng)).toBe('over');
    expect(winnerOf(match)).toBe('draw');
  });

  it('ends the moment a seat reaches the target', () => {
    const rng = new Rng(6);
    const match = createMatch(rng);
    match.phase = 'playing';
    match.score.p1 = GOAL_TARGET - 1;
    match.ball.x = 0;
    match.ball.y = -PITCH_HALF_H + 40;
    match.ball.z = 0;
    match.ball.vx = 0;
    match.ball.vy = -FOOT_SPEED;
    match.p1.y = 300;
    match.p2.y = 300;
    let ended = false;
    for (let i = 0; i < 30 && !ended; i += 1) ended = step(match, STEP, rng) === 'over';
    expect(ended).toBe(true);
    expect(winnerOf(match)).toBe('p1');
    expect(match.score.p1).toBe(GOAL_TARGET);
  });

  it('advertises a round length the clock can actually keep', () => {
    // `roundSeconds` ends nothing, so the honest thing is for it to describe the clock
    // that does. The worst case is regulation plus golden goal plus the restarts.
    expect(MATCH_SECONDS).toBe(90);
    expect(MATCH_SECONDS + EXTRA_SECONDS).toBeLessThan(600);
  });
});

/**
 * ## Termination
 *
 * The weakest pairing is the one that finds the positions nothing resolves, so this is
 * `easy` against `easy` and not `hard` against anything.
 */
describe('termination', () => {
  it('finishes an easy-against-easy match well inside ten simulated minutes', () => {
    let worst = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const result = playBots('easy', 'easy', 700 + seed);
      expect(result.winner, `seed ${String(seed)} never finished`).not.toBeNull();
      worst = Math.max(worst, result.steps);
    }
    // Measured: the longest of forty is well under two hundred seconds.
    expect(worst).toBeLessThan(60 * 300);
  });

  it('finishes at every pairing of tiers', () => {
    const tiers: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const a of tiers) {
      for (const b of tiers) {
        expect(playBots(a, b, 4242).winner, `${a} vs ${b}`).not.toBeNull();
      }
    }
  });
});

/**
 * ## The ladder
 *
 * Measured over both seat orders and averaged, because first-mover advantage is real and
 * shell-level even in a game with no first move.
 */
describe('the bot ladder', () => {
  /** The stronger tier's share, played from both seats and averaged. */
  function duel(strong: BotDifficulty, weak: BotDifficulty, seeds: number): number {
    let wins = 0;
    for (let seed = 0; seed < seeds; seed += 1) {
      const near = playBots(strong, weak, 5000 + seed);
      if (near.winner === 'p1') wins += 1;
      else if (near.winner === 'draw') wins += 0.5;
      const far = playBots(weak, strong, 5000 + seed);
      if (far.winner === 'p2') wins += 1;
      else if (far.winner === 'draw') wins += 0.5;
    }
    return wins / (seeds * 2);
  }

  it('is monotone: normal beats easy, hard beats normal, hard beats easy', () => {
    const normalOverEasy = duel('normal', 'easy', 24);
    const hardOverNormal = duel('hard', 'normal', 24);
    const hardOverEasy = duel('hard', 'easy', 24);
    expect(normalOverEasy).toBeGreaterThan(0.65);
    expect(hardOverNormal).toBeGreaterThan(0.65);
    expect(hardOverEasy).toBeGreaterThanOrEqual(normalOverEasy - 0.1);
  });

  it('has three genuinely different tiers rather than three labels', () => {
    const profiles: readonly BotProfile[] = Object.values(BOT_PROFILES);
    const keys: readonly (keyof BotProfile)[] = ['reaction', 'horizon', 'approach', 'wobble'];
    for (const key of keys) {
      const values = profiles.map((profile) => profile[key]);
      expect(new Set(values).size, `${key} is the same at every tier`).toBe(3);
    }
    // And every lever is ordered the way the sweep in SPEC.md measured it.
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.horizon).toBeLessThan(BOT_PROFILES.normal.horizon);
    expect(BOT_PROFILES.normal.horizon).toBeLessThan(BOT_PROFILES.hard.horizon);
    expect(BOT_PROFILES.easy.approach).toBeLessThan(BOT_PROFILES.normal.approach);
    expect(BOT_PROFILES.normal.approach).toBeLessThan(BOT_PROFILES.hard.approach);
    expect(BOT_PROFILES.easy.wobble).toBeGreaterThan(BOT_PROFILES.normal.wobble);
    expect(BOT_PROFILES.normal.wobble).toBeGreaterThan(BOT_PROFILES.hard.wobble);
  });

  it('does not saturate: even the losing tier scores', () => {
    let goals = 0;
    for (let seed = 0; seed < 12; seed += 1) goals += playBots('easy', 'hard', 900 + seed).p1;
    expect(goals).toBeGreaterThan(0);
  });
});

/**
 * ## Seat balance
 *
 * Two claims, and they are different claims. The first is structural and exact: a match
 * and its mirror are one match, so seat one takes exactly half of a paired sample. The
 * second is the sampled figure the shell's own aggregate guard measures, where the two
 * seats are fed two different streams of the same generator and the difference between
 * them is a coin.
 */
describe('seat balance', () => {
  it('lays the two seats out as exact half-turns of each other', () => {
    // The structural half of the argument, and the reason the sampled half is a coin
    // rather than a lean: everything a match starts from is its own mirror image.
    const rng = new Rng(11);
    const match = createMatch(rng);
    expect(same(match.p1.x, -match.p2.x)).toBe(true);
    expect(same(match.p1.y, -match.p2.y)).toBe(true);
    expect(goalLineOf('p1')).toBe(-goalLineOf('p2'));
    expect(match.ball.x).toBe(0);
    expect(match.ball.y).toBe(0);
  });

  it("lands inside the shell's 45-55% band on a fresh sample", () => {
    let seatOne = 0;
    const seeds = 90;
    for (let seed = 0; seed < seeds; seed += 1) {
      const result = playBots('normal', 'normal', 20_000 + seed);
      if (result.winner === 'p1') seatOne += 1;
      else if (result.winner === 'draw') seatOne += 0.5;
    }
    const share = seatOne / seeds;
    // Ninety matches carry about 5.3 points of sampling error at one sigma, so this is
    // deliberately looser than the band the aggregate guard applies to a sample five times
    // the size. SPEC.md records the 1600-match figure, which is the one to believe.
    expect(share, `seat one took ${(share * 100).toFixed(1)}%`).toBeGreaterThan(0.36);
    expect(share).toBeLessThan(0.64);
  });
});

describe('driving a player', () => {
  it('normalises a diagonal, so it is not faster', () => {
    const rng = new Rng(8);
    const match = createMatch(rng);
    match.p1.x = 0;
    match.p1.y = 0;
    drive(match, 'p1', 1, 1, STEP);
    expect(Math.hypot(match.p1.vx, match.p1.vy)).toBeCloseTo(PLAYER_SPEED, 9);
    drive(match, 'p1', 0, 3, STEP);
    expect(Math.hypot(match.p1.vx, match.p1.vy)).toBeCloseTo(PLAYER_SPEED, 9);
  });

  it('keeps both players on the pitch', () => {
    const rng = new Rng(9);
    const match = createMatch(rng);
    for (let i = 0; i < 400; i += 1) {
      drive(match, 'p1', 1, 1, STEP);
      drive(match, 'p2', -1, -1, STEP);
    }
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const player = playerOf(match, seat);
      expect(Math.abs(player.x)).toBeLessThanOrEqual(PITCH_HALF_W - PLAYER_RADIUS + 1e-9);
      expect(Math.abs(player.y)).toBeLessThanOrEqual(PITCH_HALF_H - PLAYER_RADIUS + 1e-9);
    }
  });

  it('stands still for a zero direction', () => {
    const rng = new Rng(10);
    const match = createMatch(rng);
    const before = match.p1.x;
    drive(match, 'p1', 0, 0, STEP);
    expect(match.p1.x).toBe(before);
    expect(match.p1.vx).toBe(0);
    expect(match.p1.vy).toBe(0);
  });
});

describe('the drag constants', () => {
  it('are per-second rates rather than per-step multipliers', () => {
    expect(AIR_RATE).toBeCloseTo(-Math.log(0.7), 12);
    expect(ROLL_RATE).toBeCloseTo(-Math.log(0.22), 12);
    // Air is lighter than turf, which is the whole reason lofting it carries.
    expect(AIR_RATE).toBeLessThan(ROLL_RATE);
  });
});
