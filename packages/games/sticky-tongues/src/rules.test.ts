import { describe, expect, it } from 'vitest';
import { Rng, SEATS, otherSeat } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { resolveSimultaneous } from '@duelbox/game-sdk';
import type { Outcome } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  AGGRESSION,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_PROFILES,
  CATCH_RADIUS,
  FLY_COUNT,
  FLY_MAX_X,
  FLY_MAX_Y,
  FLY_MIN_X,
  FLY_MIN_Y,
  FLY_RETURN_SECONDS,
  FLY_SPEED_MAX,
  FLY_SPEED_MIN,
  FROG_MAX_X,
  FROG_MIN_X,
  FROG_SPEED,
  MATCH_SECONDS,
  SHOT_BACK_SECONDS,
  SHOT_CYCLE_SECONDS,
  SHOT_HOLD_SECONDS,
  SHOT_OUT_SECONDS,
  SHOT_THRESHOLD,
  SLAP_RADIUS,
  STEER_DEADZONE,
  STUN_SECONDS,
  TARGET_CATCHES,
  TONGUE_OUT_SECONDS,
  TONGUE_REACH,
  WASTE_LIMIT,
  bankMaxYOf,
  bankMinYOf,
  botDecide,
  botLook,
  createBotState,
  createState,
  depthAt,
  driveFrog,
  frogOf,
  frontYOf,
  headingSign,
  homeYOf,
  reachSignOf,
  reaches,
  resetBotState,
  resetState,
  resting,
  secondsLeft,
  shoot,
  shotValue,
  shotsLeft,
  step,
  threatLineOf,
  tipYOf,
  tongueOut,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Fly, Frog, State } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

/* ------------------------------------------------------------------------------------ */
/* Fixtures                                                                              */
/* ------------------------------------------------------------------------------------ */

function fresh(seed: number): State {
  const state = createState();
  resetState(state, new Rng(seed));
  return state;
}

/** An empty sky: every dragonfly parked out of play, so a test can place its own. */
function clearSky(state: State): void {
  for (const fly of state.flies) {
    fly.live = false;
    fly.returnSeconds = 999;
    fly.vx = 0;
    fly.vy = 0;
    fly.x = FLY_MIN_X;
    fly.y = FLY_MIN_Y;
  }
}

function placeFly(state: State, slot: number, x: number, y: number): Fly {
  const fly = state.flies[slot] as Fly;
  fly.x = x;
  fly.y = y;
  fly.vx = 0;
  fly.vy = 0;
  fly.live = true;
  fly.returnSeconds = 0;
  return fly;
}

function placeFrog(state: State, seat: SeatId, x: number, y: number): Frog {
  const frog = frogOf(state, seat);
  frog.x = x;
  frog.y = y;
  return frog;
}

/** Step until the frog resting again, or the cap, whichever comes first. */
function stepUntilRested(state: State, seat: SeatId, cap = 200): number {
  let n = 0;
  while (n < cap && !resting(frogOf(state, seat)) && state.winner === null) {
    step(state, STEP);
    n += 1;
  }
  return n;
}

interface Seats {
  readonly p1: BotDifficulty;
  readonly p2: BotDifficulty;
}

interface MatchResult {
  winner: Outcome;
  seconds: number;
  p1: number;
  p2: number;
  wasted1: number;
  wasted2: number;
  shots1: number;
  shots2: number;
  blows1: number;
  blows2: number;
  steps: number;
}

interface PlayOptions {
  /** Read seat two before seat one, to prove the order is not observable. */
  readonly reversed?: boolean;
  /** Mirror the opening board and swap the two seats' streams and tiers. */
  readonly mirrored?: boolean;
  /** No cap at all: a match that cannot finish hangs the suite rather than passing quietly. */
  readonly cap?: number;
}

/** Turn one state into its own half-turn image, seats included. */
function mirrorSelf(state: State): void {
  for (const fly of state.flies) {
    fly.x = BOARD_WIDTH - fly.x;
    fly.y = BOARD_HEIGHT - fly.y;
    fly.vx = -fly.vx;
    fly.vy = -fly.vy;
  }
  const p1 = { ...state.p1Frog };
  const p2 = { ...state.p2Frog };
  copyMirrored(state.p1Frog, p2);
  copyMirrored(state.p2Frog, p1);
  const caught = state.p1;
  state.p1 = state.p2;
  state.p2 = caught;
}

function copyMirrored(into: Frog, from: Readonly<Frog>): void {
  into.x = BOARD_WIDTH - from.x;
  into.y = BOARD_HEIGHT - from.y;
  into.shooting = from.shooting;
  into.shotSeconds = from.shotSeconds;
  into.shotAt = from.shotAt;
  into.shotCaught = from.shotCaught;
  into.shotClashed = from.shotClashed;
  into.shotSlapped = from.shotSlapped;
  into.stunSeconds = from.stunSeconds;
  into.wasted = from.wasted;
}

function mirrorOutcome(outcome: Outcome): Outcome {
  if (outcome === 'p1') return 'p2';
  if (outcome === 'p2') return 'p1';
  return outcome;
}

/**
 * One bot-against-bot match, driven exactly the way `game.ts` drives one: both seats decide,
 * then both move, then both shoot.
 */
function playBots(seed: number, tiers: Seats, options: PlayOptions = {}): MatchResult {
  const state = createState();
  const seeds = new Rng(seed | 0);
  resetState(state, new Rng(seeds.next() | 0));
  const first = seeds.next() | 0;
  const second = seeds.next() | 0;
  const mirrored = options.mirrored === true;
  if (mirrored) mirrorSelf(state);

  const tier1 = mirrored ? tiers.p2 : tiers.p1;
  const tier2 = mirrored ? tiers.p1 : tiers.p2;
  const rng1 = new Rng(mirrored ? second : first);
  const rng2 = new Rng(mirrored ? first : second);
  const bot1 = createBotState();
  const bot2 = createBotState();
  resetBotState(bot1, 'p1');
  resetBotState(bot2, 'p2');

  const cap = options.cap ?? Number.POSITIVE_INFINITY;
  const order: readonly SeatId[] = options.reversed === true ? ['p2', 'p1'] : ['p1', 'p2'];
  const wants = { p1: false, p2: false };
  const shots = { p1: 0, p2: 0 };
  const blows = { p1: 0, p2: 0 };
  const stunned = { p1: false, p2: false };
  let steps = 0;

  while (state.winner === null && steps < cap) {
    for (const seat of order) {
      const bot = seat === 'p1' ? bot1 : bot2;
      const rng = seat === 'p1' ? rng1 : rng2;
      const tier = seat === 'p1' ? tier1 : tier2;
      wants[seat] = botDecide(state, seat, tier, bot, rng, STEP);
    }
    for (const seat of order) {
      const bot = seat === 'p1' ? bot1 : bot2;
      driveFrog(state, seat, bot.dirX, bot.dirY, STEP);
    }
    for (const seat of order) {
      if (wants[seat] && shoot(state, seat)) shots[seat] += 1;
    }
    step(state, STEP);
    for (const seat of SEATS) {
      const now = frogOf(state, seat).stunSeconds > 0;
      if (now && !stunned[seat]) blows[otherSeat(seat)] += 1;
      stunned[seat] = now;
    }
    steps += 1;
  }

  return {
    winner: state.winner,
    seconds: state.clock,
    p1: state.p1,
    p2: state.p2,
    wasted1: state.p1Frog.wasted,
    wasted2: state.p2Frog.wasted,
    shots1: shots.p1,
    shots2: shots.p2,
    blows1: blows.p1,
    blows2: blows.p2,
    steps,
  };
}

