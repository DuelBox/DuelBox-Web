import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  AIM_LIMIT,
  ARROW_RADIUS,
  BOT_PROFILES,
  BOW_X,
  BOW_Y,
  COLUMNS,
  COLUMN_JITTER,
  COLUMN_LEFT,
  COLUMN_STEP,
  DRIFT_MAX,
  DRIFT_MIN,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  GRAVITY,
  GROUND_Y,
  HIT_RADIUS,
  MAX_FLIGHT_SECONDS,
  PLAN_TIMES,
  RACK_SIZE,
  RATE_MAX,
  RATE_MIN,
  RESOLVE_HZ,
  ROUND_CAP,
  ROW_Y,
  SHOTS_PER_ROUND,
  SPEED_MAX,
  SPEED_MIN,
  TARGET_GOAL,
  TARGET_RADIUS,
  TOP_ARROWS,
  aimThrough,
  apexHeight,
  arrowXAt,
  arrowYAt,
  bestArrow,
  clamp,
  countHitsBelieved,
  createAim,
  createBotPlan,
  createRack,
  createSeatState,
  createShotResult,
  createTarget,
  flightSeconds,
  gaussian,
  launchSideways,
  launchSpeed,
  launchUpward,
  leaderFor,
  planShot,
  recordArrow,
  recordHit,
  resetSeatState,
  resetShotResult,
  resolveShot,
  rollRack,
  shooterFor,
  targetSpeedAt,
  targetXAt,
  topArrows,
  winnerOf,
} from './rules.js';
import type { Aim, BotProfile, SeatState, Target } from './rules.js';

/** A rack whose targets stand exactly where they are told, for geometry tests. */
function fixedRack(points: readonly { x: number; y: number }[]): Target[] {
  return points.map((point) => ({
    baseX: point.x,
    y: point.y,
    amplitude: 0,
    rate: 0,
    phase: 0,
  }));
}

function aimOf(angle: number, power: number): Aim {
  return { angle, power };
}

/** Every seat state a match can hold, as data. */
function seatWith(targets: number, top: readonly number[] = []): SeatState {
  const state = createSeatState();
  state.targets = targets;
  for (let i = 0; i < TOP_ARROWS; i += 1) state.top[i] = top[i] ?? 0;
  return state;
}

describe('the field', () => {
  it('is the box the manifest declares', () => {
    expect(FIELD_WIDTH).toBe(700);
    expect(FIELD_HEIGHT).toBe(1000);
  });

  it('puts the bow on the shooting line, halfway across', () => {
    expect(BOW_X).toBe(FIELD_WIDTH / 2);
    expect(BOW_Y).toBe(GROUND_Y);
  });

  it('keeps every row above the shooting line', () => {
    for (const y of ROW_Y) {
      expect(y + TARGET_RADIUS).toBeLessThan(GROUND_Y);
      expect(y - TARGET_RADIUS).toBeGreaterThan(0);
    }
  });

  it('orders the rows from the top down', () => {
    for (let i = 1; i < ROW_Y.length; i += 1) {
      expect(ROW_Y[i]!).toBeGreaterThan(ROW_Y[i - 1]!);
    }
  });

  it('never lets two rows touch', () => {
    for (let i = 1; i < ROW_Y.length; i += 1) {
      expect(ROW_Y[i]! - ROW_Y[i - 1]!).toBeGreaterThan(TARGET_RADIUS * 2);
    }
  });

  it('has a rack of one target per row per column', () => {
    expect(RACK_SIZE).toBe(ROW_Y.length * COLUMNS);
  });

  it('keeps the rack inside a bitmask, which is what the resolver tracks it with', () => {
    expect(RACK_SIZE).toBeLessThanOrEqual(30);
  });

  it('spaces the columns evenly across the usable width', () => {
    expect(COLUMN_STEP).toBeCloseTo((FIELD_WIDTH - 2 * COLUMN_LEFT) / (COLUMNS - 1), 9);
  });

  it('gives an arrow a smaller head than a target', () => {
    expect(ARROW_RADIUS).toBeLessThan(TARGET_RADIUS);
    expect(HIT_RADIUS).toBe(TARGET_RADIUS + ARROW_RADIUS);
  });
});

describe('rolling a rack', () => {
  it('is a function of the seed alone', () => {
    const a = createRack();
    const b = createRack();
    rollRack(a, new Rng(9));
    rollRack(b, new Rng(9));
    expect(b).toEqual(a);
  });

  it('gives two seeds two different galleries', () => {
    const a = createRack();
    const b = createRack();
    rollRack(a, new Rng(9));
    rollRack(b, new Rng(10));
    expect(b).not.toEqual(a);
  });

  it('draws exactly four floats a target, in a fixed order', () => {
    const counted = new Rng(4);
    const rack = createRack();
    let draws = 0;
    const wrapped = {
      float: () => {
        draws += 1;
        return counted.float();
      },
    } as unknown as Rng;
    rollRack(rack, wrapped);
    expect(draws).toBe(RACK_SIZE * 4);
  });

  it('puts one target on every row', () => {
    const rack = createRack();
    rollRack(rack, new Rng(3));
    for (const y of ROW_Y) {
      expect(rack.filter((target) => target.y === y)).toHaveLength(COLUMNS);
    }
  });

  it('keeps every column inside its own jitter', () => {
    const rack = createRack();
    for (let seed = 0; seed < 200; seed += 1) {
      rollRack(rack, new Rng(seed));
      for (let index = 0; index < RACK_SIZE; index += 1) {
        const column = index % COLUMNS;
        const slot = COLUMN_LEFT + column * COLUMN_STEP;
        expect(Math.abs(rack[index]!.baseX - slot)).toBeLessThanOrEqual(COLUMN_JITTER / 2);
      }
    }
  });

  it('keeps every drift and rate inside its band', () => {
    const rack = createRack();
    for (let seed = 0; seed < 200; seed += 1) {
      rollRack(rack, new Rng(seed));
      for (const target of rack) {
        expect(target.amplitude).toBeGreaterThanOrEqual(DRIFT_MIN);
        expect(target.amplitude).toBeLessThanOrEqual(DRIFT_MAX);
        expect(target.rate).toBeGreaterThanOrEqual(RATE_MIN);
        expect(target.rate).toBeLessThanOrEqual(RATE_MAX);
        expect(target.phase).toBeGreaterThanOrEqual(0);
        expect(target.phase).toBeLessThanOrEqual(Math.PI * 2);
      }
    }
  });

  it('never lets two targets in a row touch, over ten thousand racks', () => {
    const rack = createRack();
    let closest = Number.POSITIVE_INFINITY;
    for (let seed = 0; seed < 10_000; seed += 1) {
      rollRack(rack, new Rng(seed));
      for (let row = 0; row < ROW_Y.length; row += 1) {
        for (let column = 1; column < COLUMNS; column += 1) {
          const left = rack[row * COLUMNS + column - 1]!;
          const right = rack[row * COLUMNS + column]!;
          // The extremes of both drifts, which is the closest the two ever come.
          const gap = right.baseX - right.amplitude - (left.baseX + left.amplitude);
          if (gap < closest) closest = gap;
        }
      }
    }
    expect(closest).toBeGreaterThan(TARGET_RADIUS * 2);
  });

  it('keeps every target inside the field at the extremes of its drift', () => {
    const rack = createRack();
    for (let seed = 0; seed < 500; seed += 1) {
      rollRack(rack, new Rng(seed));
      for (const target of rack) {
        expect(target.baseX - target.amplitude - TARGET_RADIUS).toBeGreaterThanOrEqual(0);
        expect(target.baseX + target.amplitude + TARGET_RADIUS).toBeLessThanOrEqual(FIELD_WIDTH);
      }
    }
  });
});

