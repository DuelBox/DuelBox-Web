import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { resolveSimultaneous } from '@duelbox/game-sdk';
import {
  ARRIVE_SECONDS,
  BALL_MAX_X,
  BALL_MAX_Y,
  BALL_MIN_X,
  BALL_MIN_Y,
  BALL_RADIUS,
  BALL_SPEED_MAX,
  BALL_SPEED_MIN,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_PROFILES,
  CATCH_RADIUS,
  CHOMP_CYCLE_SECONDS,
  CHOMP_THRESHOLD,
  HIPPO_MAX_X,
  HIPPO_MIN_X,
  HIPPO_SPEED,
  LUNGE_HOLD_SECONDS,
  LUNGE_OUT_SECONDS,
  LUNGE_REACH,
  MATCH_SECONDS,
  MOUTH_OPEN_SECONDS,
  OTHER_POINTS,
  OWN_POINTS,
  POND_BALLS,
  POND_BOTTOM,
  POND_TOP,
  TARGET_POINTS,
  botLook,
  botStep,
  chomp,
  chompValue,
  colourOfSlot,
  createBotState,
  createState,
  depthAt,
  driveHippo,
  hippoOf,
  homeYOf,
  mouthOpen,
  mouthYOf,
  reachSignOf,
  reaches,
  resetBotState,
  resetState,
  resting,
  secondsLeft,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, State } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];

function fresh(seed = 1, openingSeat: SeatId = 'p1'): { state: State; rng: Rng } {
  const rng = new Rng(seed);
  const state = createState();
  resetState(state, rng, openingSeat);
  return { state, rng };
}

/** Park every ball on the wall so a test can place exactly the ones it cares about. */
function clearPond(state: State): void {
  for (const ball of state.balls) {
    ball.live = false;
    ball.arriveSeconds = ARRIVE_SECONDS * 10;
    ball.x = BALL_MIN_X;
    ball.y = BALL_MIN_Y;
    ball.vx = 0;
    ball.vy = 0;
  }
}

/** Put the slot of `seat`'s colour at a point and hold it still. */
function place(state: State, seat: SeatId, x: number, y: number): number {
  for (let i = 0; i < state.balls.length; i += 1) {
    const ball = state.balls[i]!;
    if (ball.seat !== seat || ball.live) continue;
    ball.live = true;
    ball.arriveSeconds = 0;
    ball.x = x;
    ball.y = y;
    ball.vx = 0;
    ball.vy = 0;
    return i;
  }
  throw new Error(`no free ${seat} slot`);
}

/** One bot-against-bot match, driven exactly as game.ts drives it. */
function playMatch(
  seed: number,
  p1Tier: BotDifficulty | null,
  p2Tier: BotDifficulty | null,
  options: { readonly reversePoll?: boolean; readonly maxSteps?: number } = {},
): { state: State; steps: number } {
  const seedRng = new Rng(seed);
  const pondRng = new Rng(seedRng.next() | 0);
  const rng: Record<SeatId, Rng> = {
    p1: new Rng(seedRng.next() | 0),
    p2: new Rng(seedRng.next() | 0),
  };
  const state = createState();
  resetState(state, pondRng);
  const bots = { p1: createBotState(), p2: createBotState() };
  const order: readonly SeatId[] = options.reversePoll === true ? ['p2', 'p1'] : ['p1', 'p2'];
  const limit = options.maxSteps ?? 60 * 600;

  let steps = 0;
  for (; steps < limit; steps += 1) {
    for (const seat of order) {
      const tier = seat === 'p1' ? p1Tier : p2Tier;
      if (tier === null) continue;
      if (botStep(state, seat, tier, bots[seat], rng[seat], STEP)) chomp(state, seat);
    }
    step(state, STEP, pondRng);
    if (state.winner !== null) break;
  }
  return { state, steps };
}

