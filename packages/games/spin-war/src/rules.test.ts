import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { Bowl, BotDifficulty, Spinner } from './rules.js';
import {
  BOT_PROFILES,
  BOWL_RADIUS,
  CLASH_REFERENCE_SPEED,
  DRIVE_FLOOR,
  IDLE_WEAR,
  MAX_SPEED,
  POINTS_TO_WIN,
  RING_OUT_POINTS,
  SPIN_FULL,
  SPINNER_RADIUS,
  TOPPLE_POINTS,
  botInput,
  collideSpinners,
  createBowl,
  createRoundPoints,
  createSpinner,
  createSpringStep,
  driveShare,
  isOut,
  isToppled,
  radiusOf,
  scoreRound,
  solveSpring,
  stepSpinner,
  wearSpin,
} from './rules.js';

const STEP = 1 / 60;

/** The step matrix the bowl actually runs at, rebuilt per test so nothing is shared. */
function bowlStep(bowl: Bowl, dt = STEP) {
  return solveSpring(createSpringStep(), bowl.spring, bowl.drag, dt);
}

function place(bowl: Bowl, dx: number, dy: number, spin = SPIN_FULL): Spinner {
  const s = createSpinner(bowl.centreX + dx, bowl.centreY + dy);
  s.spin = spin;
  return s;
}

/** The same top seen from the other seat: half a turn about the middle of the bowl. */
function mirror(s: Readonly<Spinner>, bowl: Bowl): Spinner {
  return {
    x: 2 * bowl.centreX - s.x,
    y: 2 * bowl.centreY - s.y,
    vx: -s.vx,
    vy: -s.vy,
    radius: s.radius,
    mass: s.mass,
    spin: s.spin,
  };
}

function expectMirrored(actual: Readonly<Spinner>, expected: Readonly<Spinner>, bowl: Bowl): void {
  const want = mirror(expected, bowl);
  expect(actual.x).toBeCloseTo(want.x, 9);
  expect(actual.y).toBeCloseTo(want.y, 9);
  expect(actual.vx).toBeCloseTo(want.vx, 9);
  expect(actual.vy).toBeCloseTo(want.vy, 9);
  expect(actual.spin).toBeCloseTo(want.spin, 9);
}

const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