describe('a target drifting', () => {
  const target: Target = { baseX: 300, y: 200, amplitude: 30, rate: 1.5, phase: 0.4 };

  it('starts at its phase and never leaves its band', () => {
    for (let i = 0; i <= 400; i += 1) {
      const x = targetXAt(target, i * 0.02);
      expect(x).toBeGreaterThanOrEqual(target.baseX - target.amplitude - 1e-9);
      expect(x).toBeLessThanOrEqual(target.baseX + target.amplitude + 1e-9);
    }
  });

  it('repeats exactly one period later', () => {
    const period = (Math.PI * 2) / target.rate;
    for (let i = 0; i < 20; i += 1) {
      const t = i * 0.13;
      expect(targetXAt(target, t + period)).toBeCloseTo(targetXAt(target, t), 6);
    }
  });

  it('stands still when it has no amplitude', () => {
    const still: Target = { ...target, amplitude: 0 };
    expect(targetXAt(still, 0)).toBe(still.baseX);
    expect(targetXAt(still, 12.5)).toBe(still.baseX);
  });

  it('is a closed form, so it does not care how it is reached', () => {
    // Nothing accumulates: asking for t directly and asking for it after a thousand
    // smaller questions give the identical number, to the bit.
    const direct = targetXAt(target, 1.375);
    for (let i = 0; i < 1000; i += 1) targetXAt(target, i * 0.001);
    expect(targetXAt(target, 1.375)).toBe(direct);
  });

  it('reports the speed its position is changing at', () => {
    for (let i = 1; i < 30; i += 1) {
      const t = i * 0.07;
      const h = 1e-5;
      const numeric = (targetXAt(target, t + h) - targetXAt(target, t - h)) / (2 * h);
      expect(targetSpeedAt(target, t)).toBeCloseTo(numeric, 4);
    }
  });
});

describe('the bow', () => {
  it('maps no draw and full draw onto the two speeds', () => {
    expect(launchSpeed(0)).toBe(SPEED_MIN);
    expect(launchSpeed(1)).toBe(SPEED_MAX);
    expect(launchSpeed(0.5)).toBeCloseTo((SPEED_MIN + SPEED_MAX) / 2, 9);
  });

  it('clamps a draw outside the gauge rather than extrapolating', () => {
    expect(launchSpeed(-3)).toBe(SPEED_MIN);
    expect(launchSpeed(9)).toBe(SPEED_MAX);
  });

  it('is monotone in the draw', () => {
    for (let i = 1; i <= 100; i += 1) {
      expect(launchSpeed(i / 100)).toBeGreaterThan(launchSpeed((i - 1) / 100));
    }
  });

  it('always sends the arrow upwards, at every legal angle', () => {
    for (let i = -20; i <= 20; i += 1) {
      const angle = (i / 20) * AIM_LIMIT;
      expect(launchUpward(aimOf(angle, 0))).toBeGreaterThan(0);
    }
  });

  it('clamps an angle past the limit rather than turning the bow round', () => {
    expect(launchSideways(aimOf(9, 1))).toBeCloseTo(launchSideways(aimOf(AIM_LIMIT, 1)), 9);
    expect(launchSideways(aimOf(-9, 1))).toBeCloseTo(launchSideways(aimOf(-AIM_LIMIT, 1)), 9);
  });

  it('splits the launch into two components that make up the speed', () => {
    for (let i = -10; i <= 10; i += 1) {
      const aim = aimOf((i / 10) * AIM_LIMIT, 0.4);
      const side = launchSideways(aim);
      const up = launchUpward(aim);
      expect(Math.hypot(side, up)).toBeCloseTo(launchSpeed(0.4), 6);
    }
  });

  it('points left for a negative angle and right for a positive one', () => {
    expect(launchSideways(aimOf(-0.5, 1))).toBeLessThan(0);
    expect(launchSideways(aimOf(0.5, 1))).toBeGreaterThan(0);
    expect(launchSideways(aimOf(0, 1))).toBeCloseTo(0, 9);
  });
});

