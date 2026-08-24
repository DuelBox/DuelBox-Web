import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  AIM_SPAN,
  BALL_GRAVITY,
  BALL_RADIUS,
  BASE_PACE,
  BOT_DEADZONE,
  BOT_PROFILES,
  BOUNCE_DRAG,
  BOUNCE_MAX_RISE,
  BOUNCE_Z,
  COURT_HEIGHT,
  COURT_WIDTH,
  JUMP_APEX,
  JUMP_GRAVITY,
  JUMP_HANG,
  JUMP_RISE,
  JUMP_SPEED,
  JUMP_TRIGGER,
  LAND_RECOVERY,
  MATCH_SECONDS,
  MAX_FLIGHT,
  MAX_RALLY_TOUCHES,
  MEET_FLOOR,
  MIN_FLIGHT,
  MOVE_TRANSFER,
  NET_CLEAR,
  NET_CLEARANCE,
  NET_HEIGHT,
  NET_MARGIN,
  NET_Y,
  PACE_GAIN,
  PLACE_MAX_DEPTH,
  PLACE_WIDTH,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  POINT_SECONDS,
  PREDICT_HORIZON,
  RACKET_HEIGHT,
  RACKET_RADIUS,
  RALLY_PACE,
  RALLY_PACE_MAX,
  REACH,
  SERVE_DEPTH,
  SERVE_SECONDS,
  TARGET_MARGIN,
  TARGET_POINTS,
  botIntent,
  canJump,
  canPlay,
  clearingFlight,
  closestApproach,
  contactSeat,
  contactSweetness,
  createBotState,
  createContactRecord,
  createMatch,
  eligibleSeat,
  flightFor,
  forwardOf,
  halfOf,
  instantContact,
  jump,
  movePlayer,
  netClearanceOf,
  otherOf,
  paceFor,
  play,
  playerOf,
  predictIntercept,
  readyY,
  resetBotState,
  resetMatch,
  serve,
  shotFlight,
  sideOf,
  step,
  stepPlayer,
  sweetnessOf,
  takeoffFor,
  winnerOf,
} from './rules.js';
import type {
  Ball,
  BotDifficulty,
  BotProfile,
  Contact,
  Interception,
  Intent,
  Match,
  Player,
} from './rules.js';

const STEP = 1 / 60;

function fresh(seed = 1): Match {
  return createMatch(new Rng(seed));
}

/** Runs the toss out so the ball is live. */
function goLive(match: Match, rng = new Rng(1)): void {
  for (let i = 0; i < 400 && match.phase !== 'rally'; i += 1) step(match, STEP, rng);
}

/** Puts the ball exactly where a test wants it, live. */
function place(match: Match, ball: Ball): void {
  match.phase = 'rally';
  match.timer = 0;
  match.bounces = 0;
  Object.assign(match.ball, ball);
}

/** Runs a seat straight at the ball, wherever it is. */
function chase(match: Match, seat: SeatId): void {
  const player = seat === 'p1' ? match.p1 : match.p2;
  const dx = match.ball.x - player.x;
  const dy = match.ball.y - player.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) movePlayer(match, seat, 0, 0, STEP);
  else movePlayer(match, seat, dx / distance, dy / distance, STEP);
}

const intent: Intent = { dx: 0, dy: 0, jump: false };
const landing: Interception = { x: 0, y: 0, time: 0, height: 0, reachable: false };
const scratch: Contact = createContactRecord();

/** How near the middle of the strings the ball is, spelled out rather than imported. */
function measuredSweetness(match: Readonly<Match>, seat: SeatId): number {
  const ball = match.ball;
  const player = seat === 'p1' ? match.p1 : match.p2;
  const distance = Math.hypot(
    ball.x - player.x,
    ball.y - player.y,
    ball.z - (player.z + RACKET_HEIGHT),
  );
  return Math.max(0, Math.min(1, 1 - distance / REACH));
}

interface Stroke {
  readonly seat: SeatId;
  readonly sweetness: number;
  readonly speed: number;
  readonly airborne: boolean;
}

interface Played {
  readonly winner: SeatId | 'draw' | null;
  readonly elapsed: number;
  readonly strokes: readonly Stroke[];
  readonly rallies: readonly number[];
  readonly points: { p1: number; p2: number };
  readonly longestRally: number;
}

/**
 * Play a whole bot match and **reconstruct** what happened from sampled state.
 *
 * Nothing here reads `match.lastSweet` or `StepResult.sweetness`. A counter can be wrong in
 * exactly the way the rule it counts is wrong — that is how a game ships with its headline
 * mechanic impossible and a full set of green guards — so every number this returns is
 * recomputed from the ball, the players and the score.
 */