describe('the pond', () => {
  it('opens with a full stock, half of each kind, every ball in play', () => {
    const { state } = fresh();
    expect(state.balls).toHaveLength(POND_BALLS);
    expect(state.balls.filter((b) => b.seat === 'p1')).toHaveLength(POND_BALLS / 2);
    expect(state.balls.filter((b) => b.seat === 'p2')).toHaveLength(POND_BALLS / 2);
    expect(state.balls.every((b) => b.live)).toBe(true);
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect(winnerOf(state)).toBeNull();
  });

  it('never changes a ball’s colour, so neither seat can be starved of its own kind', () => {
    const { state, rng } = fresh(9);
    const before = state.balls.map((b) => b.seat);
    for (let i = 0; i < 6000; i += 1) {
      if (i % 40 === 0) chomp(state, i % 80 === 0 ? 'p1' : 'p2');
      step(state, STEP, rng);
    }
    expect(state.balls.map((b) => b.seat)).toEqual(before);
    expect(state.balls.map((_b, i) => colourOfSlot(i))).toEqual(before);
    expect(colourOfSlot(0, 'p2')).toBe('p2');
    expect(colourOfSlot(1, 'p2')).toBe('p1');
  });

  /**
   * The opening board is the same board for both seats, and this is the check.
   *
   * Slot `2k + 1` is placed at the half-turn image of slot `2k` with its heading reversed, and
   * the two slots are opposite colours — so rotating the pond and swapping the colours gives
   * back exactly the pond you started with. Neither seat can be dealt the better opening.
   */
  it('lays out an opening that is exactly symmetric under the half-turn, either opener', () => {
    for (const opener of SEATS) {
      for (let seed = 1; seed <= 100; seed += 1) {
        const { state } = fresh(seed, opener);
        for (let pair = 0; pair * 2 < state.balls.length; pair += 1) {
          const mine = state.balls[pair * 2]!;
          const theirs = state.balls[pair * 2 + 1]!;
          expect(mine.seat).toBe(opener);
          expect(theirs.seat).toBe(opener === 'p1' ? 'p2' : 'p1');
          expect(theirs.x).toBeCloseTo(BOARD_WIDTH - mine.x, 10);
          expect(theirs.y).toBeCloseTo(BOARD_HEIGHT - mine.y, 10);
          expect(theirs.vx).toBeCloseTo(-mine.vx, 10);
          expect(theirs.vy).toBeCloseTo(-mine.vy, 10);
        }
        expect(state.p1Hippo.x).toBe(state.p2Hippo.x);
      }
    }
  });

  /**
   * The opener decides which parity is whose, and nothing else. The two ponds a seed can deal
   * are each other's half-turn image with the colours swapped — so neither opener is the better
   * one, and the alternation the SDK does across the rounds of a best-of is provably inert.
   */
  it('deals the mirror-image pond to the other opener, and no better one', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const a = fresh(seed, 'p1').state;
      const b = fresh(seed, 'p2').state;
      for (let i = 0; i < a.balls.length; i += 1) {
        const one = a.balls[i]!;
        const two = b.balls[i]!;
        // The same twelve positions, in the same slots; only the colours have moved.
        expect(two.x).toBe(one.x);
        expect(two.y).toBe(one.y);
        expect(two.seat).toBe(one.seat === 'p1' ? 'p2' : 'p1');
      }
    }
  });

  it('keeps every ball inside the water and at a constant speed', () => {
    const { state, rng } = fresh(4);
    const speeds = state.balls.map((b) => Math.hypot(b.vx, b.vy));
    for (let i = 0; i < 20000; i += 1) {
      step(state, STEP, rng);
      for (const ball of state.balls) {
        expect(ball.x).toBeGreaterThanOrEqual(BALL_MIN_X - 1e-9);
        expect(ball.x).toBeLessThanOrEqual(BALL_MAX_X + 1e-9);
        expect(ball.y).toBeGreaterThanOrEqual(BALL_MIN_Y - 1e-9);
        expect(ball.y).toBeLessThanOrEqual(BALL_MAX_Y + 1e-9);
      }
    }
    // Nothing eats anything here, so the same twelve balls are still carrying their speeds.
    for (let i = 0; i < state.balls.length; i += 1) {
      expect(Math.hypot(state.balls[i]!.vx, state.balls[i]!.vy)).toBeCloseTo(speeds[i]!, 6);
    }
  });

  it('rolls a replacement in from a wall, out of play until it is there', () => {
    const { state, rng } = fresh(11);
    clearPond(state);
    state.p1Hippo.x = HIPPO_MIN_X;
    state.p1Hippo.targetX = HIPPO_MIN_X;
    const slot = place(state, 'p1', HIPPO_MIN_X, POND_BOTTOM - 40);
    chomp(state, 'p1');
    step(state, STEP, rng);

    const ball = state.balls[slot]!;
    expect(state.p1).toBe(OWN_POINTS);
    expect(ball.live).toBe(false);
    expect(ball.arriveSeconds).toBeCloseTo(ARRIVE_SECONDS, 6);
    expect([BALL_MIN_X, BALL_MAX_X]).toContain(ball.x);
    const speed = Math.hypot(ball.vx, ball.vy);
    expect(speed).toBeGreaterThanOrEqual(BALL_SPEED_MIN - 1e-9);
    expect(speed).toBeLessThanOrEqual(BALL_SPEED_MAX + 1e-9);

    // A hippo parked on top of the spawn cannot take it before it is live.
    for (let i = 0; i < 30; i += 1) {
      chomp(state, 'p1');
      step(state, STEP, rng);
    }
    expect(state.p1).toBe(OWN_POINTS);
  });
});

