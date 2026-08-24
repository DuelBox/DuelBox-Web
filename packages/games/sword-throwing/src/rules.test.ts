import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLADE_RANGE,
  BLADE_SPEED,
  BLADE_START_SPREAD,
  BOT_PROFILES,
  CAPTURE_RADIUS,
  CROSS_FRACTION,
  FLIGHT_LIMIT_SECONDS,
  GUARD_V,
  HALF_WIDTH,
  MAX_AIM,
  MAX_THROWS,
  PARRY_REACH,
  READY_STANCE,
  SETTLE_SECONDS,
  SLOT_JITTER,
  SWORD_SPEED,
  TARGETS_PER_SEAT,
  TARGET_SLOTS,
  TARGET_V,
  WALL_V,
  WIN_HITS,
  activeOf,
  aimAt,
  aimFor,
  aimTowards,
  botParry,
  botThrow,
  clamp,
  createParryPlan,
  createState,
  createThrowPlan,
  crossingFor,
  crossingOf,
  defenderOf,
  fighterOf,
  flightToGuard,
  hitsFor,
  otherOf,
  planParry,
  planThrow,
  resetParryPlan,
  resetState,
  resetThrowPlan,
  slideBlade,
  slideBladeTowards,
  step,
  throwSword,
  turnAim,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, State } from './rules.js';

const STEP = 1 / 60;

/** Every loop in this file is bounded: a runaway `while` hangs vitest rather than failing it. */
const STEP_CAP = 60 * 600;

function fresh(seed = 7): State {
  const state = createState();
  resetState(state, new Rng(seed));
  return state;
}

/** One step, feeding `step` the defender's blade as it stood before anything moved it. */
function tick(state: State, dt = STEP): ReturnType<typeof step> {
  const before = fighterOf(state, otherOf(state.thrower)).blade;
  return step(state, dt, before);
}

/** Step until the phase changes, or give up. Bounded, deliberately. */
function stepUntil(state: State, done: (s: State) => boolean, cap = 600): number {
  for (let i = 0; i < cap; i += 1) {
    if (done(state)) return i;
    tick(state);
  }
  return -1;
}

/** Throw with a given aim and run the flight out. Returns the outcome the state records. */
function throwAndSettle(state: State, aim: number): string {
  aimAt(state, aim);
  throwSword(state, state.thrower);
  const ran = stepUntil(state, (s) => s.phase !== 'flying', 400);
  expect(ran).toBeGreaterThanOrEqual(0);
  return state.lastOutcome;
}

/** Take the arena round to the next thrower. */
function handOver(state: State): void {
  const ran = stepUntil(state, (s) => s.phase === 'aiming' || s.phase === 'over', 200);
  expect(ran).toBeGreaterThanOrEqual(0);
}

function snapshot(state: State): string {
  return JSON.stringify(state);
}

describe('the arena', () => {
  it('puts the two guard lines a flight apart', () => {
    expect((2 * GUARD_V) / SWORD_SPEED).toBeCloseTo(1.04, 6);
  });

  it('stands the rack behind the fighter and the wall behind the rack', () => {
    expect(GUARD_V).toBeLessThan(TARGET_V);
    expect(TARGET_V).toBeLessThan(WALL_V);
  });

  it('keeps every target inside the arena', () => {
    for (const slot of TARGET_SLOTS) {
      expect(Math.abs(slot) + CAPTURE_RADIUS + SLOT_JITTER).toBeLessThan(HALF_WIDTH);
    }
  });

  it('leaves a real gap between one target and the next, jitter and all', () => {
    // Two capture circles that touched would make a wall with no holes, and a throw that
    // could not miss is a throw with no skill in it.
    for (let i = 1; i < TARGET_SLOTS.length; i += 1) {
      const gap = (TARGET_SLOTS[i] ?? 0) - (TARGET_SLOTS[i - 1] ?? 0) - 2 * SLOT_JITTER;
      expect(gap).toBeGreaterThan(2 * CAPTURE_RADIUS);
    }
  });

  it('lets a blade cover every crossing point the rack can produce', () => {
    const widest = CROSS_FRACTION * Math.abs(TARGET_SLOTS[0] ?? 0) + SLOT_JITTER;
    const stance = (1 - CROSS_FRACTION) * BLADE_RANGE;
    expect(widest + stance).toBeLessThanOrEqual(BLADE_RANGE);
  });

  it('has a crossing fraction of about three quarters', () => {
    expect(CROSS_FRACTION).toBeCloseTo(0.7602, 4);
  });

  it('never lets a legal throw outlast the flight limit', () => {
    // The longest possible path: corner to corner of the arena at the widest aim.
    const longest = (GUARD_V + WALL_V) / Math.cos(MAX_AIM) / SWORD_SPEED;
    expect(longest).toBeLessThan(FLIGHT_LIMIT_SECONDS);
  });

  it('closes the termination arithmetic against the platform ceiling', () => {
    const slowest = BOT_PROFILES.easy.think;
    const longestFlight = (GUARD_V + WALL_V) / Math.cos(MAX_AIM) / SWORD_SPEED;
    const worst = MAX_THROWS * (slowest + longestFlight + SETTLE_SECONDS);
    expect(worst).toBeLessThan(600);
    expect(worst).toBeLessThan(200);
  });
});

