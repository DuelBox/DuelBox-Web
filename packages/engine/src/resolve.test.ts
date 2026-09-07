import { describe, expect, it } from 'vitest';
import { createBody, resolveContact } from './resolve.js';
import type { Body } from './resolve.js';
import { createContact } from './collision.js';
import type { Contact } from './collision.js';
import { Rng } from './rng.js';

/** A contact with A to the left of B: +normal (pointing left) separates A from B. */
function horizontalContact(depth = 0): Contact {
  const c = createContact();
  c.hit = true;
  c.depth = depth;
  c.normalX = -1;
  c.normalY = 0;
  c.pointX = 0;
  c.pointY = 0;
  return c;
}

/** A contact with A resting on B below it: +normal points up. */
function floorContact(depth = 0): Contact {
  const c = createContact();
  c.hit = true;
  c.depth = depth;
  c.normalX = 0;
  c.normalY = 1;
  c.pointX = 0;
  c.pointY = 0;
  return c;
}

describe('normal impulse and restitution', () => {
  it('swaps velocities in a head-on elastic collision of equal masses', () => {
    const a = createBody({ vx: 2, invMass: 1, restitution: 1 });
    const b = createBody({ vx: -2, invMass: 1, restitution: 1 });
    resolveContact(a, b, horizontalContact(), { positionalCorrection: false });
    expect(a.vx).toBeCloseTo(-2, 9);
    expect(b.vx).toBeCloseTo(2, 9);
  });

  it('reflects a ball off an immovable wall with full restitution', () => {
    const ball = createBody({ vx: 3, invMass: 1, restitution: 1 });
    const wall = createBody({ invMass: 0, restitution: 1 });
    resolveContact(ball, wall, horizontalContact(), { positionalCorrection: false });
    expect(ball.vx).toBeCloseTo(-3, 9);
    expect(wall.vx).toBe(0);
  });

  it('absorbs the approach entirely at zero restitution', () => {
    const ball = createBody({ vx: 3, invMass: 1, restitution: 0 });
    const wall = createBody({ invMass: 0, restitution: 0 });
    resolveContact(ball, wall, horizontalContact(), { positionalCorrection: false });
    expect(ball.vx).toBeCloseTo(0, 9);
  });

  it('takes the lesser restitution of the pair', () => {
    const ball = createBody({ vx: 4, invMass: 1, restitution: 1 });
    const wall = createBody({ invMass: 0, restitution: 0.5 });
    resolveContact(ball, wall, horizontalContact(), { positionalCorrection: false });
    // e = min(1, 0.5) = 0.5, so it rebounds at half speed.
    expect(ball.vx).toBeCloseTo(-2, 9);
  });

  it('leaves a separating pair untouched', () => {
    const a = createBody({ vx: -2, invMass: 1, restitution: 1 });
    const b = createBody({ vx: 2, invMass: 1, restitution: 1 });
    const impulse = resolveContact(a, b, horizontalContact(), { positionalCorrection: false });
    expect(impulse).toBe(0);
    expect(a.vx).toBe(-2);
    expect(b.vx).toBe(2);
  });
});

describe('resting contact', () => {
  it('leaves a body at rest at rest and nudges it out of penetration', () => {
    const body = createBody({ x: 0, y: 0, vx: 0, vy: 0, invMass: 1, restitution: 0 });
    const floor = createBody({ invMass: 0 });
    const startY = body.y;
    for (let i = 0; i < 10; i += 1) {
      resolveContact(body, floor, floorContact(0.05));
    }
    // Velocity never grows from a resting contact.
    expect(body.vy).toBeCloseTo(0, 9);
    // Positional correction moves it out along +normal (upwards, +y here).
    expect(body.y).toBeGreaterThan(startY);
  });

  it('does not correct penetration smaller than the slop', () => {
    const body = createBody({ invMass: 1 });
    const floor = createBody({ invMass: 0 });
    const startY = body.y;
    resolveContact(body, floor, floorContact(0.005), { slopLogical: 0.01 });
    expect(body.y).toBe(startY);
  });
});

describe('friction', () => {
  it('reduces tangential velocity when a body is driven into a surface', () => {
    // Moving right and down into the floor; friction should bleed off the rightward speed.
    const mu = 0.5;
    const body = createBody({ vx: 2, vy: -1, invMass: 1, restitution: 0, friction: mu });
    const floor = createBody({ invMass: 0, friction: mu });
    resolveContact(body, floor, floorContact(), { positionalCorrection: false });
    expect(body.vy).toBeCloseTo(0, 9); // normal impulse cancels the downward speed
    // jt clamped to mu * j = 0.5 * 1 = 0.5, so vx drops 2 -> 1.5.
    expect(body.vx).toBeCloseTo(1.5, 9);
  });

  it('leaves tangential velocity alone with no friction', () => {
    const body = createBody({ vx: 2, vy: -1, invMass: 1, restitution: 0, friction: 0 });
    const floor = createBody({ invMass: 0, friction: 0 });
    resolveContact(body, floor, floorContact(), { positionalCorrection: false });
    expect(body.vx).toBeCloseTo(2, 9);
  });
});

describe('momentum soak', () => {
  function momentum(bodies: Body[]): { px: number; py: number } {
    let px = 0;
    let py = 0;
    for (const b of bodies) {
      const mass = 1 / b.invMass;
      px += mass * b.vx;
      py += mass * b.vy;
    }
    return { px, py };
  }

  it('conserves momentum across 1000 random dynamic-dynamic resolutions', () => {
    const rng = new Rng(2024);
    for (let trial = 0; trial < 1000; trial += 1) {
      const a = createBody({
        vx: rng.float() * 10 - 5,
        vy: rng.float() * 10 - 5,
        invMass: 0.25 + rng.float(),
        restitution: rng.float(),
        friction: rng.float(),
      });
      const b = createBody({
        vx: rng.float() * 10 - 5,
        vy: rng.float() * 10 - 5,
        invMass: 0.25 + rng.float(),
        restitution: rng.float(),
        friction: rng.float(),
      });
      // A random unit normal.
      const angle = rng.float() * Math.PI * 2;
      const c = createContact();
      c.hit = true;
      c.depth = 0;
      c.normalX = Math.cos(angle);
      c.normalY = Math.sin(angle);
      const before = momentum([a, b]);
      resolveContact(a, b, c, { positionalCorrection: false });
      const after = momentum([a, b]);
      expect(after.px).toBeCloseTo(before.px, 9);
      expect(after.py).toBeCloseTo(before.py, 9);
    }
  });

  it('conserves kinetic energy in a fully elastic equal-mass collision', () => {
    const a = createBody({ vx: 5, vy: 2, invMass: 1, restitution: 1 });
    const b = createBody({ vx: -1, vy: 3, invMass: 1, restitution: 1 });
    const ke = (): number => 0.5 * (a.vx ** 2 + a.vy ** 2) + 0.5 * (b.vx ** 2 + b.vy ** 2);
    const before = ke();
    resolveContact(a, b, horizontalContact(), { positionalCorrection: false });
    expect(ke()).toBeCloseTo(before, 9);
  });
});