describe('a chomp', () => {
  it('reaches out, gapes, and comes back', () => {
    expect(depthAt(0)).toBe(0);
    expect(depthAt(LUNGE_OUT_SECONDS / 2)).toBeCloseTo(LUNGE_REACH / 2, 6);
    expect(depthAt(LUNGE_OUT_SECONDS)).toBeCloseTo(LUNGE_REACH, 6);
    expect(depthAt(LUNGE_OUT_SECONDS + LUNGE_HOLD_SECONDS / 2)).toBeCloseTo(LUNGE_REACH, 6);
    expect(depthAt(MOUTH_OPEN_SECONDS)).toBeCloseTo(0, 6);
    expect(depthAt(CHOMP_CYCLE_SECONDS)).toBe(0);
  });

  it('closes its mouth for the recovery and cannot be started again until it is over', () => {
    const { state, rng } = fresh(2);
    expect(chomp(state, 'p1')).toBe(true);
    expect(chomp(state, 'p1')).toBe(false);
    let sawClosedMidChomp = false;
    for (let i = 0; i < Math.round(CHOMP_CYCLE_SECONDS / STEP); i += 1) {
      step(state, STEP, rng);
      if (state.p1Hippo.chomping && !mouthOpen(state.p1Hippo)) sawClosedMidChomp = true;
      if (state.p1Hippo.chomping) expect(chomp(state, 'p1')).toBe(false);
    }
    expect(sawClosedMidChomp).toBe(true);
    expect(resting(state.p1Hippo)).toBe(true);
    expect(chomp(state, 'p1')).toBe(true);
  });

  /**
   * The mouth's whole path is a vertical segment because a hippo may not slide while it is
   * out — so the predicate the bot uses over the *whole* chomp is the union of the predicates
   * the simulation uses step by step. This is the guard issue #2465 asks for: a bot that
   * reasons analytically about a quantity the simulation integrates must agree with it
   * exactly, not nearly.
   */
  it('catches exactly what the bot predicted it would, for a pond that is holding still', () => {
    let caught = 0;
    for (const seat of SEATS) {
      for (let trial = 0; trial < 60; trial += 1) {
        const rng = new Rng(500 + trial);
        const state = createState();
        resetState(state, rng);
        clearPond(state);

        const hippoX = HIPPO_MIN_X + rng.float() * (HIPPO_MAX_X - HIPPO_MIN_X);
        const hippo = hippoOf(state, seat);
        hippo.x = hippoX;
        hippo.targetX = hippoX;

        const placed: number[] = [];
        for (let i = 0; i < POND_BALLS; i += 1) {
          const ball = state.balls[i]!;
          ball.live = true;
          ball.arriveSeconds = 0;
          ball.x = BALL_MIN_X + rng.float() * (BALL_MAX_X - BALL_MIN_X);
          ball.y = BALL_MIN_Y + rng.float() * (BALL_MAX_Y - BALL_MIN_Y);
          ball.vx = 0;
          ball.vy = 0;
          placed.push(i);
        }

        const noMisreads = new Array<boolean>(POND_BALLS).fill(false);
        const predicted = chompValue(state, seat, hippoX, noMisreads);

        chomp(state, seat);
        for (let i = 0; i < Math.round(CHOMP_CYCLE_SECONDS / STEP) + 2; i += 1) {
          step(state, STEP, rng);
        }
        for (const slot of placed) if (!state.balls[slot]!.live) caught += 1;
        // Against `chompGain` rather than the score, because the score has a floor at zero
        // and the prediction does not: the two are the same number only while nobody is broke.
        expect(hippoOf(state, seat).chompGain).toBe(predicted);
      }
    }
    // The comparison above is worth nothing if no chomp ever caught anything.
    expect(caught).toBeGreaterThan(60);
  });

  it('measures the distance from a point to the swept segment exactly', () => {
    // On the segment, at the cap, and just outside it.
    expect(reaches(100, 400, 600, 100, 500)).toBe(true);
    expect(reaches(100, 400, 600, 100 + CATCH_RADIUS, 500)).toBe(true);
    expect(reaches(100, 400, 600, 100 + CATCH_RADIUS + 0.001, 500)).toBe(false);
    expect(reaches(100, 400, 600, 100, 600 + CATCH_RADIUS)).toBe(true);
    expect(reaches(100, 400, 600, 100, 600 + CATCH_RADIUS + 0.001)).toBe(false);
    // The round cap, not a box: the corner of the bounding rectangle is out of reach.
    expect(reaches(100, 400, 600, 100 + CATCH_RADIUS, 600 + CATCH_RADIUS)).toBe(false);
  });

  it('cannot reach past its own limit, and the two limits overlap in the middle', () => {
    const p1Tip = homeYOf('p1') + reachSignOf('p1') * LUNGE_REACH;
    const p2Tip = homeYOf('p2') + reachSignOf('p2') * LUNGE_REACH;
    expect(p1Tip).toBeLessThan(p2Tip);
    // The design statement: a ball on the middle line is inside both fully stretched mouths.
    const middle = (POND_TOP + POND_BOTTOM) / 2;
    expect(reaches(300, p1Tip, p1Tip, 300, middle)).toBe(true);
    expect(reaches(300, p2Tip, p2Tip, 300, middle)).toBe(true);
    // And a ball behind a hippo's own bank is beyond nobody's reach but its own.
    expect(reaches(300, homeYOf('p1'), p1Tip, 300, POND_TOP + BALL_RADIUS)).toBe(false);
  });
});

