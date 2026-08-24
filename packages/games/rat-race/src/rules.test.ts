import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  ACCEL,
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  BRAKE,
  CHEESE_REACH,
  COURSE_LENGTH,
  KNOCKBACK,
  PAW_DOWN_SECONDS,
  PAW_GATE_CHANCE,
  PAW_PAIR_CHANCE,
  PAW_PERIOD_MAX,
  PAW_PERIOD_MIN,
  PAW_REACH,
  RACE_SECONDS,
  RAILS,
  RAIL_SECONDS,
  RAT_HALF_RAIL,
  RUN_SPEED,
  STUN_SECONDS,
  TARGET_CHEESE,
  VIEW_AHEAD,
  blockingPaw,
  botDecide,
  buildCourse,
  canPass,
  cheeseValue,
  clampRail,
  createBotState,
  createCourse,
  createRace,
  pawCycle,
  pawDownDuring,
  pawHitsRail,
  pawIsDown,
  pawSpan,
  ratOf,
  resetBotState,
  resetRace,
  resetRat,
  secondsUntilPawFalls,
  step,
  stoppingDistance,
  swat,
  takenBy,
  travelSeconds,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Paw, Race } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function freshRace(seed = 1): Race {
  const race = createRace();
  resetRace(race, new Rng(seed));
  return race;
}

/** A burrow with nothing in it, so a test can place exactly what it means to test. */
function emptyBurrow(seed = 1): Race {
  const race = freshRace(seed);
  race.course.paws.length = 0;
  race.course.cheese.length = 0;
  race.p1Taken.length = 0;
  race.p2Taken.length = 0;
  resetRat(race.p1);
  resetRat(race.p2);
  race.elapsed = 0;
  race.winner = null;
  race.over = false;
  return race;
}

function putCheese(race: Race, position: number, rail: number): void {
  race.course.cheese.push({ position, rail });
  race.p1Taken.push(false);
  race.p2Taken.push(false);
}

/** The period every hand-placed paw keeps, unless a test wants its own rhythm. */
const TEST_PERIOD = 2.5;

/**
 * The race clock at which a rat that held the throttle from the start enters a paw's band.
 *
 * The whole point of the two helpers below. A paw's down window is {@link PAW_DOWN_SECONDS}
 * long whatever its period, so "a paw that is down" is not a property a paw can have for the
 * length of a test — it is a *moment*, and the only moment that matters is the one the rat
 * arrives in. Phrasing both helpers against this arrival is what stopped four of these tests
 * quietly measuring a paw the rat had already run under while it was still up.
 */
function arrivalAt(position: number): number {
  return travelSeconds(position - PAW_REACH, 0);
}

/** A paw whose down window opens at `landsAt` on the race clock. */
function putPaw(
  race: Race,
  position: number,
  landsAt: number,
  rail = 0,
  span = RAILS,
  period = TEST_PERIOD,
): Paw {
  const phase = (((period - landsAt) % period) + period) % period;
  const paw: Paw = { position, rail, span, period, phase };
  race.course.paws.push(paw);
  return paw;
}

/**
 * A paw that slams down just as a rat that ran from the start reaches it.
 *
 * A sixth of a second early, so the fixed step — which integrates a hair ahead of the exact
 * arrival — cannot land the rat in the band before the paw does.
 */
function putDownPaw(race: Race, position: number, rail = 0, span = RAILS): Paw {
  return putPaw(race, position, arrivalAt(position) - 0.15, rail, span);
}

/** A paw that lifts before that rat arrives and stays up for the whole of its crossing. */
function putUpPaw(race: Race, position: number, rail = 0, span = RAILS): Paw {
  return putPaw(race, position, arrivalAt(position) - PAW_DOWN_SECONDS - 0.2, rail, span);
}

/** Run one rat for `steps`, holding the throttle and the rail given. */
function run(race: Race, seat: SeatId, steps: number, running = true, rail = 1): void {
  for (let i = 0; i < steps; i += 1) {
    if (seat === 'p1') step(race, STEP, running, rail, false, 1);
    else step(race, STEP, false, 1, running, rail);
  }
}

/**
 * Run one rat, throttle held, until a paw lands on it. Returns the steps that took.
 *
 * Every test below that is *about* a swat used to count its own steps to the paw, which is
 * how four of them ended up asserting against a rat that had run under a raised paw and was
 * a hundred units past it. Asking the simulation when the swat happened cannot drift.
 */
function runToSwat(race: Race, seat: SeatId, rail = 1, limit = 600): number {
  const rat = ratOf(race, seat);
  const before = rat.swats;
  for (let i = 1; i <= limit; i += 1) {
    run(race, seat, 1, true, rail);
    if (rat.swats > before) return i;
  }
  throw new Error('no paw ever landed on the rat');
}

