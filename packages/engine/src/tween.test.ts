import { describe, expect, it } from 'vitest';
import {
  EASINGS,
  Tween,
  TweenSequence,
  cubicInOut,
  linear,
  quadIn,
  quadOut,
  smootherstep,
} from './tween.js';
import type { EasingName } from './tween.js';

const STEP = 1 / 60;

describe('easing functions', () => {
  const names = Object.keys(EASINGS) as EasingName[];

  it('pins both endpoints for every easing', () => {
    for (const name of names) {
      const ease = EASINGS[name];
      expect(ease(0), `${name}(0)`).toBeCloseTo(0, 12);
      expect(ease(1), `${name}(1)`).toBeCloseTo(1, 12);
    }
  });

  it('is monotonically non-decreasing across the unit interval for every easing', () => {
    for (const name of names) {
      const ease = EASINGS[name];
      let previous = ease(0);
      for (let i = 1; i <= 100; i += 1) {
        const y = ease(i / 100);
        expect(y, `${name} decreased at t=${i / 100}`).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = y;
      }
    }
  });

  it('separates ease-in from ease-out by curvature at the midpoint', () => {
    // An accelerating curve sits below the diagonal at t=0.5; a decelerating one above.
    expect(quadIn(0.5)).toBeLessThan(0.5);
    expect(quadOut(0.5)).toBeGreaterThan(0.5);
    expect(linear(0.5)).toBeCloseTo(0.5, 12);
  });

  it('keeps the in-out curves symmetric about the centre', () => {
    for (const ease of [cubicInOut, smootherstep]) {
      for (let i = 0; i <= 50; i += 1) {
        const t = i / 100;
        expect(ease(t) + ease(1 - t)).toBeCloseTo(1, 9);
      }
    }
  });
});

describe('Tween', () => {
  it('starts at from and finishes exactly at to', () => {
    const tw = new Tween({ from: 10, to: 30, durationSeconds: 0.5, easing: linear });
    expect(tw.value).toBe(10);
    expect(tw.done).toBe(false);
    for (let i = 0; i < 60; i += 1) tw.step(STEP);
    expect(tw.done).toBe(true);
    expect(tw.value).toBe(30);
  });

  it('interpolates linearly at the halfway point', () => {
    const tw = new Tween({ from: 0, to: 100, durationSeconds: 1, easing: linear });
    for (let i = 0; i < 30; i += 1) tw.step(STEP);
    expect(tw.value).toBeCloseTo(50, 5);
  });

  it('a reduced-motion tween is born settled at the end value', () => {
    const tw = new Tween({ from: 0, to: 100, durationSeconds: 1, reducedMotion: true });
    expect(tw.done).toBe(true);
    expect(tw.value).toBe(100);
    tw.step(STEP);
    expect(tw.value).toBe(100);
  });

  it('settle() jumps to the end value mid-flight', () => {
    const tw = new Tween({ from: 0, to: 100, durationSeconds: 1 });
    tw.step(STEP);
    expect(tw.value).toBeLessThan(100);
    tw.settle();
    expect(tw.done).toBe(true);
    expect(tw.value).toBe(100);
  });

  it('cancelling mid-flight freezes the value and stops advancing', () => {
    const tw = new Tween({ from: 0, to: 100, durationSeconds: 1, easing: linear });
    for (let i = 0; i < 15; i += 1) tw.step(STEP);
    const frozen = tw.value;
    expect(frozen).toBeGreaterThan(0);
    expect(frozen).toBeLessThan(100);
    tw.cancel();
    expect(tw.cancelled).toBe(true);
    expect(tw.done).toBe(true);
    for (let i = 0; i < 60; i += 1) tw.step(STEP);
    expect(tw.value).toBe(frozen);
  });

  it('reset returns a finished tween to the start', () => {
    const tw = new Tween({ from: 5, to: 9, durationSeconds: 0.2 });
    for (let i = 0; i < 60; i += 1) tw.step(STEP);
    expect(tw.value).toBe(9);
    tw.reset();
    expect(tw.value).toBe(5);
    expect(tw.done).toBe(false);
  });

  it('is deterministic: two tweens fed the same steps agree at every step', () => {
    const a = new Tween({ from: 0, to: 1, durationSeconds: 0.5, easing: quadIn });
    const b = new Tween({ from: 0, to: 1, durationSeconds: 0.5, easing: quadIn });
    for (let i = 0; i < 40; i += 1) {
      a.step(STEP);
      b.step(STEP);
      expect(a.value).toBe(b.value);
    }
  });
});

describe('TweenSequence', () => {
  it('runs segments in order with the right total timing', () => {
    const seq = new TweenSequence({
      from: 0,
      steps: [
        { kind: 'to', to: 10, durationSeconds: 0.5, easing: linear },
        { kind: 'delay', durationSeconds: 0.25 },
        { kind: 'to', to: 30, durationSeconds: 0.5, easing: linear },
      ],
    });
    expect(seq.durationSeconds).toBeCloseTo(1.25, 9);
    expect(seq.value).toBe(0);

    // Halfway through the first segment.
    for (let i = 0; i < 15; i += 1) seq.step(STEP);
    expect(seq.value).toBeCloseTo(5, 1);

    // Land on the delay: value holds at the first target.
    for (let i = 0; i < 15; i += 1) seq.step(STEP);
    expect(seq.value).toBeCloseTo(10, 5);
    for (let i = 0; i < 10; i += 1) seq.step(STEP);
    expect(seq.value).toBeCloseTo(10, 5);
    expect(seq.done).toBe(false);

    // Run to the end.
    for (let i = 0; i < 40; i += 1) seq.step(STEP);
    expect(seq.done).toBe(true);
    expect(seq.value).toBe(30);
  });

  it('holds the start value during a leading delay', () => {
    const seq = new TweenSequence({
      from: 7,
      steps: [
        { kind: 'delay', durationSeconds: 0.5 },
        { kind: 'to', to: 12, durationSeconds: 0.5, easing: linear },
      ],
    });
    for (let i = 0; i < 20; i += 1) seq.step(STEP);
    expect(seq.value).toBe(7);
  });

  it('reduced motion resolves the whole chain to the final value at once', () => {
    const seq = new TweenSequence({
      from: 0,
      reducedMotion: true,
      steps: [
        { kind: 'to', to: 10, durationSeconds: 0.5 },
        { kind: 'to', to: 40, durationSeconds: 0.5 },
      ],
    });
    expect(seq.done).toBe(true);
    expect(seq.value).toBe(40);
  });

  it('drains a step that spans several short segments in one frame', () => {
    const seq = new TweenSequence({
      from: 0,
      steps: [
        { kind: 'to', to: 1, durationSeconds: 0.001 },
        { kind: 'to', to: 2, durationSeconds: 0.001 },
        { kind: 'to', to: 3, durationSeconds: 0.001 },
      ],
    });
    seq.step(STEP); // one 16ms frame swallows all three sub-1ms segments
    expect(seq.done).toBe(true);
    expect(seq.value).toBe(3);
  });

  it('cancelling a sequence mid-flight freezes the value', () => {
    const seq = new TweenSequence({
      from: 0,
      steps: [{ kind: 'to', to: 100, durationSeconds: 1, easing: linear }],
    });
    for (let i = 0; i < 15; i += 1) seq.step(STEP);
    const frozen = seq.value;
    seq.cancel();
    for (let i = 0; i < 120; i += 1) seq.step(STEP);
    expect(seq.value).toBe(frozen);
    expect(seq.cancelled).toBe(true);
  });
});
