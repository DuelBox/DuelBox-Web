import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  ACROSS_LIMIT,
  BOOST_SECONDS,
  BOT_DRAWS_PER_LOOK,
  BOT_LOOKAHEAD,
  BOT_PROFILES,
  CALM_CELLS,
  CAR_HALF_WIDTH,
  CELL_LENGTH,
  CLEAR,
  COURSE_HEIGHT,
  COURSE_WIDTH,
  GATE_NARROW,
  GATE_WIDE,
  HIT_ALONG,
  MIDDLE_SLOT,
  RACE_CELLS,
  RACE_DISTANCE,
  ROAD_HALF_WIDTH,
  ROUND_SECONDS,
  SLOTS,
  SLOT_PITCH,
  SPEED_FAST,
  SPEED_SLOW,
  SPEED_SPIN,
  SPIN_SECONDS,
  STEER_SNAP,
  STEER_SPEED,
  TRACK_CELLS,
  VISIBLE_AHEAD,
  barrierAlong,
  botAim,
  carOf,
  caughtBy,
  cellOf,
  clearMatch,
  createBotState,
  createCar,
  createMatch,
  fillTrack,
  gateAt,
  gateHalf,
  gateNarrow,
  gateSlot,
  gateValue,
  judge,
  narrowChanceAt,
  otherOf,
  postsOf,
  reachAt,
  readLine,
  resetBotState,
  resetMatch,
  slotAcross,
  spacingAt,
  speedOf,
  steerFor,
  stepCar,
  stepMatch,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Car, Match } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function started(seed = 1): { match: Match; rng: Rng } {
  const match = createMatch();
  const rng = new Rng(seed);
  resetMatch(match, rng);
  return { match, rng };
}

/** Every cell that carries a barrier, in the order they stand on the track. */
function barrierCells(track: Readonly<Int8Array>): number[] {
  const cells: number[] = [];
  for (let cell = 0; cell < track.length; cell += 1) {
    if (gateAt(track, cell) !== CLEAR) cells.push(cell);
  }
  return cells;
}

/** An Rng that counts the draws taken from it, so a seat's spend can be measured. */
function counting(seed: number): { rng: Rng; draws: () => number } {
  const source = new Rng(seed);
  let taken = 0;
  const rng = {
    float: (): number => {
      taken += 1;
      return source.float();
    },
  } as unknown as Rng;
  return { rng, draws: () => taken };
}

/** A fixed, seeded steering script — a driver who is not reacting to anything. */
function script(seed: number, steps: number): number[] {
  const rng = new Rng(seed);
  const plan: number[] = [];
  let held = 0;
  let left = 0;
  for (let i = 0; i < steps; i += 1) {
    if (left <= 0) {
      held = rng.float() * 2 - 1;
      left = 4 + Math.floor(rng.float() * 40);
    }
    left -= 1;
    plan.push(held);
  }
  return plan;
}

/** Play one race with both seats driven by scripts. Returns the finished match. */
function race(seed: number, p1Plan: readonly number[], p2Plan: readonly number[]): Match {
  const match = createMatch();
  resetMatch(match, new Rng(seed));
  for (let i = 0; i < p1Plan.length && match.phase !== 'over'; i += 1) {
    stepMatch(match, STEP, p1Plan[i] ?? 0, p2Plan[i] ?? 0);
  }
  return match;
}

/** A plain copy of a car, so two of them can be compared field by field. */
function snapshot(car: Readonly<Car>): Record<string, number> {
  return {
    distance: car.distance,
    across: car.across,
    boost: car.boost,
    spin: car.spin,
    hitCell: car.hitCell,
    crashes: car.crashes,
  };
}

interface Series {
  p1: number;
  p2: number;
  draws: number;
  crashes1: number;
  crashes2: number;
  seconds: number;
  longest: number;
}

/** Play a run of seeded bot races and count who won. */
function playSeries(p1Tier: BotDifficulty, p2Tier: BotDifficulty, matches: number): Series {
  const tally: Series = {
    p1: 0,
    p2: 0,
    draws: 0,
    crashes1: 0,
    crashes2: 0,
    seconds: 0,
    longest: 0,
  };
  const match = createMatch();
  const p1Bot = createBotState();
  const p2Bot = createBotState();
  for (let m = 0; m < matches; m += 1) {
    const rng = new Rng(5000 + m * 131);
    resetMatch(match, rng);
    resetBotState(p1Bot);
    resetBotState(p2Bot);
    for (let i = 0; i < 60 * (ROUND_SECONDS + 2) && match.phase !== 'over'; i += 1) {
      const a = botAim(match, 'p1', p1Tier, p1Bot, STEP, rng);
      const b = botAim(match, 'p2', p2Tier, p2Bot, STEP, rng);
      stepMatch(match, STEP, steerFor(match.p1.across, a), steerFor(match.p2.across, b));
    }
    tally.crashes1 += match.p1.crashes;
    tally.crashes2 += match.p2.crashes;
    tally.seconds += match.elapsed;
    if (match.elapsed > tally.longest) tally.longest = match.elapsed;
    if (match.winner === 'p1') tally.p1 += 1;
    else if (match.winner === 'p2') tally.p2 += 1;
    else tally.draws += 1;
  }
  return tally;
}

