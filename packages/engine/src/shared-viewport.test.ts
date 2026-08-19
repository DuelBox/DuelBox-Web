import { describe, expect, it } from 'vitest';
import {
  NO_INSETS,
  fitViewport,
  isInsideLogical,
  negotiateSharedLogical,
  viewportToLogical,
} from './viewport.js';
import { vec2 } from './vec2.js';

/**
 * Neither player may ever see more of the play area than the other.
 *
 * This is the fairness problem nobody sees coming. A laptop player whose wider screen
 * reveals more of the arena than the phone player's has a real competitive advantage, and
 * an invisible one — the loser cannot tell why they lost, which is worse than losing.
 *
 * `negotiateSharedLogical` is unit-tested as a function elsewhere. What these assert is
 * the property the whole mechanism exists for, end to end: take two genuinely different
 * devices, negotiate, letterbox each to the result, and require that the set of world
 * points each can see is *identical* — not similar, not close.
 */

/** Devices that differ in every way that matters: aspect, size and pixel density. */
const DEVICES = [
  { label: 'small phone portrait', width: 320, height: 568 },
  { label: 'tall phone portrait', width: 393, height: 852 },
  { label: 'phone landscape', width: 852, height: 393 },
  { label: 'tablet portrait', width: 768, height: 1024 },
  { label: 'laptop', width: 1440, height: 900 },
  { label: 'ultrawide', width: 3440, height: 1440 },
  { label: 'square', width: 800, height: 800 },
];

/**
 * The corners of the world each device can actually see, in logical units.
 *
 * Derived by mapping the device's own screen corners back into logical space, which is
 * the same path a tap takes — so if this says a point is visible, a finger can reach it.
 */
function visibleBounds(
  logical: { width: number; height: number },
  screenW: number,
  screenH: number,
) {
  const view = fitViewport(logical, screenW, screenH, NO_INSETS);
  const topLeft = viewportToLogical(vec2(), 0, 0, view);
  const bottomRight = viewportToLogical(vec2(), screenW, screenH, view);
  return {
    minX: topLeft.x,
    minY: topLeft.y,
    maxX: bottomRight.x,
    maxY: bottomRight.y,
  };
}

/** Clamped to the play area: bars beyond the world edge are not "seeing more world". */
function visibleWorld(
  logical: { width: number; height: number },
  screenW: number,
  screenH: number,
) {
  const bounds = visibleBounds(logical, screenW, screenH);
  return {
    minX: Math.max(0, bounds.minX),
    minY: Math.max(0, bounds.minY),
    maxX: Math.min(logical.width, bounds.maxX),
    maxY: Math.min(logical.height, bounds.maxY),
  };
}

