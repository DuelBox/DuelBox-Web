import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BALL_RADIUS,
  BASE_FLIGHT,
  BOT_PROFILES,
  COURT_HEIGHT,
  COURT_WIDTH,
  GRAVITY,
  LIFT_GAIN,
  MATCH_SECONDS,
  MAX_RALLY_TOUCHES,
  MIN_FLIGHT,
  NET_CLEAR,
  NET_HEIGHT,
  NET_Y,
  PLACE_MAX_DEPTH,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  POINT_SECONDS,
  PREDICT_HORIZON,
  REACH,
  REACH_HEIGHT,
  SERVE_SECONDS,
  TARGET_MARGIN,
  TARGET_POINTS,
  botIntent,
  canPlay,
  contactSeat,
  createBotState,
  createMatch,
  flightFor,
  flightTimeFor,
  forwardOf,
  halfOf,
  movePlayer,
  otherOf,
  play,
  playerOf,
  predictIntercept,
  readyY,
  resetBotState,
  resetMatch,
  serve,
  sideOf,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotProfile, Interception, Intent, Match } from './rules.js';

const STEP = 1 / 60;

function fresh(seed = 1): Match {
  return createMatch(new Rng(seed));
}

/** Runs the serve hang out so the ball is live. */
function goLive(match: Match, rng = new Rng(1)): void {
  for (let i = 0; i < 300 && match.phase !== 'rally'; i += 1) step(match, STEP, rng);
}