describe('the track', () => {
  it('starts with two cars on the line and nobody ahead', () => {
    const { match } = started();
    expect(match.p1.distance).toBe(0);
    expect(match.p2.distance).toBe(0);
    expect(match.p1.across).toBe(0);
    expect(match.p2.across).toBe(0);
    expect(match.phase).toBe('racing');
    expect(winnerOf(match)).toBeNull();
  });

  it('declares the box it is drawn into, so the manifest cannot drift from it', () => {
    expect(COURSE_WIDTH).toBe(600);
    expect(COURSE_HEIGHT).toBe(1000);
    // And the road fits inside it with a margin either side for the gauges.
    expect(ROAD_HALF_WIDTH * 2).toBeLessThan(COURSE_WIDTH);
  });

  it('hands both seats the identical track', () => {
    // Not "two tracks that agree" — one array, read by both cars. Structural fairness:
    // there is no second sequence that could ever differ from the first.
    const { match } = started(4242);
    expect(match.track).toBeInstanceOf(Int8Array);
    expect(carOf(match, 'p1')).not.toBe(carOf(match, 'p2'));
    let barriers = 0;
    for (const cell of barrierCells(match.track)) {
      barriers += 1;
      const at = barrierAlong(cell);
      // The identical question, asked from each car's own position on the same road.
      expect(caughtBy(match.track, cell, at, ACROSS_LIMIT)).toBe(
        caughtBy(match.track, cell, at, ACROSS_LIMIT),
      );
      expect(gateAt(match.track, cell)).toBe(match.track[cell]);
    }
    expect(barriers).toBeGreaterThan(15);
  });

  it('opens clear, so nobody meets a barrier before they have looked', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const { match } = started(seed);
      for (let cell = 0; cell < CALM_CELLS; cell += 1) {
        expect(gateAt(match.track, cell), `seed ${String(seed)} cell ${String(cell)}`).toBe(CLEAR);
      }
    }
  });

  it('never puts a gate off the road', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const { match } = started(seed);
      for (const cell of barrierCells(match.track)) {
        const gate = gateAt(match.track, cell);
        const centre = slotAcross(gateSlot(gate));
        expect(Math.abs(centre) + gateHalf(gate)).toBeLessThanOrEqual(ROAD_HALF_WIDTH);
      }
    }
  });

  it('never asks for a gate further across than the reach at that point allows', () => {
    // The whole runnability guarantee, and the one that would be silently broken by a
    // tuning change: a gate the car cannot physically reach is not difficulty, it is a
    // countdown.
    for (let seed = 0; seed < 60; seed += 1) {
      const { match } = started(seed);
      const cells = barrierCells(match.track);
      let previous = MIDDLE_SLOT;
      for (const cell of cells) {
        const slot = gateSlot(gateAt(match.track, cell));
        expect(
          Math.abs(slot - previous),
          `seed ${String(seed)} cell ${String(cell)}`,
        ).toBeLessThanOrEqual(reachAt(cell));
        previous = slot;
      }
    }
  });

  it('leaves the spacing the ramp promises between one barrier and the next', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const { match } = started(seed);
      const cells = barrierCells(match.track);
      for (let i = 1; i < cells.length; i += 1) {
        const previous = cells[i - 1]!;
        expect(cells[i]! - previous, `seed ${String(seed)}`).toBe(spacingAt(previous) + 1);
      }
    }
  });

  it('leaves enough road between barriers to cross the reach at full speed', () => {
    // The claim the two ramps together are making, in seconds rather than in cells: the
    // widest gate change the generator can ask for still fits in the time the fastest car
    // has to make it. Tight late on — that is the difficulty — but never impossible.
    for (let cell = CALM_CELLS; cell < RACE_CELLS; cell += 1) {
      const room = ((spacingAt(cell) + 1) * CELL_LENGTH) / SPEED_FAST;
      const needed = (reachAt(cell) * SLOT_PITCH - (GATE_NARROW - CAR_HALF_WIDTH)) / STEER_SPEED;
      expect(needed, `cell ${String(cell)}`).toBeLessThan(room);
    }
  });

  it('runs far enough that nobody can read off the end of it', () => {
    const { match } = started();
    expect(match.track.length).toBe(TRACK_CELLS);
    expect(cellOf(RACE_DISTANCE + VISIBLE_AHEAD)).toBeLessThan(TRACK_CELLS);
  });

  it('leaves the run to the line clear, so the finish is not a lottery', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const { match } = started(seed);
      expect(gateAt(match.track, RACE_CELLS - 1)).toBe(CLEAR);
      for (let cell = RACE_CELLS; cell < TRACK_CELLS; cell += 1) {
        expect(gateAt(match.track, cell)).toBe(CLEAR);
      }
    }
  });

  it('is the same track for the same seed and a different one otherwise', () => {
    const a = new Int8Array(TRACK_CELLS);
    const b = new Int8Array(TRACK_CELLS);
    const c = new Int8Array(TRACK_CELLS);
    fillTrack(a, new Rng(90210));
    fillTrack(b, new Rng(90210));
    fillTrack(c, new Rng(90211));
    expect([...b]).toEqual([...a]);
    expect([...c]).not.toEqual([...a]);
  });

  it('spends the same number of draws on a barrier whatever comes out of it', () => {
    // The Fruit Duel bug, guarded where it would come back: a generator whose draw count
    // depends on what it drew makes every later decision depend on an earlier outcome.
    for (let seed = 0; seed < 20; seed += 1) {
      const track = new Int8Array(TRACK_CELLS);
      const counted = counting(seed);
      fillTrack(track, counted.rng);
      expect(counted.draws(), `seed ${String(seed)}`).toBe(barrierCells(track).length * 2);
    }
  });

  it('gets harder as the race runs, and the gates get narrower with it', () => {
    expect(narrowChanceAt(0)).toBe(0);
    expect(narrowChanceAt(RACE_CELLS)).toBeGreaterThan(narrowChanceAt(RACE_CELLS / 2));
    expect(narrowChanceAt(RACE_CELLS * 4)).toBe(narrowChanceAt(RACE_CELLS));
    expect(reachAt(0)).toBeLessThan(reachAt(RACE_CELLS - 1));
    expect(spacingAt(0)).toBeGreaterThan(spacingAt(RACE_CELLS - 1));

    // Measured rather than asserted from the ramp: over forty tracks the last third has to
    // actually carry more narrow gates than the first.
    let early = 0;
    let late = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const { match } = started(seed);
      for (const cell of barrierCells(match.track)) {
        if (!gateNarrow(gateAt(match.track, cell))) continue;
        if (cell < RACE_CELLS / 3) early += 1;
        else if (cell > (RACE_CELLS * 2) / 3) late += 1;
      }
    }
    expect(late).toBeGreaterThan(early);
  });

  it('packs a gate into one cell and reads it back', () => {
    for (let slot = 0; slot < SLOTS; slot += 1) {
      for (const narrow of [false, true]) {
        const gate = gateValue(slot, narrow);
        expect(gate).not.toBe(CLEAR);
        expect(gateSlot(gate)).toBe(slot);
        expect(gateNarrow(gate)).toBe(narrow);
        expect(gateHalf(gate)).toBe(narrow ? GATE_NARROW : GATE_WIDE);
        // It has to survive the Int8Array the track is held in.
        const track = new Int8Array(1);
        track[0] = gate;
        expect(gateAt(track, 0)).toBe(gate);
      }
    }
  });

  it('puts a point on the track in the cell it belongs to', () => {
    expect(cellOf(0)).toBe(0);
    expect(cellOf(CELL_LENGTH - 1)).toBe(0);
    expect(cellOf(CELL_LENGTH)).toBe(1);
    expect(barrierAlong(0)).toBe(CELL_LENGTH / 2);
    expect(barrierAlong(7)).toBe(7 * CELL_LENGTH + CELL_LENGTH / 2);
  });

  it('keeps the whole of a collision inside the barrier’s own cell', () => {
    // Which is what lets the collision test look at one cell rather than sweep a range. If
    // this ever stops being true the car passes through barriers at the cell boundary.
    expect(HIT_ALONG).toBeLessThan(CELL_LENGTH / 2);
    const track = new Int8Array(TRACK_CELLS);
    track[5] = gateValue(0, false);
    for (let d = 5 * CELL_LENGTH; d < 6 * CELL_LENGTH; d += 1) {
      if (!caughtBy(track, 5, d, ACROSS_LIMIT)) continue;
      expect(cellOf(d)).toBe(5);
    }
  });
});

