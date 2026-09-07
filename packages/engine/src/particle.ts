/**
 * Pooled particle system with a fixed ceiling.
 *
 * Particles are the most common source of per-frame allocation and therefore of
 * GC stutter — a burst spawns hundreds of short-lived objects a second. This pool
 * pays for all of them once, up front: every particle's storage is allocated in
 * the constructor as a set of parallel arrays, and nothing here allocates again.
 * Emitting reuses a dead slot; a slot that runs out of life goes back on the free
 * list. Steady state is genuinely free, which the hot-path benchmark checks.
 *
 * Emitters are data, not code: an {@link EmitterConfig} is a plain object a game
 * (or a manifest) describes, and {@link ParticlePool.emit} reads it. Randomised
 * spread and lifetime are drawn from the seeded {@link Rng}, so two devices given
 * the same seed and the same emit calls produce the identical field of particles.
 *
 * The pool honours the adaptive-quality signal: {@link ParticlePool.setQualityScale}
 * scales how many particles an emit actually spawns, so a struggling device thins
 * the confetti before it drops a frame — and never touches anything the simulation
 * reads, because particles are pure presentation.
 *
 * Everything is in LOGICAL units and advances on the fixed step.
 */

import type { Rng } from './rng.js';

/**
 * A particle emitter described as data. Ranges are inclusive; a min equal to its
 * max is a fixed value. Angles are in radians, measured as usual from +x.
 */