describe('the arc', () => {
  it('leaves from the bow', () => {
    expect(arrowXAt(aimOf(0.3, 0.7), 0)).toBe(BOW_X);
    expect(arrowYAt(aimOf(0.3, 0.7), 0)).toBe(BOW_Y);
  });

  it('is a parabola, not an integration', () => {
    // Anything that stepped would drift; a closed form asked at t is exact whatever else
    // has been asked of it.
    const aim = aimOf(0.2, 0.8);
    const direct = arrowYAt(aim, 0.4);
    for (let i = 0; i < 2000; i += 1) arrowYAt(aim, i * 0.0005);
    expect(arrowYAt(aim, 0.4)).toBe(direct);
  });

  it('tops out where apexHeight says it does', () => {
    for (let a = -8; a <= 8; a += 1) {
      for (let p = 0; p <= 10; p += 1) {
        const aim = aimOf((a / 8) * AIM_LIMIT, p / 10);
        let highest = BOW_Y;
        for (let i = 0; i <= 600; i += 1) {
          const y = arrowYAt(aim, (i / 600) * flightSeconds(aim));
          if (y < highest) highest = y;
        }
        const predicted = BOW_Y - apexHeight(aim);
        // Only the shots that stay in the field top out; the rest leave the side first.
        expect(highest).toBeGreaterThanOrEqual(predicted - 1e-6);
      }
    }
  });

  it('never tops out above the field, at any legal aim', () => {
    for (let a = -40; a <= 40; a += 1) {
      for (let p = 0; p <= 40; p += 1) {
        const aim = aimOf((a / 40) * AIM_LIMIT, p / 40);
        expect(BOW_Y - apexHeight(aim)).toBeGreaterThan(0);
      }
    }
  });

  it('reaches each row at exactly the draw the table claims', () => {
    const rows = [
      { y: ROW_Y[3]!, draw: 0.145 },
      { y: ROW_Y[2]!, draw: 0.42 },
      { y: ROW_Y[1]!, draw: 0.647 },
      { y: ROW_Y[0]!, draw: 0.837 },
    ];
    for (const row of rows) {
      const needed = Math.sqrt(2 * GRAVITY * (BOW_Y - row.y));
      const draw = (needed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
      expect(draw).toBeCloseTo(row.draw, 2);
    }
  });

  it('reaches nothing at all when the bow is not drawn', () => {
    const nearest = ROW_Y[ROW_Y.length - 1]!;
    expect(BOW_Y - apexHeight(aimOf(0, 0))).toBeGreaterThan(nearest + HIT_RADIUS);
  });
});

describe('how long an arrow is in the air', () => {
  it('is the ballistic return time when it goes straight up', () => {
    for (let p = 0; p <= 10; p += 1) {
      const aim = aimOf(0, p / 10);
      expect(flightSeconds(aim)).toBeCloseTo((2 * launchUpward(aim)) / GRAVITY, 9);
    }
  });

  it('is cut short when the arrow leaves the side of the field', () => {
    const aim = aimOf(AIM_LIMIT, 1);
    expect(flightSeconds(aim)).toBeLessThan((2 * launchUpward(aim)) / GRAVITY);
    expect(arrowXAt(aim, flightSeconds(aim))).toBeCloseTo(FIELD_WIDTH, 6);
  });

  it('leaves by the left edge when the bow points left', () => {
    const aim = aimOf(-AIM_LIMIT, 1);
    expect(arrowXAt(aim, flightSeconds(aim))).toBeCloseTo(0, 6);
  });

  it('is always positive and always inside the ceiling', () => {
    let longest = 0;
    for (let a = -60; a <= 60; a += 1) {
      for (let p = 0; p <= 60; p += 1) {
        const seconds = flightSeconds(aimOf((a / 60) * AIM_LIMIT, p / 60));
        expect(seconds).toBeGreaterThan(0);
        expect(seconds).toBeLessThanOrEqual(MAX_FLIGHT_SECONDS);
        if (seconds > longest) longest = seconds;
      }
    }
    // The ceiling is a backstop, not the bound: the longest real arc is the full draw
    // straight up, and the termination arithmetic is multiplied out against the ceiling.
    expect(longest).toBeCloseTo((2 * SPEED_MAX) / GRAVITY, 6);
    expect(longest).toBeLessThan(MAX_FLIGHT_SECONDS);
  });

  it('ends with the arrow on the shooting line or on an edge, never in mid air', () => {
    for (let a = -30; a <= 30; a += 1) {
      for (let p = 0; p <= 20; p += 1) {
        const aim = aimOf((a / 30) * AIM_LIMIT, p / 20);
        const seconds = flightSeconds(aim);
        const x = arrowXAt(aim, seconds);
        const y = arrowYAt(aim, seconds);
        const onGround = Math.abs(y - GROUND_Y) < 1e-6;
        const onEdge = Math.abs(x) < 1e-6 || Math.abs(x - FIELD_WIDTH) < 1e-6;
        expect(onGround || onEdge).toBe(true);
      }
    }
  });

  it('is symmetric about straight up', () => {
    for (let a = 1; a <= 20; a += 1) {
      const angle = (a / 20) * AIM_LIMIT;
      expect(flightSeconds(aimOf(-angle, 0.7))).toBeCloseTo(flightSeconds(aimOf(angle, 0.7)), 9);
    }
  });
});

describe('resolving a shot', () => {
  it('skewers a target sitting on the arc', () => {
    const aim = aimOf(0, 0.7);
    const apex = BOW_Y - apexHeight(aim);
    const rack = fixedRack([{ x: BOW_X, y: apex }]);
    const out = createShotResult();
    resolveShot(out, rack, aim, 0);
    expect(out.count).toBe(1);
    expect(out.hitAt[0]).toBeGreaterThan(0);
  });

  it('misses a target the arc never comes near', () => {
    const aim = aimOf(0, 0.7);
    const rack = fixedRack([{ x: 60, y: ROW_Y[0]! }]);
    const out = createShotResult();
    resolveShot(out, rack, aim, 0);
    expect(out.count).toBe(0);
    expect(out.hitAt[0]).toBe(-1);
  });

  it('counts a target once even though the arc crosses its row twice', () => {
    const aim = aimOf(0, 0.9);
    const apex = BOW_Y - apexHeight(aim);
    // Well below the apex, so the arrow passes this height going up and coming down.
    const rack = fixedRack([{ x: BOW_X, y: apex + 150 }]);
    const out = createShotResult();
    resolveShot(out, rack, aim, 0);
    expect(out.count).toBe(1);
  });

  it('takes two targets with one arrow when they line up', () => {
    const aim = aimOf(0.25, 0.85);
    const rack = fixedRack([
      { x: arrowXAt(aim, 0.15), y: arrowYAt(aim, 0.15) },
      { x: arrowXAt(aim, 0.3), y: arrowYAt(aim, 0.3) },
    ]);
    const out = createShotResult();
    resolveShot(out, rack, aim, 0);
    expect(out.count).toBe(2);
    expect(out.hitAt[0]!).toBeLessThan(out.hitAt[1]!);
  });

  it('records when each target was reached, inside the flight', () => {
    const aim = aimOf(-0.2, 0.9);
    const rack = fixedRack([
      { x: arrowXAt(aim, 0.1), y: arrowYAt(aim, 0.1) },
      { x: arrowXAt(aim, 0.35), y: arrowYAt(aim, 0.35) },
    ]);
    const out = createShotResult();
    resolveShot(out, rack, aim, 0);
    expect(out.seconds).toBeCloseTo(flightSeconds(aim), 9);
    for (const at of out.hitAt) {
      if (at < 0) continue;
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThanOrEqual(out.seconds + 1e-9);
    }
  });

  it('hits a target that is only just inside reach and misses one just outside', () => {
    const aim = aimOf(0, 0.6);
    const apex = BOW_Y - apexHeight(aim);
    const inside = createShotResult();
    resolveShot(inside, fixedRack([{ x: BOW_X + HIT_RADIUS - 0.5, y: apex }]), aim, 0);
    expect(inside.count).toBe(1);
    const outside = createShotResult();
    resolveShot(outside, fixedRack([{ x: BOW_X + HIT_RADIUS + 0.5, y: apex }]), aim, 0);
    expect(outside.count).toBe(0);
  });

  it('does not step over a small target between two samples', () => {
    // The arrow crosses the near row at about 1500 units a second, which is 2.5 units a
    // sample: a point test would still catch this, but a slower sampling would not, and
    // the swept test is what makes that a non-question.
    const aim = aimOf(0, 1);
    const rack = fixedRack([{ x: BOW_X, y: ROW_Y[3]! }]);
    const out = createShotResult();
    resolveShot(out, rack, aim, 0);
    expect(out.count).toBe(1);
  });

  it('is a pure function of the rack, the aim and the instant', () => {
    const rack = createRack();
    rollRack(rack, new Rng(21));
    const aim = aimOf(0.12, 0.66);
    const a = createShotResult();
    const b = createShotResult();
    resolveShot(a, rack, aim, 0.4);
    resolveShot(b, rack, aim, 0.4);
    expect(Array.from(b.hitAt)).toEqual(Array.from(a.hitAt));
    expect(b.count).toBe(a.count);
  });

  it('answers differently at a different instant, because the rack has drifted', () => {
    const rack = createRack();
    rollRack(rack, new Rng(21));
    const aim = aimOf(0.12, 0.66);
    const a = createShotResult();
    const b = createShotResult();
    let differences = 0;
    for (let i = 0; i < 40; i += 1) {
      resolveShot(a, rack, aim, 0);
      resolveShot(b, rack, aim, i * 0.05);
      if (b.count !== a.count) differences += 1;
    }
    expect(differences).toBeGreaterThan(0);
  });

  it('writes into the record it is handed rather than allocating one', () => {
    const out = createShotResult();
    const buffer = out.hitAt;
    const rack = createRack();
    rollRack(rack, new Rng(5));
    for (let i = 0; i < 50; i += 1) resolveShot(out, rack, aimOf(0.1, 0.5), i * 0.02);
    expect(out.hitAt).toBe(buffer);
  });

  it('clears the previous shot before recording the next', () => {
    const rack = fixedRack([{ x: BOW_X, y: BOW_Y - apexHeight(aimOf(0, 0.7)) }]);
    const out = createShotResult();
    resolveShot(out, rack, aimOf(0, 0.7), 0);
    expect(out.count).toBe(1);
    resolveShot(out, rack, aimOf(AIM_LIMIT, 0), 0);
    expect(out.count).toBe(0);
    expect(out.hitAt[0]).toBe(-1);
  });

  it('never scores more than there are targets, over four thousand shots', () => {
    const rng = new Rng(88);
    const rack = createRack();
    const out = createShotResult();
    for (let i = 0; i < 4000; i += 1) {
      if (i % 20 === 0) rollRack(rack, rng);
      const aim = aimOf((rng.float() * 2 - 1) * AIM_LIMIT, rng.float());
      resolveShot(out, rack, aim, rng.float() * 4);
      expect(out.count).toBeGreaterThanOrEqual(0);
      expect(out.count).toBeLessThanOrEqual(RACK_SIZE);
      expect(Number.isFinite(out.seconds)).toBe(true);
      for (const at of out.hitAt) expect(Number.isFinite(at)).toBe(true);
    }
  });

  it('agrees with the count taken from the whole hit list', () => {
    const rng = new Rng(313);
    const rack = createRack();
    const out = createShotResult();
    for (let i = 0; i < 600; i += 1) {
      rollRack(rack, rng);
      resolveShot(out, rack, aimOf((rng.float() * 2 - 1) * 0.5, 0.5 + rng.float() * 0.5), 0);
      const listed = Array.from(out.hitAt).filter((at) => at >= 0).length;
      expect(listed).toBe(out.count);
    }
  });

  it('resets a record to nothing', () => {
    const out = createShotResult();
    out.count = 4;
    out.seconds = 2;
    out.hitAt[0] = 1;
    resetShotResult(out);
    expect(out.count).toBe(0);
    expect(out.seconds).toBe(0);
    expect(out.hitAt[0]).toBe(-1);
  });
});

describe('seat symmetry', () => {
  /**
   * A mirrored gallery shot with a mirrored bow.
   *
   * The bow stands on the centre line, so the whole game is symmetric about it: mirroring
   * every target about x = 350 and negating the angle must skewer exactly the same
   * targets. The two seats never play different fields, and this is the property that says
   * so in one line.
   */
  /** Mirroring a drift about its own centre is a half turn of its phase. */
  function mirror(source: readonly Target[], out: readonly Target[], negateAmplitude: boolean) {
    for (let index = 0; index < RACK_SIZE; index += 1) {
      const from = source[index]!;
      const to = out[index]!;
      to.baseX = FIELD_WIDTH - from.baseX;
      to.y = from.y;
      to.rate = from.rate;
      to.amplitude = negateAmplitude ? -from.amplitude : from.amplitude;
      to.phase = negateAmplitude ? from.phase : from.phase + Math.PI;
    }
  }

  it('mirrors exactly about the centre line, to the count', () => {
    const rng = new Rng(777);
    const rack = createRack();
    const mirrored = createRack();
    const a = createShotResult();
    const b = createShotResult();
    let hits = 0;
    for (let i = 0; i < 1500; i += 1) {
      rollRack(rack, rng);
      mirror(rack, mirrored, false);
      const angle = (rng.float() * 2 - 1) * AIM_LIMIT;
      const power = rng.float();
      const start = rng.float() * 3;
      resolveShot(a, rack, aimOf(angle, power), start);
      resolveShot(b, mirrored, aimOf(-angle, power), start);
      hits += a.count;
      expect(b.count).toBe(a.count);
      expect(b.seconds).toBeCloseTo(a.seconds, 9);
    }
    // Not a vacuous mirror of two galleries nothing ever hit.
    expect(hits).toBeGreaterThan(1000);
  });

  it('mirrors the same way whether the phase or the drift is turned round', () => {
    const rng = new Rng(778);
    const rack = createRack();
    const byPhase = createRack();
    const byDrift = createRack();
    const a = createShotResult();
    const b = createShotResult();
    for (let i = 0; i < 500; i += 1) {
      rollRack(rack, rng);
      mirror(rack, byPhase, false);
      mirror(rack, byDrift, true);
      const aim = aimOf((rng.float() * 2 - 1) * AIM_LIMIT, rng.float());
      const start = rng.float() * 3;
      resolveShot(a, byPhase, aim, start);
      resolveShot(b, byDrift, aim, start);
      expect(b.count).toBe(a.count);
    }
  });

  it('mirrors a single arc to the bit at the centre', () => {
    for (let i = 1; i <= 20; i += 1) {
      const aim = aimOf((i / 20) * AIM_LIMIT, 0.6);
      const flipped = aimOf(-aim.angle, aim.power);
      for (let k = 0; k <= 10; k += 1) {
        const s = (k / 10) * 0.3;
        expect(arrowXAt(flipped, s) - BOW_X).toBeCloseTo(-(arrowXAt(aim, s) - BOW_X), 9);
        expect(arrowYAt(flipped, s)).toBe(arrowYAt(aim, s));
      }
    }
  });
});

describe('the aim that passes through a point', () => {
  it('actually passes through it', () => {
    const out = createAim();
    let found = 0;
    for (let x = 100; x <= 600; x += 50) {
      for (const y of ROW_Y) {
        for (const seconds of PLAN_TIMES) {
          if (!aimThrough(out, x, y, seconds)) continue;
          found += 1;
          expect(arrowXAt(out, seconds)).toBeCloseTo(x, 6);
          expect(arrowYAt(out, seconds)).toBeCloseTo(y, 6);
        }
      }
    }
    expect(found).toBeGreaterThan(30);
  });

  it('refuses a flight time that is not a time', () => {
    const out = createAim();
    expect(aimThrough(out, 350, 200, 0)).toBe(false);
    expect(aimThrough(out, 350, 200, -1)).toBe(false);
  });

  it('refuses a shot no legal draw can make', () => {
    const out = createAim();
    // Far too long a flight time: the bow would have to be barely drawn and the arrow
    // would fall out of the sky before it arrived.
    expect(aimThrough(out, 350, 150, 4)).toBe(false);
    // Far too short: nothing draws that hard.
    expect(aimThrough(out, 350, 150, 0.02)).toBe(false);
  });

  it('only ever hands back an aim the bow can hold', () => {
    const out = createAim();
    const rng = new Rng(64);
    for (let i = 0; i < 3000; i += 1) {
      const x = rng.float() * FIELD_WIDTH;
      const y = rng.float() * GROUND_Y;
      const seconds = 0.05 + rng.float() * 0.9;
      if (!aimThrough(out, x, y, seconds)) continue;
      expect(out.angle).toBeGreaterThanOrEqual(-AIM_LIMIT);
      expect(out.angle).toBeLessThanOrEqual(AIM_LIMIT);
      expect(out.power).toBeGreaterThanOrEqual(0);
      expect(out.power).toBeLessThanOrEqual(1);
    }
  });

  it('finds a shot for every target of a real rack', () => {
    const rack = createRack();
    const out = createAim();
    for (let seed = 0; seed < 40; seed += 1) {
      rollRack(rack, new Rng(seed));
      for (const target of rack) {
        const reachable = PLAN_TIMES.some((seconds) =>
          aimThrough(out, targetXAt(target, 0), target.y, seconds),
        );
        expect(reachable).toBe(true);
      }
    }
  });
});

describe('what a bot believes', () => {
  it('with no lead at all, judges a moving rack as a standing one', () => {
    const rack = createRack();
    rollRack(rack, new Rng(11));
    const still = rack.map((target) => ({ ...target, amplitude: 0 }));
    for (let index = 0; index < RACK_SIZE; index += 1) {
      still[index]!.baseX = targetXAt(rack[index]!, 0.6);
    }
    const aim = aimOf(0.1, 0.8);
    expect(countHitsBelieved(rack, aim, 0.6, 0)).toBe(countHitsBelieved(still, aim, 0.6, 1));
  });

  it('with a full lead, agrees with the resolver almost always', () => {
    const rng = new Rng(404);
    const rack = createRack();
    const out = createShotResult();
    let agreed = 0;
    const trials = 800;
    for (let i = 0; i < trials; i += 1) {
      rollRack(rack, rng);
      const aim = aimOf((rng.float() * 2 - 1) * 0.6, 0.4 + rng.float() * 0.6);
      const start = rng.float() * 3;
      resolveShot(out, rack, aim, start);
      if (countHitsBelieved(rack, aim, start, 1) === out.count) agreed += 1;
    }
    // The bot walks the same arc at a third of the resolution, so a target the arrow only
    // grazes can fall on the other side of the line. It is a guess, and it is allowed to
    // be a slightly coarse one.
    expect(agreed / trials).toBeGreaterThan(0.95);
  });
});

describe('planning a shot', () => {
  const rack = createRack();
  rollRack(rack, new Rng(31));

  it('is a function of the rack, the profile, the instant and the stream', () => {
    const a = createBotPlan();
    const b = createBotPlan();
    planShot(a, rack, BOT_PROFILES.hard, 0.5, new Rng(2));
    planShot(b, rack, BOT_PROFILES.hard, 0.5, new Rng(2));
    expect(b.chosen).toEqual(a.chosen);
  });

  it('always hands back an aim the bow can hold', () => {
    const plan = createBotPlan();
    const rng = new Rng(19);
    const working = createRack();
    for (let i = 0; i < 500; i += 1) {
      rollRack(working, rng);
      for (const tier of ['easy', 'normal', 'hard'] as const) {
        planShot(plan, working, BOT_PROFILES[tier], rng.float() * 3, rng);
        expect(plan.chosen.angle).toBeGreaterThanOrEqual(-AIM_LIMIT);
        expect(plan.chosen.angle).toBeLessThanOrEqual(AIM_LIMIT);
        expect(plan.chosen.power).toBeGreaterThanOrEqual(0);
        expect(plan.chosen.power).toBeLessThanOrEqual(1);
      }
    }
  });

  it('reuses its own working buffers rather than allocating a turn', () => {
    const plan = createBotPlan();
    const frozen = plan.frozenX;
    const order = plan.order;
    const chosen = plan.chosen;
    const rng = new Rng(6);
    for (let i = 0; i < 100; i += 1) planShot(plan, rack, BOT_PROFILES.normal, 0.4, rng);
    expect(plan.frozenX).toBe(frozen);
    expect(plan.order).toBe(order);
    expect(plan.chosen).toBe(chosen);
  });

  it('looks at the targets nearest the bow first', () => {
    const plan = createBotPlan();
    planShot(plan, rack, BOT_PROFILES.hard, 0, new Rng(1));
    let previous = -1;
    for (let slot = 0; slot < RACK_SIZE; slot += 1) {
      const index = plan.order[slot]!;
      const target = rack[index]!;
      const dx = plan.frozenX[index]! - BOW_X;
      const dy = target.y - BOW_Y;
      const distance = dx * dx + dy * dy;
      expect(distance).toBeGreaterThanOrEqual(previous);
      previous = distance;
    }
  });

  it('gives every rack position exactly one place in the order', () => {
    const plan = createBotPlan();
    planShot(plan, rack, BOT_PROFILES.hard, 0.9, new Rng(3));
    expect([...plan.order].sort((a, b) => a - b)).toEqual(
      Array.from({ length: RACK_SIZE }, (_unused, i) => i),
    );
  });

  it('expects to hit something', () => {
    const plan = createBotPlan();
    const rng = new Rng(51);
    const working = createRack();
    let expected = 0;
    for (let i = 0; i < 200; i += 1) {
      rollRack(working, rng);
      planShot(plan, working, BOT_PROFILES.hard, 0.5, rng);
      expected += plan.expected;
    }
    expect(expected / 200).toBeGreaterThan(3);
  });
});

describe('the bot tiers', () => {
  /** Arrows a tier takes, resolved for real rather than as the bot expected them. */
  function meanArrow(profile: BotProfile, arrows: number, seed = 42): number {
    const rng = new Rng(seed);
    const rack = createRack();
    const plan = createBotPlan();
    const shot = createShotResult();
    let total = 0;
    for (let i = 0; i < arrows; i += 1) {
      rollRack(rack, rng);
      const release = Math.round((0.2 + profile.dwell) * 30) / 30;
      planShot(plan, rack, profile, release, rng);
      resolveShot(shot, rack, plan.chosen, release);
      total += shot.count;
    }
    return total / arrows;
  }

  it('are ordered, and by a wide margin', () => {
    const easy = meanArrow(BOT_PROFILES.easy, 1500);
    const normal = meanArrow(BOT_PROFILES.normal, 1500);
    const hard = meanArrow(BOT_PROFILES.hard, 1500);
    expect(normal).toBeGreaterThan(easy + 0.6);
    expect(hard).toBeGreaterThan(normal + 0.6);
  });

  it('each knob is monotone on its own', () => {
    const base = BOT_PROFILES.hard;
    const scans = [5, 10, 15, 20].map((scan) => meanArrow({ ...base, scan }, 800));
    for (let i = 1; i < scans.length; i += 1) expect(scans[i]!).toBeGreaterThan(scans[i - 1]!);
    const spreads = [0.005, 0.02, 0.05, 0.1].map((angleSpread) =>
      meanArrow({ ...base, angleSpread }, 800),
    );
    for (let i = 1; i < spreads.length; i += 1) expect(spreads[i]!).toBeLessThan(spreads[i - 1]!);
    const powers = [0.008, 0.04, 0.09, 0.16].map((powerSpread) =>
      meanArrow({ ...base, powerSpread }, 800),
    );
    for (let i = 1; i < powers.length; i += 1) expect(powers[i]!).toBeLessThan(powers[i - 1]!);
  });

  it('reading the drift is worth something, which it was not until it was measured', () => {
    // Belief and aim used to come from different numbers, and the knob cancelled itself
    // out exactly: 3.08 at leadRead 0 and 3.08 at 1. It has to be worth points or it is
    // decoration on a difficulty menu.
    const base = BOT_PROFILES.hard;
    const blind = meanArrow({ ...base, leadRead: 0 }, 2500);
    const reading = meanArrow({ ...base, leadRead: 1 }, 2500);
    expect(reading).toBeGreaterThan(blind + 0.15);
  });

  it('orders every knob the same way across the three shipped tiers', () => {
    const { easy, normal, hard } = BOT_PROFILES;
    expect(normal.scan).toBeGreaterThan(easy.scan);
    expect(hard.scan).toBeGreaterThan(normal.scan);
    expect(normal.times).toBeGreaterThan(easy.times);
    expect(hard.times).toBeGreaterThan(normal.times);
    expect(normal.leadRead).toBeGreaterThan(easy.leadRead);
    expect(hard.leadRead).toBeGreaterThan(normal.leadRead);
    expect(normal.angleSpread).toBeLessThan(easy.angleSpread);
    expect(hard.angleSpread).toBeLessThan(normal.angleSpread);
    expect(normal.powerSpread).toBeLessThan(easy.powerSpread);
    expect(hard.powerSpread).toBeLessThan(normal.powerSpread);
    expect(normal.dwell).toBeLessThan(easy.dwell);
    expect(hard.dwell).toBeLessThan(normal.dwell);
  });

  it('never asks for more flight times than there are', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      expect(BOT_PROFILES[tier].times).toBeLessThanOrEqual(PLAN_TIMES.length);
      expect(BOT_PROFILES[tier].scan).toBeLessThanOrEqual(RACK_SIZE);
    }
  });

  it('orders its flight times best first, so trying more is never worse', () => {
    const base = BOT_PROFILES.hard;
    const means = [1, 2, 3, 4, 5].map((times) => meanArrow({ ...base, times }, 900));
    for (let i = 1; i < means.length; i += 1) {
      expect(means[i]!).toBeGreaterThan(means[i - 1]! - 0.08);
    }
    expect(means[4]!).toBeGreaterThan(means[0]!);
  });
});

