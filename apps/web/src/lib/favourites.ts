/**
 * The games a player has starred, so the catalogue can put them first (#86).
 *
 * A list of route slugs in the order they were starred, because that is the order a
 * player can predict: the game you marked this morning sits after the one you marked last
 * week, and a list that re-sorted itself by name every time would move the tile out from
 * under a thumb that had learned where it was.
 *
 * Slugs rather than names or catalogue indexes. A slug is the one identifier that has to
 * stay stable — it is the URL — and a favourite that outlives a renamed game is what a
 * player expects. A slug for a game that has since gone is simply never matched by the
 * catalogue, so it costs nothing and shows nothing.
 *
 * Read through `local-store.ts`, and validated on the way out: whatever is under the key
 * was written by another tab, an older build or somebody with the console open, and a
 * list that is not a list of strings becomes an empty one rather than a crash.
 */

import {
  KEY_PREFIX,
  readVersioned,
  removeJson,
  uniqueStrings,
  writeVersioned,
} from './local-store';

export const FAVOURITES_KEY = `${KEY_PREFIX}favourites`;

/** The shape written today: `{ version: 1, slugs: string[] }`. */
const VERSION = 1;

/** Every favourite, in the order they were marked. Empty if there are none or the value is unusable. */
export function readFavourites(): readonly string[] {
  const stored = readVersioned(FAVOURITES_KEY, VERSION);
  return stored === null ? [] : uniqueStrings(stored['slugs']);
}

export function isFavourite(slug: string): boolean {
  return readFavourites().includes(slug);
}

/**
 * Stars `slug` if it is not a favourite and unstars it if it is, returning the new list.
 *
 * The list is returned rather than the flag so a control can render the whole row from
 * one call, and it is returned even when the write failed: what the player sees should
 * be what they just did, and storage refusing to remember it is a separate matter that
 * the next reload settles.
 */
export function toggleFavourite(slug: string): readonly string[] {
  const current = readFavourites();
  const next = current.includes(slug)
    ? current.filter((entry) => entry !== slug)
    : [...current, slug];
  writeVersioned(FAVOURITES_KEY, VERSION, { slugs: next });
  return next;
}

export function clearFavourites(): void {
  removeJson(FAVOURITES_KEY);
}