function playMatch(p1: BotProfile, p2: BotProfile, seed: number, dt = STEP): Played {
  const rng = new Rng(seed);
  const match = createMatch(rng);
  const botA = createBotState();
  const botB = createBotState();
  const a: Intent = { dx: 0, dy: 0, jump: false };
  const b: Intent = { dx: 0, dy: 0, jump: false };
  const strokes: Stroke[] = [];
  const rallies: number[] = [];
  const points = { p1: 0, p2: 0 };
  let lastToucher = match.lastToucher;
  let lastTouches = match.touches;
  let rally = 0;
  let longest = 0;
  const cap = Math.round((MATCH_SECONDS + 30) / dt);
  for (let i = 0; i < cap && match.winner === null; i += 1) {
    botIntent(a, match, botA, 'p1', p1, dt, rng.float(), rng.float());
    botIntent(b, match, botB, 'p2', p2, dt, rng.float(), rng.float());
    movePlayer(match, 'p1', a.dx, a.dy, dt);
    movePlayer(match, 'p2', b.dx, b.dy, dt);
    if (a.jump) jump(match, 'p1');
    if (b.jump) jump(match, 'p2');
    const before = { p1: match.score.p1, p2: match.score.p2 };
    step(match, dt, rng);
    if (match.touches !== lastTouches && match.lastToucher !== lastToucher) {
      const seat = match.lastToucher;
      const player = seat === 'p1' ? match.p1 : match.p2;
      if (match.phase === 'rally') {
        strokes.push({
          seat,
          sweetness: measuredSweetness(match, seat),
          speed: Math.hypot(match.ball.vx, match.ball.vy),
          airborne: player.z > 0,
        });
        rally += 1;
      }
    }
    lastTouches = match.touches;
    lastToucher = match.lastToucher;
    if (match.score.p1 !== before.p1 || match.score.p2 !== before.p2) {
      if (match.score.p1 !== before.p1) points.p1 += 1;
      else points.p2 += 1;
      rallies.push(rally);
      if (rally > longest) longest = rally;
      rally = 0;
    }
  }
  return {
    winner: match.winner,
    elapsed: match.elapsed,
    strokes,
    rallies,
    points,
    longestRally: longest,
  };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/**
 * The state, reflected top to bottom, with the two seats swapped.
 *
 * The one property the whole split rests on: mirror the court and everything that happens must
 * happen mirrored. Anything that reads `y` without a matching `forwardOf` shows up here and
 * nowhere else, and this repo has shipped a seat-one advantage twice.
 */
function mirror(match: Readonly<Match>): Match {
  const flip = (y: number): number => COURT_HEIGHT - y;
  const flipPlayer = (player: Readonly<Player>): Player => ({
    x: player.x,
    y: flip(player.y),
    z: player.z,
    vx: player.vx,
    vy: -player.vy,
    vz: player.vz,
    recovery: player.recovery,
  });
  return {
    p1: flipPlayer(match.p2),
    p2: flipPlayer(match.p1),
    ball: {
      x: match.ball.x,
      y: flip(match.ball.y),
      z: match.ball.z,
      vx: match.ball.vx,
      vy: -match.ball.vy,
      vz: match.ball.vz,
    },
    score: { p1: match.score.p2, p2: match.score.p1 },
    phase: match.phase,
    timer: match.timer,
    server: otherOf(match.server),
    lastToucher: otherOf(match.lastToucher),
    touches: match.touches,
    bounces: match.bounces,
    lastSweet: match.lastSweet,
    scorer: match.scorer === null ? null : otherOf(match.scorer),
    aimX: match.aimX,
    aimY: flip(match.aimY),
    elapsed: match.elapsed,
    winner: match.winner === null || match.winner === 'draw' ? match.winner : otherOf(match.winner),
  };
}

/**
 * How far a reflected simulation may sit from the mirrored original, in logical units.
 *
 * It cannot be zero, and the reason is worth writing down because the obvious repair is to set
 * it to zero and chase the difference into the physics, where it is not.
 *
 * `COURT_HEIGHT - y` is not an involution in binary floating point. p2's court runs 0 to 500
 * and p1's runs 500 to 1000, and the lower range is spaced twice as finely — so a point on one
 * half reflects onto a point the other half cannot represent, and reflecting it back lands
 * somewhere else. `220.1` is such a point: flip it twice and it moves by 2.8e-14. In real
 * arithmetic the simulation is exactly symmetric — every `y` term in `rules.ts` is paired with
 * a `forwardOf` — and what is left is the *representation* leaning half an ulp at a time, then
 * compounding through a chaotic rally.
 *
 * A hundredth of a unit is the bound because it sits far above the drift measured over the
 * whole match below and far under anything the game can express: a step of running is 5.3
 * units, the ball is 14 across, the strings are 52. A real asymmetry — a missing `forwardOf`,
 * a bound short by a player radius — is tens or hundreds of units and trips this on the first
 * step it happens.
 */
const MIRROR_TOLERANCE = 1e-2;

/** Everything about a state that must match its mirror **exactly**, and nothing continuous. */
function discreteFingerprint(match: Readonly<Match>): string {
  return [
    match.phase,
    match.server,
    match.lastToucher,
    String(match.touches),
    String(match.bounces),
    `${String(match.score.p1)}-${String(match.score.p2)}`,
    String(match.scorer),
    String(match.winner),
  ].join('|');
}

/** The widest gap between two states that should be identical, in logical units. */
function widestGap(actual: Readonly<Match>, expected: Readonly<Match>): number {
  const pairs: readonly (readonly [number, number])[] = [
    [actual.ball.x, expected.ball.x],
    [actual.ball.y, expected.ball.y],
    [actual.ball.z, expected.ball.z],
    [actual.ball.vx, expected.ball.vx],
    [actual.ball.vy, expected.ball.vy],
    [actual.ball.vz, expected.ball.vz],
    [actual.p1.x, expected.p1.x],
    [actual.p1.y, expected.p1.y],
    [actual.p1.z, expected.p1.z],
    [actual.p2.x, expected.p2.x],
    [actual.p2.y, expected.p2.y],
    [actual.p2.z, expected.p2.z],
    [actual.aimX, expected.aimX],
    [actual.aimY, expected.aimY],
  ];
  let worst = 0;
  for (const [a, b] of pairs) {
    const gap = Math.abs(a - b);
    if (gap > worst) worst = gap;
  }
  return worst;
}

/** Everything a step could have changed, as a comparable string. */
function fingerprint(match: Readonly<Match>): string {
  const round = (value: number): string => value.toFixed(9);
  return [
    round(match.ball.x),
    round(match.ball.y),
    round(match.ball.z),
    round(match.ball.vx),
    round(match.ball.vy),
    round(match.ball.vz),
    round(match.p1.x),
    round(match.p1.y),
    round(match.p1.z),
    round(match.p2.x),
    round(match.p2.y),
    round(match.p2.z),
    round(match.aimX),
    round(match.aimY),
    discreteFingerprint(match),
  ].join('|');
}

describe('the court', () => {
  it('gives each seat a half, and the two are exact mirrors about the net', () => {
    const bottom = halfOf('p1');
    const top = halfOf('p2');
    expect(bottom.minY + top.maxY).toBe(COURT_HEIGHT);
    expect(bottom.maxY + top.minY).toBe(COURT_HEIGHT);
    expect(bottom.minX).toBe(top.minX);
    expect(bottom.maxX).toBe(top.maxX);
    expect(bottom.maxY - bottom.minY).toBe(top.maxY - top.minY);
  });

  it('keeps both halves clear of the net line', () => {
    expect(halfOf('p1').minY).toBeGreaterThan(NET_Y);
    expect(halfOf('p2').maxY).toBeLessThan(NET_Y);
    expect(halfOf('p1').minY - NET_Y).toBe(PLAYER_RADIUS);
  });

  it('splits the court at the net, giving the line itself to p1', () => {
    expect(sideOf(NET_Y)).toBe('p1');
    expect(sideOf(NET_Y - 0.0001)).toBe('p2');
    expect(sideOf(COURT_HEIGHT)).toBe('p1');
    expect(sideOf(0)).toBe('p2');
  });

  it('points each seat at the other', () => {
    expect(forwardOf('p1')).toBe(-1);
    expect(forwardOf('p2')).toBe(1);
    expect(forwardOf('p1') + forwardOf('p2')).toBe(0);
  });

  it('mirrors the two ready positions', () => {
    expect(readyY('p1') + readyY('p2')).toBe(COURT_HEIGHT);
    expect(sideOf(readyY('p1'))).toBe('p1');
    expect(sideOf(readyY('p2'))).toBe('p2');
  });

  it('has two seats and swaps between them', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('hands back the right player for a seat', () => {
    const match = fresh();
    expect(playerOf(match, 'p1')).toBe(match.p1);
    expect(playerOf(match, 'p2')).toBe(match.p2);
  });

  it('aims every shot inside its own markings', () => {
    expect(NET_CLEAR).toBeGreaterThan(0);
    expect(PLACE_MAX_DEPTH).toBeLessThanOrEqual(NET_Y - TARGET_MARGIN);
    expect(PLACE_WIDTH).toBeLessThanOrEqual(COURT_WIDTH / 2 - TARGET_MARGIN);
  });

  it('starts level with nobody having won', () => {
    const match = fresh();
    expect(match.score.p1).toBe(0);
    expect(match.score.p2).toBe(0);
    expect(winnerOf(match)).toBeNull();
    expect(match.phase).toBe('serving');
  });

  it('resets in place', () => {
    const match = fresh(3);
    match.score.p1 = 2;
    match.score.p2 = 1;
    match.elapsed = 90;
    match.winner = 'p1';
    resetMatch(match, new Rng(9));
    expect(match.score.p1).toBe(0);
    expect(match.score.p2).toBe(0);
    expect(match.elapsed).toBe(0);
    expect(match.winner).toBeNull();
    expect(match.phase).toBe('serving');
  });
});

describe('running', () => {
  it('moves at the declared speed and no faster', () => {
    const match = fresh();
    match.p1.x = 300;
    match.p1.y = 800;
    movePlayer(match, 'p1', 1, 0, STEP);
    expect(match.p1.x).toBeCloseTo(300 + PLAYER_SPEED * STEP, 9);
  });

  it('caps a diagonal, so two directions do not out-run one', () => {
    const match = fresh();
    match.p1.x = 300;
    match.p1.y = 800;
    movePlayer(match, 'p1', 1, 1, STEP);
    const moved = Math.hypot(match.p1.x - 300, match.p1.y - 800);
    expect(moved).toBeCloseTo(PLAYER_SPEED * STEP, 6);
  });

  it('leaves a half-pressed intent half', () => {
    const match = fresh();
    match.p1.x = 300;
    movePlayer(match, 'p1', 0.5, 0, STEP);
    expect(match.p1.x - 300).toBeCloseTo(0.5 * PLAYER_SPEED * STEP, 9);
  });

  it('never lets a player cross the net, however long a key is held', () => {
    const match = fresh();
    for (let i = 0; i < 600; i += 1) movePlayer(match, 'p1', 0, -1, STEP);
    expect(match.p1.y).toBe(halfOf('p1').minY);
    for (let i = 0; i < 600; i += 1) movePlayer(match, 'p2', 0, 1, STEP);
    expect(match.p2.y).toBe(halfOf('p2').maxY);
  });

  it('never lets a player leave the court sideways', () => {
    const match = fresh();
    for (let i = 0; i < 600; i += 1) movePlayer(match, 'p1', -1, 0, STEP);
    expect(match.p1.x).toBe(halfOf('p1').minX);
    for (let i = 0; i < 600; i += 1) movePlayer(match, 'p1', 1, 0, STEP);
    expect(match.p1.x).toBe(halfOf('p1').maxX);
  });

  it('reports the motion it actually managed, not the motion asked for', () => {
    const match = fresh();
    match.p1.y = halfOf('p1').minY;
    movePlayer(match, 'p1', 0, -1, STEP);
    expect(match.p1.vy).toBe(0);
    match.p1.y = 800;
    movePlayer(match, 'p1', 0, -1, STEP);
    expect(match.p1.vy).toBeCloseTo(-PLAYER_SPEED, 6);
  });

  it('survives a zero delta without dividing by zero', () => {
    const match = fresh();
    movePlayer(match, 'p1', 1, 1, 0);
    expect(Number.isFinite(match.p1.vx)).toBe(true);
    expect(match.p1.vx).toBe(0);
    expect(match.p1.vy).toBe(0);
  });

  it('runs at the same speed in the air as on the ground', () => {
    // Deliberate: the cost of a jump is that the strings go up with you, which is a far
    // heavier price than a movement penalty and needs no second rule.
    const grounded = fresh();
    grounded.p1.x = 300;
    movePlayer(grounded, 'p1', 1, 0, STEP);
    const airborne = fresh();
    airborne.p1.x = 300;
    airborne.p1.z = 40;
    movePlayer(airborne, 'p1', 1, 0, STEP);
    expect(airborne.p1.x).toBe(grounded.p1.x);
  });
});

describe('the jump', () => {
  it('leaves the ground when asked', () => {
    const match = fresh();
    expect(canJump(match, 'p1')).toBe(true);
    expect(jump(match, 'p1')).toBe(true);
    expect(match.p1.vz).toBe(JUMP_SPEED);
  });

  it('refuses a second jump while still in the air', () => {
    const match = fresh();
    jump(match, 'p1');
    stepPlayer(match.p1, STEP);
    expect(match.p1.z).toBeGreaterThan(0);
    expect(canJump(match, 'p1')).toBe(false);
    expect(jump(match, 'p1')).toBe(false);
  });

  it('reaches the declared apex and no higher', () => {
    const match = fresh();
    jump(match, 'p1');
    let peak = 0;
    for (let i = 0; i < 200; i += 1) {
      stepPlayer(match.p1, STEP);
      if (match.p1.z > peak) peak = match.p1.z;
      if (match.p1.z <= 0 && i > 2) break;
    }
    expect(peak).toBeLessThanOrEqual(JUMP_APEX + 1e-9);
    expect(peak).toBeGreaterThan(JUMP_APEX - 2);
  });

  it('spends the declared time in the air', () => {
    const match = fresh();
    jump(match, 'p1');
    let seconds = 0;
    for (let i = 0; i < 400; i += 1) {
      stepPlayer(match.p1, STEP);
      seconds += STEP;
      if (match.p1.z <= 0) break;
    }
    expect(seconds).toBeGreaterThan(JUMP_HANG - STEP * 2);
    expect(seconds).toBeLessThan(JUMP_HANG + STEP * 2);
  });

  it('lands flat, with a cooldown, and then may go again', () => {
    const match = fresh();
    jump(match, 'p1');
    for (let i = 0; i < 400 && (match.p1.z > 0 || match.p1.vz > 0); i += 1) {
      stepPlayer(match.p1, STEP);
    }
    expect(match.p1.z).toBe(0);
    expect(match.p1.vz).toBe(0);
    expect(match.p1.recovery).toBeGreaterThan(0);
    expect(canJump(match, 'p1')).toBe(false);
    for (let i = 0; i < 200 && match.p1.recovery > 0; i += 1) stepPlayer(match.p1, STEP);
    expect(match.p1.recovery).toBe(0);
    expect(canJump(match, 'p1')).toBe(true);
  });

  it('leaves the same cooldown at 60, 90 and 120 Hz', () => {
    // The landing is solved to the exact instant inside the step rather than snapped to the
    // step boundary, so a device running at another rate does not hand a player a fractionally
    // different cooldown — which would be a different game, however slightly.
    const settle = (rate: number): number => {
      const player: Player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: JUMP_SPEED, recovery: 0 };
      const dt = 1 / rate;
      let elapsed = 0;
      for (let i = 0; i < rate * 3; i += 1) {
        stepPlayer(player, dt);
        elapsed += dt;
        if (player.z <= 0 && player.vz <= 0) break;
      }
      // Time already spent on the ground, which is what the cooldown has to account for.
      return elapsed - (LAND_RECOVERY - player.recovery);
    };
    expect(settle(90)).toBeCloseTo(settle(60), 6);
    expect(settle(120)).toBeCloseTo(settle(60), 6);
  });

  it('does not extend a player reach, it moves it', () => {
    // The whole point of the button: the strings are a fixed ball around a point that goes up
    // with you, so jumping trades the low balls for the high ones rather than adding to both.
    const match = fresh();
    place(match, { x: 300, y: 800, z: RACKET_HEIGHT, vx: 0, vy: 0, vz: 0 });
    match.p1.x = 300;
    match.p1.y = 800;
    match.lastToucher = 'p2';
    expect(canPlay(match, 'p1')).toBe(true);
    match.p1.z = JUMP_APEX;
    expect(canPlay(match, 'p1')).toBe(false);
    match.ball.z = RACKET_HEIGHT + JUMP_APEX;
    expect(canPlay(match, 'p1')).toBe(true);
  });

  it('solves the takeoff that puts the strings on the ball on the way up', () => {
    for (const height of [5, 20, 40, JUMP_APEX - 1]) {
      const takeoff = takeoffFor(height);
      const reached = JUMP_SPEED * takeoff - (JUMP_GRAVITY * takeoff * takeoff) / 2;
      expect(reached).toBeCloseTo(height, 6);
      expect(takeoff).toBeLessThanOrEqual(JUMP_RISE + 1e-9);
    }
    expect(takeoffFor(0)).toBe(0);
    expect(takeoffFor(JUMP_APEX + 50)).toBe(JUMP_RISE);
  });

  it('takes the same jump for both seats', () => {
    const match = fresh();
    jump(match, 'p1');
    jump(match, 'p2');
    for (let i = 0; i < 60; i += 1) {
      stepPlayer(match.p1, STEP);
      stepPlayer(match.p2, STEP);
      expect(match.p2.z).toBe(match.p1.z);
    }
  });
});

describe('the strings', () => {
  it('measures sweetness from the middle outward', () => {
    expect(sweetnessOf(0)).toBe(1);
    expect(sweetnessOf(REACH)).toBe(0);
    expect(sweetnessOf(REACH / 2)).toBeCloseTo(0.5, 9);
    expect(sweetnessOf(REACH * 2)).toBe(0);
    expect(sweetnessOf(-5)).toBe(1);
  });

  it('measures it in three dimensions, around the middle of the strings', () => {
    const player: Player = { x: 300, y: 800, z: 0, vx: 0, vy: 0, vz: 0, recovery: 0 };
    const dead: Ball = { x: 300, y: 800, z: RACKET_HEIGHT, vx: 0, vy: 0, vz: 0 };
    expect(contactSweetness(dead, player)).toBe(1);
    const low: Ball = { ...dead, z: RACKET_HEIGHT - REACH / 2 };
    expect(contactSweetness(low, player)).toBeCloseTo(0.5, 9);
    const wide: Ball = { ...dead, x: 300 + REACH / 2 };
    expect(contactSweetness(wide, player)).toBeCloseTo(0.5, 9);
  });

  it('stands the net where the clearance arithmetic assumes it does', () => {
    expect(NET_CLEARANCE).toBe(NET_HEIGHT + BALL_RADIUS);
    expect(NET_HEIGHT).toBeGreaterThan(0);
    expect(NET_HEIGHT).toBeLessThan(RACKET_HEIGHT);
  });

  it('spans the band a standing player can reach, and no more', () => {
    expect(MEET_FLOOR).toBe(RACKET_HEIGHT - REACH);
    expect(REACH).toBe(RACKET_RADIUS + BALL_RADIUS);
    expect(RACKET_HEIGHT + REACH).toBeLessThan(RACKET_HEIGHT + JUMP_APEX + REACH);
  });

  it('finds the nearest point on the path, not the nearest sample of it', () => {
    // The ball crosses the strings from one side to the other in a single step. Sampled at the
    // boundary it looks like a frame contact both times; on the path it went through the
    // middle.
    const out = createContactRecord();
    closestApproach(out, -60, 0, 0, 60, 0, 0);
    expect(out.distance).toBeCloseTo(0, 9);
    expect(out.when).toBeCloseTo(0.5, 9);
  });

  it('reports a contact still closing as being at the end of the step', () => {
    const out = createContactRecord();
    closestApproach(out, 100, 0, 0, 30, 0, 0);
    expect(out.when).toBe(1);
    expect(out.distance).toBeCloseTo(30, 9);
  });

  it('reports a contact already opening as being at the start of the step', () => {
    const out = createContactRecord();
    closestApproach(out, 20, 0, 0, 90, 0, 0);
    expect(out.when).toBe(0);
    expect(out.distance).toBeCloseTo(20, 9);
  });

  it('swings at once when the ball is holding station on the strings', () => {
    const out = createContactRecord();
    closestApproach(out, 10, 0, 0, 10, 0, 0);
    expect(out.when).toBe(0);
    expect(out.distance).toBeCloseTo(10, 9);
  });

  it('finds the perpendicular miss distance of a crossing ball', () => {
    const out = createContactRecord();
    closestApproach(out, -50, 20, 0, 50, 20, 0);
    expect(out.distance).toBeCloseTo(20, 9);
    expect(out.when).toBeCloseTo(0.5, 9);
  });
});

describe('who may strike the ball', () => {
  function ready(seed = 5): Match {
    const match = fresh(seed);
    place(match, { x: 300, y: 800, z: RACKET_HEIGHT, vx: 0, vy: 0, vz: 0 });
    match.p1.x = 300;
    match.p1.y = 800;
    match.p2.x = 300;
    match.p2.y = 200;
    match.lastToucher = 'p2';
    match.touches = 2;
    return match;
  }

  it('lets the seat whose court it is over play it', () => {
    const match = ready();
    expect(eligibleSeat(match)).toBe('p1');
    expect(canPlay(match, 'p1')).toBe(true);
    expect(contactSeat(match)).toBe('p1');
  });

  it('refuses a second touch from the same seat', () => {
    const match = ready();
    match.lastToucher = 'p1';
    expect(eligibleSeat(match)).toBeNull();
    expect(canPlay(match, 'p1')).toBe(false);
    expect(contactSeat(match)).toBeNull();
  });

  it('refuses a reach across the net', () => {
    const match = ready();
    // p1 stands on their own line; the ball sits just over it on p2's court.
    match.p1.y = halfOf('p1').minY;
    match.ball.y = NET_Y - 1;
    match.ball.x = match.p1.x;
    match.ball.z = RACKET_HEIGHT;
    expect(Math.hypot(match.ball.y - match.p1.y, 0)).toBeLessThan(REACH);
    expect(canPlay(match, 'p1')).toBe(false);
  });

  it('refuses a ball over its head', () => {
    const match = ready();
    match.ball.z = RACKET_HEIGHT + REACH + 1;
    expect(canPlay(match, 'p1')).toBe(false);
  });

  it('refuses a ball rolling under the strings', () => {
    const match = ready();
    match.ball.z = MEET_FLOOR - 1;
    expect(canPlay(match, 'p1')).toBe(false);
  });

  it('refuses a ball out of reach across the court', () => {
    const match = ready();
    match.ball.x = match.p1.x + REACH + 1;
    expect(canPlay(match, 'p1')).toBe(false);
  });

  it('refuses every touch once the rally cap is reached', () => {
    const match = ready();
    match.touches = MAX_RALLY_TOUCHES;
    expect(eligibleSeat(match)).toBeNull();
    expect(canPlay(match, 'p1')).toBe(false);
    expect(canPlay(match, 'p2')).toBe(false);
  });
});

describe('the shot', () => {
  function struck(setup: (match: Match) => void, seat: SeatId = 'p1'): Match {
    const match = fresh(11);
    place(match, { x: 300, y: 820, z: RACKET_HEIGHT, vx: 0, vy: 0, vz: 0 });
    match.p1.x = 300;
    match.p1.y = 820;
    match.p2.x = 300;
    match.p2.y = 180;
    match.lastToucher = otherOf(seat);
    match.touches = 2;
    setup(match);
    play(match, seat, instantContact(scratch, match, seat));
    return match;
  }

  it('sends the ball over the net into the other half', () => {
    const match = struck(() => {});
    expect(sideOf(match.aimY)).toBe('p2');
    expect(match.ball.vy).toBeLessThan(0);
  });

  it('sends it right when met on the right, left when met on the left', () => {
    const right = struck((match) => {
      match.ball.x = match.p1.x + REACH * 0.8;
    });
    const left = struck((match) => {
      match.ball.x = match.p1.x - REACH * 0.8;
    });
    expect(right.aimX).toBeGreaterThan(COURT_WIDTH / 2);
    expect(left.aimX).toBeLessThan(COURT_WIDTH / 2);
    expect(right.aimX - COURT_WIDTH / 2).toBeCloseTo(COURT_WIDTH / 2 - left.aimX, 6);
  });

  it('sends it deep when met in front, short when it has got behind', () => {
    const infront = struck((match) => {
      match.ball.y = match.p1.y - REACH * 0.8;
    });
    const behind = struck((match) => {
      match.ball.y = match.p1.y + REACH * 0.8;
    });
    expect(NET_Y - infront.aimY).toBeGreaterThan(NET_Y - behind.aimY);
  });

  it('never aims outside the other half, however badly it was met', () => {
    for (const dx of [-1, -0.5, 0, 0.5, 1]) {
      for (const dy of [-1, -0.5, 0, 0.5, 1]) {
        const match = struck((m) => {
          m.ball.x = m.p1.x + REACH * dx;
          m.ball.y = m.p1.y + REACH * dy;
        });
        expect(match.aimX).toBeGreaterThanOrEqual(TARGET_MARGIN);
        expect(match.aimX).toBeLessThanOrEqual(COURT_WIDTH - TARGET_MARGIN);
        expect(sideOf(match.aimY)).toBe('p2');
        expect(NET_Y - match.aimY).toBeGreaterThanOrEqual(NET_CLEAR - 1e-9);
        expect(NET_Y - match.aimY).toBeLessThanOrEqual(PLACE_MAX_DEPTH + 1e-9);
      }
    }
  });

  it('takes some of the runner with it', () => {
    const still = struck(() => {});
    const running = struck((match) => {
      match.p1.vx = PLAYER_SPEED;
    });
    expect(running.aimX).toBeGreaterThan(still.aimX);
    expect(running.aimX - still.aimX).toBeCloseTo(MOVE_TRANSFER * PLACE_WIDTH, 6);
  });

  it('reaches the widest angle before the ball reaches the frame', () => {
    // AIM_SPAN: full width comes from a contact part-way out, so a shot into the corner still
    // carries most of its pace. That partial uncoupling is what stops two even players from
    // rallying for ever.
    const match = struck((m) => {
      m.ball.x = m.p1.x + REACH * AIM_SPAN;
    });
    expect(match.aimX).toBeCloseTo(COURT_WIDTH / 2 + PLACE_WIDTH, 6);
    expect(match.lastSweet).toBeGreaterThan(0.2);
  });

  it('counts the touch, takes ownership and clears the bounce count', () => {
    const match = struck((m) => {
      m.bounces = 1;
    });
    expect(match.touches).toBe(3);
    expect(match.lastToucher).toBe('p1');
    expect(match.bounces).toBe(0);
  });

  it('launches from where the ball met the strings rather than the step boundary', () => {
    const match = fresh(12);
    place(match, { x: 300, y: 820, z: RACKET_HEIGHT, vx: 0, vy: 0, vz: 0 });
    match.p1.x = 300;
    match.p1.y = 820;
    match.lastToucher = 'p2';
    const contact: Contact = createContactRecord();
    contact.x = 260;
    contact.y = 780;
    contact.z = 90;
    contact.offX = 0;
    contact.offY = 0;
    contact.offZ = 0;
    contact.distance = 0;
    contact.when = 0.5;
    play(match, 'p1', contact);
    expect(match.ball.x).toBe(260);
    expect(match.ball.y).toBe(780);
    expect(match.ball.z).toBe(90);
  });

  it('handles a ball on the middle of the strings without producing a nonsense shot', () => {
    const match = struck(() => {});
    expect(Number.isFinite(match.ball.vx)).toBe(true);
    expect(Number.isFinite(match.ball.vy)).toBe(true);
    expect(Number.isFinite(match.ball.vz)).toBe(true);
    expect(match.lastSweet).toBe(1);
  });
});

describe('pace', () => {
  it('gives the middle of the strings more pace than the frame', () => {
    expect(paceFor(0, 1)).toBeCloseTo(BASE_PACE * (1 + PACE_GAIN), 9);
    expect(paceFor(0, 0)).toBeCloseTo(BASE_PACE, 9);
    expect(paceFor(0, 1) / paceFor(0, 0)).toBeCloseTo(1 + PACE_GAIN, 9);
  });

  it('rises with sweetness at every point in between', () => {
    let previous = 0;
    for (let sweet = 0; sweet <= 1.0001; sweet += 0.1) {
      const pace = paceFor(3, sweet);
      expect(pace).toBeGreaterThan(previous);
      previous = pace;
    }
  });

  it('clamps a nonsense sweetness rather than trusting it', () => {
    expect(paceFor(0, -3)).toBe(paceFor(0, 0));
    expect(paceFor(0, 9)).toBe(paceFor(0, 1));
  });

  it('escalates through a rally and then stops escalating', () => {
    expect(paceFor(1, 0.5)).toBeGreaterThan(paceFor(0, 0.5));
    const ceiling = paceFor(Math.ceil(RALLY_PACE_MAX / RALLY_PACE), 0.5);
    expect(paceFor(MAX_RALLY_TOUCHES, 0.5)).toBeCloseTo(ceiling, 9);
    expect(ceiling / paceFor(0, 0.5)).toBeCloseTo(1 + RALLY_PACE_MAX, 9);
  });

  it('turns pace into a flight time over the distance actually travelled', () => {
    expect(flightFor(0, 0, 620)).toBeCloseTo(620 / paceFor(0, 0), 9);
    expect(flightFor(0, 1, 620)).toBeLessThan(flightFor(0, 0, 620));
  });

  it('floors and caps the flight, and neither is reached in play', () => {
    expect(flightFor(0, 1, 1)).toBe(MIN_FLIGHT);
    expect(flightFor(0, 0, 100000)).toBe(MAX_FLIGHT);
    expect(MIN_FLIGHT).toBeLessThan(MAX_FLIGHT);
  });
});

describe('clearing the net', () => {
  it('agrees with the simulation about how high a shot passes the net', () => {
    // The closed form is what `clearingFlight` inverts, so it has to be the same arithmetic
    // the ball actually flies. Checked against the ball rather than against a remembered
    // number.
    const match = fresh(21);
    place(match, { x: 300, y: 860, z: 70, vx: 0, vy: 0, vz: 0 });
    match.p1.x = 300;
    match.p1.y = 860;
    match.lastToucher = 'p2';
    match.touches = 2;
    play(match, 'p1', instantContact(scratch, match, 'p1'));

    const flight = (match.aimY - match.ball.y) / match.ball.vy;
    const predicted = netClearanceOf(
      match.ball.z,
      Math.abs(NET_Y - match.ball.y),
      Math.abs(match.aimY - match.ball.y),
      flight,
    );
    const timeToNet = (NET_Y - match.ball.y) / match.ball.vy;
    const actual =
      match.ball.z + match.ball.vz * timeToNet - (BALL_GRAVITY * timeToNet * timeToNet) / 2;
    expect(predicted).toBeCloseTo(actual, 6);
  });

  it('inverts that formula: the flight it returns clears by exactly the margin', () => {
    for (const height of [0, 30, 76, 140]) {
      for (const netDistance of [80, 200, 380]) {
        const target = netDistance + 260;
        const flight = clearingFlight(height, netDistance, target);
        if (flight === 0 || flight === MAX_FLIGHT) continue;
        const clearance = netClearanceOf(height, netDistance, target, flight);
        expect(clearance).toBeCloseTo(NET_CLEARANCE + NET_MARGIN, 6);
      }
    }
  });

  it('asks for nothing when the ball is already high enough', () => {
    expect(clearingFlight(500, 380, 640)).toBe(0);
  });

  it('cannot lift a ball that is below the net and standing on it', () => {
    expect(clearingFlight(10, 0, 300)).toBe(MAX_FLIGHT);
    expect(clearingFlight(NET_CLEARANCE + NET_MARGIN + 1, 0, 300)).toBe(0);
  });

  it('demands a longer flight the lower the ball was met', () => {
    const high = clearingFlight(120, 380, 640);
    const low = clearingFlight(40, 380, 640);
    expect(low).toBeGreaterThan(high);
  });

  it('throttles a shot that would be too flat, and leaves a safe one alone', () => {
    const wanted = flightFor(2, 1, 640);
    const throttled = shotFlight(2, 1, 20, 380, 640, 640);
    expect(throttled).toBeGreaterThan(wanted);
    const safe = shotFlight(2, 0, 120, 380, 640, 640);
    expect(safe).toBeCloseTo(flightFor(2, 0, 640), 9);
  });

  it('never returns more than the flight ceiling', () => {
    expect(shotFlight(0, 0, 0, 1, 300, 900)).toBeLessThanOrEqual(MAX_FLIGHT);
  });

  it('means a struck ball almost always clears, which is why hitting well is not a mistake', () => {
    // The inverted-ladder bug: without this floor the harder a bot struck the ball, the flatter
    // its arc and the more often it found the net — `hard` put 21% of its shots into it against
    // `normal`'s 11% and lost the series. Driven here over whole matches rather than asserted
    // on the formula.
    let netted = 0;
    let strikes = 0;
    for (let seed = 0; seed < 6; seed += 1) {
      const rng = new Rng(4000 + seed * 17);
      const match = createMatch(rng);
      const botA = createBotState();
      const botB = createBotState();
      const a: Intent = { dx: 0, dy: 0, jump: false };
      const b: Intent = { dx: 0, dy: 0, jump: false };
      for (let i = 0; i < 60 * 200 && match.winner === null; i += 1) {
        botIntent(a, match, botA, 'p1', BOT_PROFILES.hard, STEP, rng.float(), rng.float());
        botIntent(b, match, botB, 'p2', BOT_PROFILES.hard, STEP, rng.float(), rng.float());
        movePlayer(match, 'p1', a.dx, a.dy, STEP);
        movePlayer(match, 'p2', b.dx, b.dy, STEP);
        if (a.jump) jump(match, 'p1');
        if (b.jump) jump(match, 'p2');
        const outcome = step(match, STEP, rng);
        if (outcome.touched !== null) strikes += 1;
        if (outcome.netted) netted += 1;
      }
    }
    expect(strikes).toBeGreaterThan(80);
    expect(netted / strikes).toBeLessThan(0.05);
  });
});

describe('the serve', () => {
  it('hangs still before it is released', () => {
    const match = fresh(7);
    expect(match.phase).toBe('serving');
    const x = match.ball.x;
    const y = match.ball.y;
    const z = match.ball.z;
    step(match, STEP, new Rng(1));
    expect(match.ball.x).toBe(x);
    expect(match.ball.y).toBe(y);
    expect(match.ball.z).toBe(z);
    expect(match.timer).toBeCloseTo(SERVE_SECONDS - STEP, 9);
  });

  it('goes over the net into the receiver half, from either seat', () => {
    for (const server of ['p1', 'p2'] as const) {
      for (let seed = 0; seed < 24; seed += 1) {
        const match = fresh(seed + 1);
        match.server = server;
        serve(match, new Rng(seed * 31 + 1));
        expect(sideOf(match.aimY)).toBe(otherOf(server));
        goLive(match, new Rng(2));
        let crossed = false;
        for (let i = 0; i < 240 && !crossed; i += 1) {
          step(match, STEP, new Rng(2));
          if (sideOf(match.ball.y) === otherOf(server)) crossed = true;
        }
        expect(crossed, `serve from ${server} seed ${String(seed)}`).toBe(true);
      }
    }
  });

  it('clears the net rather than clipping it, over many seeds', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const match = fresh(seed + 1);
      match.server = seed % 2 === 0 ? 'p1' : 'p2';
      serve(match, new Rng(seed * 17 + 3));
      const flight = (match.aimY - match.ball.y) / match.ball.vy;
      const clearance = netClearanceOf(
        match.ball.z,
        Math.abs(NET_Y - match.ball.y),
        Math.abs(match.aimY - match.ball.y),
        flight,
      );
      expect(clearance, `seed ${String(seed)}`).toBeGreaterThan(NET_CLEARANCE);
    }
  });

  it('lands inside the court', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const match = fresh(seed + 1);
      serve(match, new Rng(seed * 13 + 5));
      expect(match.aimX).toBeGreaterThanOrEqual(TARGET_MARGIN);
      expect(match.aimX).toBeLessThanOrEqual(COURT_WIDTH - TARGET_MARGIN);
      expect(match.aimY).toBeGreaterThan(0);
      expect(match.aimY).toBeLessThan(COURT_HEIGHT);
    }
  });

  it('opens on a coin flip rather than always the same seat', () => {
    const servers = new Set<SeatId>();
    for (let seed = 0; seed < 40; seed += 1) servers.add(fresh(seed + 1).server);
    expect(servers.size).toBe(2);
  });

  it('counts as the first touch, by the server', () => {
    const match = fresh(4);
    expect(match.touches).toBe(1);
    expect(match.lastToucher).toBe(match.server);
    expect(match.bounces).toBe(0);
  });

  it('puts both players on their marks, mirrored about the net', () => {
    const match = fresh(6);
    match.server = 'p1';
    match.p1.z = 40;
    match.p1.recovery = 0.1;
    serve(match, new Rng(2));
    expect(match.p1.y).toBe(NET_Y + SERVE_DEPTH);
    expect(match.p2.y).toBe(readyY('p2'));
    expect(match.p1.z).toBe(0);
    expect(match.p1.recovery).toBe(0);
    expect(match.p1.x).toBe(COURT_WIDTH / 2);
  });

  it('is served by whoever lost the point', () => {
    const match = fresh(8);
    goLive(match);
    let scored: SeatId | null = null;
    for (let i = 0; i < 60 * 40 && scored === null; i += 1) {
      const outcome = step(match, STEP, new Rng(3));
      scored = outcome.scored;
    }
    expect(scored).not.toBeNull();
    expect(match.server).toBe(otherOf(scored as SeatId));
  });
});