interface Tally {
  wins: number;
  decided: number;
  seconds: number;
  unfinished: number;
}

/** Win rate of `a` against `b`, played from both seat orders. */
function duel(a: BotDifficulty, b: BotDifficulty, seeds: number): Tally {
  const tally: Tally = { wins: 0, decided: 0, seconds: 0, unfinished: 0 };
  for (let i = 0; i < seeds; i += 1) {
    for (const swap of [false, true]) {
      const result = playBots(i * 7919 + 13, swap ? { p1: b, p2: a } : { p1: a, p2: b });
      const seat: SeatId = swap ? 'p2' : 'p1';
      tally.seconds += result.seconds;
      if (result.winner === null) tally.unfinished += 1;
      if (result.winner !== 'p1' && result.winner !== 'p2') continue;
      tally.decided += 1;
      if (result.winner === seat) tally.wins += 1;
    }
  }
  return tally;
}

/* ------------------------------------------------------------------------------------ */
/* The half-turn — written first, because it is the test that finds what nothing else can */
/* ------------------------------------------------------------------------------------ */

/**
 * Every quantity the simulation holds, as one string.
 *
 * Continuous values are rounded to six decimals. That is deliberate and it is the whole
 * design of this test: the two seats accumulate their positions from **opposite ends of the
 * board**, so a mirror image can differ in the last bits for ever without anything being
 * wrong. What may never differ is a *decision* — who caught what, who was hit, how many shots
 * are gone, who won. Those are all integers and booleans here, and they are compared exactly.
 */
function describeState(state: Readonly<State>): string {
  const parts: string[] = [`${String(state.p1)}/${String(state.p2)}`, String(state.winner)];
  parts.push(state.clock.toFixed(6));
  for (const seat of SEATS) {
    const frog = frogOf(state, seat);
    parts.push(
      [
        frog.x.toFixed(6),
        frog.y.toFixed(6),
        String(frog.shooting),
        frog.shotSeconds.toFixed(6),
        frog.shotAt.toFixed(6),
        String(frog.shotCaught),
        String(frog.shotClashed),
        String(frog.shotSlapped),
        frog.stunSeconds.toFixed(6),
        String(frog.wasted),
      ].join(','),
    );
  }
  for (const fly of state.flies) {
    parts.push(
      [
        fly.x.toFixed(6),
        fly.y.toFixed(6),
        fly.vx.toFixed(6),
        fly.vy.toFixed(6),
        String(fly.live),
        fly.returnSeconds.toFixed(6),
      ].join(','),
    );
  }
  return parts.join('|');
}

/** A legal but arbitrary board: any position the game could ever hold. */
function scramble(state: State, rng: Rng): void {
  state.clock = 1 + rng.float() * (MATCH_SECONDS - 2);
  state.p1 = rng.int(0, TARGET_CATCHES - 1);
  state.p2 = rng.int(0, TARGET_CATCHES - 1);
  for (const seat of SEATS) {
    const frog = frogOf(state, seat);
    // On the five-unit lattice `InputManager` quantises a pointer onto, so that the exact
    // ties this test exists to catch are everyday events rather than measure-zero ones.
    frog.x = FROG_MIN_X + rng.int(0, 97) * 5;
    const low = bankMinYOf(seat);
    frog.y = low + rng.int(0, 79) * 5;
    frog.wasted = rng.int(0, WASTE_LIMIT - 1);
    frog.stunSeconds = rng.bool(0.15) ? rng.int(1, 41) * 0.05 : 0;
    if (rng.bool(0.45)) {
      frog.shooting = true;
      // Whole steps, because a shot clock only ever holds a whole number of them — which is
      // exactly the knife edge Snowball Throw's ball age fell off.
      frog.shotSeconds = rng.int(0, Math.round(SHOT_CYCLE_SECONDS * 60)) * STEP;
      frog.shotAt = state.clock - frog.shotSeconds;
      frog.shotCaught = rng.int(0, 3);
      frog.shotClashed = rng.bool(0.2);
      frog.shotSlapped = rng.bool(0.2);
    } else {
      frog.shooting = false;
      frog.shotSeconds = 0;
      frog.shotAt = -1;
      frog.shotCaught = 0;
      frog.shotClashed = false;
      frog.shotSlapped = false;
    }
  }
  for (const fly of state.flies) {
    fly.live = rng.bool(0.82);
    fly.returnSeconds = fly.live ? 0 : rng.int(0, 17) * 0.05;
    fly.x = FLY_MIN_X + rng.int(0, 97) * 5;
    fly.y = FLY_MIN_Y + rng.int(0, 81) * 5;
    const heading = rng.float() * Math.PI * 2;
    const speed = FLY_SPEED_MIN + rng.float() * (FLY_SPEED_MAX - FLY_SPEED_MIN);
    fly.vx = Math.cos(heading) * speed;
    fly.vy = Math.sin(heading) * speed;
  }
}

const HEADINGS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function randomHeading(rng: Rng): readonly [number, number] {
  return HEADINGS[rng.int(0, HEADINGS.length)] as readonly [number, number];
}