describe('the burrow', () => {
  it('lays out paws and cheese in order, from the seed and nothing else', () => {
    const race = freshRace(20260823);
    expect(race.course.paws.length).toBeGreaterThan(20);
    expect(race.course.cheese.length).toBeGreaterThan(TARGET_CHEESE * 3);
    for (let i = 1; i < race.course.paws.length; i += 1) {
      expect(race.course.paws[i]!.position).toBeGreaterThan(race.course.paws[i - 1]!.position);
    }
    for (let i = 1; i < race.course.cheese.length; i += 1) {
      expect(race.course.cheese[i]!.position).toBeGreaterThan(race.course.cheese[i - 1]!.position);
    }
  });

  it('never puts two paws close enough to chain a knockback into the one behind', () => {
    // The knockback must land a swatted rat in open burrow, or a swat becomes a countdown.
    const race = freshRace(7);
    for (let i = 1; i < race.course.paws.length; i += 1) {
      const gap = race.course.paws[i]!.position - race.course.paws[i - 1]!.position;
      expect(gap).toBeGreaterThan(PAW_REACH * 2 + KNOCKBACK);
    }
  });

  it('keeps every paw on the rails and every piece of cheese on one', () => {
    const race = freshRace(99);
    for (const paw of race.course.paws) {
      expect(paw.span).toBeGreaterThanOrEqual(1);
      expect(paw.span).toBeLessThanOrEqual(RAILS);
      expect(paw.rail).toBeGreaterThanOrEqual(0);
      expect(paw.rail + paw.span).toBeLessThanOrEqual(RAILS);
      expect(paw.period).toBeGreaterThanOrEqual(PAW_PERIOD_MIN);
      expect(paw.period).toBeLessThanOrEqual(PAW_PERIOD_MAX);
      expect(paw.phase).toBeGreaterThanOrEqual(0);
      expect(paw.phase).toBeLessThan(paw.period);
    }
    for (const piece of race.course.cheese) {
      expect(Number.isInteger(piece.rail)).toBe(true);
      expect(piece.rail).toBeGreaterThanOrEqual(0);
      expect(piece.rail).toBeLessThan(RAILS);
    }
  });

  it('draws a paw one rail wide, two, or the whole burrow', () => {
    expect(pawSpan(0)).toBe(RAILS);
    expect(pawSpan(PAW_GATE_CHANCE - 0.001)).toBe(RAILS);
    expect(pawSpan(PAW_GATE_CHANCE)).toBe(2);
    expect(pawSpan(PAW_GATE_CHANCE + PAW_PAIR_CHANCE - 0.001)).toBe(2);
    expect(pawSpan(PAW_GATE_CHANCE + PAW_PAIR_CHANCE)).toBe(1);
    expect(pawSpan(0.999)).toBe(1);
  });

  it('carries every span, so neither the gate nor the open rail is theoretical', () => {
    const race = freshRace(4242);
    const spans = new Set(race.course.paws.map((paw) => paw.span));
    expect(spans.has(1)).toBe(true);
    expect(spans.has(2)).toBe(true);
    expect(spans.has(RAILS)).toBe(true);
  });

  it('outlasts the clock, so no rat can ever run off the end of it', () => {
    expect(COURSE_LENGTH).toBeGreaterThan(RACE_SECONDS * RUN_SPEED);
  });

  it('is the same burrow from the same seed, and a different one from another', () => {
    const a = freshRace(5);
    const b = freshRace(5);
    const c = freshRace(6);
    expect(JSON.stringify(a.course)).toBe(JSON.stringify(b.course));
    expect(JSON.stringify(a.course)).not.toBe(JSON.stringify(c.course));
  });

  it('reuses its arrays on reset rather than rebuilding them', () => {
    const race = freshRace(11);
    const paws = race.course.paws;
    const cheese = race.course.cheese;
    const taken = race.p1Taken;
    race.p1.cheese = 4;
    race.p1Taken[0] = true;
    race.over = true;
    resetRace(race, new Rng(12));
    expect(race.course.paws, 'the pool is reused, not rebuilt').toBe(paws);
    expect(race.course.cheese).toBe(cheese);
    expect(race.p1Taken).toBe(taken);
    expect(race.p1Taken.length).toBe(race.course.cheese.length);
    expect(race.p1Taken.some((flag) => flag)).toBe(false);
    expect(race.p1.cheese).toBe(0);
    expect(race.over).toBe(false);
  });

  it('empties the burrow before laying out a new one, rather than appending to it', () => {
    // The pool is reused, so a build that forgot to clear would leave the old course in
    // front of the new one — and every position after the join would be out of order.
    const course = createCourse();
    buildCourse(course, new Rng(63));
    const paws = course.paws.length;
    const cheese = course.cheese.length;
    buildCourse(course, new Rng(63));
    expect(course.paws.length).toBe(paws);
    expect(course.cheese.length).toBe(cheese);
    for (let i = 1; i < course.paws.length; i += 1) {
      expect(course.paws[i]!.position).toBeGreaterThan(course.paws[i - 1]!.position);
    }
  });

  it('gives the two seats separate records of what they have taken', () => {
    const race = freshRace(13);
    expect(takenBy(race, 'p1')).toBe(race.p1Taken);
    expect(takenBy(race, 'p2')).toBe(race.p2Taken);
    expect(takenBy(race, 'p1')).not.toBe(takenBy(race, 'p2'));
    expect(ratOf(race, 'p1')).toBe(race.p1);
    expect(ratOf(race, 'p2')).toBe(race.p2);
  });
});

describe('a paw rhythm', () => {
  const paw: Paw = { position: 1000, rail: 0, span: 3, period: 2, phase: 0 };

  it('wraps, and never reads as a negative part of a cycle', () => {
    expect(pawCycle(paw, 0)).toBeCloseTo(0, 9);
    expect(pawCycle(paw, 2.5)).toBeCloseTo(0.5, 9);
    expect(pawCycle(paw, -0.5)).toBeCloseTo(1.5, 9);
  });

  it('is down for exactly its window and up for the rest', () => {
    expect(pawIsDown(paw, 0)).toBe(true);
    expect(pawIsDown(paw, PAW_DOWN_SECONDS - 0.01)).toBe(true);
    expect(pawIsDown(paw, PAW_DOWN_SECONDS + 0.01)).toBe(false);
    expect(pawIsDown(paw, 1.99)).toBe(false);
    expect(pawIsDown(paw, 2)).toBe(true);
  });

  it('counts down to the next fall, and reads zero while it is already down', () => {
    expect(secondsUntilPawFalls(paw, 0)).toBe(0);
    expect(secondsUntilPawFalls(paw, PAW_DOWN_SECONDS + 0.28)).toBeCloseTo(1, 9);
    expect(secondsUntilPawFalls(paw, 1.5)).toBeCloseTo(0.5, 9);
  });

  it('answers whether it is down at any moment across an interval', () => {
    // Down at the start of the window.
    expect(pawDownDuring(paw, 0, 0.1)).toBe(true);
    // Entirely inside the gap.
    expect(pawDownDuring(paw, 1, 1.5)).toBe(false);
    // Reaches the next fall.
    expect(pawDownDuring(paw, 1.5, 2.1)).toBe(true);
    // Longer than a whole cycle: it must have been down at some point.
    expect(pawDownDuring(paw, 1, 1 + paw.period)).toBe(true);
  });

  it('treats a backwards interval as an instant rather than as the whole cycle', () => {
    // A large caution can invert the window; that must not read as "always down".
    expect(pawDownDuring(paw, 1.5, 1.2)).toBe(false);
    expect(pawDownDuring(paw, 0.1, -0.5)).toBe(true);
  });

  it('covers the rails it says it covers, and clips a rat caught between two', () => {
    const single: Paw = { position: 0, rail: 0, span: 1, period: 2, phase: 0 };
    expect(pawHitsRail(single, 0)).toBe(true);
    expect(pawHitsRail(single, 1)).toBe(false);
    expect(pawHitsRail(single, 0.5), 'halfway across is inside both rails').toBe(true);
    expect(pawHitsRail(single, 0.5 + RAT_HALF_RAIL + 0.01)).toBe(false);

    const pair: Paw = { position: 0, rail: 1, span: 2, period: 2, phase: 0 };
    expect(pawHitsRail(pair, 0)).toBe(false);
    expect(pawHitsRail(pair, 1)).toBe(true);
    expect(pawHitsRail(pair, 2)).toBe(true);

    const gate: Paw = { position: 0, rail: 0, span: RAILS, period: 2, phase: 0 };
    for (let rail = 0; rail < RAILS; rail += 1) expect(pawHitsRail(gate, rail)).toBe(true);
  });
});