describe('the ball', () => {
  it('always comes down, whatever it was hit at', () => {
    const match = fresh(9);
    place(match, { x: 300, y: 400, z: 200, vx: 0, vy: 0, vz: 900 });
    match.lastToucher = 'p1';
    match.touches = MAX_RALLY_TOUCHES;
    let bounced = false;
    for (let i = 0; i < 60 * 20 && !bounced; i += 1) {
      bounced = step(match, STEP, new Rng(1)).bounced > 0;
    }
    expect(bounced).toBe(true);
  });

  it('pulls the ball down at the declared rate', () => {
    const match = fresh(9);
    place(match, { x: 300, y: 400, z: 300, vx: 0, vy: 0, vz: 0 });
    match.lastToucher = 'p1';
    match.touches = MAX_RALLY_TOUCHES;
    step(match, STEP, new Rng(1));
    expect(match.ball.vz).toBeCloseTo(-BALL_GRAVITY * STEP, 9);
    expect(match.ball.z).toBeCloseTo(300 - (BALL_GRAVITY * STEP * STEP) / 2, 9);
  });

  it('bounces, keeping the declared share of its pace', () => {
    const match = fresh(9);
    place(match, { x: 300, y: 300, z: 0.0001, vx: 200, vy: -100, vz: -400 });
    match.lastToucher = 'p1';
    match.touches = MAX_RALLY_TOUCHES;
    const outcome = step(match, STEP, new Rng(1));
    expect(outcome.bounced).toBe(1);
    expect(match.ball.vz).toBeGreaterThan(0);
    expect(match.ball.vx).toBeCloseTo(200 * BOUNCE_DRAG, 6);
    expect(match.ball.vy).toBeCloseTo(-100 * BOUNCE_DRAG, 6);
  });

  it('never leaves the court faster than the ceiling allows', () => {
    const match = fresh(9);
    place(match, { x: 300, y: 300, z: 0.0001, vx: 0, vy: 0, vz: -5000 });
    match.lastToucher = 'p1';
    match.touches = MAX_RALLY_TOUCHES;
    step(match, STEP, new Rng(1));
    expect(match.ball.vz).toBeLessThanOrEqual(BOUNCE_MAX_RISE);
    expect(5000 * BOUNCE_Z).toBeGreaterThan(BOUNCE_MAX_RISE);
  });

  it('resolves the bounce at the same instant at 60, 90 and 120 Hz', () => {
    // Snapping the ball to the court at the step boundary loses a different sliver of the
    // rebound at every rate, and rule 8 says a phone and a laptop must step the identical
    // match. The bounce is solved on the parabola instead.
    const after = (rate: number, seconds: number): string => {
      const ball: Ball = { x: 100, y: 300, z: 90, vx: 220, vy: -140, vz: -260 };
      const match = fresh(9);
      place(match, ball);
      match.lastToucher = 'p1';
      match.touches = MAX_RALLY_TOUCHES;
      const dt = 1 / rate;
      for (let i = 0; i < Math.round(rate * seconds); i += 1) step(match, dt, new Rng(1));
      return [
        match.ball.x.toFixed(5),
        match.ball.y.toFixed(5),
        match.ball.z.toFixed(5),
        match.ball.vz.toFixed(5),
      ].join(',');
    };
    expect(after(90, 0.4)).toBe(after(60, 0.4));
    expect(after(120, 0.4)).toBe(after(60, 0.4));
  });

  it('turns a low ball back on the side it came from', () => {
    const match = fresh(9);
    place(match, { x: 300, y: NET_Y + 7, z: 10, vx: 0, vy: -600, vz: 0 });
    match.lastToucher = 'p1';
    match.touches = 4;
    const outcome = step(match, STEP, new Rng(1));
    expect(outcome.netted).toBe(true);
    expect(sideOf(match.ball.y)).toBe('p1');
    expect(match.ball.vy).toBeGreaterThan(0);
  });

  it('lets a high ball straight over', () => {
    const match = fresh(9);
    place(match, { x: 300, y: NET_Y + 7, z: NET_CLEARANCE + 40, vx: 0, vy: -600, vz: 0 });
    match.lastToucher = 'p1';
    match.touches = 4;
    const outcome = step(match, STEP, new Rng(1));
    expect(outcome.netted).toBe(false);
    expect(sideOf(match.ball.y)).toBe('p2');
  });

  it('will not let a fast flat ball tunnel through the net', () => {
    const match = fresh(9);
    // Thirty units a step, which is more than the net is thick in any drawing of it.
    place(match, { x: 300, y: NET_Y + 30, z: 12, vx: 0, vy: -2400, vz: 0 });
    match.lastToucher = 'p1';
    match.touches = 4;
    const outcome = step(match, STEP, new Rng(1));
    expect(outcome.netted).toBe(true);
  });

  it('reads the height at the crossing off the parabola, not off a chord under it', () => {
    // A chord between two step endpoints always sits below a falling arc, so a chord test
    // fails balls that in fact cleared. The ball here is rising through the net line.
    const match = fresh(9);
    place(match, {
      x: 300,
      y: NET_Y + 20,
      z: NET_CLEARANCE - 6,
      vx: 0,
      vy: -1200,
      vz: 900,
    });
    match.lastToucher = 'p1';
    match.touches = 4;
    const outcome = step(match, STEP, new Rng(1));
    expect(outcome.netted).toBe(false);
  });
});

