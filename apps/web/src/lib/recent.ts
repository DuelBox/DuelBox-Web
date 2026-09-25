/**
 * The games played most recently, newest first (#87).
 *
 * Short on purpose. Eight is a row of tiles on a phone and two rows on a laptop; a list
 * that remembered everything would be the catalogue again, in a worse order. The cap is
 * applied on read as well as on write, so a longer list written by another build or a
 * hand-edited import is trimmed rather than trusted.
 *
 * Playing a game moves it to the front rather than adding it again. A pair that has
 * played the same game five times tonight has one recent game, not five, and the list
 * stays a list of games rather than a log of matches — which is also why it stores no
 * times and no results. What was played is a convenience; when and who won would be a
 * record, and the privacy page says there is none.
 *
 * Read through `local-store.ts` and validated on the way out, for the same reason as
 * every other store: what is under the key was written by whoever had the site open last.
 */

import {
  KEY_PREFIX,
  readVersioned,
  removeJson,
  uniqueStrings,
  writeVersioned,
} from './local-store';

export const RECENT_KEY = `${KEY_PREFIX}recent`;

/** How many games are remembered. */
export const RECENT_CAP = 8;

/** The shape written today: `{ version: 1, slugs: string[] }`, most recent first. */
const VERSION = 1;

/** The recent games, most recent first, never more than {@link RECENT_CAP} of them. */
export function readRecent(): readonly string[] {
  const stored = readVersioned(RECENT_KEY, VERSION);
  return stored === null ? [] : uniqueStrings(stored['slugs']).slice(0, RECENT_CAP);
}

/**
 * Moves `slug` to the front, dropping whatever falls off the end, and returns the new
 * list. Returned even when the write failed, so what the caller shows matches what the
 * player just did.
 */
export function recordPlayed(slug: string): readonly string[] {
  const next = [slug, ...readRecent().filter((entry) => entry !== slug)].slice(0, RECENT_CAP);
  writeVersioned(RECENT_KEY, VERSION, { slugs: next });
  return next;
}

export function clearRecent(): void {
  removeJson(RECENT_KEY);
}