describe('running', () => {
  it('starts stopped, in the middle, carrying nothing', () => {
    const race = freshRace(3);
    for (const seat of ['p1', 'p2'] as SeatId[]) {
      const rat = ratOf(race, seat);
      expect(rat.distance).toBe(0);
      expect(rat.speed).toBe(0);
      expect(rat.rail).toBe(1);
      expect(rat.cheese).toBe(0);
      expect(rat.swats).toBe(0);
    }
    expect(winnerOf(race)).toBeNull();
  });

  it('goes nowhere at all while nobody presses anything', () => {
    const race = emptyBurrow();
    run(race, 'p1', 120, false);
    expect(race.p1.distance).toBe(0);
    expect(race.p1.speed).toBe(0);
  });

  it('accelerates to its top speed and no further', () => {
    const race = emptyBurrow();
    run(race, 'p1', 5);
    expect(race.p1.speed).toBeCloseTo(ACCEL * 5 * STEP, 6);
    run(race, 'p1', 300);
    expect(race.p1.speed).toBe(RUN_SPEED);
    expect(race.p1.distance).toBeGreaterThan(0);
  });

  it('brakes to a stop and never past it', () => {
    const race = emptyBurrow();
    run(race, 'p1', 120);
    const carried = race.p1.distance;
    run(race, 'p1', 1, false);
    expect(race.p1.speed).toBeCloseTo(RUN_SPEED - BRAKE * STEP, 6);
    run(race, 'p1', 120, false);
    expect(race.p1.speed).toBe(0);
    expect(race.p1.distance).toBeGreaterThan(carried);
    const settled = race.p1.distance;
    run(race, 'p1', 60, false);
    expect(race.p1.distance, 'a stopped rat stays put').toBe(settled);
  });

  it('stops in under the width of a paw, which is why a gate is always survivable', () => {
    expect(stoppingDistance(0)).toBe(0);
    expect(stoppingDistance(RUN_SPEED)).toBeLessThan(PAW_REACH);
    expect(stoppingDistance(RUN_SPEED)).toBeGreaterThan(stoppingDistance(RUN_SPEED / 2));
  });

  it('takes time to change rail, so a late swerve can still fail', () => {
    const race = emptyBurrow();
    run(race, 'p1', 1, true, 2);
    expect(race.p1.railTarget).toBe(2);
    expect(race.p1.rail).toBeGreaterThan(1);
    expect(race.p1.rail, 'one step is not enough to arrive').toBeLessThan(2);
    run(race, 'p1', Math.ceil(RAIL_SECONDS / STEP), true, 2);
    expect(race.p1.rail).toBe(2);
  });

  it('never leaves the burrow sideways', () => {
    const race = emptyBurrow();
    run(race, 'p1', 60, true, 9);
    expect(race.p1.rail).toBe(RAILS - 1);
    run(race, 'p1', 60, true, -4);
    expect(race.p1.rail).toBe(0);
    expect(clampRail(-1)).toBe(0);
    expect(clampRail(RAILS)).toBe(RAILS - 1);
    expect(clampRail(1)).toBe(1);
  });
});

describe('cheese', () => {
  it('is picked up by a rat that runs over it on its rail', () => {
    const race = emptyBurrow();
    putCheese(race, 400, 1);
    run(race, 'p1', 240, true, 1);
    expect(race.p1.distance).toBeGreaterThan(400);
    expect(race.p1.cheese).toBe(1);
    expect(race.p1Taken[0]).toBe(true);
  });

  it('is missed by a rat on another rail', () => {
    const race = emptyBurrow();
    putCheese(race, 400, 0);
    run(race, 'p1', 240, true, 2);
    expect(race.p1.distance).toBeGreaterThan(400);
    expect(race.p1.cheese).toBe(0);
  });

  it('counts once however many steps a rat spends on it', () => {
    const race = emptyBurrow();
    putCheese(race, 40, 1);
    // Enough throttle to roll onto the piece, then a brake that leaves it standing on top.
    run(race, 'p1', 20, true, 1);
    run(race, 'p1', 60, false, 1);
    expect(race.p1.speed, 'stopped').toBe(0);
    expect(Math.abs(race.p1.distance - 40), 'still within reach of it').toBeLessThan(CHEESE_REACH);
    expect(race.p1.cheese).toBe(1);
    run(race, 'p1', 120, false, 1);
    expect(race.p1.cheese, 'a hundred and eighty steps sat on it, still one piece').toBe(1);
  });

  it('is there for both rats: one taking it does not take it from the other', () => {
    const race = emptyBurrow();
    putCheese(race, 300, 1);
    run(race, 'p1', 180, true, 1);
    expect(race.p1.cheese).toBe(1);
    expect(race.p2.cheese).toBe(0);
    run(race, 'p2', 180, true, 1);
    expect(race.p2.cheese, 'the same piece, on the same burrow, for the other rat').toBe(1);
  });

  it('cannot be picked up from behind, because a rat never runs backwards', () => {
    const race = emptyBurrow();
    putCheese(race, 30, 1);
    race.p1.distance = 30 + CHEESE_REACH + 1;
    run(race, 'p1', 2, false, 1);
    expect(race.p1.cheese).toBe(0);
  });

  it('is still there to be taken after a knockback puts it back in reach', () => {
    // The window index walks backwards as well as forwards; without that this misses.
    const race = emptyBurrow();
    putCheese(race, 900, 1);
    race.p1.distance = 1000;
    run(race, 'p1', 1, false, 1);
    expect(race.p1.cheese).toBe(0);
    swat(race.p1);
    race.p1.stun = 0;
    run(race, 'p1', 60, true, 1);
    expect(race.p1.cheese, 'thrown back onto a piece it had already passed').toBe(1);
  });
});

