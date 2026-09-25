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
 * Which way round a rectangle is. Two values, because a rectangle is one or the other.
 *
 * Deliberately narrower than the manifest's `ORIENTATIONS`, which is
 * `'portrait' | 'landscape' | 'any'` — that third value is a *declaration* a game makes
 * about the box it designed ("either way round suits it"), not a shape a screen can have.
 * The pair is the same shape as `DeclaredZoneSplit` against `ZoneSplit` in seat.ts, and
 * for the same reason: the wider declared union is not assignable to this one, so a
 * caller that tries to pass `manifest.orientation` straight into a function taking this
 * stops compiling rather than silently treating `'any'` as a screen shape.
 */
export type Orientation = 'portrait' | 'landscape';

/**
 * Which way round this screen is — the one place in the product where a pixel measurement
 * becomes the word "portrait" or "landscape".
 *
 * It lives here because rule 8 puts every pixel-to-anything conversion in the render layer,
 * and rule 10 forbids a game asking what device it is on. A game physically cannot misuse
 * this: a game is handed a `LogicalSize` and never a screen size, so it has no pixels to
 * pass in. Feeding it the logical box instead answers a question about the *box*, which is
 * a constant of the match and tells a game nothing about the device it is running on.
 *
 * **Returns null when the screen has no shape yet**, and that is the interesting case
 * rather than a defensive flourish. A rotation is not instantaneous: mobile browsers report
 * a zero or nonsensical size for a frame or two in the middle of one — the same transient
 * {@link fitViewport} answers with a collapsed viewport rather than a throw. A function that
 * had to answer anyway would flap between the two orientations while the device turned, and
 * anything downstream of it — a rotate hint, a re-layout — would flicker in step. Null says
 * "no answer this frame"; the honest thing for a caller to do with it is keep the answer it
 * already had.
 *
 * A square screen is reported as landscape. The tie-break is arbitrary and it is also free:
 * a square screen letterboxes a portrait box and that same box turned on its side to exactly
 * the same drawn area, so whichever way the tie falls, neither player gets a larger board out
 * of it. `viewport.test.ts` asserts that equality rather than leaving it as a claim.
 */
export function screenOrientation(screenWidth: number, screenHeight: number): Orientation | null {
  if (!Number.isFinite(screenWidth) || !Number.isFinite(screenHeight)) return null;
  if (screenWidth <= 0 || screenHeight <= 0) return null;
  return screenHeight > screenWidth ? 'portrait' : 'landscape';
}

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

/** One device's screen, for {@link negotiateSharedViewport}. Device-independent CSS pixels. */
export interface DeviceScreen {
  readonly logical: { width: number; height: number };
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly insets?: SafeAreaInsets;
}

/**
 * The shared logical box a match adopts, and one device's letterbox onto it.
 *
 * `logical` is the negotiated play area — the *same object of dimensions* on both devices —
 * and `view` is how this particular screen letterboxes it. The pair is what the host needs:
 * it renders and hit-tests through `view`, and it reads coordinates in `logical`.
 */
export interface SharedViewport {
  readonly logical: { width: number; height: number };
  readonly view: Viewport;
}

/**
 * The match-start negotiation of the one play area both players share (CLAUDE.md rule 9).
 *
 * The two devices in a remote match must never see different amounts of the world, and the
 * only honest way to guarantee it is to fix **one** logical box before either has drawn a
 * frame and letterbox both screens to it. This is where that box is decided.
 *
 * The box is `negotiateSharedLogical(local.logical, peerLogical)`: the largest box, in the
 * game's own aspect, that fits inside both devices' declared play areas. Because both devices
 * are running the same game they declare the same box, so the negotiation returns that box
 * unchanged — the point is that it is *decided by agreement between the two declarations*
 * rather than assumed per device, and it stays independent of either screen's shape or size
 * (the issue's "independent of either device's screen"). Were the two ever handed different
 * boxes, the clamp is what stops the larger one showing a strip of world the smaller cannot —
 * the same disagreement `LockstepSession`'s config fingerprint refuses outright.
 *
 * `view` then letterboxes this device's screen to that box: surplus screen becomes bars, and
 * a bigger or wider screen gets the identical field of view as a smaller one, with the extra
 * space free for chrome. `shared-viewport.test.ts` proves the end-to-end property — every
 * pair of real devices sees the identical set of world points once negotiated.
 */
export function negotiateSharedViewport(
  local: DeviceScreen,
  peerLogical: { width: number; height: number },
): SharedViewport {
  const logical = negotiateSharedLogical(local.logical, peerLogical);
  const view = fitViewport(
    logical,
    local.screenWidth,
    local.screenHeight,
    local.insets ?? NO_INSETS,
  );
  return { logical, view };
}
