import { describe, expect, it } from 'vitest';
import { LOW_BATTERY_LEVEL, RenderGate, isLowPower } from './power.js';

describe('isLowPower', () => {
  it('is quiet where nothing can be known, which is every WebKit browser', () => {
    // The safe reading of an unknown battery is a full frame rate.
    expect(isLowPower(null)).toBe(false);
  });

  it('eases off at the platform threshold, off the cable', () => {
    expect(isLowPower({ level: LOW_BATTERY_LEVEL, charging: false })).toBe(true);
    expect(isLowPower({ level: 0.05, charging: false })).toBe(true);
  });

  it('does not ease off a phone that is charging, whatever its level', () => {
    expect(isLowPower({ level: 0.05, charging: true })).toBe(false);
  });

  it('does not ease off a phone above the threshold', () => {
    expect(isLowPower({ level: 0.21, charging: false })).toBe(false);
    expect(isLowPower({ level: 1, charging: false })).toBe(false);
  });

  it('reads a level that is not a number as unknown rather than as empty', () => {
    expect(isLowPower({ level: Number.NaN, charging: false })).toBe(false);
  });
});

describe('RenderGate', () => {
  it('draws every frame by default', () => {
    const gate = new RenderGate();
    const drawn = Array.from({ length: 6 }, () => gate.shouldRender());
    expect(drawn).toEqual([true, true, true, true, true, true]);
  });

  it('draws alternate frames at two, and always the first one after a change', () => {
    const gate = new RenderGate();
    gate.shouldRender();
    gate.setEvery(2);
    const drawn = Array.from({ length: 6 }, () => gate.shouldRender());
    expect(drawn).toEqual([true, false, true, false, true, false]);
  });

  it('halves the frames drawn over a second, which is the number #190 can measure', () => {
    // Sixty animation frames a second, gated at two: thirty draws. The fixed step is not
    // involved and is untouched — this is the render half of the loop only.
    const full = new RenderGate();
    const low = new RenderGate();
    low.setEvery(2);
    let fullDraws = 0;
    let lowDraws = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      if (full.shouldRender()) fullDraws += 1;
      if (low.shouldRender()) lowDraws += 1;
    }
    expect(fullDraws).toBe(60);
    expect(lowDraws).toBe(30);
  });

  it('opens again the moment the divisor drops back to one', () => {
    const gate = new RenderGate();
    gate.setEvery(3);
    gate.shouldRender();
    gate.setEvery(1);
    expect([gate.shouldRender(), gate.shouldRender()]).toEqual([true, true]);
  });

  it('never stalls on a divisor that is not a positive integer', () => {
    // A gate that never opens is a blank canvas with a match behind it (#101).
    const gate = new RenderGate();
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      gate.setEvery(bad);
      expect(gate.every).toBe(1);
      expect(gate.shouldRender()).toBe(true);
    }
  });
});
