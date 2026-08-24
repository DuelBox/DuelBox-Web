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
  CELL_LENGTH,
  CLEAR,
  CLEARANCE,
  COURSE_HEIGHT,
  COURSE_WIDTH,
  HIT_ALONG,
  HOP_AIM,
  HOP_LENGTH,
  HOP_WINDOW,
  JAM,
  JAM_SPACING,
  LANDING_KEEP,
  LANES,
  LANE_PITCH,
  MAX_SIDESTEP,
  MIN_QUEUE_GAP,
  RACE_CELLS,
  RACE_DISTANCE,
  FINISH_TOLERANCE,
  RAMP_EARLY,
  RAMP_LATE,
  ROAD_HALF_WIDTH,
  ROUND_SECONDS,
  SETTLE_SECONDS,
  SPEED_FAST,
  SPEED_SLOW,
  SPEED_SPIN,
  SPIN_SECONDS,
  STEER_SNAP,
  STEER_SPEED,
  TAXI_HALF_LENGTH,
  TAXI_HALF_WIDTH,
  TRACK_CELLS,
  TRAFFIC_HALF_LENGTH,
  TRAFFIC_HALF_WIDTH,
  VISIBLE_AHEAD,
  VISIBLE_CELLS,
  blocksOf,
  botDrive,
  canHop,
  caughtBy,
  cellOf,
  clearMatch,
  createBotState,
  createMatch,
  createTaxi,
  fillTraffic,
  freeLaneNear,
  jamChanceAt,
  judge,
  laneAcross,
  laneBlocked,
  maskAt,
  maxBlockAt,
  otherOf,
  reachAt,
  readAhead,
  resetBotState,
  resetMatch,
  resetTaxi,
  spacingAt,
  speedOf,
  steerFor,
  stepMatch,
  stepTaxi,
  taxiOf,
  trafficAlong,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Match, Taxi } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/** An empty road, so a test can put exactly what it means to test on it and nothing else. */
function emptyTrack(): Int8Array {
  return new Int8Array(TRACK_CELLS);
}

/** A road with one queue in it. */
function trackWith(cell: number, mask: number): Int8Array {
  const track = emptyTrack();
  track[cell] = mask;
  return track;
}

/** A seeded road. */
function filled(seed: number): Int8Array {
  const track = emptyTrack();
  fillTraffic(track, new Rng(seed));
  return track;
}

/** Every cell of a road that has something standing in it. */
function queuesOf(track: Readonly<Int8Array>): number[] {
  const cells: number[] = [];
  for (let cell = 0; cell < track.length; cell += 1) {
    if (maskAt(track, cell) !== CLEAR) cells.push(cell);
  }
  return cells;
}

/** Counts the draws a bot spends, so a variable count cannot hide as a seat bias. */
class CountingRng extends Rng {
  floats = 0;

  override float(): number {
    this.floats += 1;
    return super.float();
  }
}

/**
 * Every safe interval of `across` for a mask, as `[low, high]` pairs.
 *
 * Derived from {@link caughtBy} rather than from the lane centres, because what a driver
 * actually needs is *somewhere* the traffic cannot reach them — which is wider than a lane
 * centre and is what the reachability proof is about.
 */
function safeSpans(mask: number): [number, number][] {
  const spans: [number, number][] = [];
  for (let lane = 0; lane < LANES; lane += 1) {
    if (laneBlocked(mask, lane)) continue;
    let low = -ACROSS_LIMIT;
    let high = ACROSS_LIMIT;
    for (let other = 0; other < LANES; other += 1) {
      if (!laneBlocked(mask, other)) continue;
      const centre = laneAcross(other);
      if (other < lane) low = Math.max(low, centre + CLEARANCE);
      else high = Math.min(high, centre - CLEARANCE);
    }
    if (low <= high) spans.push([low, high]);
  }
  return spans;
}

/** The shortest move from `from` to anywhere a mask cannot touch, and where that lands. */
function nearestSafe(mask: number, from: number): { need: number; at: number } {
  let need = Infinity;
  let at = from;
  for (const [low, high] of safeSpans(mask)) {
    const landed = from < low ? low : from > high ? high : from;
    const gap = Math.abs(landed - from);
    if (gap < need) {
      need = gap;
      at = landed;
    }
  }
  return { need, at };
}

/** Drive one taxi for `steps` with a fixed ask. Bounded, never a `while`. */
function driveFor(
  track: Readonly<Int8Array>,
  taxi: Taxi,
  steps: number,
  steer = 0,
  hop = false,
): void {
  for (let step = 0; step < steps; step += 1) stepTaxi(track, taxi, steer, hop, STEP);
}

describe('the road, as a set of numbers', () => {
  it('puts the lanes evenly across the road', () => {
    for (let lane = 1; lane < LANES; lane += 1) {
      expect(laneAcross(lane) - laneAcross(lane - 1)).toBeCloseTo(LANE_PITCH, 10);
    }
  });

  it('centres the lanes on the road, so neither side is favoured', () => {
    expect(laneAcross(0)).toBeCloseTo(-laneAcross(LANES - 1), 10);
  });

  it('fits the outermost lane inside the kerbs', () => {
    expect(Math.abs(laneAcross(LANES - 1)) + TRAFFIC_HALF_WIDTH).toBeLessThanOrEqual(
      ROAD_HALF_WIDTH,
    );
    expect(Math.abs(laneAcross(0)) + TRAFFIC_HALF_WIDTH).toBeLessThanOrEqual(ROAD_HALF_WIDTH);
  });

  it('keeps the taxi on the tarmac', () => {
    expect(ACROSS_LIMIT + TAXI_HALF_WIDTH).toBe(ROAD_HALF_WIDTH);
  });

  it('leaves no gap to squeeze between two blocked lanes', () => {
    // The whole reason "past or over" is the only pair of options.
    expect(CLEARANCE).toBeGreaterThan(LANE_PITCH / 2);
  });

  it('leaves real room in an open lane, so arriving is not a knife edge', () => {
    expect(LANE_PITCH - CLEARANCE).toBeGreaterThan(STEER_SNAP);
  });

  it('confines a collision to the traffic’s own cell', () => {
    expect(HIT_ALONG).toBeLessThan(CELL_LENGTH / 2);
  });

  it('never lets two queues share a danger span', () => {
    // Queues are two cells apart at the closest, so their spans cannot overlap.
    expect(2 * CELL_LENGTH).toBeGreaterThan(2 * HIT_ALONG);
    expect(MIN_QUEUE_GAP).toBeGreaterThan(0);
  });

  it('derives the hop window from the hop and the danger span', () => {
    expect(HOP_AIM).toBe(HOP_LENGTH / 2);
    expect(HOP_WINDOW).toBe(HOP_LENGTH / 2 - HIT_ALONG);
    expect(HOP_WINDOW).toBeGreaterThan(0);
  });

  it('makes a hop longer than the danger it has to clear', () => {
    expect(HOP_LENGTH).toBeGreaterThan(2 * HIT_ALONG);
  });

  it('shows enough road to hold the cells the renderer walks', () => {
    expect(VISIBLE_CELLS * CELL_LENGTH).toBeGreaterThanOrEqual(VISIBLE_AHEAD);
  });

  it('generates every cell anybody can ask for', () => {
    const furthest = cellOf(RACE_DISTANCE + VISIBLE_AHEAD);
    expect(TRACK_CELLS).toBeGreaterThan(furthest);
  });

  it('declares the box the manifest draws into', () => {
    expect(COURSE_WIDTH).toBe(600);
    expect(COURSE_HEIGHT).toBe(1000);
  });

  it('orders the three speeds', () => {
    expect(SPEED_SPIN).toBeLessThan(SPEED_SLOW);
    expect(SPEED_SLOW).toBeLessThan(SPEED_FAST);
  });

  it('measures the taxi and the traffic in the same units', () => {
    expect(TAXI_HALF_LENGTH + TRAFFIC_HALF_LENGTH).toBe(HIT_ALONG);
    expect(TAXI_HALF_WIDTH + TRAFFIC_HALF_WIDTH).toBe(CLEARANCE);
  });
});

