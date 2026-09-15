import { describe, expect, it } from 'vitest';
import {
  REASON_TEXT,
  unsupportedReason,
  type EngineEnvironment,
  type UnsupportedReason,
} from './engine-support';

/**
 * The capability probe (#225), one missing capability at a time.
 *
 * The shape of this file is the point. A probe is a guard, and a guard that only ever sees a
 * healthy browser is the kind CLAUDE.md counts: every case below takes exactly one thing away
 * from an otherwise complete environment, so a check that stopped working would show up as
 * that one case going green-by-accident rather than as a silent pass everywhere. The first
 * test is the control that makes the rest mean anything — if `complete()` were not complete,
 * every `toBe` below would pass on the wrong reason.
 */

/** A browser that can run a match. Every case below removes one thing from this. */
function complete(): EngineEnvironment {
  return {
    canvas2d: true,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    now: () => 0,
    resizeObserver: class {},
    pointerEvent: class {},
    matchMedia: () => ({ matches: false }),
  };
}

/** Each reason, and the single change to a complete browser that produces it. */
const CASES: ReadonlyArray<readonly [UnsupportedReason, Partial<EngineEnvironment>]> = [
  ['canvas', { canvas2d: false }],
  ['frames', { requestAnimationFrame: undefined }],
  // Both halves of `browserClock`'s second check, because it names two functions and an
  // engine can have the request without the cancel.
  ['frames', { cancelAnimationFrame: undefined }],
  ['clock', { now: undefined }],
  ['resize', { resizeObserver: undefined }],
  ['pointer', { pointerEvent: undefined }],
  ['media', { matchMedia: undefined }],
];

describe('the engine capability probe', () => {
  it('passes a browser that has everything a match needs', () => {
    expect(unsupportedReason(complete())).toBeNull();
  });

  it.each(CASES)('refuses with %s', (reason, missing) => {
    expect(unsupportedReason({ ...complete(), ...missing })).toBe(reason);
  });

  /**
   * A capability that is present but is not callable is the same as an absent one, and it is
   * the likelier shape in the wild: a polyfill that assigns a truthy placeholder, or a page
   * whose own script has overwritten a global with something that is not a function.
   */
  it('refuses a capability that is present but not a function', () => {
    expect(unsupportedReason({ ...complete(), resizeObserver: true })).toBe('resize');
    expect(unsupportedReason({ ...complete(), now: 0 })).toBe('clock');
  });

  /** The most fundamental loss is the one reported, so an ancient engine is told one thing. */
  it('names the drawing surface first when a browser is missing several', () => {
    expect(
      unsupportedReason({
        ...complete(),
        canvas2d: false,
        requestAnimationFrame: undefined,
        pointerEvent: undefined,
      }),
    ).toBe('canvas');
  });

  it('has a sentence for every reason, and none of them names an API', () => {
    const reasons = new Set(CASES.map(([reason]) => reason));
    expect(new Set(Object.keys(REASON_TEXT))).toEqual(reasons);
    for (const [reason, text] of Object.entries(REASON_TEXT)) {
      expect(text.endsWith('.'), `${reason} is not a sentence`).toBe(true);
      // The panel reads "This browser cannot run the games" above it, so every sentence
      // starts from "It"; and a visitor on a 2015 phone cannot act on an identifier.
      expect(text.startsWith('It '), `${reason} does not continue the heading`).toBe(true);
      expect(
        /requestAnimationFrame|ResizeObserver|PointerEvent|matchMedia|getContext/.test(text),
      ).toBe(false);
    }
  });
});