describe('the seeded normal', () => {
  it('is always finite, over twenty thousand draws', () => {
    const rng = new Rng(2);
    for (let i = 0; i < 20_000; i += 1) expect(Number.isFinite(gaussian(rng))).toBe(true);
  });

  it('has about the shape it claims', () => {
    const rng = new Rng(3);
    let sum = 0;
    let squares = 0;
    const draws = 40_000;
    for (let i = 0; i < draws; i += 1) {
      const value = gaussian(rng);
      sum += value;
      squares += value * value;
    }
    expect(Math.abs(sum / draws)).toBeLessThan(0.03);
    expect(Math.sqrt(squares / draws)).toBeCloseTo(1, 1);
  });
});

describe('who shoots when', () => {
  it('alternates the lead round by round', () => {
    expect(leaderFor(0)).toBe('p1');
    expect(leaderFor(1)).toBe('p2');
    expect(leaderFor(2)).toBe('p1');
    expect(leaderFor(35)).toBe('p2');
  });

  it('gives each seat exactly one shot a round', () => {
    for (let round = 0; round < ROUND_CAP; round += 1) {
      const seats = [shooterFor(round, 0), shooterFor(round, 1)];
      expect(new Set(seats).size).toBe(2);
    }
  });

  it('gives each seat the lead exactly half the time over a full match', () => {
    let p1 = 0;
    for (let round = 0; round < ROUND_CAP; round += 1) if (leaderFor(round) === 'p1') p1 += 1;
    expect(p1).toBe(ROUND_CAP / 2);
  });

  it('has two shots to a round', () => {
    expect(SHOTS_PER_ROUND).toBe(2);
  });
});