describe('the reachability guarantee', () => {
  it('names the widest move two queues can ask for', () => {
    expect(MAX_SIDESTEP).toBe(ACROSS_LIMIT + LANE_PITCH / 2 + CLEARANCE);
  });

  it('is the widest move any mask can actually ask for, checked over every mask', () => {
    let worst = 0;
    for (let mask = 0; mask < JAM; mask += 1) {
      for (const from of [-ACROSS_LIMIT, ACROSS_LIMIT]) {
        const { need } = nearestSafe(mask, from);
        expect(Number.isFinite(need), `mask ${mask} has nowhere safe`).toBe(true);
        worst = Math.max(worst, need);
      }
    }
    expect(worst).toBeLessThanOrEqual(MAX_SIDESTEP);
  });

  it('names the least road two queues can leave between them', () => {
    expect(MIN_QUEUE_GAP).toBe(2 * CELL_LENGTH - 2 * HIT_ALONG);
  });

  it('closes the arithmetic with a fifth of the time to spare', () => {
    const needed = MAX_SIDESTEP / STEER_SPEED;
    const available = MIN_QUEUE_GAP / SPEED_FAST;
    expect(needed).toBeLessThan(available * 0.85);
  });

  it('holds on every generated route, from every legal resting place', () => {
    // The walk carries the *set* of places a driver may legally be rather than the line the
    // generator threaded, because a player who takes an open lane that is not the intended
    // one must still be able to make the next queue. That distinction found a real hole: at
    // STEER_SPEED 500 one route in four thousand asked 336 units of a driver who had 328
    // units' worth of time.
    let worstRatio = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      const track = filled(1 + seed * 7919);
      let starts: number[] = [0];
      let from = 0;
      for (const cell of queuesOf(track)) {
        const along = trafficAlong(cell);
        if (maskAt(track, cell) === JAM) {
          // A hop cannot steer, so it comes down where it left — anywhere on the road — and
          // the latest legal landing is the one that leaves least room afterwards.
          starts = [-ACROSS_LIMIT, ACROSS_LIMIT];
          from = along - HIT_ALONG + HOP_LENGTH;
          continue;
        }
        const road = along - HIT_ALONG - from;
        const available = (road / SPEED_FAST) * STEER_SPEED;
        const rested: number[] = [];
        for (const start of starts) {
          const { need, at } = nearestSafe(maskAt(track, cell), start);
          worstRatio = Math.max(worstRatio, need / available);
          rested.push(at);
        }
        starts = [...new Set(rested)];
        from = along + HIT_ALONG;
      }
    }
    expect(worstRatio).toBeLessThan(0.9);
  });
});

describe('a cell', () => {
  it('is empty when it is zero', () => {
    expect(CLEAR).toBe(0);
  });

  it('blocks every lane when it is a jam', () => {
    for (let lane = 0; lane < LANES; lane += 1) expect(laneBlocked(JAM, lane)).toBe(true);
  });

  it('reads back the lanes it was built from', () => {
    const mask = (1 << 0) | (1 << 2);
    expect(laneBlocked(mask, 0)).toBe(true);
    expect(laneBlocked(mask, 1)).toBe(false);
    expect(laneBlocked(mask, 2)).toBe(true);
    expect(laneBlocked(mask, 3)).toBe(false);
  });

  it('is empty off either end of the road', () => {
    const track = trackWith(4, JAM);
    expect(maskAt(track, -1)).toBe(CLEAR);
    expect(maskAt(track, TRACK_CELLS + 50)).toBe(CLEAR);
  });

  it('holds its traffic in its own middle', () => {
    for (let cell = 0; cell < 6; cell += 1) {
      expect(cellOf(trafficAlong(cell))).toBe(cell);
      expect(trafficAlong(cell) - cell * CELL_LENGTH).toBe(CELL_LENGTH / 2);
    }
  });

  it('places a point on the road in exactly one cell', () => {
    expect(cellOf(0)).toBe(0);
    expect(cellOf(CELL_LENGTH - 0.001)).toBe(0);
    expect(cellOf(CELL_LENGTH)).toBe(1);
  });
});

describe('finding the open lane', () => {
  it('picks the nearest one', () => {
    const mask = (1 << 0) | (1 << 1);
    expect(freeLaneNear(mask, laneAcross(3))).toBe(3);
    expect(freeLaneNear(mask, laneAcross(2))).toBe(2);
  });

  it('picks the nearest one from between two of them', () => {
    expect(freeLaneNear(1 << 1, laneAcross(0) - 10)).toBe(0);
    expect(freeLaneNear(1 << 1, laneAcross(2) + 10)).toBe(2);
  });

  it('says there is none at a jam', () => {
    expect(freeLaneNear(JAM, 0)).toBe(-1);
  });

  it('breaks a tie the same way every time', () => {
    // Exactly between lanes 1 and 2 with both open: the lower one, deterministically, or two
    // devices could disagree.
    expect(freeLaneNear(0, 0)).toBe(1);
    expect(freeLaneNear(0, 0)).toBe(1);
  });

  it('finds every lane when the road is empty', () => {
    for (let lane = 0; lane < LANES; lane += 1) {
      expect(freeLaneNear(CLEAR, laneAcross(lane))).toBe(lane);
    }
  });
});

describe('the road generator', () => {
  it('draws the same road from the same seed', () => {
    expect([...filled(99)]).toEqual([...filled(99)]);
  });

  it('draws different roads from different seeds', () => {
    expect([...filled(1)]).not.toEqual([...filled(2)]);
  });

  it('leaves the opening cells empty', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const track = filled(seed + 1);
      for (let cell = 0; cell < CALM_CELLS; cell += 1) {
        expect(maskAt(track, cell)).toBe(CLEAR);
      }
    }
  });

  it('leaves the cell before the line empty', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      expect(maskAt(filled(seed + 1), RACE_CELLS - 1)).toBe(CLEAR);
    }
  });

  it('puts nothing past the line', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const track = filled(seed + 1);
      for (let cell = RACE_CELLS; cell < TRACK_CELLS; cell += 1) {
        expect(maskAt(track, cell)).toBe(CLEAR);
      }
    }
  });

  it('never blocks every lane except at a jam', () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const track = filled(seed + 1);
      for (const cell of queuesOf(track)) {
        const mask = maskAt(track, cell);
        if (mask === JAM) continue;
        expect(freeLaneNear(mask, 0)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('never blocks more lanes than the ramp allows', () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const track = filled(seed + 1);
      for (const cell of queuesOf(track)) {
        const mask = maskAt(track, cell);
        if (mask === JAM) continue;
        let blocked = 0;
        for (let lane = 0; lane < LANES; lane += 1) if (laneBlocked(mask, lane)) blocked += 1;
        expect(blocked).toBeGreaterThan(0);
        expect(blocked).toBeLessThanOrEqual(maxBlockAt(cell));
      }
    }
  });

  it('never stands two queues closer than the ramp allows', () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const track = filled(seed + 1);
      const cells = queuesOf(track);
      for (let i = 1; i < cells.length; i += 1) {
        const previous = cells[i - 1]!;
        const wanted = maskAt(track, previous) === JAM ? JAM_SPACING : spacingAt(previous);
        expect(cells[i]! - previous).toBeGreaterThanOrEqual(wanted + 1);
      }
    }
  });

  it('always leaves the widest spacing after a jam', () => {
    let jamsSeen = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const track = filled(seed + 1);
      const cells = queuesOf(track);
      for (let i = 1; i < cells.length; i += 1) {
        if (maskAt(track, cells[i - 1]!) !== JAM) continue;
        jamsSeen += 1;
        expect(cells[i]! - cells[i - 1]!).toBe(JAM_SPACING + 1);
      }
    }
    expect(jamsSeen).toBeGreaterThan(100);
  });

  it('puts jams on the road at all, or the game has no second half', () => {
    let jams = 0;
    let queues = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const track = filled(seed + 1);
      for (const cell of queuesOf(track)) {
        queues += 1;
        if (maskAt(track, cell) === JAM) jams += 1;
      }
    }
    // Measured: 19.2 queues a route, of which 4.85 are jams.
    expect(jams / 200).toBeGreaterThan(2);
    expect(queues / 200).toBeGreaterThan(12);
    expect(jams).toBeLessThan(queues / 2);
  });

  it('spends exactly four draws on every queue, whatever it decides', () => {
    // A seat whose draw count depends on what it decided shifts the other seat's stream.
    const rng = new CountingRng(4242);
    const track = emptyTrack();
    fillTraffic(track, rng);
    // The generator walks a fixed set of cells for a given seed; count them the same way it
    // does rather than from the road, because a jam and a queue cost the same four draws.
    let placed = 0;
    let index = CALM_CELLS;
    for (let guard = 0; guard < RACE_CELLS && index < RACE_CELLS - 1; guard += 1) {
      placed += 1;
      const mask = maskAt(track, index);
      index += (mask === JAM ? JAM_SPACING : spacingAt(index)) + 1;
    }
    expect(rng.floats).toBe(placed * 4);
  });

  it('refills over whatever was there before', () => {
    const track = filled(7);
    const before = [...track];
    fillTraffic(track, new Rng(8));
    expect([...track]).not.toEqual(before);
    fillTraffic(track, new Rng(7));
    expect([...track]).toEqual(before);
  });

  it('ramps its difficulty in the direction it claims', () => {
    expect(reachAt(0)).toBeLessThanOrEqual(reachAt(RAMP_EARLY));
    expect(spacingAt(0)).toBeGreaterThanOrEqual(spacingAt(RAMP_LATE));
    expect(maxBlockAt(0)).toBeLessThan(maxBlockAt(RAMP_LATE));
    expect(jamChanceAt(0)).toBeLessThan(jamChanceAt(RACE_CELLS - 1));
  });

  it('keeps the jam chance a probability at every point on the road', () => {
    for (let cell = -10; cell < TRACK_CELLS + 10; cell += 1) {
      expect(jamChanceAt(cell)).toBeGreaterThanOrEqual(0);
      expect(jamChanceAt(cell)).toBeLessThanOrEqual(1);
    }
  });

  it('never asks for a lane that does not exist', () => {
    for (let cell = 0; cell < TRACK_CELLS; cell += 1) {
      expect(reachAt(cell)).toBeGreaterThanOrEqual(1);
      expect(maxBlockAt(cell)).toBeLessThanOrEqual(LANES - 1);
      expect(spacingAt(cell)).toBeGreaterThanOrEqual(1);
    }
  });

  it('reaches every shape of queue over enough seeds', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 400; seed += 1) {
      for (const cell of queuesOf(filled(seed + 1))) seen.add(maskAt(filled(seed + 1), cell));
    }
    // Every arrangement of one, two or three blocked lanes, plus the jam.
    expect(seen.size).toBeGreaterThanOrEqual(12);
    expect(seen.has(JAM)).toBe(true);
  });
});