describe('the half-turn', () => {
  it('places the two banks, the air and the frogs as exact half-turn images', () => {
    expect(bankMinYOf('p1')).toBe(BOARD_HEIGHT - bankMaxYOf('p2'));
    expect(bankMaxYOf('p1')).toBe(BOARD_HEIGHT - bankMinYOf('p2'));
    expect(homeYOf('p1')).toBe(BOARD_HEIGHT - homeYOf('p2'));
    expect(frontYOf('p1')).toBe(BOARD_HEIGHT - frontYOf('p2'));
    expect(FROG_MIN_X).toBe(BOARD_WIDTH - FROG_MAX_X);
    expect(FLY_MIN_X).toBe(BOARD_WIDTH - FLY_MAX_X);
    expect(FLY_MIN_Y).toBe(BOARD_HEIGHT - FLY_MAX_Y);
    expect(threatLineOf('p1')).toBe(BOARD_HEIGHT - threatLineOf('p2'));
  });

  it('deals an opening that is exactly symmetric under the half-turn, for every seed', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const state = fresh(seed * 733 + 5);
      for (let pair = 0; pair * 2 < FLY_COUNT; pair += 1) {
        const near = state.flies[pair * 2] as Fly;
        const far = state.flies[pair * 2 + 1] as Fly;
        expect(far.x).toBeCloseTo(BOARD_WIDTH - near.x, 10);
        expect(far.y).toBeCloseTo(BOARD_HEIGHT - near.y, 10);
        expect(far.vx).toBeCloseTo(-near.vx, 10);
        expect(far.vy).toBeCloseTo(-near.vy, 10);
        expect(far.live).toBe(near.live);
      }
      expect(state.p1Frog.x).toBe(BOARD_WIDTH - state.p2Frog.x);
      expect(state.p1Frog.y).toBe(BOARD_HEIGHT - state.p2Frog.y);
    }
  });

  it('steps a mirrored board to the mirror of the stepped board', () => {
    // Five hundred arbitrary boards. This is the test that found seat bias in four other
    // games this session, and the family it looks for is a threshold a state variable lands
    // on **exactly by construction** — a shot clock on a whole frame, a frog pinned against
    // its own bank edge, two shots committed on one step. `scramble` puts all three on the
    // board on purpose.
    const rng = new Rng(20260829);
    for (let trial = 0; trial < 500; trial += 1) {
      const here = fresh(trial * 131 + 7);
      scramble(here, rng);
      const there = createState();
      copyState(here, there);
      mirrorSelf(there);

      const a = randomHeading(rng);
      const b = randomHeading(rng);
      driveFrog(here, 'p1', a[0], a[1], STEP);
      driveFrog(here, 'p2', b[0], b[1], STEP);
      driveFrog(there, 'p1', -b[0], -b[1], STEP);
      driveFrog(there, 'p2', -a[0], -a[1], STEP);
      step(here, STEP);
      step(there, STEP);

      const expected = createState();
      copyState(here, expected);
      mirrorSelf(expected);
      expect(describeState(there), `trial ${String(trial)}`).toBe(describeState(expected));
    }
  });

  it('makes a bot want the mirrored thing on a mirrored board', () => {
    const rng = new Rng(31337);
    for (const tier of TIERS) {
      for (let trial = 0; trial < 300; trial += 1) {
        const here = fresh(trial * 197 + 3);
        scramble(here, rng);
        const there = createState();
        copyState(here, there);
        mirrorSelf(there);

        const one = createBotState();
        const two = createBotState();
        resetBotState(one, 'p1');
        resetBotState(two, 'p2');
        // The same stream, because a mirrored bot must roll the same blindness per slot.
        botLook(here, 'p1', tier, one, new Rng(trial + 11));
        botLook(there, 'p2', tier, two, new Rng(trial + 11));

        expect(two.targetX, `${tier} ${String(trial)} x`).toBeCloseTo(BOARD_WIDTH - one.targetX, 9);
        expect(two.targetY, `${tier} ${String(trial)} y`).toBeCloseTo(
          BOARD_HEIGHT - one.targetY,
          9,
        );
        expect(two.nowValue, `${tier} ${String(trial)} value`).toBe(one.nowValue);
      }
    }
  });

  it('plays a whole mirrored match to the mirrored result', () => {
    // End to end rather than argued, which is what finally separated "the game is
    // asymmetric" from "the sample is small" in Snowball Throw. Every match is played
    // against its own mirror, at every tier, and the two results compared.
    let flipped = 0;
    let mismatched = 0;
    for (const tier of TIERS) {
      for (let seed = 0; seed < 60; seed += 1) {
        const tiers: Seats = { p1: tier, p2: tier };
        const forward = playBots(seed * 3571 + 1, tiers);
        const backward = playBots(seed * 3571 + 1, tiers, { mirrored: true });
        if (backward.winner !== mirrorOutcome(forward.winner)) flipped += 1;
        if (backward.p1 !== forward.p2 || backward.p2 !== forward.p1) mismatched += 1;
      }
    }
    // A frog's position still accumulates from opposite ends of the board and always will,
    // so a match can in principle part company on the last bits of some comparison. Measured
    // over these 180 mirrored matches: no winner flipped and no scoreline differed.
    expect(flipped).toBe(0);
    expect(mismatched).toBe(0);
  });
});

function copyState(from: Readonly<State>, into: State): void {
  into.p1 = from.p1;
  into.p2 = from.p2;
  into.clock = from.clock;
  into.winner = from.winner;
  for (const seat of SEATS) {
    const source = frogOf(from, seat);
    const target = frogOf(into, seat);
    target.x = source.x;
    target.y = source.y;
    target.shooting = source.shooting;
    target.shotSeconds = source.shotSeconds;
    target.shotAt = source.shotAt;
    target.shotCaught = source.shotCaught;
    target.shotClashed = source.shotClashed;
    target.shotSlapped = source.shotSlapped;
    target.stunSeconds = source.stunSeconds;
    target.wasted = source.wasted;
  }
  for (let i = 0; i < from.flies.length; i += 1) {
    const source = from.flies[i] as Fly;
    const target = into.flies[i] as Fly;
    target.x = source.x;
    target.y = source.y;
    target.vx = source.vx;
    target.vy = source.vy;
    target.live = source.live;
    target.returnSeconds = source.returnSeconds;
  }
}

/* ------------------------------------------------------------------------------------ */
/* The marsh                                                                             */
/* ------------------------------------------------------------------------------------ */