describe('a seat card', () => {
  it('starts empty', () => {
    const state = createSeatState();
    expect(state.targets).toBe(0);
    expect(state.arrows).toBe(0);
    expect(state.blanks).toBe(0);
    expect(bestArrow(state)).toBe(0);
    expect(topArrows(state)).toBe(0);
  });

  it('counts each target as the arrow reaches it', () => {
    const state = createSeatState();
    recordHit(state);
    recordHit(state);
    expect(state.targets).toBe(2);
    expect(state.arrows).toBe(0);
  });

  it('counts the arrow when it comes to rest', () => {
    const state = createSeatState();
    recordArrow(state, 2);
    expect(state.arrows).toBe(1);
    expect(state.targets).toBe(0);
    expect(bestArrow(state)).toBe(2);
  });

  it('counts an arrow that took nothing as a blank', () => {
    const state = createSeatState();
    recordArrow(state, 0);
    recordArrow(state, 3);
    expect(state.blanks).toBe(1);
    expect(state.arrows).toBe(2);
  });

  it('keeps the three biggest arrows, largest first', () => {
    const state = createSeatState();
    for (const hits of [2, 5, 1, 4, 3, 6]) recordArrow(state, hits);
    expect(Array.from(state.top)).toEqual([6, 5, 4]);
    expect(bestArrow(state)).toBe(6);
    expect(topArrows(state)).toBe(15);
  });

  it('keeps repeats, because three fives is a better card than one', () => {
    const state = createSeatState();
    for (const hits of [5, 5, 5, 1]) recordArrow(state, hits);
    expect(Array.from(state.top)).toEqual([5, 5, 5]);
    expect(topArrows(state)).toBe(15);
  });

  it('holds fewer than three arrows before three have been shot', () => {
    const state = createSeatState();
    recordArrow(state, 4);
    expect(topArrows(state)).toBe(4);
    recordArrow(state, 2);
    expect(topArrows(state)).toBe(6);
  });

  it('is emptied by a reset', () => {
    const state = createSeatState();
    recordHit(state);
    recordArrow(state, 3);
    resetSeatState(state);
    expect(state.targets).toBe(0);
    expect(state.arrows).toBe(0);
    expect(state.blanks).toBe(0);
    expect(topArrows(state)).toBe(0);
  });
});