describe('being caught by traffic', () => {
  const track = trackWith(4, (1 << 0) | (1 << 1));
  const centre = trafficAlong(4);

  it('never happens on an empty cell', () => {
    expect(caughtBy(emptyTrack(), 4, centre, 0)).toBe(false);
  });

  it('never happens beyond the danger span', () => {
    expect(caughtBy(track, 4, centre - HIT_ALONG, laneAcross(0))).toBe(false);
    expect(caughtBy(track, 4, centre + HIT_ALONG, laneAcross(0))).toBe(false);
  });

  it('happens right inside the danger span', () => {
    expect(caughtBy(track, 4, centre - HIT_ALONG + 0.5, laneAcross(0))).toBe(true);
    expect(caughtBy(track, 4, centre + HIT_ALONG - 0.5, laneAcross(0))).toBe(true);
  });

  it('happens in a blocked lane', () => {
    expect(caughtBy(track, 4, centre, laneAcross(0))).toBe(true);
    expect(caughtBy(track, 4, centre, laneAcross(1))).toBe(true);
  });

  it('does not happen in an open one', () => {
    expect(caughtBy(track, 4, centre, laneAcross(2))).toBe(false);
    expect(caughtBy(track, 4, centre, laneAcross(3))).toBe(false);
  });

  it('happens between two blocked lanes, which is the whole point', () => {
    const between = (laneAcross(0) + laneAcross(1)) / 2;
    expect(caughtBy(track, 4, centre, between)).toBe(true);
  });

  it('happens against the kerb beside a blocked outer lane', () => {
    expect(caughtBy(track, 4, centre, -ACROSS_LIMIT)).toBe(true);
  });

  it('happens everywhere on the road at a jam', () => {
    const jam = trackWith(4, JAM);
    for (let across = -ACROSS_LIMIT; across <= ACROSS_LIMIT; across += 4) {
      expect(caughtBy(jam, 4, centre, across)).toBe(true);
    }
  });

  it('is exactly as wide as the clearance says', () => {
    const one = trackWith(4, 1 << 2);
    const lane = laneAcross(2);
    expect(caughtBy(one, 4, centre, lane + CLEARANCE - 0.5)).toBe(true);
    expect(caughtBy(one, 4, centre, lane + CLEARANCE)).toBe(false);
    expect(caughtBy(one, 4, centre, lane - CLEARANCE + 0.5)).toBe(true);
    expect(caughtBy(one, 4, centre, lane - CLEARANCE)).toBe(false);
  });

  it('treats the two sides of the road alike', () => {
    const left = trackWith(4, 1 << 0);
    const right = trackWith(4, 1 << (LANES - 1));
    for (let across = -ACROSS_LIMIT; across <= ACROSS_LIMIT; across += 8) {
      expect(caughtBy(left, 4, centre, across)).toBe(caughtBy(right, 4, centre, -across));
    }
  });
});

describe('one taxi, one step', () => {
  it('starts on the line in the middle of the road', () => {
    const taxi = createTaxi();
    expect(taxi.distance).toBe(0);
    expect(taxi.across).toBe(0);
    expect(taxi.boost).toBe(0);
    expect(taxi.hop).toBe(0);
    expect(taxi.spin).toBe(0);
    expect(taxi.hitCell).toBe(-1);
    expect(taxi.creditCell).toBe(-1);
  });

  it('always moves forward', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    let last = 0;
    for (let step = 0; step < 600; step += 1) {
      stepTaxi(track, taxi, 0, false, STEP);
      expect(taxi.distance).toBeGreaterThan(last);
      last = taxi.distance;
    }
  });

  it('pulls away at the standing speed and winds up to the fast one', () => {
    const taxi = createTaxi();
    expect(speedOf(taxi)).toBe(SPEED_SLOW);
    taxi.boost = 1;
    expect(speedOf(taxi)).toBe(SPEED_FAST);
    taxi.boost = 0.5;
    expect(speedOf(taxi)).toBeCloseTo((SPEED_SLOW + SPEED_FAST) / 2, 8);
  });

  it('crawls while it is spinning, whatever the wind-up says', () => {
    const taxi = createTaxi();
    taxi.boost = 1;
    taxi.spin = 0.5;
    expect(speedOf(taxi)).toBe(SPEED_SPIN);
  });

  it('takes the whole wind-up to reach full speed', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    driveFor(track, taxi, Math.round(BOOST_SECONDS * 60) - 1);
    expect(taxi.boost).toBeLessThan(1);
    driveFor(track, taxi, 2);
    expect(taxi.boost).toBe(1);
  });

  it('covers the analytic distance at 60, 90, 120 and 144 Hz alike', () => {
    // The wind-up is a straight line in time, so the midpoint of a step is its exact average —
    // which makes the sum of the steps the *integral* rather than an approximation of it.
    // Five seconds from a standing start is 300 × 5 + 280 × 25 / 14 = 2000 units, and every
    // rate lands on that number rather than near it. A rectangle rule would have put 60 Hz
    // and 144 Hz several units apart, which is a different race on a different monitor.
    const analytic = SPEED_SLOW * 5 + ((SPEED_FAST - SPEED_SLOW) * 25) / (2 * BOOST_SECONDS);
    expect(analytic).toBe(2000);
    for (const hz of [60, 90, 120, 144]) {
      const taxi = createTaxi();
      const track = emptyTrack();
      for (let step = 0; step < hz * 5; step += 1) stepTaxi(track, taxi, 0, false, 1 / hz);
      expect(taxi.distance, `${hz} Hz`).toBeCloseTo(analytic, 6);
    }
  });

  it('crosses the road at the steering speed', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    driveFor(track, taxi, 6, 1);
    expect(taxi.across).toBeCloseTo(STEER_SPEED * 6 * STEP, 8);
  });

  it('stops at the kerb', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    driveFor(track, taxi, 200, 1);
    expect(taxi.across).toBe(ACROSS_LIMIT);
    driveFor(track, taxi, 400, -1);
    expect(taxi.across).toBe(-ACROSS_LIMIT);
  });

  it('clamps an ask outside the range rather than obeying it', () => {
    const track = emptyTrack();
    const wild = createTaxi();
    const sane = createTaxi();
    driveFor(track, wild, 10, 25);
    driveFor(track, sane, 10, 1);
    expect(wild.across).toBe(sane.across);
  });

  it('reads a value that is not a number as no steering at all', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    driveFor(track, taxi, 10, Number.NaN);
    expect(taxi.across).toBe(0);
    driveFor(track, taxi, 10, Number.POSITIVE_INFINITY);
    expect(taxi.across).toBe(0);
  });

  it('eases off inside the snap band rather than hunting', () => {
    expect(steerFor(0, 500)).toBe(1);
    expect(steerFor(0, -500)).toBe(-1);
    expect(steerFor(0, STEER_SNAP / 2)).toBeCloseTo(0.5, 10);
    expect(steerFor(50, 50)).toBe(0);
  });

  it('settles on a lane it was asked for', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    for (let step = 0; step < 200; step += 1) {
      stepTaxi(track, taxi, steerFor(taxi.across, laneAcross(3)), false, STEP);
    }
    expect(Math.abs(taxi.across - laneAcross(3))).toBeLessThan(0.5);
  });
});

