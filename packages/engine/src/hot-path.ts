/**
 * A representative engine update loop, and the counting harness that proves it
 * allocates nothing per step.
 *
 * GC pauses land precisely during the busiest, most competitive moments of a match,
 * because that is when the most objects are being made. The defence is a hot path
 * that makes none — and a regression benchmark that fails the day one creeps back
 * in. This module is that benchmark's subject: a small but genuine simulation wired
 * from the engine's pooled parts — a spatial-hash broadphase, the impulse resolver,
 * a pooled particle system, a tween, and screen shake — stepped like a real game.
 *
 * Allocation is measured two ways, both deterministic:
 *
 * 1. A **counting shim**. Every structure in the loop that can grow reports its
 *    structural allocations; {@link RepresentativeLoop.structuralAllocations} sums
 *    them. Once warm this is flat, and a benchmark asserts it stays flat over N
 *    steps. Break a pool so it allocates per step and the number climbs.
 *
 * 2. A **heap-delta harness** ({@link measureHeapBytesPerStep}), used by the test
 *    only when the runtime exposes `gc()` (Node with `--expose-gc`). It settles the
 *    heap, runs N steps, settles again, and reports RETAINED bytes grown per step. It
 *    catches a per-step allocation the counting shim cannot — one that is *kept*, like
 *    an unbounded buffer or a cache that never evicts. It is deliberately not a
 *    transient-churn detector: a short-lived object literal is collected by the second
 *    `gc()` and is invisible to any retained-heap measure. Node exposes no cheap,
 *    deterministic transient-allocation count, so that gap is covered by the loop being
 *    written allocation-free by construction (bound callbacks, scratch objects) and by
 *    the counting shim guarding the pooled machinery. Skipped, not failed, without `gc()`.
 *
 * The loop itself follows every engine rule it exercises: seeded RNG, fixed-step
 * deltas, logical units, and not one per-step object literal or closure — the pair
 * and particle callbacks are bound once in the constructor.
 */

import { SpatialHash } from './broadphase.js';
import { circleCircle, createContact } from './collision.js';
import type { Circle, Contact } from './collision.js';
import { resolveContact } from './resolve.js';
import type { Body } from './resolve.js';
import { ParticlePool } from './particle.js';
import type { EmitterConfig } from './particle.js';
import { ScreenShake } from './juice.js';
import { TweenSequence } from './tween.js';
import { Rng } from './rng.js';

export interface RepresentativeLoopOptions {
  readonly bodyCount?: number;
  readonly worldSize?: number;
  readonly radius?: number;
  readonly particleCapacity?: number;
  readonly seed?: number;
}

const SPARKS: EmitterConfig = {
  x: 0,
  y: 0,
  speedMin: 1,
  speedMax: 4,
  angleMin: 0,
  angleMax: Math.PI * 2,
  lifeMin: 0.2,
  lifeMax: 0.6,
  sizeMin: 0.05,
  sizeMax: 0.2,
  gravityY: 3,
};

export class RepresentativeLoop {
  readonly #n: number;
  readonly #world: number;
  readonly #radius: number;

  // Body state in structure-of-arrays; allocated once.
  readonly #x: Float64Array;
  readonly #y: Float64Array;
  readonly #vx: Float64Array;
  readonly #vy: Float64Array;

  readonly #hash: SpatialHash;
  readonly #particles: ParticlePool;
  readonly #shake: ScreenShake;
  readonly #tween: TweenSequence;
  readonly #rng: Rng;

  // Persistent scratch reused every pair; never reallocated.
  readonly #contact: Contact = createContact();
  readonly #circleA: Circle = { x: 0, y: 0, radius: 0 };
  readonly #circleB: Circle = { x: 0, y: 0, radius: 0 };
  readonly #bodyA: Body = { x: 0, y: 0, vx: 0, vy: 0, invMass: 1, restitution: 1, friction: 0 };
  readonly #bodyB: Body = { x: 0, y: 0, vx: 0, vy: 0, invMass: 1, restitution: 1, friction: 0 };

  #ownAllocations = 0;
  #stepCount = 0;

