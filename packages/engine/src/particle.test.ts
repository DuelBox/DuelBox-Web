import { describe, expect, it } from 'vitest';
import { ParticlePool } from './particle.js';
import type { EmitterConfig } from './particle.js';
import { Rng } from './rng.js';

const STEP = 1 / 60;

const BURST: EmitterConfig = {
  x: 0,
  y: 0,
  speedMin: 1,
  speedMax: 3,
  angleMin: 0,
  angleMax: Math.PI * 2,
  lifeMin: 0.5,
  lifeMax: 1,
  sizeMin: 0.1,
  sizeMax: 0.3,
};

describe('pooling and the ceiling', () => {
  it('never spawns beyond its fixed capacity', () => {
    const pool = new ParticlePool(50);
    const spawned = pool.emit(BURST, 200, new Rng(1));
    expect(spawned).toBe(50);
    expect(pool.activeCount).toBe(50);
    // A second burst has no room.
    expect(pool.emit(BURST, 200, new Rng(2))).toBe(0);
    expect(pool.activeCount).toBe(50);
  });

  it('reuses slots after particles expire', () => {
    const pool = new ParticlePool(10);
    pool.emit({ ...BURST, lifeMin: 0.1, lifeMax: 0.1 }, 10, new Rng(1));
    expect(pool.activeCount).toBe(10);
    // Step past their lifetime.
    for (let i = 0; i < 10; i += 1) pool.step(STEP);
    expect(pool.activeCount).toBe(0);
    // The freed slots are available again.
    expect(pool.emit(BURST, 10, new Rng(2))).toBe(10);
    expect(pool.activeCount).toBe(10);
  });

  it('capacity never changes as particles churn', () => {
    const pool = new ParticlePool(64);
    for (let frame = 0; frame < 200; frame += 1) {
      pool.emit({ ...BURST, lifeMin: 0.05, lifeMax: 0.2 }, 8, new Rng(frame));
      pool.step(STEP);
      expect(pool.capacity).toBe(64);
    }
  });
});

describe('integration', () => {
  it('moves particles under their velocity and gravity', () => {
    const pool = new ParticlePool(1);
    pool.emit(
      {
        x: 0,
        y: 0,
        speedMin: 10,
        speedMax: 10,
        angleMin: 0,
        angleMax: 0, // straight along +x
        lifeMin: 10,
        lifeMax: 10,
        sizeMin: 1,
        sizeMax: 1,
        gravityY: 20,
      },
      1,
      new Rng(1),
    );
    const startX = pool.getX(0);
    for (let i = 0; i < 10; i += 1) pool.step(STEP);
    expect(pool.getX(0)).toBeGreaterThan(startX); // carried along +x
    expect(pool.getY(0)).toBeGreaterThan(0); // pulled down by gravity
  });

  it('reports remaining life as a fraction that falls from 1 toward 0', () => {
    const pool = new ParticlePool(1);
    pool.emit({ ...BURST, lifeMin: 1, lifeMax: 1 }, 1, new Rng(1));
    const first = pool.getLifeFraction(0);
    expect(first).toBeLessThanOrEqual(1);
    for (let i = 0; i < 30; i += 1) pool.step(STEP);
    expect(pool.getLifeFraction(0)).toBeLessThan(first);
  });
});

describe('determinism', () => {
  it('two pools with the same seed and emits agree particle for particle', () => {
    const a = new ParticlePool(100);
    const b = new ParticlePool(100);
    const ra = new Rng(7);
    const rb = new Rng(7);
    a.emit(BURST, 40, ra);
    b.emit(BURST, 40, rb);
    for (let step = 0; step < 20; step += 1) {
      a.step(STEP);
      b.step(STEP);
    }
    a.forEachActive((i) => {
      expect(a.getX(i)).toBe(b.getX(i));
      expect(a.getY(i)).toBe(b.getY(i));
    });
    expect(a.activeCount).toBe(b.activeCount);
  });
});

describe('adaptive quality', () => {
  it('spawns proportionally fewer particles as quality falls', () => {
    const full = new ParticlePool(200);
    const half = new ParticlePool(200);
    half.setQualityScale(0.5);
    const spawnedFull = full.emit(BURST, 100, new Rng(1));
    const spawnedHalf = half.emit(BURST, 100, new Rng(1));
    expect(spawnedFull).toBe(100);
    expect(spawnedHalf).toBe(50);
  });

  it('spawns nothing at zero quality', () => {
    const pool = new ParticlePool(50);
    pool.setQualityScale(0);
    expect(pool.emit(BURST, 100, new Rng(1))).toBe(0);
  });

  it('clamps quality above 1 back to 1', () => {
    const pool = new ParticlePool(200);
    pool.setQualityScale(5);
    expect(pool.qualityScale).toBe(1);
    expect(pool.emit(BURST, 100, new Rng(1))).toBe(100);
  });
});
