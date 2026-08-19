import type { Vec2 } from './vec2.js';

/**
 * Screen edges that are physically unusable — notch, home indicator, rounded
 * corners, browser chrome. Device-independent CSS pixels.
 */
export interface SafeAreaInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Shared default for screens with nothing intruding on them. */
export const NO_INSETS: SafeAreaInsets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

/**
 * The mapping from a game's fixed logical resolution onto one device's screen.
 * Every number is in device-independent CSS pixels; the simulation itself never
 * sees any of them.
 */
export interface Viewport {
  /** Screen pixels per logical unit. 0 means the window is collapsed — do not draw. */
  readonly scale: number;
  /** Top-left corner of the drawn area; the rest of the screen is letterbox. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Drawn size, i.e. logical size * scale. */
  readonly width: number;
  readonly height: number;
  readonly logicalWidth: number;
  readonly logicalHeight: number;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${String(value)}`);
  }
}

/**
 * Fits the logical box inside the screen minus `insets`, preserving aspect ratio,
 * and centres it within the safe area. Surplus space becomes letterbox bars: a
 * wider screen shows the same logical area as a narrower one, never more of it.
 *
 * Offsets and scale are deliberately left unrounded — rounding them to whole
 * device pixels would break the exact inverse property of viewportToLogical and
 * logicalToViewport.
 *
 * A collapsed window (zero or negative available space after insets, which also
 * covers a non-finite screen size) is a transient state during rotation, a
 * split-screen drag or a keyboard opening — not a programming error. It yields a
 * viewport with scale 0 and zero size, positioned at the safe-area origin, rather
 * than throwing; callers skip drawing while scale is 0.
 *
 * @throws RangeError if either logical dimension is not a positive finite number.
 */
export function fitViewport(
  logical: { width: number; height: number },
  screenWidth: number,
  screenHeight: number,
  insets: SafeAreaInsets = NO_INSETS,
): Viewport {
  assertPositiveFinite(logical.width, 'logical.width');
  assertPositiveFinite(logical.height, 'logical.height');

  const availableWidth = screenWidth - insets.left - insets.right;
  const availableHeight = screenHeight - insets.top - insets.bottom;

  // Negated comparisons so NaN, which fails every ordered test, collapses too.
  if (!(availableWidth > 0) || !(availableHeight > 0)) {
    return {
      scale: 0,
      offsetX: insets.left,
      offsetY: insets.top,
      width: 0,
      height: 0,
      logicalWidth: logical.width,
      logicalHeight: logical.height,
    };
  }

  const scaleX = availableWidth / logical.width;
  const scaleY = availableHeight / logical.height;
  const scale = scaleX < scaleY ? scaleX : scaleY;
  const width = logical.width * scale;
  const height = logical.height * scale;

  return {
    scale,
    offsetX: insets.left + (availableWidth - width) / 2,
    offsetY: insets.top + (availableHeight - height) / 2,
    width,
    height,
    logicalWidth: logical.width,
    logicalHeight: logical.height,
  };
}

/**
 * Converts a screen position (e.g. a pointer event) into logical space, writing
 * into `out` and returning it. Exact inverse of logicalToViewport.
 *
 * Writes (0, 0) when the viewport is collapsed, since no screen position maps to
 * a logical one at scale 0.
 */
export function viewportToLogical(
  out: Vec2,
  screenX: number,
  screenY: number,
  view: Viewport,
): Vec2 {
  if (view.scale === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  out.x = (screenX - view.offsetX) / view.scale;
  out.y = (screenY - view.offsetY) / view.scale;
  return out;
}

/**
 * Converts a logical position into screen space, writing into `out` and returning
 * it. Exact inverse of viewportToLogical.
 */
export function logicalToViewport(
  out: Vec2,
  logicalX: number,
  logicalY: number,
  view: Viewport,
): Vec2 {
  out.x = view.offsetX + logicalX * view.scale;
  out.y = view.offsetY + logicalY * view.scale;
  return out;
}

/** Bounds are inclusive: a point exactly on the arena wall is still inside it. */
export function isInsideLogical(
  logicalX: number,
  logicalY: number,
  logical: { width: number; height: number },
): boolean {
  return logicalX >= 0 && logicalX <= logical.width && logicalY >= 0 && logicalY <= logical.height;
}

/**
 * Clamps a device pixel ratio to [1, max].
 *
 * Rendering above 2x costs frame budget for no visible gain at arm's length, so
 * the default ceiling is 2 no matter what the display reports.
 *
 * Returns 1 for a non-finite or non-positive input, and treats a `max` below 1 or
 * non-finite as 1, so the result is always a usable ratio.
 */
export function clampDevicePixelRatio(dpr: number, max = 2): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  const upper = Number.isFinite(max) && max > 1 ? max : 1;
  if (dpr < 1) return 1;
  return dpr > upper ? upper : dpr;
}

/**
 * Returns the largest box, in the same aspect ratio as `a`, that fits inside both
 * `a` and `b`. `a` is the authoritative aspect.
 *
 * This is what stops the player with the wider screen from seeing more of the
 * arena: both devices simulate and render this one negotiated logical box, and
 * whatever screen space is left over becomes letterbox or chrome. The result is
 * never larger than `a` in either dimension, so it is also safe to feed back in.
 *
 * @throws RangeError if any dimension is not a positive finite number.
 */
export function negotiateSharedLogical(
  a: { width: number; height: number },
  b: { width: number; height: number },
): { width: number; height: number } {
  assertPositiveFinite(a.width, 'a.width');
  assertPositiveFinite(a.height, 'a.height');
  assertPositiveFinite(b.width, 'b.width');
  assertPositiveFinite(b.height, 'b.height');

  const ratioX = b.width / a.width;
  const ratioY = b.height / a.height;
  let scale = ratioX < ratioY ? ratioX : ratioY;
  // Never grow past `a`: the shared box must fit inside a as well as b.
  if (scale > 1) scale = 1;

  return { width: a.width * scale, height: a.height * scale };
}