  constructor(options?: RepresentativeLoopOptions) {
    const n = options?.bodyCount ?? 120;
    const world = options?.worldSize ?? 100;
    const radius = options?.radius ?? 1.5;
    const capacity = options?.particleCapacity ?? 256;
    this.#n = n;
    this.#world = world;
    this.#radius = radius;
    this.#x = new Float64Array(n);
    this.#y = new Float64Array(n);
    this.#vx = new Float64Array(n);
    this.#vy = new Float64Array(n);
    this.#rng = new Rng(options?.seed ?? 1);
    // Cell around four radii keeps a handful of bodies per cell.
    this.#hash = new SpatialHash(radius * 4);
    this.#particles = new ParticlePool(capacity);
    this.#shake = new ScreenShake(this.#rng, { maxAmplitudeLogical: 2, decaySeconds: 0.4 });
    this.#tween = new TweenSequence({
      from: 0,
      steps: [
        { kind: 'to', to: 1, durationSeconds: 0.5 },
        { kind: 'delay', durationSeconds: 0.1 },
        { kind: 'to', to: 0, durationSeconds: 0.5 },
      ],
    });

    for (let i = 0; i < n; i += 1) {
      this.#x[i] = radius + this.#rng.float() * (world - 2 * radius);
      this.#y[i] = radius + this.#rng.float() * (world - 2 * radius);
      this.#vx[i] = this.#rng.float() * 20 - 10;
      this.#vy[i] = this.#rng.float() * 20 - 10;
    }

    // Pre-create every bucket the bounded arena will ever use, so no step allocates.
    const cell = radius * 4;
    this.#hash.prewarm(-cell, -cell, world + cell, world + cell, n);
  }

  get bodyCount(): number {
    return this.#n;
  }

  get stepCount(): number {
    return this.#stepCount;
  }

  get particleCount(): number {
    return this.#particles.activeCount;
  }

  /** Sum of every growable structure's structural allocations. Flat once warm. */
  get structuralAllocations(): number {
    return this.#hash.allocations + this.#ownAllocations;
  }

  /** Advance one fixed step. Allocation-free in steady state. */
  step(fixedDeltaSeconds: number): void {
    const dt = fixedDeltaSeconds;
    const r = this.#radius;

    // Broadphase: rebuild the grid from scratch, reusing every bucket.
    this.#hash.clear();
    for (let i = 0; i < this.#n; i += 1) {
      const x = this.#x[i]!;
      const y = this.#y[i]!;
      this.#hash.insert(i, x - r, y - r, x + r, y + r);
    }

    // Narrow-phase + resolution over candidate pairs.
    this.#hash.forEachPair(this.#handlePair);

    // Integrate and bounce off the world walls.
    const world = this.#world;
    for (let i = 0; i < this.#n; i += 1) {
      let x = this.#x[i]! + this.#vx[i]! * dt;
      let y = this.#y[i]! + this.#vy[i]! * dt;
      if (x < r) {
        x = r;
        this.#vx[i] = -this.#vx[i]!;
      } else if (x > world - r) {
        x = world - r;
        this.#vx[i] = -this.#vx[i]!;
      }
      if (y < r) {
        y = r;
        this.#vy[i] = -this.#vy[i]!;
      } else if (y > world - r) {
        y = world - r;
        this.#vy[i] = -this.#vy[i]!;
      }
      this.#x[i] = x;
      this.#y[i] = y;
    }

    // Presentation systems advance on the same step.
    this.#particles.step(dt);
    this.#shake.step(dt);
    this.#tween.step(dt);
    if (this.#tween.done) this.#tween.reset();

    // A small deterministic emission, so the pool is genuinely exercised.
    if (this.#stepCount % 4 === 0) {
      this.#particles.emit(SPARKS, 8, this.#rng);
    }

    this.#stepCount += 1;
  }

  /** Bound once in the constructor so passing it to forEachPair allocates no closure. */
  readonly #handlePair = (i: number, j: number): void => {
    const r = this.#radius;
    this.#circleA.x = this.#x[i]!;
    this.#circleA.y = this.#y[i]!;
    this.#circleA.radius = r;
    this.#circleB.x = this.#x[j]!;
    this.#circleB.y = this.#y[j]!;
    this.#circleB.radius = r;
    if (!circleCircle(this.#contact, this.#circleA, this.#circleB)) return;

    const a = this.#bodyA;
    const b = this.#bodyB;
    a.x = this.#x[i]!;
    a.y = this.#y[i]!;
    a.vx = this.#vx[i]!;
    a.vy = this.#vy[i]!;
    b.x = this.#x[j]!;
    b.y = this.#y[j]!;
    b.vx = this.#vx[j]!;
    b.vy = this.#vy[j]!;
    resolveContact(a, b, this.#contact);
    this.#x[i] = a.x;
    this.#y[i] = a.y;
    this.#vx[i] = a.vx;
    this.#vy[i] = a.vy;
    this.#x[j] = b.x;
    this.#y[j] = b.y;
    this.#vx[j] = b.vx;
    this.#vy[j] = b.vy;
  };
}

/**
 * Run `loop.step` `steps` times and report the counting shim's growth over the run:
 * the difference in {@link RepresentativeLoop.structuralAllocations} from first step
 * to last. Zero means no structure grew — no per-step allocation the shim can see.
 */
export function measureStructuralGrowth(
  loop: RepresentativeLoop,
  steps: number,
  dt = 1 / 60,
): number {
  const before = loop.structuralAllocations;
  for (let i = 0; i < steps; i += 1) loop.step(dt);
  return loop.structuralAllocations - before;
}

/** The runtime's `gc()` hook, present under Node's `--expose-gc`. */
interface GcGlobal {
  gc?: () => void;
}

/** Whether a heap-delta measurement is possible in this runtime. */
export function heapMeasurementAvailable(): boolean {
  return typeof (globalThis as GcGlobal).gc === 'function';
}

/**
 * RETAINED heap growth per step in bytes, settling the heap with `gc()` on both sides
 * so only memory the step actually *keeps* is counted. Near zero for an allocation-free
 * loop; grows with N for a loop that leaks — an unbounded buffer, a cache that never
 * evicts. Transient churn is collected by the second `gc()` and is intentionally not
 * measured here (see the module note). Returns null when `gc()` is unavailable.
 */
export function measureHeapBytesPerStep(
  loop: RepresentativeLoop,
  steps: number,
  dt = 1 / 60,
): number | null {
  const gc = (globalThis as GcGlobal).gc;
  if (typeof gc !== 'function') return null;
  // Warm up so lazy internals are already resident before we measure.
  for (let i = 0; i < steps; i += 1) loop.step(dt);
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < steps; i += 1) loop.step(dt);
  gc();
  const after = process.memoryUsage().heapUsed;
  return (after - before) / steps;
}
