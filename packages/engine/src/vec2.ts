/**
 * 2D vector maths in logical simulation units (never pixels).
 *
 * Every operation writes into an explicit `out` and returns it, so the caller
 * owns all allocation. `vec2()` and `new Vec2Pool()` are the only functions in
 * this module that allocate; nothing else may be called on a hot path without
 * one of those having supplied the storage first.
 *
 * All operations read their inputs into locals before writing, so `out` may
 * alias any input (e.g. `add(a, a, b)` or `rotate(a, a, t)`).
 */

/** A plain mutable pair. Deliberately not a class: cheap to allocate, cheap to reuse. */
export interface Vec2 {
  x: number;
  y: number;
}

const DEFAULT_EPSILON = 1e-6;

/** The only allocating helper. Setup code only, never per step or per frame. */
export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function copy(out: Vec2, a: Vec2): Vec2 {
  out.x = a.x;
  out.y = a.y;
  return out;
}

export function add(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ax = a.x;
  const ay = a.y;
  const bx = b.x;
  const by = b.y;
  out.x = ax + bx;
  out.y = ay + by;
  return out;
}

export function sub(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ax = a.x;
  const ay = a.y;
  const bx = b.x;
  const by = b.y;
  out.x = ax - bx;
  out.y = ay - by;
  return out;
}

export function scale(out: Vec2, a: Vec2, s: number): Vec2 {
  const ax = a.x;
  const ay = a.y;
  out.x = ax * s;
  out.y = ay * s;
  return out;
}

/** out = a + b * s. */
export function addScaled(out: Vec2, a: Vec2, b: Vec2, s: number): Vec2 {
  const ax = a.x;
  const ay = a.y;
  const bx = b.x;
  const by = b.y;
  out.x = ax + bx * s;
  out.y = ay + by * s;
  return out;
}

export function negate(out: Vec2, a: Vec2): Vec2 {
  const ax = a.x;
  const ay = a.y;
  out.x = -ax;
  out.y = -ay;
  return out;
}

/**
 * Unit vector in the direction of `a`. A zero-length input yields (0, 0) rather
 * than NaN. Lengths that underflow to zero when squared are treated as zero.
 */
export function normalise(out: Vec2, a: Vec2): Vec2 {
  const ax = a.x;
  const ay = a.y;
  const lenSq = ax * ax + ay * ay;
  if (lenSq === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const inv = 1 / Math.sqrt(lenSq);
  out.x = ax * inv;
  out.y = ay * inv;
  return out;
}

/** Counter-clockwise perpendicular: (-y, x). */
export function perp(out: Vec2, a: Vec2): Vec2 {
  const ax = a.x;
  const ay = a.y;
  out.x = -ay;
  out.y = ax;
  return out;
}

/** out = a + (b - a) * t. `t` is not clamped. */
export function lerp(out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 {
  const ax = a.x;
  const ay = a.y;
  const bx = b.x;
  const by = b.y;
  out.x = ax + (bx - ax) * t;
  out.y = ay + (by - ay) * t;
  return out;
}

/** Rotate counter-clockwise by `radians`. */
export function rotate(out: Vec2, a: Vec2, radians: number): Vec2 {
  const ax = a.x;
  const ay = a.y;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  out.x = ax * c - ay * s;
  out.y = ax * s + ay * c;
  return out;
}

/**
 * Mirror `a` about the plane through the origin with the given normal:
 * out = a - 2 * (a . normal) * normal.
 * Invariant: `normal` is unit length; the caller must normalise it first.
 */
export function reflect(out: Vec2, a: Vec2, normal: Vec2): Vec2 {
  const ax = a.x;
  const ay = a.y;
  const nx = normal.x;
  const ny = normal.y;
  const d = 2 * (ax * nx + ay * ny);
  out.x = ax - d * nx;
  out.y = ay - d * ny;
  return out;
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** The z component of the 3D cross product of (a, 0) and (b, 0). */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function length(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function lengthSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function distance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Direction of `a` in radians, in (-pi, pi]. Zero vector yields 0. */
export function angle(a: Vec2): number {
  return Math.atan2(a.y, a.x);
}

/** Component-wise comparison; a difference of exactly `epsilon` still counts as equal. */
export function equals(a: Vec2, b: Vec2, epsilon: number = DEFAULT_EPSILON): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

/**
 * Fixed-size scratch store for temporaries inside a step or frame.
 *
 * Every vector is allocated in the constructor, so `take()` only hands back a
 * pointer. Typical use is `take()` a few vectors at the top of a function and
 * `release(n)` the same number before returning, or `reset()` once per step.
 */
export class Vec2Pool {
  readonly capacity: number;
  readonly #slots: Vec2[];
  #borrowed = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new RangeError(
        `Vec2Pool capacity must be a non-negative integer, received ${capacity}`,
      );
    }
    this.capacity = capacity;
    this.#slots = new Array<Vec2>(capacity);
    for (let i = 0; i < capacity; i += 1) {
      this.#slots[i] = { x: 0, y: 0 };
    }
  }

  /** Number of vectors handed out and not yet released. */
  get borrowed(): number {
    return this.#borrowed;
  }

  /** Borrow one zeroed vector. Never allocates; throws once `capacity` is reached. */
  take(): Vec2 {
    const i = this.#borrowed;
    if (i >= this.capacity) {
      throw new RangeError(`Vec2Pool exhausted: capacity ${this.capacity}`);
    }
    const v = this.#slots[i]!; // invariant: i < capacity and the constructor filled every slot
    this.#borrowed = i + 1;
    v.x = 0;
    v.y = 0;
    return v;
  }

  /** Return the `count` most recently borrowed vectors. */
  release(count = 1): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(
        `Vec2Pool release count must be a non-negative integer, received ${count}`,
      );
    }
    if (count > this.#borrowed) {
      throw new RangeError(
        `Vec2Pool cannot release ${count} vectors: only ${this.#borrowed} borrowed`,
      );
    }
    this.#borrowed -= count;
  }

  /** Return every borrowed vector. Values are not cleared until they are taken again. */
  reset(): void {
    this.#borrowed = 0;
  }
}