describe('a fresh match', () => {
  it('starts with nobody having thrown and nobody having scored', () => {
    const state = fresh();
    expect(state.throws).toBe(0);
    expect(state.p1Throws).toBe(0);
    expect(state.p2Throws).toBe(0);
    expect(hitsFor(state, 'p1')).toBe(0);
    expect(hitsFor(state, 'p2')).toBe(0);
    expect(winnerOf(state)).toBeNull();
  });

  it('starts with seat one to throw and the arena waiting', () => {
    const state = fresh();
    expect(state.thrower).toBe('p1');
    expect(state.phase).toBe('aiming');
    expect(state.aim).toBe(0);
  });

  it('gives both fighters the identical rack in their own frame', () => {
    const state = fresh(11);
    // One rack is written down and both seats stand in it; there is nothing to compare
    // because there is only one set of numbers.
    expect(state.slots).toHaveLength(TARGETS_PER_SEAT);
    for (let i = 0; i < TARGETS_PER_SEAT; i += 1) {
      expect(Math.abs((state.slots[i] ?? 0) - (TARGET_SLOTS[i] ?? 0))).toBeLessThanOrEqual(
        SLOT_JITTER,
      );
    }
  });

  it('is the same match from the same seed', () => {
    expect(snapshot(fresh(99))).toBe(snapshot(fresh(99)));
  });

  it('is a different rack from a different seed', () => {
    expect(snapshot(fresh(1))).not.toBe(snapshot(fresh(2)));
  });

  it('draws both starting stances from the same bounded spread', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = fresh(seed);
      expect(Math.abs(state.p1.blade)).toBeLessThanOrEqual(BLADE_START_SPREAD);
      expect(Math.abs(state.p2.blade)).toBeLessThanOrEqual(BLADE_START_SPREAD);
    }
  });

  it('draws the two stances independently, so the seats do not start in lockstep', () => {
    let same = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const state = fresh(seed);
      if (state.p1.blade === state.p2.blade) same += 1;
    }
    expect(same).toBe(0);
  });

  it('favours neither seat over a run of matches', () => {
    let p1Total = 0;
    let p2Total = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const state = fresh(seed);
      p1Total += state.p1.blade;
      p2Total += state.p2.blade;
    }
    // Both are drawn from the same symmetric distribution about each fighter's own centre.
    expect(Math.abs(p1Total / 400)).toBeLessThan(BLADE_START_SPREAD / 4);
    expect(Math.abs(p2Total / 400)).toBeLessThan(BLADE_START_SPREAD / 4);
  });

  it('resets a used state completely', () => {
    const state = fresh(5);
    throwAndSettle(state, 0.2);
    handOver(state);
    resetState(state, new Rng(5));
    expect(snapshot(state)).toBe(snapshot(fresh(5)));
  });
});

describe('whose turn it is', () => {
  it('is the thrower while a throw is being lined up', () => {
    const state = fresh();
    expect(activeOf(state)).toBe('p1');
    expect(defenderOf(state)).toBe('p2');
  });

  it('becomes the defender the instant the sword leaves the hand', () => {
    const state = fresh();
    throwSword(state, 'p1');
    expect(state.phase).toBe('flying');
    expect(activeOf(state)).toBe('p2');
  });

  it('stays with the defender through the settle, because they throw next', () => {
    const state = fresh();
    throwAndSettle(state, 0);
    expect(state.phase).toBe('settling');
    expect(activeOf(state)).toBe('p2');
    handOver(state);
    expect(state.thrower).toBe('p2');
    expect(activeOf(state)).toBe('p2');
  });

  it('never answers null, because this game always has somebody to act', () => {
    const state = fresh();
    const seen = new Set<SeatId>();
    for (let i = 0; i < 900; i += 1) {
      seen.add(activeOf(state));
      if (state.phase === 'aiming') throwSword(state, state.thrower);
      tick(state);
    }
    expect(seen.has('p1')).toBe(true);
    expect(seen.has('p2')).toBe(true);
  });

  it('changes hands exactly once a throw', () => {
    const state = fresh(3);
    let changes = 0;
    let last = activeOf(state);
    for (let t = 0; t < 6; t += 1) {
      throwAndSettle(state, 0.1);
      handOver(state);
    }
    // Replayed, counting the changes step by step.
    const replay = fresh(3);
    let throwsSeen = 0;
    last = activeOf(replay);
    for (let i = 0; i < STEP_CAP && throwsSeen < 6; i += 1) {
      if (replay.phase === 'aiming') {
        aimAt(replay, 0.1);
        throwSword(replay, replay.thrower);
        throwsSeen += 1;
      }
      tick(replay);
      const now = activeOf(replay);
      if (now !== last) changes += 1;
      last = now;
    }
    expect(changes).toBe(6);
  });
});

describe('pointing the throw', () => {
  it('clamps to the aim cone however long a key is held', () => {
    const state = fresh();
    for (let i = 0; i < 200; i += 1) turnAim(state, 0.05);
    expect(state.aim).toBe(MAX_AIM);
    for (let i = 0; i < 400; i += 1) turnAim(state, -0.05);
    expect(state.aim).toBe(-MAX_AIM);
  });

  it('ignores anything that is not a finite number', () => {
    const state = fresh();
    aimAt(state, 0.3);
    aimAt(state, Number.NaN);
    aimAt(state, Infinity);
    turnAim(state, Number.NaN);
    expect(state.aim).toBeCloseTo(0.3, 12);
  });

  it('refuses to move once the sword has left the hand', () => {
    const state = fresh();
    aimAt(state, 0.4);
    throwSword(state, 'p1');
    aimAt(state, -0.4);
    turnAim(state, 0.2);
    expect(state.aim).toBeCloseTo(0.4, 12);
  });

  it('points where a finger is', () => {
    const state = fresh();
    state.p1.blade = 0;
    // Straight down the arena from the hand.
    aimTowards(state, 0, -100);
    expect(state.aim).toBeCloseTo(0, 12);
    aimTowards(state, 100, GUARD_V - 200);
    expect(state.aim).toBeCloseTo(Math.atan2(100, 200), 12);
  });

  it('takes the aim from the hand, not from the centre line', () => {
    const state = fresh();
    state.p1.blade = 150;
    aimTowards(state, 150, -100);
    expect(state.aim).toBeCloseTo(0, 12);
  });

  it('leaves the sight alone for a finger exactly on the hand', () => {
    const state = fresh();
    state.p1.blade = 40;
    aimAt(state, 0.25);
    aimTowards(state, 40, GUARD_V);
    expect(state.aim).toBeCloseTo(0.25, 12);
  });

  it('still cannot be aimed backwards by a finger behind the hand', () => {
    const state = fresh();
    state.p1.blade = 0;
    aimTowards(state, 60, GUARD_V + 400);
    expect(state.aim).toBe(MAX_AIM);
    aimTowards(state, -60, GUARD_V + 400);
    expect(state.aim).toBe(-MAX_AIM);
  });
});

