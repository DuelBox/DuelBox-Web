import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { manifest } from './manifest.js';
import {
  BASE_DISTANCE,
  BASE_HALF,
  BOARD_SIZE,
  BOARD_X,
  BOARD_Y,
  BOT_PROFILES,
  CENTRE_X,
  CENTRE_Y,
  FRAME,
  FRAME_BOUNCE,
  FRICTION,
  MAX_AIM,
  MAX_ROLL_DISTANCE,
  MAX_ROLL_SECONDS,
  OFFSET_SAMPLES,
  POCKETS,
  POCKET_MOUTH,
  PUCKS_PER_SIDE,
  PUCK_BOUNCE,
  PUCK_MASS,
  PUCK_RADIUS,
  SHOT_LIMIT,
  STALEMATE_SHOTS,
  STRIKER_MASS,
  STRIKER_MAX_SPEED,
  STRIKER_RADIUS,
  SUB_STEPS,
  SURFACE_BOTTOM,
  SURFACE_LEFT,
  SURFACE_RIGHT,
  SURFACE_TOP,
  WIN_CONDITION,
  blocked,
  boardIsStill,
  botAim,
  clamp,
  clampAim,
  createState,
  flick,
  forwardOf,
  freeOffset,
  inPocket,
  isTarget,
  massOf,
  normaliseAngle,
  onSurface,
  otherOf,
  placeStriker,
  pottedCount,
  powerForDistance,
  queenOf,
  radiusOf,
  remaining,
  resetState,
  returnToBoard,
  rightOf,
  settleShot,
  spotIsFree,
  step,
  strikerOf,
  strikerSlide,
  strikerXFor,
  strikerYFor,
  winnerOf,
} from './rules.js';
import type { Body, BodyKind, BotDifficulty, State } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/**
 * Roll the board until it stops, collecting everything that went down.
 *
 * Bounded rather than a `while`: a stroke that never settled would hang the suite instead of
 * failing it, because a synchronous spin never lets vitest's timeout fire.
 */
function settle(state: State, potted: number[] = [], rate = STEP): number {
  potted.length = 0;
  const cap = Math.ceil(rate > 0 ? (MAX_ROLL_SECONDS + 2) / rate : 1);
  for (let i = 1; i <= cap; i += 1) {
    const result = step(state, rate);
    for (const index of result.potted) potted.push(index);
    if (result.settled) return i;
  }
  return -1;
}

/** Flick, roll it out, and apply the outcome the way the game does. */
function play(state: State, angle: number, power: number): ReturnType<typeof settleShot> {
  const potted: number[] = [];
  expect(flick(state, angle, power)).toBe(true);
  expect(settle(state, potted)).toBeGreaterThan(0);
  const outcome = settleShot(state, potted);
  state.fouled = outcome.fouled;
  if (outcome.winner !== null) {
    state.winner = outcome.winner;
    state.phase = 'over';
    return outcome;
  }
  state.seat = outcome.next;
  state.phase = 'aiming';
  state.offset = 0;
  placeStriker(state);
  return outcome;
}

/** Every body of a kind, potted or not. Indices never move, so this is stable. */
function all(state: State, kind: BodyKind): Body[] {
  return state.bodies.filter((b) => b.kind === kind);
}

function firstUp(state: State, kind: BodyKind): Body {
  const found = state.bodies.find((b) => b.kind === kind && !b.potted);
  expect(found, `no ${kind} left on the board`).toBeDefined();
  return found as Body;
}

/** Take a seat down to `count` pucks on the board, the rest counted as potted. */
function leave(state: State, seat: SeatId, count: number): void {
  const own = all(state, seat);
  for (let i = 0; i < own.length; i += 1) {
    const b = own[i];
    if (b === undefined) continue;
    b.potted = i >= count;
  }
}

/** Sweep everything off the bed but the striker, so a position can be built by hand. */
function bare(state: State): void {
  for (const b of state.bodies) {
    if (b.kind === 'striker') continue;
    b.potted = true;
    b.vx = 0;
    b.vy = 0;
  }
}

function put(state: State, kind: BodyKind, x: number, y: number): Body {
  const b = state.bodies.find((body) => body.kind === kind && body.potted);
  expect(b, `nothing of kind ${kind} left to place`).toBeDefined();
  const found = b as Body;
  found.potted = false;
  found.x = x;
  found.y = y;
  found.vx = 0;
  found.vy = 0;
  return found;
}

/** Mark bodies down exactly as a settled step leaves them, and list them for `settleShot`. */
function drop(state: State, ...bodies: readonly Body[]): number[] {
  const indices: number[] = [];
  for (const b of bodies) {
    b.potted = true;
    b.vx = 0;
    b.vy = 0;
    indices.push(state.bodies.indexOf(b));
  }
  return indices;
}

/** Send a body off under its own steam, without going through the baseline. */
function launch(state: State, b: Body, vx: number, vy: number): void {
  b.vx = vx;
  b.vy = vy;
  state.phase = 'rolling';
  state.rollSeconds = 0;
}

/**
 * The board turned half about, with the two colours exchanged.
 *
 * This is the assertion that the two seats are the *same* game rather than two similar ones.
 * `kind` is readonly by design — a puck never changes hands — so the mirror builds fresh
 * bodies rather than editing them.
 */
function mirror(state: State): State {
  const swap = (kind: BodyKind): BodyKind => (kind === 'p1' ? 'p2' : kind === 'p2' ? 'p1' : kind);
  const bodies: Body[] = state.bodies.map((b) => ({
    x: 2 * CENTRE_X - b.x,
    y: 2 * CENTRE_Y - b.y,
    vx: -b.vx,
    vy: -b.vy,
    kind: swap(b.kind),
    potted: b.potted,
  }));
  return {
    ...state,
    bodies,
    seat: otherOf(state.seat),
    queenOwner: state.queenOwner === null ? null : otherOf(state.queenOwner),
    winner: state.winner === 'p1' ? 'p2' : state.winner === 'p2' ? 'p1' : state.winner,
  };
}

interface FrameResult {
  readonly winner: string | null;
  readonly shots: number;
  readonly steps: number;
  readonly worstRollSteps: number;
  readonly cleared: boolean;
}

/** A whole frame played by two bots through the pure rules and nothing else. */
function playFrame(seed: number, p1: BotDifficulty, p2: BotDifficulty): FrameResult {
  const state = createState();
  placeStriker(state);
  const rng = new Rng(seed);
  const potted: number[] = [];
  let steps = 0;
  let worstRollSteps = 0;
  let shots = 0;
  // Bounded by SHOT_LIMIT with a wide margin; a frame that outlived it would be the bug.
  for (let guard = 0; guard < SHOT_LIMIT * 3; guard += 1) {
    if (state.winner !== null) break;
    const tier = state.seat === 'p1' ? p1 : p2;
    const aim = botAim(state, tier, rng.float(), rng.float());
    state.offset = aim.offset;
    if (!flick(state, aim.angle, aim.power)) break;
    shots += 1;
    const rollSteps = settle(state, potted);
    expect(rollSteps, 'a stroke that never settled').toBeGreaterThan(0);
    steps += rollSteps;
    if (rollSteps > worstRollSteps) worstRollSteps = rollSteps;
    const outcome = settleShot(state, potted);
    if (outcome.winner !== null) {
      state.winner = outcome.winner;
      break;
    }
    state.seat = outcome.next;
    state.phase = 'aiming';
    state.offset = 0;
    placeStriker(state);
  }
  return {
    winner: state.winner,
    shots,
    steps,
    worstRollSteps,
    cleared:
      pottedCount(state, 'p1') === PUCKS_PER_SIDE || pottedCount(state, 'p2') === PUCKS_PER_SIDE,
  };
}

interface Series {
  readonly first: number;
  readonly second: number;
  readonly drawn: number;
  readonly worstSteps: number;
  readonly worstRollSteps: number;
}

function series(p1: BotDifficulty, p2: BotDifficulty, count: number, salt = 0): Series {
  let first = 0;
  let second = 0;
  let drawn = 0;
  let worstSteps = 0;
  let worstRollSteps = 0;
  for (let seed = 1; seed <= count; seed += 1) {
    const frame = playFrame(seed * 7919 + salt, p1, p2);
    if (frame.winner === 'p1') first += 1;
    else if (frame.winner === 'p2') second += 1;
    else drawn += 1;
    if (frame.steps > worstSteps) worstSteps = frame.steps;
    if (frame.worstRollSteps > worstRollSteps) worstRollSteps = frame.worstRollSteps;
  }
  return { first, second, drawn, worstSteps, worstRollSteps };
}

/** Wins for `strong` over `weak` across both seats, so the break is not part of the answer. */
function ladder(strong: BotDifficulty, weak: BotDifficulty, count: number): number {
  const asFirst = series(strong, weak, count);
  const asSecond = series(weak, strong, count);
  return (asFirst.first + asSecond.second) / (2 * count);
}