describe('scoring', () => {
  it('pays two for your own kind and takes one for the other seat’s', () => {
    for (const seat of SEATS) {
      const { state, rng } = fresh(3);
      clearPond(state);
      const hippo = hippoOf(state, seat);
      const y = homeYOf(seat) + reachSignOf(seat) * 100;
      place(state, seat, hippo.x, y);
      chomp(state, seat);
      for (let i = 0; i < Math.round(CHOMP_CYCLE_SECONDS / STEP) + 1; i += 1)
        step(state, STEP, rng);
      expect(seat === 'p1' ? state.p1 : state.p2).toBe(OWN_POINTS);
    }
    for (const seat of SEATS) {
      const { state, rng } = fresh(3);
      clearPond(state);
      const hippo = hippoOf(state, seat);
      const y = homeYOf(seat) + reachSignOf(seat) * 100;
      // A few of your own first, so the floor at zero cannot hide the penalty.
      if (seat === 'p1') state.p1 = 10;
      else state.p2 = 10;
      place(state, seat === 'p1' ? 'p2' : 'p1', hippo.x, y);
      chomp(state, seat);
      for (let i = 0; i < Math.round(CHOMP_CYCLE_SECONDS / STEP) + 1; i += 1)
        step(state, STEP, rng);
      expect(seat === 'p1' ? state.p1 : state.p2).toBe(10 + OTHER_POINTS);
    }
  });

  it('never lets a score go below zero', () => {
    const { state, rng } = fresh(5);
    clearPond(state);
    for (let round = 0; round < 6; round += 1) {
      place(state, 'p2', state.p1Hippo.x, POND_BOTTOM - 60);
      chomp(state, 'p1');
      for (let i = 0; i < Math.round(CHOMP_CYCLE_SECONDS / STEP) + 1; i += 1)
        step(state, STEP, rng);
      expect(state.p1).toBe(0);
    }
  });

  it('a chomp reports its own net, which may be negative even though a score may not', () => {
    const { state, rng } = fresh(7);
    clearPond(state);
    state.p1 = 20;
    const x = state.p1Hippo.x;
    place(state, 'p2', x, POND_BOTTOM - 80);
    place(state, 'p2', x, POND_BOTTOM - 200);
    place(state, 'p1', x, POND_BOTTOM - 300);
    chomp(state, 'p1');
    for (let i = 0; i < Math.round(CHOMP_CYCLE_SECONDS / STEP) + 1; i += 1) step(state, STEP, rng);
    expect(state.p1Hippo.chompGain).toBe(OTHER_POINTS * 2 + OWN_POINTS);
    expect(state.p1).toBe(20 + state.p1Hippo.chompGain);
  });
});

