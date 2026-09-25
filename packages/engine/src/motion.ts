/**
 * The motion signature's numbers, in the one place both sides of the product can read them
 * (#72).
 *
 * `docs/motion-signature.md` fixes three durations and one curve, and until now they existed
 * twice: as custom properties in `apps/web/src/styles/tokens.css`, which every transition in
 * the shell is timed by, and as whatever number a game happened to pass to a {@link Tween}.
 * Two copies of a design decision with nothing holding them equal is the shape this
 * repository has written down more than a dozen times, so this is the copy that is authored
 * and the stylesheet is the copy that is checked: `apps/web/src/styles/tokens.test.ts` parses
 * `tokens.css` and fails when a duration or the curve has drifted from this table.
 *
 * ## Why the numbers live in the engine and not in the app
 *
 * Because the dependency only points one way. The engine has no DOM — lint forbids `window`
 * and `document` inside this package — so it cannot read a custom property, and it cannot
 * import the app either. The app already imports the engine. So the engine is the only end
 * that can hold the values, and the app is the only end that can compare.
 *
 * Seconds here, milliseconds in CSS, and that is not an oversight: everything on this side of
 * the line is fed to the fixed timestep, which counts in seconds, and a table that stored
 * `200` would put a unit conversion inside every game instead of inside the one place that
 * writes a stylesheet. `tokens.ts` does the multiplication, once.
 *
 * ## Reduced motion
 *
 * CSS collapses the three durations to 1ms under `prefers-reduced-motion: reduce`.
 * {@link REDUCED_MOTION_SECONDS} is that same collapse in seconds, and
 * {@link motionDuration} applies it — but read its docstring before reaching for it, because
 * for anything a simulation can see the answer is `Tween.valueFor`, not a shorter duration.
 */

/** How many Newton steps {@link cubicBezier} spends inverting the x-curve. */
const NEWTON_ITERATIONS = 8;

/** Below this the x-curve is flat enough that a Newton step would divide by nothing. */
const FLAT = 1e-7;

/**
 * The motion signature, as numbers.
 *
 * Frozen because it is a table and not a setting: a game that wants a different duration
 * passes a different duration, and a product that wants a different signature changes this
 * file and `tokens.css` together with a test that fails until both have moved.
 */
export const MOTION = Object.freeze({
  /** A state change the player already knows about: a hover, a press, a focus ring. */
  durationFastSeconds: 0.12,
  /** The default. Anything that has no reason to be quicker or slower. */
  durationSeconds: 0.2,
  /** Something entering or leaving: an overlay, a result, a panel. */
  durationSlowSeconds: 0.38,
  /**
   * The one easing curve, as the two control points CSS states it with — P0 is (0, 0) and
   * P3 is (1, 1), so `cubic-bezier(0.2, 0.8, 0.2, 1)` is this tuple. A gentle decelerate.
   *
   * Frozen as well: {@link standardEase} reads it on every call, and an easing curve that a
   * caller could rewrite at runtime is a match two devices stop drawing the same way.
   */
  ease: Object.freeze([0.2, 0.8, 0.2, 1] as const),
});

/**
 * What a duration becomes when the device has asked for reduced motion: 1ms, in seconds.
 *
 * Not zero, and the stylesheet's 1ms is not zero either, for the same reason: a transition
 * of `0s` never fires a `transitionend`, and a tween of zero seconds settles on the step it
 * starts, which is a different step than the one a run would have settled on. One
 * millisecond is a single frame at any refresh rate anybody ships, so it is instant to a
 * player and still a run to everything watching one.
 */
export const REDUCED_MOTION_SECONDS = 0.001;

/**
 * A CSS `cubic-bezier(p1x, p1y, p2x, p2y)` timing function, evaluated.
 *
 * The curve CSS draws is not `y` as a function of `t`: it is a parametric curve, and the
 * timing function is `Y(u)` at the `u` where `X(u)` equals the progress asked for. So this
 * inverts the x-curve — Newton-Raphson from `u = t`, a fixed {@link NEWTON_ITERATIONS} steps
 * — and then evaluates the y-curve there. Eight steps is far more than the standard curve
 * needs (it converges to a double in three) and is cheap enough that a fixed count beats a
 * tolerance test: the loop count does not depend on the value, so every device spends the
 * same work on the same frame.
 *
 * Five positional numbers rather than a factory returning a closure, which is rule 5: a
 * factory allocates a closure per curve and the closure captures four doubles that then have
 * to be read through a context on every call. This allocates nothing, ever, and
 * {@link standardEase} is what a caller that just wants the product's curve reaches for.
 *
 * Answers exactly 0 at and below 0 and exactly 1 at and above 1 — the clamp {@link Easing}
 * says the other curves do without, because outside [0, 1] there is no `u` to solve for and
 * a Newton step there would wander. {@link Tween} clamps progress before it calls, so the
 * only caller in this package never reaches it.
 */
export function cubicBezier(t: number, p1x: number, p1y: number, p2x: number, p2y: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;

  let u = t;
  for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
    const slope = (3 * ax * u + 2 * bx) * u + cx;
    if (slope < FLAT && slope > -FLAT) break;
    u -= (((ax * u + bx) * u + cx) * u - t) / slope;
  }

  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  return ((ay * u + by) * u + cy) * u;
}

/**
 * `MOTION.ease` as an `Easing`: the curve the stylesheet applies, available to a tween.
 *
 * This is what makes the signature one signature rather than two. A shell overlay fading in
 * CSS and a game piece sliding on the canvas are now on the same curve because they are on
 * the same four numbers, and `tokens.test.ts` fails if the stylesheet stops saying so.
 */
export function standardEase(t: number): number {
  const ease = MOTION.ease;
  return cubicBezier(t, ease[0], ease[1], ease[2], ease[3]);
}

/**
 * A duration, collapsed to {@link REDUCED_MOTION_SECONDS} when the device has asked for
 * reduced motion. The JS half of the cascade's one lever.
 *
 * **This is for a duration chosen per device, which means it is for motion nothing else is
 * watching.** A {@link Tween} built with a shortened duration settles on a different step
 * than one built with the full duration, so if two devices are stepping the same match and
 * one of their players has the preference set, any simulation that gates on that tween has
 * stopped agreeing — the case `tween.ts` and `flip.ts` both set out at length. For anything
 * a simulation can see, the answer is `Tween.valueFor`, which changes what is drawn and not
 * what is stepped, and it needs no help from here.
 *
 * What is left is the motion that is genuinely one device's own: a shell overlay, a host
 * panel, a menu — the JS-driven counterparts of the transitions `tokens.css` collapses.
 * Route those durations through here and the two halves of the product answer the preference
 * the same way.
 *
 * The preference itself comes from `GameContext.reducedMotion` or a `Renderer`, both of which
 * declare it optional, so `undefined` reads as "no preference" exactly as it does there.
 */
export function motionDuration(seconds: number, reducedMotion?: boolean): number {
  return reducedMotion === true ? REDUCED_MOTION_SECONDS : seconds;
}
