/**
 * Seeded deterministic randomness for the simulation.
 *
 * xoshiro128** over four 32-bit words, seeded by splitmix32. Every draw is exact
 * 32-bit integer arithmetic, so the same seed produces the same sequence on every
 * engine, platform, and device — which is what makes a cross-device match possible.
 */

/** Serialisable snapshot of a generator's position. All four words are unsigned 32-bit. */
export interface RngState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
}

/** Golden-ratio increment: an odd stride that keeps adjacent seeds in distant streams. */
const PHI32 = 0x9e3779b9 | 0;

/** 2**32, as a float. */
const TWO_32 = 0x100000000;

/** 2**24 — float() granularity, the largest power of two whose reciprocal is exact here. */
const TWO_24 = 0x1000000;

/** 2**53 — the widest int() range that stays exactly representable in a double. */
const MAX_RANGE = 0x20000000000000;

/** splitmix32 finaliser: avalanches one 32-bit word so nearby inputs give unrelated outputs. */
function splitmix32(x: number): number {
  let z = x | 0;
  z = (z ^ (z >>> 16)) | 0;
  z = Math.imul(z, 0x21f0aaad);
  z = (z ^ (z >>> 15)) | 0;
  z = Math.imul(z, 0x735a2d97);
  z = (z ^ (z >>> 15)) | 0;
  return z | 0;
}

export class Rng {
  /** State words, held signed; ToInt32 form of the unsigned values in {@link RngState}. */
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  /** `seed` is reduced to 32 bits (non-integers truncate, NaN seeds as 0). */
  constructor(seed: number) {
    let x = seed | 0;
    x = (x + PHI32) | 0;
    this.s0 = splitmix32(x);
    x = (x + PHI32) | 0;
    this.s1 = splitmix32(x);
    x = (x + PHI32) | 0;
    this.s2 = splitmix32(x);
    x = (x + PHI32) | 0;
    this.s3 = splitmix32(x);
    // All-zero is xoshiro's fixed point and would emit zeros forever.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) {
      this.s3 = 1;
    }
  }

  /** Advances the generator and returns the raw draw as an unsigned 32-bit integer. */
  next(): number {
    const s1 = this.s1;
    const scaled = Math.imul(s1, 5);
    const rotated = (scaled << 7) | (scaled >>> 25) | 0;
    const result = Math.imul(rotated, 9) >>> 0;

    const t = (s1 << 9) | 0;
    let a = this.s0;
    let b = s1;
    let c = this.s2;
    let d = this.s3;
    c = (c ^ a) | 0;
    d = (d ^ b) | 0;
    b = (b ^ c) | 0;
    a = (a ^ d) | 0;
    c = (c ^ t) | 0;
    d = (d << 11) | (d >>> 21) | 0;
    this.s0 = a;
    this.s1 = b;
    this.s2 = c;
    this.s3 = d;

    return result;
  }

  /** Uniform in [0, 1) on a 2**-24 grid, so every result is exactly representable. */
  float(): number {
    return (this.next() >>> 8) / TWO_24;
  }

  /**
   * Uniform integer in [minInclusive, maxExclusive).
   *
   * @throws RangeError if the bounds are not safe integers, do not increase, or span
   * more than 2**53 values (beyond which a double cannot hold every candidate).
   */
  int(minInclusive: number, maxExclusive: number): number {
    if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxExclusive)) {
      throw new RangeError('Rng.int: bounds must be safe integers');
    }
    if (maxExclusive <= minInclusive) {
      throw new RangeError('Rng.int: maxExclusive must be greater than minInclusive');
    }
    const range = maxExclusive - minInclusive;
    if (range > MAX_RANGE) {
      throw new RangeError('Rng.int: range must not exceed 2**53');
    }
    return minInclusive + this.below(range);
  }

  /** True with the given probability; outside [0, 1] it saturates to always/never. */
  bool(probability = 0.5): boolean {
    return this.float() < probability;
  }

  /** Uniform element. @throws RangeError if `items` is empty. */
  pick<T>(items: readonly T[]): T {
    const length = items.length;
    if (length === 0) {
      throw new RangeError('Rng.pick: cannot pick from an empty array');
    }
    return items[this.below(length)]!; // below() returns an index in [0, length)
  }

  /** In-place unbiased Fisher-Yates. Allocation-free, safe on a per-step path. */
  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.below(i + 1);
      const held = items[i]!; // i < items.length
      items[i] = items[j]!; // j <= i < items.length
      items[j] = held;
    }
  }

  /** Snapshot of the current position. Allocates — not for per-step use. */
  save(): RngState {
    return {
      s0: this.s0 >>> 0,
      s1: this.s1 >>> 0,
      s2: this.s2 >>> 0,
      s3: this.s3 >>> 0,
    };
  }

  /** @throws RangeError if the state is all-zero, which no live generator can hold. */
  restore(state: RngState): void {
    const s0 = state.s0 | 0;
    const s1 = state.s1 | 0;
    const s2 = state.s2 | 0;
    const s3 = state.s3 | 0;
    if ((s0 | s1 | s2 | s3) === 0) {
      throw new RangeError('Rng.restore: state must not be all-zero');
    }
    this.s0 = s0;
    this.s1 = s1;
    this.s2 = s2;
    this.s3 = s3;
  }

  /** A generator at this position that advances independently of this one. */
  clone(): Rng {
    const copy = new Rng(0);
    copy.s0 = this.s0;
    copy.s1 = this.s1;
    copy.s2 = this.s2;
    copy.s3 = this.s3;
    return copy;
  }

  /**
   * Uniform integer in [0, range) by rejection sampling over the smallest power of
   * two that covers `range` — never a modulo, which would bias the low values.
   * Caller guarantees `range` is an integer in [1, 2**53].
   */
  private below(range: number): number {
    if (range === 1) {
      return 0;
    }
    if (range <= TWO_32) {
      // clz32(range - 1) is 32 minus the bit width needed, i.e. the bits to discard.
      const shift = Math.clz32(range - 1);
      for (;;) {
        const v = this.next() >>> shift;
        if (v < range) {
          return v;
        }
      }
    }
    // Over 32 bits: one draw supplies the high word, a second the low 32 bits.
    const hiShift = Math.clz32(Math.floor((range - 1) / TWO_32));
    for (;;) {
      const hi = this.next() >>> hiShift;
      const v = hi * TWO_32 + this.next();
      if (v < range) {
        return v;
      }
    }
  }
}