describe('scoring', () => {
  it('gives the point away when the ball bounces twice on your court', () => {
    const match = fresh(13);
    place(match, { x: 300, y: 800, z: 4, vx: 0, vy: 0, vz: -200 });
    match.lastToucher = 'p2';
    match.touches = MAX_RALLY_TOUCHES;
    let scored: SeatId | null = null;
    for (let i = 0; i < 60 * 10 && scored === null; i += 1) {
      scored = step(match, STEP, new Rng(1)).scored;
    }
    expect(scored).toBe('p2');
    expect(match.score.p2).toBe(1);
    expect(match.phase).toBe('point');
  });

  it('lets the ball bounce once and be played after it', () => {
    // One bounce a side, as in the real game. The receiver stands out of reach while the ball
    // comes down, so the contact can only be the one on the way back up.
    const match = fresh(13);
    place(match, { x: 300, y: 800, z: 200, vx: 0, vy: 0, vz: -300 });
    match.p1.x = halfOf('p1').maxX;
    match.p1.y = 960;
    match.p2.x = 300;
    match.p2.y = 200;
    match.lastToucher = 'p2';
    match.touches = 2;
    let bounces = 0;
    for (let i = 0; i < 60 * 4 && bounces === 0; i += 1) {
      bounces += step(match, STEP, new Rng(1)).bounced;
    }
    expect(bounces).toBe(1);
    expect(match.bounces).toBe(1);

    match.p1.x = match.ball.x;
    match.p1.y = match.ball.y;
    let touched: SeatId | null = null;
    for (let i = 0; i < 60 * 2 && touched === null; i += 1) {
      touched = step(match, STEP, new Rng(1)).touched;
      match.p1.x = match.ball.x;
      match.p1.y = match.ball.y;
    }
    expect(touched).toBe('p1');
    expect(match.bounces).toBe(0);
  });

  it('gives the point away when you put the ball out', () => {
    const match = fresh(13);
    place(match, { x: COURT_WIDTH - 2, y: 800, z: 40, vx: 2000, vy: 0, vz: 0 });
    match.lastToucher = 'p2';
    match.touches = MAX_RALLY_TOUCHES;
    let scored: SeatId | null = null;
    for (let i = 0; i < 60 * 5 && scored === null; i += 1) {
      scored = step(match, STEP, new Rng(1)).scored;
    }
    expect(scored).toBe('p2');
  });

  it('pauses after a point and then serves again', () => {
    const match = fresh(13);
    place(match, { x: 300, y: 800, z: 2, vx: 0, vy: 0, vz: -400 });
    match.lastToucher = 'p2';
    match.touches = MAX_RALLY_TOUCHES;
    for (let i = 0; i < 60 * 10 && match.phase !== 'point'; i += 1) step(match, STEP, new Rng(1));
    expect(match.phase).toBe('point');
    expect(match.timer).toBeCloseTo(POINT_SECONDS, 6);
    for (let i = 0; i < 60 * 4 && match.phase === 'point'; i += 1) step(match, STEP, new Rng(1));
    expect(match.phase).toBe('serving');
  });

  it('is won at four, through the shared helper', () => {
    const match = fresh(13);
    match.score.p1 = TARGET_POINTS - 1;
    expect(winnerOf(match)).toBeNull();
    match.score.p1 = TARGET_POINTS;
    step(match, STEP, new Rng(1));
    expect(match.winner).toBe('p1');
    expect(match.phase).toBe('over');
  });

  it('is called on the clock, and drawn when the two are level', () => {
    const level = fresh(13);
    level.score.p1 = 2;
    level.score.p2 = 2;
    level.elapsed = MATCH_SECONDS;
    step(level, STEP, new Rng(1));
    expect(level.winner).toBe('draw');

    const ahead = fresh(13);
    ahead.score.p1 = 3;
    ahead.score.p2 = 1;
    ahead.elapsed = MATCH_SECONDS;
    step(ahead, STEP, new Rng(1));
    expect(ahead.winner).toBe('p1');
  });

  it('hands back one result record rather than allocating one a step', () => {
    const match = fresh(13);
    const first = step(match, STEP, new Rng(1));
    const second = step(match, STEP, new Rng(1));
    expect(second).toBe(first);
  });

  it('stops simulating once it is over', () => {
    const match = fresh(13);
    match.winner = 'p1';
    match.phase = 'over';
    const before = fingerprint(match);
    for (let i = 0; i < 30; i += 1) step(match, STEP, new Rng(1));
    expect(fingerprint(match)).toBe(before);
  });
});