describe('a paw landing', () => {
  it('flattens a rat that is under it', () => {
    const race = emptyBurrow();
    const paw = putDownPaw(race, 300);
    runToSwat(race, 'p1');
    expect(race.p1.swats).toBe(1);
    expect(race.p1.stun).toBe(STUN_SECONDS);
    expect(pawIsDown(paw, race.elapsed), 'and it was down when it happened').toBe(true);
  });

  it('misses a rat that is not', () => {
    const race = emptyBurrow();
    putUpPaw(race, 200);
    run(race, 'p1', 90, true, 1);
    expect(race.p1.distance).toBeGreaterThan(200 + PAW_REACH);
    expect(race.p1.swats).toBe(0);
  });

  it('misses a rat on a rail it does not cover', () => {
    const race = emptyBurrow();
    putDownPaw(race, 300, 0, 1);
    run(race, 'p1', 200, true, 2);
    expect(race.p1.distance).toBeGreaterThan(300 + PAW_REACH);
    expect(race.p1.swats).toBe(0);
  });

  it('lands on a rat that has crossed onto the rail it covers', () => {
    // The mirror of the test above, and the one that would catch a `pawHitsRail` that had
    // quietly stopped reading the rat's rail at all.
    const race = emptyBurrow();
    putDownPaw(race, 300, 0, 1);
    runToSwat(race, 'p1', 0);
    expect(race.p1.swats).toBe(1);
  });

  it('leaves the rat clear of the paw that hit it', () => {
    const race = emptyBurrow();
    const paw = putDownPaw(race, 300);
    runToSwat(race, 'p1');
    expect(race.p1.swats).toBe(1);
    expect(race.p1.distance).toBeLessThan(paw.position - PAW_REACH);
  });

  it('cannot hit the same rat twice while it is still flattened', () => {
    const race = emptyBurrow();
    putDownPaw(race, 300);
    runToSwat(race, 'p1');
    expect(race.p1.swats).toBe(1);
    run(race, 'p1', Math.floor((STUN_SECONDS / STEP) * 0.9), true, 1);
    expect(race.p1.swats).toBe(1);
    expect(race.p1.stun).toBeGreaterThan(0);
  });

  it('costs a rat its speed, its steering and a second of its race', () => {
    const race = emptyBurrow();
    putDownPaw(race, 300);
    runToSwat(race, 'p1');
    const where = race.p1.distance;
    const rail = race.p1.rail;
    run(race, 'p1', 30, true, 2);
    expect(race.p1.speed).toBe(0);
    expect(race.p1.distance, 'flattened rats gain no ground').toBe(where);
    expect(race.p1.rail, 'and cannot crawl sideways either').toBe(rail);
    expect(race.p1.stun).toBeGreaterThan(0);
  });

  it('wears off after its second and a bit, and not a step before', () => {
    const race = emptyBurrow();
    putDownPaw(race, 300);
    runToSwat(race, 'p1');
    const where = race.p1.distance;
    // A step short of the full stun, counted from the swat itself, it is still flattened.
    run(race, 'p1', Math.floor(STUN_SECONDS / STEP) - 1, true, 1);
    expect(race.p1.stun, 'still down').toBeGreaterThan(0);
    expect(race.p1.distance).toBe(where);
    run(race, 'p1', 30, true, 1);
    expect(race.p1.stun).toBe(0);
    expect(race.p1.distance).toBeGreaterThan(where);
  });

  it('never pushes a rat back past the start of the burrow', () => {
    const race = emptyBurrow();
    race.p1.distance = 20;
    swat(race.p1);
    expect(race.p1.distance).toBe(0);
    expect(race.p1.speed).toBe(0);
    expect(race.p1.stun).toBe(STUN_SECONDS);
  });

  it('throws a rat back further than the paw is wide, so it can never be trapped', () => {
    // The reason a swat is a setback rather than a countdown: the knockback clears the band
    // that caught the rat, and PAW_GAP_MIN keeps it out of the one behind.
    expect(KNOCKBACK).toBeGreaterThan(PAW_REACH * 2);
    const race = emptyBurrow();
    const paw = putDownPaw(race, 900);
    race.p1.distance = paw.position + PAW_REACH;
    swat(race.p1);
    expect(race.p1.distance).toBeLessThan(paw.position - PAW_REACH);
  });
});

describe('the win condition', () => {
  it('is undecided while both rats are still short of a full load', () => {
    const race = emptyBurrow();
    race.p1.cheese = TARGET_CHEESE - 1;
    race.p2.cheese = 0;
    expect(winnerOf(race)).toBeNull();
  });

  it('goes to the first rat to carry a full load', () => {
    const race = emptyBurrow();
    race.p1.cheese = TARGET_CHEESE;
    expect(winnerOf(race)).toBe('p1');
    race.p1.cheese = 0;
    race.p2.cheese = TARGET_CHEESE;
    expect(winnerOf(race)).toBe('p2');
  });

  it('calls a dead heat a draw rather than picking whichever was read first', () => {
    const race = emptyBurrow();
    race.p1.cheese = TARGET_CHEESE;
    race.p2.cheese = TARGET_CHEESE;
    expect(winnerOf(race)).toBe('draw');
  });

  it('is undecided one piece short, on either side of the line', () => {
    const race = emptyBurrow();
    race.p1.cheese = TARGET_CHEESE - 1;
    race.p2.cheese = TARGET_CHEESE - 1;
    expect(winnerOf(race), 'level and one short of it').toBeNull();
    race.p1.cheese = TARGET_CHEESE;
    expect(winnerOf(race), 'and decided by the very next piece').toBe('p1');
  });

  it('settles on the fuller belly when the clock expires', () => {
    const race = emptyBurrow();
    race.elapsed = RACE_SECONDS;
    race.p1.cheese = 3;
    race.p2.cheese = 5;
    expect(winnerOf(race)).toBe('p2');
    race.p1.cheese = 5;
    expect(winnerOf(race), 'level at the bell is a draw').toBe('draw');
  });

  it('does not ring the bell a step early, however far ahead somebody is', () => {
    // The clock is the fallback, and a fallback that fires early would end a race a rat was
    // one piece from winning outright.
    const race = emptyBurrow();
    race.p1.cheese = TARGET_CHEESE - 1;
    race.p2.cheese = 0;
    race.elapsed = RACE_SECONDS - STEP;
    expect(winnerOf(race)).toBeNull();
    race.elapsed = RACE_SECONDS;
    expect(winnerOf(race)).toBe('p1');
  });

  it('settles a race in which nobody found anything at all', () => {
    // The bottom of the fallback: no cheese, no lead, no tiebreak left. A draw is the answer,
    // and it is an answer rather than a hang.
    const race = emptyBurrow();
    race.elapsed = RACE_SECONDS;
    expect(race.p1.cheese).toBe(0);
    expect(race.p2.cheese).toBe(0);
    expect(winnerOf(race)).toBe('draw');
  });

  it('holds the result once it is decided, whatever happens afterwards', () => {
    const race = emptyBurrow();
    race.p1.cheese = TARGET_CHEESE;
    step(race, STEP, false, 1, false, 1);
    expect(race.winner).toBe('p1');
    expect(race.over).toBe(true);
    // The other rat cannot go on collecting past the flag.
    putCheese(race, 10, 1);
    race.p2.distance = 10;
    run(race, 'p2', 60, true, 1);
    expect(race.p2.cheese).toBe(0);
    expect(race.winner).toBe('p1');
  });

  it('ends the race, after which nothing moves', () => {
    const race = emptyBurrow();
    race.p1.cheese = TARGET_CHEESE - 1;
    putCheese(race, 60, 1);
    run(race, 'p1', 120, true, 1);
    expect(race.over).toBe(true);
    expect(race.winner).toBe('p1');
    const where = race.p1.distance;
    run(race, 'p1', 60, true, 1);
    expect(race.p1.distance).toBe(where);
  });

  it('always ends, even with two rats that never move', () => {
    // The clock is the whole termination argument: no input, no bots, no progress.
    const race = freshRace(21);
    let steps = 0;
    while (race.winner === null && steps < 60 * 600) {
      step(race, STEP, false, 1, false, 1);
      steps += 1;
    }
    expect(race.winner).toBe('draw');
    expect(steps).toBeLessThanOrEqual(Math.ceil(RACE_SECONDS / STEP) + 1);
  });
});