describe('carrying the blade', () => {
  it('moves only while a sword is in the air', () => {
    const state = fresh();
    state.p2.blade = 0;
    slideBlade(state, 'p2', 50);
    expect(state.p2.blade).toBe(0);
    throwSword(state, 'p1');
    slideBlade(state, 'p2', 50);
    expect(state.p2.blade).toBe(50);
  });

  it('moves only for the seat being thrown at', () => {
    const state = fresh();
    state.p1.blade = 0;
    throwSword(state, 'p1');
    slideBlade(state, 'p1', 90);
    expect(state.p1.blade).toBe(0);
  });

  it('is clamped to the guard line', () => {
    const state = fresh();
    throwSword(state, 'p1');
    for (let i = 0; i < 100; i += 1) slideBlade(state, 'p2', 40);
    expect(state.p2.blade).toBe(BLADE_RANGE);
    for (let i = 0; i < 200; i += 1) slideBlade(state, 'p2', -40);
    expect(state.p2.blade).toBe(-BLADE_RANGE);
  });

  it('ignores anything that is not a finite number', () => {
    const state = fresh();
    throwSword(state, 'p1');
    state.p2.blade = 12;
    slideBlade(state, 'p2', Number.NaN);
    slideBladeTowards(state, 'p2', Infinity, 5);
    slideBladeTowards(state, 'p2', 0, Number.NaN);
    expect(state.p2.blade).toBe(12);
  });

  it('never covers more than the step allows when told to go somewhere', () => {
    const state = fresh();
    throwSword(state, 'p1');
    state.p2.blade = 0;
    slideBladeTowards(state, 'p2', 1000, BLADE_SPEED * STEP);
    expect(state.p2.blade).toBeCloseTo(BLADE_SPEED * STEP, 9);
  });

  it('stops when it arrives rather than overshooting', () => {
    const state = fresh();
    throwSword(state, 'p1');
    state.p2.blade = 0;
    slideBladeTowards(state, 'p2', 2, BLADE_SPEED * STEP);
    expect(state.p2.blade).toBe(2);
  });

  it('takes the same time to cross the line whichever way it is going', () => {
    const forward = fresh();
    throwSword(forward, 'p1');
    forward.p2.blade = -100;
    let a = 0;
    for (let i = 0; i < 600 && forward.p2.blade < 100; i += 1) {
      slideBlade(forward, 'p2', BLADE_SPEED * STEP);
      a += 1;
    }
    const back = fresh();
    throwSword(back, 'p1');
    back.p2.blade = 100;
    let b = 0;
    for (let i = 0; i < 600 && back.p2.blade > -100; i += 1) {
      slideBlade(back, 'p2', -BLADE_SPEED * STEP);
      b += 1;
    }
    expect(a).toBe(b);
  });
});

describe('letting go', () => {
  it('refuses when it is not your turn', () => {
    const state = fresh();
    expect(throwSword(state, 'p2')).toBe(false);
    expect(state.phase).toBe('aiming');
    expect(state.throws).toBe(0);
  });

  it('refuses while a sword is already in the air', () => {
    const state = fresh();
    expect(throwSword(state, 'p1')).toBe(true);
    expect(throwSword(state, 'p1')).toBe(false);
    expect(state.throws).toBe(1);
  });

  it('counts the throw against the thrower and against the cap', () => {
    const state = fresh();
    throwAndSettle(state, 0);
    handOver(state);
    expect(state.p1Throws).toBe(1);
    expect(state.p2Throws).toBe(0);
    expect(state.throws).toBe(1);
    throwAndSettle(state, 0);
    handOver(state);
    expect(state.p2Throws).toBe(1);
    expect(state.throws).toBe(2);
  });

  it('leaves from the thrower’s own stance, read in the defender’s frame', () => {
    const state = fresh();
    state.p1.blade = 90;
    aimAt(state, 0);
    throwSword(state, 'p1');
    expect(state.shot.u0).toBe(-90);
    expect(state.shot.v0).toBe(-GUARD_V);
  });

  it('always travels towards the seat being thrown at', () => {
    for (const aim of [-MAX_AIM, -0.3, 0, 0.3, MAX_AIM]) {
      const state = fresh();
      aimAt(state, aim);
      throwSword(state, 'p1');
      expect(state.shot.dv).toBeGreaterThan(0);
      expect(state.shot.du).toBeCloseTo(-Math.sin(aim), 12);
    }
  });

  it('knows when it will reach the guard line before it has flown a step', () => {
    const state = fresh();
    aimAt(state, 0.35);
    throwSword(state, 'p1');
    expect(state.shot.guardTime).toBeCloseTo(flightToGuard(0.35), 12);
  });

  it('resolves a throw flung so wide it never reaches the guard line', () => {
    const state = fresh();
    // Standing at one edge and throwing further outwards: it is over the side of the arena
    // long before it reaches anybody's guard, so there is nothing left to decide.
    state.p1.blade = BLADE_RANGE;
    aimAt(state, MAX_AIM);
    throwSword(state, 'p1');
    expect(state.shot.resolved).toBe(true);
    expect(state.shot.endTime).toBeLessThan(state.shot.guardTime);
    expect(state.shot.hit).toBe(-1);
    stepUntil(state, (s) => s.phase !== 'flying', 400);
    expect(state.lastOutcome).toBe('missed');
  });

  it('clears the last throw’s record when the next one goes', () => {
    const state = fresh(4);
    throwAndSettle(state, 0);
    handOver(state);
    throwSword(state, state.thrower);
    expect(state.lastOutcome).toBe('none');
    expect(state.lastHit).toBe(-1);
  });
});

describe('the flight', () => {
  it('lands in the same place whether the step is whole or halved', () => {
    const whole = fresh(21);
    const half = fresh(21);
    for (const s of [whole, half]) {
      s.p1.blade = 40;
      aimAt(s, 0.24);
      throwSword(s, 'p1');
    }
    for (let i = 0; i < 90; i += 1) {
      tick(whole, STEP);
      tick(half, STEP / 2);
      tick(half, STEP / 2);
    }
    expect(half.shot.u).toBeCloseTo(whole.shot.u, 9);
    expect(half.shot.v).toBeCloseTo(whole.shot.v, 9);
    expect(half.lastOutcome).toBe(whole.lastOutcome);
  });

  it('cannot step over a target however coarse the step', () => {
    // One step of a fifth of a second covers 100 units against a 41-unit capture: a
    // sampled test would walk straight through. The solve does not.
    const coarse = fresh(31);
    coarse.p1.blade = 0;
    coarse.p2.blade = BLADE_RANGE;
    aimAt(coarse, aimFor(coarse, 0, 2));
    throwSword(coarse, 'p1');
    for (let i = 0; i < 40 && coarse.phase === 'flying'; i += 1) tick(coarse, 0.2);
    expect(coarse.lastOutcome).toBe('struck');
  });

  it('puts the sword where the elapsed time says, not where the last step left it', () => {
    const state = fresh(6);
    state.p1.blade = 0;
    aimAt(state, 0.4);
    throwSword(state, 'p1');
    for (let i = 0; i < 30; i += 1) tick(state);
    const t = state.shot.elapsed;
    expect(state.shot.u).toBeCloseTo(state.shot.u0 + state.shot.du * SWORD_SPEED * t, 9);
    expect(state.shot.v).toBeCloseTo(state.shot.v0 + state.shot.dv * SWORD_SPEED * t, 9);
  });

  it('always ends', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const state = fresh(seed);
      state.p1.blade = ((seed % 7) - 3) * 80;
      const aim = ((seed % 11) - 5) * 0.14;
      aimAt(state, clamp(aim, -MAX_AIM, MAX_AIM));
      throwSword(state, 'p1');
      const steps = stepUntil(state, (s) => s.phase !== 'flying', 400);
      expect(steps).toBeGreaterThan(0);
      expect(state.shot.elapsed).toBeLessThanOrEqual(FLIGHT_LIMIT_SECONDS + STEP);
    }
  });

  it('holds the arena for the settle before changing hands', () => {
    const state = fresh();
    throwAndSettle(state, 0);
    expect(state.phase).toBe('settling');
    const steps = stepUntil(state, (s) => s.phase === 'aiming', 200);
    expect(steps).toBeGreaterThanOrEqual(Math.floor(SETTLE_SECONDS / STEP));
  });

  it('resets the sight for the seat taking over', () => {
    const state = fresh();
    aimAt(state, 0.5);
    throwAndSettle(state, 0.5);
    handOver(state);
    expect(state.aim).toBe(0);
  });
});