describe('a rally always ends', () => {
  it('never exceeds the hard cap on touches', () => {
    for (let seed = 0; seed < 8; seed += 1) {
      const rng = new Rng(700 + seed * 11);
      const match = createMatch(rng);
      const botA = createBotState();
      const botB = createBotState();
      const a: Intent = { dx: 0, dy: 0, jump: false };
      const b: Intent = { dx: 0, dy: 0, jump: false };
      for (let i = 0; i < 60 * 200 && match.winner === null; i += 1) {
        botIntent(a, match, botA, 'p1', BOT_PROFILES.hard, STEP, rng.float(), rng.float());
        botIntent(b, match, botB, 'p2', BOT_PROFILES.hard, STEP, rng.float(), rng.float());
        movePlayer(match, 'p1', a.dx, a.dy, STEP);
        movePlayer(match, 'p2', b.dx, b.dy, STEP);
        if (a.jump) jump(match, 'p1');
        if (b.jump) jump(match, 'p2');
        step(match, STEP, rng);
        expect(match.touches).toBeLessThanOrEqual(MAX_RALLY_TOUCHES);
      }
      expect(match.winner).not.toBeNull();
    }
  });

  it('resolves a dead ball nobody may touch', () => {
    const match = fresh(14);
    place(match, { x: 300, y: 800, z: 120, vx: 0, vy: 0, vz: 0 });
    match.p1.x = 300;
    match.p1.y = 800;
    match.p2.x = 300;
    match.p2.y = 200;
    match.touches = MAX_RALLY_TOUCHES;
    match.lastToucher = 'p2';
    let scored: SeatId | null = null;
    for (let i = 0; i < 60 * 10 && scored === null; i += 1) {
      scored = step(match, STEP, new Rng(1)).scored;
    }
    expect(scored).toBe('p2');
  });

  it('is finished by two easy bots well inside the guard budget', { timeout: 120_000 }, () => {
    let worst = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const played = playMatch(BOT_PROFILES.easy, BOT_PROFILES.easy, 6000 + seed * 13);
      expect(played.winner).not.toBeNull();
      if (played.elapsed > worst) worst = played.elapsed;
    }
    // The guard allows ten simulated minutes; this has never needed forty seconds.
    expect(worst).toBeLessThan(90);
  });

  it('is finished by two hard bots, who miss far less', { timeout: 120_000 }, () => {
    let worst = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const played = playMatch(BOT_PROFILES.hard, BOT_PROFILES.hard, 8000 + seed * 13);
      expect(played.winner).not.toBeNull();
      if (played.elapsed > worst) worst = played.elapsed;
    }
    expect(worst).toBeLessThan(90);
  });

  it('keeps the ball inside the court for a whole match', () => {
    const rng = new Rng(4321);
    const match = createMatch(rng);
    const botA = createBotState();
    const botB = createBotState();
    const a: Intent = { dx: 0, dy: 0, jump: false };
    const b: Intent = { dx: 0, dy: 0, jump: false };
    for (let i = 0; i < 60 * 200 && match.winner === null; i += 1) {
      botIntent(a, match, botA, 'p1', BOT_PROFILES.normal, STEP, rng.float(), rng.float());
      botIntent(b, match, botB, 'p2', BOT_PROFILES.normal, STEP, rng.float(), rng.float());
      movePlayer(match, 'p1', a.dx, a.dy, STEP);
      movePlayer(match, 'p2', b.dx, b.dy, STEP);
      if (a.jump) jump(match, 'p1');
      if (b.jump) jump(match, 'p2');
      step(match, STEP, rng);
      expect(match.ball.x).toBeGreaterThan(-COURT_WIDTH);
      expect(match.ball.x).toBeLessThan(COURT_WIDTH * 2);
      expect(match.ball.y).toBeGreaterThan(-COURT_HEIGHT);
      expect(match.ball.y).toBeLessThan(COURT_HEIGHT * 2);
      expect(match.ball.z).toBeGreaterThanOrEqual(0);
      expect(match.ball.z).toBeLessThan(1200);
    }
    expect(match.winner).not.toBeNull();
  });

  it('multiplies out to a bound far inside the guard ceiling', () => {
    // The arithmetic, written down rather than assumed. The gap between two touches is at most
    // one full flight plus one full bounce hang; a rally is at most MAX_RALLY_TOUCHES of those;
    // a point adds the toss and the pause; and a first-to-four match is at most seven points.
    const bounceHang = (2 * BOUNCE_MAX_RISE) / BALL_GRAVITY;
    const betweenTouches = MAX_FLIGHT + bounceHang;
    const rally = MAX_RALLY_TOUCHES * betweenTouches;
    const point = SERVE_SECONDS + rally + POINT_SECONDS;
    const match = (TARGET_POINTS * 2 - 1) * point;
    expect(bounceHang).toBeCloseTo(0.646, 3);
    expect(betweenTouches).toBeCloseTo(2.246, 3);
    expect(match).toBeLessThan(600);
    // And the clock cuts it far shorter than that in any case.
    expect(MATCH_SECONDS).toBeLessThan(600);
  });
});

