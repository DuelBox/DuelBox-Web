import { describe, expect, it } from 'vitest';
import {
  RepresentativeLoop,
  heapMeasurementAvailable,
  measureHeapBytesPerStep,
  measureStructuralGrowth,
} from './hot-path.js';

const STEP = 1 / 60;

describe('representative loop is a genuine simulation', () => {
  it('steps a field of bodies and exercises the particle pool', () => {
    const loop = new RepresentativeLoop({ bodyCount: 120, particleCapacity: 256, seed: 3 });
    for (let i = 0; i < 60; i += 1) loop.step(STEP);
    expect(loop.stepCount).toBe(60);
    // The emission actually ran, so the pool is not sitting idle.
    expect(loop.particleCount).toBeGreaterThan(0);
  });

  it('is deterministic: two loops with the same seed agree on particle count', () => {
    const a = new RepresentativeLoop({ seed: 9 });
    const b = new RepresentativeLoop({ seed: 9 });
    for (let i = 0; i < 100; i += 1) {
      a.step(STEP);
      b.step(STEP);
    }
    expect(a.particleCount).toBe(b.particleCount);
  });
});

describe('zero per-step allocation (counting shim)', () => {
  it('grows no structure across many steps once warm', () => {
    const loop = new RepresentativeLoop({ bodyCount: 150, seed: 5 });
    // Warm up: the spatial hash sizes its bucket slots to peak occupancy over these frames.
    measureStructuralGrowth(loop, 600);
    // Steady state: not one structural allocation across a long run.
    const growth = measureStructuralGrowth(loop, 3000);
    expect(growth).toBe(0);
  });

  it('has a live, non-zero allocation counter, so the shim is not vacuous', () => {
    // Construction prewarms the grid, which is where all the allocation is paid; the
    // counter is demonstrably real and moving, not stuck at zero.
    const loop = new RepresentativeLoop({ bodyCount: 150, seed: 5 });
    expect(loop.structuralAllocations).toBeGreaterThan(0);
  });
});

describe('no retained per-step growth (heap delta, when gc is exposed)', () => {
  it.skipIf(!heapMeasurementAvailable())('retains a negligible number of bytes per step', () => {
    const loop = new RepresentativeLoop({ bodyCount: 150, seed: 5 });
    const bytesPerStep = measureHeapBytesPerStep(loop, 3000);
    expect(bytesPerStep).not.toBeNull();
    // An allocation-free step keeps essentially nothing; allow slack for runtime noise.
    expect(bytesPerStep!).toBeLessThan(200);
  });

  it('reports availability honestly', () => {
    // Documents the environment; the heap test above is gated on the same flag.
    expect(typeof heapMeasurementAvailable()).toBe('boolean');
  });
});