describe('the parry', () => {
  /** Put the defender's blade at `at` and throw at target `index`; return what happened. */
  function exchange(seed: number, stance: number, index: number, at: number): State {
    const state = fresh(seed);
    state.p1.blade = stance;
    state.p2.blade = at;
    aimAt(state, aimFor(state, stance, index));
    throwSword(state, 'p1');
    stepUntil(state, (s) => s.phase !== 'flying', 400);
    return state;
  }

  it('stops a throw the blade is standing in front of', () => {
    const state = fresh(15);
    const crossing = crossingFor(state, 0, 0);
    const out = exchange(15, 0, 0, crossing);
    expect(out.lastOutcome).toBe('parried');
    expect(out.shot.parried).toBe(true);
    expect(hitsFor(out, 'p1')).toBe(0);
  });

  it('lets a throw past a blade standing somewhere else', () => {
    const state = fresh(15);
    const crossing = crossingFor(state, 0, 0);
    const out = exchange(15, 0, 0, crossing + PARRY_REACH * 4);
    expect(out.lastOutcome).toBe('struck');
    expect(hitsFor(out, 'p1')).toBe(1);
  });

  it('reaches exactly as far as the blade is long and no further', () => {
    const state = fresh(15);
    const crossing = crossingFor(state, 0, 3);
    const inside = exchange(15, 0, 3, crossing + PARRY_REACH - 0.5);
    const outside = exchange(15, 0, 3, crossing + PARRY_REACH + 0.5);
    expect(inside.lastOutcome).toBe('parried');
    expect(outside.lastOutcome).not.toBe('parried');
  });

  it('is symmetric about the blade', () => {
    const state = fresh(15);
    const crossing = crossingFor(state, 0, 1);
    const left = exchange(15, 0, 1, crossing - PARRY_REACH + 0.5);
    const right = exchange(15, 0, 1, crossing + PARRY_REACH - 0.5);
    expect(left.lastOutcome).toBe('parried');
    expect(right.lastOutcome).toBe('parried');
  });

  it('stops the sword dead on the guard line', () => {
    const state = fresh(15);
    const out = exchange(15, 0, 2, crossingFor(state, 0, 2));
    expect(out.shot.v).toBeCloseTo(GUARD_V, 9);
    expect(out.shot.elapsed).toBeCloseTo(out.shot.guardTime, 9);
  });

  it('leaves the rack untouched', () => {
    const state = fresh(15);
    const out = exchange(15, 0, 2, crossingFor(state, 0, 2));
    for (const count of out.p2.struck) expect(count).toBe(0);
  });

  it('is decided at the instant of the crossing, not at the end of the step', () => {
    // Two runs, the same throw, the blade sweeping at the same rate — but the flight is
    // offset by part of a step, so the crossing falls at a different place inside its step.
    // The interpolation is what makes them agree.
    const sweep = (offset: number): boolean => {
      const state = fresh(8);
      state.p1.blade = 0;
      state.p2.blade = -150;
      aimAt(state, aimFor(state, 0, 4));
      throwSword(state, 'p1');
      if (offset > 0) tick(state, offset);
      for (let i = 0; i < 400 && state.phase === 'flying'; i += 1) {
        slideBlade(state, 'p2', BLADE_SPEED * STEP);
        tick(state);
      }
      return state.shot.parried;
    };
    // A quarter of a step of offset shifts every sample; the answer must not shift with it.
    expect(sweep(STEP / 4)).toBe(sweep(0));
  });

  it('cannot be made by a seat that has thrown its own sword', () => {
    const state = fresh();
    throwSword(state, 'p1');
    const before = state.p1.blade;
    for (let i = 0; i < 40; i += 1) {
      slideBlade(state, 'p1', 20);
      tick(state);
    }
    expect(state.p1.blade).toBe(before);
  });
});

describe('striking the rack', () => {
  it('finds the target it was aimed at', () => {
    for (let index = 0; index < TARGETS_PER_SEAT; index += 1) {
      const state = fresh(12);
      state.p1.blade = 0;
      state.p2.blade = BLADE_RANGE;
      aimAt(state, aimFor(state, 0, index));
      throwSword(state, 'p1');
      stepUntil(state, (s) => s.phase !== 'flying', 400);
      expect(state.lastOutcome).toBe('struck');
      expect(state.lastHit).toBe(index);
    }
  });

  it('stops in the first target it meets rather than ploughing on', () => {
    const state = fresh(12);
    state.p1.blade = 0;
    state.p2.blade = BLADE_RANGE;
    aimAt(state, aimFor(state, 0, 0));
    throwSword(state, 'p1');
    stepUntil(state, (s) => s.phase !== 'flying', 400);
    let total = 0;
    for (const count of state.p2.struck) total += count;
    expect(total).toBe(1);
    expect(state.shot.v).toBeLessThanOrEqual(TARGET_V + 1e-9);
  });

  it('can sail through the gap between two targets', () => {
    const state = fresh(12);
    state.p1.blade = 0;
    state.p2.blade = BLADE_RANGE;
    const between = ((state.slots[1] ?? 0) + (state.slots[2] ?? 0)) / 2;
    aimAt(state, Math.atan2(-between, GUARD_V + TARGET_V));
    throwSword(state, 'p1');
    stepUntil(state, (s) => s.phase !== 'flying', 400);
    expect(state.lastOutcome).toBe('missed');
  });

  it('adds to the tally of the seat that threw it', () => {
    const state = fresh(12);
    state.p1.blade = 0;
    state.p2.blade = BLADE_RANGE;
    aimAt(state, aimFor(state, 0, 2));
    throwSword(state, 'p1');
    stepUntil(state, (s) => s.phase !== 'flying', 400);
    expect(hitsFor(state, 'p1')).toBe(1);
    expect(hitsFor(state, 'p2')).toBe(0);
  });

  it('stacks in the target it lands in', () => {
    const state = fresh(12);
    for (let n = 0; n < 3; n += 1) {
      state.p1.blade = 0;
      state.p2.blade = BLADE_RANGE;
      state.thrower = 'p1';
      state.phase = 'aiming';
      aimAt(state, aimFor(state, 0, 2));
      throwSword(state, 'p1');
      stepUntil(state, (s) => s.phase !== 'flying', 400);
      state.phase = 'aiming';
    }
    expect(state.p2.struck[2]).toBe(3);
    expect(hitsFor(state, 'p1')).toBe(3);
  });
});

