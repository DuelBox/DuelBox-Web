import { describe, expect, it } from 'vitest';
import { Flash, HitStop, ScreenShake } from './juice.js';
import { Rng } from './rng.js';

const STEP = 1 / 60;

describe('ScreenShake', () => {
  it('produces an offset within the amplitude bound while shaking, then settles', () => {
    const shake = new ScreenShake(new Rng(1), { maxAmplitudeLogical: 2, decaySeconds: 0.3 });
    shake.add(1);
    let sawMotion = false;
    for (let i = 0; i < 30; i += 1) {
      shake.step(STEP);
      const mag = Math.hypot(shake.offsetX, shake.offsetY);
      // Bounded by amplitude * sqrt(2) even at the corner; never further.
      expect(mag).toBeLessThanOrEqual(2 * Math.SQRT2 + 1e-9);
      if (mag > 0) sawMotion = true;
    }
    expect(sawMotion).toBe(true);
    // Fully decayed within the decay window.
    for (let i = 0; i < 30; i += 1) shake.step(STEP);
    expect(shake.trauma).toBe(0);
    expect(shake.offsetX).toBe(0);
    expect(shake.offsetY).toBe(0);
  });

  it('composes simultaneous hits by saturating, never past full trauma', () => {
    const shake = new ScreenShake(new Rng(1), { maxAmplitudeLogical: 5, decaySeconds: 0.5 });
    shake.add(0.8);
    shake.add(0.8);
    shake.add(0.8);
    expect(shake.trauma).toBe(1);
    shake.step(STEP);
    // Amplitude is bounded by max even with three overlapping hits.
    expect(Math.abs(shake.offsetX)).toBeLessThanOrEqual(5 + 1e-9);
    expect(Math.abs(shake.offsetY)).toBeLessThanOrEqual(5 + 1e-9);
  });

  it('is deterministic under the same seed and triggers', () => {
    const make = (): ScreenShake =>
      new ScreenShake(new Rng(42), { maxAmplitudeLogical: 3, decaySeconds: 0.4 });
    const a = make();
    const b = make();
    a.add(1);
    b.add(1);
    for (let i = 0; i < 24; i += 1) {
      a.step(STEP);
      b.step(STEP);
      expect(a.offsetX).toBe(b.offsetX);
      expect(a.offsetY).toBe(b.offsetY);
    }
  });

  it('under reduced motion stops moving but still reports a non-motion cue', () => {
    const shake = new ScreenShake(new Rng(7), { maxAmplitudeLogical: 4, decaySeconds: 0.5 });
    shake.add(1);
    shake.setReducedMotion(true);
    shake.step(STEP);
    expect(shake.offsetX).toBe(0);
    expect(shake.offsetY).toBe(0);
    expect(shake.cue).toBeGreaterThan(0);
  });
});

describe('HitStop', () => {
  it('holds presentation time then releases it', () => {
    const stop = new HitStop({ maxHoldSeconds: 0.1 });
    expect(stop.frozen).toBe(false);
    expect(stop.timeScale).toBe(1);
    stop.add(1);
    expect(stop.frozen).toBe(true);
    expect(stop.timeScale).toBe(0);
    for (let i = 0; i < 5; i += 1) stop.step(STEP);
    expect(stop.frozen).toBe(true);
    for (let i = 0; i < 5; i += 1) stop.step(STEP);
    expect(stop.frozen).toBe(false);
    expect(stop.timeScale).toBe(1);
  });

  it('takes the longer hold when hits overlap rather than summing', () => {
    const stop = new HitStop({ maxHoldSeconds: 0.2 });
    stop.add(1); // 0.2s
    stop.add(0.25); // 0.05s, shorter — ignored
    expect(stop.remainingSeconds).toBeCloseTo(0.2, 9);
  });
});

describe('Flash', () => {
  it('spikes to the intensity and fades to nothing', () => {
    const flash = new Flash({ fadeSeconds: 0.2 });
    flash.add(0.7);
    expect(flash.alpha).toBeCloseTo(0.7, 9);
    for (let i = 0; i < 20; i += 1) flash.step(STEP);
    expect(flash.alpha).toBe(0);
  });

  it('takes the brighter of overlapping flashes rather than summing past full', () => {
    const flash = new Flash({ fadeSeconds: 1 });
    flash.add(0.5);
    flash.add(0.9);
    flash.add(0.3);
    expect(flash.alpha).toBeCloseTo(0.9, 9);
  });
});

describe('juice never alters simulation', () => {
  // A tiny deterministic "simulation": a body integrated on the fixed step.
  function simulate(withJuice: boolean): number[] {
    const trail: number[] = [];
    let x = 0;
    let vx = 3;
    const shake = new ScreenShake(new Rng(9), { maxAmplitudeLogical: 100, decaySeconds: 0.5 });
    const flash = new Flash({ fadeSeconds: 0.3 });
    const stop = new HitStop({ maxHoldSeconds: 0.2 });
    for (let i = 0; i < 120; i += 1) {
      // Simulation step: pure, never reads any juice value.
      x += vx * STEP;
      if (x > 10 || x < 0) vx = -vx;
      trail.push(x);
      if (withJuice) {
        if (i % 20 === 0) {
          shake.add(1);
          flash.add(1);
          stop.add(1);
        }
        shake.step(STEP);
        flash.step(STEP);
        stop.step(STEP);
      }
    }
    return trail;
  }

  it('produces the identical simulation trail with juice running and with it off', () => {
    const plain = simulate(false);
    const juiced = simulate(true);
    expect(juiced).toEqual(plain);
  });

  it('and the juice really was active (the effect is non-vacuous)', () => {
    // Guards the test above from passing merely because juice did nothing.
    const shake = new ScreenShake(new Rng(9), { maxAmplitudeLogical: 100, decaySeconds: 0.5 });
    shake.add(1);
    let moved = false;
    for (let i = 0; i < 10; i += 1) {
      shake.step(STEP);
      if (shake.offsetX !== 0) moved = true;
    }
    expect(moved).toBe(true);
  });
});
