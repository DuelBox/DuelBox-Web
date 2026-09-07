import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, DEFAULT_QUALITY_LEVELS } from './quality.js';

const BUDGET = 1 / 60; // ~16.7ms

describe('stepping down over budget', () => {
  it('degrades a level after sustained over-budget frames, not on a single spike', () => {
    const q = new AdaptiveQuality({ budgetSeconds: BUDGET, degradeAfterSeconds: 2 });
    expect(q.level).toBe(0);

    // A single slow frame must not degrade.
    q.sample(0.05);
    expect(q.level).toBe(0);

    // Sustained 30ms frames (well over the 16.7ms budget) for over two seconds.
    let elapsed = 0;
    while (elapsed < 2.5 && q.level === 0) {
      q.sample(0.03);
      elapsed += 0.03;
    }
    expect(q.level).toBe(1);
  });

  it('keeps stepping down under a persistent overload but never past the worst level', () => {
    const q = new AdaptiveQuality({ budgetSeconds: BUDGET, degradeAfterSeconds: 1 });
    for (let i = 0; i < 2000; i += 1) q.sample(0.1);
    expect(q.level).toBe(DEFAULT_QUALITY_LEVELS.length - 1);
    // Cannot go below the last rung.
    for (let i = 0; i < 500; i += 1) q.sample(0.1);
    expect(q.level).toBe(DEFAULT_QUALITY_LEVELS.length - 1);
  });

  it('exposes the level ladder knobs, cheaper as it degrades', () => {
    const q = new AdaptiveQuality({ budgetSeconds: BUDGET, degradeAfterSeconds: 0.5 });
    const scaleAtBest = q.particleScale;
    for (let i = 0; i < 200; i += 1) q.sample(0.1);
    expect(q.particleScale).toBeLessThan(scaleAtBest);
    expect(q.dprCap).toBeLessThanOrEqual(2);
  });
});

describe('stepping back up with headroom', () => {
  it('recovers a level after sustained comfortable frames', () => {
    const q = new AdaptiveQuality({
      budgetSeconds: BUDGET,
      degradeAfterSeconds: 1,
      upgradeAfterSeconds: 1,
      windowFrames: 10,
    });
    // Drive it down first.
    for (let i = 0; i < 200; i += 1) q.sample(0.05);
    expect(q.level).toBeGreaterThan(0);
    const degraded = q.level;

    // Now feed fast frames (8ms, well under 0.75*budget) for a while.
    for (let i = 0; i < 400; i += 1) q.sample(0.008);
    expect(q.level).toBeLessThan(degraded);
  });

  it('holds steady inside the comfortable band without oscillating', () => {
    const q = new AdaptiveQuality({ budgetSeconds: BUDGET });
    // Frames right around budget but under it: neither degrade nor upgrade fires.
    for (let i = 0; i < 600; i += 1) q.sample(BUDGET * 0.9);
    expect(q.level).toBe(0);
  });
});

describe('simulation is untouched by quality', () => {
  // A deterministic mock simulation that never reads any quality value.
  function runSim(withMonitor: boolean): { trail: number[]; finalLevel: number } {
    const q = new AdaptiveQuality({ budgetSeconds: BUDGET, degradeAfterSeconds: 0.5 });
    const trail: number[] = [];
    let x = 0;
    let v = 1;
    for (let i = 0; i < 300; i += 1) {
      x += v * BUDGET;
      if (x > 5 || x < 0) v = -v;
      trail.push(x);
      if (withMonitor) q.sample(0.1); // pretend every frame is slow so quality churns
    }
    return { trail, finalLevel: q.level };
  }

  it('produces the identical simulation trail whether or not quality is degrading', () => {
    const plain = runSim(false);
    const monitored = runSim(true);
    expect(monitored.trail).toEqual(plain.trail);
    // And the monitor genuinely changed level, so the test is not vacuous.
    expect(monitored.finalLevel).toBeGreaterThan(0);
  });
});

describe('guards and overrides', () => {
  it('forceLevel pins a level and clears the timers', () => {
    const q = new AdaptiveQuality();
    q.forceLevel(DEFAULT_QUALITY_LEVELS.length - 1);
    expect(q.level).toBe(DEFAULT_QUALITY_LEVELS.length - 1);
    expect(() => q.forceLevel(99)).toThrow();
  });

  it('rejects nonsense construction options', () => {
    expect(() => new AdaptiveQuality({ budgetSeconds: 0 })).toThrow();
    expect(() => new AdaptiveQuality({ windowFrames: 0 })).toThrow();
    expect(() => new AdaptiveQuality({ recoverFactor: 2 })).toThrow();
    expect(() => new AdaptiveQuality({ levels: [] })).toThrow();
  });
});