describe('the crossing point', () => {
  it('agrees with what the flight actually does', () => {
    for (let index = 0; index < TARGETS_PER_SEAT; index += 1) {
      for (const stance of [-200, -60, 0, 75, 240]) {
        const state = fresh(19);
        state.p1.blade = stance;
        aimAt(state, aimFor(state, stance, index));
        throwSword(state, 'p1');
        expect(crossingOf(state.shot)).toBeCloseTo(crossingFor(state, stance, index), 6);
      }
    }
  });

  it('is where the sword really is when it reaches the guard line', () => {
    const state = fresh(19);
    state.p1.blade = 120;
    aimAt(state, aimFor(state, 120, 0));
    throwSword(state, 'p1');
    const crossing = crossingOf(state.shot);
    const at = state.shot.guardTime;
    expect(state.shot.u0 + state.shot.du * SWORD_SPEED * at).toBeCloseTo(crossing, 9);
    expect(state.shot.v0 + state.shot.dv * SWORD_SPEED * at).toBeCloseTo(GUARD_V, 9);
  });

  it('is reachable for every target from every stance', () => {
    // The aim cone has to contain a throw at every target from anywhere on the guard line,
    // or a fighter could be parked somewhere with nothing to shoot at. The worst case is
    // one edge to the far target: 572 units across 684 of arena, which is 0.696 rad.
    const state = fresh(19);
    let worst = 0;
    for (let index = 0; index < TARGETS_PER_SEAT; index += 1) {
      for (const stance of [-BLADE_RANGE, -150, 0, 150, BLADE_RANGE]) {
        const aim = Math.abs(aimFor(state, stance, index));
        worst = Math.max(worst, aim);
        expect(aim).toBeLessThanOrEqual(MAX_AIM);
      }
    }
    expect(worst).toBeGreaterThan(0.65);
  });

  it('moves with the thrower’s stance as well as with the target', () => {
    const state = fresh(19);
    const left = crossingFor(state, -BLADE_RANGE, 2);
    const right = crossingFor(state, BLADE_RANGE, 2);
    // A quarter of the crossing is decided by where the thrower is standing, which is the
    // room they have to pull a defender off a target they are already guarding.
    expect(left - right).toBeCloseTo(2 * (1 - CROSS_FRACTION) * BLADE_RANGE, 6);
  });
});

describe('the win condition', () => {
  /** Score `hits` for `seat` outright, without simulating the throws that earned them. */
  function award(state: State, seat: SeatId, hits: number): void {
    const rack = fighterOf(state, otherOf(seat)).struck;
    for (let n = 0; n < hits; n += 1)
      rack[n % TARGETS_PER_SEAT] = (rack[n % TARGETS_PER_SEAT] ?? 0) + 1;
  }

  /** Throw and hand over without letting the sword do anything. */
  function blankThrow(state: State): void {
    state.phase = 'aiming';
    aimAt(state, MAX_AIM);
    state.p1.blade = state.thrower === 'p1' ? BLADE_RANGE : state.p1.blade;
    state.p2.blade = state.thrower === 'p2' ? BLADE_RANGE : state.p2.blade;
    throwSword(state, state.thrower);
    stepUntil(state, (s) => s.phase === 'aiming' || s.phase === 'over', 400);
  }

  it('is undecided while nobody has enough', () => {
    const state = fresh();
    award(state, 'p1', WIN_HITS - 1);
    blankThrow(state);
    blankThrow(state);
    expect(winnerOf(state)).toBeNull();
  });

  it('goes to the first seat to reach the target, once the round is complete', () => {
    const state = fresh();
    award(state, 'p1', WIN_HITS);
    blankThrow(state);
    expect(winnerOf(state)).toBeNull();
    blankThrow(state);
    expect(winnerOf(state)).toBe('p1');
    expect(state.phase).toBe('over');
  });

  it('gives the reply throw before deciding, so throwing first is only tempo', () => {
    const state = fresh();
    award(state, 'p1', WIN_HITS);
    // p1 has enough, but p2 has not yet answered this round.
    blankThrow(state);
    expect(state.p1Throws).toBe(1);
    expect(state.p2Throws).toBe(0);
    expect(winnerOf(state)).toBeNull();
  });

  it('calls it a draw when both arrive in the same round', () => {
    const state = fresh();
    award(state, 'p1', WIN_HITS);
    award(state, 'p2', WIN_HITS);
    blankThrow(state);
    blankThrow(state);
    expect(winnerOf(state)).toBe('draw');
  });

  it('goes to seat two just as readily as to seat one', () => {
    const state = fresh();
    award(state, 'p2', WIN_HITS);
    blankThrow(state);
    blankThrow(state);
    expect(winnerOf(state)).toBe('p2');
  });

  it('stops the arena once it is decided', () => {
    const state = fresh();
    award(state, 'p1', WIN_HITS);
    blankThrow(state);
    blankThrow(state);
    const frozen = snapshot(state);
    for (let i = 0; i < 60; i += 1) tick(state);
    expect(snapshot(state)).toBe(frozen);
  });

  it('refuses a throw after the match is over', () => {
    const state = fresh();
    award(state, 'p1', WIN_HITS);
    blankThrow(state);
    blankThrow(state);
    expect(throwSword(state, state.thrower)).toBe(false);
  });
});