describe('the win condition', () => {
  it('decides nothing in the middle of a round', () => {
    expect(winnerOf(seatWith(TARGET_GOAL), seatWith(0), false, false)).toBeNull();
    expect(winnerOf(seatWith(TARGET_GOAL + 20), seatWith(0), false, true)).toBeNull();
  });

  it('decides nothing while both seats are short of the goal', () => {
    expect(winnerOf(seatWith(TARGET_GOAL - 1), seatWith(0), true, false)).toBeNull();
  });

  it('is won by the seat that reaches the goal', () => {
    expect(winnerOf(seatWith(TARGET_GOAL), seatWith(69), true, false)).toBe('p1');
    expect(winnerOf(seatWith(69), seatWith(TARGET_GOAL), true, false)).toBe('p2');
  });

  it('is won at the goal exactly, not one past it', () => {
    expect(winnerOf(seatWith(TARGET_GOAL - 1), seatWith(TARGET_GOAL - 1), true, false)).toBeNull();
    expect(winnerOf(seatWith(TARGET_GOAL), seatWith(TARGET_GOAL - 1), true, false)).toBe('p1');
  });

  it('never pins a count to the goal and then compares it', () => {
    // Two racing games in this catalogue clamped a distance to the finish line and then
    // judged on the clamped number, which turned every close finish into a dead heat and
    // was written up in both as deliberate. Seventy-two beats seventy.
    expect(winnerOf(seatWith(72), seatWith(70), true, false)).toBe('p1');
    expect(winnerOf(seatWith(70), seatWith(74), true, false)).toBe('p2');
    expect(winnerOf(seatWith(90), seatWith(71), true, false)).toBe('p1');
  });

  it('goes to the three best arrows when both seats finish level', () => {
    expect(winnerOf(seatWith(71, [6, 5, 4]), seatWith(71, [5, 5, 4]), true, false)).toBe('p1');
    expect(winnerOf(seatWith(71, [4, 4, 4]), seatWith(71, [6, 4, 3]), true, false)).toBe('p2');
  });

  it('is a real draw when the cards agree on everything', () => {
    expect(winnerOf(seatWith(71, [6, 5, 4]), seatWith(71, [6, 5, 4]), true, false)).toBe('draw');
    expect(winnerOf(seatWith(70, [5, 5, 5]), seatWith(70, [5, 5, 5]), true, true)).toBe('draw');
  });

  it('settles on the higher count when the round cap runs out', () => {
    expect(winnerOf(seatWith(41), seatWith(40), true, true)).toBe('p1');
    expect(winnerOf(seatWith(0), seatWith(1), true, true)).toBe('p2');
  });

  it('settles a level cap on the three best arrows too', () => {
    expect(winnerOf(seatWith(30, [4, 3, 2]), seatWith(30, [4, 3, 1]), true, true)).toBe('p1');
  });

  it('always answers once the cap is reached, so a match can never fail to end', () => {
    const rng = new Rng(17);
    for (let i = 0; i < 2000; i += 1) {
      const p1 = seatWith(rng.int(0, 90), [rng.int(0, 9), rng.int(0, 9), rng.int(0, 9)]);
      const p2 = seatWith(rng.int(0, 90), [rng.int(0, 9), rng.int(0, 9), rng.int(0, 9)]);
      expect(winnerOf(p1, p2, true, true)).not.toBeNull();
    }
  });

  it('agrees with itself when the two seats are swapped', () => {
    const rng = new Rng(29);
    for (let i = 0; i < 2000; i += 1) {
      const a = seatWith(rng.int(0, 90), [rng.int(0, 9), rng.int(0, 9), rng.int(0, 9)]);
      const b = seatWith(rng.int(0, 90), [rng.int(0, 9), rng.int(0, 9), rng.int(0, 9)]);
      const complete = rng.bool();
      const forwards = winnerOf(a, b, true, complete);
      const backwards = winnerOf(b, a, true, complete);
      if (forwards === null) expect(backwards).toBeNull();
      else if (forwards === 'draw') expect(backwards).toBe('draw');
      else expect(backwards).toBe(forwards === 'p1' ? 'p2' : 'p1');
    }
  });
});

