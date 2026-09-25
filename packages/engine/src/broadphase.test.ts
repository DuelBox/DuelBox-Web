import { describe, expect, it } from 'vitest';
import { SpatialHash, brutePairCount, forEachBrutePair } from './broadphase.js';

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function aabbOverlap(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** A deterministic grid of unit boxes with a small gap, `side` x `side` of them. */
function gridOfBoxes(side: number, spacing: number, size: number): Box[] {
  const boxes: Box[] = [];
  for (let gy = 0; gy < side; gy += 1) {
    for (let gx = 0; gx < side; gx += 1) {
      const x = gx * spacing;
      const y = gy * spacing;
      boxes.push({ minX: x, minY: y, maxX: x + size, maxY: y + size });
    }
  }
  return boxes;
}

function insertAll(hash: SpatialHash, boxes: Box[]): void {
  hash.clear();
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i]!;
    hash.insert(i, b.minX, b.minY, b.maxX, b.maxY);
  }
}

describe('candidate correctness', () => {
  it('reports every genuinely overlapping pair (no false negatives)', () => {
    const boxes = gridOfBoxes(6, 3, 4); // size 4, spacing 3: neighbours overlap
    const hash = new SpatialHash(4);
    insertAll(hash, boxes);

    const candidates = new Set<string>();
    hash.forEachPair((a, b) => {
      candidates.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    });

    forEachBrutePair(boxes.length, (a, b) => {
      if (aabbOverlap(boxes[a]!, boxes[b]!)) {
        expect(candidates.has(`${a}-${b}`), `missing overlapping pair ${a}-${b}`).toBe(true);
      }
    });
  });

  it('emits each candidate pair exactly once even for multi-cell bodies', () => {
    // Boxes larger than a cell so each spans several cells.
    const boxes = gridOfBoxes(5, 2, 5);
    const hash = new SpatialHash(2);
    insertAll(hash, boxes);

    const seen = new Map<string, number>();
    hash.forEachPair((a, b) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    });
    for (const [key, times] of seen) {
      expect(times, `pair ${key} emitted ${times} times`).toBe(1);
    }
  });
});

describe('candidate-pair reduction vs brute force (benchmark)', () => {
  it('cuts candidate pairs by an order of magnitude for 200 scattered bodies', () => {
    const boxes = gridOfBoxes(15, 5, 1); // 225 bodies, size 1, spacing 5: mostly disjoint
    const hash = new SpatialHash(5);
    insertAll(hash, boxes);

    const brute = brutePairCount(boxes.length);
    const candidates = hash.candidatePairCount();

    // The whole point: the hash hands the narrow-phase a tiny fraction of the pairs.
    expect(candidates).toBeLessThan(brute / 10);
    // And it still finds the real overlaps: none here, and none reported.
    expect(candidates).toBe(0);
  });

  it('keeps the true overlaps while still beating brute force when bodies cluster', () => {
    const boxes = gridOfBoxes(15, 2, 3); // 225 bodies, neighbours overlap
    const hash = new SpatialHash(3);
    insertAll(hash, boxes);

    let realOverlaps = 0;
    forEachBrutePair(boxes.length, (a, b) => {
      if (aabbOverlap(boxes[a]!, boxes[b]!)) realOverlaps += 1;
    });

    const candidates = hash.candidatePairCount();
    expect(candidates).toBeGreaterThanOrEqual(realOverlaps); // no missed overlaps
    expect(candidates).toBeLessThan(brutePairCount(boxes.length)); // still a reduction
  });
});

describe('zero steady-state allocation', () => {
  it('stops allocating once the grid is warm across repeated identical frames', () => {
    const boxes = gridOfBoxes(12, 3, 2);
    const hash = new SpatialHash(3);

    // Warm up: first frames build buckets, the active list and the proxy store.
    insertAll(hash, boxes);
    hash.candidatePairCount();
    insertAll(hash, boxes);
    hash.candidatePairCount();

    const warm = hash.allocations;
    // Many more identical frames must add nothing.
    for (let frame = 0; frame < 50; frame += 1) {
      insertAll(hash, boxes);
      hash.candidatePairCount();
    }
    expect(hash.allocations).toBe(warm);
  });

  it('does allocate while still growing, proving the counter is real', () => {
    const hash = new SpatialHash(3);
    const boxes = gridOfBoxes(4, 3, 2);
    insertAll(hash, boxes);
    expect(hash.allocations).toBeGreaterThan(0);
  });
});

describe('guards', () => {
  it('rejects a non-positive cell size', () => {
    expect(() => new SpatialHash(0)).toThrow();
    expect(() => new SpatialHash(-1)).toThrow();
  });

  it('rejects an AABB outside the supported coordinate range', () => {
    const hash = new SpatialHash(1);
    expect(() => hash.insert(0, 1e9, 1e9, 1e9 + 1, 1e9 + 1)).toThrow();
  });
});