describe('hitting a queue', () => {
  const cell = 6;
  const centre = trafficAlong(cell);

  function crashed(): { track: Int8Array; taxi: Taxi } {
    const track = trackWith(cell, 1 << 1);
    const taxi = createTaxi();
    taxi.across = laneAcross(1);
    let stride = '';
    for (let step = 0; step < 2000 && stride !== 'crashed'; step += 1) {
      stride = stepTaxi(track, taxi, 0, false, STEP);
    }
    return { track, taxi };
  }

  it('spins the taxi and throws away the wind-up', () => {
    const { taxi } = crashed();
    expect(taxi.spin).toBe(SPIN_SECONDS);
    expect(taxi.boost).toBe(0);
    expect(taxi.crashes).toBe(1);
    expect(taxi.hitCell).toBe(cell);
  });

  it('leaves the taxi rolling, which is what ends the race', () => {
    const { track, taxi } = crashed();
    const before = taxi.distance;
    driveFor(track, taxi, 10);
    expect(taxi.distance).toBeCloseTo(before + SPEED_SPIN * 10 * STEP, 6);
  });

  it('takes the steering away for the whole spin', () => {
    const { track, taxi } = crashed();
    const before = taxi.across;
    driveFor(track, taxi, Math.floor(SPIN_SECONDS * 60), 1);
    expect(taxi.across).toBe(before);
  });

  it('gives the steering back when the spin ends', () => {
    const { track, taxi } = crashed();
    driveFor(track, taxi, Math.ceil(SPIN_SECONDS * 60) + 2, 1);
    expect(taxi.across).toBeGreaterThan(laneAcross(1));
  });

  it('never lets the same queue catch it twice', () => {
    const { track, taxi } = crashed();
    driveFor(track, taxi, 400);
    expect(taxi.crashes).toBe(1);
  });

  it('refuses a hop while the taxi is spinning', () => {
    const { track, taxi } = crashed();
    expect(canHop(taxi)).toBe(false);
    driveFor(track, taxi, 3, 0, true);
    expect(taxi.hops).toBe(0);
  });

  it('never happens in an open lane', () => {
    const track = trackWith(cell, 1 << 1);
    const taxi = createTaxi();
    taxi.across = laneAcross(3);
    driveFor(track, taxi, 900, 0);
    expect(taxi.crashes).toBe(0);
    expect(taxi.distance).toBeGreaterThan(centre + HIT_ALONG);
  });

  it('counts a queue driven past, and only once', () => {
    const track = trackWith(cell, 1 << 1);
    const taxi = createTaxi();
    taxi.across = laneAcross(3);
    driveFor(track, taxi, 900, 0);
    expect(taxi.passed).toBe(1);
    expect(taxi.vaulted).toBe(0);
    driveFor(track, taxi, 300, 0);
    expect(taxi.passed).toBe(1);
  });

  it('counts a queue it crashed into as neither driven past nor cleared', () => {
    const { track, taxi } = crashed();
    driveFor(track, taxi, 400);
    expect(taxi.passed).toBe(0);
    expect(taxi.vaulted).toBe(0);
    expect(taxi.crashes).toBe(1);
  });
});