describe('termination', () => {
  it('runs out of throws even when nobody ever hits anything', () => {
    const state = fresh(77);
    let steps = 0;
    for (let i = 0; i < STEP_CAP && winnerOf(state) === null; i += 1) {
      if (state.phase === 'aiming') {
        // Both fighters throw out of the side of the arena, for ever, and hit nothing.
        fighterOf(state, state.thrower).blade = BLADE_RANGE;
        aimAt(state, MAX_AIM);
        throwSword(state, state.thrower);
      }
      tick(state);
      steps += 1;
    }
    expect(state.throws).toBe(MAX_THROWS);
    expect(winnerOf(state)).toBe('draw');
    expect(steps * STEP).toBeLessThan(600);
  });

  it('settles a capped match on hits rather than calling it a draw', () => {
    const state = fresh(78);
    fighterOf(state, 'p2').struck[0] = 2;
    for (let i = 0; i < STEP_CAP && winnerOf(state) === null; i += 1) {
      if (state.phase === 'aiming') {
        fighterOf(state, state.thrower).blade = BLADE_RANGE;
        aimAt(state, MAX_AIM);
        throwSword(state, state.thrower);
      }
      tick(state);
    }
    expect(state.throws).toBe(MAX_THROWS);
    expect(winnerOf(state)).toBe('p1');
  });

  it('never lets a single exchange outlast its own arithmetic', () => {
    const worst = FLIGHT_LIMIT_SECONDS + SETTLE_SECONDS;
    const state = fresh(4);
    state.p1.blade = 0;
    aimAt(state, MAX_AIM);
    throwSword(state, 'p1');
    const steps = stepUntil(state, (s) => s.phase === 'aiming', 400);
    expect(steps * STEP).toBeLessThanOrEqual(worst);
  });
});

describe('seat symmetry', () => {
  /**
   * The two seats share one frame, so a mirrored match is not a different set of numbers —
   * it is the same set with the seats swapped. These build both and compare them exactly.
   */
  function mirror(state: State): State {
    const other = createState();
    for (let i = 0; i < TARGETS_PER_SEAT; i += 1) {
      other.slots[i] = state.slots[i] ?? 0;
      other.p1.struck[i] = state.p2.struck[i] ?? 0;
      other.p2.struck[i] = state.p1.struck[i] ?? 0;
    }
    other.p1.blade = state.p2.blade;
    other.p2.blade = state.p1.blade;
    other.thrower = otherOf(state.thrower);
    other.aim = state.aim;
    other.phase = state.phase;
    return other;
  }

  it('flies the identical path from either seat', () => {
    for (const aim of [-0.5, -0.12, 0, 0.31, 0.66]) {
      const one = fresh(23);
      one.p1.blade = 137;
      one.p2.blade = -64;
      const two = mirror(one);
      aimAt(one, aim);
      aimAt(two, aim);
      throwSword(one, 'p1');
      throwSword(two, 'p2');
      for (let i = 0; i < 200; i += 1) {
        tick(one);
        tick(two);
        // Bit-for-bit, not to a tolerance: the two seats run the same arithmetic on the
        // same numbers, so there is nothing here that could be nearly equal.
        expect(two.shot.u).toBe(one.shot.u);
        expect(two.shot.v).toBe(one.shot.v);
      }
      expect(two.lastOutcome).toBe(one.lastOutcome);
      expect(two.lastHit).toBe(one.lastHit);
    }
  });

  it('parries the identical throw from either seat', () => {
    const one = fresh(24);
    one.p1.blade = 0;
    one.p2.blade = crossingFor(one, 0, 1) + PARRY_REACH - 1;
    const two = mirror(one);
    aimAt(one, aimFor(one, 0, 1));
    aimAt(two, aimFor(two, 0, 1));
    throwSword(one, 'p1');
    throwSword(two, 'p2');
    stepUntil(one, (s) => s.phase !== 'flying', 400);
    stepUntil(two, (s) => s.phase !== 'flying', 400);
    expect(one.lastOutcome).toBe('parried');
    expect(two.lastOutcome).toBe('parried');
  });

  it('scores the identical exchange for either seat', () => {
    const one = fresh(25);
    one.p1.blade = -80;
    one.p2.blade = BLADE_RANGE;
    const two = mirror(one);
    aimAt(one, aimFor(one, -80, 3));
    aimAt(two, aimFor(two, -80, 3));
    throwSword(one, 'p1');
    throwSword(two, 'p2');
    stepUntil(one, (s) => s.phase !== 'flying', 400);
    stepUntil(two, (s) => s.phase !== 'flying', 400);
    expect(hitsFor(one, 'p1')).toBe(1);
    expect(hitsFor(two, 'p2')).toBe(1);
    expect(one.lastHit).toBe(two.lastHit);
  });

  it('asks the same angle of either seat for the same target', () => {
    const one = fresh(26);
    const two = mirror(one);
    for (let i = 0; i < TARGETS_PER_SEAT; i += 1) {
      expect(aimFor(two, 55, i)).toBe(aimFor(one, 55, i));
      expect(crossingFor(two, 55, i)).toBe(crossingFor(one, 55, i));
    }
  });
});