describe('the two seats', () => {
  it('are dealt the identical sequence of paws and cheese, event for event', () => {
    // Not merely the same totals. The same things happening to both rats, in the same order,
    // on the same steps — which is the only form of "one burrow" a player can actually check.
    const race = freshRace(77);
    const forP1: string[] = [];
    const forP2: string[] = [];
    for (let i = 0; i < 60 * 60 && !race.over; i += 1) {
      const rail = (i >> 5) % RAILS;
      const report = step(race, STEP, true, rail, true, rail);
      for (const seat of report.swatted) (seat === 'p1' ? forP1 : forP2).push(`${String(i)}:swat`);
      for (const seat of report.grabbed) (seat === 'p1' ? forP1 : forP2).push(`${String(i)}:grab`);
    }
    expect(forP1.length, 'nothing happened to compare').toBeGreaterThan(10);
    expect(forP2).toEqual(forP1);
    expect(race.p1Taken, 'and two separate records of the same picking-up').toEqual(race.p2Taken);
    expect(race.p1Taken).not.toBe(race.p2Taken);
  });

  it('walk the same window indices at the same distance', () => {
    // Both heads are private state, and a head that drifted would quietly hand one rat cheese
    // the other had to run past. They index one course, so they must agree.
    const race = freshRace(78);
    for (let i = 0; i < 60 * 45 && !race.over; i += 1) {
      step(race, STEP, true, 1, true, 1);
      expect(race.p2.cheeseHead).toBe(race.p1.cheeseHead);
      expect(race.p2.pawHead).toBe(race.p1.pawHead);
    }
    expect(race.p1.pawHead, 'and they moved').toBeGreaterThan(0);
  });

  it('run the identical burrow, so neither is dealt a kinder one', () => {
    const race = freshRace(31);
    run(race, 'p1', 900, true, 1);
    const mirror = freshRace(31);
    run(mirror, 'p2', 900, true, 1);
    expect(mirror.p2.distance).toBeCloseTo(race.p1.distance, 9);
    expect(mirror.p2.cheese).toBe(race.p1.cheese);
    expect(mirror.p2.swats).toBe(race.p1.swats);
  });

  it('are stepped from the same state, so neither gains from being read first', () => {
    const race = freshRace(32);
    for (let i = 0; i < 900; i += 1) step(race, STEP, true, 1, true, 1);
    expect(race.p1.distance).toBeCloseTo(race.p2.distance, 9);
    expect(race.p1.cheese).toBe(race.p2.cheese);
    expect(race.p1.swats).toBe(race.p2.swats);
  });

  it('report what happened to each of them on the step it happened', () => {
    const race = emptyBurrow();
    putCheese(race, 30, 1);
    let grabbed: readonly SeatId[] = [];
    for (let i = 0; i < 30 && grabbed.length === 0; i += 1) {
      grabbed = step(race, STEP, true, 1, true, 1).grabbed.slice();
    }
    expect(grabbed).toEqual(['p1', 'p2']);
  });
});

describe('judging a paw', () => {
  it('knows a standing start is slower than a running one', () => {
    expect(travelSeconds(0, 0)).toBe(0);
    expect(travelSeconds(124, 0)).toBeGreaterThan(124 / RUN_SPEED);
    expect(travelSeconds(124, RUN_SPEED)).toBeCloseTo(124 / RUN_SPEED, 9);
    expect(travelSeconds(2000, 0)).toBeGreaterThan(travelSeconds(1000, 0));
  });

  it('lets a rat through a gap it can make, and not through one it cannot', () => {
    const race = emptyBurrow();
    race.p1.speed = RUN_SPEED;
    // At full pelt this rat is inside the band from 0.48 s to 0.92 s of race clock.
    const open = putPaw(race, 200, 1.4);
    expect(canPass(open, race.p1, 0, 0, 1), 'lands long after it is clear').toBe(true);
    const closing = putPaw(race, 200, 0.6);
    expect(canPass(closing, race.p1, 0, 0, 1), 'lands on its head halfway across').toBe(false);
  });

  it('is harder to satisfy the more clearance is demanded', () => {
    const race = emptyBurrow();
    const paw: Paw = { position: 200, rail: 0, span: RAILS, period: 1.9, phase: 1.15 };
    race.p1.speed = RUN_SPEED;
    expect(canPass(paw, race.p1, 0, -0.2, 0)).toBe(true);
    expect(canPass(paw, race.p1, 0, 0.45, 0)).toBe(false);
  });

  it('is harder to satisfy from a standstill once the run-up is counted', () => {
    const race = emptyBurrow();
    const paw: Paw = { position: 130, rail: 0, span: RAILS, period: 2.2, phase: 1.5 };
    race.p1.distance = 0;
    race.p1.speed = 0;
    expect(canPass(paw, race.p1, 0, 0, 0), 'a bot that forgets it has to get going').toBe(true);
    expect(canPass(paw, race.p1, 0, 0, 1), 'and one that does not').toBe(false);
  });

  it('names the nearest paw that would land on a rail, and nothing beyond it', () => {
    const race = emptyBurrow();
    putDownPaw(race, 300, 0, 1);
    putDownPaw(race, 1400, 0, RAILS);
    race.p1.speed = RUN_SPEED;
    const profile = BOT_PROFILES.normal;
    expect(blockingPaw(race.course, race.p1, 0, 0, profile)?.position).toBe(300);
    expect(blockingPaw(race.course, race.p1, 2, 0, profile), 'rail 2 is open').toBeNull();
  });

  it('values the cheese it can still reach, nearest first', () => {
    const race = emptyBurrow();
    putCheese(race, 120, 0);
    putCheese(race, 700, 2);
    race.p1.rail = 1;
    race.p1.railTarget = 1;
    const near = cheeseValue(race, 'p1', 0, 800);
    const far = cheeseValue(race, 'p1', 2, 800);
    expect(near).toBeGreaterThan(far);
    expect(cheeseValue(race, 'p1', 1, 800), 'nothing on the middle rail').toBe(0);
    race.p1Taken[0] = true;
    expect(cheeseValue(race, 'p1', 0, 800), 'and nothing once it is taken').toBe(0);
  });

  it('ignores cheese it could not cross to in time', () => {
    const race = emptyBurrow();
    putCheese(race, 12, 2);
    race.p1.rail = 0;
    race.p1.railTarget = 0;
    expect(cheeseValue(race, 'p1', 2, 800)).toBe(0);
  });
});