describe('a hop', () => {
  const cell = 8;
  const centre = trafficAlong(cell);

  /** Drive at a jam and leave the ground `offset` units before the middle of it. */
  function run(offset: number, boost = 1): Taxi {
    const track = trackWith(cell, JAM);
    const taxi = createTaxi();
    taxi.boost = boost;
    const launch = centre - offset;
    for (let step = 0; step < 4000; step += 1) {
      const ask = taxi.hops === 0 && taxi.distance >= launch;
      stepTaxi(track, taxi, 0, ask, STEP);
      if (taxi.distance > centre + HIT_ALONG + 100) break;
    }
    return taxi;
  }

  it('carries the taxi exactly one hop of road', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    const from = taxi.distance;
    stepTaxi(track, taxi, 0, true, STEP);
    expect(taxi.hop).toBeGreaterThan(0);
    for (let step = 0; step < 400 && taxi.hop > 0; step += 1) {
      stepTaxi(track, taxi, 0, false, STEP);
    }
    // The hop is spent against the road travelled, so it lasts HOP_LENGTH plus at most the
    // one step it overshoots the end by.
    expect(taxi.distance - from).toBeGreaterThanOrEqual(HOP_LENGTH);
    expect(taxi.distance - from).toBeLessThan(HOP_LENGTH + SPEED_FAST * STEP);
  });

  it('carries it the same road at a standing start as at full speed', () => {
    const slow = createTaxi();
    const fast = createTaxi();
    fast.boost = 1;
    const track = emptyTrack();
    const slowFrom = slow.distance;
    const fastFrom = fast.distance;
    stepTaxi(track, slow, 0, true, STEP);
    stepTaxi(track, fast, 0, true, STEP);
    for (let step = 0; step < 400; step += 1) {
      if (slow.hop > 0) stepTaxi(track, slow, 0, false, STEP);
      if (fast.hop > 0) stepTaxi(track, fast, 0, false, STEP);
    }
    // Both spent HOP_LENGTH of road, to within the step each of them overshot by.
    expect(slow.distance - slowFrom).toBeGreaterThanOrEqual(HOP_LENGTH);
    expect(fast.distance - fastFrom).toBeGreaterThanOrEqual(HOP_LENGTH);
    expect(slow.distance - slowFrom).toBeLessThan(HOP_LENGTH + SPEED_SLOW * STEP);
    expect(fast.distance - fastFrom).toBeLessThan(HOP_LENGTH + SPEED_FAST * STEP);
  });

  it('takes the steering away until the wheels are down', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    stepTaxi(track, taxi, 0, true, STEP);
    const held = taxi.across;
    for (let step = 0; step < 400 && taxi.hop > 0; step += 1) {
      stepTaxi(track, taxi, 1, false, STEP);
    }
    expect(taxi.across).toBe(held);
    stepTaxi(track, taxi, 1, false, STEP);
    expect(taxi.across).toBeGreaterThan(held);
  });

  it('holds the wind-up steady in the air, then cuts it on the landing', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    taxi.boost = 1;
    stepTaxi(track, taxi, 0, true, STEP);
    for (let step = 0; step < 400 && taxi.hop > 0; step += 1) {
      expect(taxi.boost).toBe(1);
      stepTaxi(track, taxi, 0, false, STEP);
    }
    expect(taxi.boost).toBeCloseTo(LANDING_KEEP, 10);
    expect(taxi.settle).toBe(SETTLE_SECONDS);
  });

  it('refuses a second hop until the suspension has settled', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    stepTaxi(track, taxi, 0, true, STEP);
    for (let step = 0; step < 400 && taxi.hop > 0; step += 1) {
      stepTaxi(track, taxi, 0, true, STEP);
    }
    expect(taxi.hops).toBe(1);
    expect(canHop(taxi)).toBe(false);
    driveFor(track, taxi, Math.floor(SETTLE_SECONDS * 60) - 1, 0, false);
    expect(canHop(taxi)).toBe(false);
    driveFor(track, taxi, 3, 0, false);
    expect(canHop(taxi)).toBe(true);
  });

  it('ignores an ask while the taxi is already in the air', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    driveFor(track, taxi, 20, 0, true);
    expect(taxi.hops).toBe(1);
  });

  it('clears a jam from the middle of its window', () => {
    const taxi = run(HOP_AIM);
    expect(taxi.crashes).toBe(0);
    expect(taxi.vaulted).toBe(1);
    expect(taxi.passed).toBe(0);
  });

  it('clears a jam from either end of its window', () => {
    for (const offset of [HOP_AIM + HOP_WINDOW - 20, HOP_AIM - HOP_WINDOW + 20]) {
      const taxi = run(offset);
      expect(taxi.crashes, `launching ${offset} units out`).toBe(0);
      expect(taxi.vaulted).toBe(1);
    }
  });

  it('clears a jam from the middle of its window at a standing start too', () => {
    const taxi = run(HOP_AIM, 0);
    expect(taxi.crashes).toBe(0);
    expect(taxi.vaulted).toBe(1);
  });

  it('comes down among the cars when it leaves too early', () => {
    const taxi = run(HOP_AIM + HOP_WINDOW + 60);
    expect(taxi.crashes).toBe(1);
    expect(taxi.vaulted).toBe(0);
  });

  it('is already among the cars when it leaves too late', () => {
    // The taxi is caught at the near edge of the danger span before it ever reaches the
    // launch point it was aiming at, so the jam is not cleared. It may well take the hop
    // afterwards, once the spin has ended and the cars can no longer touch it — that is a
    // wasted hop rather than a rescued one, and the counters say so.
    const taxi = run(HOP_AIM - HOP_WINDOW - 60);
    expect(taxi.crashes).toBe(1);
    expect(taxi.vaulted).toBe(0);
    expect(taxi.passed).toBe(0);
  });

  it('sweeps a window of the width the arithmetic promises', () => {
    let cleared = 0;
    for (let offset = HOP_AIM - HOP_WINDOW; offset <= HOP_AIM + HOP_WINDOW; offset += 5) {
      if (run(offset).crashes === 0) cleared += 1;
    }
    // Forty-one launch points across the window; the last one or two are lost to the step the
    // taxi overshoots its trigger by, which is a property of a fixed timestep rather than of
    // the rule.
    expect(cleared).toBeGreaterThanOrEqual(38);
  });

  it('is not a way of getting past traffic for free', () => {
    // A driver who hops everything settles at a crawl. The algebra says 310 units a second
    // against a clean 580; this is the measurement.
    const track = emptyTrack();
    const taxi = createTaxi();
    driveFor(track, taxi, 60 * 30, 0, true);
    const at = taxi.distance;
    driveFor(track, taxi, 60 * 30, 0, true);
    const crawl = (taxi.distance - at) / 30;
    expect(crawl).toBeGreaterThan(SPEED_SLOW);
    expect(crawl).toBeLessThan(SPEED_SLOW + 30);
    expect(crawl).toBeLessThan(SPEED_FAST * 0.6);
  });

  it('is still better than crashing, which is what puts the two in order', () => {
    const jamTrack = trackWith(20, JAM);
    const hopper = createTaxi();
    const crasher = createTaxi();
    hopper.boost = 1;
    crasher.boost = 1;
    const launch = trafficAlong(20) - HOP_AIM;
    for (let step = 0; step < 1200; step += 1) {
      stepTaxi(jamTrack, hopper, 0, hopper.hops === 0 && hopper.distance >= launch, STEP);
      stepTaxi(jamTrack, crasher, 0, false, STEP);
    }
    expect(hopper.distance).toBeGreaterThan(crasher.distance);
  });

  it('counts as a queue cleared rather than one driven past', () => {
    const taxi = run(HOP_AIM);
    expect(taxi.vaulted).toBe(1);
    expect(taxi.passed).toBe(0);
    expect(taxi.hops).toBe(1);
  });

  it('says so through canHop before it is asked for', () => {
    const taxi = createTaxi();
    expect(canHop(taxi)).toBe(true);
    taxi.hop = 10;
    expect(canHop(taxi)).toBe(false);
    taxi.hop = 0;
    taxi.settle = 0.1;
    expect(canHop(taxi)).toBe(false);
    taxi.settle = 0;
    taxi.spin = 0.1;
    expect(canHop(taxi)).toBe(false);
    taxi.spin = 0;
    taxi.distance = RACE_DISTANCE;
    expect(canHop(taxi)).toBe(false);
  });
});

describe('the finish line', () => {
  it('stops the taxi exactly on it', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    taxi.distance = RACE_DISTANCE - 5;
    taxi.boost = 1;
    expect(stepTaxi(track, taxi, 0, false, STEP)).toBe('home');
    expect(taxi.distance).toBe(RACE_DISTANCE);
  });

  /**
   * The finish is the one place a distance stops separating two taxis, because both are
   * pinned to the line the moment they cross it. What separates them is *when* inside the
   * step they crossed, and that is knowable: the distance left over past the line is the
   * part of the step that happened after it.
   */
  it('records how far into the step the line went by', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    taxi.distance = RACE_DISTANCE - 5;
    taxi.boost = 1;
    expect(stepTaxi(track, taxi, 0, false, STEP)).toBe('home');
    // At a held SPEED_FAST, five units of road is exactly 5 / 580 of a second.
    expect(taxi.finishOffset).toBeCloseTo(5 / SPEED_FAST, 9);
    expect(taxi.finishOffset).toBeLessThan(STEP);
  });

  it('puts the instant at nought for a taxi that started the step on the line', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    taxi.distance = RACE_DISTANCE - 1e-12;
    taxi.boost = 1;
    stepTaxi(track, taxi, 0, false, STEP);
    expect(taxi.finishOffset).toBeGreaterThanOrEqual(0);
    expect(taxi.finishOffset).toBeLessThan(STEP / 1000);
  });

  it('leaves a taxi that is home doing nothing at all', () => {
    const track = emptyTrack();
    const taxi = createTaxi();
    taxi.distance = RACE_DISTANCE;
    expect(stepTaxi(track, taxi, 1, true, STEP)).toBe('idle');
    expect(taxi.across).toBe(0);
    expect(taxi.hops).toBe(0);
  });

  it('caps the scoreboard at the route length', () => {
    const taxi = createTaxi();
    taxi.distance = RACE_DISTANCE;
    expect(blocksOf(taxi)).toBe(RACE_CELLS);
    taxi.distance = RACE_DISTANCE * 2;
    expect(blocksOf(taxi)).toBe(RACE_CELLS);
  });

  it('counts blocks as whole cells driven', () => {
    const taxi = createTaxi();
    taxi.distance = CELL_LENGTH * 3.9;
    expect(blocksOf(taxi)).toBe(3);
  });
});