/**
 * The heart of a real-time game with one shared object in it: two hippos, one ball.
 */
describe('two mouths on one ball', () => {
  /** Both hippos on the middle line at the same x, so both fully stretched mouths hold it. */
  function standoff(seed: number, offsetSteps: number): State {
    const rng = new Rng(seed);
    const state = createState();
    resetState(state, rng);
    clearPond(state);
    const x = (HIPPO_MIN_X + HIPPO_MAX_X) / 2;
    state.p1Hippo.x = x;
    state.p1Hippo.targetX = x;
    state.p2Hippo.x = x;
    state.p2Hippo.targetX = x;
    place(state, 'p1', x, (POND_TOP + POND_BOTTOM) / 2);

    chomp(state, 'p1');
    for (let i = 0; i < offsetSteps; i += 1) step(state, STEP, rng);
    chomp(state, 'p2');
    for (let i = 0; i < Math.round(CHOMP_CYCLE_SECONDS / STEP) * 2; i += 1) step(state, STEP, rng);
    return state;
  }

  it('gives it to neither when the two chomps were committed on the same step', () => {
    const state = standoff(21, 0);
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    // And it is still in the water: a standoff is not a way to remove a ball.
    expect(state.balls.some((b) => b.live && b.seat === 'p1')).toBe(true);
  });

  it('gives it to the hippo that snapped first when they were a step apart', () => {
    const state = standoff(21, 1);
    expect(state.p1).toBe(OWN_POINTS);
    expect(state.p2).toBe(0);
  });

  it('uses the SDK’s tolerance rather than a comparison written again here', () => {
    // A step is 16.7 ms and the SDK calls anything inside 8 ms a genuine draw, so "the same
    // step" and "a draw" are the same statement. If either number ever changes, this fails.
    expect(resolveSimultaneous(1, 1)).toBe('draw');
    expect(resolveSimultaneous(1, 1 + STEP)).toBe('p1');
    expect(resolveSimultaneous(1 + STEP, 1)).toBe('p2');
  });
});

describe('the win condition', () => {
  it('is first to fifty, decided by the SDK and not by a comparison of our own', () => {
    const { state, rng } = fresh(13);
    clearPond(state);
    state.p1 = TARGET_POINTS - 1;
    step(state, STEP, rng);
    expect(winnerOf(state)).toBeNull();
    state.p1 = TARGET_POINTS;
    step(state, STEP, rng);
    expect(winnerOf(state)).toBe('p1');
  });

  it('calls a level crossing a draw rather than handing it to whoever was checked first', () => {
    const { state, rng } = fresh(13);
    clearPond(state);
    state.p1 = TARGET_POINTS;
    state.p2 = TARGET_POINTS;
    step(state, STEP, rng);
    expect(winnerOf(state)).toBe('draw');
  });

  it('gives an uneven crossing to the higher score', () => {
    const { state, rng } = fresh(13);
    clearPond(state);
    state.p1 = TARGET_POINTS;
    state.p2 = TARGET_POINTS + 2;
    step(state, STEP, rng);
    expect(winnerOf(state)).toBe('p2');
  });

  /**
   * The clock is the termination guarantee, and it is in the rules — not in `roundSeconds`,
   * which ends nothing anywhere in this repository.
   */
  it('ends on the clock with the higher score, and level is a draw', () => {
    const { state, rng } = fresh(17);
    clearPond(state);
    state.p1 = 4;
    state.p2 = 9;
    let steps = 0;
    while (winnerOf(state) === null) {
      step(state, STEP, rng);
      steps += 1;
      expect(steps).toBeLessThan(60 * 600);
    }
    expect(state.clock).toBeGreaterThanOrEqual(MATCH_SECONDS);
    expect(winnerOf(state)).toBe('p2');
    expect(secondsLeft(state)).toBe(0);
  });

  it('ends two seats who never move as a draw, so a match with no input still finishes', () => {
    const { state, rng } = fresh(19);
    let steps = 0;
    while (winnerOf(state) === null) {
      step(state, STEP, rng);
      steps += 1;
      expect(steps).toBeLessThan(60 * 600);
    }
    expect(winnerOf(state)).toBe('draw');
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
  });

  it('freezes once it is over', () => {
    const { state, rng } = fresh(23);
    clearPond(state);
    state.p1 = TARGET_POINTS;
    step(state, STEP, rng);
    const clock = state.clock;
    for (let i = 0; i < 200; i += 1) step(state, STEP, rng);
    expect(state.clock).toBe(clock);
  });
});