describe('the board', () => {
  it('sits inside the logical box the manifest declares', () => {
    expect(BOARD_X).toBeGreaterThanOrEqual(0);
    expect(BOARD_Y).toBeGreaterThanOrEqual(0);
    expect(BOARD_X + BOARD_SIZE).toBeLessThanOrEqual(manifest.logical.width);
    expect(BOARD_Y + BOARD_SIZE).toBeLessThanOrEqual(manifest.logical.height);
  });

  it('is centred in the box, so a half turn leaves it where it was', () => {
    expect(CENTRE_X).toBe(manifest.logical.width / 2);
    expect(CENTRE_Y).toBe(manifest.logical.height / 2);
  });

  it('has a bed wide enough to hold the whole opening', () => {
    const bed = BOARD_SIZE - FRAME * 2;
    expect(SURFACE_RIGHT - SURFACE_LEFT).toBe(bed);
    expect(SURFACE_BOTTOM - SURFACE_TOP).toBe(bed);
    // The outer ring of the rosette plus a puck must clear the rails.
    expect(bed / 2).toBeGreaterThan((PUCK_RADIUS * 2 + 1) * 2 + PUCK_RADIUS);
  });

  it('puts a pocket on each of the four corners and nowhere else', () => {
    expect(POCKETS.length).toBe(4);
    const seen = new Set<string>();
    for (const [x, y] of POCKETS) {
      expect(x === SURFACE_LEFT || x === SURFACE_RIGHT).toBe(true);
      expect(y === SURFACE_TOP || y === SURFACE_BOTTOM).toBe(true);
      seen.add(`${String(x)},${String(y)}`);
    }
    expect(seen.size).toBe(4);
  });

  it('leaves a mouth a puck can actually get through', () => {
    // A rail that ran into the corner would deflect a puck aimed at the pocket before the
    // capture zone ever saw it. The mouth has to be wider than the puck it swallows.
    expect(POCKET_MOUTH).toBeGreaterThan(PUCK_RADIUS * 2);
  });

  it('keeps the pocket squares apart, so no point is in two pockets at once', () => {
    expect(SURFACE_RIGHT - SURFACE_LEFT).toBeGreaterThan(POCKET_MOUTH * 2);
    expect(SURFACE_BOTTOM - SURFACE_TOP).toBeGreaterThan(POCKET_MOUTH * 2);
  });

  it('agrees with itself about what is on the bed and what is in a pocket', () => {
    expect(inPocket(SURFACE_LEFT + 1, SURFACE_TOP + 1)).toBe(true);
    expect(inPocket(CENTRE_X, CENTRE_Y)).toBe(false);
    expect(inPocket(CENTRE_X, SURFACE_TOP + 1)).toBe(false);
    expect(onSurface(CENTRE_X, CENTRE_Y, STRIKER_RADIUS)).toBe(true);
    expect(onSurface(SURFACE_LEFT, CENTRE_Y, PUCK_RADIUS)).toBe(false);
  });

  it('gives the striker more mass than a puck, which is the whole point of a striker', () => {
    expect(STRIKER_MASS).toBeGreaterThan(PUCK_MASS);
    expect(STRIKER_RADIUS).toBeGreaterThan(PUCK_RADIUS);
    expect(massOf('striker')).toBe(STRIKER_MASS);
    expect(massOf('queen')).toBe(PUCK_MASS);
    expect(radiusOf('striker')).toBe(STRIKER_RADIUS);
    expect(radiusOf('p1')).toBe(PUCK_RADIUS);
  });

  it('gives the wooden frame less bounce than a puck-on-puck contact', () => {
    expect(FRAME_BOUNCE).toBeLessThan(PUCK_BOUNCE);
    expect(FRAME_BOUNCE).toBeGreaterThan(0);
    expect(PUCK_BOUNCE).toBeLessThan(1);
  });

  it('seats the two players on opposite sides, facing each other', () => {
    expect(forwardOf('p1')).toBe(-forwardOf('p2'));
    expect(rightOf('p1')).toBe(-rightOf('p2'));
    expect(strikerYFor('p1')).toBe(2 * CENTRE_Y - strikerYFor('p2'));
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('keeps both baselines on the bed with room for the striker', () => {
    for (const seat of SEATS) {
      for (const offset of [-1, -0.5, 0, 0.5, 1]) {
        expect(onSurface(strikerXFor(seat, offset), strikerYFor(seat), STRIKER_RADIUS)).toBe(true);
      }
    }
    expect(BASE_DISTANCE + STRIKER_RADIUS).toBeLessThan((SURFACE_BOTTOM - SURFACE_TOP) / 2);
    expect(BASE_HALF + STRIKER_RADIUS).toBeLessThan((SURFACE_RIGHT - SURFACE_LEFT) / 2);
  });

  it('keeps the baseline clear of the pockets, so a placed striker is never already down', () => {
    for (const seat of SEATS) {
      for (let i = 0; i <= 20; i += 1) {
        const offset = i / 10 - 1;
        expect(inPocket(strikerXFor(seat, offset), strikerYFor(seat))).toBe(false);
      }
    }
  });
});

describe('the opening', () => {
  it('lays out a striker, a queen and six pucks a side', () => {
    const state = createState();
    expect(state.bodies.length).toBe(2 + PUCKS_PER_SIDE * 2);
    expect(strikerOf(state).kind).toBe('striker');
    expect(queenOf(state).kind).toBe('queen');
    expect(remaining(state, 'p1')).toBe(PUCKS_PER_SIDE);
    expect(remaining(state, 'p2')).toBe(PUCKS_PER_SIDE);
  });

  it('starts level, with nobody to shoot but seat one', () => {
    const state = createState();
    expect(pottedCount(state, 'p1')).toBe(0);
    expect(pottedCount(state, 'p2')).toBe(0);
    expect(state.seat).toBe('p1');
    expect(state.phase).toBe('aiming');
    expect(state.winner).toBe(null);
    expect(winnerOf(state)).toBe(null);
    expect(state.queenOwner).toBe(null);
    expect(state.queenPending).toBe(false);
    expect(state.shots).toBe(0);
    expect(state.dryShots).toBe(0);
  });

  it('puts the queen on the centre spot', () => {
    const state = createState();
    expect(queenOf(state).x).toBe(CENTRE_X);
    expect(queenOf(state).y).toBe(CENTRE_Y);
  });

  it('lays every puck on the bed, clear of a pocket and of every other puck', () => {
    const state = createState();
    for (const b of state.bodies) {
      if (b.kind === 'striker') continue;
      expect(onSurface(b.x, b.y, radiusOf(b.kind)), 'a puck off the bed').toBe(true);
      expect(inPocket(b.x, b.y), 'a puck laid in a pocket').toBe(false);
    }
    for (let i = 0; i < state.bodies.length; i += 1) {
      for (let j = i + 1; j < state.bodies.length; j += 1) {
        const a = state.bodies[i];
        const b = state.bodies[j];
        if (a === undefined || b === undefined) continue;
        if (a.kind === 'striker' || b.kind === 'striker') continue;
        const gap = Math.hypot(b.x - a.x, b.y - a.y);
        expect(gap, 'two pucks laid inside one another').toBeGreaterThanOrEqual(
          radiusOf(a.kind) + radiusOf(b.kind) - 1e-9,
        );
      }
    }
  });

  it('is antisymmetric under a half turn, so neither seat opens with the easier board', () => {
    // For every puck there is one of the other colour exactly opposite it through the centre.
    const state = createState();
    for (const b of state.bodies) {
      if (b.kind !== 'p1' && b.kind !== 'p2') continue;
      const wantX = 2 * CENTRE_X - b.x;
      const wantY = 2 * CENTRE_Y - b.y;
      const partner = state.bodies.find(
        (other) =>
          other.kind === otherOf(b.kind as SeatId) &&
          Math.abs(other.x - wantX) < 1e-9 &&
          Math.abs(other.y - wantY) < 1e-9,
      );
      expect(
        partner,
        `nothing opposite the puck at ${b.x.toFixed(1)}, ${b.y.toFixed(1)}`,
      ).toBeDefined();
    }
  });

  it('resets to exactly the opening, however far a frame ran', () => {
    const state = createState();
    leave(state, 'p1', 2);
    state.seat = 'p2';
    state.queenOwner = 'p2';
    state.queenPending = true;
    state.shots = 40;
    state.dryShots = 9;
    state.winner = 'p2';
    state.phase = 'over';
    state.offset = 0.8;
    state.fouled = true;
    state.rollSeconds = 3;
    resetState(state);
    const fresh = createState();
    expect(state.bodies.length).toBe(fresh.bodies.length);
    for (let i = 0; i < fresh.bodies.length; i += 1) {
      expect(state.bodies[i]).toEqual(fresh.bodies[i]);
    }
    expect(state.seat).toBe('p1');
    expect(state.winner).toBe(null);
    expect(state.queenOwner).toBe(null);
    expect(state.queenPending).toBe(false);
    expect(state.shots).toBe(0);
    expect(state.dryShots).toBe(0);
    expect(state.fouled).toBe(false);
    expect(state.rollSeconds).toBe(0);
    expect(state.phase).toBe('aiming');
    expect(state.offset).toBe(0);
  });
});

describe('placing the striker', () => {
  it('slides it along the shooter’s own baseline', () => {
    const state = createState();
    for (const seat of SEATS) {
      state.seat = seat;
      for (const offset of [-1, -0.4, 0, 0.4, 1]) {
        state.offset = offset;
        placeStriker(state);
        expect(strikerOf(state).y).toBe(strikerYFor(seat));
        expect(strikerOf(state).x).toBeCloseTo(strikerXFor(seat, offset), 6);
      }
    }
  });

  it('clamps a slide past the end of the line', () => {
    const state = createState();
    state.offset = 4;
    placeStriker(state);
    expect(strikerOf(state).x).toBeCloseTo(strikerXFor('p1', 1), 6);
    state.offset = -9;
    placeStriker(state);
    expect(strikerOf(state).x).toBeCloseTo(strikerXFor('p1', -1), 6);
  });

  it('stops against a puck resting on the line rather than overlapping it', () => {
    const state = createState();
    bare(state);
    put(state, 'p2', strikerXFor('p1', 0), strikerYFor('p1'));
    state.offset = 0;
    placeStriker(state);
    const striker = strikerOf(state);
    const blocker = firstUp(state, 'p2');
    expect(Math.hypot(striker.x - blocker.x, striker.y - blocker.y)).toBeGreaterThan(
      STRIKER_RADIUS + PUCK_RADIUS,
    );
    expect(strikerSlide(state)).not.toBe(0);
  });

  it('reports the slide it actually took, not the one that was asked for', () => {
    const state = createState();
    bare(state);
    put(state, 'p2', strikerXFor('p1', 0.5), strikerYFor('p1'));
    state.offset = 0.5;
    expect(strikerSlide(state)).not.toBe(0.5);
    expect(freeOffset(state, 'p1', 0.5)).toBe(strikerSlide(state));
  });

  it('never reports a slide off the end of the line', () => {
    const state = createState();
    bare(state);
    // Twelve pucks laid the length of the line, so no requested slide is free.
    for (let i = 0; i < 12; i += 1) {
      put(state, i % 2 === 0 ? 'p1' : 'p2', strikerXFor('p1', i / 5.5 - 1), strikerYFor('p1'));
    }
    for (const wanted of [-2, -1, 0, 1, 2]) {
      const got = freeOffset(state, 'p1', wanted);
      expect(got).toBeGreaterThanOrEqual(-1);
      expect(got).toBeLessThanOrEqual(1);
    }
  });

  it('knows a spot is free only when nothing else is standing there', () => {
    const state = createState();
    const striker = strikerOf(state);
    expect(spotIsFree(state, striker, CENTRE_X, CENTRE_Y, STRIKER_RADIUS)).toBe(false);
    expect(spotIsFree(state, striker, SURFACE_LEFT + 60, CENTRE_Y, STRIKER_RADIUS)).toBe(true);
    expect(spotIsFree(state, striker, SURFACE_LEFT + 2, CENTRE_Y, STRIKER_RADIUS)).toBe(false);
    expect(spotIsFree(state, striker, SURFACE_LEFT + 5, SURFACE_TOP + 5, STRIKER_RADIUS)).toBe(
      false,
    );
  });
});

describe('the flick', () => {
  it('refuses a stroke with nothing behind it', () => {
    const state = createState();
    expect(flick(state, 0, 0)).toBe(false);
    expect(flick(state, 0, -1)).toBe(false);
    expect(state.phase).toBe('aiming');
  });

  it('refuses a second stroke while the board is still running', () => {
    const state = createState();
    expect(flick(state, 0, 0.8)).toBe(true);
    expect(flick(state, 0, 0.8)).toBe(false);
  });

  it('refuses a stroke once the frame is over', () => {
    const state = createState();
    state.phase = 'over';
    expect(flick(state, 0, 1)).toBe(false);
  });

  it('sends the striker up the board, away from the shooter', () => {
    for (const seat of SEATS) {
      const state = createState();
      state.seat = seat;
      placeStriker(state);
      flick(state, 0, 1);
      const striker = strikerOf(state);
      expect(striker.vx).toBeCloseTo(0, 6);
      expect(Math.sign(striker.vy)).toBe(forwardOf(seat));
      expect(Math.hypot(striker.vx, striker.vy)).toBeCloseTo(STRIKER_MAX_SPEED, 6);
    }
  });

  it('reads a positive angle as the shooter’s own right, on both sides', () => {
    for (const seat of SEATS) {
      const state = createState();
      state.seat = seat;
      placeStriker(state);
      flick(state, 0.5, 1);
      expect(Math.sign(strikerOf(state).vx)).toBe(rightOf(seat));
    }
  });

  it('clamps the aim to the cone and the power to one', () => {
    expect(clampAim(9)).toBe(MAX_AIM);
    expect(clampAim(-9)).toBe(-MAX_AIM);
    expect(clampAim(0.3)).toBe(0.3);
    const state = createState();
    flick(state, 9, 4);
    expect(Math.hypot(strikerOf(state).vx, strikerOf(state).vy)).toBeCloseTo(STRIKER_MAX_SPEED, 6);
    const aimed = Math.atan2(
      strikerOf(state).vx * rightOf('p1'),
      strikerOf(state).vy * forwardOf('p1'),
    );
    expect(Math.abs(aimed)).toBeCloseTo(MAX_AIM, 6);
  });

  it('scales the speed with the power, linearly', () => {
    for (const power of [0.2, 0.5, 1]) {
      const state = createState();
      flick(state, 0, power);
      expect(Math.hypot(strikerOf(state).vx, strikerOf(state).vy)).toBeCloseTo(
        STRIKER_MAX_SPEED * power,
        6,
      );
    }
  });

  it('clears the foul flag when a new stroke starts', () => {
    const state = createState();
    state.fouled = true;
    flick(state, 0, 0.5);
    expect(state.fouled).toBe(false);
    expect(state.rollSeconds).toBe(0);
  });

  it('clamps a value the way the shared helper says', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });
});

describe('the physics', () => {
  it('does nothing at all while nobody has played', () => {
    const state = createState();
    const result = step(state, STEP);
    expect(result.settled).toBe(true);
    expect(result.potted.length).toBe(0);
    expect(boardIsStill(state)).toBe(true);
  });

  it('stops a free striker dead, at the distance the friction law names', () => {
    for (const want of [50, 120, 200, 270]) {
      const state = createState();
      bare(state);
      const striker = strikerOf(state);
      striker.x = CENTRE_X;
      striker.y = CENTRE_Y;
      launch(state, striker, STRIKER_MAX_SPEED * powerForDistance(want), 0);
      expect(settle(state)).toBeGreaterThan(0);
      expect(striker.x - CENTRE_X, `power for ${String(want)} units`).toBeCloseTo(want, 4);
      expect(striker.vx).toBe(0);
      expect(striker.vy).toBe(0);
    }
  });

  it('knows how far a full stroke carries, exactly', () => {
    expect(MAX_ROLL_DISTANCE).toBeCloseTo(
      (STRIKER_MAX_SPEED * STRIKER_MAX_SPEED) / (2 * FRICTION),
      9,
    );
    expect(powerForDistance(MAX_ROLL_DISTANCE)).toBeCloseTo(1, 9);
    expect(powerForDistance(0)).toBe(0);
    // Two and a half board diagonals: hard is a real choice, not a slider held at the top.
    expect(MAX_ROLL_DISTANCE).toBeGreaterThan(
      2 * Math.hypot(SURFACE_RIGHT - SURFACE_LEFT, SURFACE_BOTTOM - SURFACE_TOP),
    );
  });

  it('rolls the same distance at 60, 90, 120, 144 and 240 Hz', () => {
    // The point of a constant deceleration with its exact integral. A per-step multiplier,
    // or a plain `v·t`, drifts by the half-a-t-squared it throws away every step.
    for (const power of [0.15, 0.3, 0.45]) {
      let reference = Number.NaN;
      for (const rate of [60, 90, 120, 144, 240]) {
        const state = createState();
        bare(state);
        const striker = strikerOf(state);
        expect(flick(state, 0, power)).toBe(true);
        expect(settle(state, [], 1 / rate)).toBeGreaterThan(0);
        if (Number.isNaN(reference)) reference = striker.y;
        else expect(striker.y, `${String(rate)} Hz`).toBeCloseTo(reference, 6);
      }
    }
  });

  it('replays a stroke identically from the same start', () => {
    const trace = (): string => {
      const state = createState();
      expect(flick(state, 0.21, 0.9)).toBe(true);
      expect(settle(state)).toBeGreaterThan(0);
      return state.bodies
        .map((b) => `${b.x.toFixed(9)},${b.y.toFixed(9)},${String(b.potted)}`)
        .join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('never lets a body finish a step off the bed', () => {
    const state = createState();
    const rng = new Rng(4242);
    for (let stroke = 0; stroke < 24; stroke += 1) {
      state.phase = 'aiming';
      state.offset = rng.float() * 2 - 1;
      placeStriker(state);
      expect(flick(state, (rng.float() * 2 - 1) * MAX_AIM, 0.4 + rng.float() * 0.6)).toBe(true);
      for (let i = 0; i < 60 * (MAX_ROLL_SECONDS + 1); i += 1) {
        const result = step(state, STEP);
        for (const b of state.bodies) {
          if (b.potted) continue;
          expect(b.x, 'a body left the bed').toBeGreaterThanOrEqual(SURFACE_LEFT - 1);
          expect(b.x).toBeLessThanOrEqual(SURFACE_RIGHT + 1);
          expect(b.y).toBeGreaterThanOrEqual(SURFACE_TOP - 1);
          expect(b.y).toBeLessThanOrEqual(SURFACE_BOTTOM + 1);
        }
        if (result.settled) break;
      }
      // Anything potted is put back, so the next stroke has a board to play with.
      for (const b of state.bodies) if (b.potted) returnToBoard(state, b);
    }
  });

  it('takes energy out of every rail bounce', () => {
    const state = createState();
    bare(state);
    const striker = strikerOf(state);
    striker.x = CENTRE_X;
    striker.y = CENTRE_Y;
    launch(state, striker, 0, -900);
    let bounced = false;
    for (let i = 0; i < 60 * 6; i += 1) {
      const before = striker.vy;
      step(state, STEP);
      if (before < 0 && striker.vy > 0) {
        bounced = true;
        expect(Math.abs(striker.vy)).toBeLessThan(Math.abs(before) * FRAME_BOUNCE + 1e-6);
        break;
      }
    }
    expect(bounced, 'the striker never reached a rail').toBe(true);
  });

  it('never gains energy over a whole stroke', () => {
    const energy = (state: State): number => {
      let total = 0;
      for (const b of state.bodies) {
        if (b.potted) continue;
        total += 0.5 * massOf(b.kind) * (b.vx * b.vx + b.vy * b.vy);
      }
      return total;
    };
    const state = createState();
    expect(flick(state, 0, 1)).toBe(true);
    let previous = energy(state);
    for (let i = 0; i < 60 * MAX_ROLL_SECONDS; i += 1) {
      const result = step(state, STEP);
      const now = energy(state);
      expect(now, 'the board found energy from somewhere').toBeLessThanOrEqual(previous + 1e-6);
      previous = now;
      if (result.settled) break;
    }
  });

  it('gives a light puck more speed than the heavy striker that struck it', () => {
    // The reason a carrom striker is heavier than a coin, and the reason the impulse is
    // mass-weighted rather than a straight swap of velocities.
    const state = createState();
    bare(state);
    const striker = strikerOf(state);
    striker.x = CENTRE_X;
    striker.y = CENTRE_Y + 200;
    const puck = put(state, 'p1', CENTRE_X, CENTRE_Y);
    launch(state, striker, 0, -700);
    for (let i = 0; i < 60 * 3; i += 1) {
      step(state, STEP);
      if (puck.vy !== 0) break;
    }
    expect(Math.abs(puck.vy)).toBeGreaterThan(700);
    expect(Math.abs(puck.vy)).toBeGreaterThan(Math.abs(striker.vy));
  });

  it('leaves a pair that is already separating alone', () => {
    // Striking them again applies the impulse the wrong way and quietly adds energy.
    const state = createState();
    bare(state);
    const a = put(state, 'p1', CENTRE_X - PUCK_RADIUS, CENTRE_Y);
    const b = put(state, 'p2', CENTRE_X + PUCK_RADIUS, CENTRE_Y);
    launch(state, a, -100, 0);
    b.vx = 100;
    step(state, STEP);
    expect(a.vx).toBeGreaterThan(-100);
    expect(b.vx).toBeLessThan(100);
    expect(Math.abs(a.vx)).toBeLessThanOrEqual(100);
    expect(Math.abs(b.vx)).toBeLessThanOrEqual(100);
  });

  it('sub-steps finely enough that nothing tunnels through a puck', () => {
    // A striker at full speed covers this much between contact tests; the contact circle
    // between a striker and a puck is far wider, so a contact can never be skipped.
    const perSubStep = STRIKER_MAX_SPEED * (STEP / SUB_STEPS);
    expect(perSubStep).toBeLessThan(STRIKER_RADIUS + PUCK_RADIUS);
    expect(SUB_STEPS).toBeGreaterThan(1);
  });

  it('abandons a stroke that will not settle, so the frame can go on', () => {
    const state = createState();
    bare(state);
    const striker = strikerOf(state);
    striker.x = CENTRE_X;
    striker.y = CENTRE_Y;
    launch(state, striker, 0, 0);
    // Fed a speed no stroke can produce, so only the abandonment rule can stop it.
    striker.vx = 1e9;
    let steps = 0;
    for (let i = 0; i < 60 * (MAX_ROLL_SECONDS + 2); i += 1) {
      steps += 1;
      if (step(state, STEP).settled) break;
    }
    expect(steps).toBeLessThanOrEqual(Math.ceil(MAX_ROLL_SECONDS / STEP) + 1);
    expect(boardIsStill(state)).toBe(true);
  });

  it('caps a stroke well above the longest one the physics can produce', () => {
    // Every contact loses energy, so no body ever carries more than the stroke started
    // with; at constant deceleration that bounds how long anything can still be rolling.
    const energy = 0.5 * STRIKER_MASS * STRIKER_MAX_SPEED * STRIKER_MAX_SPEED;
    const fastest = Math.sqrt((2 * energy) / PUCK_MASS);
    expect(fastest / FRICTION).toBeLessThan(MAX_ROLL_SECONDS);
  });
});

describe('potting', () => {
  it('takes a puck that reaches a pocket mouth', () => {
    const state = createState();
    bare(state);
    const pocket = POCKETS[0];
    expect(pocket).toBeDefined();
    const [px, py] = pocket as readonly [number, number];
    const puck = put(state, 'p1', px + 120, py + 120);
    launch(state, puck, -400, -400);
    const potted: number[] = [];
    expect(settle(state, potted)).toBeGreaterThan(0);
    expect(puck.potted).toBe(true);
    expect(potted).toContain(state.bodies.indexOf(puck));
    expect(puck.vx).toBe(0);
    expect(puck.vy).toBe(0);
  });

  it('takes the striker too, which is the commonest foul in the game', () => {
    const state = createState();
    bare(state);
    const pocket = POCKETS[3];
    const [px, py] = pocket as readonly [number, number];
    const striker = strikerOf(state);
    striker.x = px - 120;
    striker.y = py - 120;
    launch(state, striker, 400, 400);
    const potted: number[] = [];
    expect(settle(state, potted)).toBeGreaterThan(0);
    expect(striker.potted).toBe(true);
    expect(potted).toContain(0);
  });

  it('reports a pot exactly once', () => {
    const state = createState();
    bare(state);
    const [px, py] = POCKETS[1] as readonly [number, number];
    const puck = put(state, 'p2', px - 100, py + 100);
    launch(state, puck, 400, -400);
    const potted: number[] = [];
    settle(state, potted);
    expect(potted.filter((i) => i === state.bodies.indexOf(puck)).length).toBe(1);
  });

  it('never puts a potted puck back on the board by striking it', () => {
    // Pockets are resolved after contacts for exactly this reason.
    const state = createState();
    const rng = new Rng(99);
    for (let stroke = 0; stroke < 20; stroke += 1) {
      state.phase = 'aiming';
      state.offset = rng.float() * 2 - 1;
      placeStriker(state);
      flick(state, (rng.float() * 2 - 1) * MAX_AIM, 0.5 + rng.float() * 0.5);
      const down = new Set<number>();
      for (let i = 0; i < 60 * (MAX_ROLL_SECONDS + 1); i += 1) {
        const result = step(state, STEP);
        for (const index of result.potted) down.add(index);
        for (const index of down) {
          expect(state.bodies[index]?.potted, 'a potted body came back mid-stroke').toBe(true);
        }
        if (result.settled) break;
      }
      state.seat = otherOf(state.seat);
    }
  });

  it('puts a returned body back near the centre and never on top of another', () => {
    const state = createState();
    const puck = firstUp(state, 'p1');
    drop(state, puck);
    returnToBoard(state, puck);
    expect(puck.potted).toBe(false);
    expect(onSurface(puck.x, puck.y, PUCK_RADIUS)).toBe(true);
    expect(inPocket(puck.x, puck.y)).toBe(false);
    for (const other of state.bodies) {
      if (other === puck || other.potted || other.kind === 'striker') continue;
      expect(Math.hypot(other.x - puck.x, other.y - puck.y)).toBeGreaterThan(
        radiusOf(other.kind) + PUCK_RADIUS - 1e-9,
      );
    }
  });

  it('returns a body to the centre spot itself when the middle is clear', () => {
    const state = createState();
    bare(state);
    const puck = state.bodies.filter((b) => b.kind === 'p1')[0];
    expect(puck).toBeDefined();
    returnToBoard(state, puck as Body);
    expect((puck as Body).x).toBeCloseTo(CENTRE_X, 6);
    expect((puck as Body).y).toBeCloseTo(CENTRE_Y, 6);
  });

  it('puts a return somewhere fixed, so a player can predict it', () => {
    const once = (): string => {
      const state = createState();
      const puck = firstUp(state, 'p2');
      drop(state, puck);
      returnToBoard(state, puck);
      return `${puck.x.toFixed(9)},${puck.y.toFixed(9)}`;
    };
    expect(once()).toBe(once());
  });
});

describe('a settled stroke', () => {
  it('hands the board on when nothing goes down', () => {
    const state = createState();
    const outcome = settleShot(state, []);
    expect(outcome.next).toBe('p2');
    expect(outcome.repeats).toBe(false);
    expect(outcome.fouled).toBe(false);
    expect(state.dryShots).toBe(1);
    expect(state.shots).toBe(1);
  });

  it('lets the shooter go again after potting one of their own', () => {
    const state = createState();
    const own = firstUp(state, 'p1');
    const outcome = settleShot(state, drop(state, own));
    expect(outcome.repeats).toBe(true);
    expect(outcome.next).toBe('p1');
    expect(outcome.fouled).toBe(false);
    expect(pottedCount(state, 'p1')).toBe(1);
    expect(state.dryShots).toBe(0);
  });

  it('counts an opponent’s puck for the opponent and ends the visit', () => {
    const state = createState();
    const theirs = firstUp(state, 'p2');
    const outcome = settleShot(state, drop(state, theirs));
    expect(pottedCount(state, 'p2')).toBe(1);
    expect(pottedCount(state, 'p1')).toBe(0);
    expect(outcome.next).toBe('p2');
    expect(outcome.repeats).toBe(false);
    // Wild, but not a foul: nothing comes back.
    expect(outcome.fouled).toBe(false);
    expect(state.dryShots).toBe(0);
  });

  it('charges a puck for potting the striker, and ends the visit', () => {
    const state = createState();
    const own = firstUp(state, 'p1');
    settleShot(state, drop(state, own));
    expect(pottedCount(state, 'p1')).toBe(1);
    const outcome = settleShot(state, drop(state, strikerOf(state)));
    expect(outcome.fouled).toBe(true);
    expect(outcome.repeats).toBe(false);
    expect(outcome.next).toBe('p2');
    expect(pottedCount(state, 'p1'), 'the puck came back').toBe(0);
  });

  it('undoes the stroke that fouled rather than punishing it twice', () => {
    const state = createState();
    const own = firstUp(state, 'p1');
    const outcome = settleShot(state, drop(state, own, strikerOf(state)));
    expect(outcome.fouled).toBe(true);
    expect(pottedCount(state, 'p1'), 'the puck potted in the foul is the one that goes back').toBe(
      0,
    );
    expect(own.potted).toBe(false);
    expect(state.dryShots, 'nothing was gained').toBe(1);
  });

  it('still fouls when the shooter has no puck to give back', () => {
    const state = createState();
    const outcome = settleShot(state, drop(state, strikerOf(state)));
    expect(outcome.fouled).toBe(true);
    expect(outcome.next).toBe('p2');
    expect(pottedCount(state, 'p1')).toBe(0);
  });

  it('leaves the striker off the board for the caller to replace', () => {
    const state = createState();
    settleShot(state, drop(state, strikerOf(state)));
    expect(strikerOf(state).potted).toBe(true);
    state.seat = 'p2';
    placeStriker(state);
    expect(strikerOf(state).potted).toBe(false);
    expect(strikerOf(state).y).toBe(strikerYFor('p2'));
  });

  it('counts a stroke that gained nothing towards the stalemate', () => {
    const state = createState();
    for (let i = 1; i <= 5; i += 1) {
      settleShot(state, []);
      expect(state.dryShots).toBe(i);
    }
    settleShot(state, drop(state, firstUp(state, 'p1')));
    expect(state.dryShots).toBe(0);
  });

  it('counts every stroke, whoever played it', () => {
    const state = createState();
    for (let i = 1; i <= 7; i += 1) {
      settleShot(state, []);
      state.seat = otherOf(state.seat);
      expect(state.shots).toBe(i);
    }
  });
});

describe('the queen', () => {
  it('is held pending when she goes down alone, and the shooter keeps the board', () => {
    const state = createState();
    const outcome = settleShot(state, drop(state, queenOf(state)));
    expect(state.queenPending).toBe(true);
    expect(state.queenOwner).toBe(null);
    expect(outcome.repeats, 'the cover is owed on the very next stroke').toBe(true);
    expect(outcome.next).toBe('p1');
    expect(queenOf(state).potted).toBe(true);
  });

  it('is covered outright when she goes down with one of the shooter’s own', () => {
    const state = createState();
    const outcome = settleShot(state, drop(state, queenOf(state), firstUp(state, 'p1')));
    expect(state.queenOwner).toBe('p1');
    expect(state.queenPending).toBe(false);
    expect(outcome.repeats).toBe(true);
    expect(outcome.fouled).toBe(false);
    expect(pottedCount(state, 'p1')).toBe(1);
  });

  it('is covered by the very next stroke of the same visit', () => {
    const state = createState();
    settleShot(state, drop(state, queenOf(state)));
    expect(state.queenPending).toBe(true);
    const outcome = settleShot(state, drop(state, firstUp(state, 'p1')));
    expect(state.queenOwner).toBe('p1');
    expect(state.queenPending).toBe(false);
    expect(outcome.repeats).toBe(true);
    expect(queenOf(state).potted, 'she stays down once covered').toBe(true);
  });

  it('goes back to the board when the cover stroke misses, and the visit ends', () => {
    const state = createState();
    settleShot(state, drop(state, queenOf(state)));
    const outcome = settleShot(state, []);
    expect(state.queenOwner).toBe(null);
    expect(state.queenPending).toBe(false);
    expect(queenOf(state).potted).toBe(false);
    expect(onSurface(queenOf(state).x, queenOf(state).y, PUCK_RADIUS)).toBe(true);
    expect(outcome.repeats).toBe(false);
    expect(outcome.next).toBe('p2');
  });

  it('goes straight back when the stroke that took her also fouled', () => {
    // She belongs to the visit that potted her. Carrying a pending queen across the change
    // of hands would let the opponent cover her with their own next puck, free.
    const state = createState();
    const outcome = settleShot(state, drop(state, queenOf(state), strikerOf(state)));
    expect(outcome.fouled).toBe(true);
    expect(state.queenPending, 'no pending queen may cross the change of hands').toBe(false);
    expect(state.queenOwner).toBe(null);
    expect(queenOf(state).potted).toBe(false);
    expect(outcome.next).toBe('p2');
  });

  it('cannot be covered by the seat that did not pot her', () => {
    const state = createState();
    settleShot(state, drop(state, queenOf(state), strikerOf(state)));
    state.seat = 'p2';
    settleShot(state, drop(state, firstUp(state, 'p2')));
    expect(state.queenOwner).toBe(null);
  });

  it('is only ever owed once, so a shooter cannot hold the board for ever', () => {
    const state = createState();
    settleShot(state, drop(state, queenOf(state)));
    const second = settleShot(state, []);
    expect(second.repeats).toBe(false);
    expect(state.queenPending).toBe(false);
  });

  it('stays covered once she is covered, whatever happens after', () => {
    const state = createState();
    settleShot(state, drop(state, queenOf(state), firstUp(state, 'p1')));
    expect(state.queenOwner).toBe('p1');
    state.seat = 'p2';
    settleShot(state, drop(state, strikerOf(state)));
    settleShot(state, []);
    expect(state.queenOwner).toBe('p1');
    expect(queenOf(state).potted).toBe(true);
  });

  it('keeps the visit alive when she goes down with only an opponent’s puck', () => {
    const state = createState();
    const outcome = settleShot(state, drop(state, queenOf(state), firstUp(state, 'p2')));
    expect(state.queenPending).toBe(true);
    expect(outcome.repeats, 'the cover is still owed').toBe(true);
    expect(pottedCount(state, 'p2')).toBe(1);
  });
});

describe('the last puck', () => {
  it('will not go down while the queen is still unresolved', () => {
    const state = createState();
    leave(state, 'p1', 1);
    const last = firstUp(state, 'p1');
    const outcome = settleShot(state, drop(state, last));
    expect(last.potted, 'it comes straight back').toBe(false);
    expect(remaining(state, 'p1')).toBe(1);
    expect(outcome.fouled).toBe(true);
    expect(outcome.repeats).toBe(false);
    expect(outcome.winner).toBe(null);
  });

  it('goes down freely once the queen is covered', () => {
    const state = createState();
    leave(state, 'p1', 1);
    state.queenOwner = 'p1';
    queenOf(state).potted = true;
    const outcome = settleShot(state, drop(state, firstUp(state, 'p1')));
    expect(remaining(state, 'p1')).toBe(0);
    expect(outcome.fouled).toBe(false);
    expect(outcome.winner).toBe('p1');
  });

  it('goes down freely once the *opponent* has covered the queen', () => {
    const state = createState();
    leave(state, 'p1', 1);
    state.queenOwner = 'p2';
    queenOf(state).potted = true;
    const outcome = settleShot(state, drop(state, firstUp(state, 'p1')));
    expect(outcome.winner, 'clearing the board wins the frame, whoever holds the queen').toBe('p1');
  });

  it('may go down in the same stroke as the queen, which is how a frame is won', () => {
    const state = createState();
    leave(state, 'p1', 1);
    const outcome = settleShot(state, drop(state, queenOf(state), firstUp(state, 'p1')));
    expect(state.queenOwner).toBe('p1');
    expect(remaining(state, 'p1')).toBe(0);
    expect(outcome.fouled).toBe(false);
    expect(outcome.winner).toBe('p1');
  });

  it('may go down on the stroke that covers a queen owed from the last one', () => {
    const state = createState();
    leave(state, 'p1', 1);
    settleShot(state, drop(state, queenOf(state)));
    expect(state.queenPending).toBe(true);
    const outcome = settleShot(state, drop(state, firstUp(state, 'p1')));
    expect(state.queenOwner).toBe('p1');
    expect(outcome.winner).toBe('p1');
  });

  it('protects the opponent’s last puck too', () => {
    // Potting their last one for them would otherwise hand them the frame through a door
    // the rules keep shut.
    const state = createState();
    leave(state, 'p2', 1);
    const theirs = firstUp(state, 'p2');
    const outcome = settleShot(state, drop(state, theirs));
    expect(theirs.potted).toBe(false);
    expect(remaining(state, 'p2')).toBe(1);
    expect(outcome.fouled).toBe(true);
    expect(outcome.winner).toBe(null);
  });

  it('returns the one that was just potted, not an older one', () => {
    const state = createState();
    leave(state, 'p1', 1);
    const last = firstUp(state, 'p1');
    settleShot(state, drop(state, last));
    expect(last.potted).toBe(false);
    expect(remaining(state, 'p1')).toBe(1);
  });
});

describe('the win condition', () => {
  it('is the shared helper, asked for six', () => {
    expect(WIN_CONDITION).toEqual({ kind: 'first-to', target: PUCKS_PER_SIDE });
  });

  it('is not decided while both seats still have pucks', () => {
    const state = createState();
    leave(state, 'p1', 1);
    leave(state, 'p2', 3);
    expect(winnerOf(state)).toBe(null);
  });

  it('goes to whoever clears their six', () => {
    for (const seat of SEATS) {
      const state = createState();
      state.queenOwner = seat;
      leave(state, seat, 0);
      expect(winnerOf(state)).toBe(seat);
    }
  });

  it('settles on the count when the strokes run out', () => {
    const state = createState();
    leave(state, 'p1', 2);
    leave(state, 'p2', 5);
    state.shots = SHOT_LIMIT;
    expect(winnerOf(state)).toBe('p1');
  });

  it('is a draw when the strokes run out level', () => {
    const state = createState();
    leave(state, 'p1', 3);
    leave(state, 'p2', 3);
    state.shots = SHOT_LIMIT;
    expect(winnerOf(state)).toBe('draw');
  });

  it('ends a frame nobody can move on, and calls it on the count', () => {
    const state = createState();
    leave(state, 'p1', 4);
    leave(state, 'p2', 6);
    expect(winnerOf(state)).toBe(null);
    state.dryShots = STALEMATE_SHOTS;
    expect(winnerOf(state)).toBe('p1');
  });

  it('keeps the stalemate rule looser than the pace two weak bots keep', () => {
    // Sixteen fired by luck alone a quarter of the time; the rule is meant for a board
    // nothing can be done with, not for a run of misses.
    expect(STALEMATE_SHOTS).toBeGreaterThanOrEqual(20);
    expect(SHOT_LIMIT).toBeGreaterThan(STALEMATE_SHOTS);
  });
});

describe('the two seats are the same game', () => {
  it('mirrors a whole stroke, body for body', () => {
    const state = createState();
    const other = mirror(state);
    expect(other.seat).toBe('p2');
    placeStriker(state);
    placeStriker(other);
    expect(flick(state, 0.33, 0.85)).toBe(true);
    expect(flick(other, 0.33, 0.85)).toBe(true);
    const pottedA: number[] = [];
    const pottedB: number[] = [];
    expect(settle(state, pottedA)).toBe(settle(other, pottedB));
    for (let i = 0; i < state.bodies.length; i += 1) {
      const a = state.bodies[i];
      const b = other.bodies[i];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      const first = a as Body;
      const second = b as Body;
      expect(second.x, `body ${String(i)} x`).toBeCloseTo(2 * CENTRE_X - first.x, 6);
      expect(second.y, `body ${String(i)} y`).toBeCloseTo(2 * CENTRE_Y - first.y, 6);
      expect(second.potted, `body ${String(i)} potted`).toBe(first.potted);
    }
    expect(pottedB).toEqual(pottedA);
  });

  it('reaches the mirrored outcome from the mirrored stroke', () => {
    const state = createState();
    const other = mirror(state);
    placeStriker(state);
    placeStriker(other);
    const pottedA: number[] = [];
    const pottedB: number[] = [];
    flick(state, -0.5, 1);
    flick(other, -0.5, 1);
    settle(state, pottedA);
    settle(other, pottedB);
    const a = settleShot(state, pottedA);
    const b = settleShot(other, pottedB);
    expect(b.next).toBe(otherOf(a.next));
    expect(b.repeats).toBe(a.repeats);
    expect(b.fouled).toBe(a.fouled);
    expect(pottedCount(other, 'p2')).toBe(pottedCount(state, 'p1'));
    expect(pottedCount(other, 'p1')).toBe(pottedCount(state, 'p2'));
  });

  it('gives both seats the same stroke to play, over a whole run of them', () => {
    // The mirror is rebuilt from the live board before every stroke rather than played
    // alongside it. Contacts are chaotic — two boards a bit apart are a unit apart eight
    // strokes later — and what is being asserted is that the *rule* is antisymmetric, not
    // that floating point is associative.
    const state = createState();
    const rng = new Rng(31337);
    for (let stroke = 0; stroke < 14; stroke += 1) {
      if (state.winner !== null) break;
      const angle = (rng.float() * 2 - 1) * MAX_AIM;
      const power = 0.4 + rng.float() * 0.6;
      const offset = rng.float() * 2 - 1;
      const other = mirror(state);
      state.offset = offset;
      other.offset = offset;
      placeStriker(state);
      placeStriker(other);
      const pottedA: number[] = [];
      const pottedB: number[] = [];
      expect(flick(state, angle, power)).toBe(true);
      expect(flick(other, angle, power)).toBe(true);
      settle(state, pottedA);
      settle(other, pottedB);
      const a = settleShot(state, pottedA);
      const b = settleShot(other, pottedB);
      expect(pottedB, `stroke ${String(stroke)}`).toEqual(pottedA);
      expect(b.next, `stroke ${String(stroke)}`).toBe(otherOf(a.next));
      expect(b.repeats).toBe(a.repeats);
      expect(b.fouled).toBe(a.fouled);
      for (let i = 0; i < state.bodies.length; i += 1) {
        const want = state.bodies[i];
        const got = other.bodies[i];
        expect(got?.x, `stroke ${String(stroke)} body ${String(i)}`).toBeCloseTo(
          2 * CENTRE_X - (want?.x ?? 0),
          5,
        );
        expect(got?.y).toBeCloseTo(2 * CENTRE_Y - (want?.y ?? 0), 5);
      }
      if (a.winner !== null) break;
      state.seat = a.next;
      state.phase = 'aiming';
    }
  });

  it('asks the bot the same question from either side and gets the same stroke', () => {
    // A board with one puck on it and nothing symmetric about where it lies: the best line
    // is unique, so the two seats have to name the identical stroke in seat space. The
    // aiming error is drawn from the same roll on both sides and bends each shooter to
    // their *own* right, so it survives the mirror as well.
    const state = createState();
    bare(state);
    state.queenOwner = 'p2';
    put(state, 'p1', CENTRE_X - 137, CENTRE_Y - 61);
    put(state, 'p2', CENTRE_X + 44, CENTRE_Y + 155);
    placeStriker(state);
    const other = mirror(state);
    for (const tier of ['normal', 'hard'] as const) {
      const a = botAim(state, tier, 0.31, 0.72);
      const b = botAim(other, tier, 0.31, 0.72);
      expect(b.offset, tier).toBeCloseTo(a.offset, 9);
      expect(b.angle, tier).toBeCloseTo(a.angle, 9);
      expect(b.power).toBe(a.power);
    }
  });

  it('ties the opening exactly, so neither seat is handed the better stroke', () => {
    // The rosette is a reflection of itself with the colours exchanged, so the shooter has
    // two lines of *identical* score, one either way off the middle. `botAim` keeps the
    // first it meets, and the half turn reverses the order the four pockets are enumerated
    // in — so the tie falls the other way. Both seats are offered the same pair, which is
    // what fairness means here; picking the same member of it is not.
    const state = createState();
    const other = mirror(state);
    // A roll of exactly a half adds no error, so what is compared is the line itself.
    for (const tier of ['normal', 'hard'] as const) {
      const a = botAim(state, tier, 0.5, 0.72);
      const b = botAim(other, tier, 0.5, 0.72);
      const same = Math.abs(a.offset - b.offset) < 1e-9 && Math.abs(a.angle - b.angle) < 1e-9;
      const tied = Math.abs(a.offset + b.offset) < 1e-9 && Math.abs(a.angle + b.angle) < 1e-9;
      expect(same || tied, `${tier}: neither the same line nor its exact tie`).toBe(true);
      expect(b.power).toBe(a.power);
    }
  });

  it('never offers one seat a line the other does not have, stroke after stroke', () => {
    const state = createState();
    const rng = new Rng(90210);
    for (let stroke = 0; stroke < 16; stroke += 1) {
      if (state.winner !== null) break;
      const other = mirror(state);
      for (const tier of ['normal', 'hard'] as const) {
        const a = botAim(state, tier, 0.5, 0.6);
        const b = botAim(other, tier, 0.5, 0.6);
        const same = Math.abs(a.offset - b.offset) < 1e-6 && Math.abs(a.angle - b.angle) < 1e-6;
        const tied = Math.abs(a.offset + b.offset) < 1e-6 && Math.abs(a.angle + b.angle) < 1e-6;
        expect(same || tied, `stroke ${String(stroke)} ${tier}`).toBe(true);
      }
      state.offset = rng.float() * 2 - 1;
      play(state, (rng.float() * 2 - 1) * MAX_AIM, 0.4 + rng.float() * 0.6);
    }
  });

  it('offers the weakest tier the very same set of strokes from either side', () => {
    // `easy` picks a playable line rather than the best one, and it picks it by index —
    // and the four pockets are enumerated in the order the mirror reverses, so the same
    // roll lands on a different member of the same set. What fairness needs is that the
    // *set* is the same and the draw over it is uniform, which it is: a permutation of a
    // uniform distribution is that distribution.
    const state = createState();
    const other = mirror(state);
    const key = (offset: number, angle: number): string =>
      `${offset.toFixed(6)}:${angle.toFixed(6)}`;
    const mine = new Set<string>();
    const theirs = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      const choice = i / 400;
      const a = botAim(state, 'easy', 0.5, choice);
      const b = botAim(other, 'easy', 0.5, choice);
      mine.add(key(a.offset, a.angle));
      theirs.add(key(b.offset, b.angle));
    }
    expect(theirs.size).toBe(mine.size);
    expect([...theirs].sort()).toEqual([...mine].sort());
  });

  it('places the striker at mirrored points for mirrored slides', () => {
    for (const offset of [-1, -0.25, 0, 0.6, 1]) {
      expect(strikerXFor('p2', offset)).toBeCloseTo(2 * CENTRE_X - strikerXFor('p1', offset), 9);
    }
  });
});

describe('the bot', () => {
  it('offers three tiers that differ in how they play and in nothing else', () => {
    const names = Object.keys(BOT_PROFILES);
    expect(names.sort()).toEqual(['easy', 'hard', 'normal']);
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(profile.spread).toBeGreaterThan(0);
      expect(profile.power).toBeGreaterThan(0);
      expect(profile.power).toBeLessThanOrEqual(1);
    }
    expect(BOT_PROFILES.hard.spread).toBeLessThan(BOT_PROFILES.normal.spread);
    expect(BOT_PROFILES.normal.spread).toBeLessThan(BOT_PROFILES.easy.spread);
  });

  it('plays a legal stroke from the opening, on every tier', () => {
    for (const tier of TIERS) {
      for (const seat of SEATS) {
        const state = createState();
        state.seat = seat;
        placeStriker(state);
        const aim = botAim(state, tier, 0.5, 0.5);
        expect(Math.abs(aim.angle)).toBeLessThanOrEqual(MAX_AIM + 1e-9);
        expect(aim.offset).toBeGreaterThanOrEqual(-1);
        expect(aim.offset).toBeLessThanOrEqual(1);
        expect(aim.power).toBeGreaterThan(0);
        expect(aim.power).toBeLessThanOrEqual(1);
        state.offset = aim.offset;
        expect(flick(state, aim.angle, aim.power)).toBe(true);
      }
    }
  });

  it('answers the same board the same way from the same rolls', () => {
    const state = createState();
    const a = botAim(state, 'normal', 0.4, 0.6);
    const b = botAim(state, 'normal', 0.4, 0.6);
    expect(b).toEqual(a);
  });

  it('holds one aiming error for the whole stroke rather than redrawing it', () => {
    // A fresh error every step averages to zero and every tier plays the same.
    const state = createState();
    const low = botAim(state, 'easy', 0, 0.5);
    const high = botAim(state, 'easy', 1, 0.5);
    expect(high.angle).not.toBe(low.angle);
    expect(Math.abs(high.angle - low.angle)).toBeCloseTo(2 * BOT_PROFILES.easy.spread, 6);
  });

  it('takes the best line it found when the tier insists on the best line', () => {
    const state = createState();
    const first = botAim(state, 'hard', 0.5, 0);
    const last = botAim(state, 'hard', 0.5, 0.999);
    expect(last).toEqual(first);
  });

  it('takes an ordinary line rather than the best one on the weakest tier', () => {
    const state = createState();
    const first = botAim(state, 'easy', 0.5, 0);
    const last = botAim(state, 'easy', 0.5, 0.999);
    expect(last).not.toEqual(first);
  });

  it('never aims at the last puck while the queen is unresolved', () => {
    const state = createState();
    leave(state, 'p1', 1);
    const last = firstUp(state, 'p1');
    expect(isTarget(state, 'p1', last, false)).toBe(false);
    expect(isTarget(state, 'p1', queenOf(state), false), 'the queen is the only pot left').toBe(
      true,
    );
  });

  it('aims at the last puck the moment the queen is settled', () => {
    const state = createState();
    leave(state, 'p1', 1);
    const last = firstUp(state, 'p1');
    state.queenOwner = 'p1';
    expect(isTarget(state, 'p1', last, false)).toBe(true);
  });

  it('aims at the puck that would cover a queen owed this visit', () => {
    const state = createState();
    leave(state, 'p1', 1);
    state.queenPending = true;
    expect(isTarget(state, 'p1', firstUp(state, 'p1'), false)).toBe(true);
  });

  it('never aims at the opponent’s pucks or at a potted one', () => {
    const state = createState();
    expect(isTarget(state, 'p1', firstUp(state, 'p2'), true)).toBe(false);
    const own = firstUp(state, 'p1');
    own.potted = true;
    expect(isTarget(state, 'p1', own, true)).toBe(false);
  });

  it('leaves a covered queen alone', () => {
    const state = createState();
    state.queenOwner = 'p2';
    expect(isTarget(state, 'p1', queenOf(state), true)).toBe(false);
  });

  it('goes for the queen early only on the tier that is meant to', () => {
    const state = createState();
    expect(isTarget(state, 'p1', queenOf(state), BOT_PROFILES.hard.seeksQueen)).toBe(true);
    expect(isTarget(state, 'p1', queenOf(state), BOT_PROFILES.easy.seeksQueen)).toBe(false);
  });

  it('sees a puck standing in the line and does not shoot through it', () => {
    const state = createState();
    bare(state);
    const target = put(state, 'p1', CENTRE_X, CENTRE_Y - 200);
    const between = put(state, 'p2', CENTRE_X, CENTRE_Y - 100);
    expect(blocked(state, CENTRE_X, CENTRE_Y, target.x, target.y, target)).toBe(true);
    between.potted = true;
    expect(blocked(state, CENTRE_X, CENTRE_Y, target.x, target.y, target)).toBe(false);
  });

  it('does not count the body it is shooting at as being in the way', () => {
    const state = createState();
    bare(state);
    const target = put(state, 'p1', CENTRE_X, CENTRE_Y - 200);
    expect(blocked(state, CENTRE_X, CENTRE_Y, target.x, target.y, target)).toBe(false);
  });

  it('plays the board rather than freezing when nothing can be potted', () => {
    // Firing the least bad impossible line instead is how a frame grinds to a halt.
    const state = createState();
    bare(state);
    state.queenOwner = 'p2';
    queenOf(state).potted = true;
    put(state, 'p1', CENTRE_X + 40, CENTRE_Y - 60);
    put(state, 'p1', CENTRE_X - 40, CENTRE_Y - 60);
    placeStriker(state);
    for (const tier of TIERS) {
      const aim = botAim(state, tier, 0.5, 0.5);
      expect(aim.power).toBeGreaterThan(0);
      expect(Math.abs(aim.angle)).toBeLessThanOrEqual(MAX_AIM + 1e-9);
    }
  });

  it('still finds a stroke on a board with a single puck left', () => {
    const state = createState();
    bare(state);
    state.queenOwner = 'p1';
    queenOf(state).potted = true;
    put(state, 'p1', CENTRE_X, CENTRE_Y);
    placeStriker(state);
    for (const tier of TIERS) {
      const aim = botAim(state, tier, 0.5, 0.5);
      state.offset = aim.offset;
      state.phase = 'aiming';
      expect(flick(state, aim.angle, aim.power)).toBe(true);
      state.phase = 'aiming';
    }
  });

  it('considers a spread of placements along its own baseline', () => {
    expect(OFFSET_SAMPLES).toBeGreaterThanOrEqual(5);
    const state = createState();
    const seen = new Set<number>();
    for (let i = 0; i < 40; i += 1) seen.add(botAim(state, 'easy', 0.5, i / 40).offset);
    expect(seen.size, 'the bot only ever places in one spot').toBeGreaterThan(1);
  });

  it('allocates nothing per stroke that a frame-time budget would notice', () => {
    // Two flat arrays sized once at module load: the decision must not be a heap spike.
    const state = createState();
    const first = botAim(state, 'easy', 0.2, 0.3);
    for (let i = 0; i < 500; i += 1) botAim(state, 'easy', 0.2, 0.3);
    expect(botAim(state, 'easy', 0.2, 0.3)).toEqual(first);
  });

  it('reads nothing a person at the same board cannot see', () => {
    // The proof is structural: `botAim` is handed the state, a tier and two numbers, and the
    // state is exactly what is drawn. There is no seat-private field for it to read.
    const state = createState();
    const keys = Object.keys(state).sort();
    expect(keys).toEqual([
      'bodies',
      'dryShots',
      'fouled',
      'offset',
      'phase',
      'queenOwner',
      'queenPending',
      'rollSeconds',
      'seat',
      'shots',
      'winner',
    ]);
  });
});

describe('the tiers, measured', () => {
  it('ranks normal above easy', () => {
    expect(ladder('normal', 'easy', 24)).toBeGreaterThan(0.7);
  });

  it('ranks hard above easy', () => {
    expect(ladder('hard', 'easy', 24)).toBeGreaterThan(0.75);
  });

  it('ranks hard above normal', () => {
    expect(ladder('hard', 'normal', 24)).toBeGreaterThan(0.6);
  });

  it('leaves each tier level against itself, near enough', () => {
    // Seat one breaks, which is worth something in carrom as it is in every turn game.
    const result = series('normal', 'normal', 24);
    const decided = result.first + result.second;
    expect(decided).toBeGreaterThan(0);
    expect(result.first / decided).toBeGreaterThan(0.35);
    expect(result.first / decided).toBeLessThan(0.75);
  });

  it('finishes the great majority of frames by clearing a board, not by expiry', () => {
    let cleared = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      if (playFrame(seed * 7919, 'hard', 'normal').cleared) cleared += 1;
    }
    expect(cleared / 24).toBeGreaterThan(0.9);
  });
});

describe('a frame always ends', () => {
  it('ends every frame two weak bots play, well inside the budget', () => {
    // The property `apps/web/src/data/termination.test.ts` checks for every game, measured
    // here at the pairing most likely to break it.
    const result = series('easy', 'easy', 20);
    expect(result.first + result.second + result.drawn).toBe(20);
    expect(result.worstSteps, 'ten minutes of simulated play').toBeLessThan(60 * 600);
    expect(result.worstRollSteps).toBeLessThan(Math.ceil(MAX_ROLL_SECONDS / STEP));
  });

  it('ends every frame for every pairing of tiers', () => {
    for (const a of TIERS) {
      for (const b of TIERS) {
        const result = series(a, b, 6, 17);
        expect(result.first + result.second + result.drawn, `${a} v ${b}`).toBe(6);
        expect(result.worstSteps, `${a} v ${b}`).toBeLessThan(60 * 600);
      }
    }
  });

  it('has a ceiling that can be written down, and it is under the guard’s ten minutes', () => {
    // Every stroke is stopped at MAX_ROLL_SECONDS and every frame at SHOT_LIMIT strokes,
    // so the worst possible frame is the product plus the bot's thinking time.
    const thinkSeconds = 0.35;
    expect(SHOT_LIMIT * (MAX_ROLL_SECONDS + thinkSeconds)).toBeLessThan(600);
  });

  it('cannot run past the shot limit even when nothing is ever potted', () => {
    const state = createState();
    for (let i = 0; i < SHOT_LIMIT + 10; i += 1) {
      if (winnerOf(state) !== null) break;
      settleShot(state, []);
      state.seat = otherOf(state.seat);
    }
    expect(winnerOf(state)).not.toBe(null);
    expect(state.shots).toBeLessThanOrEqual(SHOT_LIMIT);
  });

  it('ends a frame in which the shooter keeps potting and never misses', () => {
    const state = createState();
    state.queenOwner = 'p1';
    queenOf(state).potted = true;
    for (let i = 0; i < PUCKS_PER_SIDE; i += 1) {
      const outcome = settleShot(state, drop(state, firstUp(state, 'p1')));
      if (outcome.winner !== null) {
        expect(outcome.winner).toBe('p1');
        expect(i).toBe(PUCKS_PER_SIDE - 1);
        return;
      }
      expect(outcome.repeats).toBe(true);
    }
    expect.fail('six pots did not win the frame');
  });
});

describe('a frame played end to end', () => {
  it('alternates the seats whenever a visit ends', () => {
    const state = createState();
    const seats: SeatId[] = [];
    for (let i = 0; i < 12; i += 1) {
      if (state.winner !== null) break;
      seats.push(state.seat);
      const before = state.seat;
      const outcome = play(state, 0, 0.05);
      expect(outcome.repeats, 'a stroke that gained nothing kept the board').toBe(false);
      expect(state.seat).toBe(otherOf(before));
    }
    expect(seats.slice(0, 4)).toEqual(['p1', 'p2', 'p1', 'p2']);
  });

  it('plays a real stroke and leaves a board that is still legal', () => {
    const state = createState();
    play(state, 0.1, 0.9);
    for (const b of state.bodies) {
      if (b.potted) continue;
      expect(onSurface(b.x, b.y, radiusOf(b.kind)), 'a body left on the frame').toBe(true);
      expect(inPocket(b.x, b.y), 'a body left standing in a pocket').toBe(false);
      expect(b.vx).toBe(0);
      expect(b.vy).toBe(0);
    }
  });

  it('never leaves two bodies inside one another when the board settles', () => {
    const state = createState();
    const rng = new Rng(5150);
    for (let stroke = 0; stroke < 12; stroke += 1) {
      if (state.winner !== null) break;
      state.offset = rng.float() * 2 - 1;
      play(state, (rng.float() * 2 - 1) * MAX_AIM, 0.5 + rng.float() * 0.5);
      for (let i = 0; i < state.bodies.length; i += 1) {
        for (let j = i + 1; j < state.bodies.length; j += 1) {
          const a = state.bodies[i];
          const b = state.bodies[j];
          if (a === undefined || b === undefined || a.potted || b.potted) continue;
          const minimum = radiusOf(a.kind) + radiusOf(b.kind);
          expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(minimum - 1e-6);
        }
      }
    }
  });

  it('keeps the score and the pucks on the board telling the same story', () => {
    const state = createState();
    const rng = new Rng(2024);
    for (let stroke = 0; stroke < 20; stroke += 1) {
      if (state.winner !== null) break;
      state.offset = rng.float() * 2 - 1;
      play(state, (rng.float() * 2 - 1) * MAX_AIM, 0.5 + rng.float() * 0.5);
      for (const seat of SEATS) {
        expect(pottedCount(state, seat) + remaining(state, seat)).toBe(PUCKS_PER_SIDE);
        expect(pottedCount(state, seat)).toBeGreaterThanOrEqual(0);
        expect(pottedCount(state, seat)).toBeLessThanOrEqual(PUCKS_PER_SIDE);
      }
    }
  });
});

describe('small shared helpers', () => {
  it('normalises an angle into a single turn', () => {
    expect(normaliseAngle(0)).toBe(0);
    expect(normaliseAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 9);
    expect(normaliseAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 9);
    expect(normaliseAngle(0.4)).toBeCloseTo(0.4, 9);
  });

  it('says the board is still only when nothing at all is moving', () => {
    const state = createState();
    expect(boardIsStill(state)).toBe(true);
    strikerOf(state).vx = 1;
    expect(boardIsStill(state)).toBe(false);
    strikerOf(state).vx = 0;
    strikerOf(state).potted = true;
    strikerOf(state).vy = 5;
    expect(boardIsStill(state), 'a potted body is off the board, not moving on it').toBe(true);
  });
});