export interface EmitterConfig {
  readonly x: number;
  readonly y: number;
  readonly speedMin: number;
  readonly speedMax: number;
  readonly angleMin: number;
  readonly angleMax: number;
  readonly lifeMin: number;
  readonly lifeMax: number;
  readonly sizeMin: number;
  readonly sizeMax: number;
  /** Constant acceleration applied every step, e.g. gravity. */
  readonly gravityX?: number;
  readonly gravityY?: number;
  /** Velocity damping per second in [0, 1); 0 is frictionless. */
  readonly drag?: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export class ParticlePool {
  readonly #capacity: number;

  readonly #active: Uint8Array;
  readonly #x: Float64Array;
  readonly #y: Float64Array;
  readonly #vx: Float64Array;
  readonly #vy: Float64Array;
  readonly #ax: Float64Array;
  readonly #ay: Float64Array;
  readonly #drag: Float64Array;
  readonly #life: Float64Array;
  readonly #maxLife: Float64Array;
  readonly #size: Float64Array;

  /** Stack of free slot indices; `#freeCount` is how many are available. */
  readonly #free: Int32Array;
  #freeCount: number;
  #activeCount = 0;

  #qualityScale = 1;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`capacity must be a positive integer, received ${String(capacity)}`);
    }
    this.#capacity = capacity;
    this.#active = new Uint8Array(capacity);
    this.#x = new Float64Array(capacity);
    this.#y = new Float64Array(capacity);
    this.#vx = new Float64Array(capacity);
    this.#vy = new Float64Array(capacity);
    this.#ax = new Float64Array(capacity);
    this.#ay = new Float64Array(capacity);
    this.#drag = new Float64Array(capacity);
    this.#life = new Float64Array(capacity);
    this.#maxLife = new Float64Array(capacity);
    this.#size = new Float64Array(capacity);
    this.#free = new Int32Array(capacity);
    // Fill the free stack in reverse so the first emit takes slot 0.
    for (let i = 0; i < capacity; i += 1) {
      this.#free[i] = capacity - 1 - i;
    }
    this.#freeCount = capacity;
  }

  get capacity(): number {
    return this.#capacity;
  }

  /** Live particle count. */
  get activeCount(): number {
    return this.#activeCount;
  }

  /** Emission multiplier in (0, 1], set by adaptive quality. Lower spawns fewer particles. */
  get qualityScale(): number {
    return this.#qualityScale;
  }

  /** Set the adaptive-quality emission multiplier, clamped to (0, 1]. */
  setQualityScale(scale: number): void {
    const s = clamp01(scale);
    this.#qualityScale = s <= 0 ? 0 : s;
  }

  /**
   * Emit up to `count` particles, scaled by the current quality. Spawns fewer if the
   * pool is near its ceiling; the surplus is simply dropped rather than queued.
   * Returns how many were actually spawned. Allocation-free.
   */
  emit(config: EmitterConfig, count: number, rng: Rng): number {
    const requested = Math.floor(count * this.#qualityScale);
    const ax = config.gravityX ?? 0;
    const ay = config.gravityY ?? 0;
    const drag = config.drag ?? 0;
    let spawned = 0;
    for (let n = 0; n < requested; n += 1) {
      if (this.#freeCount === 0) break;
      const i = this.#free[this.#freeCount - 1]!;
      this.#freeCount -= 1;
      // Fixed draw order keeps the sequence deterministic across devices.
      const speed = lerp(config.speedMin, config.speedMax, rng.float());
      const angle = lerp(config.angleMin, config.angleMax, rng.float());
      const life = lerp(config.lifeMin, config.lifeMax, rng.float());
      const size = lerp(config.sizeMin, config.sizeMax, rng.float());
      this.#active[i] = 1;
      this.#x[i] = config.x;
      this.#y[i] = config.y;
      this.#vx[i] = Math.cos(angle) * speed;
      this.#vy[i] = Math.sin(angle) * speed;
      this.#ax[i] = ax;
      this.#ay[i] = ay;
      this.#drag[i] = drag;
      this.#life[i] = life;
      this.#maxLife[i] = life <= 0 ? 1 : life;
      this.#size[i] = size;
      this.#activeCount += 1;
      spawned += 1;
    }
    return spawned;
  }

  /** Advance every live particle by one fixed step, retiring the expired. Allocation-free. */
  step(fixedDeltaSeconds: number): void {
    if (!Number.isFinite(fixedDeltaSeconds) || fixedDeltaSeconds < 0) {
      throw new RangeError(
        `fixedDeltaSeconds must be a non-negative number, received ${String(fixedDeltaSeconds)}`,
      );
    }
    const dt = fixedDeltaSeconds;
    for (let i = 0; i < this.#capacity; i += 1) {
      if (this.#active[i] === 0) continue;
      const life = this.#life[i]! - dt;
      if (life <= 0) {
        this.#active[i] = 0;
        this.#activeCount -= 1;
        this.#free[this.#freeCount] = i;
        this.#freeCount += 1;
        continue;
      }
      this.#life[i] = life;
      let vx = this.#vx[i]! + this.#ax[i]! * dt;
      let vy = this.#vy[i]! + this.#ay[i]! * dt;
      const damp = 1 - this.#drag[i]! * dt;
      const factor = damp < 0 ? 0 : damp;
      vx *= factor;
      vy *= factor;
      this.#vx[i] = vx;
      this.#vy[i] = vy;
      this.#x[i] = this.#x[i]! + vx * dt;
      this.#y[i] = this.#y[i]! + vy * dt;
    }
  }

  /** Retire every particle at once. Allocation-free. */
  reset(): void {
    this.#active.fill(0);
    for (let i = 0; i < this.#capacity; i += 1) {
      this.#free[i] = this.#capacity - 1 - i;
    }
    this.#freeCount = this.#capacity;
    this.#activeCount = 0;
  }

  /** Call `callback` with each live particle's slot index. Allocation-free. */
  forEachActive(callback: (index: number) => void): void {
    for (let i = 0; i < this.#capacity; i += 1) {
      if (this.#active[i] === 1) callback(i);
    }
  }

  isActive(i: number): boolean {
    return this.#active[i] === 1;
  }
  getX(i: number): number {
    return this.#x[i]!;
  }
  getY(i: number): number {
    return this.#y[i]!;
  }
  getSize(i: number): number {
    return this.#size[i]!;
  }
  /** Remaining life as a fraction in [0, 1] of the particle's max, for fading. */
  getLifeFraction(i: number): number {
    return this.#life[i]! / this.#maxLife[i]!;
  }
}