describe('two devices, one play area', () => {
  it('shows the identical world to every pair of devices, once negotiated', () => {
    // Every pair, not a chosen few: the property must not depend on which two.
    for (const a of DEVICES) {
      for (const b of DEVICES) {
        const shared = negotiateSharedLogical(
          { width: a.width, height: a.height },
          { width: b.width, height: b.height },
        );
        const seenByA = visibleWorld(shared, a.width, a.height);
        const seenByB = visibleWorld(shared, b.width, b.height);

        const where = `${a.label} vs ${b.label}`;
        expect(seenByA.minX, where).toBeCloseTo(seenByB.minX, 6);
        expect(seenByA.minY, where).toBeCloseTo(seenByB.minY, 6);
        expect(seenByA.maxX, where).toBeCloseTo(seenByB.maxX, 6);
        expect(seenByA.maxY, where).toBeCloseTo(seenByB.maxY, 6);
      }
    }
  });

  it('gives each device the whole negotiated area and no more', () => {
    for (const device of DEVICES) {
      const shared = negotiateSharedLogical(
        { width: device.width, height: device.height },
        { width: 600, height: 1000 },
      );
      const seen = visibleWorld(shared, device.width, device.height);
      // The whole play area is reachable...
      expect(seen.minX, device.label).toBeCloseTo(0, 6);
      expect(seen.minY, device.label).toBeCloseTo(0, 6);
      expect(seen.maxX, device.label).toBeCloseTo(shared.width, 6);
      expect(seen.maxY, device.label).toBeCloseTo(shared.height, 6);
    }
  });

  it('never lets a bigger screen reveal a point a smaller one cannot', () => {
    // The rule stated as it is felt: pick any object anywhere in the world and both
    // players can see it, or neither can.
    const phone = { width: 320, height: 568 };
    const ultrawide = { width: 3440, height: 1440 };
    const shared = negotiateSharedLogical(phone, ultrawide);

    const onPhone = visibleWorld(shared, phone.width, phone.height);
    const onUltrawide = visibleWorld(shared, ultrawide.width, ultrawide.height);

    for (let x = 0; x <= shared.width; x += shared.width / 20) {
      for (let y = 0; y <= shared.height; y += shared.height / 20) {
        const seenOnPhone =
          x >= onPhone.minX && x <= onPhone.maxX && y >= onPhone.minY && y <= onPhone.maxY;
        const seenOnUltrawide =
          x >= onUltrawide.minX &&
          x <= onUltrawide.maxX &&
          y >= onUltrawide.minY &&
          y <= onUltrawide.maxY;
        expect(seenOnPhone, `world point ${String(x)},${String(y)}`).toBe(seenOnUltrawide);
      }
    }
  });

  it('puts the surplus into bars rather than into field of view', () => {
    // An ultrawide screen showing a portrait play area has a great deal of surplus. It
    // must all become letterbox, which is what leaves room for chrome.
    const shared = { width: 600, height: 1000 };
    const view = fitViewport(shared, 3440, 1440, NO_INSETS);
    const bounds = visibleBounds(shared, 3440, 1440);

    // Sees beyond the world horizontally — those are the bars.
    expect(bounds.minX).toBeLessThan(0);
    expect(bounds.maxX).toBeGreaterThan(shared.width);
    // But not one unit more of the world than exists.
    expect(view.scale * shared.height).toBeLessThanOrEqual(1440 + 1e-9);
  });

  it('agrees with isInsideLogical about what is in play', () => {
    const shared = negotiateSharedLogical(
      { width: 900, height: 900 },
      { width: 600, height: 1000 },
    );
    // A point in the bars is outside the play area, whichever device is looking.
    expect(isInsideLogical(-1, 10, shared)).toBe(false);
    expect(isInsideLogical(10, 10, shared)).toBe(true);
    expect(isInsideLogical(shared.width + 1, 10, shared)).toBe(false);
  });
});

describe('the negotiation itself', () => {
  it('is symmetric in what it grants, whichever device asks first', () => {
    // A negotiation whose result depended on argument order would hand an advantage to
    // whoever happened to initiate the match.
    for (const a of DEVICES) {
      for (const b of DEVICES) {
        const ab = negotiateSharedLogical(a, b);
        const ba = negotiateSharedLogical(b, a);
        // The boxes differ in shape — each is expressed in its own reference — but the
        // *area of world* both can see must be the same either way.
        const seenA = visibleWorld(ab, a.width, a.height);
        const seenB = visibleWorld(ba, b.width, b.height);
        const aspectAB = (seenA.maxX - seenA.minX) / (seenA.maxY - seenA.minY);
        const aspectBA = (seenB.maxX - seenB.minX) / (seenB.maxY - seenB.minY);
        expect(aspectAB, `${a.label} vs ${b.label}`).toBeCloseTo(ab.width / ab.height, 6);
        expect(aspectBA).toBeCloseTo(ba.width / ba.height, 6);
      }
    }
  });

  it('never grows the box past what EITHER device can show', () => {
    // Both, not just the first. Checking only `a` is why an earlier version of this test
    // passed with the negotiation deliberately inverted: the failure mode is a box that
    // fits the device that asked and overflows the one that answered.
    for (const a of DEVICES) {
      for (const b of DEVICES) {
        const shared = negotiateSharedLogical(a, b);
        const where = `${a.label} vs ${b.label}`;
        expect(shared.width, where).toBeLessThanOrEqual(a.width + 1e-9);
        expect(shared.height, where).toBeLessThanOrEqual(a.height + 1e-9);
        expect(shared.width, where).toBeLessThanOrEqual(b.width + 1e-9);
        expect(shared.height, where).toBeLessThanOrEqual(b.height + 1e-9);
      }
    }
  });

  it('picks the largest box that fits, rather than an arbitrarily small one', () => {
    // The other half of correctness: a negotiation that always returned 1x1 would
    // satisfy every fairness assertion above and make the game unplayable. The shared
    // box must touch at least one device's limit on at least one axis.
    for (const a of DEVICES) {
      for (const b of DEVICES) {
        const shared = negotiateSharedLogical(a, b);
        const touches =
          Math.abs(shared.width - Math.min(a.width, b.width)) < 1e-6 ||
          Math.abs(shared.height - Math.min(a.height, b.height)) < 1e-6;
        expect(
          touches,
          `${a.label} vs ${b.label}: ${String(shared.width)}x${String(shared.height)}`,
        ).toBe(true);
      }
    }
  });
});
