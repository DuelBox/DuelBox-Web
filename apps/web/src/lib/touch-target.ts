'use client';

import { useEffect, useState } from 'react';

/**
 * Sizing a gameplay control by how big it is in the hand, not by a pixel count (#1889).
 *
 * A CSS pixel is meant to be a fixed physical size — 1/96 inch — but "meant to" is doing a
 * lot of work: a phone reports a device-pixel ratio the browser uses to scale, a desktop
 * reports its zoom the same way, and a fixed `48px` button can come out visibly smaller on
 * one device than another. The shell's `--db-touch-target` is fine for chrome a player
 * leans in to press, but a control you jab at across a table, mid-match, wants a floor
 * measured in millimetres and then converted to whatever pixels this device needs to hit
 * it.
 *
 * This is presentation, not game code (rule 10): it lives in `apps/web`, it decides the
 * size of a *control*, and it never reaches a simulation value (rule 8). A game asks for
 * nothing and branches on nothing; the shell sizes the control and the game draws inside
 * whatever box it is given.
 *
 * DPR is used the one honest way it can be: to snap the millimetre size to a whole number
 * of device pixels, so the control's edge is crisp rather than straddling a pixel. It is
 * not used to *shrink* the control on a dense screen — that is the bug this fixes, not a
 * feature to reproduce.
 */

/** CSS pixels per millimetre at the reference 96 CSS-px/inch. */
export const CSS_PX_PER_MM = 96 / 25.4;

/**
 * The physical floor for a gameplay control, in millimetres.
 *
 * Larger than the shell's 48px (≈12.7mm) on purpose: 48px suits a settings switch, and a
 * control two people jab at from arm's length wants more. 14mm is a little above the 9mm
 * physical target the platform guidelines land on, for the same reason the shell token is
 * above the 44px web floor — the device is shared and held further away than a phone one
 * person is reading.
 */
export const GAMEPLAY_MIN_MM = 14;

/** The shell's own target in CSS px, the absolute floor a gameplay control never drops below. */
export const SHELL_TARGET_PX = 48;

/** DPR is clamped into a sane band before it is trusted; a device reporting 0 or 100 is wrong. */
const MIN_DPR = 1;
const MAX_DPR = 4;

/**
 * The size, in CSS pixels, a gameplay control should be on a device with this pixel ratio,
 * to be at least `physicalMinMm` across.
 *
 * Pure and free of the DOM so it can be tested directly. The millimetre floor is converted
 * to CSS px, snapped up to a whole number of device pixels for a crisp edge, and then held
 * at or above the shell target so a device that under-reports its ratio can only ever make
 * the control bigger, never smaller than the rest of the site's controls.
 */
export function gameplayTouchTargetPx(dpr: number, physicalMinMm: number = GAMEPLAY_MIN_MM): number {
  const ratio = Number.isFinite(dpr) ? Math.min(MAX_DPR, Math.max(MIN_DPR, dpr)) : 1;
  const mm = Number.isFinite(physicalMinMm) && physicalMinMm > 0 ? physicalMinMm : GAMEPLAY_MIN_MM;
  const cssPx = mm * CSS_PX_PER_MM;
  // Snap up to a whole number of device pixels: a control 52.4 CSS px on a 2x screen is
  // 104.8 device px, so round the device pixels up and convert back.
  const snapped = Math.ceil(cssPx * ratio) / ratio;
  return Math.max(SHELL_TARGET_PX, snapped);
}

/** The device's pixel ratio, or 1 wherever it cannot be read (the static render, the suite). */
function readDpr(): number {
  const value = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * The gameplay touch-target size in CSS px as React state, ready to drop into a style as a
 * custom property.
 *
 * `SHELL_TARGET_PX` on the first render and the device-aware size from the first effect on,
 * for the reason the whole shell reads the device in an effect: the page is statically
 * exported, so a value read during render would make the server's HTML and the browser's
 * first paint disagree. It restays current across a DPR change — dragging a window between a
 * retina and a non-retina monitor, a desktop zoom — through the `resize` event, which is
 * where the browser reports a new `devicePixelRatio`.
 */
export function useGameplayTouchTarget(physicalMinMm: number = GAMEPLAY_MIN_MM): number {
  const [px, setPx] = useState(SHELL_TARGET_PX);
  useEffect(() => {
    const update = (): void => {
      setPx(gameplayTouchTargetPx(readDpr(), physicalMinMm));
    };
    update();
    globalThis.addEventListener('resize', update);
    return () => {
      globalThis.removeEventListener('resize', update);
    };
  }, [physicalMinMm]);
  return px;
}