describe('the bowl, as a solved oscillator', () => {
  it('is the identity over a step of no length', () => {
    const step = solveSpring(createSpringStep(), 2.25, 1.5, 0);
    expect(step.pp).toBe(1);
    expect(step.pv).toBe(0);
    expect(step.vp).toBeCloseTo(0, 12);
    expect(step.vv).toBe(1);
  });

  it('refuses a step that is not a non-negative number', () => {
    const out = createSpringStep();
    expect(() => solveSpring(out, 2.25, 1.5, -0.01)).toThrow(RangeError);
    expect(() => solveSpring(out, 2.25, 1.5, Number.NaN)).toThrow(RangeError);
    expect(() => solveSpring(out, 2.25, 1.5, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('loses exactly the energy the drag says it does', () => {
    // The determinant of the step matrix is e^(-drag * dt) for every damping regime: that
    // is the one identity all four branches have to satisfy, so it is what checks them.
    for (const [spring, drag] of [
      [2.25, 1.5],
      [4, 0.2],
      [1, 6],
      [1, 2],
      [0, 1.5],
    ] as const) {
      const step = solveSpring(createSpringStep(), spring, drag, 0.25);
      const determinant = step.pp * step.vv - step.pv * step.vp;
      expect(determinant, `spring ${spring} drag ${drag}`).toBeCloseTo(Math.exp(-drag * 0.25), 9);
    }
  });

  it('gives the same answer at 60 Hz, 120 Hz and 144 Hz', () => {
    // Two steps of h against one step of 2h. This is the whole reason the dish is solved
    // rather than integrated: an Euler step fails it and a phone would then play a
    // different match to a laptop.
    for (const [spring, drag] of [
      [2.25, 1.5],
      [4, 0.2],
      [1, 6],
      [1, 2],
      [0, 1.5],
      [0, 0],
    ] as const) {
      const half = solveSpring(createSpringStep(), spring, drag, 1 / 120);
      const whole = solveSpring(createSpringStep(), spring, drag, 1 / 60);
      // Composing the matrix with itself must land on the matrix for twice the step.
      const pp = half.pp * half.pp + half.pv * half.vp;
      const pv = half.pp * half.pv + half.pv * half.vv;
      const vp = half.vp * half.pp + half.vv * half.vp;
      const vv = half.vp * half.pv + half.vv * half.vv;
      expect(pp, `spring ${spring} drag ${drag}`).toBeCloseTo(whole.pp, 12);
      expect(pv).toBeCloseTo(whole.pv, 12);
      expect(vp).toBeCloseTo(whole.vp, 12);
      expect(vv).toBeCloseTo(whole.vv, 12);
    }
  });

  it('covers the critically damped case as the limit of both neighbours', () => {
    const critical = solveSpring(createSpringStep(), 1, 2, 0.3);
    const under = solveSpring(createSpringStep(), 1.000001, 2, 0.3);
    const over = solveSpring(createSpringStep(), 0.999999, 2, 0.3);
    expect(critical.pp).toBeCloseTo(under.pp, 5);
    expect(critical.pp).toBeCloseTo(over.pp, 5);
    expect(critical.pv).toBeCloseTo(under.pv, 5);
    expect(critical.vv).toBeCloseTo(over.vv, 5);
  });

  it('degenerates to a free body under drag when there is no dish at all', () => {
    const step = solveSpring(createSpringStep(), 0, 2, 0.5);
    expect(step.pp).toBe(1);
    expect(step.vp).toBe(0);
    expect(step.vv).toBeCloseTo(Math.exp(-1), 12);
    expect(step.pv).toBeCloseTo((1 - Math.exp(-1)) / 2, 12);
  });

  it('degenerates to a straight line with neither dish nor drag', () => {
    const step = solveSpring(createSpringStep(), 0, 0, 0.5);
    expect(step.pp).toBe(1);
    expect(step.pv).toBe(0.5);
    expect(step.vp).toBe(0);
    expect(step.vv).toBe(1);
  });

  it('writes into the record it is given rather than allocating one', () => {
    const out = createSpringStep();
    expect(solveSpring(out, 2.25, 1.5, STEP)).toBe(out);
  });
});

describe('drive share', () => {
  it('is whole at full spin and the floor at none', () => {
    expect(driveShare(SPIN_FULL)).toBe(1);
    expect(driveShare(0)).toBe(DRIVE_FLOOR);
  });

  it('never falls below the floor, however far past zero the gauge has gone', () => {
    expect(driveShare(-40)).toBe(DRIVE_FLOOR);
  });

  it('never rises above one, however the constants are retuned', () => {
    expect(driveShare(SPIN_FULL * 3)).toBe(1);
  });

  it('rises with the spin left', () => {
    expect(driveShare(SPIN_FULL * 0.75)).toBeGreaterThan(driveShare(SPIN_FULL * 0.25));
  });
});

describe('a top in the dish', () => {
  it('leaves a resting top in the middle exactly where it is', () => {
    const bowl = createBowl();
    const s = place(bowl, 0, 0);
    stepSpinner(s, 0, 0, bowl, bowlStep(bowl));
    expect(s.x).toBe(bowl.centreX);
    expect(s.y).toBe(bowl.centreY);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
  });

  it('pulls an untouched top back towards the middle', () => {
    const bowl = createBowl();
    const s = place(bowl, 250, 0);
    const step = bowlStep(bowl);
    for (let i = 0; i < 30; i += 1) stepSpinner(s, 0, 0, bowl, step);
    expect(radiusOf(s, bowl)).toBeLessThan(250);
    expect(s.vx).toBeLessThan(0);
  });

  it('swings an untouched top through the middle and out the other side', () => {
    // A dish is a spring, not a funnel with a drain: a top knocked across it comes back.
    const bowl = createBowl();
    const s = place(bowl, 250, 0);
    const step = bowlStep(bowl);
    let crossed = false;
    for (let i = 0; i < 240; i += 1) {
      stepSpinner(s, 0, 0, bowl, step);
      if (s.x < bowl.centreX) crossed = true;
    }
    expect(crossed).toBe(true);
  });

  it('settles an untouched top in the middle in the end', () => {
    const bowl = createBowl();
    const s = place(bowl, 250, 90);
    const step = bowlStep(bowl);
    for (let i = 0; i < 60 * 20; i += 1) stepSpinner(s, 0, 0, bowl, step);
    expect(radiusOf(s, bowl)).toBeLessThan(1);
  });

  it('drives the way it is told', () => {
    const bowl = createBowl();
    const s = place(bowl, 0, 0);
    const step = bowlStep(bowl);
    for (let i = 0; i < 20; i += 1) stepSpinner(s, 1, 0, bowl, step);
    expect(s.x).toBeGreaterThan(bowl.centreX);
    expect(s.y).toBe(bowl.centreY);
    expect(s.vx).toBeGreaterThan(0);
  });

  it('makes a diagonal no faster than a straight push', () => {
    const bowl = createBowl();
    const straight = place(bowl, 0, 0);
    const diagonal = place(bowl, 0, 0);
    const step = bowlStep(bowl);
    for (let i = 0; i < 40; i += 1) {
      stepSpinner(straight, 1, 0, bowl, step);
      stepSpinner(diagonal, 1, 1, bowl, step);
    }
    const straightSpeed = Math.hypot(straight.vx, straight.vy);
    const diagonalSpeed = Math.hypot(diagonal.vx, diagonal.vy);
    expect(diagonalSpeed).toBeCloseTo(straightSpeed, 9);
  });

  it('leaves a gently held stick gentle', () => {
    const bowl = createBowl();
    const full = place(bowl, 0, 0);
    const half = place(bowl, 0, 0);
    const step = bowlStep(bowl);
    for (let i = 0; i < 30; i += 1) {
      stepSpinner(full, 1, 0, bowl, step);
      stepSpinner(half, 0.4, 0, bowl, step);
    }
    expect(half.x - bowl.centreX).toBeGreaterThan(0);
    expect(half.x).toBeLessThan(full.x);
  });

  it('never lets a player drive themselves over the crest', () => {
    // The bowl holds you: a held direction reaches a rest point well inside the lip, and
    // even the overshoot on the way there falls short. Being thrown out is something the
    // opponent does to you, which is what the observed rule says the game is.
    const bowl = createBowl();
    for (const start of [0, 100, 190, 250]) {
      const s = place(bowl, start, 0);
      const step = bowlStep(bowl);
      let peak = 0;
      for (let i = 0; i < 60 * 10; i += 1) {
        stepSpinner(s, 1, 0, bowl, step);
        wearSpin(s, 1, bowl, STEP);
        const r = radiusOf(s, bowl);
        if (r > peak) peak = r;
      }
      expect(peak, `from ${String(start)}`).toBeLessThan(BOWL_RADIUS);
    }
  });

  it('trims a velocity above the cap before it can tunnel through anybody', () => {
    const bowl = createBowl();
    const s = place(bowl, 0, 0);
    s.vx = MAX_SPEED * 12;
    stepSpinner(s, 0, 0, bowl, bowlStep(bowl));
    // One step must move a top less than the contact distance of the pair, or a clash
    // could be missed entirely between two discrete tests.
    expect(s.x - bowl.centreX).toBeLessThan(SPINNER_RADIUS * 2);
  });

  it('steps the same match at 60 Hz as at 120 Hz', () => {
    const bowl = createBowl();
    const slow = place(bowl, 160, -40);
    slow.vx = 90;
    const fast = place(bowl, 160, -40);
    fast.vx = 90;
    const slowStep = bowlStep(bowl, 1 / 60);
    const fastStep = bowlStep(bowl, 1 / 120);
    for (let i = 0; i < 120; i += 1) {
      stepSpinner(slow, 1, 0, bowl, slowStep);
      stepSpinner(fast, 1, 0, bowl, fastStep);
      stepSpinner(fast, 1, 0, bowl, fastStep);
    }
    expect(fast.x).toBeCloseTo(slow.x, 6);
    expect(fast.y).toBeCloseTo(slow.y, 6);
    expect(fast.vx).toBeCloseTo(slow.vx, 6);
  });

  it('mirrors: the same push from the other seat gives the mirrored answer', () => {
    const bowl = createBowl();
    const step = bowlStep(bowl);
    const near = place(bowl, 120, -60);
    near.vx = 40;
    near.vy = -25;
    const far = mirror(near, bowl);
    stepSpinner(near, 0.6, -0.3, bowl, step);
    stepSpinner(far, -0.6, 0.3, bowl, step);
    expectMirrored(far, near, bowl);
  });
});

describe('spin, as a spendable resource', () => {
  it('runs down at the idle rate for a top doing nothing in the middle', () => {
    const bowl = createBowl();
    const s = place(bowl, 0, 0);
    wearSpin(s, 0, bowl, 1);
    expect(s.spin).toBeCloseTo(SPIN_FULL - IDLE_WEAR, 9);
  });

  it('costs more to drive than to coast', () => {
    const bowl = createBowl();
    const coasting = place(bowl, 0, 0);
    const driving = place(bowl, 0, 0);
    wearSpin(coasting, 0, bowl, 1);
    wearSpin(driving, 1, bowl, 1);
    expect(driving.spin).toBeLessThan(coasting.spin);
  });

  it('grinds hardest against the outer wall', () => {
    const bowl = createBowl();
    const middle = place(bowl, 0, 0);
    const rim = place(bowl, BOWL_RADIUS - 1, 0);
    wearSpin(middle, 0, bowl, 1);
    wearSpin(rim, 0, bowl, 1);
    expect(rim.spin).toBeLessThan(middle.spin);
  });

  it('charges no more than a full stick however long the vector it is handed', () => {
    const bowl = createBowl();
    const honest = place(bowl, 0, 0);
    const cheating = place(bowl, 0, 0);
    wearSpin(honest, 1, bowl, 1);
    wearSpin(cheating, 9, bowl, 1);
    expect(cheating.spin).toBe(honest.spin);
  });

  it('treats a negative or absent effort as coasting', () => {
    const bowl = createBowl();
    const idle = place(bowl, 0, 0);
    const negative = place(bowl, 0, 0);
    wearSpin(idle, 0, bowl, 1);
    wearSpin(negative, -3, bowl, 1);
    expect(negative.spin).toBe(idle.spin);
  });

  it('lets the gauge pass zero rather than piling every close round onto a tie', () => {
    const bowl = createBowl();
    const s = place(bowl, 0, 0, 1);
    wearSpin(s, 0, bowl, 1);
    expect(s.spin).toBeLessThan(0);
  });

  it('never gives spin back', () => {
    const bowl = createBowl();
    const s = place(bowl, 100, 0);
    let last = s.spin;
    for (let i = 0; i < 400; i += 1) {
      wearSpin(s, i % 3 === 0 ? 1 : 0, bowl, STEP);
      expect(s.spin).toBeLessThanOrEqual(last);
      last = s.spin;
    }
  });

  it('bounds a round: nothing either seat does can hold one open past the idle limit', () => {
    // This is the game's termination guarantee, stated as arithmetic. Every other wear
    // term only adds to it, so the idle rate alone is the ceiling on a round.
    const bowl = createBowl();
    const s = place(bowl, 0, 0);
    const limit = Math.ceil((SPIN_FULL / IDLE_WEAR) * 60);
    for (let i = 0; i < limit; i += 1) wearSpin(s, 0, bowl, STEP);
    expect(isToppled(s)).toBe(true);
  });
});

describe('a clash', () => {
  function pair(bowl: Bowl, gapSpin = 0): [Spinner, Spinner] {
    const a = place(bowl, -SPINNER_RADIUS + 4, 0, SPIN_FULL);
    const b = place(bowl, SPINNER_RADIUS - 4, 0, SPIN_FULL - gapSpin);
    return [a, b];
  }

  it('reports nothing and touches nothing when the two are apart', () => {
    const bowl = createBowl();
    const a = place(bowl, -200, 0);
    const b = place(bowl, 200, 0);
    const before = [a.x, a.vx, a.spin, b.x, b.vx, b.spin];
    expect(collideSpinners(a, b)).toBe(false);
    expect([a.x, a.vx, a.spin, b.x, b.vx, b.spin]).toEqual(before);
  });

  it('pushes an overlapping pair apart so they cannot grind through each other', () => {
    const bowl = createBowl();
    const [a, b] = pair(bowl);
    expect(collideSpinners(a, b)).toBe(true);
    expect(b.x - a.x).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-9);
  });

  it('swaps the closing speed between two equally charged tops', () => {
    const bowl = createBowl();
    const a = place(bowl, -(SPINNER_RADIUS + 1), 0);
    const b = place(bowl, SPINNER_RADIUS + 1, 0);
    a.x -= 2;
    b.x += 2;
    a.x = bowl.centreX - SPINNER_RADIUS;
    b.x = bowl.centreX + SPINNER_RADIUS;
    a.vx = 200;
    b.vx = -200;
    collideSpinners(a, b);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(a.vx).toBeCloseTo(-b.vx, 9);
  });

  it('gives a separating pair no impulse to pull them back together', () => {
    const bowl = createBowl();
    const [a, b] = pair(bowl);
    a.vx = -150;
    b.vx = 150;
    collideSpinners(a, b);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
  });

  it('throws the emptier top harder than the fuller one — the spin war itself', () => {
    const bowl = createBowl();
    const [a, b] = pair(bowl, 60);
    collideSpinners(a, b);
    // b holds 40 spin against a's 100, so b leaves the contact faster than a recoils.
    expect(b.vx).toBeGreaterThan(-a.vx);
  });

  it('bites the same way round whichever argument the fuller top is', () => {
    const bowl = createBowl();
    const [a, b] = pair(bowl, 60);
    collideSpinners(a, b);
    const [c, d] = pair(bowl, 60);
    collideSpinners(d, c);
    expect(c.vx).toBeCloseTo(a.vx, 9);
    expect(d.vx).toBeCloseTo(b.vx, 9);
  });

  it('leaves a level clash perfectly even', () => {
    const bowl = createBowl();
    const [a, b] = pair(bowl, 0);
    collideSpinners(a, b);
    expect(a.vx).toBeCloseTo(-b.vx, 9);
    expect(a.spin).toBeCloseTo(b.spin, 9);
  });

  it('scrapes the two along opposite sides of the contact', () => {
    const bowl = createBowl();
    const [a, b] = pair(bowl, 0);
    collideSpinners(a, b);
    // The contact normal lies on x, so the scrape is the whole of the y motion, and the
    // two rims rub in opposite directions.
    expect(a.vy).not.toBe(0);
    expect(a.vy).toBeCloseTo(-b.vy, 9);
  });

  it('scrapes harder when there is more spin between them', () => {
    const bowl = createBowl();
    const [full] = pair(bowl, 0);
    const [, other] = pair(bowl, 0);
    collideSpinners(full, other);
    const faded = place(bowl, -SPINNER_RADIUS + 4, 0, 20);
    const fadedOther = place(bowl, SPINNER_RADIUS - 4, 0, 20);
    collideSpinners(faded, fadedOther);
    expect(Math.abs(faded.vy)).toBeLessThan(Math.abs(full.vy));
  });

  it('costs both tops spin, and the emptier one more', () => {
    const bowl = createBowl();
    const a = place(bowl, -SPINNER_RADIUS + 4, 0, SPIN_FULL);
    const b = place(bowl, SPINNER_RADIUS - 4, 0, SPIN_FULL - 50);
    a.vx = CLASH_REFERENCE_SPEED / 2;
    b.vx = -CLASH_REFERENCE_SPEED / 2;
    collideSpinners(a, b);
    expect(a.spin).toBeLessThan(SPIN_FULL);
    expect(b.spin).toBeLessThan(SPIN_FULL - 50);
    expect(SPIN_FULL - a.spin).toBeLessThan(SPIN_FULL - 50 - b.spin);
  });

  it('caps what one contact can charge, however fast the pair met', () => {
    const bowl = createBowl();
    const [slow, slowOther] = pair(bowl, 0);
    slow.vx = CLASH_REFERENCE_SPEED;
    slowOther.vx = -CLASH_REFERENCE_SPEED;
    collideSpinners(slow, slowOther);
    const [fast, fastOther] = pair(bowl, 0);
    fast.vx = MAX_SPEED;
    fastOther.vx = -MAX_SPEED;
    collideSpinners(fast, fastOther);
    expect(SPIN_FULL - fast.spin).toBeLessThan(4 * (SPIN_FULL - slow.spin));
  });

  it('mirrors: the same clash seen from the other seat is the mirrored clash', () => {
    const bowl = createBowl();
    const a = place(bowl, -30, 70, 90);
    const b = place(bowl, 30, 40, 55);
    a.vx = 120;
    a.vy = -60;
    b.vx = -80;
    b.vy = 30;
    const mirroredA = mirror(a, bowl);
    const mirroredB = mirror(b, bowl);
    collideSpinners(a, b);
    // The other seat sees b where a was, so it collides them the other way round.
    collideSpinners(mirroredB, mirroredA);
    expectMirrored(mirroredA, a, bowl);
    expectMirrored(mirroredB, b, bowl);
  });
});

describe('leaving the bowl', () => {
  it('keeps a top whose centre sits exactly on the crest', () => {
    const bowl = createBowl();
    const s = place(bowl, BOWL_RADIUS, 0);
    expect(isOut(s, bowl)).toBe(false);
  });

  it('loses a top whose centre has passed the crest', () => {
    const bowl = createBowl();
    const s = place(bowl, BOWL_RADIUS + 0.5, 0);
    expect(isOut(s, bowl)).toBe(true);
  });

  it('lets a top lean out over the lip and stay in', () => {
    const bowl = createBowl();
    const s = place(bowl, BOWL_RADIUS - 2, 0);
    expect(radiusOf(s, bowl) + s.radius).toBeGreaterThan(bowl.radius);
    expect(isOut(s, bowl)).toBe(false);
  });

  it('topples a top at zero and past it, and not one above', () => {
    const bowl = createBowl();
    expect(isToppled(place(bowl, 0, 0, 0.001))).toBe(false);
    expect(isToppled(place(bowl, 0, 0, 0))).toBe(true);
    expect(isToppled(place(bowl, 0, 0, -12))).toBe(true);
  });
});

describe('scoring a round', () => {
  it('says nothing while both tops are in and still spinning', () => {
    const bowl = createBowl();
    const out = createRoundPoints();
    expect(scoreRound(out, place(bowl, 40, 0), place(bowl, -40, 0), bowl)).toBe(false);
    expect(out.p1).toBe(0);
    expect(out.p2).toBe(0);
  });

  it('pays the other seat two for a top over the lip', () => {
    const bowl = createBowl();
    const out = createRoundPoints();
    expect(scoreRound(out, place(bowl, BOWL_RADIUS + 1, 0), place(bowl, -40, 0), bowl)).toBe(true);
    expect(out.p1).toBe(0);
    expect(out.p2).toBe(RING_OUT_POINTS);
  });

  it('pays both when both leave in the same step', () => {
    const bowl = createBowl();
    const out = createRoundPoints();
    const a = place(bowl, BOWL_RADIUS + 1, 0);
    const b = place(bowl, -BOWL_RADIUS - 1, 0);
    expect(scoreRound(out, a, b, bowl)).toBe(true);
    expect(out.p1).toBe(RING_OUT_POINTS);
    expect(out.p2).toBe(RING_OUT_POINTS);
  });

  it('pays one to whichever top is still turning when the other runs down', () => {
    const bowl = createBowl();
    const out = createRoundPoints();
    expect(scoreRound(out, place(bowl, 0, 0, -0.2), place(bowl, 40, 0, 6), bowl)).toBe(true);
    expect(out.p1).toBe(0);
    expect(out.p2).toBe(TOPPLE_POINTS);
  });

  it('settles a run-down by comparison, so the deeper-spent top loses', () => {
    const bowl = createBowl();
    const out = createRoundPoints();
    // Both gauges are empty in the same step; the one that crossed by less is standing.
    expect(scoreRound(out, place(bowl, 0, 0, -0.05), place(bowl, 40, 0, -0.4), bowl)).toBe(true);
    expect(out.p1).toBe(TOPPLE_POINTS);
    expect(out.p2).toBe(0);
  });

  it('shares the round only when the two are genuinely identical', () => {
    const bowl = createBowl();
    const out = createRoundPoints();
    expect(scoreRound(out, place(bowl, 0, 0, 0), place(bowl, 40, 0, 0), bowl)).toBe(true);
    expect(out.p1).toBe(TOPPLE_POINTS);
    expect(out.p2).toBe(TOPPLE_POINTS);
  });

  it('counts a top thrown out on its last turn as a throw, not a run-down', () => {
    const bowl = createBowl();
    const out = createRoundPoints();
    expect(scoreRound(out, place(bowl, BOWL_RADIUS + 4, 0, -1), place(bowl, 0, 0, 30), bowl)).toBe(
      true,
    );
    expect(out.p2).toBe(RING_OUT_POINTS);
  });

  it('clears the record it is given, so a live round can never read a stale award', () => {
    const bowl = createBowl();
    const out = createRoundPoints();
    scoreRound(out, place(bowl, BOWL_RADIUS + 1, 0), place(bowl, 0, 0), bowl);
    expect(out.p2).toBe(RING_OUT_POINTS);
    scoreRound(out, place(bowl, 0, 0), place(bowl, 40, 0), bowl);
    expect(out.p1).toBe(0);
    expect(out.p2).toBe(0);
  });

  it('mirrors: the same round scored from the other seat swaps the two awards', () => {
    const bowl = createBowl();
    const a = place(bowl, BOWL_RADIUS + 3, 40, 12);
    const b = place(bowl, -60, 20, 55);
    const near = createRoundPoints();
    const far = createRoundPoints();
    scoreRound(near, a, b, bowl);
    scoreRound(far, mirror(b, bowl), mirror(a, bowl), bowl);
    expect(far.p1).toBe(near.p2);
    expect(far.p2).toBe(near.p1);
  });

  it('needs four points to win, which is what the observed rule says', () => {
    expect(POINTS_TO_WIN).toBe(4);
    expect(RING_OUT_POINTS).toBe(2);
    expect(TOPPLE_POINTS).toBe(1);
  });
});

describe('the bot', () => {
  const bowl = createBowl();

  it('grades reaction and steering noise the right way round', () => {
    expect(BOT_PROFILES.hard.reactionSeconds).toBeLessThan(BOT_PROFILES.normal.reactionSeconds);
    expect(BOT_PROFILES.normal.reactionSeconds).toBeLessThan(BOT_PROFILES.easy.reactionSeconds);
    expect(BOT_PROFILES.hard.steerError).toBeLessThan(BOT_PROFILES.normal.steerError);
    expect(BOT_PROFILES.normal.steerError).toBeLessThan(BOT_PROFILES.easy.steerError);
  });

  it('grades its judgement the right way round too', () => {
    // The harder tier turns back from the lip sooner, wants a better ledger before it
    // commits, and is readier to stop pushing to save spin.
    expect(BOT_PROFILES.hard.safeEdge).toBeLessThan(BOT_PROFILES.easy.safeEdge);
    expect(BOT_PROFILES.hard.chargeMargin).toBeGreaterThan(BOT_PROFILES.easy.chargeMargin);
    expect(BOT_PROFILES.hard.coastRadius).toBeGreaterThan(BOT_PROFILES.easy.coastRadius);
  });

  it('never reacts faster than a person', () => {
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].reactionSeconds, tier).toBeGreaterThan(0);
    }
  });

  it('drives at most as hard as a player holding the stick', () => {
    for (const tier of TIERS) {
      const rng = new Rng(9);
      const out = vec2();
      for (let i = 0; i < 200; i += 1) {
        const self = place(bowl, (i % 7) * 40 - 120, (i % 5) * 50 - 100, SPIN_FULL - i * 0.4);
        const other = place(bowl, 120 - (i % 9) * 30, (i % 3) * 60, SPIN_FULL - (i % 11) * 6);
        other.vx = (i % 13) * 20 - 120;
        botInput(out, self, other, bowl, tier, rng);
        const length = Math.hypot(out.x, out.y);
        expect(length, tier).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });

  it('draws exactly one number a step, whatever it decides', () => {
    // A branch that skips the draw puts two replays of one match out of step with each
    // other for ever, and it is invisible until a bot behaves differently on a rerun.
    for (const tier of TIERS) {
      const counted = new Rng(4);
      const reference = new Rng(4);
      const out = vec2();
      const cases: [number, number, number, number][] = [
        [0, 0, 200, 0],
        [300, 0, 10, 10],
        [0, 0, 0, 0],
        [-200, 100, 210, -90],
        [320, 10, 5, 5],
      ];
      for (const [sx, sy, ox, oy] of cases) {
        const self = place(bowl, sx, sy, 40);
        const other = place(bowl, ox, oy, 90);
        botInput(out, self, other, bowl, tier, counted);
        reference.float();
      }
      expect(counted.save(), tier).toEqual(reference.save());
    }
  });

  it('acts on where the opponent was, never on where it will be', () => {
    const out = vec2();
    const self = place(bowl, -150, 0);
    const still = place(bowl, 150, 0);
    const running = place(bowl, 150, 0);
    running.vx = 300;
    botInput(out, self, still, bowl, 'easy', new Rng(1));
    const atStill = out.x;
    botInput(out, self, running, bowl, 'easy', new Rng(1));
    // The lag pulls the aim BEHIND the runner, which is a handicap and never a lead.
    expect(out.x).toBeLessThanOrEqual(atStill);
  });

  it('turns back towards the middle when it is the one hanging over the lip', () => {
    const out = vec2();
    const self = place(bowl, BOWL_RADIUS - 6, 0, 90);
    const other = place(bowl, 40, 0, 90);
    botInput(out, self, other, bowl, 'hard', new Rng(3));
    expect(out.x).toBeLessThan(0);
  });

  it('still finishes the push when the opponent is the one about to go', () => {
    const out = vec2();
    const self = place(bowl, BOWL_RADIUS - 70, 0, 20);
    const other = place(bowl, BOWL_RADIUS - 6, 0, 90);
    botInput(out, self, other, bowl, 'hard', new Rng(3));
    // Behind on spin, and charging anyway, because the trade wins the round.
    expect(out.x).toBeGreaterThan(0);
  });

  it('gives ground rather than trading when it is behind on spin', () => {
    const out = vec2();
    const self = place(bowl, -40, 0, 20);
    const other = place(bowl, 40, 0, 95);
    botInput(out, self, other, bowl, 'hard', new Rng(11));
    expect(out.x).toBeLessThan(0);
  });

  it('lets go of the stick when it is patient, holds the middle and has room', () => {
    const out = vec2();
    const self = place(bowl, 10, 0, 20);
    const other = place(bowl, 210, 0, 95);
    botInput(out, self, other, bowl, 'hard', new Rng(5));
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('never rests on the easy tier, which is what makes it burn its spin', () => {
    const out = vec2();
    const self = place(bowl, 10, 0, 20);
    const other = place(bowl, 210, 0, 95);
    botInput(out, self, other, bowl, 'easy', new Rng(5));
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1, 9);
  });

  it('never coasts with somebody bearing down on it', () => {
    const out = vec2();
    const self = place(bowl, 10, 0, 20);
    const other = place(bowl, 90, 0, 95);
    botInput(out, self, other, bowl, 'hard', new Rng(5));
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1, 9);
  });

  it('replays identically from the same seed', () => {
    const first = vec2();
    const second = vec2();
    const selfA = place(bowl, -80, 30, 70);
    const otherA = place(bowl, 60, -20, 88);
    botInput(first, selfA, otherA, bowl, 'normal', new Rng(20260823));
    botInput(second, selfA, otherA, bowl, 'normal', new Rng(20260823));
    expect([second.x, second.y]).toEqual([first.x, first.y]);
  });

  it('mirrors: the same position read from the other seat gives the mirrored steer', () => {
    const near = vec2();
    const far = vec2();
    const self = place(bowl, -80, 30, 70);
    const other = place(bowl, 60, -20, 88);
    other.vx = 140;
    other.vy = -40;
    botInput(near, self, other, bowl, 'normal', new Rng(77));
    botInput(far, mirror(self, bowl), mirror(other, bowl), bowl, 'normal', new Rng(77));
    expect(far.x).toBeCloseTo(-near.x, 9);
    expect(far.y).toBeCloseTo(-near.y, 9);
  });

  it('writes into the vector it is given rather than allocating one', () => {
    const out = vec2();
    expect(botInput(out, place(bowl, 0, 0), place(bowl, 90, 0), bowl, 'normal', new Rng(1))).toBe(
      out,
    );
  });
});