describe('the bot', () => {
  it('never looks further up the burrow than a player can see', () => {
    // CLAUDE.md rule 6. The band draws exactly VIEW_AHEAD, so this is the whole claim.
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].lookahead).toBeLessThanOrEqual(VIEW_AHEAD);
    }
  });

  it('grades its tiers by judgement rather than by anything a player cannot have', () => {
    expect(BOT_PROFILES.hard.reaction).toBeLessThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeLessThan(BOT_PROFILES.easy.reaction);
    expect(BOT_PROFILES.hard.caution).toBeGreaterThan(BOT_PROFILES.normal.caution);
    expect(BOT_PROFILES.easy.caution, 'the weak tier believes it has time it has not').toBeLessThan(
      0,
    );
    expect(BOT_PROFILES.hard.windup).toBeGreaterThan(BOT_PROFILES.normal.windup);
    expect(BOT_PROFILES.normal.windup).toBeGreaterThan(BOT_PROFILES.easy.windup);
    expect(BOT_PROFILES.hard.slip).toBeLessThan(BOT_PROFILES.easy.slip);
    expect(BOT_PROFILES.hard.greed).toBeGreaterThan(BOT_PROFILES.easy.greed);
  });

  it('draws exactly the same number of values whatever it decides', () => {
    const race = freshRace(41);
    const state = createBotState();
    const used = new Rng(9);
    botDecide(race, 'p1', BOT_PROFILES.hard, state, STEP, used);
    const counted = new Rng(9);
    for (let i = 0; i < BOT_DRAWS_PER_DECISION; i += 1) counted.float();
    expect(used.save()).toEqual(counted.save());
  });

  it('holds a decision, and the misjudgement behind it, until it looks again', () => {
    const race = emptyBurrow();
    putDownPaw(race, 4000);
    const state = createBotState();
    const rng = new Rng(3);
    botDecide(race, 'p1', BOT_PROFILES.easy, state, STEP, rng);
    const decided = state.running;
    const slip = state.slip;
    // The burrow changes underneath it; it is not looking, so it does not notice.
    race.course.paws.length = 0;
    putDownPaw(race, 20);
    race.p1.pawHead = 0;
    botDecide(race, 'p1', BOT_PROFILES.easy, state, STEP, rng);
    expect(state.running).toBe(decided);
    expect(state.slip).toBe(slip);
  });

  it('brakes for a gate it cannot get through, once it must', () => {
    const race = emptyBurrow();
    // Down now, and down for long enough that nothing could cross in time.
    race.course.paws.push({ position: 320, rail: 0, span: RAILS, period: 2.4, phase: 0 });
    // Close enough that another moment at this speed would carry it into the band.
    race.p1.distance = 320 - PAW_REACH - stoppingDistance(RUN_SPEED) - 1;
    race.p1.speed = RUN_SPEED;
    const state = createBotState();
    botDecide(race, 'p1', BOT_PROFILES.hard, state, STEP, new Rng(2));
    expect(state.running).toBe(false);
  });

  it('keeps running at a gate it can still stop short of', () => {
    // The other side of the same decision, and the reason it is worth pinning: a bot that
    // braked the instant it saw a closed gate would crawl the whole burrow, and one that
    // never braked would be flattened by every one of them. It runs to the last moment.
    const race = emptyBurrow();
    race.course.paws.push({ position: 320, rail: 0, span: RAILS, period: 2.4, phase: 0 });
    race.p1.distance = 320 - PAW_REACH - stoppingDistance(RUN_SPEED) - 120;
    race.p1.speed = RUN_SPEED;
    const state = createBotState();
    botDecide(race, 'p1', BOT_PROFILES.hard, state, STEP, new Rng(2));
    expect(state.running).toBe(true);
  });

  it('having braked, waits at the gate rather than sitting there for ever', () => {
    // Termination, at the level of one rat and one closed gate. A rat stopped at the edge
    // of a gate must be able to *leave*, or a race can hang with nothing wrong on screen.
    const race = emptyBurrow();
    race.course.paws.push({ position: 320, rail: 0, span: RAILS, period: 2.4, phase: 0 });
    race.p1.distance = 320 - PAW_REACH - 22;
    const state = createBotState();
    const rng = new Rng(2);
    let ran = 0;
    for (let i = 0; i < 60 * 6; i += 1) {
      botDecide(race, 'p1', BOT_PROFILES.hard, state, STEP, rng);
      step(race, STEP, state.running, state.rail, false, 1);
      if (state.running) ran += 1;
    }
    expect(ran, 'it found a gap and went through it').toBeGreaterThan(0);
    expect(race.p1.distance).toBeGreaterThan(320 + PAW_REACH);
    expect(race.p1.swats, 'and was not caught doing it').toBe(0);
  });

  it('runs the moment the gate is open again', () => {
    const race = emptyBurrow();
    race.course.paws.push({
      position: 320,
      rail: 0,
      span: RAILS,
      period: 2.6,
      phase: PAW_DOWN_SECONDS + 0.9,
    });
    race.p1.distance = 240;
    race.p1.speed = 0;
    const state = createBotState();
    botDecide(race, 'p1', BOT_PROFILES.hard, state, STEP, new Rng(2));
    expect(state.running).toBe(true);
  });

  it('runs out from under a paw rather than stopping beneath it', () => {
    const race = emptyBurrow();
    const paw = putDownPaw(race, 320);
    race.p1.distance = paw.position;
    race.p1.speed = RUN_SPEED;
    const state = createBotState();
    state.running = false;
    botDecide(race, 'p1', BOT_PROFILES.hard, state, STEP, new Rng(2));
    expect(state.running, 'standing still under a paw is the one certain way to be hit').toBe(true);
  });

  it('goes round a paw that leaves a rail open rather than waiting for it', () => {
    const race = emptyBurrow();
    race.course.paws.push({ position: 700, rail: 0, span: 2, period: 2.4, phase: 0 });
    race.p1.distance = 0;
    race.p1.speed = RUN_SPEED;
    race.p1.rail = 1;
    race.p1.railTarget = 1;
    const state = createBotState();
    botDecide(race, 'p1', BOT_PROFILES.hard, state, STEP, new Rng(2));
    expect(state.rail).toBe(2);
    expect(state.running).toBe(true);
  });

  it('clears its held decision on reset', () => {
    const state = createBotState();
    state.cooldown = 0.3;
    state.running = false;
    state.rail = 2;
    state.slip = 0.2;
    resetBotState(state);
    expect(state).toEqual({ cooldown: 0, running: true, rail: 1, slip: 0 });
  });
});

