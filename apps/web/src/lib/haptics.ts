/**
 * Vibration, behind a switch that starts off (#135).
 *
 * The Vibration API is one call, `navigator.vibrate(pattern)`, and the whole reason for a
 * module around it is where it is missing. iOS Safari has never implemented it, which is
 * half the phones this product is played on; Node, where the static export is rendered,
 * has a `navigator` with nothing on it; and Firefox on the desktop reports the function
 * and silently does nothing. So the call is never made unless it exists, and a game that
 * asks for a buzz gets `false` back rather than a TypeError in the middle of a step.
 *
 * Off by default, and that is the more important half. A phone lying flat between two
 * players buzzes against the table, which is loud in a way a speaker is not; a player who
 * wants it turns it on from the settings page, and the choice is remembered with the
 * rest of `settings.ts`.
 *
 * The patterns are named for what happened rather than for what they feel like, so a game
 * says `vibrate('score')` and the shell decides what a score feels like — the same
 * division as the audio system's named sounds, and for the same reason: a hundred games
 * inventing their own patterns would be a hundred opinions about a table.
 */

import { readSettings } from './settings';

export type HapticName = 'tap' | 'score' | 'win' | 'lose';

/**
 * Milliseconds, alternating on and off, as `navigator.vibrate` reads them.
 *
 * Short throughout. A tap is a confirmation and should be over before the finger lifts;
 * a win is the longest thing here, and it is still under half a second, because both
 * players are holding the same device and only one of them won.
 */
export const HAPTIC_PATTERNS: Readonly<Record<HapticName, readonly number[]>> = {
  tap: [10],
  score: [30],
  win: [40, 60, 40, 60, 80],
  lose: [120],
};

/**
 * The shape of `navigator` this module needs, with `vibrate` admitted to be optional.
 *
 * The DOM types say every navigator has `vibrate`. iOS Safari says otherwise, and the
 * type here sides with the phone.
 */
interface VibratingNavigator {
  readonly vibrate?: (pattern: number | number[]) => boolean;
}

function currentNavigator(): VibratingNavigator | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

/** Whether this runtime can vibrate at all. False on iOS Safari and on the build machine. */
export function hapticsSupported(): boolean {
  return typeof currentNavigator()?.vibrate === 'function';
}

/**
 * Plays a named pattern, if the player has turned vibration on and the device can.
 *
 * True only when all three things held: the setting, the support, and the browser
 * accepting the pattern. Never throws — a browser that has the function and objects to
 * the call is treated the same as one that has no function at all.
 */
export function vibrate(name: HapticName): boolean {
  try {
    if (!readSettings().haptics) return false;
    const vibrateFn = currentNavigator()?.vibrate;
    if (typeof vibrateFn !== 'function') return false;
    // Copied because the API wants a mutable array and the patterns are shared. Once per
    // event, never per frame, so the allocation is not the kind rule 5 is about.
    return vibrateFn.call(navigator, [...HAPTIC_PATTERNS[name]]) === true;
  } catch {
    return false;
  }
}
