'use client';

import { useEffect, useState } from 'react';

/**
 * Whether this device asks for less motion, and a way to be told when the answer changes.
 *
 * The preference belongs to the device, so the shell reads it and everything else is
 * *told*. That is CLAUDE.md rule 10 rather than a style choice: a game that asked the
 * browser would be a game that branches on the device, and `no-restricted-globals` fails
 * the build for `matchMedia` anywhere under `packages/`. The engine takes it through
 * `Canvas2DRenderer.setReducedMotion`, a game takes it through `GameContext.reducedMotion`,
 * and neither of them may let it reach the simulation.
 *
 * Most of the shell never needs this module at all. `styles/tokens.css` collapses the
 * three duration tokens to 1ms under `prefers-reduced-motion`, every transition and
 * animation in the product is timed by one of them, and `styles/motion.test.ts` fails if
 * one appears that is not — so the cascade already handles every moving thing that is an
 * element. What it cannot reach is the canvas, which is why this exists.
 */

const REDUCE = '(prefers-reduced-motion: reduce)';

/** The part of a change event this module reads. */
interface MotionChange {
  readonly matches: boolean;
}

/**
 * The part of a `MediaQueryList` this module uses, with the subscription admitted to be
 * optional.
 *
 * The DOM types promise `addEventListener` on every media query. Safari only grew it in
 * version 14, and a phone old enough to be without it is exactly the phone that should
 * get a static page rather than a `TypeError` — so the type here sides with the device.
 */
interface MotionQuery {
  readonly matches: boolean;
  readonly addEventListener?: (type: 'change', listener: (event: MotionChange) => void) => void;
  readonly removeEventListener?: (type: 'change', listener: (event: MotionChange) => void) => void;
}

/**
 * The shape of the global this module needs, with `matchMedia` admitted to be optional,
 * exactly as `haptics.ts` does for `navigator.vibrate` and for the same reason.
 *
 * There genuinely is no `matchMedia` in two of the three places this code runs: Node
 * renders the static export, and the unit suite runs in Node too.
 */
interface MotionQuerying {
  readonly matchMedia?: (query: string) => MotionQuery;
}

function motionGlobal(): MotionQuerying {
  return globalThis;
}

/** The live query, or null wherever there is not one. Never throws. */
function motionQuery(): MotionQuery | null {
  try {
    return motionGlobal().matchMedia?.(REDUCE) ?? null;
  } catch {
    // Some embedded engines ship the function and reject the query string rather than
    // returning a query that never matches.
    return null;
  }
}

/**
 * Whether the player has asked for reduced motion, right now.
 *
 * False wherever the question cannot be asked, which is the safe answer in both
 * directions: it is what a device with no preference set reports, and it is what a static
 * render has to assume, because the build machine cannot know what a visitor's device
 * wants.
 *
 * It will not throw during a render, but do not call it in one. This site is statically
 * exported, so HTML built from a preference the server guessed disagrees with the first
 * paint on any device that guessed differently. Call it in an effect, or take
 * {@link useReducedMotion}.
 */
export function prefersReducedMotion(): boolean {
  try {
    return motionQuery()?.matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Calls back whenever the preference changes, and returns the unsubscribe.
 *
 * A subscription rather than a single read because somebody who turns the setting on
 * halfway through a match should be heard without reloading the page — and reloading is
 * the one thing a player mid-match will not do.
 *
 * The listener is never called with the current value. Every caller reads it first, so
 * firing on subscribe would only make each of them guard against doing its work twice.
 * Where there is nothing to watch the returned unsubscribe is a no-op, so a caller's
 * cleanup path is the same shape on every device.
 */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  const query = motionQuery();
  const listener = (event: MotionChange): void => {
    onChange(event.matches);
  };
  try {
    query?.addEventListener?.('change', listener);
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      query?.removeEventListener?.('change', listener);
    } catch {
      // A listener that cannot be removed is a leak the page is about to discard anyway;
      // throwing out of a cleanup would take the rest of the unmount with it.
    }
  };
}

/**
 * The preference as React state: false on the first render, the device's answer from the
 * first effect on, and current from then on.
 *
 * Read in an effect rather than during render for the reason `SoundToggle.tsx` and
 * `PlaySurface.tsx` read storage in one: the page is statically exported, so the server's
 * HTML knows nothing about this device and a value read while rendering makes the markup
 * and the first paint disagree. The default paints and the truth replaces it a frame
 * later.
 *
 * A caller that must be right on the very first effect — before this hook's own effect
 * has committed — should call {@link prefersReducedMotion} directly there and use the
 * hook only to stay current. `GameHost` does exactly that, because a game is handed its
 * context once and cannot be told again.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(prefersReducedMotion());
    return watchReducedMotion(setReduced);
  }, []);
  return reduced;
}
