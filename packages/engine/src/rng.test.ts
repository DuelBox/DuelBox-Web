import { describe, it, expect } from 'vitest';
import { Rng } from './rng.js';
import type { RngState } from './rng.js';

function drawRaw(rng: Rng, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(rng.next());
  }
  return out;
}

/** FNV-1a over the little-endian bytes of each draw. */
function checksum(rng: Rng, draws: number): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < draws; i += 1) {
    const v = rng.next();
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 24) & 0xff), 0x01000193);
  }
  return h >>> 0;
}

function ascending(length: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) {
    out.push(i);
  }
  return out;
}

describe('Rng sequence stability', () => {
  it('is a frozen algorithm: 1000 draws from a fixed seed keep their checksum', () => {
    // These pin xoshiro128** seeded by splitmix32. A change here breaks every
    // recorded match replay, so treat a failure as an intentional format break.
    expect(checksum(new Rng(12345), 1000)).toBe(3074871666);
    expect(checksum(new Rng(0), 1000)).toBe(1341485531);
  });

  it('emits the recorded opening draws for seed 12345', () => {
    expect(drawRaw(new Rng(12345), 3)).toEqual([1093274547, 203003357, 3741353573]);
  });

  it('returns unsigned 32-bit integers', () => {
    const rng = new Rng(8);
    let outOfRange = 0;
    for (let i = 0; i < 50000; i += 1) {
      const v = rng.next();
      if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) {
        outOfRange += 1;
      }
    }
    expect(outOfRange).toBe(0);
  });
});

describe('Rng seeding', () => {
  it('gives the same sequence for the same seed', () => {
    expect(drawRaw(new Rng(2024), 200)).toEqual(drawRaw(new Rng(2024), 200));
  });

  it('diverges immediately for adjacent seeds', () => {
    const a = drawRaw(new Rng(1), 1000);
    const b = drawRaw(new Rng(2), 1000);
    const c = drawRaw(new Rng(3), 1000);
    expect(a[0]).not.toBe(b[0]);
    expect(b[0]).not.toBe(c[0]);

    let collisions = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (a[i] === b[i]) {
        collisions += 1;
      }
      if (a[i] === c[i]) {
        collisions += 1;
      }
    }
    // Two independent streams collide about 2000 / 2**32 times; anything above a
    // handful means the seeds share state rather than being expanded apart.
    expect(collisions).toBeLessThan(4);
  });

  it('never sits in the all-zero state, whatever the seed', () => {
    for (let seed = -4; seed <= 4; seed += 1) {
      const state = new Rng(seed).save();
      expect(state.s0 | state.s1 | state.s2 | state.s3).not.toBe(0);
    }
  });

  it('reduces a seed to 32 bits rather than rejecting it', () => {
    expect(drawRaw(new Rng(7), 4)).toEqual(drawRaw(new Rng(7 + 0x100000000), 4));
    expect(() => new Rng(Number.NaN).next()).not.toThrow();
  });
});

describe('Rng.save / Rng.restore', () => {
  it('reproduces the exact continuation', () => {
    const rng = new Rng(42);
    drawRaw(rng, 10);

    const state = rng.save();
    const first = drawRaw(rng, 50);
    rng.restore(state);
    const second = drawRaw(rng, 50);

    expect(second).toEqual(first);
  });

  it('transfers a position between generators', () => {
    const source = new Rng(99);
    drawRaw(source, 17);
    const target = new Rng(-1);
    target.restore(source.save());

    expect(drawRaw(target, 20)).toEqual(drawRaw(source, 20));
  });

  it('round-trips as unsigned words', () => {
    const rng = new Rng(5);
    drawRaw(rng, 3);
    const state = rng.save();
    for (const word of [state.s0, state.s1, state.s2, state.s3]) {
      expect(Number.isInteger(word)).toBe(true);
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThanOrEqual(0xffffffff);
    }
    rng.restore(state);
    expect(rng.save()).toEqual(state);
  });

  it('rejects the all-zero state', () => {
    const dead: RngState = { s0: 0, s1: 0, s2: 0, s3: 0 };
    expect(() => new Rng(1).restore(dead)).toThrow(RangeError);
  });
});

describe('Rng.clone', () => {
  it('starts at the same position', () => {
    const rng = new Rng(31);
    drawRaw(rng, 4);
    const copy = rng.clone();

    expect(drawRaw(copy, 25)).toEqual(drawRaw(rng, 25));
  });

  it('advances independently of the original', () => {
    const rng = new Rng(31);
    const copy = rng.clone();

    drawRaw(rng, 100);
    expect(drawRaw(copy, 3)).toEqual(drawRaw(new Rng(31), 3));

    drawRaw(copy, 100);
    expect(rng.save()).not.toEqual(copy.save());
  });
});

describe('Rng.float', () => {
  it('stays within [0, 1) over many draws', () => {
    const rng = new Rng(77);
    let min = 1;
    let max = 0;
    let outside = 0;
    for (let i = 0; i < 200000; i += 1) {
      const v = rng.float();
      if (!(v >= 0 && v < 1)) {
        outside += 1;
      }
      if (v < min) {
        min = v;
      }
      if (v > max) {
        max = v;
      }
    }
    expect(outside).toBe(0);
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
  });

  it('lands exactly on the 2**-24 grid', () => {
    const rng = new Rng(4);
    let offGrid = 0;
    for (let i = 0; i < 50000; i += 1) {
      if (!Number.isInteger(rng.float() * 0x1000000)) {
        offGrid += 1;
      }
    }
    expect(offGrid).toBe(0);
  });
});