describe('the headline verb', () => {
  /**
   * The mechanic this game is named after, measured rather than assumed.
   *
   * Spin War shipped with its own headline verb — pushing a top out of the bowl — impossible,
   * across four hundred bot matches, with every global guard green the whole time, because a
   * match still ended and still reported a winner. So this drives whole seeded matches and
   * reconstructs three things from sampled state: that rallies happen, that both seats score,
   * and that a contact through the middle of the strings genuinely sends the ball away faster
   * than one off the frame. `playMatch` never reads `lastSweet` or `StepResult.sweetness`.
   */
  const tiers: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('has rallies, and both seats score, at every tier', { timeout: 240_000 }, () => {
    for (const tier of tiers) {
      const rallies: number[] = [];
      const points = { p1: 0, p2: 0 };
      let longest = 0;
      for (let seed = 0; seed < 30; seed += 1) {
        const played = playMatch(BOT_PROFILES[tier], BOT_PROFILES[tier], 9100 + seed * 11);
        rallies.push(...played.rallies);
        points.p1 += played.points.p1;
        points.p2 += played.points.p2;
        if (played.longestRally > longest) longest = played.longestRally;
      }
      expect(points.p1, `${tier}: p1 never scored`).toBeGreaterThan(10);
      expect(points.p2, `${tier}: p2 never scored`).toBeGreaterThan(10);
      expect(mean(rallies), `${tier}: mean rally`).toBeGreaterThan(1);
      expect(longest, `${tier}: longest rally`).toBeGreaterThanOrEqual(5);
      const capped = rallies.filter((r) => r >= MAX_RALLY_TOUCHES - 1).length;
      expect(capped / rallies.length, `${tier}: rallies decided by the cap`).toBeLessThan(0.05);
    }
  });

  it('sends a centred contact away measurably faster', { timeout: 240_000 }, () => {
    for (const tier of tiers) {
      const strokes: Stroke[] = [];
      for (let seed = 0; seed < 30; seed += 1) {
        strokes.push(
          ...playMatch(BOT_PROFILES[tier], BOT_PROFILES[tier], 9200 + seed * 11).strokes,
        );
      }
      const centre = strokes.filter((s) => s.sweetness >= 0.66).map((s) => s.speed);
      const edge = strokes.filter((s) => s.sweetness <= 0.33).map((s) => s.speed);
      expect(centre.length, `${tier}: no centred contact ever happened`).toBeGreaterThan(20);
      expect(edge.length, `${tier}: no frame contact ever happened`).toBeGreaterThan(20);
      const ratio = mean(centre) / mean(edge);
      expect(
        ratio,
        `${tier}: centre ${mean(centre).toFixed(0)} vs edge ${mean(edge).toFixed(0)}`,
      ).toBeGreaterThan(1.25);
    }
  });

  it('leaves the ground, and strikes the ball while it is up there', { timeout: 240_000 }, () => {
    // The other half of the observed rule. A tier that never jumped would still rally, still
    // score, and still pass every guard in the repository.
    for (const tier of tiers) {
      let airborne = 0;
      let total = 0;
      for (let seed = 0; seed < 20; seed += 1) {
        const played = playMatch(BOT_PROFILES[tier], BOT_PROFILES[tier], 9300 + seed * 11);
        for (const stroke of played.strokes) {
          total += 1;
          if (stroke.airborne) airborne += 1;
        }
      }
      expect(airborne, `${tier}: never struck a ball off the ground`).toBeGreaterThan(5);
      expect(total).toBeGreaterThan(50);
    }
  });
});

describe('determinism', () => {
  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const rng = new Rng(4242);
      const match = createMatch(rng);
      const bot = createBotState();
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        botIntent(intent, match, bot, 'p1', BOT_PROFILES.normal, STEP, rng.float(), rng.float());
        movePlayer(match, 'p1', intent.dx, intent.dy, STEP);
        if (intent.jump) jump(match, 'p1');
        step(match, STEP, rng);
        if (i % 30 === 0) out.push(fingerprint(match));
      }
      return out.join('#');
    };
    expect(trace()).toBe(trace());
  });

  it('puts the ball in the same place at 60, 90 and 120 Hz', () => {
    // Nothing here decays per step: the ball has gravity and no drag, a player moves at a rate,
    // and both heights are integrated analytically rather than by one Euler step. So the same
    // half-second of flight has to end in the same place whatever the device runs at.
    const after = (rate: number, seconds: number): string => {
      const match = fresh(8);
      place(match, { x: 200, y: 300, z: 60, vx: 120, vy: 320, vz: 380 });
      match.lastToucher = 'p1';
      match.touches = MAX_RALLY_TOUCHES;
      const dt = 1 / rate;
      for (let i = 0; i < Math.round(rate * seconds); i += 1) step(match, dt, new Rng(1));
      return [
        match.ball.x.toFixed(6),
        match.ball.y.toFixed(6),
        match.ball.z.toFixed(6),
        match.ball.vz.toFixed(6),
      ].join(',');
    };
    expect(after(120, 0.4)).toBe(after(60, 0.4));
    expect(after(90, 0.4)).toBe(after(60, 0.4));
  });

  it('runs the clock in seconds, not in steps', () => {
    const slow = fresh();
    for (let i = 0; i < 60; i += 1) step(slow, 1 / 60, new Rng(1));
    const fast = fresh();
    for (let i = 0; i < 120; i += 1) step(fast, 1 / 120, new Rng(1));
    expect(fast.elapsed).toBeCloseTo(slow.elapsed, 9);
  });

  it('draws every random number from the seeded stream', () => {
    const first = fresh(99);
    const second = fresh(99);
    expect(fingerprint(second)).toBe(fingerprint(first));
    expect(fingerprint(fresh(100))).not.toBe(fingerprint(first));
  });
});

