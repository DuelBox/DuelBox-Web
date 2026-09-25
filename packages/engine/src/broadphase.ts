/**
 * Uniform-grid spatial-hash broadphase.
 *
 * Narrow-phase collision (the tests in `collision.ts`) is cheap per pair and
 * ruinous per *every* pair: two hundred bodies is 19,900 brute-force pairs a step.
 * The broadphase's job is to hand the narrow-phase only the pairs that could
 * plausibly touch — the ones sharing a grid cell — and drop the rest.
 *
 * The grid is a hash from integer cell coordinates to a bucket of the proxies in
 * that cell. Buckets, the active-bucket list, and the proxy store are all reused
 * between frames: `clear()` resets counts without freeing anything, so after a
 * warmup frame a steady stream of identical frames allocates nothing at all. The
 * `allocations` counter makes that testable — it climbs only when a structure has
 * to grow, and a benchmark asserts it stays flat once warm.
 *
 * A body's AABB may span several cells, so it is inserted into each. To keep a
 * candidate pair from being emitted once per shared cell, a pair is emitted only
 * from the top-left cell the two bodies share — an O(1) test per candidate that
 * needs no per-frame Set. The result is each overlapping-in-cell-space pair exactly
 * once, and never a pair whose cells do not meet.
 *
 * Everything is in LOGICAL units; `cellSize` is chosen by the game, ideally around
 * the diameter of its typical body.
 */

interface Bucket {
  /** Cell coordinates this bucket stands for; used to dedupe multi-cell proxies. */
  cx: number;
  cy: number;
  /** Proxy indices in this cell. Reused across frames; `count` is the live length. */
  slots: number[];
  count: number;
}

/** Signed 16-bit cell coordinates pack into one exact key; beyond this, cells could alias. */
const CELL_MIN = -32768;
const CELL_MAX = 32767;

function packKey(cx: number, cy: number): number {
  return ((cx & 0xffff) << 16) | (cy & 0xffff);
}

export class SpatialHash {
  readonly #cellSize: number;
  readonly #invCellSize: number;
  readonly #buckets = new Map<number, Bucket>();
  /** Buckets holding at least one proxy this frame, iterated by index so no iterator allocates. */
  readonly #active: Bucket[] = [];
  #activeCount = 0;

  // Proxy store: parallel arrays grown together, indexed by insertion slot.
  #id: number[] = [];
  #minCx: number[] = [];
  #minCy: number[] = [];
  #maxCx: number[] = [];
  #maxCy: number[] = [];
  #capacity = 0;
  #count = 0;

  /** Structural growth events. Flat once warm; a benchmark asserts it stops climbing. */
  #allocations = 0;