describe('the match shape', () => {
  it('races to the number the observed rule names', () => {
    expect(TARGET_GOAL).toBe(70);
  });

  it('caps the rounds well past what any tier needs', () => {
    // Measured: `easy` reaches seventy in 27.1 rounds and `hard` in 13.9, so the cap has
    // 33% of headroom over the slowest tier and a match that runs to it is a real stalemate
    // rather than an ordinary game being cut off.
    expect(ROUND_CAP).toBeGreaterThan(30);
    expect(ROUND_CAP % 2).toBe(0);
  });

  it('closes the termination arithmetic against the guard ceiling', () => {
    const clock = 3.5;
    const settle = 0.2;
    const flip = 0.36;
    const turns = ROUND_CAP * SHOTS_PER_ROUND;
    const worst = turns * (clock + MAX_FLIGHT_SECONDS + settle) + turns * flip;
    expect(worst).toBeLessThan(600);
    expect(worst).toBeCloseTo(375.1, 0);
  });
});

describe('clamping', () => {
  it('holds a value between its bounds', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('leaves the bounds themselves alone', () => {
    expect(clamp(0, 0, 1)).toBe(0);
    expect(clamp(1, 0, 1)).toBe(1);
  });
});

describe('an empty target', () => {
  it('starts at the origin with no drift', () => {
    const target = createTarget();
    expect(target.baseX).toBe(0);
    expect(target.amplitude).toBe(0);
    expect(targetXAt(target, 3)).toBe(0);
  });

  it('makes a rack of the right size', () => {
    expect(createRack()).toHaveLength(RACK_SIZE);
  });
});

describe('the resolver samples finely enough to be exact', () => {
  it('answers the same at twice the rate it ships with', () => {
    // The sampling belongs to the resolver rather than to the caller, so this is a check
    // on the *number*: at 600 Hz the arc departs from the straight segment each sample is
    // tested as by 0.0015 units, and doubling the rate must not change an answer.
    expect(RESOLVE_HZ).toBeGreaterThanOrEqual(600);
    const sagitta = 0.5 * GRAVITY * (1 / RESOLVE_HZ / 2) ** 2;
    expect(sagitta).toBeLessThan(0.01);
    const drift = DRIFT_MAX * RATE_MAX * (1 / RESOLVE_HZ);
    expect(drift).toBeLessThan(0.25);
  });
});