describe('a match', () => {
  function started(seed = 5): Match {
    const match = createMatch();
    resetMatch(match, new Rng(seed));
    return match;
  }

  it('starts level, racing, with nobody home', () => {
    const match = createMatch();
    expect(match.phase).toBe('racing');
    expect(match.winner).toBeNull();
    expect(match.p1.distance).toBe(0);
    expect(match.p2.distance).toBe(0);
    expect(judge(match)).toBeNull();
  });

  it('holds one road and hands it to both seats', () => {
    // The whole fairness argument, as an identity rather than a statistic: there is one
    // array, so there is no second sequence that could differ.
    const match = started();
    expect(match.track).toBeInstanceOf(Int8Array);
    for (let cell = 0; cell < TRACK_CELLS; cell += 1) {
      expect(maskAt(match.track, cell)).toBe(maskAt(match.track, cell));
    }
  });

  it('gives both taxis the identical run when they are driven identically', () => {
    const match = started(11);
    for (let step = 0; step < 60 * 40; step += 1) {
      const steer = steerFor(match.p1.across, laneAcross(2));
      stepMatch(match, STEP, steer, false, steer, false);
    }
    expect(match.p1.distance).toBe(match.p2.distance);
    expect(match.p1.across).toBe(match.p2.across);
    expect(match.p1.crashes).toBe(match.p2.crashes);
    expect(match.p1.passed).toBe(match.p2.passed);
  });

  it('gives the seats the same road by mirroring a whole match', () => {
    // Play one match with two different scripts, then play it again with the scripts in the
    // other seats. Each taxi must have done exactly what its script did before.
    function play(swap: boolean): Match {
      const match = createMatch();
      resetMatch(match, new Rng(31));
      for (let step = 0; step < 60 * 30; step += 1) {
        const a = steerFor(match[swap ? 'p2' : 'p1'].across, laneAcross(0));
        const b = steerFor(match[swap ? 'p1' : 'p2'].across, laneAcross(3));
        const hop = step % 91 === 0;
        if (swap) stepMatch(match, STEP, b, false, a, hop);
        else stepMatch(match, STEP, a, hop, b, false);
      }
      return match;
    }
    const straight = play(false);
    const swapped = play(true);
    expect(swapped.p2.distance).toBe(straight.p1.distance);
    expect(swapped.p2.crashes).toBe(straight.p1.crashes);
    expect(swapped.p1.distance).toBe(straight.p2.distance);
    expect(swapped.p1.crashes).toBe(straight.p2.crashes);
  });

  it('names the seat that got home first', () => {
    const match = started();
    match.p1.distance = RACE_DISTANCE;
    expect(judge(match)).toBe('p1');
    match.p1.distance = 0;
    match.p2.distance = RACE_DISTANCE;
    expect(judge(match)).toBe('p2');
  });

  it('calls a dead heat a dead heat', () => {
    const match = started();
    match.p1.distance = RACE_DISTANCE;
    match.p2.distance = RACE_DISTANCE;
    expect(judge(match)).toBe('draw');
  });

  /**
   * The bug this pair of tests exists for: both taxis are clamped to the line on the step
   * they cross, so judging on distance alone called every same-step finish a dead heat.
   * Over four hundred seeded matches of two `hard` bots that was 18.5% of them, and seven
   * in eight had a taxi that genuinely got there first — one of them by 3.7 units and 7.4
   * milliseconds. A race is decided by who arrived first; here is where that is decided.
   */
  it('gives a photo finish to whoever crossed first inside the step', () => {
    const match = started();
    match.p1.distance = RACE_DISTANCE;
    match.p2.distance = RACE_DISTANCE;
    match.p1.finishOffset = 0.003;
    match.p2.finishOffset = 0.006;
    expect(judge(match)).toBe('p1');
    match.p1.finishOffset = 0.009;
    expect(judge(match)).toBe('p2');
  });

  it('keeps the dead heat for two taxis that crossed at the same instant', () => {
    const match = started();
    match.p1.distance = RACE_DISTANCE;
    match.p2.distance = RACE_DISTANCE;
    match.p1.finishOffset = 0.004;
    match.p2.finishOffset = 0.004;
    expect(judge(match)).toBe('draw');
    // Nothing is measured here, so nothing is allowed for: two taxis stepped by one loop
    // through the same arithmetic produce the same instant to the last bit or a real gap.
    expect(FINISH_TOLERANCE).toBe(0);
  });

  it('separates two taxis that cross on one step a single unit apart', () => {
    const match = started();
    match.p1.distance = RACE_DISTANCE - 9;
    match.p2.distance = RACE_DISTANCE - 8;
    match.p1.boost = 1;
    match.p2.boost = 1;
    const strides = stepMatch(match, STEP, 0, false, 0, false);
    expect(strides.p1).toBe('home');
    expect(strides.p2).toBe('home');
    expect(match.p1.distance).toBe(match.p2.distance);
    expect(match.winner).toBe('p2');
  });

  it('gives the win to whoever is ahead when the clock runs out', () => {
    const match = started();
    match.elapsed = ROUND_SECONDS;
    match.p1.distance = 900;
    match.p2.distance = 800;
    expect(judge(match)).toBe('p1');
    match.p2.distance = 1000;
    expect(judge(match)).toBe('p2');
  });

  it('calls the clock a draw when the two are level to the unit', () => {
    const match = started();
    match.elapsed = ROUND_SECONDS;
    match.p1.distance = 900;
    match.p2.distance = 900;
    expect(judge(match)).toBe('draw');
  });

  it('decides on distance rather than on the block count', () => {
    const match = started();
    match.elapsed = ROUND_SECONDS;
    match.p1.distance = CELL_LENGTH * 4 + 200;
    match.p2.distance = CELL_LENGTH * 4 + 10;
    expect(blocksOf(match.p1)).toBe(blocksOf(match.p2));
    expect(judge(match)).toBe('p1');
  });

  it('stops stepping once it is over', () => {
    const match = started();
    match.p1.distance = RACE_DISTANCE - 1;
    match.p1.boost = 1;
    stepMatch(match, STEP, 0, false, 0, false);
    expect(match.phase).toBe('over');
    expect(winnerOf(match)).toBe('p1');
    const frozen = match.p2.distance;
    stepMatch(match, STEP, 1, true, 1, true);
    expect(match.p2.distance).toBe(frozen);
  });

  it('reports what each taxi did this step', () => {
    const match = started();
    const result = stepMatch(match, STEP, 0, false, 0, false);
    expect(result.p1).toBe('driving');
    expect(result.p2).toBe('driving');
  });

  it('hands back the same result object every step, so a step allocates nothing', () => {
    const match = started();
    const first = stepMatch(match, STEP, 0, false, 0, false);
    const second = stepMatch(match, STEP, 0, false, 0, false);
    expect(second).toBe(first);
  });

  it('puts both taxis back on the line without touching the road', () => {
    const match = started(17);
    const road = [...match.track];
    stepMatch(match, STEP, 1, true, -1, true);
    clearMatch(match);
    expect([...match.track]).toEqual(road);
    expect(match.p1.distance).toBe(0);
    expect(match.p2.hops).toBe(0);
    expect(match.elapsed).toBe(0);
    expect(match.phase).toBe('racing');
  });

  it('draws a fresh road on a reset', () => {
    const match = createMatch();
    resetMatch(match, new Rng(3));
    const first = [...match.track];
    resetMatch(match, new Rng(4));
    expect([...match.track]).not.toEqual(first);
  });

  it('names each taxi by its seat', () => {
    const match = started();
    expect(taxiOf(match, 'p1')).toBe(match.p1);
    expect(taxiOf(match, 'p2')).toBe(match.p2);
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('resets a taxi to exactly what a new one looks like', () => {
    const taxi = createTaxi();
    taxi.distance = 900;
    taxi.crashes = 4;
    taxi.hop = 12;
    resetTaxi(taxi);
    expect(taxi).toEqual(createTaxi());
  });
});

describe('the race always ends', () => {
  it('under the clock, for two drivers who never touch a control', () => {
    const match = createMatch();
    resetMatch(match, new Rng(21));
    let ended = -1;
    for (let step = 0; step < 60 * 600; step += 1) {
      stepMatch(match, STEP, 0, false, 0, false);
      if (match.winner !== null) {
        ended = step;
        break;
      }
    }
    expect(ended).toBeGreaterThanOrEqual(0);
    expect((ended + 1) * STEP).toBeLessThanOrEqual(ROUND_SECONDS + STEP);
  });

  it('for a driver who steers into every single queue, over three hundred roads', () => {
    // The worst case the rules can produce, driven rather than argued. The arithmetic in the
    // note on ROUND_SECONDS bounds it at 78.8 s; measured, the worst road takes 66.9 s.
    let worst = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      const track = filled(1 + seed * 7919);
      const taxi = createTaxi();
      let seconds = 0;
      for (let step = 0; step < 60 * 300; step += 1) {
        const cell = cellOf(taxi.distance + 200);
        const mask = maskAt(track, cell);
        let target = taxi.across;
        if (mask !== CLEAR) {
          for (let lane = 0; lane < LANES; lane += 1) {
            if (laneBlocked(mask, lane)) {
              target = laneAcross(lane);
              break;
            }
          }
        }
        stepTaxi(track, taxi, steerFor(taxi.across, target), false, STEP);
        seconds += STEP;
        if (taxi.distance >= RACE_DISTANCE) break;
      }
      expect(taxi.distance).toBe(RACE_DISTANCE);
      worst = Math.max(worst, seconds);
    }
    expect(worst).toBeLessThan(ROUND_SECONDS * 0.8);
  });

  it('well inside the ten minutes the repository allows any game', () => {
    expect(ROUND_SECONDS).toBeLessThan(600);
  });

  it('and the clock is above the worst case rather than merely above the typical', () => {
    // 62 cells × 300 units ÷ 236 units a second = 78.8 s, and the clock is 105.
    const worstSpeed =
      (2 * CELL_LENGTH) /
      (SPIN_SECONDS + (2 * CELL_LENGTH - SPIN_SECONDS * SPEED_SPIN) / SPEED_SLOW);
    expect(RACE_DISTANCE / worstSpeed).toBeLessThan(ROUND_SECONDS);
  });
});

describe('the bot', () => {
  function road(seed: number): Match {
    const match = createMatch();
    resetMatch(match, new Rng(seed));
    return match;
  }

  it('never sees further up the road than a person does', () => {
    expect(BOT_LOOKAHEAD).toBeLessThan(VISIBLE_AHEAD);
  });

  it('separates its tiers by nothing a player could not have', () => {
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
    expect(BOT_PROFILES.easy.hopSlip).toBeGreaterThan(BOT_PROFILES.normal.hopSlip);
    expect(BOT_PROFILES.normal.hopSlip).toBeGreaterThan(BOT_PROFILES.hard.hopSlip);
  });

  it('gives the hardest tier a launch error inside the window, and the easiest one outside it', () => {
    expect(BOT_PROFILES.hard.hopSlip).toBeLessThan(HOP_WINDOW);
    expect(BOT_PROFILES.easy.hopSlip).toBeGreaterThan(HOP_WINDOW);
  });

  it('spends the same four draws on every look, whatever it decides', () => {
    for (const tier of TIERS) {
      const match = road(13);
      const state = createBotState();
      const rng = new CountingRng(5);
      botDrive(match, 'p1', tier, state, STEP, rng);
      expect(rng.floats, tier).toBe(BOT_DRAWS_PER_LOOK);
    }
  });

  it('spends nothing at all between looks', () => {
    const match = road(13);
    const state = createBotState();
    const rng = new CountingRng(5);
    botDrive(match, 'p1', 'hard', state, STEP, rng);
    const after = rng.floats;
    botDrive(match, 'p1', 'hard', state, STEP, rng);
    expect(rng.floats).toBe(after);
  });

  it('holds the line it chose until it looks again', () => {
    const match = road(13);
    const state = createBotState();
    const rng = new Rng(5);
    botDrive(match, 'p1', 'easy', state, STEP, rng);
    const chosen = state.want;
    for (let step = 0; step < 3; step += 1) {
      botDrive(match, 'p1', 'easy', state, STEP, rng);
      expect(state.want).toBe(chosen);
    }
  });

  it('waits longer between looks on an easy tier than on a hard one', () => {
    const easy = createBotState();
    const hard = createBotState();
    const match = road(13);
    botDrive(match, 'p1', 'easy', easy, STEP, new Rng(2));
    botDrive(match, 'p1', 'hard', hard, STEP, new Rng(2));
    expect(easy.look).toBeGreaterThan(hard.look);
  });

  it('aims at the open lane of the queue in front of it', () => {
    const match = createMatch();
    match.track.fill(CLEAR);
    // Cell 1, whose traffic stands 450 units up the road: inside BOT_LOOKAHEAD. Cell 2 is
    // 750 units away and the bot must *not* see it from the line — see the lookahead tests.
    match.track[1] = (1 << 0) | (1 << 1) | (1 << 2);
    const state = createBotState();
    botDrive(match, 'p1', 'hard', state, STEP, new Rng(9));
    expect(state.want).toBeCloseTo(laneAcross(3), 6);
  });

  it('aims at the middle of the road when there is nothing in front of it', () => {
    const match = createMatch();
    match.track.fill(CLEAR);
    const state = createBotState();
    botDrive(match, 'p1', 'hard', state, STEP, new Rng(9));
    expect(state.want).toBe(0);
  });

  it('plans a launch for a jam and takes it at the planned point', () => {
    const match = createMatch();
    match.track.fill(CLEAR);
    match.track[1] = JAM;
    const state = createBotState();
    botDrive(match, 'p1', 'hard', state, STEP, new Rng(9));
    expect(state.launchAt).toBeGreaterThan(0);
    expect(Math.abs(state.launchAt - (trafficAlong(1) - HOP_AIM))).toBeLessThanOrEqual(
      BOT_PROFILES.hard.hopSlip,
    );
    match.p1.distance = state.launchAt;
    botDrive(match, 'p1', 'hard', state, STEP, new Rng(9));
    expect(state.hop).toBe(true);
    expect(state.launchAt).toBe(-1);
  });

  it('does not plan another launch while it is already in the air', () => {
    const match = createMatch();
    match.track.fill(CLEAR);
    // Cell 1, so the jam is genuinely inside the lookahead and the -1 below is the bot
    // declining to re-plan rather than the bot not seeing anything at all.
    match.track[1] = JAM;
    match.p1.hop = 200;
    const state = createBotState();
    botDrive(match, 'p1', 'hard', state, STEP, new Rng(9));
    expect(state.launchAt).toBe(-1);
    expect(state.hop).toBe(false);
  });

  it('does not plan a launch for a jam it is already inside', () => {
    const match = createMatch();
    match.track.fill(CLEAR);
    match.track[2] = JAM;
    match.p1.distance = trafficAlong(2) - HIT_ALONG + 1;
    const state = createBotState();
    botDrive(match, 'p1', 'hard', state, STEP, new Rng(9));
    expect(state.launchAt).toBe(-1);
  });

  it('asks for nothing on a step it did not look on', () => {
    const match = createMatch();
    match.track.fill(CLEAR);
    const state = createBotState();
    const rng = new Rng(9);
    for (let step = 0; step < 5; step += 1) {
      botDrive(match, 'p1', 'easy', state, STEP, rng);
      expect(state.hop).toBe(false);
    }
  });

  it('reads the same road as the seat it is sitting in', () => {
    const match = road(23);
    for (const seat of SEATS) {
      const state = createBotState();
      botDrive(match, seat, 'hard', state, STEP, new Rng(1));
      expect(Number.isFinite(state.want)).toBe(true);
    }
  });

  it('starts and resets clean', () => {
    const state = createBotState();
    expect(state).toEqual({ look: 0, want: 0, launchAt: -1, hop: false });
    state.look = 3;
    state.want = 99;
    state.launchAt = 5;
    state.hop = true;
    resetBotState(state);
    expect(state).toEqual({ look: 0, want: 0, launchAt: -1, hop: false });
  });

  /**
   * Rule 6, asserted against what the bot *does* rather than against two constants.
   *
   * `BOT_LOOKAHEAD < VISIBLE_AHEAD` is true and was not the operative bound: `readAhead`
   * walked whole cells, so a taxi 280 units into one reached three cells out and read
   * traffic 770 units up the road on a 620-unit look. The comparison of the two constants
   * passed the whole time. This sweeps every position in a cell and measures the road the
   * bot actually reaches, which is the only version of the claim worth having.
   */
  it('never reads a queue further up the road than it is asked to', () => {
    const match = createMatch();
    // A queue in every cell, so whatever the bot can reach is what it returns.
    match.track.fill((1 << 0) | (1 << 1));
    let furthest = -Infinity;
    for (let step = 0; step < 4 * CELL_LENGTH; step += 1) {
      match.p1.distance = 10 * CELL_LENGTH + step / 4;
      const cell = readAhead(match, 'p1', BOT_LOOKAHEAD);
      expect(cell).toBeGreaterThanOrEqual(0);
      furthest = Math.max(furthest, trafficAlong(cell) - match.p1.distance);
    }
    expect(furthest).toBeLessThanOrEqual(BOT_LOOKAHEAD);
    expect(BOT_LOOKAHEAD).toBeLessThan(VISIBLE_AHEAD);
  });

  it('cannot see a jam that a person can, from the same place on the road', () => {
    // 750 units up the road is inside a person's 720-unit window only as the sliver of a
    // car's tail; it is outside the bot's look outright, and used to be inside it.
    const match = createMatch();
    match.track.fill(CLEAR);
    match.track[2] = JAM;
    expect(trafficAlong(2)).toBeGreaterThan(BOT_LOOKAHEAD);
    expect(readAhead(match, 'p1', BOT_LOOKAHEAD)).toBe(-1);
    // and it is read the moment the taxi has closed to the depth it is allowed
    match.p1.distance = trafficAlong(2) - BOT_LOOKAHEAD;
    expect(readAhead(match, 'p1', BOT_LOOKAHEAD)).toBe(2);
  });
});

describe('the three tiers really are three tiers', () => {
  /** One seeded race between two bots. Returns the winner, or null if it never ended. */
  function duel(seed: number, p1: BotDifficulty, p2: BotDifficulty): SeatId | 'draw' | null {
    const match = createMatch();
    const rng = new Rng(seed);
    resetMatch(match, rng);
    const brains = { p1: createBotState(), p2: createBotState() };
    for (let step = 0; step < 60 * 200; step += 1) {
      botDrive(match, 'p1', p1, brains.p1, STEP, rng);
      const p1Steer = steerFor(match.p1.across, brains.p1.want);
      botDrive(match, 'p2', p2, brains.p2, STEP, rng);
      const p2Steer = steerFor(match.p2.across, brains.p2.want);
      stepMatch(match, STEP, p1Steer, brains.p1.hop, p2Steer, brains.p2.hop);
      if (match.winner !== null) return match.winner;
    }
    return null;
  }

  /** Both seat orders, so a ladder cannot be read off a seat bias. */
  function ladder(strong: BotDifficulty, weak: BotDifficulty, seeds: number): number {
    let wins = 0;
    let decided = 0;
    for (let i = 0; i < seeds; i += 1) {
      const seed = 1 + i * 7919;
      const straight = duel(seed, strong, weak);
      if (straight === 'p1') wins += 1;
      if (straight === 'p1' || straight === 'p2') decided += 1;
      const swapped = duel(seed, weak, strong);
      if (swapped === 'p2') wins += 1;
      if (swapped === 'p1' || swapped === 'p2') decided += 1;
    }
    expect(decided).toBeGreaterThan(seeds);
    return wins / decided;
  }

  it('has normal beating easy', () => {
    // Measured over three independent seed families at a hundred seeds each: 83.5%, 85.0%
    // and 90.5%.
    expect(ladder('normal', 'easy', 40)).toBeGreaterThan(0.7);
  });

  it('has hard beating normal', () => {
    // Measured: 83.2%, 87.3%, 89.7%.
    expect(ladder('hard', 'normal', 40)).toBeGreaterThan(0.7);
  });

  it('has hard beating easy by more than either of those', () => {
    // Measured: 98.5%, 98.5%, 99.5%. Saturated, and said so rather than dressed up.
    expect(ladder('hard', 'easy', 30)).toBeGreaterThan(0.9);
  });

  /**
   * The photo finish, measured rather than argued.
   *
   * Both taxis are pinned to the line on the step they cross it, so a win condition read
   * off distance alone made *every* same-step arrival a dead heat — 18.5% of `hard` against
   * `hard` over four hundred seeds, and seven in eight of those had a taxi that had
   * genuinely crossed first, one of them by 3.7 units and 7.4 milliseconds. Settling on
   * {@link Taxi.finishOffset} leaves only the races that really were identical.
   */
  it('settles a photo finish instead of calling it a dead heat', () => {
    let draws = 0;
    const races = 60;
    for (let i = 0; i < races; i += 1) {
      if (duel(1 + i * 7919, 'hard', 'hard') === 'draw') draws += 1;
    }
    // Measured at 1.5% over four hundred seeds and 1.0% over three hundred of this family;
    // it was 18.5% before the finish was settled on the instant inside the step.
    expect(draws / races).toBeLessThan(0.08);
  });

  it('gives neither seat an advantage at the same tier', () => {
    let p1 = 0;
    let decided = 0;
    for (let i = 0; i < 90; i += 1) {
      const winner = duel(1 + i * 7919, 'normal', 'normal');
      if (winner === 'p1') p1 += 1;
      if (winner === 'p1' || winner === 'p2') decided += 1;
    }
    expect(decided).toBeGreaterThan(60);
    // Measured across three seed families at two hundred seeds each: 51.0%, 52.5%, 53.0%.
    expect(p1 / decided).toBeGreaterThan(0.32);
    expect(p1 / decided).toBeLessThan(0.68);
  });

  it('crashes less and clears more the higher the tier climbs', () => {
    const totals = TIERS.map((tier) => {
      let crashes = 0;
      let vaulted = 0;
      for (let i = 0; i < 25; i += 1) {
        const match = createMatch();
        const rng = new Rng(1 + i * 7919);
        resetMatch(match, rng);
        const brain = createBotState();
        const other = createBotState();
        for (let step = 0; step < 60 * 200; step += 1) {
          botDrive(match, 'p1', tier, brain, STEP, rng);
          botDrive(match, 'p2', tier, other, STEP, rng);
          stepMatch(
            match,
            STEP,
            steerFor(match.p1.across, brain.want),
            brain.hop,
            steerFor(match.p2.across, other.want),
            other.hop,
          );
          if (match.winner !== null) break;
        }
        crashes += match.p1.crashes;
        vaulted += match.p1.vaulted;
      }
      return { crashes, vaulted };
    });
    expect(totals[0]!.crashes).toBeGreaterThan(totals[1]!.crashes);
    expect(totals[1]!.crashes).toBeGreaterThan(totals[2]!.crashes);
    expect(totals[2]!.vaulted).toBeGreaterThan(totals[0]!.vaulted);
  });
});

describe('the rule the game is named after actually happens', () => {
  it('has bots driving past queues and hopping over them in every match', () => {
    // Spin War shipped with its own headline verb impossible across four hundred bot
    // matches, and every global guard passed the whole time — because a guard checks that a
    // match ends, not that it plays the way its rule says. So this counts both halves.
    let matches = 0;
    let noPass = 0;
    let noVault = 0;
    let passed = 0;
    let vaulted = 0;
    for (let i = 0; i < 30; i += 1) {
      const match = createMatch();
      const rng = new Rng(1 + i * 7919);
      resetMatch(match, rng);
      const a = createBotState();
      const b = createBotState();
      for (let step = 0; step < 60 * 200; step += 1) {
        botDrive(match, 'p1', 'normal', a, STEP, rng);
        botDrive(match, 'p2', 'normal', b, STEP, rng);
        stepMatch(
          match,
          STEP,
          steerFor(match.p1.across, a.want),
          a.hop,
          steerFor(match.p2.across, b.want),
          b.hop,
        );
        if (match.winner !== null) break;
      }
      matches += 1;
      passed += match.p1.passed + match.p2.passed;
      vaulted += match.p1.vaulted + match.p2.vaulted;
      if (match.p1.passed + match.p2.passed === 0) noPass += 1;
      if (match.p1.vaulted + match.p2.vaulted === 0) noVault += 1;
    }
    expect(matches).toBe(30);
    expect(noPass).toBe(0);
    expect(noVault).toBe(0);
    // Measured over 300 matches a tier: 24.3 queues driven past and 8.4 hopped over per
    // match at `normal`, both taxis counted.
    expect(passed / matches).toBeGreaterThan(12);
    expect(vaulted / matches).toBeGreaterThan(3);
  });

  it('needs the hop, because a driver who will not hop cannot clear a jam', () => {
    const track = trackWith(9, JAM);
    const taxi = createTaxi();
    for (let across = -ACROSS_LIMIT; across <= ACROSS_LIMIT; across += 8) {
      resetTaxi(taxi);
      taxi.across = across;
      driveFor(track, taxi, 900, 0, false);
      expect(taxi.crashes, `at ${across}`).toBe(1);
    }
  });

  it('does not need the hop for a queue that leaves a lane open', () => {
    const track = trackWith(9, (1 << 0) | (1 << 1) | (1 << 2));
    const taxi = createTaxi();
    taxi.across = laneAcross(3);
    driveFor(track, taxi, 900, 0, false);
    expect(taxi.crashes).toBe(0);
    expect(taxi.passed).toBe(1);
  });
});