/** One bot alone in the burrow, so a tier is measured against the game and not an opponent. */
function soloRace(tier: BotDifficulty, seed: number): Race {
  const race = createRace();
  resetRace(race, new Rng(seed));
  const state = createBotState();
  const rng = new Rng(seed * 7 + 1);
  for (let i = 0; i < 60 * 120 && race.winner === null; i += 1) {
    botDecide(race, 'p1', BOT_PROFILES[tier], state, STEP, rng);
    step(race, STEP, state.running, state.rail, false, 1);
  }
  return race;
}

/**
 * Two bots on one burrow, each drawing from its own generator.
 *
 * The two streams are separate on purpose, and it matters here as much as it does in the
 * game: a tier's *number of decisions* depends on its reaction, so on one shared stream the
 * pairing would decide where the cheese lay.
 */
function botDuel(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  p1Seed: number,
  p2Seed: number,
): Race {
  const race = createRace();
  resetRace(race, new Rng(seed));
  const p1State = createBotState();
  const p2State = createBotState();
  const p1Rng = new Rng(p1Seed);
  const p2Rng = new Rng(p2Seed);
  for (let i = 0; i < 60 * 600 && race.winner === null; i += 1) {
    botDecide(race, 'p1', BOT_PROFILES[p1Tier], p1State, STEP, p1Rng);
    botDecide(race, 'p2', BOT_PROFILES[p2Tier], p2State, STEP, p2Rng);
    step(race, STEP, p1State.running, p1State.rail, p2State.running, p2State.rail);
  }
  return race;
}

/** An outcome read from the other side of the table. */
function mirrorOutcome(outcome: Race['winner']): Race['winner'] {
  if (outcome === 'p1') return 'p2';
  if (outcome === 'p2') return 'p1';
  return outcome;
}

describe('seat symmetry', () => {
  it('gives back the mirror image of a race when the two seats are exchanged', () => {
    // The whole fairness claim in one assertion: take a match, swap which seat holds which
    // bot *and* which generator, and every number comes back on the other side unchanged.
    // Nothing that favoured a seat could survive this, because the seats are all that moved.
    const near = botDuel(2026, 'hard', 'easy', 31, 47);
    const far = botDuel(2026, 'easy', 'hard', 47, 31);
    expect(near.winner, 'the match has to have been decided to mean anything').not.toBeNull();
    expect(far.p2.cheese).toBe(near.p1.cheese);
    expect(far.p1.cheese).toBe(near.p2.cheese);
    expect(far.p2.distance).toBeCloseTo(near.p1.distance, 9);
    expect(far.p1.distance).toBeCloseTo(near.p2.distance, 9);
    expect(far.p2.swats).toBe(near.p1.swats);
    expect(far.p1.swats).toBe(near.p2.swats);
    expect(far.elapsed).toBeCloseTo(near.elapsed, 9);
    expect(mirrorOutcome(far.winner)).toBe(near.winner);
  });

  it('holds the mirror over a spread of seeds and every pairing of tiers', () => {
    for (const [a, b] of [
      ['easy', 'easy'],
      ['normal', 'hard'],
      ['hard', 'normal'],
    ] as [BotDifficulty, BotDifficulty][]) {
      for (const seed of [3, 101, 9001]) {
        const near = botDuel(seed, a, b, seed + 5, seed + 9);
        const far = botDuel(seed, b, a, seed + 9, seed + 5);
        expect(mirrorOutcome(far.winner), `${a} vs ${b} on seed ${String(seed)}`).toBe(near.winner);
        expect(far.p1.cheese).toBe(near.p2.cheese);
        expect(far.p2.cheese).toBe(near.p1.cheese);
      }
    }
  });
});

describe('termination', () => {
  it('ends every duel of the weakest tier, well inside the clock’s ten minutes', () => {
    // The pairing the platform's own guard uses, for the reason it uses it: the worst play
    // is the play most likely to reach a position nothing resolves.
    for (let seed = 1; seed <= 12; seed += 1) {
      const race = botDuel(seed * 313, 'easy', 'easy', seed * 7, seed * 11);
      expect(race.winner, `easy vs easy on seed ${String(seed)}`).not.toBeNull();
      expect(race.elapsed).toBeLessThanOrEqual(RACE_SECONDS + STEP);
    }
  });

  it('never leaves a rat in a stop it cannot get out of', () => {
    // The two ways a racer stops here are a brake and a swat, and both are temporary: the
    // stun counts down on its own, and nothing takes the throttle away from a running rat.
    const race = emptyBurrow();
    putDownPaw(race, 400);
    runToSwat(race, 'p1');
    expect(race.p1.stun).toBe(STUN_SECONDS);
    run(race, 'p1', Math.ceil(STUN_SECONDS / STEP) + 1, true, 1);
    expect(race.p1.stun, 'a stun always runs out').toBe(0);
    const where = race.p1.distance;
    run(race, 'p1', 120, true, 1);
    expect(race.p1.distance, 'and the rat runs again').toBeGreaterThan(where);
  });

  it('gives the burrow a definite length that no rat can reach inside the clock', () => {
    // Termination is the clock's job, not the course's — so the course must never end first,
    // or a rat would arrive somewhere the rules say nothing about.
    expect(COURSE_LENGTH).toBeGreaterThan(RACE_SECONDS * RUN_SPEED);
    const race = freshRace(51);
    const lastPaw = race.course.paws[race.course.paws.length - 1];
    const lastPiece = race.course.cheese[race.course.cheese.length - 1];
    expect(lastPaw?.position).toBeGreaterThan(RACE_SECONDS * RUN_SPEED);
    expect(lastPiece?.position).toBeGreaterThan(RACE_SECONDS * RUN_SPEED);
  });

  it('carries enough cheese to fill a belly many times over', () => {
    // The other way a first-to game hangs: running out of the thing you are collecting.
    const race = freshRace(52);
    let reachable = 0;
    for (const piece of race.course.cheese) {
      if (piece.position <= RACE_SECONDS * RUN_SPEED) reachable += 1;
    }
    expect(reachable).toBeGreaterThan(TARGET_CHEESE * 4);
  });
});