describe('the bot, throwing', () => {
  const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('plans inside the aim cone whatever it decides', () => {
    for (const tier of tiers) {
      const rng = new Rng(31);
      const plan = createThrowPlan();
      for (let seed = 1; seed <= 60; seed += 1) {
        const state = fresh(seed);
        planThrow(state, 'p1', tier, plan, rng);
        expect(plan.aim).toBeGreaterThanOrEqual(-MAX_AIM);
        expect(plan.aim).toBeLessThanOrEqual(MAX_AIM);
        expect(plan.ready).toBe(true);
      }
    }
  });

  it('draws the same number of values off the stream whatever it decides', () => {
    for (const tier of tiers) {
      const rng = new Rng(41);
      const plan = createThrowPlan();
      const counter = new Rng(41);
      for (let seed = 1; seed <= 40; seed += 1) {
        const state = fresh(seed);
        planThrow(state, 'p1', tier, plan, rng);
        // Two draws a turn, before anything branches on them: a plan that drew a different
        // number when it blundered would put two devices out of step on the first unlucky
        // throw and every throw after it.
        counter.bool(BOT_PROFILES[tier].wild);
        counter.float();
        expect(rng.save()).toEqual(counter.save());
      }
    }
  });

  it('is the same plan from the same stream', () => {
    for (const tier of tiers) {
      const state = fresh(52);
      const a = createThrowPlan();
      const b = createThrowPlan();
      planThrow(state, 'p1', tier, a, new Rng(9));
      planThrow(state, 'p1', tier, b, new Rng(9));
      expect(a).toEqual(b);
    }
  });

  it('plans the mirrored throw for the mirrored seat', () => {
    for (const tier of tiers) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const one = fresh(seed);
        one.p1.blade = 90;
        one.p2.blade = -140;
        const two = createState();
        for (let i = 0; i < TARGETS_PER_SEAT; i += 1) two.slots[i] = one.slots[i] ?? 0;
        two.p1.blade = one.p2.blade;
        two.p2.blade = one.p1.blade;
        const a = createThrowPlan();
        const b = createThrowPlan();
        planThrow(one, 'p1', tier, a, new Rng(seed));
        planThrow(two, 'p2', tier, b, new Rng(seed));
        expect(b.aim).toBe(a.aim);
      }
    }
  });

  it('takes the moment its tier says over the throw', () => {
    for (const tier of tiers) {
      const state = fresh();
      const plan = createThrowPlan();
      const rng = new Rng(3);
      let steps = 0;
      for (let i = 0; i < 400; i += 1) {
        steps += 1;
        if (botThrow(state, 'p1', tier, plan, rng, STEP)) break;
      }
      // Whole steps, exactly: the countdown is spent against a documented hair of slack so
      // that a think time which is a round number of frames does not take one frame more.
      expect(steps).toBe(Math.ceil(BOT_PROFILES[tier].think / STEP));
    }
  });

  it('puts its choice on the sight before it lets go', () => {
    const state = fresh();
    const plan = createThrowPlan();
    botThrow(state, 'p1', 'hard', plan, new Rng(2), STEP);
    expect(state.aim).toBeCloseTo(plan.aim, 12);
  });

  it('never throws on somebody else’s turn', () => {
    const state = fresh();
    const plan = createThrowPlan();
    for (let i = 0; i < 200; i += 1) {
      expect(botThrow(state, 'p2', 'hard', plan, new Rng(1), STEP)).toBe(false);
    }
    expect(plan.ready).toBe(false);
  });

  it('never throws while a sword is in the air', () => {
    const state = fresh();
    throwSword(state, 'p1');
    const plan = createThrowPlan();
    expect(botThrow(state, 'p1', 'hard', plan, new Rng(1), STEP)).toBe(false);
  });

  it('reads the crossing rather than the rack, at every tier above the first', () => {
    // A constructed arena that separates the two judgements. The thrower stands at the far
    // edge, which drags every crossing 72 units towards the other one — so the middle of
    // the rack and the middle of the crossings are 72 units apart, and a blade parked
    // between them looks nearest to opposite ends of the rack depending on which of the
    // two you read. Both margins are seventy-odd units, several times the slot jitter, so
    // the case does not depend on the draw.
    for (let seed = 1; seed <= 40; seed += 1) {
      const state = fresh(seed);
      const stance = BLADE_RANGE;
      state.p1.blade = stance;
      state.p2.blade = -36;
      const easy = createThrowPlan();
      const normal = createThrowPlan();
      const hard = createThrowPlan();
      planThrow(state, 'p1', 'easy', easy, new Rng(600 + seed));
      planThrow(state, 'p1', 'normal', normal, new Rng(600 + seed));
      planThrow(state, 'p1', 'hard', hard, new Rng(600 + seed));
      expect(Math.abs(easy.aim)).toBeGreaterThan(0.4);
      expect(Math.abs(normal.aim)).toBeLessThan(0.3);
      expect(Math.abs(hard.aim)).toBeLessThan(0.3);
    }
  });

  it('charges the hardest tier for the time a wide throw gives a defender', () => {
    // The two judgements agree far more often than they differ — the flight-time term is
    // worth a few tens of units against distances of a few hundred — so this pins the one
    // thing it does: an equally distant pair is settled by which arrives sooner.
    const state = fresh(33);
    const near = flightToGuard(aimFor(state, 0, 2));
    const far = flightToGuard(aimFor(state, 0, 0));
    expect(far).toBeGreaterThan(near);
    expect(BLADE_SPEED * (far - near)).toBeGreaterThan(10);
  });

  it('resets to nothing', () => {
    const plan = createThrowPlan();
    planThrow(fresh(), 'p1', 'hard', plan, new Rng(1));
    resetThrowPlan(plan);
    expect(plan).toEqual(createThrowPlan());
  });
});