describe('the marsh', () => {
  it('opens with a full sky, every dragonfly in play', () => {
    const state = fresh(11);
    expect(state.flies).toHaveLength(FLY_COUNT);
    expect(state.flies.every((fly) => fly.live)).toBe(true);
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect(shotsLeft(state, 'p1')).toBe(WASTE_LIMIT);
    expect(shotsLeft(state, 'p2')).toBe(WASTE_LIMIT);
  });

  it('keeps every dragonfly inside its own band, at a constant speed', () => {
    const state = fresh(12);
    const speeds = state.flies.map((fly) => Math.hypot(fly.vx, fly.vy));
    for (let i = 0; i < 2000; i += 1) {
      step(state, STEP);
      for (let slot = 0; slot < state.flies.length; slot += 1) {
        const fly = state.flies[slot] as Fly;
        expect(fly.x).toBeGreaterThanOrEqual(FLY_MIN_X - 1e-9);
        expect(fly.x).toBeLessThanOrEqual(FLY_MAX_X + 1e-9);
        expect(fly.y).toBeGreaterThanOrEqual(FLY_MIN_Y - 1e-9);
        expect(fly.y).toBeLessThanOrEqual(FLY_MAX_Y + 1e-9);
        expect(Math.hypot(fly.vx, fly.vy)).toBeCloseTo(speeds[slot] as number, 9);
      }
    }
  });

  it('replaces a caught dragonfly at the half-turn image of where it was taken', () => {
    const state = fresh(13);
    clearSky(state);
    const fly = placeFly(state, 0, 200, 500);
    placeFrog(state, 'p1', 200, 700);
    shoot(state, 'p1');
    stepUntilRested(state, 'p1');
    expect(state.p1).toBe(1);
    expect(fly.live).toBe(false);
    expect(fly.x).toBe(BOARD_WIDTH - 200);
    expect(fly.y).toBe(BOARD_HEIGHT - 500);
    expect(fly.returnSeconds).toBeGreaterThan(0);
    expect(fly.returnSeconds).toBeLessThanOrEqual(FLY_RETURN_SECONDS);
  });

  it('cannot be caught again until its replacement has settled', () => {
    const state = fresh(14);
    clearSky(state);
    const fly = placeFly(state, 0, 200, 450);
    placeFrog(state, 'p1', 200, 620);
    shoot(state, 'p1');
    for (let i = 0; i < 12; i += 1) step(state, STEP);
    expect(state.p1).toBe(1);
    expect(fly.live).toBe(false);
    expect(fly.x).toBe(BOARD_WIDTH - 200);
    expect(fly.y).toBe(BOARD_HEIGHT - 450);
    // Stand the far frog on the replacement and flick at it: nothing there to take yet.
    placeFrog(state, 'p2', 400, 400);
    shoot(state, 'p2');
    for (let i = 0; i < 14; i += 1) step(state, STEP);
    expect(state.p2).toBe(0);
    // Wait for it to settle, then it is fair game again.
    for (let i = 0; i < Math.ceil(FLY_RETURN_SECONDS * 60) + 2; i += 1) step(state, STEP);
    expect(fly.live).toBe(true);
  });

  it('advertises the same round length its own clock uses', () => {
    expect(manifest.roundSeconds).toBe(MATCH_SECONDS);
  });

  it('makes the back line safe and the front line exposed, which is the whole decision', () => {
    // From its own back line a tongue cannot touch the far frog wherever it stands.
    const back = homeYOf('p1');
    const tip = back + reachSignOf('p1') * TONGUE_REACH;
    for (let y = bankMinYOf('p2'); y <= bankMaxYOf('p2'); y += 5) {
      expect(reaches(300, back, tip, 300, y, SLAP_RADIUS)).toBe(false);
    }
    // From the front of its own bank it reaches the far frog's own forward strip.
    const front = frontYOf('p1');
    const frontTip = front + reachSignOf('p1') * TONGUE_REACH;
    expect(reaches(300, front, frontTip, 300, frontYOf('p2'), SLAP_RADIUS)).toBe(true);
    expect(reaches(300, front, frontTip, 300, homeYOf('p2'), SLAP_RADIUS)).toBe(false);
    // And the threat line is where the two answers change over.
    const line = threatLineOf('p1');
    expect(
      reaches(
        300,
        frontYOf('p2'),
        frontYOf('p2') + reachSignOf('p2') * TONGUE_REACH,
        300,
        line - 0.001,
        SLAP_RADIUS,
      ),
    ).toBe(true);
    expect(
      reaches(
        300,
        frontYOf('p2'),
        frontYOf('p2') + reachSignOf('p2') * TONGUE_REACH,
        300,
        line + 0.001,
        SLAP_RADIUS,
      ),
    ).toBe(false);
  });

  it('is worth coming forward for: the tongue sweeps far more of the band', () => {
    const covered = (y: number): number => {
      const tip = y + reachSignOf('p1') * TONGUE_REACH;
      const low = Math.max(Math.min(y, tip), FLY_MIN_Y);
      const high = Math.min(Math.max(y, tip), FLY_MAX_Y);
      return Math.max(0, high - low);
    };
    expect(covered(homeYOf('p1'))).toBeCloseTo(90, 6);
    expect(covered(frontYOf('p1'))).toBeCloseTo(260, 6);
    // The peak is inside the strip a far tongue can reach, which is what makes it a decision
    // rather than a free lunch.
    const peak = FLY_MAX_Y;
    expect(covered(peak)).toBeCloseTo(TONGUE_REACH, 6);
    expect(peak).toBeLessThan(threatLineOf('p1'));
  });
});

/* ------------------------------------------------------------------------------------ */
/* A shot                                                                                */
/* ------------------------------------------------------------------------------------ */