describe('steering', () => {
  it('moves a hippo at the same speed whatever asked for it', () => {
    const dragged = createState().p1Hippo;
    const keyed = createState().p1Hippo;
    dragged.x = 200;
    keyed.x = 200;
    for (let i = 0; i < 30; i += 1) {
      // A thumb slammed against the far wall, and a key held down. Neither may outrun the other.
      driveHippo(dragged, HIPPO_MAX_X, STEP);
      driveHippo(keyed, keyed.x + HIPPO_SPEED * STEP * 2, STEP);
    }
    expect(dragged.x).toBeCloseTo(keyed.x, 9);
    expect(dragged.x).toBeCloseTo(200 + HIPPO_SPEED * STEP * 30, 9);
  });

  it('keeps a hippo on its own bank', () => {
    const hippo = createState().p1Hippo;
    for (let i = 0; i < 600; i += 1) driveHippo(hippo, -10_000, STEP);
    expect(hippo.x).toBe(HIPPO_MIN_X);
    for (let i = 0; i < 600; i += 1) driveHippo(hippo, 10_000, STEP);
    expect(hippo.x).toBe(HIPPO_MAX_X);
  });

  it('will not let a hippo slide while its mouth is out', () => {
    const { state, rng } = fresh(29);
    const start = state.p1Hippo.x;
    chomp(state, 'p1');
    for (let i = 0; i < Math.round(MOUTH_OPEN_SECONDS / STEP); i += 1) {
      driveHippo(state.p1Hippo, HIPPO_MAX_X, STEP);
      step(state, STEP, rng);
      expect(state.p1Hippo.x).toBe(start);
    }
  });
});

