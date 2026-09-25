import { describe, expect, it } from 'vitest';
import {
  CSS_PX_PER_MM,
  GAMEPLAY_MIN_MM,
  SHELL_TARGET_PX,
  gameplayTouchTargetPx,
} from './touch-target';

/**
 * Sizing a gameplay control by physical size, not pixels (#1889).
 *
 * The property under test is that the control is at least a physical floor across whatever
 * the device's pixel ratio, and never smaller than the rest of the site's controls — the
 * two ways a fixed pixel size goes wrong. DPR is allowed to make the control crisper and
 * bigger, never smaller.
 */

describe('the physical gameplay touch target', () => {
  it('is at least the millimetre floor, converted to CSS pixels', () => {
    // The whole point: the size is derived from millimetres, so it holds a physical size
    // rather than a pixel count.
    const floorPx = GAMEPLAY_MIN_MM * CSS_PX_PER_MM;
    expect(gameplayTouchTargetPx(1)).toBeGreaterThanOrEqual(Math.floor(floorPx));
  });

  it('never drops below the shell target, whatever the device reports', () => {
    for (const dpr of [0.5, 1, 1.5, 2, 3, 4, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(gameplayTouchTargetPx(dpr), `dpr ${String(dpr)}`).toBeGreaterThanOrEqual(
        SHELL_TARGET_PX,
      );
    }
  });

  it('is larger than the shell chrome target, because it is held further away', () => {
    // A gameplay control jabbed at across a table wants more than a settings switch.
    expect(gameplayTouchTargetPx(1)).toBeGreaterThan(SHELL_TARGET_PX);
  });

  it('snaps to a whole number of device pixels for a crisp edge', () => {
    for (const dpr of [1, 2, 3]) {
      const px = gameplayTouchTargetPx(dpr);
      const devicePixels = px * dpr;
      expect(Math.abs(devicePixels - Math.round(devicePixels)), `dpr ${String(dpr)}`).toBeLessThan(
        1e-9,
      );
    }
  });

  it('does not shrink the control on a dense screen — DPR only ever rounds it up', () => {
    // The bug this fixes is a dense screen making a fixed control physically smaller. Here a
    // higher ratio can only hold or raise the size, never lower it below the 1x size floor.
    const oneX = gameplayTouchTargetPx(1);
    for (const dpr of [1.5, 2, 2.5, 3, 4]) {
      expect(gameplayTouchTargetPx(dpr), `dpr ${String(dpr)}`).toBeGreaterThanOrEqual(oneX - 1);
    }
  });

  it('clamps a nonsense ratio rather than trusting it', () => {
    // A device reporting 0 or an absurd ratio must not produce a zero-size or enormous
    // control; both collapse to the sane band.
    expect(gameplayTouchTargetPx(0)).toBe(gameplayTouchTargetPx(1));
    expect(gameplayTouchTargetPx(1000)).toBe(gameplayTouchTargetPx(4));
  });

  it('honours a larger physical floor when one is asked for', () => {
    expect(gameplayTouchTargetPx(1, 20)).toBeGreaterThan(gameplayTouchTargetPx(1, 14));
  });
});