describe('a shot', () => {
  it('reaches out, hangs at full stretch, and comes back', () => {
    expect(depthAt(0)).toBe(0);
    expect(depthAt(SHOT_OUT_SECONDS / 2)).toBeCloseTo(TONGUE_REACH / 2, 9);
    expect(depthAt(SHOT_OUT_SECONDS)).toBe(TONGUE_REACH);
    expect(depthAt(SHOT_OUT_SECONDS + SHOT_HOLD_SECONDS / 2)).toBe(TONGUE_REACH);
    expect(depthAt(SHOT_OUT_SECONDS + SHOT_HOLD_SECONDS + SHOT_BACK_SECONDS / 2)).toBeCloseTo(
      TONGUE_REACH / 2,
      9,
    );
    expect(depthAt(TONGUE_OUT_SECONDS)).toBe(0);
    expect(depthAt(SHOT_CYCLE_SECONDS)).toBe(0);
  });

  it('cannot be fired again until the whole cycle is over', () => {
    const state = fresh(21);
    expect(shoot(state, 'p1')).toBe(true);
    for (let i = 0; i < Math.round(SHOT_CYCLE_SECONDS * 60) - 1; i += 1) {
      expect(shoot(state, 'p1')).toBe(false);
      step(state, STEP);
    }
    step(state, STEP);
    expect(resting(state.p1Frog)).toBe(true);
    expect(shoot(state, 'p1')).toBe(true);
  });

  it('cannot be fired while the frog is still seeing stars', () => {
    const state = fresh(22);
    state.p1Frog.stunSeconds = STUN_SECONDS;
    expect(shoot(state, 'p1')).toBe(false);
    for (let i = 0; i < Math.ceil(STUN_SECONDS * 60) + 1; i += 1) step(state, STEP);
    expect(shoot(state, 'p1')).toBe(true);
  });

  it('will not let a frog move while its tongue is out', () => {
    const state = fresh(23);
    const frog = placeFrog(state, 'p1', 300, 800);
    shoot(state, 'p1');
    for (let i = 0; i < Math.round(SHOT_CYCLE_SECONDS * 60); i += 1) {
      driveFrog(state, 'p1', 1, -1, STEP);
      step(state, STEP);
      expect(frog.x).toBe(300);
      expect(frog.y).toBe(800);
    }
    driveFrog(state, 'p1', 1, -1, STEP);
    expect(frog.x).toBeGreaterThan(300);
  });

  it('catches exactly what the bot predicted it would, on a sky that is holding still', () => {
    // Issue #2465, designed out rather than patched. Because a frog may not move while its
    // tongue is out, the whole-shot segment the bot tests is the exact union of the per-step
    // segments the simulation applies — so for a still sky these two numbers are equal, not
    // nearly equal.
    const rng = new Rng(4242);
    const blind = new Array<boolean>(FLY_COUNT).fill(false);
    for (let trial = 0; trial < 60; trial += 1) {
      for (const seat of SEATS) {
        const state = fresh(trial * 31 + 1);
        clearSky(state);
        for (let slot = 0; slot < FLY_COUNT; slot += 1) {
          if (rng.bool(0.75)) {
            placeFly(
              state,
              slot,
              FLY_MIN_X + rng.float() * (FLY_MAX_X - FLY_MIN_X),
              FLY_MIN_Y + rng.float() * (FLY_MAX_Y - FLY_MIN_Y),
            );
          }
        }
        const x = FROG_MIN_X + rng.float() * (FROG_MAX_X - FROG_MIN_X);
        const y = bankMinYOf(seat) + rng.float() * (bankMaxYOf(seat) - bankMinYOf(seat));
        placeFrog(state, seat, x, y);
        const predicted = shotValue(state, seat, x, y, blind);
        shoot(state, seat);
        stepUntilRested(state, seat);
        const taken = seat === 'p1' ? state.p1 : state.p2;
        expect(taken, `trial ${String(trial)} ${seat}`).toBe(predicted);
      }
    }
  });

  it('measures the distance from a point to the swept segment exactly', () => {
    expect(reaches(100, 500, 300, 100, 400, 10)).toBe(true);
    expect(reaches(100, 500, 300, 100, 299, 10)).toBe(true);
    expect(reaches(100, 500, 300, 100, 289, 10)).toBe(false);
    expect(reaches(100, 500, 300, 110, 300, 10)).toBe(true);
    expect(reaches(100, 500, 300, 111, 300, 10)).toBe(false);
    // Off the end and to the side: the corner case a box test would get wrong.
    expect(reaches(100, 500, 300, 108, 293, 10)).toBe(false);
    expect(reaches(100, 500, 300, 106, 292, 10)).toBe(true);
  });

  it('cannot tunnel past a dragonfly, however fast the tongue crosses it', () => {
    const state = fresh(24);
    clearSky(state);
    // Right at the tip, where the tongue is moving fastest, on a coarse step.
    placeFly(state, 0, 300, homeYOf('p1') - TONGUE_REACH / 2);
    placeFrog(state, 'p1', 300, homeYOf('p1'));
    shoot(state, 'p1');
    for (let i = 0; i < 30; i += 1) step(state, 1 / 20);
    expect(state.p1).toBe(1);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Steering                                                                              */
/* ------------------------------------------------------------------------------------ */

describe('steering', () => {
  it('is nine headings and nothing else', () => {
    expect(headingSign(0)).toBe(0);
    expect(headingSign(STEER_DEADZONE)).toBe(0);
    expect(headingSign(-STEER_DEADZONE)).toBe(0);
    expect(headingSign(STEER_DEADZONE + 0.001)).toBe(1);
    expect(headingSign(-STEER_DEADZONE - 0.001)).toBe(-1);
  });

  it('covers the same ground on a diagonal as on an axis', () => {
    const straight = fresh(31);
    const diagonal = fresh(32);
    placeFrog(straight, 'p1', 300, 800);
    placeFrog(diagonal, 'p1', 300, 800);
    // Forty steps, well short of every wall, so the clamp is not what is being measured.
    for (let i = 0; i < 40; i += 1) {
      driveFrog(straight, 'p1', 1, 0, STEP);
      driveFrog(diagonal, 'p1', 1, -1, STEP);
    }
    const a = Math.hypot(straight.p1Frog.x - 300, straight.p1Frog.y - 800);
    const b = Math.hypot(diagonal.p1Frog.x - 300, diagonal.p1Frog.y - 800);
    expect(a).toBeCloseTo((FROG_SPEED * 40) / 60, 6);
    expect(b).toBeCloseTo((FROG_SPEED * 40) / 60, 6);
  });

  it('keeps a frog on its own bank however it is driven', () => {
    const rng = new Rng(33);
    const state = fresh(34);
    for (let i = 0; i < 4000; i += 1) {
      for (const seat of SEATS) {
        const heading = randomHeading(rng);
        driveFrog(state, seat, heading[0], heading[1], STEP);
        const frog = frogOf(state, seat);
        expect(frog.x).toBeGreaterThanOrEqual(FROG_MIN_X);
        expect(frog.x).toBeLessThanOrEqual(FROG_MAX_X);
        expect(frog.y).toBeGreaterThanOrEqual(bankMinYOf(seat));
        expect(frog.y).toBeLessThanOrEqual(bankMaxYOf(seat));
      }
      step(state, STEP);
    }
  });
});

/* ------------------------------------------------------------------------------------ */
/* Wasted shots, blows and the end of a match                                            */
/* ------------------------------------------------------------------------------------ */

describe('a wasted shot', () => {
  it('is a shot that touched no dragonfly at all', () => {
    const state = fresh(41);
    clearSky(state);
    placeFrog(state, 'p1', 300, 800);
    shoot(state, 'p1');
    stepUntilRested(state, 'p1');
    expect(state.p1Frog.wasted).toBe(1);
    expect(shotsLeft(state, 'p1')).toBe(WASTE_LIMIT - 1);
  });

  it('is not one when the shot took something', () => {
    const state = fresh(42);
    clearSky(state);
    placeFly(state, 0, 300, 500);
    placeFrog(state, 'p1', 300, 700);
    shoot(state, 'p1');
    stepUntilRested(state, 'p1');
    expect(state.p1).toBe(1);
    expect(state.p1Frog.wasted).toBe(0);
  });

  it('is still one when the shot only landed a blow, so aggression costs the aggressor', () => {
    const state = fresh(43);
    clearSky(state);
    placeFrog(state, 'p1', 300, frontYOf('p1'));
    placeFrog(state, 'p2', 300, frontYOf('p2'));
    shoot(state, 'p1');
    stepUntilRested(state, 'p1');
    expect(state.p2Frog.stunSeconds).toBeGreaterThan(0);
    expect(state.p1Frog.wasted).toBe(1);
  });

  it('is excused when another tongue took the dragonfly out from under it', () => {
    const state = fresh(44);
    clearSky(state);
    placeFly(state, 0, 300, 500);
    placeFrog(state, 'p1', 300, 500 + TONGUE_REACH / 2);
    placeFrog(state, 'p2', 300, 500 - TONGUE_REACH / 2);
    shoot(state, 'p1');
    shoot(state, 'p2');
    stepUntilRested(state, 'p1');
    // Committed on the same step: neither takes it, and neither is punished for it.
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect(state.p1Frog.wasted).toBe(0);
    expect(state.p2Frog.wasted).toBe(0);
  });

  it('loses the match at the limit, through the SDK rather than a comparison of our own', () => {
    const state = fresh(45);
    clearSky(state);
    placeFrog(state, 'p1', 300, 800);
    for (let i = 0; i < WASTE_LIMIT; i += 1) {
      expect(winnerOf(state)).toBeNull();
      shoot(state, 'p1');
      stepUntilRested(state, 'p1');
    }
    expect(state.p1Frog.wasted).toBe(WASTE_LIMIT);
    expect(winnerOf(state)).toBe('p2');
    expect(shotsLeft(state, 'p1')).toBe(0);
  });

  it('is a draw when both frogs run out on the same step', () => {
    const state = fresh(46);
    clearSky(state);
    placeFrog(state, 'p1', 60, 800);
    placeFrog(state, 'p2', 540, 200);
    state.p1Frog.wasted = WASTE_LIMIT - 1;
    state.p2Frog.wasted = WASTE_LIMIT - 1;
    shoot(state, 'p1');
    shoot(state, 'p2');
    stepUntilRested(state, 'p1');
    expect(winnerOf(state)).toBe('draw');
  });
});

describe('a blow', () => {
  it('knocks the far frog home, stuns it, and ends whatever shot it was taking', () => {
    const state = fresh(51);
    clearSky(state);
    placeFrog(state, 'p1', 300, frontYOf('p1'));
    placeFrog(state, 'p2', 300, frontYOf('p2'));
    // Seat one commits first, so its tongue crosses the gap first. Seat two is caught
    // mid-shot, which is the position the whole game is about.
    shoot(state, 'p1');
    step(state, STEP);
    shoot(state, 'p2');
    stepUntilRested(state, 'p1');
    expect(state.p2Frog.x).toBe(BOARD_WIDTH / 2);
    expect(state.p2Frog.y).toBe(homeYOf('p2'));
    expect(state.p2Frog.stunSeconds).toBeGreaterThan(0);
    expect(state.p2Frog.shooting).toBe(false);
  });

  it('misses a frog that has dodged sideways, which is the whole of the escape', () => {
    const state = fresh(52);
    clearSky(state);
    placeFrog(state, 'p1', 300, frontYOf('p1'));
    placeFrog(state, 'p2', 300 + SLAP_RADIUS + 1, frontYOf('p2'));
    shoot(state, 'p1');
    stepUntilRested(state, 'p1');
    expect(state.p2Frog.stunSeconds).toBe(0);
  });

  it('lands both ways when two frogs reach each other on one step', () => {
    const state = fresh(53);
    clearSky(state);
    placeFrog(state, 'p1', 300, frontYOf('p1'));
    placeFrog(state, 'p2', 300, frontYOf('p2'));
    shoot(state, 'p1');
    shoot(state, 'p2');
    for (let i = 0; i < 10; i += 1) step(state, STEP);
    expect(state.p1Frog.stunSeconds).toBeGreaterThan(0);
    expect(state.p2Frog.stunSeconds).toBeGreaterThan(0);
  });

  it('cannot reach a frog on its own back line, so retreating really is safe', () => {
    const state = fresh(54);
    clearSky(state);
    placeFrog(state, 'p1', 300, frontYOf('p1'));
    placeFrog(state, 'p2', 300, homeYOf('p2'));
    shoot(state, 'p1');
    stepUntilRested(state, 'p1');
    expect(state.p2Frog.stunSeconds).toBe(0);
  });
});

describe('two tongues on one dragonfly', () => {
  function contest(gapSteps: number): State {
    const state = fresh(61);
    clearSky(state);
    placeFly(state, 0, 300, 500);
    placeFrog(state, 'p1', 300, 500 + TONGUE_REACH / 2);
    placeFrog(state, 'p2', 300, 500 - TONGUE_REACH / 2);
    shoot(state, 'p1');
    for (let i = 0; i < gapSteps; i += 1) step(state, STEP);
    shoot(state, 'p2');
    for (let i = 0; i < 60; i += 1) step(state, STEP);
    return state;
  }

  it('gives it to neither when the two shots were committed on the same step', () => {
    const state = contest(0);
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
  });

  it('gives it to the frog that flicked first when they were a step apart', () => {
    const state = contest(1);
    expect(state.p1).toBe(1);
    expect(state.p2).toBe(0);
  });

  it('uses the SDK tolerance rather than a comparison written again here', () => {
    expect(resolveSimultaneous(1, 1)).toBe('draw');
    expect(resolveSimultaneous(1, 1 + STEP)).toBe('p1');
    expect(resolveSimultaneous(1 + STEP, 1)).toBe('p2');
  });
});

describe('the end of a match', () => {
  it('is won by the first frog to the target', () => {
    const state = fresh(71);
    state.p1 = TARGET_CATCHES;
    step(state, STEP);
    expect(winnerOf(state)).toBe('p1');
  });

  it('calls a level crossing a draw rather than handing it to whoever was checked first', () => {
    const state = fresh(72);
    state.p1 = TARGET_CATCHES;
    state.p2 = TARGET_CATCHES;
    step(state, STEP);
    expect(winnerOf(state)).toBe('draw');
  });

  it('gives an uneven crossing to the higher score', () => {
    const state = fresh(73);
    state.p1 = TARGET_CATCHES;
    state.p2 = TARGET_CATCHES + 2;
    step(state, STEP);
    expect(winnerOf(state)).toBe('p2');
  });

  it('goes to the higher catch at the whistle', () => {
    const state = fresh(74);
    state.clock = MATCH_SECONDS - STEP / 2;
    state.p1 = 9;
    state.p2 = 4;
    step(state, STEP);
    expect(winnerOf(state)).toBe('p1');
    expect(secondsLeft(state)).toBe(0);
  });

  it('breaks a level whistle on the frog that wasted fewer shots', () => {
    const state = fresh(75);
    state.clock = MATCH_SECONDS - STEP / 2;
    state.p1 = 7;
    state.p2 = 7;
    state.p1Frog.wasted = 3;
    state.p2Frog.wasted = 1;
    step(state, STEP);
    expect(winnerOf(state)).toBe('p2');
  });

  it('is a draw when neither the catch nor the wasted shots separate them', () => {
    const state = fresh(76);
    state.clock = MATCH_SECONDS - STEP / 2;
    state.p1 = 7;
    state.p2 = 7;
    state.p1Frog.wasted = 2;
    state.p2Frog.wasted = 2;
    step(state, STEP);
    expect(winnerOf(state)).toBe('draw');
  });

  it('ends even when nobody ever moves, with no step cap at all', () => {
    const state = fresh(77);
    let steps = 0;
    while (state.winner === null) {
      step(state, STEP);
      steps += 1;
    }
    expect(winnerOf(state)).toBe('draw');
    expect(state.clock).toBeGreaterThanOrEqual(MATCH_SECONDS);
    // A step of 1/60 does not add up to a hundred exactly, so the whistle lands on the
    // first step past it rather than on the six-thousandth.
    expect(steps).toBeGreaterThanOrEqual(Math.ceil(MATCH_SECONDS * 60));
    expect(steps).toBeLessThanOrEqual(Math.ceil(MATCH_SECONDS * 60) + 2);
  });

  it('freezes once it is decided', () => {
    const state = fresh(78);
    state.p1 = TARGET_CATCHES;
    step(state, STEP);
    const before = describeState(state);
    for (let i = 0; i < 100; i += 1) step(state, STEP);
    expect(describeState(state)).toBe(before);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

describe('the bot', () => {
  it('sees only what is in the air: a dragonfly still settling is worth nothing', () => {
    const state = fresh(81);
    clearSky(state);
    const fly = placeFly(state, 0, 300, 500);
    const blind = new Array<boolean>(FLY_COUNT).fill(false);
    expect(shotValue(state, 'p1', 300, 700, blind)).toBe(1);
    fly.live = false;
    expect(shotValue(state, 'p1', 300, 700, blind)).toBe(0);
  });

  it('is worth nothing to it if this look failed to see it', () => {
    const state = fresh(82);
    clearSky(state);
    placeFly(state, 0, 300, 500);
    const seen = new Array<boolean>(FLY_COUNT).fill(false);
    const missed = new Array<boolean>(FLY_COUNT).fill(false);
    missed[0] = true;
    expect(shotValue(state, 'p1', 300, 700, seen)).toBe(1);
    expect(shotValue(state, 'p1', 300, 700, missed)).toBe(0);
  });

  it('draws exactly one value a slot at every look, whatever the sky looks like', () => {
    for (const tier of TIERS) {
      const busy = fresh(83);
      const empty = fresh(83);
      clearSky(empty);
      const a = new Rng(7);
      const b = new Rng(7);
      const bot = createBotState();
      resetBotState(bot, 'p1');
      for (let i = 0; i < 40; i += 1) {
        botLook(busy, 'p1', tier, bot, a);
        botLook(empty, 'p1', tier, bot, b);
      }
      expect(a.next()).toBe(b.next());
    }
  });

  it('is not observable in what order the two seats are read', () => {
    for (const tier of TIERS) {
      for (let seed = 0; seed < 25; seed += 1) {
        const forward = playBots(seed * 977 + 5, { p1: tier, p2: tier });
        const reversed = playBots(seed * 977 + 5, { p1: tier, p2: tier }, { reversed: true });
        expect(reversed).toEqual(forward);
      }
    }
  });

  it('plays the same match twice from the same seed', () => {
    const a = playBots(99, { p1: 'normal', p2: 'easy' });
    const b = playBots(99, { p1: 'normal', p2: 'easy' });
    expect(a).toEqual(b);
  });

  it('holds out for a dragonfly rather than spraying', () => {
    const state = fresh(84);
    clearSky(state);
    const bot = createBotState();
    resetBotState(bot, 'p1');
    placeFrog(state, 'p1', 300, 800);
    // Nothing in the air: it must not shoot.
    for (let i = 0; i < 200; i += 1) {
      expect(botDecide(state, 'p1', 'hard', bot, new Rng(i + 1), STEP)).toBe(false);
    }
    // One in reach: now it does.
    placeFly(state, 0, 300, 800 - TONGUE_REACH / 2);
    let fired = false;
    for (let i = 0; i < 200 && !fired; i += 1) {
      fired = botDecide(state, 'p1', 'hard', bot, new Rng(1), STEP);
    }
    expect(fired).toBe(true);
    expect(SHOT_THRESHOLD).toBe(1);
  });

  it('steers with the same nine headings and the same speed a person has', () => {
    const rng = new Rng(85);
    const legal = new Set(HEADINGS.map(([x, y]) => `${String(x)},${String(y)}`));
    for (const tier of TIERS) {
      const state = fresh(86);
      const bot = createBotState();
      resetBotState(bot, 'p1');
      for (let i = 0; i < 600; i += 1) {
        botDecide(state, 'p1', tier, bot, rng, STEP);
        expect(legal.has(`${String(bot.dirX)},${String(bot.dirY)}`)).toBe(true);
        driveFrog(state, 'p1', bot.dirX, bot.dirY, STEP);
        step(state, STEP);
      }
    }
  });

  it('never values a blow highly enough to spend a shot on one', () => {
    // `AGGRESSION` sits strictly below `SHOT_THRESHOLD`, so a blow can tip the choice of
    // where to stand but can never on its own be a reason to flick. That is what keeps a bot
    // from talking itself into the wasted shots the loss condition counts.
    expect(AGGRESSION).toBeGreaterThan(0);
    expect(AGGRESSION).toBeLessThan(SHOT_THRESHOLD);
    const state = fresh(87);
    clearSky(state);
    placeFrog(state, 'p1', 300, frontYOf('p1'));
    placeFrog(state, 'p2', 300, frontYOf('p2'));
    const bot = createBotState();
    resetBotState(bot, 'p1');
    for (let i = 0; i < 120; i += 1) {
      expect(botDecide(state, 'p1', 'hard', bot, new Rng(i + 3), STEP)).toBe(false);
    }
  });

  it('has a profile for every tier, and no knob that is not a human limitation', () => {
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(Object.keys(profile).sort()).toEqual(['blindChance', 'thinkSeconds']);
      expect(profile.thinkSeconds).toBeGreaterThan(0);
      expect(profile.blindChance).toBeGreaterThanOrEqual(0);
      expect(profile.blindChance).toBeLessThan(1);
    }
    expect(BOT_PROFILES.easy.thinkSeconds).toBeGreaterThan(BOT_PROFILES.normal.thinkSeconds);
    expect(BOT_PROFILES.normal.thinkSeconds).toBeGreaterThan(BOT_PROFILES.hard.thinkSeconds);
    expect(BOT_PROFILES.easy.blindChance).toBeGreaterThan(BOT_PROFILES.normal.blindChance);
    expect(BOT_PROFILES.normal.blindChance).toBeGreaterThan(BOT_PROFILES.hard.blindChance);
  });

  it('never shoots sooner than its own delay lets it see a reason to', () => {
    for (const tier of TIERS) {
      const state = fresh(88);
      clearSky(state);
      const bot = createBotState();
      resetBotState(bot, 'p1');
      placeFrog(state, 'p1', 300, 800);
      // One look at an empty sky, then a dragonfly appears. It must not react before the
      // next look is due.
      botDecide(state, 'p1', tier, bot, new Rng(9), STEP);
      placeFly(state, 0, 300, 800 - TONGUE_REACH / 2);
      const wait = Math.floor(BOT_PROFILES[tier].thinkSeconds * 60) - 1;
      for (let i = 0; i < wait; i += 1) {
        expect(botDecide(state, 'p1', tier, bot, new Rng(9), STEP), tier).toBe(false);
      }
    }
  });

  it('is a ladder head to head, in both seat orders', () => {
    const hardNormal = duel('hard', 'normal', 120);
    const normalEasy = duel('normal', 'easy', 120);
    const hardEasy = duel('hard', 'easy', 120);
    for (const tally of [hardNormal, normalEasy, hardEasy]) {
      expect(tally.unfinished).toBe(0);
      expect(tally.decided).toBeGreaterThan(200);
    }
    const a = hardNormal.wins / hardNormal.decided;
    const b = normalEasy.wins / normalEasy.decided;
    const c = hardEasy.wins / hardEasy.decided;
    expect(a).toBeGreaterThan(0.58);
    expect(b).toBeGreaterThan(0.72);
    expect(c).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(0.85);
  });

  it('is fair between the seats at every tier', () => {
    for (const tier of TIERS) {
      let p1 = 0;
      let p2 = 0;
      for (let seed = 0; seed < 200; seed += 1) {
        const result = playBots(seed * 7919 + 13, { p1: tier, p2: tier });
        if (result.winner === 'p1') p1 += 1;
        else if (result.winner === 'p2') p2 += 1;
      }
      const share = p1 / (p1 + p2);
      expect(share, `${tier} seat one share ${String(share)}`).toBeGreaterThan(0.38);
      expect(share, `${tier} seat one share ${String(share)}`).toBeLessThan(0.62);
    }
  });

  it('finishes every match two of the weakest tier play, without a frame cap', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const result = playBots(seed * 613 + 3, { p1: 'easy', p2: 'easy' });
      expect(result.winner).not.toBeNull();
      expect(result.seconds).toBeLessThanOrEqual(MATCH_SECONDS);
    }
  });

  it('reaches the target rather than limping to the whistle', () => {
    let byTarget = 0;
    let byWaste = 0;
    for (let seed = 0; seed < 120; seed += 1) {
      const result = playBots(seed * 811 + 7, { p1: 'easy', p2: 'easy' });
      if (result.p1 >= TARGET_CATCHES || result.p2 >= TARGET_CATCHES) byTarget += 1;
      else if (result.wasted1 >= WASTE_LIMIT || result.wasted2 >= WASTE_LIMIT) byWaste += 1;
    }
    expect(byTarget + byWaste).toBe(120);
    expect(byTarget).toBeGreaterThan(100);
    // Both endings are live. The waste limit is not decoration.
    expect(byWaste).toBeGreaterThan(0);
  });

  it('shoots well under the cadence its fairness argument claims', () => {
    // `docs/input-idiom.md` draws the cross-device line at about two committing presses a
    // second. The shot cycle caps this game below it by construction, and this is the check
    // that the constants still add up to that.
    expect(1 / SHOT_CYCLE_SECONDS).toBeLessThan(2);
    for (const tier of TIERS) {
      let shots = 0;
      let seconds = 0;
      for (let seed = 0; seed < 40; seed += 1) {
        const result = playBots(seed * 449 + 1, { p1: tier, p2: tier });
        shots += result.shots1 + result.shots2;
        seconds += result.seconds * 2;
      }
      expect(shots / seconds, tier).toBeLessThan(1 / SHOT_CYCLE_SECONDS);
    }
  });
});

/* ------------------------------------------------------------------------------------ */
/* The step itself                                                                       */
/* ------------------------------------------------------------------------------------ */

describe('the step', () => {
  it('holds its shape: nothing grows over a whole match', () => {
    const state = fresh(91);
    const bot1 = createBotState();
    const bot2 = createBotState();
    resetBotState(bot1, 'p1');
    resetBotState(bot2, 'p2');
    const rng1 = new Rng(1);
    const rng2 = new Rng(2);
    const shapeBefore = `${String(state.flies.length)}/${String(bot1.blind.length)}`;
    while (state.winner === null) {
      botDecide(state, 'p1', 'hard', bot1, rng1, STEP);
      botDecide(state, 'p2', 'hard', bot2, rng2, STEP);
      driveFrog(state, 'p1', bot1.dirX, bot1.dirY, STEP);
      driveFrog(state, 'p2', bot2.dirX, bot2.dirY, STEP);
      step(state, STEP);
    }
    expect(`${String(state.flies.length)}/${String(bot1.blind.length)}`).toBe(shapeBefore);
  });

  it('steps the identical match at 60, 90 and 120 Hz for the parts that are rate-free', () => {
    // The shot profile is a function of accumulated seconds, so the tongue's depth at a given
    // time is the same however finely the clock is sliced.
    for (const rate of [60, 90, 120, 240]) {
      const dt = 1 / rate;
      const state = fresh(92);
      clearSky(state);
      placeFrog(state, 'p1', 300, 800);
      shoot(state, 'p1');
      let seconds = 0;
      while (seconds < SHOT_OUT_SECONDS - dt) {
        step(state, dt);
        seconds += dt;
      }
      expect(tipYOf('p1', 800, state.p1Frog.shotSeconds)).toBeCloseTo(800 - depthAt(seconds), 9);
    }
  });

  it('never lets a shot reach further than the tongue is long', () => {
    const state = fresh(93);
    placeFrog(state, 'p1', 300, frontYOf('p1'));
    shoot(state, 'p1');
    for (let i = 0; i < 60; i += 1) {
      step(state, STEP);
      const depth = depthAt(state.p1Frog.shotSeconds);
      expect(depth).toBeGreaterThanOrEqual(0);
      expect(depth).toBeLessThanOrEqual(TONGUE_REACH);
    }
  });

  it('keeps a catch radius that is the tongue plus the thing it is catching', () => {
    expect(CATCH_RADIUS).toBeLessThan(SLAP_RADIUS);
    expect(tongueOut(fresh(1).p1Frog)).toBe(false);
  });
});
