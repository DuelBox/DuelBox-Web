import { describe, it, expect } from 'vitest';
import type { Vec2 } from './vec2.js';
import {
  vec2,
  set,
  copy,
  add,
  sub,
  scale,
  addScaled,
  negate,
  normalise,
  perp,
  lerp,
  rotate,
  reflect,
  dot,
  cross,
  length,
  lengthSq,
  distance,
  distanceSq,
  angle,
  equals,
  Vec2Pool,
} from './vec2.js';

function expectVec(v: Vec2, x: number, y: number, precision = 10): void {
  expect(v.x).toBeCloseTo(x, precision);
  expect(v.y).toBeCloseTo(y, precision);
}

describe('vec2', () => {
  it('defaults to the origin and stores the given components', () => {
    expectVec(vec2(), 0, 0);
    expectVec(vec2(3, -4), 3, -4);
  });

  it('allocates a fresh object each call', () => {
    expect(vec2(1, 2)).not.toBe(vec2(1, 2));
  });
});

describe('in-place operations', () => {
  it('set and copy write into out and return it', () => {
    const out = vec2();
    expect(set(out, 5, -7)).toBe(out);
    expectVec(out, 5, -7);
    const source = vec2(1.5, 2.5);
    expect(copy(out, source)).toBe(out);
    expectVec(out, 1.5, 2.5);
    expectVec(source, 1.5, 2.5);
  });

  it('add, sub, scale and addScaled compute known values', () => {
    const out = vec2();
    expectVec(add(out, vec2(1, 2), vec2(3, -5)), 4, -3);
    expectVec(sub(out, vec2(1, 2), vec2(3, -5)), -2, 7);
    expectVec(scale(out, vec2(3, -4), 2.5), 7.5, -10);
    expectVec(addScaled(out, vec2(1, 2), vec2(3, -5), 2), 7, -8);
    expectVec(addScaled(out, vec2(1, 2), vec2(3, -5), 0), 1, 2);
  });

  it('negate and perp', () => {
    const out = vec2();
    expectVec(negate(out, vec2(3, -4)), -3, 4);
    expectVec(perp(out, vec2(3, 4)), -4, 3);
    // perp is counter-clockwise: +x turns into +y
    expectVec(perp(out, vec2(1, 0)), 0, 1);
    expectVec(perp(out, vec2(0, 1)), -1, 0);
  });

  it('normalise produces a unit vector in the same direction', () => {
    const out = vec2();
    normalise(out, vec2(3, 4));
    expectVec(out, 0.6, 0.8);
    expect(length(out)).toBeCloseTo(1, 12);
    normalise(out, vec2(-10, 0));
    expectVec(out, -1, 0);
  });

  it('normalise of a zero vector yields (0, 0) rather than NaN', () => {
    const out = vec2(9, 9);
    normalise(out, vec2(0, 0));
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('normalise treats a length that underflows to zero as zero', () => {
    const out = vec2(9, 9);
    normalise(out, vec2(1e-200, 0));
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('lerp hits both endpoints exactly and the midpoint at t = 0.5', () => {
    const a = vec2(0, 0);
    const b = vec2(10, 20);
    const out = vec2();
    lerp(out, a, b, 0);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    lerp(out, a, b, 0.5);
    expect(out.x).toBe(5);
    expect(out.y).toBe(10);
    lerp(out, a, b, 1);
    expect(out.x).toBe(10);
    expect(out.y).toBe(20);
  });

  it('lerp extrapolates outside [0, 1]', () => {
    const out = vec2();
    expectVec(lerp(out, vec2(0, 0), vec2(10, 20), 2), 20, 40);
    expectVec(lerp(out, vec2(0, 0), vec2(10, 20), -1), -10, -20);
  });

  it('rotate by pi/2 turns +x into +y', () => {
    const out = vec2();
    rotate(out, vec2(1, 0), Math.PI / 2);
    expectVec(out, 0, 1);
    rotate(out, vec2(0, 1), Math.PI / 2);
    expectVec(out, -1, 0);
    rotate(out, vec2(3, 4), -Math.PI / 2);
    expectVec(out, 4, -3);
  });

  it('rotate by 2pi returns the original vector and preserves length', () => {
    const a = vec2(3, -4);
    const out = vec2();
    rotate(out, a, Math.PI * 2);
    expectVec(out, 3, -4);
    expect(length(out)).toBeCloseTo(5, 12);
  });

  it('reflect off an axis-aligned normal flips only the normal component', () => {
    const out = vec2();
    expectVec(reflect(out, vec2(3, -4), vec2(0, 1)), 3, 4);
    expectVec(reflect(out, vec2(3, -4), vec2(1, 0)), -3, -4);
    // a normal pointing the other way gives the same mirror
    expectVec(reflect(out, vec2(3, -4), vec2(0, -1)), 3, 4);
  });

  it('reflect off a diagonal normal swaps the axes', () => {
    const n = vec2();
    normalise(n, vec2(1, 1));
    const out = vec2();
    reflect(out, vec2(1, 0), n);
    expectVec(out, 0, -1);
    expect(length(out)).toBeCloseTo(1, 12);
  });

  it('reflect is an involution for a unit normal', () => {
    const n = vec2();
    normalise(n, vec2(2, -1));
    const out = vec2();
    reflect(out, vec2(5, 7), n);
    reflect(out, out, n);
    expectVec(out, 5, 7);
  });
});

describe('aliasing out with an input', () => {
  it('add, sub and addScaled are safe with either input', () => {
    const a = vec2(1, 2);
    const b = vec2(3, -5);
    add(a, a, b);
    expectVec(a, 4, -3);
    expectVec(b, 3, -5);

    set(a, 1, 2);
    add(b, a, b);
    expectVec(b, 4, -3);

    set(a, 1, 2);
    set(b, 3, -5);
    sub(a, a, b);
    expectVec(a, -2, 7);

    set(a, 1, 2);
    set(b, 3, -5);
    sub(b, a, b);
    expectVec(b, -2, 7);

    set(a, 1, 2);
    set(b, 3, -5);
    addScaled(a, a, b, 2);
    expectVec(a, 7, -8);

    set(a, 1, 2);
    set(b, 3, -5);
    addScaled(b, a, b, 2);
    expectVec(b, 7, -8);
  });

  it('add with both inputs aliased to out doubles the vector', () => {
    const a = vec2(3, -4);
    add(a, a, a);
    expectVec(a, 6, -8);
  });

  it('copy, scale, negate and normalise are safe in place', () => {
    const a = vec2(3, 4);
    copy(a, a);
    expectVec(a, 3, 4);
    scale(a, a, 2);
    expectVec(a, 6, 8);
    negate(a, a);
    expectVec(a, -6, -8);
    normalise(a, a);
    expectVec(a, -0.6, -0.8);
  });

  it('perp is safe in place', () => {
    const a = vec2(3, 4);
    perp(a, a);
    expectVec(a, -4, 3);
  });

  it('rotate is safe in place', () => {
    const a = vec2(1, 0);
    rotate(a, a, Math.PI / 2);
    expectVec(a, 0, 1);
  });

  it('lerp is safe with either input', () => {
    const a = vec2(0, 0);
    const b = vec2(10, 20);
    lerp(a, a, b, 0.5);
    expectVec(a, 5, 10);
    expectVec(b, 10, 20);

    set(a, 0, 0);
    lerp(b, a, b, 0.5);
    expectVec(b, 5, 10);
  });

  it('reflect is safe when out aliases the vector or the normal', () => {
    const a = vec2(3, -4);
    const n = vec2(0, 1);
    reflect(a, a, n);
    expectVec(a, 3, 4);
    expectVec(n, 0, 1);

    set(a, 3, -4);
    reflect(n, a, n);
    expectVec(n, 3, 4);
    expectVec(a, 3, -4);
  });
});

describe('scalar readers', () => {
  it('dot and cross', () => {
    expect(dot(vec2(1, 2), vec2(3, -5))).toBe(-7);
    expect(dot(vec2(1, 0), vec2(0, 1))).toBe(0);
    expect(cross(vec2(1, 0), vec2(0, 1))).toBe(1);
    expect(cross(vec2(0, 1), vec2(1, 0))).toBe(-1);
    expect(cross(vec2(2, 3), vec2(4, 6))).toBe(0);
  });

  it('length, lengthSq, distance and distanceSq', () => {
    const a = vec2(3, 4);
    expect(length(a)).toBe(5);
    expect(lengthSq(a)).toBe(25);
    expect(length(vec2(0, 0))).toBe(0);
    const b = vec2(6, 8);
    expect(distance(a, b)).toBe(5);
    expect(distanceSq(a, b)).toBe(25);
    expect(distance(a, a)).toBe(0);
  });

  it('readers do not modify their arguments', () => {
    const a = vec2(3, 4);
    const b = vec2(-1, 2);
    dot(a, b);
    cross(a, b);
    distance(a, b);
    angle(a);
    expectVec(a, 3, 4);
    expectVec(b, -1, 2);
  });

  it('angle reports direction in radians', () => {
    expect(angle(vec2(1, 0))).toBeCloseTo(0, 12);
    expect(angle(vec2(0, 1))).toBeCloseTo(Math.PI / 2, 12);
    expect(angle(vec2(-1, 0))).toBeCloseTo(Math.PI, 12);
    expect(angle(vec2(0, -1))).toBeCloseTo(-Math.PI / 2, 12);
    expect(angle(vec2(1, 1))).toBeCloseTo(Math.PI / 4, 12);
    expect(angle(vec2(0, 0))).toBe(0);
  });
});

describe('equals', () => {
  it('uses a default epsilon of 1e-6', () => {
    expect(equals(vec2(1, 2), vec2(1, 2))).toBe(true);
    expect(equals(vec2(1, 2), vec2(1 + 1e-7, 2 - 1e-7))).toBe(true);
    expect(equals(vec2(1, 2), vec2(1 + 1e-5, 2))).toBe(false);
    expect(equals(vec2(1, 2), vec2(1, 2 + 1e-5))).toBe(false);
  });

  it('honours an explicit epsilon', () => {
    expect(equals(vec2(0, 0), vec2(0.4, -0.4), 0.5)).toBe(true);
    expect(equals(vec2(0, 0), vec2(0.6, 0), 0.5)).toBe(false);
    expect(equals(vec2(0, 0), vec2(1e-9, 0), 0)).toBe(false);
    expect(equals(vec2(1, 2), vec2(1, 2), 0)).toBe(true);
  });
});

describe('Vec2Pool', () => {
  it('hands out distinct zeroed vectors', () => {
    const pool = new Vec2Pool(3);
    const a = pool.take();
    const b = pool.take();
    const c = pool.take();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
    expectVec(a, 0, 0);
    expectVec(b, 0, 0);
    expectVec(c, 0, 0);
    expect(pool.borrowed).toBe(3);
  });

  it('throws a RangeError naming the capacity when exhausted', () => {
    const pool = new Vec2Pool(2);
    pool.take();
    pool.take();
    expect(() => pool.take()).toThrow(RangeError);
    expect(() => pool.take()).toThrow(/capacity 2/);
    expect(pool.borrowed).toBe(2);
  });

  it('a zero-capacity pool throws on the first take', () => {
    const pool = new Vec2Pool(0);
    expect(() => pool.take()).toThrow(RangeError);
  });

  it('reuses the very same objects after reset, proving take() never allocates', () => {
    const pool = new Vec2Pool(2);
    const first = pool.take();
    const second = pool.take();
    set(first, 1, 2);
    set(second, 3, 4);
    pool.reset();
    expect(pool.borrowed).toBe(0);
    const third = pool.take();
    const fourth = pool.take();
    expect(third).toBe(first);
    expect(fourth).toBe(second);
    expectVec(third, 0, 0);
    expectVec(fourth, 0, 0);
  });

  it('release returns the most recent vectors for reuse', () => {
    const pool = new Vec2Pool(3);
    const a = pool.take();
    const b = pool.take();
    pool.release();
    expect(pool.borrowed).toBe(1);
    expect(pool.take()).toBe(b);

    pool.release(2);
    expect(pool.borrowed).toBe(0);
    expect(pool.take()).toBe(a);
  });

  it('rejects releasing more vectors than are borrowed', () => {
    const pool = new Vec2Pool(2);
    pool.take();
    expect(() => pool.release(2)).toThrow(RangeError);
    expect(pool.borrowed).toBe(1);
    expect(() => pool.release(-1)).toThrow(RangeError);
    pool.release(0);
    expect(pool.borrowed).toBe(1);
  });

  it('rejects an invalid capacity', () => {
    expect(() => new Vec2Pool(-1)).toThrow(RangeError);
    expect(() => new Vec2Pool(1.5)).toThrow(RangeError);
  });

  it('survives a steady take/reset cycle without new objects', () => {
    const pool = new Vec2Pool(2);
    const seen = pool.take();
    pool.reset();
    for (let i = 0; i < 100; i += 1) {
      const scratch = pool.take();
      expect(scratch).toBe(seen);
      set(scratch, i, -i);
      pool.reset();
    }
    expect(pool.borrowed).toBe(0);
  });
});