describe('the bot, parrying', () => {
  const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];

  function inFlight(seed: number, stance: number, index: number, at: number): State {
    const state = fresh(seed);
    state.p1.blade = stance;
    state.p2.blade = at;
    aimAt(state, aimFor(state, stance, index));
    throwSword(state, 'p1');
    return state;
  }

  it('draws the same number of values off the stream whatever it decides', () => {
    for (const tier of tiers) {
      const rng = new Rng(61);
      const counter = new Rng(61);
      const plan = createParryPlan();
      for (let seed = 1; seed <= 40; seed += 1) {
        const state = inFlight(seed, 0, seed % TARGETS_PER_SEAT, 20);
        resetParryPlan(plan);
        planParry(state, 'p2', tier, plan, rng);
        counter.bool(BOT_PROFILES[tier].wild);
        counter.float();
        expect(rng.save()).toEqual(counter.save());
      }
    }
  });

  it('waits its reaction out before it moves at all', () => {
    for (const tier of tiers) {
      const state = inFlight(9, 0, 0, 0);
      const plan = createParryPlan();
      const rng = new Rng(5);
      const start = state.p2.blade;
      // The countdown is spent on the step it reaches zero, so the first step that moves
      // the blade is the one after that.
      const waits = Math.ceil(BOT_PROFILES[tier].react / STEP);
      for (let i = 0; i < waits; i += 1) {
        botParry(state, 'p2', tier, plan, rng, STEP);
        expect(state.p2.blade).toBe(start);
        tick(state);
      }
      botParry(state, 'p2', tier, plan, rng, STEP);
      expect(state.p2.blade).not.toBe(start);
    }
  });

  it('never carries the blade faster than a person can', () => {
    for (const tier of tiers) {
      const state = inFlight(9, 0, 4, -BLADE_RANGE);
      const plan = createParryPlan();
      const rng = new Rng(5);
      for (let i = 0; i < 200 && state.phase === 'flying'; i += 1) {
        const before = state.p2.blade;
        botParry(state, 'p2', tier, plan, rng, STEP);
        expect(Math.abs(state.p2.blade - before)).toBeLessThanOrEqual(BLADE_SPEED * STEP + 1e-9);
        tick(state);
      }
    }
  });

  it('stops lunging once the throw is past the guard line', () => {
    const state = inFlight(9, 0, 4, -BLADE_RANGE);
    const plan = createParryPlan();
    const rng = new Rng(5);
    let atCrossing = 0;
    for (let i = 0; i < 400 && state.phase === 'flying'; i += 1) {
      botParry(state, 'p2', 'normal', plan, rng, STEP);
      if (state.shot.elapsed >= state.shot.guardTime && atCrossing === 0) {
        atCrossing = state.p2.blade;
      }
      tick(state);
    }
    expect(state.p2.blade).toBe(atCrossing);
  });

  it('goes to where the throw will cross, not to where the sword is', () => {
    const state = inFlight(13, 0, 0, 0);
    const plan = createParryPlan();
    planParry(state, 'p2', 'normal', plan, new Rng(1));
    expect(plan.chase).toBe(false);
    expect(plan.target).toBeCloseTo(crossingOf(state.shot) + plan.error, 9);
  });

  it('chases the sword itself at the tier that does not know better', () => {
    const state = inFlight(13, 0, 0, 0);
    const plan = createParryPlan();
    planParry(state, 'p2', 'easy', plan, new Rng(1));
    expect(plan.chase).toBe(true);
  });

  it('resets its guard rather than chasing a throw it cannot reach', () => {
    // Blade at one edge, throw crossing at the other: nothing it does gets it there.
    const state = inFlight(13, 0, 0, BLADE_RANGE);
    const plan = createParryPlan();
    planParry(state, 'p2', 'hard', plan, new Rng(1));
    expect(plan.target).toBe(READY_STANCE);
  });

  it('does go for a throw it can reach', () => {
    const state = fresh(13);
    const crossing = crossingFor(state, 0, 2);
    const live = inFlight(13, 0, 2, crossing + 20);
    const plan = createParryPlan();
    planParry(live, 'p2', 'hard', plan, new Rng(1));
    expect(plan.target).not.toBe(READY_STANCE);
  });

  it('never moves the blade of the seat that threw', () => {
    const state = inFlight(13, 0, 0, 0);
    const plan = createParryPlan();
    const before = state.p1.blade;
    for (let i = 0; i < 60; i += 1) {
      botParry(state, 'p1', 'hard', plan, new Rng(1), STEP);
      tick(state);
    }
    expect(state.p1.blade).toBe(before);
  });

  it('does nothing at all when no sword is in the air', () => {
    const state = fresh(13);
    const plan = createParryPlan();
    const before = snapshot(state);
    botParry(state, 'p2', 'hard', plan, new Rng(1), STEP);
    expect(snapshot(state)).toBe(before);
    expect(plan.ready).toBe(false);
  });

  it('resets to nothing', () => {
    const plan = createParryPlan();
    planParry(inFlight(13, 0, 0, 0), 'p2', 'hard', plan, new Rng(1));
    resetParryPlan(plan);
    expect(plan).toEqual(createParryPlan());
  });

  it('parries the mirrored throw the same way from either seat', () => {
    for (const tier of tiers) {
      const one = inFlight(27, 60, 1, -30);
      const two = createState();
      for (let i = 0; i < TARGETS_PER_SEAT; i += 1) two.slots[i] = one.slots[i] ?? 0;
      two.p1.blade = -30;
      two.p2.blade = 60;
      two.thrower = 'p2';
      aimAt(two, aimFor(two, 60, 1));
      throwSword(two, 'p2');
      const a = createParryPlan();
      const b = createParryPlan();
      planParry(one, 'p2', tier, a, new Rng(77));
      planParry(two, 'p1', tier, b, new Rng(77));
      expect(b).toEqual(a);
    }
  });
});

describe('the difficulty ladder', () => {
  /** One bot-driven match, played entirely through the rules. */
  function botMatch(p1: BotDifficulty, p2: BotDifficulty, seed: number) {
    const state = fresh(seed);
    const rng = new Rng(seed * 7 + 1);
    const throwPlans = { p1: createThrowPlan(), p2: createThrowPlan() };
    const parryPlans = { p1: createParryPlan(), p2: createParryPlan() };
    const tiers: Record<SeatId, BotDifficulty> = { p1, p2 };
    let parried = 0;
    let struck = 0;
    let steps = 0;
    for (let i = 0; i < STEP_CAP && winnerOf(state) === null; i += 1) {
      const defender = otherOf(state.thrower);
      if (state.phase === 'aiming') {
        const plan = throwPlans[state.thrower];
        if (botThrow(state, state.thrower, tiers[state.thrower], plan, rng, STEP)) {
          throwSword(state, state.thrower);
          resetThrowPlan(plan);
        }
      } else if (state.phase === 'flying') {
        botParry(state, defender, tiers[defender], parryPlans[defender], rng, STEP);
      }
      const outcome = tick(state);
      if (outcome.landed) {
        if (outcome.parried) parried += 1;
        if (outcome.struck >= 0) struck += 1;
        resetParryPlan(parryPlans.p1);
        resetParryPlan(parryPlans.p2);
      }
      steps += 1;
    }
    return { winner: winnerOf(state), throws: state.throws, parried, struck, steps };
  }

  it('finishes every match it starts', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const match = botMatch('easy', 'easy', seed);
      expect(match.winner).not.toBeNull();
      expect(match.steps * STEP).toBeLessThan(600);
    }
  });

  it('parries more of what is thrown at it the better the tier', () => {
    const rate = (tier: BotDifficulty): number => {
      let parried = 0;
      let throws = 0;
      for (let seed = 1; seed <= 24; seed += 1) {
        const match = botMatch(tier, tier, 200 + seed);
        parried += match.parried;
        throws += match.throws;
      }
      return parried / throws;
    };
    const easy = rate('easy');
    const normal = rate('normal');
    const hard = rate('hard');
    expect(easy).toBeGreaterThan(0);
    expect(normal).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(normal);
  });

  it('beats the tier below it', () => {
    const duel = (a: BotDifficulty, b: BotDifficulty): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        // Both seat orders, so a seat advantage cannot masquerade as a tier advantage.
        const first = botMatch(a, b, 400 + seed);
        if (first.winner === 'p1') wins += 1;
        if (first.winner !== 'draw' && first.winner !== null) decided += 1;
        const second = botMatch(b, a, 400 + seed);
        if (second.winner === 'p2') wins += 1;
        if (second.winner !== 'draw' && second.winner !== null) decided += 1;
      }
      return wins / decided;
    };
    expect(duel('normal', 'easy')).toBeGreaterThan(0.7);
    expect(duel('hard', 'easy')).toBeGreaterThan(0.8);
    expect(duel('hard', 'normal')).toBeGreaterThan(0.6);
  });

  it('does not favour a seat at any tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      let p1 = 0;
      let decided = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const match = botMatch(tier, tier, 700 + seed);
        if (match.winner === 'p1') {
          p1 += 1;
          decided += 1;
        } else if (match.winner === 'p2') decided += 1;
      }
      // A loose band deliberately: forty matches cannot support a tight one. The measured
      // figures over 450 seeds a tier are in SPEC.md.
      expect(p1 / decided).toBeGreaterThan(0.25);
      expect(p1 / decided).toBeLessThan(0.75);
    }
  });
});