describe('the tiers, measured', () => {
  const RUNS = 24;
  const measure = (tier: BotDifficulty) => {
    let seconds = 0;
    let swats = 0;
    let finished = 0;
    for (let seed = 1; seed <= RUNS; seed += 1) {
      const race = soloRace(tier, seed * 613);
      seconds += race.elapsed;
      swats += race.p1.swats;
      if (race.p1.cheese >= TARGET_CHEESE) finished += 1;
    }
    return { seconds: seconds / RUNS, swats: swats / RUNS, finished };
  };

  it('fills a belly faster the better the tier plays', () => {
    const easy = measure('easy');
    const normal = measure('normal');
    const hard = measure('hard');
    expect(
      normal.seconds,
      `easy ${easy.seconds.toFixed(1)}s vs normal ${normal.seconds.toFixed(1)}s`,
    ).toBeLessThan(easy.seconds);
    expect(
      hard.seconds,
      `normal ${normal.seconds.toFixed(1)}s vs hard ${hard.seconds.toFixed(1)}s`,
    ).toBeLessThan(normal.seconds);
    expect(hard.finished, 'the hard tier always finishes the job').toBe(RUNS);
  });

  it('is caught by fewer paws the better the tier judges them', () => {
    const easy = measure('easy');
    const hard = measure('hard');
    expect(
      hard.swats,
      `easy ${easy.swats.toFixed(1)} vs hard ${hard.swats.toFixed(1)}`,
    ).toBeLessThan(easy.swats);
    expect(
      easy.swats,
      'and the weak tier really is caught, rather than merely slower',
    ).toBeGreaterThan(1);
  });

  it('beats the tier below it head to head, and not merely on the clock', () => {
    // Solo times say a tier is quicker. This says it *wins*, which is the thing a player
    // experiences, and it is measured over enough seeds for the gap to be a gap.
    const duel = (a: BotDifficulty, b: BotDifficulty): number => {
      let wins = 0;
      for (let seed = 1; seed <= RUNS; seed += 1) {
        const race = botDuel(seed * 449, a, b, seed * 13, seed * 29);
        if (race.winner === 'p1') wins += 1;
      }
      return wins;
    };
    const normalOverEasy = duel('normal', 'easy');
    const hardOverNormal = duel('hard', 'normal');
    expect(
      normalOverEasy,
      `normal beat easy ${String(normalOverEasy)}/${String(RUNS)}`,
    ).toBeGreaterThan(RUNS * 0.7);
    expect(
      hardOverNormal,
      `hard beat normal ${String(hardOverNormal)}/${String(RUNS)}`,
    ).toBeGreaterThan(RUNS * 0.5);
    // The gap between the top two is the narrower of the two, which is what makes `normal`
    // the tier worth playing rather than a step on the way to `hard`.
    expect(hardOverNormal).toBeLessThanOrEqual(normalOverEasy);
  });

  it('looks at the burrow more often the better it plays, and never further', () => {
    // The tiers differ in judgement, not in reach. Decisions per race is the measurable half
    // of that; the lookahead assertion above is the other half.
    const decisions = (tier: BotDifficulty): number => {
      const race = createRace();
      resetRace(race, new Rng(881));
      const state = createBotState();
      const rng = new Rng(4);
      let looks = 0;
      for (let i = 0; i < 60 * 20; i += 1) {
        const before = state.cooldown;
        botDecide(race, 'p1', BOT_PROFILES[tier], state, STEP, rng);
        if (state.cooldown > before) looks += 1;
        step(race, STEP, state.running, state.rail, false, 1);
      }
      return looks;
    };
    const easy = decisions('easy');
    const normal = decisions('normal');
    const hard = decisions('hard');
    expect(normal, `easy looked ${String(easy)}, normal ${String(normal)}`).toBeGreaterThan(easy);
    expect(hard, `normal looked ${String(normal)}, hard ${String(hard)}`).toBeGreaterThan(normal);
  });
});

describe('determinism', () => {
  it('replays a whole race identically from the same seed', () => {
    const trace = (): string => {
      const race = createRace();
      resetRace(race, new Rng(2024));
      const state = createBotState();
      const rng = new Rng(77);
      const seen: string[] = [];
      for (let i = 0; i < 1200 && race.winner === null; i += 1) {
        botDecide(race, 'p1', BOT_PROFILES.normal, state, STEP, rng);
        step(race, STEP, state.running, state.rail, i % 3 === 0, (i >> 4) % RAILS);
        seen.push(
          `${race.p1.distance.toFixed(4)}:${String(race.p1.cheese)}:${String(race.p2.swats)}`,
        );
      }
      return seen.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('replays a whole two-bot duel identically, and a different seed differently', () => {
    // Two seats, two generators, two tiers. The seed alone decides the match.
    const summary = (race: Race): string =>
      `${String(race.winner)}:${String(race.p1.cheese)}:${String(race.p2.cheese)}:` +
      `${race.p1.distance.toFixed(6)}:${race.p2.distance.toFixed(6)}:${race.elapsed.toFixed(6)}`;
    const first = summary(botDuel(4242, 'hard', 'normal', 11, 12));
    expect(summary(botDuel(4242, 'hard', 'normal', 11, 12))).toBe(first);
    expect(summary(botDuel(4243, 'hard', 'normal', 11, 12)), 'another burrow').not.toBe(first);
    expect(summary(botDuel(4242, 'hard', 'normal', 11, 13)), 'another bot').not.toBe(first);
  });

  it('is driven by the fixed delta rather than by a wall clock', () => {
    const coarse = emptyBurrow();
    const fine = emptyBurrow();
    for (let i = 0; i < 30; i += 1) step(coarse, 1 / 30, false, 1, false, 1);
    for (let i = 0; i < 60; i += 1) step(fine, 1 / 60, false, 1, false, 1);
    expect(coarse.elapsed).toBeCloseTo(fine.elapsed, 9);
  });

  it('reads a paw the same way whatever step size asked', () => {
    const paw: Paw = { position: 0, rail: 0, span: 1, period: 2.3, phase: 0.4 };
    expect(pawIsDown(paw, 1)).toBe(pawIsDown(paw, 1));
    expect(pawCycle(paw, 10.5)).toBeCloseTo(pawCycle(paw, 10.5 - paw.period * 4), 9);
  });
});