describe('the two seats are the same game', () => {
  it('mirrors: the same rally, reflected, produces the reflected result', () => {
    // The fairness test. Several games in this repo shipped a seat-one advantage that only
    // this kind of check found. Every decision is compared to the bit; the measurements are
    // compared to MIRROR_TOLERANCE, and the note there says why that cannot be zero.
    const original = fresh(21);
    place(original, { x: 220, y: 620, z: 90, vx: 40, vy: 60, vz: 120 });
    original.lastToucher = 'p2';
    original.touches = 3;
    original.p1.x = 240;
    original.p1.y = 700;
    original.p2.x = 410;
    original.p2.y = 300;

    const reflected = mirror(original);

    let steps = 0;
    let touches = 0;
    let points = 0;
    let jumps = 0;
    let worstGap = 0;
    for (let i = 0; i < 60 * 200; i += 1) {
      // Both seats chase the ball and jump for it, which is an intent expressed in the state
      // rather than in coordinates — so it needs no mirroring of its own and cannot smuggle a
      // bias in.
      for (const match of [original, reflected]) {
        chase(match, 'p1');
        chase(match, 'p2');
        for (const seat of ['p1', 'p2'] as const) {
          const player = seat === 'p1' ? match.p1 : match.p2;
          const near = Math.hypot(match.ball.x - player.x, match.ball.y - player.y) < REACH * 2;
          if (near && match.ball.z > player.z + RACKET_HEIGHT + REACH && jump(match, seat)) {
            jumps += 1;
          }
        }
      }
      const first = step(original, STEP, new Rng(5));
      const firstTouched = first.touched;
      const firstNetted = first.netted;
      const firstScored = first.scored;
      const firstBounced = first.bounced;
      const second = step(reflected, STEP, new Rng(5));
      if (firstTouched !== null) touches += 1;
      if (firstScored !== null) points += 1;
      expect(second.netted, `step ${String(i)}`).toBe(firstNetted);
      expect(second.bounced, `step ${String(i)}`).toBe(firstBounced);
      expect(second.touched === null ? null : otherOf(second.touched), `step ${String(i)}`).toBe(
        firstTouched,
      );
      expect(second.scored === null ? null : otherOf(second.scored), `step ${String(i)}`).toBe(
        firstScored,
      );

      const mirrored = mirror(original);
      expect(discreteFingerprint(reflected), `step ${String(i)}`).toBe(
        discreteFingerprint(mirrored),
      );
      const gap = widestGap(reflected, mirrored);
      if (gap > worstGap) worstGap = gap;
      expect(gap, `step ${String(i)}`).toBeLessThan(MIRROR_TOLERANCE);
      steps += 1;
      if (original.phase === 'over') break;
    }
    expect(steps, 'and it ran a real match, not two idle frames').toBeGreaterThan(300);
    expect(touches, 'with the ball actually struck by both seats').toBeGreaterThan(1);
    expect(jumps, 'and both seats leaving the ground').toBeGreaterThan(1);
    expect(points, 'and every point of a whole match, not one rally').toBe(TARGET_POINTS);
    expect(original.winner, 'which it played out to a result').not.toBeNull();
    expect(
      worstGap,
      `the widest the two ever sat apart was ${worstGap.toExponential(1)} units`,
    ).toBeLessThan(MIRROR_TOLERANCE);
  });

  it('cannot be checked to the bit, because reflecting a coordinate is not exact', () => {
    // Why the test above carries a tolerance, pinned so nobody takes it back to zero and then
    // goes looking for the bias in the physics, where there is not one.
    const flip = (y: number): number => COURT_HEIGHT - y;
    const onP2Court = 220.1;
    expect(sideOf(onP2Court)).toBe('p2');
    expect(flip(flip(onP2Court))).not.toBe(onP2Court);
    expect(Math.abs(flip(flip(onP2Court)) - onP2Court)).toBeLessThan(1e-12);
  });

  it('serves a mirror-image serve from either seat', () => {
    const asP1 = fresh(31);
    asP1.server = 'p1';
    serve(asP1, new Rng(77));
    const asP2 = fresh(31);
    asP2.server = 'p2';
    serve(asP2, new Rng(77));

    expect(asP2.ball.y).toBeCloseTo(COURT_HEIGHT - asP1.ball.y, 9);
    expect(asP2.ball.x).toBeCloseTo(asP1.ball.x, 9);
    expect(asP2.ball.vy).toBeCloseTo(-asP1.ball.vy, 9);
    expect(asP2.ball.vz).toBeCloseTo(asP1.ball.vz, 9);
    expect(asP2.aimY).toBeCloseTo(COURT_HEIGHT - asP1.aimY, 9);
  });

  it('plays a mirror-image shot from either seat', () => {
    const asP1 = fresh(41);
    place(asP1, { x: 260, y: 700, z: 60, vx: 0, vy: 0, vz: -80 });
    asP1.p1.x = 300;
    asP1.p1.y = 740;
    asP1.lastToucher = 'p2';
    asP1.touches = 3;
    play(asP1, 'p1', instantContact(scratch, asP1, 'p1'));

    const asP2 = fresh(41);
    place(asP2, { x: 260, y: COURT_HEIGHT - 700, z: 60, vx: 0, vy: 0, vz: -80 });
    asP2.p2.x = 300;
    asP2.p2.y = COURT_HEIGHT - 740;
    asP2.lastToucher = 'p1';
    asP2.touches = 3;
    play(asP2, 'p2', instantContact(scratch, asP2, 'p2'));

    expect(asP2.aimX).toBeCloseTo(asP1.aimX, 9);
    expect(asP2.aimY).toBeCloseTo(COURT_HEIGHT - asP1.aimY, 9);
    expect(asP2.ball.vy).toBeCloseTo(-asP1.ball.vy, 9);
    expect(asP2.ball.vz).toBeCloseTo(asP1.ball.vz, 9);
    expect(asP2.lastSweet).toBeCloseTo(asP1.lastSweet, 9);
  });

  it('gives both seats the same racket and the same jump', () => {
    const match = fresh(43);
    const ball: Ball = { x: 300, y: NET_Y + 40, z: RACKET_HEIGHT + 10, vx: 0, vy: 0, vz: 0 };
    match.p1.x = 300;
    match.p1.y = NET_Y + 40;
    const forP1 = contactSweetness(ball, match.p1);
    match.p2.x = 300;
    match.p2.y = NET_Y - 40;
    const mirroredBall: Ball = { ...ball, y: NET_Y - 40 };
    const forP2 = contactSweetness(mirroredBall, match.p2);
    expect(forP2).toBeCloseTo(forP1, 12);
  });
});

describe('the prediction', () => {
  it('finds where a ball is coming down on its own side', () => {
    const match = fresh(51);
    place(match, { x: 300, y: 300, z: 60, vx: 0, vy: 400, vz: 500 });
    predictIntercept(landing, match.ball, 'p1', 300, 800, PLAYER_SPEED, 200, 2, PREDICT_HORIZON);
    expect(landing.reachable).toBe(true);
    expect(sideOf(landing.y)).toBe('p1');
    expect(landing.time).toBeGreaterThan(0);
  });

  it('runs the same physics the simulation does, so the net turns a low ball back', () => {
    const match = fresh(51);
    place(match, { x: 300, y: NET_Y + 26, z: 8, vx: 0, vy: -900, vz: 0 });
    predictIntercept(landing, match.ball, 'p2', 300, 200, PLAYER_SPEED, 300, 2, PREDICT_HORIZON);
    // Deflected off the net, the ball never reaches p2 at all.
    expect(landing.reachable).toBe(false);
    expect(sideOf(landing.y)).toBe('p1');
  });

  it('knows about the bounce, and can meet a ball after it', () => {
    const match = fresh(51);
    place(match, { x: 300, y: 700, z: 40, vx: 0, vy: 60, vz: -300 });
    predictIntercept(landing, match.ball, 'p1', 300, 720, PLAYER_SPEED, 300, 2, PREDICT_HORIZON);
    expect(landing.reachable).toBe(true);
  });

  it('says so when it cannot get there', () => {
    const match = fresh(51);
    place(match, { x: 40, y: 560, z: 60, vx: 0, vy: 40, vz: -40 });
    predictIntercept(
      landing,
      match.ball,
      'p1',
      COURT_WIDTH - 40,
      960,
      PLAYER_SPEED,
      200,
      2,
      PREDICT_HORIZON,
    );
    expect(landing.reachable).toBe(false);
  });

  it('meets the ball higher the higher up the arc it is willing to go', () => {
    const match = fresh(51);
    place(match, { x: 300, y: 700, z: 210, vx: 0, vy: 10, vz: -20 });
    const patient: Interception = { x: 0, y: 0, time: 0, height: 0, reachable: false };
    const eager: Interception = { x: 0, y: 0, time: 0, height: 0, reachable: false };
    predictIntercept(patient, match.ball, 'p1', 300, 700, PLAYER_SPEED, 60, 2, PREDICT_HORIZON);
    predictIntercept(eager, match.ball, 'p1', 300, 700, PLAYER_SPEED, 150, 2, PREDICT_HORIZON);
    expect(eager.height).toBeGreaterThan(patient.height);
    expect(eager.time).toBeLessThan(patient.time);
  });

  it('never reports a spot on the other seat half', () => {
    const rng = new Rng(515);
    for (let i = 0; i < 200; i += 1) {
      const match = fresh(i + 1);
      place(match, {
        x: rng.float() * COURT_WIDTH,
        y: rng.float() * COURT_HEIGHT,
        z: rng.float() * 200,
        vx: (rng.float() - 0.5) * 600,
        vy: (rng.float() - 0.5) * 1200,
        vz: (rng.float() - 0.5) * 600,
      });
      predictIntercept(landing, match.ball, 'p1', 300, 800, PLAYER_SPEED, 140, 2, PREDICT_HORIZON);
      if (landing.reachable) expect(sideOf(landing.y)).toBe('p1');
    }
  });

  it('gives up when the ball is already dead', () => {
    const match = fresh(51);
    place(match, { x: 300, y: 700, z: 30, vx: 0, vy: 0, vz: -200 });
    predictIntercept(landing, match.ball, 'p1', 300, 700, PLAYER_SPEED, 300, 1, PREDICT_HORIZON);
    // One bounce left: after it the point is over, so the walk stops there.
    expect(landing.time).toBeLessThan(PREDICT_HORIZON);
  });
});