  constructor(cellSize: number) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError(
        `cellSize must be a positive finite number, received ${String(cellSize)}`,
      );
    }
    this.#cellSize = cellSize;
    this.#invCellSize = 1 / cellSize;
  }

  get cellSize(): number {
    return this.#cellSize;
  }

  /** Number of proxies inserted since the last clear. */
  get size(): number {
    return this.#count;
  }

  /** Cumulative structural allocations. Compare across frames to prove steady state is free. */
  get allocations(): number {
    return this.#allocations;
  }

  /**
   * Pre-create a bucket for every cell touching the given region, and reserve room
   * for `bodyHint` proxies and for every prewarmed cell in the active list.
   *
   * Setup only. A game that knows its arena bounds calls this once so that no bucket,
   * proxy array, or active-list entry is ever allocated during a step — the grid is
   * fully warm before the first frame. Idempotent; cells already present are left as is.
   *
   * @throws RangeError if the region reaches a cell outside the supported range.
   */
  prewarm(minX: number, minY: number, maxX: number, maxY: number, bodyHint = 0): void {
    const minCx = Math.floor(minX * this.#invCellSize);
    const minCy = Math.floor(minY * this.#invCellSize);
    const maxCx = Math.floor(maxX * this.#invCellSize);
    const maxCy = Math.floor(maxY * this.#invCellSize);
    if (minCx < CELL_MIN || maxCx > CELL_MAX || minCy < CELL_MIN || maxCy > CELL_MAX) {
      throw new RangeError(
        'SpatialHash: prewarm region reaches a cell outside the supported range',
      );
    }
    if (bodyHint > 0) this.#ensureCapacity(bodyHint);
    // A cell can hold at most every body, so sizing each bucket's slots to the body
    // hint guarantees no bucket ever grows during a step — the strongest zero-alloc
    // guarantee, at the cost of some reserved memory a game opts into knowingly.
    const slotHint = bodyHint > 0 ? bodyHint : 0;
    let cells = 0;
    for (let cy = minCy; cy <= maxCy; cy += 1) {
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const key = packKey(cx, cy);
        if (this.#buckets.get(key) === undefined) {
          const slots: number[] = [];
          if (slotHint > 0) slots.length = slotHint;
          this.#buckets.set(key, { cx, cy, slots, count: 0 });
          this.#allocations += 1;
        }
        cells += 1;
      }
    }
    // Reserve the active list so no frame has to grow it; holes stay unread past #activeCount.
    if (this.#active.length < cells) {
      this.#active.length = cells;
      this.#allocations += 1;
    }
  }

  /** Reset for a new frame. Keeps every backing store; frees nothing. Allocation-free. */
  clear(): void {
    for (let i = 0; i < this.#activeCount; i += 1) {
      this.#active[i]!.count = 0;
    }
    this.#activeCount = 0;
    this.#count = 0;
  }

  /**
   * Insert a body's AABB under `id`. The same `id` may be inserted once per frame;
   * inserting it twice adds it twice. Allocation-free once the grid is warm.
   *
   * @throws RangeError if the AABB reaches a cell outside the supported coordinate
   * range, where cell keys could alias and a pair could be missed.
   */
  insert(id: number, minX: number, minY: number, maxX: number, maxY: number): void {
    const minCx = Math.floor(minX * this.#invCellSize);
    const minCy = Math.floor(minY * this.#invCellSize);
    const maxCx = Math.floor(maxX * this.#invCellSize);
    const maxCy = Math.floor(maxY * this.#invCellSize);
    if (minCx < CELL_MIN || maxCx > CELL_MAX || minCy < CELL_MIN || maxCy > CELL_MAX) {
      throw new RangeError('SpatialHash: AABB reaches a cell outside the supported range');
    }

    const slot = this.#count;
    this.#ensureCapacity(slot + 1);
    this.#id[slot] = id;
    this.#minCx[slot] = minCx;
    this.#minCy[slot] = minCy;
    this.#maxCx[slot] = maxCx;
    this.#maxCy[slot] = maxCy;
    this.#count = slot + 1;

    for (let cy = minCy; cy <= maxCy; cy += 1) {
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        this.#appendToCell(cx, cy, slot);
      }
    }
  }

  /**
   * Call `callback` once for each candidate pair — two proxies sharing a cell —
   * with no pair repeated. Allocation-free. The callback receives the two ids in
   * insertion order within the shared cell.
   */
  forEachPair(callback: (idA: number, idB: number) => void): void {
    const active = this.#active;
    const count = this.#activeCount;
    for (let b = 0; b < count; b += 1) {
      const bucket = active[b]!;
      const cx = bucket.cx;
      const cy = bucket.cy;
      const slots = bucket.slots;
      const n = bucket.count;
      for (let i = 0; i < n; i += 1) {
        const pi = slots[i]!;
        for (let j = i + 1; j < n; j += 1) {
          const pj = slots[j]!;
          // Emit only from the top-left cell the pair shares, so a pair spanning
          // several shared cells is reported exactly once.
          const sharedCx =
            this.#minCx[pi]! > this.#minCx[pj]! ? this.#minCx[pi]! : this.#minCx[pj]!;
          if (sharedCx !== cx) continue;
          const sharedCy =
            this.#minCy[pi]! > this.#minCy[pj]! ? this.#minCy[pi]! : this.#minCy[pj]!;
          if (sharedCy !== cy) continue;
          callback(this.#id[pi]!, this.#id[pj]!);
        }
      }
    }
  }

  /** Count candidate pairs without collecting them. For benchmarks. */
  candidatePairCount(): number {
    let n = 0;
    this.forEachPair(() => {
      n += 1;
    });
    return n;
  }

  #appendToCell(cx: number, cy: number, slot: number): void {
    const key = packKey(cx, cy);
    let bucket = this.#buckets.get(key);
    if (bucket === undefined) {
      bucket = { cx, cy, slots: [], count: 0 };
      this.#buckets.set(key, bucket);
      this.#allocations += 1;
    } else if (bucket.cx !== cx || bucket.cy !== cy) {
      // Two distinct cells hashed to the same key: outside the supported range.
      throw new RangeError('SpatialHash: cell key collision, coordinates out of range');
    }
    if (bucket.count === 0) {
      this.#pushActive(bucket);
    }
    if (bucket.count === bucket.slots.length) {
      // Double rather than grow by one, so per-cell growth events are logarithmic in
      // the peak occupancy and stop once the busiest a cell has ever been is reached.
      bucket.slots.length = bucket.slots.length === 0 ? 4 : bucket.slots.length * 2;
      this.#allocations += 1;
    }
    bucket.slots[bucket.count] = slot;
    bucket.count += 1;
  }

  #pushActive(bucket: Bucket): void {
    if (this.#activeCount === this.#active.length) {
      this.#active.push(bucket);
      this.#allocations += 1;
    } else {
      this.#active[this.#activeCount] = bucket;
    }
    this.#activeCount += 1;
  }

  #ensureCapacity(n: number): void {
    if (n <= this.#capacity) return;
    // Double, so growth events are logarithmic and stop once the body count settles.
    let cap = this.#capacity === 0 ? 16 : this.#capacity;
    while (cap < n) cap *= 2;
    this.#id.length = cap;
    this.#minCx.length = cap;
    this.#minCy.length = cap;
    this.#maxCx.length = cap;
    this.#maxCy.length = cap;
    this.#capacity = cap;
    this.#allocations += 1;
  }
}

/**
 * Brute-force pair generation over `count` bodies: every unordered pair. The
 * baseline a spatial hash is measured against, and a small enough reference to
 * cross-check the hash's correctness in a test.
 */
export function forEachBrutePair(count: number, callback: (a: number, b: number) => void): void {
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      callback(i, j);
    }
  }
}

/** Count of brute-force pairs: n(n-1)/2. */
export function brutePairCount(count: number): number {
  return (count * (count - 1)) / 2;
}