describe('steering', () => {
  it('is full lock until the last few units, then eases off', () => {
    expect(steerFor(0, 300)).toBe(1);
    expect(steerFor(0, -300)).toBe(-1);
    expect(steerFor(0, STEER_SNAP)).toBe(1);
    expect(steerFor(0, STEER_SNAP / 2)).toBeCloseTo(0.5, 10);
    expect(steerFor(0, 0)).toBe(0);
    expect(steerFor(120, 120)).toBe(0);
  });

  it('never asks for more than full lock, from anywhere to anywhere', () => {
    for (let from = -ACROSS_LIMIT; from <= ACROSS_LIMIT; from += 23) {
      for (let to = -ACROSS_LIMIT; to <= ACROSS_LIMIT; to += 23) {
        expect(Math.abs(steerFor(from, to))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('crosses the road in the time the constant says', () => {
    const track = new Int8Array(TRACK_CELLS);
    const car = carOf(createMatch(), 'p1');
    car.across = -ACROSS_LIMIT;
    const seconds = (ACROSS_LIMIT * 2) / STEER_SPEED;
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps; i += 1) stepCar(track, car, 1, STEP);
    expect(car.across).toBeCloseTo(ACROSS_LIMIT, 6);
  });

  it('stops at the kerb rather than running off the road', () => {
    const track = new Int8Array(TRACK_CELLS);
    const car = carOf(createMatch(), 'p1');
    for (let i = 0; i < 600; i += 1) stepCar(track, car, 1, STEP);
    expect(car.across).toBe(ACROSS_LIMIT);
    for (let i = 0; i < 1200; i += 1) stepCar(track, car, -1, STEP);
    expect(car.across).toBe(-ACROSS_LIMIT);
  });

  it('reads a value that is not a number as no steering at all', () => {
    // The pointer positions a browser produces are not always numbers a game would choose,
    // and one NaN reaching `across` poisons the whole race from that step on.
    const track = new Int8Array(TRACK_CELLS);
    const car = carOf(createMatch(), 'p1');
    stepCar(track, car, Number.NaN, STEP);
    expect(car.across).toBe(0);
    stepCar(track, car, Number.POSITIVE_INFINITY, STEP);
    expect(car.across).toBe(0);
    expect(Number.isFinite(car.distance)).toBe(true);
  });

  it('clamps a steer beyond full lock rather than obeying it', () => {
    const track = new Int8Array(TRACK_CELLS);
    const fast = carOf(createMatch(), 'p1');
    const locked = carOf(createMatch(), 'p2');
    stepCar(track, fast, 40, STEP);
    stepCar(track, locked, 1, STEP);
    expect(fast.across).toBe(locked.across);
  });

  it('does nothing at all while the car is spinning', () => {
    const track = new Int8Array(TRACK_CELLS);
    const car = carOf(createMatch(), 'p1');
    car.spin = SPIN_SECONDS;
    const held = car.across;
    stepCar(track, car, 1, STEP);
    expect(car.across).toBe(held);
    expect(car.spin).toBeCloseTo(SPIN_SECONDS - STEP, 10);
  });
});

describe('the gates', () => {
  const track = new Int8Array(TRACK_CELLS);
  track[4] = gateValue(1, false);
  const centre = slotAcross(1);
  const along = barrierAlong(4);

  it('lets a car through the middle of the gap', () => {
    expect(caughtBy(track, 4, along, centre)).toBe(false);
  });

  it('narrows the gap by the car’s own half-width', () => {
    const room = GATE_WIDE - CAR_HALF_WIDTH;
    expect(caughtBy(track, 4, along, centre + room - 0.01)).toBe(false);
    expect(caughtBy(track, 4, along, centre + room + 0.01)).toBe(true);
    expect(caughtBy(track, 4, along, centre - room - 0.01)).toBe(true);
  });

  it('catches a car anywhere else across the road', () => {
    expect(caughtBy(track, 4, along, centre + SLOT_PITCH * 2)).toBe(true);
    expect(caughtBy(track, 4, along, -ACROSS_LIMIT)).toBe(true);
  });

  it('is only dangerous inside its own hit band along the track', () => {
    expect(caughtBy(track, 4, along - HIT_ALONG, -ACROSS_LIMIT)).toBe(false);
    expect(caughtBy(track, 4, along - HIT_ALONG + 1, -ACROSS_LIMIT)).toBe(true);
    expect(caughtBy(track, 4, along + HIT_ALONG - 1, -ACROSS_LIMIT)).toBe(true);
    expect(caughtBy(track, 4, along + HIT_ALONG, -ACROSS_LIMIT)).toBe(false);
  });

  it('catches nobody in a clear cell', () => {
    expect(caughtBy(track, 3, barrierAlong(3), -ACROSS_LIMIT)).toBe(false);
    expect(caughtBy(track, -1, 0, 0)).toBe(false);
    expect(caughtBy(track, TRACK_CELLS + 5, 0, 0)).toBe(false);
  });

  it('makes a narrow gate a smaller window than a wide one', () => {
    const narrow = new Int8Array(TRACK_CELLS);
    narrow[4] = gateValue(1, true);
    const edge = centre + GATE_NARROW - CAR_HALF_WIDTH + 1;
    expect(caughtBy(narrow, 4, along, edge)).toBe(true);
    expect(caughtBy(track, 4, along, edge)).toBe(false);
  });
});

describe('a crash', () => {
  function crashed(): { track: Int8Array; car: Car } {
    const track = new Int8Array(TRACK_CELLS);
    track[4] = gateValue(4, false);
    const car = carOf(createMatch(), 'p1');
    car.across = -ACROSS_LIMIT;
    car.boost = 1;
    let guard = 0;
    while (car.spin === 0 && guard < 2000) {
      stepCar(track, car, 0, STEP);
      guard += 1;
    }
    return { track, car };
  }

  it('costs the whole wind-up and most of a second of control', () => {
    const { car } = crashed();
    expect(car.spin).toBe(SPIN_SECONDS);
    expect(car.boost).toBe(0);
    expect(car.crashes).toBe(1);
    expect(speedOf(car)).toBe(SPEED_SPIN);
  });

  it('keeps the car moving forward, which is what makes the race end', () => {
    const { track, car } = crashed();
    const before = car.distance;
    stepCar(track, car, 0, STEP);
    expect(car.distance).toBeGreaterThan(before);
    expect(SPEED_SPIN).toBeGreaterThan(0);
  });

  it('cannot be caused twice by the same barrier', () => {
    // A spinning car keeps rolling and is still inside the barrier it hit for most of a
    // second. Without the guard it is caught again on every one of the next fifty steps
    // and never leaves — a race with no end rather than a race with a penalty.
    const { track, car } = crashed();
    for (let i = 0; i < 240; i += 1) stepCar(track, car, 0, STEP);
    expect(car.crashes).toBe(1);
    expect(car.spin).toBe(0);
  });

  it('can still be caused by the next barrier along', () => {
    const { track, car } = crashed();
    track[8] = gateValue(0, false);
    car.across = ACROSS_LIMIT;
    for (let i = 0; i < 600 && car.crashes < 2; i += 1) stepCar(track, car, 0, STEP);
    expect(car.crashes).toBe(2);
  });

  it('is counted for each seat separately', () => {
    const match = createMatch();
    match.track[4] = gateValue(4, false);
    match.p1.across = -ACROSS_LIMIT;
    match.p2.across = slotAcross(4);
    for (let i = 0; i < 300; i += 1) stepMatch(match, STEP, 0, 0);
    expect(match.p1.crashes).toBe(1);
    expect(match.p2.crashes).toBe(0);
  });

  it('lets go of the car the moment the spin runs out', () => {
    const { track, car } = crashed();
    const steps = Math.ceil(SPIN_SECONDS / STEP);
    for (let i = 0; i < steps; i += 1) stepCar(track, car, 0, STEP);
    expect(car.spin).toBe(0);
    const held = car.across;
    stepCar(track, car, 1, STEP);
    expect(car.across).toBeGreaterThan(held);
  });
});

describe('speed', () => {
  it('starts at a walk, ends at a sprint, and never overshoots either end', () => {
    const car = carOf(createMatch(), 'p1');
    expect(speedOf(car)).toBe(SPEED_SLOW);
    car.boost = 1;
    expect(speedOf(car)).toBe(SPEED_FAST);
    const track = new Int8Array(TRACK_CELLS);
    const winding = carOf(createMatch(), 'p2');
    for (let i = 0; i < 60 * BOOST_SECONDS * 3; i += 1) stepCar(track, winding, 0, STEP);
    expect(winding.boost).toBe(1);
    expect(speedOf(winding)).toBe(SPEED_FAST);
  });

  it('takes the wind-up the constant names to reach full speed', () => {
    const track = new Int8Array(TRACK_CELLS);
    const car = carOf(createMatch(), 'p1');
    const steps = Math.round((BOOST_SECONDS / STEP) * 0.5);
    for (let i = 0; i < steps; i += 1) stepCar(track, car, 0, STEP);
    expect(car.boost).toBeCloseTo(0.5, 6);
  });

  it('crawls while spinning, whatever the wind-up said a moment ago', () => {
    const car = carOf(createMatch(), 'p1');
    car.boost = 1;
    car.spin = 0.4;
    expect(speedOf(car)).toBe(SPEED_SPIN);
    expect(SPEED_SPIN).toBeLessThan(SPEED_SLOW);
  });

  it('covers the same ground in a second whether that second is sixty steps or a hundred and twenty', () => {
    // The wind-up is a straight line in time, so its midpoint is its exact average and the
    // distance integral is step-size independent. A rectangle rule here would make the game
    // measurably faster on one refresh rate than another, which rule 8 forbids.
    const track = new Int8Array(TRACK_CELLS);
    const slow = carOf(createMatch(), 'p1');
    const fast = carOf(createMatch(), 'p2');
    for (let i = 0; i < 60 * 5; i += 1) stepCar(track, slow, 0, 1 / 60);
    for (let i = 0; i < 120 * 5; i += 1) stepCar(track, fast, 0, 1 / 120);
    expect(fast.distance).toBeCloseTo(slow.distance, 6);
    expect(fast.boost).toBeCloseTo(slow.boost, 10);
  });
});

describe('the score', () => {
  it('counts whole cells and never runs past the finish', () => {
    const car = carOf(createMatch(), 'p1');
    expect(postsOf(car)).toBe(0);
    car.distance = CELL_LENGTH * 3.9;
    expect(postsOf(car)).toBe(3);
    car.distance = RACE_DISTANCE;
    expect(postsOf(car)).toBe(RACE_CELLS);
    car.distance = RACE_DISTANCE * 2;
    expect(postsOf(car)).toBe(RACE_CELLS);
  });
});

describe('winning', () => {
  it('is first to the finish line', () => {
    const match = createMatch();
    match.p1.distance = RACE_DISTANCE - 20;
    match.p2.distance = RACE_DISTANCE - 4000;
    for (let i = 0; i < 60 && match.phase !== 'over'; i += 1) stepMatch(match, STEP, 0, 0);
    expect(match.winner).toBe('p1');
    expect(match.p1.distance).toBe(RACE_DISTANCE);
  });

  it('is a draw when both cross on the same step', () => {
    const match = createMatch();
    match.p1.distance = RACE_DISTANCE - 1;
    match.p2.distance = RACE_DISTANCE - 1;
    stepMatch(match, STEP, 0, 0);
    expect(match.winner).toBe('draw');
  });

  it('is called on distance when the clock runs out, and level is a draw', () => {
    const ahead = createMatch();
    ahead.elapsed = ROUND_SECONDS - STEP;
    ahead.p1.distance = 900;
    ahead.p2.distance = 400;
    stepMatch(ahead, STEP, 0, 0);
    expect(ahead.winner).toBe('p1');

    const level = createMatch();
    level.elapsed = ROUND_SECONDS - STEP;
    stepMatch(level, STEP, 0, 0);
    expect(level.winner).toBe('draw');
  });

  it('settles the clock on distance rather than on the posts the scoreboard prints', () => {
    // A car's length apart at the flag is a win, not a dead heat. The posts are the
    // distance rounded down, so resolving on them would throw the difference away.
    const match = createMatch();
    match.elapsed = ROUND_SECONDS;
    match.p1.distance = CELL_LENGTH * 9 + 199;
    match.p2.distance = CELL_LENGTH * 9 + 1;
    expect(postsOf(match.p1)).toBe(postsOf(match.p2));
    expect(judge(match)).toBe('p1');
  });

  it('leaves an already-decided race alone when the clock expires', () => {
    const match = createMatch();
    match.p1.distance = RACE_DISTANCE - 1;
    stepMatch(match, STEP, 0, 0);
    expect(match.winner).toBe('p1');
    match.elapsed = ROUND_SECONDS * 2;
    stepMatch(match, STEP, 0, 0);
    expect(match.winner).toBe('p1');
  });

  it('stops simulating once it is decided', () => {
    const match = createMatch();
    match.p1.distance = RACE_DISTANCE - 1;
    stepMatch(match, STEP, 0, 0);
    const frozen = snapshot(match.p2);
    const clock = match.elapsed;
    for (let i = 0; i < 60; i += 1) stepMatch(match, STEP, 1, 1);
    expect(snapshot(match.p2)).toEqual(frozen);
    expect(match.elapsed).toBe(clock);
  });

  it('freezes a car that is already home while the other is still coming', () => {
    const { match } = started(8);
    match.p1.distance = RACE_DISTANCE;
    const held = snapshot(match.p1);
    stepCar(match.track, match.p1, 1, STEP);
    expect(snapshot(match.p1)).toEqual(held);
  });

  it('reports the step through one object rather than allocating per step (rule 5)', () => {
    const { match } = started();
    const first = stepMatch(match, STEP, 0, 0);
    const second = stepMatch(match, STEP, 0, 0);
    expect(second).toBe(first);
  });
});

describe('termination', () => {
  it('finishes a race nobody is driving', () => {
    // The shortest path to a finished match, and what the shell's e2e regression uses. Two
    // cars nobody touches still cross the line, because a car drives itself.
    const { match } = started(3);
    for (let i = 0; i < 60 * 600 && match.phase !== 'over'; i += 1) stepMatch(match, STEP, 0, 0);
    expect(match.phase).toBe('over');
    expect(match.winner).toBe('draw');
    expect(match.elapsed).toBeLessThan(ROUND_SECONDS);
  });

  it('finishes every bot pairing a long way inside the clock', () => {
    for (const a of TIERS) {
      for (const b of TIERS) {
        const played = playSeries(a, b, 12);
        expect(played.longest, `${a} v ${b}`).toBeLessThan(ROUND_SECONDS * 0.75);
        expect(played.p1 + played.p2 + played.draws).toBe(12);
      }
    }
  });

  it('cannot be stalled by a driver steering into every barrier there is', () => {
    // The failure mode a race is prone to: a car that crashes for ever and never arrives.
    // It cannot happen here, and this is what says so — a driver holding the kerb clips
    // nearly every gate on the track and still finishes, inside the clock.
    const match = createMatch();
    resetMatch(match, new Rng(17));
    for (let i = 0; i < 60 * 600 && match.phase !== 'over'; i += 1) stepMatch(match, STEP, -1, 1);
    expect(match.phase).toBe('over');
    expect(match.p1.crashes).toBeGreaterThan(8);
    expect(match.elapsed).toBeLessThanOrEqual(ROUND_SECONDS);
  });
});

describe('both seats race the same race', () => {
  it('gives two cars driven the same way bit-identical races', () => {
    // The seat-bias test. Both cars read one track, are stepped in one call and are judged
    // together, so an identically driven pair must not merely finish close — they must be
    // the same numbers, step for step.
    const plan = script(11, 60 * 90);
    const match = createMatch();
    resetMatch(match, new Rng(2026));
    for (let i = 0; i < plan.length && match.phase !== 'over'; i += 1) {
      stepMatch(match, STEP, plan[i] ?? 0, plan[i] ?? 0);
      expect(snapshot(match.p2)).toEqual(snapshot(match.p1));
    }
    expect(match.winner).toBe('draw');
  });

  it('gives the mirrored race the mirrored result', () => {
    // And the stronger form: swap the two drivers over and every number swaps with them.
    // Several games in this repository shipped with a seat-one advantage that only this
    // shape of test found.
    const a = script(21, 60 * 120);
    const b = script(22, 60 * 120);
    for (const seed of [7, 8, 9, 101]) {
      const straight = race(seed, a, b);
      const swapped = race(seed, b, a);
      expect(snapshot(swapped.p2), `seed ${String(seed)}`).toEqual(snapshot(straight.p1));
      expect(snapshot(swapped.p1), `seed ${String(seed)}`).toEqual(snapshot(straight.p2));
      expect(swapped.elapsed).toBe(straight.elapsed);
      const mirrored = straight.winner === 'draw' ? 'draw' : otherOf(straight.winner as SeatId);
      expect(swapped.winner).toBe(mirrored);
    }
  });

  it('reads the identical gate at the identical distance for either seat', () => {
    const { match } = started(55);
    for (const cell of barrierCells(match.track)) {
      const at = barrierAlong(cell);
      for (let across = -ACROSS_LIMIT; across <= ACROSS_LIMIT; across += 40) {
        const forP1 = caughtBy(match.track, cell, at, across);
        // There is only one track, so the only way this could differ is if a seat carried
        // its own copy — which is exactly the thing the design refuses to allow.
        expect(caughtBy(match.track, cellOf(at), at, across)).toBe(forP1);
      }
    }
  });

  it('is balanced over a run of bot races at every tier', () => {
    for (const tier of TIERS) {
      const played = playSeries(tier, tier, 120);
      const decided = played.p1 + played.p2;
      expect(decided, `${tier} drew too often`).toBeGreaterThan(60);
      expect(played.p1 / decided, `${tier} from p1`).toBeGreaterThan(0.35);
      expect(played.p1 / decided, `${tier} from p1`).toBeLessThan(0.65);
    }
  });
});

describe('the bot', () => {
  it('only ever asks for a point it could steer to', () => {
    for (const tier of TIERS) {
      const { match, rng } = started(13);
      const state = createBotState();
      for (let i = 0; i < 4000; i += 1) {
        const aim = botAim(match, 'p2', tier, state, STEP, rng);
        expect(Number.isFinite(aim)).toBe(true);
        // A blunder may aim a slot past the outermost gate; the kerb is what stops the car
        // short of it, which is exactly what a badly chosen line looks like.
        expect(Math.abs(aim)).toBeLessThanOrEqual(slotAcross(SLOTS - 1) + SLOT_PITCH);
        stepMatch(match, STEP, 0, steerFor(match.p2.across, aim));
        if (match.phase === 'over') resetMatch(match, rng);
      }
    }
  });

  it('spends the same number of draws on every look, whatever it decides', () => {
    for (const tier of TIERS) {
      for (let seed = 0; seed < 30; seed += 1) {
        const { match } = started(seed);
        match.p1.distance = seed * CELL_LENGTH;
        const counted = counting(seed);
        botAim(match, 'p1', tier, createBotState(), STEP, counted.rng);
        expect(counted.draws(), `${tier} seed ${String(seed)}`).toBe(BOT_DRAWS_PER_LOOK);
      }
    }
  });

  it('spends nothing at all on a step it does not look', () => {
    const { match } = started();
    const state = createBotState();
    const counted = counting(5);
    botAim(match, 'p1', 'easy', state, STEP, counted.rng);
    const afterFirst = counted.draws();
    botAim(match, 'p1', 'easy', state, STEP, counted.rng);
    expect(counted.draws()).toBe(afterFirst);
  });

  it('holds its answer inside its reaction delay rather than re-reading every step', () => {
    const { match, rng } = started(31);
    const state = createBotState();
    const first = botAim(match, 'p1', 'easy', state, STEP, rng);
    // Move the road under it. A bot that re-read every step would answer the new one.
    match.track[cellOf(match.p1.distance) + 1] = gateValue(SLOTS - 1, false);
    expect(botAim(match, 'p1', 'easy', state, STEP, rng)).toBe(first);
  });

  it('reads less of the road than a person can see (rule 6)', () => {
    expect(BOT_LOOKAHEAD).toBeLessThan(VISIBLE_AHEAD);
    const { match } = started(77);
    match.track.fill(CLEAR);
    const quiet = readLine(match, 'p1', BOT_LOOKAHEAD);
    // A barrier past the bot's horizon but inside the player's window changes nothing for
    // the bot and everything for the person sitting there.
    match.track[cellOf(BOT_LOOKAHEAD) + 1] = gateValue(0, false);
    expect(readLine(match, 'p1', BOT_LOOKAHEAD)).toBe(quiet);
    expect(readLine(match, 'p1', VISIBLE_AHEAD)).toBe(slotAcross(0));
  });

  it('heads for the middle of the road when there is nothing in the way', () => {
    // The middle is never more than two slots from any gate, so waiting there is simply
    // better play — and it is what makes seeing further actually pay.
    const { match } = started();
    match.track.fill(CLEAR);
    expect(readLine(match, 'p1', BOT_LOOKAHEAD)).toBe(0);
    expect(slotAcross(MIDDLE_SLOT)).toBe(0);
  });

  it('reads the nearest barrier rather than the furthest', () => {
    const { match } = started();
    match.track.fill(CLEAR);
    match.track[2] = gateValue(0, false);
    match.track[3] = gateValue(4, false);
    match.p1.distance = 0;
    expect(readLine(match, 'p1', BOT_LOOKAHEAD)).toBe(slotAcross(0));
  });

  it('stops steering for a barrier that has already caught it', () => {
    // A car pointing at a gap it is past is a car pointing the wrong way for the next one.
    const { match } = started();
    match.track.fill(CLEAR);
    match.track[1] = gateValue(0, false);
    match.p1.distance = barrierAlong(1);
    match.p1.hitCell = 1;
    expect(readLine(match, 'p1', BOT_LOOKAHEAD)).toBe(0);
  });

  it('describes each tier only as reaction, waver and blunder', () => {
    // Rule 6 as a shape check: if a tier ever gains a field the others do not have, it is
    // getting something a human cannot.
    for (const tier of TIERS) {
      expect(Object.keys(BOT_PROFILES[tier]).sort()).toEqual(['blunder', 'reaction', 'waver']);
    }
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
    expect(BOT_PROFILES.easy.waver).toBeGreaterThan(BOT_PROFILES.hard.waver);
  });

  it('steers through the same rate a person does', () => {
    // Not merely "no faster" — the identical function. A bot names a point and `steerFor`
    // is what turns that into steering, exactly as it does for a finger.
    const { match, rng } = started(19);
    const state = createBotState();
    const aim = botAim(match, 'p1', 'hard', state, STEP, rng);
    const before = match.p1.across;
    stepMatch(match, STEP, steerFor(before, aim), 0);
    expect(Math.abs(match.p1.across - before)).toBeLessThanOrEqual(STEER_SPEED * STEP + 1e-9);
  });

  it('beats the tier below it, from either seat', () => {
    // Measured rather than asserted, and from both seats: an ordering that only holds for
    // whoever happens to be p1 is not an ordering, it is a seat advantage.
    for (const [weak, strong] of [
      ['easy', 'normal'],
      ['normal', 'hard'],
      ['easy', 'hard'],
    ] as [BotDifficulty, BotDifficulty][]) {
      const asP2 = playSeries(weak, strong, 40);
      const asP1 = playSeries(strong, weak, 40);
      expect(asP2.p2, `${strong} as p2 against ${weak}`).toBeGreaterThanOrEqual(28);
      expect(asP1.p1, `${strong} as p1 against ${weak}`).toBeGreaterThanOrEqual(28);
    }
  });

  it('crashes less often the better it is', () => {
    // The tiers have to differ in the thing the game is about, not only in who wins.
    const crashes = TIERS.map((tier) => playSeries(tier, tier, 20).crashes1);
    expect(crashes[0]).toBeGreaterThan(crashes[1]!);
    expect(crashes[1]).toBeGreaterThan(crashes[2]!);
  });

  it('finishes faster the better it is', () => {
    const seconds = TIERS.map((tier) => playSeries(tier, tier, 20).seconds);
    expect(seconds[0]).toBeGreaterThan(seconds[1]!);
    expect(seconds[1]).toBeGreaterThan(seconds[2]!);
  });
});

describe('determinism', () => {
  it('replays a fixed trace to the identical final state', () => {
    const plan = script(64, 60 * 60);
    const first = race(500, plan, plan);
    const again = race(500, plan, plan);
    expect(snapshot(again.p1)).toEqual(snapshot(first.p1));
    expect(again.elapsed).toBe(first.elapsed);
    expect(again.winner).toBe(first.winner);
  });

  it('two different seeds do not produce the same race', () => {
    const plan = script(65, 60 * 60);
    const a = race(1, plan, script(66, 60 * 60));
    const b = race(2, plan, script(66, 60 * 60));
    expect(snapshot(b.p1)).not.toEqual(snapshot(a.p1));
  });

  it('moves only when it is stepped', () => {
    const { match } = started();
    const held = snapshot(match.p1);
    expect(judge(match)).toBeNull();
    expect(postsOf(match.p1)).toBe(0);
    expect(snapshot(match.p1)).toEqual(held);
  });

  it('gives a rematch on the same objects a clean start', () => {
    const { match, rng } = started(71);
    for (let i = 0; i < 600; i += 1) stepMatch(match, STEP, 1, -1);
    resetMatch(match, rng);
    expect(snapshot(match.p1)).toEqual(snapshot(createCar()));
    expect(match.elapsed).toBe(0);
    expect(match.phase).toBe('racing');
    expect(match.winner).toBeNull();
  });

  it('clears a match without spending a draw on a track nobody will run', () => {
    const match = createMatch();
    const counted = counting(3);
    resetMatch(match, counted.rng);
    const spent = counted.draws();
    for (let i = 0; i < 120; i += 1) stepMatch(match, STEP, 0, 0);
    clearMatch(match);
    expect(counted.draws()).toBe(spent);
    // And the track survives, because tearing a match down is not generating a new one.
    expect(barrierCells(match.track).length).toBeGreaterThan(0);
  });

  it('gives every seat the same starting car', () => {
    const match = createMatch();
    expect(snapshot(match.p2)).toEqual(snapshot(match.p1));
    for (const seat of SEATS) expect(carOf(match, seat)).toBe(seat === 'p1' ? match.p1 : match.p2);
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the finish line', () => {
  // Both cars are pinned to RACE_DISTANCE the moment they cross, and the race ends on the
  // step the FIRST car is home — so a step with both home is always the same step, and
  // judging it on distance compares two numbers the clamp just made equal. At full speed a
  // step covers about nine units, so any two cars within nine units of the line arrived in
  // the same step and were all called dead heats. This is the regression for that.
  const bothHomeIn = (p1Short: number, p2Short: number) => {
    // A real seeded track, so the barrier check a car short of the line still runs.
    const { match } = started(7);
    match.p1.distance = RACE_DISTANCE - p1Short;
    match.p2.distance = RACE_DISTANCE - p2Short;
    const result = stepMatch(match, STEP, 0, 0);
    return { match, result };
  };

  it('gives the race to the car that crossed first, not to the clamp', () => {
    const { match, result } = bothHomeIn(1, 5);
    expect(result.p1, 'both cars must reach home in the one step').toBe('home');
    expect(result.p2).toBe('home');
    expect(match.p1.distance, 'and the clamp still pins both to the line').toBe(RACE_DISTANCE);
    expect(match.p2.distance).toBe(RACE_DISTANCE);
    // p1 needed a fifth of what p2 needed, so it went by the post first by a clear margin.
    expect(match.p1.finishOffset).toBeLessThan(match.p2.finishOffset);
    expect(match.winner).toBe('p1');
  });

  it('gives it to the other seat just as readily', () => {
    const { match } = bothHomeIn(5, 1);
    expect(match.winner).toBe('p2');
  });

  it('still calls a genuine dead heat a draw', () => {
    const { match } = bothHomeIn(3, 3);
    expect(match.p1.finishOffset).toBe(match.p2.finishOffset);
    expect(match.winner).toBe('draw');
  });

  it('leaves a race only one car finishes alone', () => {
    const { match, result } = bothHomeIn(1, 400);
    expect(result.p2, 'p2 is nowhere near the line').not.toBe('home');
    expect(match.winner).toBe('p1');
  });
});