/** Puts the ball exactly where a test wants it, live. */
function place(
  match: Match,
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
): void {
  match.phase = 'rally';
  match.timer = 0;
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

const intent: Intent = { dx: 0, dy: 0 };
const landing: Interception = { x: 0, y: 0, time: 0, height: 0, reachable: false };

/** Plays a whole match between two tiers and returns the winner. */
function playMatch(p1: BotProfile, p2: BotProfile, seed: number): SeatId | 'draw' | null {
  const rng = new Rng(seed);
  const match = createMatch(rng);
  const botA = createBotState();
  const botB = createBotState();
  const a: Intent = { dx: 0, dy: 0 };
  const b: Intent = { dx: 0, dy: 0 };
  for (let i = 0; i < 60 * (MATCH_SECONDS + 30) && match.winner === null; i += 1) {
    botIntent(a, match, botA, 'p1', p1, STEP, rng.float(), rng.float());
    botIntent(b, match, botB, 'p2', p2, STEP, rng.float(), rng.float());
    movePlayer(match, 'p1', a.dx, a.dy, STEP);
    movePlayer(match, 'p2', b.dx, b.dy, STEP);
    step(match, STEP, rng);
  }
  return match.winner;
}

/**
 * The state, reflected top to bottom, with the two seats swapped.
 *
 * The one property the whole split rests on: mirror the court and everything that happens
 * must happen mirrored. Anything that reads `y` without a matching `forwardOf` shows up here
 * and nowhere else, and this repo has shipped a seat-one advantage twice.
 */
function mirror(match: Readonly<Match>): Match {
  const flip = (y: number): number => COURT_HEIGHT - y;
  return {
    p1: { x: match.p2.x, y: flip(match.p2.y), vx: match.p2.vx, vy: -match.p2.vy },
    p2: { x: match.p1.x, y: flip(match.p1.y), vx: match.p1.vx, vy: -match.p1.vy },
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
 * It cannot be zero, and the reason is worth writing down because the obvious repair is to
 * set it to zero and chase the difference into the physics, where it is not.
 *
 * `COURT_HEIGHT - y` is not an involution in binary floating point. p2's sand runs 0 to 500
 * and p1's runs 500 to 1000, and the lower range is spaced twice as finely — so a point on
 * one half reflects onto a point the other half cannot represent, and reflecting it back
 * lands somewhere else. `220.1` is such a point: flip it twice and it moves by 2.8e-14.
 * In real arithmetic the simulation is exactly symmetric — every `y` term below is paired
 * with a `forwardOf` — and what is left over is the *representation* leaning, half a unit in
 * the last place at a time, which then compounds through a chaotic rally.
 *
 * A hundredth of a unit is the bound because it sits a thousandfold above the drift measured
 * over the whole match below (about 1e-5) and far under anything the game can express: a step
 * of running is 5.3 units, the ball is 16 across, reach is 54. A real asymmetry — a missing
 * `forwardOf`, a bound short by a player radius, a serve nudged one way — is tens or hundreds
 * of units and trips this on the first step it happens.
 */
const MIRROR_TOLERANCE = 1e-2;

/**
 * Everything about a state that must match its mirror **exactly**, and nothing continuous.
 *
 * Who is serving, who touched last, how many touches, the score and the result are decisions
 * rather than measurements. A rounding difference must never turn into one of these, so they
 * are compared to the bit while the positions are compared to a tolerance.
 */
function discreteFingerprint(match: Readonly<Match>): string {
  return [
    match.phase,
    match.server,
    match.lastToucher,
    String(match.touches),
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
    [actual.p2.x, expected.p2.x],
    [actual.p2.y, expected.p2.y],
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
    round(match.p2.x),
    round(match.p2.y),
    round(match.aimX),
    round(match.aimY),
    match.phase,
    match.server,
    match.lastToucher,
    String(match.touches),
    `${String(match.score.p1)}-${String(match.score.p2)}`,
    String(match.scorer),
    String(match.winner),
  ].join('|');
}

describe('the court', () => {
  it('gives each seat a half, and the two are exact mirrors about the net', () => {
    const bottom = halfOf('p1');
    const top = halfOf('p2');
    expect(bottom.minY).toBe(COURT_HEIGHT - top.maxY);
    expect(bottom.maxY).toBe(COURT_HEIGHT - top.minY);
    expect(bottom.minX).toBe(top.minX);
    expect(bottom.maxX).toBe(top.maxX);
    expect(bottom.maxY - bottom.minY, 'the same depth of sand each').toBe(top.maxY - top.minY);
  });

  it('keeps both halves clear of the net line', () => {
    expect(halfOf('p1').minY).toBeGreaterThan(NET_Y);
    expect(halfOf('p2').maxY).toBeLessThan(NET_Y);
    expect(halfOf('p1').minY - NET_Y).toBe(PLAYER_RADIUS);
  });

  it('splits the sand at the net', () => {
    expect(sideOf(NET_Y + 1)).toBe('p1');
    expect(sideOf(NET_Y - 1)).toBe('p2');
    expect(sideOf(COURT_HEIGHT - 1)).toBe('p1');
    expect(sideOf(1)).toBe('p2');
  });

  it('points each seat at the other', () => {
    expect(forwardOf('p1')).toBe(-1);
    expect(forwardOf('p2')).toBe(1);
    expect(forwardOf('p1')).toBe(-forwardOf('p2'));
  });

  it('mirrors the two ready positions', () => {
    expect(readyY('p1')).toBe(COURT_HEIGHT - readyY('p2'));
  });

  it('has two seats', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('hands back the right player for a seat', () => {
    const match = fresh();
    expect(playerOf(match, 'p1')).toBe(match.p1);
    expect(playerOf(match, 'p2')).toBe(match.p2);
  });

  it('starts level with nobody having won', () => {
    const match = fresh();
    expect(match.score).toEqual({ p1: 0, p2: 0 });
    expect(winnerOf(match)).toBeNull();
    expect(match.phase).toBe('serving');
  });

  it('resets in place', () => {
    const match = fresh();
    match.score.p1 = 2;
    match.elapsed = 90;
    resetMatch(match, new Rng(4));
    expect(match.score).toEqual({ p1: 0, p2: 0 });
    expect(match.elapsed).toBe(0);
    expect(match.winner).toBeNull();
  });
});

describe('running', () => {
  it('moves at the declared speed and no faster', () => {
    const match = fresh();
    const before = match.p1.y;
    movePlayer(match, 'p1', 0, 1, STEP);
    expect(match.p1.y - before).toBeCloseTo(PLAYER_SPEED * STEP, 9);
  });

  it('caps a diagonal, so two directions do not out-run one', () => {
    const a = fresh();
    const b = fresh();
    a.p1.x = 300;
    a.p1.y = 700;
    b.p1.x = 300;
    b.p1.y = 700;
    for (let i = 0; i < 30; i += 1) {
      movePlayer(a, 'p1', 1, 1, STEP);
      movePlayer(b, 'p1', 1, 0, STEP);
    }
    const diagonal = Math.hypot(a.p1.x - 300, a.p1.y - 700);
    const straight = Math.abs(b.p1.x - 300);
    expect(diagonal).toBeLessThanOrEqual(straight + 1e-9);
  });

  it('never lets a player cross the net, however long a key is held', () => {
    const match = fresh();
    for (let i = 0; i < 900; i += 1) {
      movePlayer(match, 'p1', 0, -1, STEP);
      movePlayer(match, 'p2', 0, 1, STEP);
    }
    expect(match.p1.y).toBeGreaterThanOrEqual(halfOf('p1').minY);
    expect(match.p2.y).toBeLessThanOrEqual(halfOf('p2').maxY);
  });

  it('never lets a player leave the court sideways', () => {
    const match = fresh();
    for (let i = 0; i < 900; i += 1) movePlayer(match, 'p1', -1, 1, STEP);
    expect(match.p1.x).toBeGreaterThanOrEqual(PLAYER_RADIUS);
    expect(match.p1.y).toBeLessThanOrEqual(COURT_HEIGHT - PLAYER_RADIUS);
  });

  it('reports the motion it actually managed, not the motion asked for', () => {
    // A player pinned against their own line puts nothing on the ball, which is the whole
    // reason the velocity is derived rather than assigned.
    const match = fresh();
    match.p1.y = halfOf('p1').minY;
    movePlayer(match, 'p1', 0, -1, STEP);
    expect(match.p1.vy).toBe(0);
  });

  it('survives a zero delta without dividing by zero', () => {
    const match = fresh();
    movePlayer(match, 'p1', 1, 1, 0);
    expect(Number.isFinite(match.p1.vx)).toBe(true);
    expect(match.p1.vx).toBe(0);
  });
});

describe('the serve', () => {
  it('hangs still before it is released', () => {
    const match = fresh();
    const before = { ...match.ball };
    for (let i = 0; i < Math.floor(SERVE_SECONDS / STEP / 2); i += 1) step(match, STEP, new Rng(1));
    expect(match.phase).toBe('serving');
    expect(match.ball.x).toBe(before.x);
    expect(match.ball.y).toBe(before.y);
    expect(match.ball.z).toBe(before.z);
  });

  it('goes over the net into the receiver half', () => {
    for (const seed of [3, 5, 7, 11, 13]) {
      const rng = new Rng(seed);
      const match = createMatch(rng);
      const receiver = otherOf(match.server);
      goLive(match, rng);
      let crossed = false;
      for (let i = 0; i < 240 && !crossed; i += 1) {
        step(match, STEP, rng);
        if (sideOf(match.ball.y) === receiver) crossed = true;
      }
      expect(crossed, `seed ${String(seed)}: the serve reaches the receiver`).toBe(true);
    }
  });

  it('clears the net rather than clipping it', () => {
    for (const seed of [3, 5, 7, 11, 13, 17, 19]) {
      const rng = new Rng(seed);
      const match = createMatch(rng);
      goLive(match, rng);
      let netted = false;
      for (let i = 0; i < 240 && !netted; i += 1) {
        const result = step(match, STEP, rng);
        if (result.netted) netted = true;
        // Only the serve is on trial here: once somebody has played it, whatever happens
        // next is their shot rather than the serve.
        if (result.scored !== null || result.touched !== null) break;
      }
      expect(netted, `seed ${String(seed)}: a serve never faults into the net`).toBe(false);
    }
  });

  it('lands inside the court', () => {
    for (const seed of [3, 5, 7, 11]) {
      const rng = new Rng(seed);
      const match = createMatch(rng);
      goLive(match, rng);
      // Nobody moves: the serve is allowed to run all the way to the sand.
      for (let i = 0; i < 400 && match.phase === 'rally'; i += 1) step(match, STEP, rng);
      expect(match.ball.x).toBeGreaterThanOrEqual(0);
      expect(match.ball.x).toBeLessThanOrEqual(COURT_WIDTH);
      expect(match.ball.y).toBeGreaterThanOrEqual(0);
      expect(match.ball.y).toBeLessThanOrEqual(COURT_HEIGHT);
    }
  });

  it('opens on a coin flip rather than always the same seat', () => {
    const servers = new Set<SeatId>();
    for (let seed = 1; seed <= 24; seed += 1) servers.add(fresh(seed).server);
    expect(servers.size, 'both seats open some matches').toBe(2);
  });

  it('counts as the first touch, by the server', () => {
    const match = fresh(2);
    expect(match.touches).toBe(1);
    expect(match.lastToucher).toBe(match.server);
  });

  it('puts both players on their marks, mirrored about the net', () => {
    const match = fresh(2);
    const server = match.server === 'p1' ? match.p1 : match.p2;
    const receiver = match.server === 'p1' ? match.p2 : match.p1;
    expect(server.x).toBe(COURT_WIDTH / 2);
    expect(receiver.x).toBe(COURT_WIDTH / 2);
    expect(Math.abs(server.y - NET_Y)).toBeGreaterThan(Math.abs(receiver.y - NET_Y));
  });

  it('is served by whoever lost the point', () => {
    const match = fresh();
    place(match, { x: 200, y: 800, z: 1, vx: 0, vy: 0, vz: -300 });
    match.lastToucher = 'p2';
    const result = step(match, STEP, new Rng(1));
    expect(result.scored, 'it landed on p1 sand').toBe('p2');
    expect(match.server, 'and p1 serves next').toBe('p1');
  });
});

describe('the flight', () => {
  it('always comes down, whatever it was thrown at', () => {
    for (const vz of [0, 200, 600, 1200]) {
      const match = fresh();
      place(match, { x: 300, y: 300, z: 20, vx: 0, vy: 0, vz });
      let landed = false;
      for (let i = 0; i < 60 * 20 && !landed; i += 1) {
        if (step(match, STEP, new Rng(1)).scored !== null) landed = true;
      }
      expect(landed, `vz ${String(vz)} reaches the sand`).toBe(true);
    }
  });

  it('pulls the ball down at the declared rate', () => {
    const match = fresh();
    place(match, { x: 300, y: 300, z: 200, vx: 0, vy: 0, vz: 0 });
    step(match, STEP, new Rng(1));
    expect(match.ball.vz).toBeCloseTo(-GRAVITY * STEP, 9);
  });

  it('turns a low ball back on the side it came from', () => {
    const match = fresh();
    // Below the net, crossing from p1's side.
    place(match, { x: 300, y: NET_Y + 4, z: 10, vx: 0, vy: -600, vz: 0 });
    match.lastToucher = 'p1';
    const result = step(match, STEP, new Rng(1));
    expect(result.netted).toBe(true);
    expect(sideOf(match.ball.y), 'it drops back on the side that hit it').toBe('p1');
    expect(match.ball.vy).toBeGreaterThan(0);
  });

  it('lets a high ball straight over', () => {
    const match = fresh();
    place(match, {
      x: 300,
      y: NET_Y + 4,
      z: NET_HEIGHT + BALL_RADIUS + 40,
      vx: 0,
      vy: -600,
      vz: 0,
    });
    match.lastToucher = 'p1';
    const result = step(match, STEP, new Rng(1));
    expect(result.netted).toBe(false);
    expect(sideOf(match.ball.y)).toBe('p2');
  });

  it('will not let a fast flat ball tunnel through the net', () => {
    // The net is thinner than a step at full pace, so the crossing is what is tested rather
    // than the step's endpoints.
    const match = fresh();
    place(match, { x: 300, y: NET_Y + 60, z: 8, vx: 0, vy: -4000, vz: 0 });
    match.lastToucher = 'p1';
    expect(step(match, STEP, new Rng(1)).netted).toBe(true);
  });

  it('gives the point away when a netted ball cannot be played again', () => {
    // One touch a side: whoever put it in the net may not dig their own ball out.
    const match = fresh();
    place(match, { x: 300, y: NET_Y + 4, z: 10, vx: 0, vy: -600, vz: 0 });
    match.p1.x = 300;
    match.p1.y = halfOf('p1').minY;
    match.lastToucher = 'p1';
    let scorer: SeatId | null = null;
    for (let i = 0; i < 600 && scorer === null; i += 1) {
      scorer = step(match, STEP, new Rng(1)).scored;
    }
    expect(scorer).toBe('p2');
  });
});

describe('the shrinking flight', () => {
  it('starts long and gets shorter every touch', () => {
    expect(flightTimeFor(0)).toBe(BASE_FLIGHT);
    let touches = 1;
    while (flightTimeFor(touches) > MIN_FLIGHT) {
      expect(flightTimeFor(touches)).toBeLessThan(flightTimeFor(touches - 1));
      touches += 1;
    }
    expect(touches, 'and it takes several touches to get there').toBeGreaterThan(5);
  });

  it('never falls below the floor', () => {
    expect(flightTimeFor(100)).toBe(MIN_FLIGHT);
    expect(flightTimeFor(1000)).toBe(MIN_FLIGHT);
  });

  it('pays a ball met high with more time in the air', () => {
    expect(flightFor(3, REACH_HEIGHT)).toBeGreaterThan(flightFor(3, 0));
    expect(flightFor(3, REACH_HEIGHT)).toBeCloseTo(flightTimeFor(3) * (1 + LIFT_GAIN), 9);
  });

  it('multiplies rather than adds, so height cannot rescue a dying rally', () => {
    // Added, a player who kept meeting the ball high out-ran the decay for ever and the
    // rally had no end but the hard cap.
    expect(flightFor(20, REACH_HEIGHT)).toBeLessThan(flightFor(1, 0));
  });

  it('treats anything above reach as full stretch, and anything below the sand as none', () => {
    expect(flightFor(2, REACH_HEIGHT * 3)).toBe(flightFor(2, REACH_HEIGHT));
    expect(flightFor(2, -50)).toBe(flightFor(2, 0));
  });
});

describe('playing the ball', () => {
  function ready(match: Match, seat: SeatId, ballY = NET_Y + 200): void {
    const player = seat === 'p1' ? match.p1 : match.p2;
    player.x = 300;
    player.y = ballY;
    player.vx = 0;
    player.vy = 0;
    place(match, { x: 300, y: ballY, z: 40, vx: 0, vy: 0, vz: -100 });
    match.lastToucher = otherOf(seat);
    match.touches = 2;
  }

  it('lets the seat whose sand it is over play it', () => {
    const match = fresh();
    ready(match, 'p1');
    expect(canPlay(match, 'p1')).toBe(true);
    expect(contactSeat(match)).toBe('p1');
  });

  it('refuses a second touch from the same seat', () => {
    const match = fresh();
    ready(match, 'p1');
    match.lastToucher = 'p1';
    expect(canPlay(match, 'p1'), 'one touch a side').toBe(false);
    expect(contactSeat(match)).toBeNull();
  });

  it('refuses a reach across the net', () => {
    // A player's half stops short of the net but their reach does not.
    const match = fresh();
    match.p1.x = 300;
    match.p1.y = halfOf('p1').minY;
    place(match, { x: 300, y: NET_Y - 4, z: 30, vx: 0, vy: 0, vz: -100 });
    match.lastToucher = 'p2';
    expect(Math.hypot(0, match.p1.y - match.ball.y), 'well inside its reach').toBeLessThan(REACH);
    expect(canPlay(match, 'p1'), 'and still not its ball').toBe(false);
  });

  it('refuses a ball over its head', () => {
    const match = fresh();
    ready(match, 'p1');
    match.ball.z = REACH_HEIGHT + 1;
    expect(canPlay(match, 'p1')).toBe(false);
    match.ball.z = REACH_HEIGHT;
    expect(canPlay(match, 'p1')).toBe(true);
  });

  it('refuses a ball out of reach across the sand', () => {
    const match = fresh();
    ready(match, 'p1');
    match.ball.x = match.p1.x + REACH + 1;
    expect(canPlay(match, 'p1')).toBe(false);
    match.ball.x = match.p1.x + REACH - 1;
    expect(canPlay(match, 'p1')).toBe(true);
  });

  it('refuses every touch once the rally cap is reached', () => {
    const match = fresh();
    ready(match, 'p1');
    match.touches = MAX_RALLY_TOUCHES;
    expect(canPlay(match, 'p1')).toBe(false);
    expect(canPlay(match, 'p2')).toBe(false);
  });

  it('sends the ball over the net', () => {
    const match = fresh();
    ready(match, 'p1');
    play(match, 'p1');
    expect(sideOf(match.aimY), 'aimed into the other half').toBe('p2');
    expect(match.ball.vy, 'and travelling that way').toBeLessThan(0);
  });

  it('sends it right when met on the right, left when met on the left', () => {
    const right = fresh();
    ready(right, 'p1');
    right.ball.x = right.p1.x + REACH * 0.9;
    play(right, 'p1');

    const left = fresh();
    ready(left, 'p1');
    left.ball.x = left.p1.x - REACH * 0.9;
    play(left, 'p1');

    expect(right.aimX).toBeGreaterThan(COURT_WIDTH / 2);
    expect(left.aimX).toBeLessThan(COURT_WIDTH / 2);
    expect(right.aimX - COURT_WIDTH / 2).toBeCloseTo(COURT_WIDTH / 2 - left.aimX, 6);
  });

  it('sends it deep when met in front, short when it has got behind', () => {
    const deep = fresh();
    ready(deep, 'p1');
    // The ball nearer the net than the player: the player is behind it, hitting through it.
    deep.ball.y = deep.p1.y - REACH * 0.9;
    play(deep, 'p1');

    const short = fresh();
    ready(short, 'p1');
    short.ball.y = short.p1.y + REACH * 0.9;
    play(short, 'p1');

    expect(NET_Y - deep.aimY, 'deep is further from the net').toBeGreaterThan(NET_Y - short.aimY);
  });

  it('never aims outside the other half, however badly it was met', () => {
    for (const dx of [-REACH, -20, 0, 20, REACH]) {
      for (const dy of [-REACH, 0, REACH]) {
        const match = fresh();
        ready(match, 'p1');
        match.ball.x = match.p1.x + dx;
        match.ball.y = match.p1.y + dy;
        match.p1.vx = -PLAYER_SPEED;
        match.p1.vy = PLAYER_SPEED;
        play(match, 'p1');
        expect(match.aimX).toBeGreaterThanOrEqual(TARGET_MARGIN - 1e-9);
        expect(match.aimX).toBeLessThanOrEqual(COURT_WIDTH - TARGET_MARGIN + 1e-9);
        expect(NET_Y - match.aimY).toBeGreaterThanOrEqual(NET_CLEAR - 1e-9);
        expect(NET_Y - match.aimY).toBeLessThanOrEqual(PLACE_MAX_DEPTH + 1e-9);
      }
    }
  });

  it('takes some of the runner with it', () => {
    const still = fresh();
    ready(still, 'p1');
    play(still, 'p1');

    const running = fresh();
    ready(running, 'p1');
    running.p1.vx = PLAYER_SPEED;
    play(running, 'p1');

    expect(running.aimX, 'running right sends it right').toBeGreaterThan(still.aimX);
  });

  it('counts the touch and takes ownership of the ball', () => {
    const match = fresh();
    ready(match, 'p1');
    const before = match.touches;
    play(match, 'p1');
    expect(match.touches).toBe(before + 1);
    expect(match.lastToucher).toBe('p1');
  });

  it('digs a ball on the very step it would have landed', () => {
    // Contact is tested before the sand, which is what a player watching it expects.
    const match = fresh();
    ready(match, 'p1');
    match.ball.z = 1;
    match.ball.vz = -600;
    const result = step(match, STEP, new Rng(1));
    expect(result.touched).toBe('p1');
    expect(result.scored).toBeNull();
  });

  it('handles a ball on the player centre without producing a nonsense shot', () => {
    const match = fresh();
    ready(match, 'p1');
    match.ball.x = match.p1.x;
    match.ball.y = match.p1.y;
    match.ball.z = 0;
    play(match, 'p1');
    expect(Number.isFinite(match.ball.vx)).toBe(true);
    expect(Number.isFinite(match.ball.vy)).toBe(true);
    expect(Number.isFinite(match.ball.vz)).toBe(true);
  });
});

describe('scoring', () => {
  it('gives the point away when the ball lands on your sand', () => {
    const match = fresh();
    place(match, { x: 120, y: 900, z: 1, vx: 0, vy: 0, vz: -200 });
    match.lastToucher = 'p2';
    expect(step(match, STEP, new Rng(1)).scored).toBe('p2');
    expect(match.score.p2).toBe(1);
  });

  it('gives the point away when you put the ball out', () => {
    const match = fresh();
    place(match, { x: COURT_WIDTH - 2, y: 700, z: 60, vx: 4000, vy: 0, vz: 0 });
    match.lastToucher = 'p2';
    expect(step(match, STEP, new Rng(1)).scored).toBe('p1');
  });

  it('pauses after a point and then serves again', () => {
    const rng = new Rng(1);
    const match = fresh();
    place(match, { x: 120, y: 900, z: 1, vx: 0, vy: 0, vz: -200 });
    match.lastToucher = 'p2';
    step(match, STEP, rng);
    expect(match.phase).toBe('point');
    for (let i = 0; i < Math.ceil(POINT_SECONDS / STEP) + 2; i += 1) step(match, STEP, rng);
    expect(match.phase).toBe('serving');
  });

  it('is won at three, through the shared helper', () => {
    const match = fresh();
    expect(winnerOf(match)).toBeNull();
    match.score.p1 = TARGET_POINTS;
    step(match, STEP, new Rng(1));
    expect(winnerOf(match)).toBe('p1');
    expect(match.phase).toBe('over');
  });

  it('is called on the clock, and drawn when the two are level', () => {
    const level = fresh();
    level.elapsed = MATCH_SECONDS;
    step(level, STEP, new Rng(1));
    expect(winnerOf(level)).toBe('draw');

    const ahead = fresh();
    ahead.elapsed = MATCH_SECONDS;
    ahead.score.p2 = 1;
    step(ahead, STEP, new Rng(1));
    expect(winnerOf(ahead)).toBe('p2');
  });

  it('hands back one result record rather than allocating one a step', () => {
    // Rule 5. It also means a caller must read what it wants before the next call, which is
    // the sort of thing that bites in a test rather than in the game.
    const match = fresh();
    expect(step(match, STEP, new Rng(1))).toBe(step(match, STEP, new Rng(1)));
  });

  it('stops simulating once it is over', () => {
    const match = fresh();
    match.score.p1 = TARGET_POINTS;
    step(match, STEP, new Rng(1));
    const frozen = fingerprint(match);
    for (let i = 0; i < 600; i += 1) step(match, STEP, new Rng(1));
    expect(fingerprint(match)).toBe(frozen);
  });
});

describe('a rally always ends', () => {
  it('never exceeds the hard cap on touches', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = new Rng(seed);
      const match = createMatch(rng);
      const a = createBotState();
      const b = createBotState();
      const intentA: Intent = { dx: 0, dy: 0 };
      const intentB: Intent = { dx: 0, dy: 0 };
      for (let i = 0; i < 60 * 200 && match.winner === null; i += 1) {
        botIntent(intentA, match, a, 'p1', BOT_PROFILES.hard, STEP, rng.float(), rng.float());
        botIntent(intentB, match, b, 'p2', BOT_PROFILES.hard, STEP, rng.float(), rng.float());
        movePlayer(match, 'p1', intentA.dx, intentA.dy, STEP);
        movePlayer(match, 'p2', intentB.dx, intentB.dy, STEP);
        step(match, STEP, rng);
        expect(match.touches).toBeLessThanOrEqual(MAX_RALLY_TOUCHES);
      }
    }
  });

  it('is finished by two easy bots well inside the guard budget', { timeout: 120_000 }, () => {
    for (const seed of [20260820, 11, 22, 33, 44]) {
      expect(
        playMatch(BOT_PROFILES.easy, BOT_PROFILES.easy, seed),
        `seed ${String(seed)}`,
      ).not.toBeNull();
    }
  });

  it('is finished by two hard bots, who miss far less', { timeout: 120_000 }, () => {
    for (const seed of [55, 66, 77]) {
      expect(
        playMatch(BOT_PROFILES.hard, BOT_PROFILES.hard, seed),
        `seed ${String(seed)}`,
      ).not.toBeNull();
    }
  });

  it('keeps the ball inside the court for a whole match', () => {
    const rng = new Rng(99);
    const match = createMatch(rng);
    const a = createBotState();
    const b = createBotState();
    const intentA: Intent = { dx: 0, dy: 0 };
    const intentB: Intent = { dx: 0, dy: 0 };
    for (let i = 0; i < 60 * 200 && match.winner === null; i += 1) {
      botIntent(intentA, match, a, 'p1', BOT_PROFILES.normal, STEP, rng.float(), rng.float());
      botIntent(intentB, match, b, 'p2', BOT_PROFILES.normal, STEP, rng.float(), rng.float());
      movePlayer(match, 'p1', intentA.dx, intentA.dy, STEP);
      movePlayer(match, 'p2', intentB.dx, intentB.dy, STEP);
      step(match, STEP, rng);
      expect(Number.isFinite(match.ball.x + match.ball.y + match.ball.z)).toBe(true);
      expect(match.ball.x).toBeGreaterThan(-COURT_WIDTH);
      expect(match.ball.x).toBeLessThan(COURT_WIDTH * 2);
      expect(match.ball.z).toBeLessThan(2000);
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
        step(match, STEP, rng);
        if (i % 30 === 0) out.push(fingerprint(match));
      }
      return out.join('#');
    };
    expect(trace()).toBe(trace());
  });

  it('puts the ball in the same place at 60, 90 and 120 Hz', () => {
    // Nothing here decays per step: the ball has gravity and no drag, a player moves at a
    // rate, and the height is integrated analytically rather than by one Euler step. So the
    // same half-second of flight has to end in the same place whatever the device runs at.
    const after = (rate: number, seconds: number): string => {
      const match = fresh(8);
      place(match, { x: 200, y: 300, z: 40, vx: 120, vy: 320, vz: 380 });
      const dt = 1 / rate;
      for (let i = 0; i < Math.round(rate * seconds); i += 1) step(match, dt, new Rng(1));
      return [
        match.ball.x.toFixed(6),
        match.ball.y.toFixed(6),
        match.ball.z.toFixed(6),
        match.ball.vz.toFixed(6),
      ].join(',');
    };
    expect(after(120, 0.5)).toBe(after(60, 0.5));
    expect(after(90, 0.5)).toBe(after(60, 0.5));
  });

  it('runs the clock in seconds, not in steps', () => {
    const slow = fresh();
    for (let i = 0; i < 60; i += 1) step(slow, 1 / 60, new Rng(1));
    const fast = fresh();
    for (let i = 0; i < 120; i += 1) step(fast, 1 / 120, new Rng(1));
    expect(fast.elapsed).toBeCloseTo(slow.elapsed, 9);
  });
});

describe('the two seats are the same game', () => {
  it('mirrors: the same rally, reflected, produces the reflected result', () => {
    // The fairness test. Several games in this repo shipped a seat-one advantage that only
    // this kind of check found.
    //
    // Every decision is compared to the bit — who served, who touched, who scored, the score
    // itself. The measurements are compared to `MIRROR_TOLERANCE`, and the note there says
    // why that one cannot be zero however the physics is arranged.
    const original = fresh(21);
    place(original, { x: 220, y: 380, z: 90, vx: 40, vy: 300, vz: 120 });
    original.lastToucher = 'p2';
    original.touches = 3;
    original.p1.x = 240;
    original.p1.y = 720;
    original.p2.x = 410;
    original.p2.y = 300;

    const reflected = mirror(original);

    let steps = 0;
    let touches = 0;
    let points = 0;
    let worstGap = 0;
    for (let i = 0; i < 60 * 20; i += 1) {
      // Both seats chase the ball, which is an intent expressed in the state rather than in
      // coordinates — so it needs no mirroring of its own and cannot smuggle a bias in.
      chase(original, 'p1');
      chase(original, 'p2');
      chase(reflected, 'p1');
      chase(reflected, 'p2');
      // Read out before the next call: `step` hands back one record it rewrites in place.
      const first = step(original, STEP, new Rng(5));
      const firstTouched = first.touched;
      const firstNetted = first.netted;
      const firstScored = first.scored;
      const second = step(reflected, STEP, new Rng(5));
      if (firstTouched !== null) touches += 1;
      if (firstScored !== null) points += 1;
      expect(second.netted, `step ${String(i)}`).toBe(firstNetted);
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
    expect(steps, 'and it ran a real rally, not two idle frames').toBeGreaterThan(300);
    expect(touches, 'with the ball actually played by both seats').toBeGreaterThan(1);
    expect(points, 'and every point of a whole match, not one rally').toBe(TARGET_POINTS);
    expect(original.winner, 'which it played out to a result').not.toBeNull();
    expect(
      worstGap,
      `the widest the two ever sat apart was ${worstGap.toExponential(1)} units`,
    ).toBeLessThan(MIRROR_TOLERANCE);
  });

  it('cannot be checked to the bit, because reflecting a coordinate is not exact', () => {
    // Why the test above carries a tolerance, pinned so nobody takes it back to zero and
    // then goes looking for the bias in the physics, where there is not one.
    //
    // The court is measured from a corner, so p2's sand is 0 to 500 and p1's is 500 to 1000.
    // Doubles are spaced twice as finely over the lower range as the upper, so a point on
    // p2's sand can name a spot on p1's that no double lands on — and reflecting it back
    // returns a different number. Only moving the origin onto the net would make the two
    // halves representationally equal, which is a different game's coordinate system.
    const flip = (y: number): number => COURT_HEIGHT - y;
    const onP2Sand = 220.1;
    expect(sideOf(onP2Sand)).toBe('p2');
    expect(flip(flip(onP2Sand))).not.toBe(onP2Sand);
    expect(Math.abs(flip(flip(onP2Sand)) - onP2Sand)).toBeLessThan(1e-12);
  });

  it('mirrors the two halves and the two ready spots', () => {
    expect(halfOf('p1').minY + halfOf('p2').maxY).toBe(COURT_HEIGHT);
    expect(readyY('p1') + readyY('p2')).toBe(COURT_HEIGHT);
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
    place(asP1, { x: 260, y: 700, z: 50, vx: 0, vy: 0, vz: -80 });
    asP1.p1.x = 300;
    asP1.p1.y = 740;
    asP1.lastToucher = 'p2';
    play(asP1, 'p1');

    const asP2 = fresh(41);
    place(asP2, { x: 260, y: COURT_HEIGHT - 700, z: 50, vx: 0, vy: 0, vz: -80 });
    asP2.p2.x = 300;
    asP2.p2.y = COURT_HEIGHT - 740;
    asP2.lastToucher = 'p1';
    play(asP2, 'p2');

    expect(asP2.aimX).toBeCloseTo(asP1.aimX, 9);
    expect(asP2.aimY).toBeCloseTo(COURT_HEIGHT - asP1.aimY, 9);
    expect(asP2.ball.vy).toBeCloseTo(-asP1.ball.vy, 9);
    expect(asP2.ball.vz).toBeCloseTo(asP1.ball.vz, 9);
  });
});

describe('the prediction', () => {
  it('finds where a ball is coming down', () => {
    const match = fresh();
    place(match, { x: 300, y: 300, z: 100, vx: 0, vy: 400, vz: 300 });
    predictIntercept(landing, match.ball, 'p1', 300, 700, PLAYER_SPEED, REACH_HEIGHT, 2.4);
    expect(landing.reachable).toBe(true);
    expect(sideOf(landing.y)).toBe('p1');
  });

  it('runs the same physics the simulation does, so the net turns it back', () => {
    const match = fresh();
    // A flat ball from p2's side that cannot clear the net.
    place(match, { x: 300, y: NET_Y - 200, z: 6, vx: 0, vy: 600, vz: 0 });
    predictIntercept(landing, match.ball, 'p1', 300, 900, PLAYER_SPEED, REACH_HEIGHT, 2.4);
    expect(sideOf(landing.y), 'it cannot pass through the net').toBe('p2');
    expect(landing.reachable).toBe(false);
  });

  it('says so when it cannot get there', () => {
    const match = fresh();
    place(match, { x: 60, y: 400, z: 30, vx: 0, vy: 700, vz: 0 });
    // Standing in the far corner with no time at all.
    predictIntercept(landing, match.ball, 'p1', 560, 960, PLAYER_SPEED, REACH_HEIGHT, 2.4);
    expect(landing.reachable).toBe(false);
  });

  it('meets the ball higher the further up its descent it is willing to go', () => {
    const match = fresh();
    place(match, { x: 300, y: 300, z: 30, vx: 0, vy: 300, vz: 420 });
    predictIntercept(landing, match.ball, 'p1', 300, 620, PLAYER_SPEED, REACH_HEIGHT, 2.4);
    const eager = landing.height;
    expect(landing.reachable).toBe(true);
    predictIntercept(landing, match.ball, 'p1', 300, 620, PLAYER_SPEED, REACH_HEIGHT * 0.2, 2.4);
    const patient = landing.height;
    expect(landing.reachable).toBe(true);
    expect(eager, 'the eager one meets it further up its fall').toBeGreaterThan(patient);
  });

  it('never reports a spot on the other seat half', () => {
    const rng = new Rng(6);
    for (let i = 0; i < 40; i += 1) {
      const match = fresh();
      place(match, {
        x: rng.float() * COURT_WIDTH,
        y: rng.float() * NET_Y,
        z: rng.float() * 120,
        vx: (rng.float() - 0.5) * 400,
        vy: rng.float() * 500 + 50,
        vz: rng.float() * 300,
      });
      predictIntercept(landing, match.ball, 'p1', 300, 700, PLAYER_SPEED, REACH_HEIGHT, 2.4);
      if (landing.reachable) expect(sideOf(landing.y)).toBe('p1');
    }
  });
});

describe('the bot', () => {
  it('declares its tiers in a sensible order', () => {
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.error).toBeGreaterThan(BOT_PROFILES.normal.error);
    expect(BOT_PROFILES.normal.error).toBeGreaterThan(BOT_PROFILES.hard.error);
    expect(BOT_PROFILES.easy.anticipation).toBeLessThan(BOT_PROFILES.normal.anticipation);
    expect(BOT_PROFILES.normal.anticipation).toBeLessThan(BOT_PROFILES.hard.anticipation);
  });

  it('never reacts faster than a person', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      expect(BOT_PROFILES[tier].reaction, tier).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('never reaches further than a person', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      expect(BOT_PROFILES[tier].anticipation, tier).toBeLessThanOrEqual(1);
    }
  });

  it('commits to a misjudgement per shot rather than re-rolling it every step', () => {
    // A fresh random error sixty times a second averages to zero, so the bot stands on
    // exactly the right spot however large its supposed inaccuracy.
    const match = fresh();
    goLive(match);
    const bot = createBotState();
    botIntent(intent, match, bot, 'p1', BOT_PROFILES.easy, STEP, 0.05, 0.95);
    const first = bot.biasX;
    botIntent(intent, match, bot, 'p1', BOT_PROFILES.easy, STEP, 0.95, 0.05);
    expect(bot.biasX, 'the same shot, the same judgement').toBe(first);

    match.touches += 1;
    botIntent(intent, match, bot, 'p1', BOT_PROFILES.easy, STEP, 0.95, 0.05);
    expect(bot.biasX, 'a new shot, a new judgement').not.toBe(first);
  });

  it('does not answer a new shot on the step it was played', () => {
    // The reaction time is a delay before it reads the new ball, not merely a floor on how
    // often it thinks: with an immediate re-look, the tiers measured identical.
    const match = fresh();
    goLive(match);
    const bot = createBotState();
    for (let i = 0; i < 40; i += 1) {
      botIntent(intent, match, bot, 'p1', BOT_PROFILES.easy, STEP, 0.5, 0.5);
    }
    const held = bot.aimX;

    // A new shot, clearly coming to p1 and clearly not down the middle.
    match.touches += 1;
    match.lastToucher = 'p2';
    match.p1.x = 300;
    match.p1.y = 710;
    place(match, { x: 120, y: 300, z: 60, vx: 0, vy: 300, vz: 200 });
    botIntent(intent, match, bot, 'p1', BOT_PROFILES.easy, STEP, 0.5, 0.5);
    expect(bot.aimX, 'it has not looked at the new ball yet').toBe(held);

    for (let i = 0; i < Math.ceil(BOT_PROFILES.easy.reaction / STEP) + 2; i += 1) {
      botIntent(intent, match, bot, 'p1', BOT_PROFILES.easy, STEP, 0.5, 0.5);
    }
    expect(bot.aimX, 'and then it does').not.toBe(held);
  });

  it('holds still once it is on its spot', () => {
    const match = fresh();
    const bot = createBotState();
    bot.aimX = match.p1.x;
    bot.aimY = match.p1.y;
    bot.shot = match.touches;
    bot.look.decided = true;
    bot.look.remaining = 1;
    botIntent(intent, match, bot, 'p1', BOT_PROFILES.hard, STEP, 0.5, 0.5);
    expect(intent.dx).toBe(0);
    expect(intent.dy).toBe(0);
  });

  it('asks for a direction, never a distance', () => {
    const match = fresh();
    const bot = createBotState();
    bot.aimX = 40;
    bot.aimY = 960;
    bot.shot = match.touches;
    bot.look.decided = true;
    bot.look.remaining = 1;
    botIntent(intent, match, bot, 'p1', BOT_PROFILES.hard, STEP, 0.5, 0.5);
    expect(Math.hypot(intent.dx, intent.dy)).toBeCloseTo(1, 9);
  });

  it('stays inside its own half over a whole match', () => {
    const rng = new Rng(9);
    const match = createMatch(rng);
    const bot = createBotState();
    const bounds = halfOf('p2');
    for (let i = 0; i < 60 * 120 && match.winner === null; i += 1) {
      botIntent(intent, match, bot, 'p2', BOT_PROFILES.hard, STEP, rng.float(), rng.float());
      movePlayer(match, 'p2', intent.dx, intent.dy, STEP);
      step(match, STEP, rng);
      expect(match.p2.y).toBeLessThanOrEqual(bounds.maxY + 1e-9);
      expect(match.p2.y).toBeGreaterThanOrEqual(bounds.minY - 1e-9);
      expect(match.p2.x).toBeGreaterThanOrEqual(bounds.minX - 1e-9);
      expect(match.p2.x).toBeLessThanOrEqual(bounds.maxX + 1e-9);
    }
  });

  it('goes back to the middle once the ball is not its problem', () => {
    const match = fresh();
    goLive(match);
    match.lastToucher = 'p1';
    match.touches = 4;
    const bot = createBotState();
    for (let i = 0; i < 40; i += 1) {
      botIntent(intent, match, bot, 'p1', BOT_PROFILES.hard, STEP, 0.5, 0.5);
    }
    expect(bot.aimX).toBe(COURT_WIDTH / 2);
    expect(bot.aimY).toBe(readyY('p1'));
  });

  it('clears its state on reset', () => {
    const bot = createBotState();
    bot.biasX = 40;
    bot.aimY = 900;
    bot.shot = 6;
    bot.look.decided = true;
    resetBotState(bot);
    expect(bot.biasX).toBe(0);
    expect(bot.shot).toBe(-1);
    expect(bot.look.decided).toBe(false);
  });

  it('reads only what is on the screen', () => {
    // The prediction horizon is a look at the ball, not at the future of the match: nothing
    // in the bot touches the score, the clock, the seed, or the other player's inputs.
    expect(PREDICT_HORIZON).toBeLessThan(MATCH_SECONDS);
    const source = predictIntercept.toString();
    expect(source).not.toContain('score');
    expect(source).not.toContain('rng');
  });

  it('beats the weaker tier over a series', { timeout: 240_000 }, () => {
    let wins = 0;
    const games = 24;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const winner = playMatch(
        hardIsP1 ? BOT_PROFILES.hard : BOT_PROFILES.easy,
        hardIsP1 ? BOT_PROFILES.easy : BOT_PROFILES.hard,
        3000 + i * 17,
      );
      if (winner === (hardIsP1 ? 'p1' : 'p2')) wins += 1;
    }
    // Measured at 100% over 200 matches. Twenty-four is enough to catch an inversion, which
    // is what this is for — the tiers were inverted three times while I built them.
    expect(wins, `hard won ${String(wins)} of ${String(games)}`).toBeGreaterThan(games * 0.7);
  });

  it('beats the tier just below it too', { timeout: 240_000 }, () => {
    let wins = 0;
    const games = 24;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const winner = playMatch(
        hardIsP1 ? BOT_PROFILES.hard : BOT_PROFILES.normal,
        hardIsP1 ? BOT_PROFILES.normal : BOT_PROFILES.hard,
        6000 + i * 17,
      );
      if (winner === (hardIsP1 ? 'p1' : 'p2')) wins += 1;
    }
    // Measured at 75% over 200 matches.
    expect(wins, `hard won ${String(wins)} of ${String(games)}`).toBeGreaterThan(games * 0.55);
  });

  it('gives neither seat an edge when both play the same tier', { timeout: 240_000 }, () => {
    let p1Wins = 0;
    let decided = 0;
    for (let i = 0; i < 40; i += 1) {
      const winner = playMatch(BOT_PROFILES.normal, BOT_PROFILES.normal, 7000 + i * 13);
      if (winner === 'p1' || winner === 'p2') {
        decided += 1;
        if (winner === 'p1') p1Wins += 1;
      }
    }
    // Measured at 45% over 200 matches; forty is enough to catch a seat that always wins.
    const share = p1Wins / decided;
    expect(share, `p1 took ${String(p1Wins)} of ${String(decided)}`).toBeGreaterThan(0.28);
    expect(share).toBeLessThan(0.72);
  });
});