describe('the bot', () => {
  it('declares its tiers in a sensible order', () => {
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.error).toBeGreaterThan(BOT_PROFILES.normal.error);
    expect(BOT_PROFILES.normal.error).toBeGreaterThan(BOT_PROFILES.hard.error);
    expect(BOT_PROFILES.easy.meetCeiling).toBeLessThan(BOT_PROFILES.normal.meetCeiling);
    expect(BOT_PROFILES.normal.meetCeiling).toBeLessThan(BOT_PROFILES.hard.meetCeiling);
    expect(BOT_PROFILES.easy.jumpEarly).toBeGreaterThan(BOT_PROFILES.normal.jumpEarly);
    expect(BOT_PROFILES.normal.jumpEarly).toBeGreaterThan(BOT_PROFILES.hard.jumpEarly);
  });

  it('never reacts faster than a person', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      expect(BOT_PROFILES[tier].reaction).toBeGreaterThanOrEqual(0.12);
    }
  });

  it('never runs, reaches or jumps further than a person', () => {
    // The tiers differ in judgement and timing only; every physical number they use is the
    // one the human player uses, and there is no per-tier override anywhere.
    const profiles = Object.values(BOT_PROFILES);
    for (const profile of profiles) {
      expect(Object.keys(profile).sort()).toEqual([
        'error',
        'jumpEarly',
        'meetCeiling',
        'reaction',
      ]);
    }
  });

  it('commits to a misjudgement per shot rather than re-rolling it every step', () => {
    // The mistake `@duelbox/game-sdk`'s bot-judgement module exists to prevent: a fresh error
    // sixty times a second averages to zero and every tier plays the same.
    const match = fresh(61);
    goLive(match);
    const state = createBotState();
    const spots: number[] = [];
    for (let i = 0; i < 90; i += 1) {
      botIntent(intent, match, state, 'p2', BOT_PROFILES.easy, STEP, 0.9, 0.1);
      spots.push(state.biasX);
    }
    expect(new Set(spots).size).toBe(1);
    expect(Math.abs(state.biasX)).toBeGreaterThan(0);
  });

  it('does not answer a new shot on the step it was struck', () => {
    const match = fresh(62);
    goLive(match);
    const state = createBotState();
    botIntent(intent, match, state, 'p1', BOT_PROFILES.easy, STEP, 0.5, 0.5);
    const before = state.aimX;
    match.touches += 1;
    match.lastToucher = 'p2';
    botIntent(intent, match, state, 'p1', BOT_PROFILES.easy, STEP, 0.2, 0.8);
    expect(state.aimX).toBe(before);
  });

  it('holds still once it is on its spot', () => {
    const match = fresh(63);
    const state = createBotState();
    state.shot = match.touches;
    state.aimX = match.p1.x;
    state.aimY = match.p1.y;
    state.look.decided = true;
    state.look.remaining = 10;
    botIntent(intent, match, state, 'p1', BOT_PROFILES.hard, STEP, 0.5, 0.5);
    expect(intent.dx).toBe(0);
    expect(intent.dy).toBe(0);
  });

  it('asks for a direction, never a distance', () => {
    const match = fresh(64);
    const state = createBotState();
    state.shot = match.touches;
    state.aimX = match.p1.x + 400;
    state.aimY = match.p1.y;
    state.look.decided = true;
    state.look.remaining = 10;
    botIntent(intent, match, state, 'p1', BOT_PROFILES.hard, STEP, 0.5, 0.5);
    expect(Math.hypot(intent.dx, intent.dy)).toBeCloseTo(1, 9);
    expect(BOT_DEADZONE).toBeGreaterThan(0);
  });

  it('stays inside its own half over a whole match', () => {
    const rng = new Rng(6543);
    const match = createMatch(rng);
    const botA = createBotState();
    const botB = createBotState();
    const a: Intent = { dx: 0, dy: 0, jump: false };
    const b: Intent = { dx: 0, dy: 0, jump: false };
    for (let i = 0; i < 60 * 150 && match.winner === null; i += 1) {
      botIntent(a, match, botA, 'p1', BOT_PROFILES.hard, STEP, rng.float(), rng.float());
      botIntent(b, match, botB, 'p2', BOT_PROFILES.hard, STEP, rng.float(), rng.float());
      movePlayer(match, 'p1', a.dx, a.dy, STEP);
      movePlayer(match, 'p2', b.dx, b.dy, STEP);
      if (a.jump) jump(match, 'p1');
      if (b.jump) jump(match, 'p2');
      step(match, STEP, rng);
      expect(match.p1.y).toBeGreaterThanOrEqual(halfOf('p1').minY);
      expect(match.p2.y).toBeLessThanOrEqual(halfOf('p2').maxY);
      expect(match.p1.z).toBeLessThanOrEqual(JUMP_APEX + 1e-9);
      expect(match.p2.z).toBeLessThanOrEqual(JUMP_APEX + 1e-9);
    }
  });

  it('goes back to the middle once the ball is not its problem', () => {
    const match = fresh(65);
    goLive(match);
    match.lastToucher = 'p1';
    const state = createBotState();
    for (let i = 0; i < 60; i += 1) {
      botIntent(intent, match, state, 'p1', BOT_PROFILES.hard, STEP, 0.5, 0.5);
    }
    expect(state.aimX).toBe(COURT_WIDTH / 2);
    expect(state.aimY).toBe(readyY('p1'));
    expect(state.meetLift).toBe(0);
  });

  it('leaves the ground only for a ball above where the strings hang', () => {
    const match = fresh(66);
    place(match, { x: 300, y: 700, z: 220, vx: 0, vy: 20, vz: -40 });
    match.p1.x = 300;
    match.p1.y = 700;
    match.lastToucher = 'p2';
    match.touches = 2;
    const state = createBotState();
    let jumped = false;
    for (let i = 0; i < 120 && !jumped; i += 1) {
      botIntent(intent, match, state, 'p1', BOT_PROFILES.hard, STEP, 0.5, 0.5);
      if (intent.jump) jumped = true;
      movePlayer(match, 'p1', intent.dx, intent.dy, STEP);
      if (intent.jump) jump(match, 'p1');
      step(match, STEP, new Rng(1));
    }
    expect(jumped).toBe(true);
    expect(JUMP_TRIGGER).toBeGreaterThan(0);
  });

  it('stays on the ground for a ball it can meet standing', () => {
    const match = fresh(67);
    place(match, { x: 300, y: 700, z: RACKET_HEIGHT, vx: 0, vy: 10, vz: 0 });
    match.p1.x = 300;
    match.p1.y = 640;
    match.lastToucher = 'p2';
    match.touches = 2;
    const state = createBotState();
    for (let i = 0; i < 30; i += 1) {
      botIntent(intent, match, state, 'p1', BOT_PROFILES.hard, STEP, 0.5, 0.5);
      expect(intent.jump).toBe(false);
    }
  });

  it('clears its state on reset', () => {
    const state = createBotState();
    state.aimX = 12;
    state.aimY = 34;
    state.biasX = 5;
    state.biasY = 6;
    state.meetTime = 1;
    state.meetLift = 2;
    state.leapt = true;
    state.shot = 9;
    resetBotState(state);
    expect(state.aimX).toBe(COURT_WIDTH / 2);
    expect(state.aimY).toBe(NET_Y);
    expect(state.biasX).toBe(0);
    expect(state.biasY).toBe(0);
    expect(state.meetTime).toBe(0);
    expect(state.meetLift).toBe(0);
    expect(state.leapt).toBe(false);
    expect(state.shot).toBe(-1);
    expect(state.look.decided).toBe(false);
  });

  it('reads only what is on the screen', () => {
    // Ball, players, whose touch it is, and the bounce count — every one of which the court
    // draws for both people. It is handed a `Readonly<Match>` and cannot reach past it.
    const match = fresh(68);
    goLive(match);
    const before = fingerprint(match);
    const state = createBotState();
    botIntent(intent, match, state, 'p1', BOT_PROFILES.hard, STEP, 0.5, 0.5);
    expect(fingerprint(match)).toBe(before);
  });

  it('beats the weaker tier over a series', { timeout: 240_000 }, () => {
    const beats = (strong: BotDifficulty, weak: BotDifficulty, base: number): number => {
      let wins = 0;
      let decided = 0;
      for (let i = 0; i < 60; i += 1) {
        const swap = i % 2 === 1;
        const played = playMatch(
          BOT_PROFILES[swap ? weak : strong],
          BOT_PROFILES[swap ? strong : weak],
          base + i * 13,
        );
        if (played.winner === null || played.winner === 'draw') continue;
        decided += 1;
        if (played.winner === (swap ? 'p2' : 'p1')) wins += 1;
      }
      expect(decided).toBeGreaterThan(50);
      return wins / decided;
    };
    expect(beats('normal', 'easy', 70000)).toBeGreaterThan(0.6);
    expect(beats('hard', 'normal', 70000)).toBeGreaterThan(0.6);
    expect(beats('hard', 'easy', 70000)).toBeGreaterThan(0.8);
  });

  it('gives neither seat an edge when both play the same tier', { timeout: 240_000 }, () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      let p1 = 0;
      let decided = 0;
      for (let i = 0; i < 80; i += 1) {
        const played = playMatch(BOT_PROFILES[tier], BOT_PROFILES[tier], 200000 + i * 11);
        if (played.winner === null || played.winner === 'draw') continue;
        decided += 1;
        if (played.winner === 'p1') p1 += 1;
      }
      expect(decided).toBeGreaterThan(70);
      // A wide band on eighty matches: three standard errors is about 17 points.
      expect(p1 / decided, `${tier}: p1 took ${String(p1)} of ${String(decided)}`).toBeGreaterThan(
        0.33,
      );
      expect(p1 / decided, `${tier}: p1 took ${String(p1)} of ${String(decided)}`).toBeLessThan(
        0.67,
      );
    }
  });
});