describe('the bot', () => {
  it('reads only what is in the water: a ball still rolling in is worth nothing', () => {
    const { state } = fresh(31);
    clearPond(state);
    const noMisreads = new Array<boolean>(POND_BALLS).fill(false);
    const x = state.p1Hippo.x;
    const slot = place(state, 'p1', x, POND_BOTTOM - 100);
    expect(chompValue(state, 'p1', x, noMisreads)).toBe(OWN_POINTS);
    state.balls[slot]!.live = false;
    state.balls[slot]!.arriveSeconds = ARRIVE_SECONDS;
    expect(chompValue(state, 'p1', x, noMisreads)).toBe(0);
  });

  it('values a misread ball as the other seat’s, which is the whole of its handicap', () => {
    const { state } = fresh(33);
    clearPond(state);
    const x = state.p1Hippo.x;
    const slot = place(state, 'p1', x, POND_BOTTOM - 100);
    const misread = new Array<boolean>(POND_BALLS).fill(false);
    expect(chompValue(state, 'p1', x, misread)).toBe(OWN_POINTS);
    misread[slot] = true;
    expect(chompValue(state, 'p1', x, misread)).toBe(OTHER_POINTS);
  });

  it('draws exactly one value per ball slot at every look, whatever the board looks like', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const busy = fresh(37);
      const empty = fresh(37);
      clearPond(empty.state);

      const a = new Rng(101);
      const b = new Rng(101);
      const bot = createBotState();
      botLook(busy.state, 'p1', tier, bot, a);
      resetBotState(bot);
      botLook(empty.state, 'p1', tier, bot, b);
      // Both generators have advanced by the same amount, so a busy pond and an empty one
      // leave the seat in the same place in its own stream.
      expect(a.save()).toEqual(b.save());

      // And that amount is one draw a slot.
      const c = new Rng(101);
      for (let i = 0; i < POND_BALLS; i += 1) c.float();
      expect(a.save()).toEqual(c.save());
    }
  });

  it('is not observable in what order the two seats are polled', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const forwards = playMatch(seed * 1013, tier, tier);
        const backwards = playMatch(seed * 1013, tier, tier, { reversePoll: true });
        expect(backwards.state.p1).toBe(forwards.state.p1);
        expect(backwards.state.p2).toBe(forwards.state.p2);
        expect(backwards.state.winner).toBe(forwards.state.winner);
        expect(backwards.steps).toBe(forwards.steps);
      }
    }
  });

  it('plays the same match twice from the same seed', () => {
    const a = playMatch(4242, 'normal', 'hard');
    const b = playMatch(4242, 'normal', 'hard');
    expect(b.state.p1).toBe(a.state.p1);
    expect(b.state.p2).toBe(a.state.p2);
    expect(b.state.clock).toBe(a.state.clock);
    expect(b.state.balls.map((ball) => ball.x)).toEqual(a.state.balls.map((ball) => ball.x));
  });

  it('holds out for at least one clean ball of its own before it snaps', () => {
    // The threshold is on an integer quantity, so it names a set of chomps rather than a
    // number: two is "one of mine", and one of mine against one of theirs nets one and does
    // not clear it.
    expect(Number.isInteger(CHOMP_THRESHOLD)).toBe(true);
    expect(OWN_POINTS).toBeGreaterThanOrEqual(CHOMP_THRESHOLD);
    expect(OWN_POINTS + OTHER_POINTS).toBeLessThan(CHOMP_THRESHOLD);

    const { state } = fresh(41);
    clearPond(state);
    const bot = createBotState();
    const rng = new Rng(7);
    const x = state.p1Hippo.x;
    place(state, 'p2', x, POND_BOTTOM - 90);
    bot.thinkSeconds = 0;
    expect(botStep(state, 'p1', 'hard', bot, rng, STEP)).toBe(false);
    place(state, 'p1', x, POND_BOTTOM - 150);
    bot.thinkSeconds = 0;
    // Two of theirs against one of mine is still not worth a cycle; one of mine is.
    place(state, 'p1', x, POND_BOTTOM - 210);
    bot.thinkSeconds = 0;
    expect(botStep(state, 'p1', 'hard', bot, rng, STEP)).toBe(true);
  });

  it('is a ladder: the sharper tier reaches fifty sooner, alone', () => {
    const solo = (tier: BotDifficulty): number => {
      let total = 0;
      let reached = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const { state } = playMatch(seed * 7919, tier, null);
        if (state.p1 >= TARGET_POINTS) {
          total += state.clock;
          reached += 1;
        }
      }
      expect(reached).toBeGreaterThan(30);
      return total / reached;
    };
    const easy = solo('easy');
    const normal = solo('normal');
    const hard = solo('hard');
    expect(hard).toBeLessThan(normal);
    expect(normal).toBeLessThan(easy);
  });

  it('is a ladder head to head, in both seat orders', () => {
    const rate = (strong: BotDifficulty, weak: BotDifficulty): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const a = playMatch(seed * 7919, strong, weak).state.winner;
        if (a === 'p1') wins += 1;
        if (a !== null && a !== 'draw') decided += 1;
        const b = playMatch(seed * 7919, weak, strong).state.winner;
        if (b === 'p2') wins += 1;
        if (b !== null && b !== 'draw') decided += 1;
      }
      return wins / decided;
    };
    expect(rate('hard', 'normal')).toBeGreaterThan(0.6);
    expect(rate('normal', 'easy')).toBeGreaterThan(0.7);
    expect(rate('hard', 'easy')).toBeGreaterThan(0.85);
  });

  it('finishes every match two of the weakest tier play, without a frame cap', () => {
    // No ceiling on the loop at all: a match that could not end would hang the suite rather
    // than pass quietly. `easy` against `easy` deliberately — the weakest pairing is the one
    // that finds positions nothing resolves.
    for (let seed = 1; seed <= 40; seed += 1) {
      const { state } = playMatch(seed * 104_729, 'easy', 'easy', { maxSteps: Infinity });
      expect(state.winner).not.toBeNull();
      expect(state.clock).toBeLessThanOrEqual(MATCH_SECONDS + STEP);
    }
  });

  it('is fair between the seats at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      let p1 = 0;
      let decided = 0;
      for (let seed = 1; seed <= 250; seed += 1) {
        const winner = playMatch(seed * 7919, tier, tier).state.winner;
        if (winner === null || winner === 'draw') continue;
        decided += 1;
        if (winner === 'p1') p1 += 1;
      }
      const share = p1 / decided;
      expect(share, `${tier}: seat one took ${(share * 100).toFixed(1)}%`).toBeGreaterThan(0.4);
      expect(share, `${tier}: seat one took ${(share * 100).toFixed(1)}%`).toBeLessThan(0.6);
    }
  });

  it('has a profile for every tier and no knob that is not a human limitation', () => {
    const tiers: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const tier of tiers) {
      const profile = BOT_PROFILES[tier];
      expect(profile.thinkSeconds).toBeGreaterThan(0);
      expect(profile.misreadChance).toBeGreaterThanOrEqual(0);
      expect(profile.misreadChance).toBeLessThan(0.5);
    }
    // Both knobs are strictly ordered, which is what makes the ladder a ladder rather than
    // three spellings of the same opponent.
    expect(BOT_PROFILES.hard.thinkSeconds).toBeLessThan(BOT_PROFILES.normal.thinkSeconds);
    expect(BOT_PROFILES.normal.thinkSeconds).toBeLessThan(BOT_PROFILES.easy.thinkSeconds);
    expect(BOT_PROFILES.hard.misreadChance).toBeLessThan(BOT_PROFILES.normal.misreadChance);
    expect(BOT_PROFILES.normal.misreadChance).toBeLessThan(BOT_PROFILES.easy.misreadChance);
  });

  it('never snaps sooner than its own delay lets it see a reason to', () => {
    // A ball that has only just become live is invisible to a bot until its next look, which
    // is the whole of its reaction time. `hard` looks soonest, so it is the binding case.
    const { state } = fresh(43);
    clearPond(state);
    const bot = createBotState();
    const rng = new Rng(3);
    botStep(state, 'p1', 'hard', bot, rng, STEP);
    expect(bot.nowValue).toBe(0);
    place(state, 'p1', state.p1Hippo.x, POND_BOTTOM - 120);
    let steps = 0;
    while (!botStep(state, 'p1', 'hard', bot, rng, STEP)) {
      steps += 1;
      expect(steps).toBeLessThan(120);
    }
    expect(steps * STEP).toBeGreaterThanOrEqual(BOT_PROFILES.hard.thinkSeconds - STEP * 2);
  });
});