describe('Rng.int', () => {
  it('covers every value in a small range and never leaves it', () => {
    const rng = new Rng(99);
    const counts: number[] = [0, 0, 0, 0, 0, 0];
    let outside = 0;
    for (let i = 0; i < 60000; i += 1) {
      const v = rng.int(0, 6);
      if (!Number.isInteger(v) || v < 0 || v >= 6) {
        outside += 1;
      } else {
        counts[v] = (counts[v] ?? 0) + 1;
      }
    }
    expect(outside).toBe(0);
    for (let face = 0; face < 6; face += 1) {
      // Unbiased sampling puts each face near 10000; a modulo would skew the low faces.
      expect(counts[face]).toBeGreaterThan(9000);
      expect(counts[face]).toBeLessThan(11000);
    }
  });

  it('handles negative and straddling bounds', () => {
    const rng = new Rng(5);
    const seen = new Set<number>();
    let outside = 0;
    for (let i = 0; i < 50000; i += 1) {
      const v = rng.int(-3, 4);
      if (!Number.isInteger(v) || v < -3 || v >= 4) {
        outside += 1;
      }
      seen.add(v);
    }
    expect(outside).toBe(0);
    expect(seen.size).toBe(7);
  });

  it('handles a full 32-bit range and a range wider than 32 bits', () => {
    const rng = new Rng(21);
    let outside = 0;
    for (let i = 0; i < 20000; i += 1) {
      const wide = rng.int(0, 0x100000000);
      if (!Number.isSafeInteger(wide) || wide < 0 || wide >= 0x100000000) {
        outside += 1;
      }
      const wider = rng.int(0, 2 ** 40);
      if (!Number.isSafeInteger(wider) || wider < 0 || wider >= 2 ** 40) {
        outside += 1;
      }
    }
    expect(outside).toBe(0);
  });

  it('returns the only value of a degenerate range without consuming a draw', () => {
    const rng = new Rng(3);
    expect(rng.int(5, 6)).toBe(5);
    expect(rng.next()).toBe(new Rng(3).next());
  });

  it('rejects invalid bounds', () => {
    const rng = new Rng(1);
    expect(() => rng.int(0, 0)).toThrow(RangeError);
    expect(() => rng.int(4, 3)).toThrow(RangeError);
    expect(() => rng.int(1.5, 4)).toThrow(RangeError);
    expect(() => rng.int(0, 4.5)).toThrow(RangeError);
    expect(() => rng.int(Number.NaN, 4)).toThrow(RangeError);
    expect(() => rng.int(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => rng.int(0, Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => rng.int(-(2 ** 53 - 1), 2 ** 53 - 1)).toThrow(RangeError);
  });
});

describe('Rng.bool', () => {
  it('is balanced by default', () => {
    const rng = new Rng(1234);
    let trues = 0;
    for (let i = 0; i < 10000; i += 1) {
      if (rng.bool()) {
        trues += 1;
      }
    }
    expect(trues).toBeGreaterThan(4700);
    expect(trues).toBeLessThan(5300);
  });

  it('saturates at the ends of the probability range', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 1000; i += 1) {
      expect(rng.bool(0)).toBe(false);
      expect(rng.bool(1)).toBe(true);
    }
  });

  it('honours an intermediate probability', () => {
    const rng = new Rng(64);
    let trues = 0;
    for (let i = 0; i < 20000; i += 1) {
      if (rng.bool(0.25)) {
        trues += 1;
      }
    }
    expect(trues).toBeGreaterThan(4600);
    expect(trues).toBeLessThan(5400);
  });
});

describe('Rng.pick', () => {
  it('reaches every element', () => {
    const items = ['a', 'b', 'c', 'd'] as const;
    const rng = new Rng(11);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      seen.add(rng.pick(items));
    }
    expect(seen.size).toBe(items.length);
  });

  it('returns the sole element of a one-item array', () => {
    expect(new Rng(2).pick([7])).toBe(7);
  });

  it('throws on an empty array', () => {
    expect(() => new Rng(1).pick([])).toThrow(RangeError);
  });
});

describe('Rng.shuffle', () => {
  it('produces a permutation of the same multiset', () => {
    const items = ascending(64);
    items.push(0, 0, 63); // duplicates must survive in the same quantity
    const expected = items.slice().sort((a, b) => a - b);

    new Rng(7).shuffle(items);

    expect(items.slice().sort((a, b) => a - b)).toEqual(expected);
  });

  it('actually reorders', () => {
    const items = ascending(64);
    new Rng(7).shuffle(items);
    expect(items).not.toEqual(ascending(64));
  });

  it('is deterministic for a given seed and diverges for another', () => {
    const a = ascending(32);
    const b = ascending(32);
    const c = ascending(32);
    new Rng(7).shuffle(a);
    new Rng(7).shuffle(b);
    new Rng(8).shuffle(c);

    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('leaves empty and single-element arrays alone without consuming draws', () => {
    const rng = new Rng(1);
    const empty: number[] = [];
    const single = [9];
    rng.shuffle(empty);
    rng.shuffle(single);

    expect(empty).toEqual([]);
    expect(single).toEqual([9]);
    expect(rng.next()).toBe(new Rng(1).next());
  });

  it('spreads a marked element across every position', () => {
    const seen = new Set<number>();
    const items = ascending(8);
    const rng = new Rng(2048);
    for (let trial = 0; trial < 4000; trial += 1) {
      for (let i = 0; i < 8; i += 1) {
        items[i] = i;
      }
      rng.shuffle(items);
      seen.add(items.indexOf(0));
    }
    expect(seen.size).toBe(8);
  });
});