describe('the two seats are the same game', () => {
  it('mirrors a board and gets the mirrored answer', () => {
    // A pond turned half a turn with the colours swapped is the other seat's pond, so the two
    // seats must value it identically. Anything that broke this — a hard-coded bank, a
    // comparison in board coordinates — shows up here.
    const rng = new Rng(61);
    const noMisreads = new Array<boolean>(POND_BALLS).fill(false);
    for (let trial = 0; trial < 40; trial += 1) {
      const state = createState();
      resetState(state, rng);
      const x = HIPPO_MIN_X + rng.float() * (HIPPO_MAX_X - HIPPO_MIN_X);
      expect(chompValue(state, 'p1', x, noMisreads)).toBe(
        chompValue(state, 'p2', BOARD_WIDTH - x, noMisreads),
      );
    }
  });

  it('places the two banks symmetrically about the middle of the pond', () => {
    expect(homeYOf('p1') - (POND_TOP + POND_BOTTOM) / 2).toBe(
      (POND_TOP + POND_BOTTOM) / 2 - homeYOf('p2'),
    );
    expect(mouthYOf('p1', LUNGE_OUT_SECONDS) - (POND_TOP + POND_BOTTOM) / 2).toBe(
      (POND_TOP + POND_BOTTOM) / 2 - mouthYOf('p2', LUNGE_OUT_SECONDS),
    );
    expect(HIPPO_MIN_X + HIPPO_MAX_X).toBe(BOARD_WIDTH);
  });
});
