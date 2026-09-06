/**
 * Everything the site keeps about a player, as one thing that can be exported, imported
 * or erased (#2448).
 *
 * There is no account and no server, so the only copy of a player's favourites is the one
 * in this browser's storage — and a new phone, a cleared cache or a second browser starts
 * from nothing. Export and import are the whole answer to that: a file the player owns,
 * moved by the player, read by nobody else. Erase is the other half of the same promise,
 * because "your data stays on your device" is only worth saying alongside "and here is
 * the button that removes it".
 *
 * The file is a wrapper around the raw stored values, key by key, rather than a new
 * shape of its own. That way the stores keep owning their shapes and their migrations —
 * an import writes what the export read, and the next read validates it exactly as it
 * validates anything else found under the key. A foreign or hand-edited value therefore
 * costs the player defaults, never a crash, and this file does not need to know what a
 * favourite looks like.
 *
 * What it does check is the envelope: the format name, so a random JSON file is refused
 * with a sentence rather than half-applied, and the version, so a file from a build that
 * writes shapes this one cannot read is refused rather than guessed at.
 */

import { FAVOURITES_KEY, readFavourites } from './favourites';
import { LAST_MODE_KEY, rememberedGames } from './last-mode';
import { isRecord, readJson, readVersioned, removeJson, writeJson } from './local-store';
import { readRecent, RECENT_KEY } from './recent';
import { SETTINGS_KEY } from './settings';

/** Identifies an export as ours, so a file of something else is refused before it is read. */
export const PLAYER_DATA_FORMAT = 'duelbox-player-data';

/** The version of the envelope, not of any store inside it. Each store versions itself. */
export const PLAYER_DATA_VERSION = 1;

/** Every key the site writes. Erase removes exactly these; import accepts nothing else. */
export const PLAYER_DATA_KEYS: readonly string[] = [
  LAST_MODE_KEY,
  FAVOURITES_KEY,
  RECENT_KEY,
  SETTINGS_KEY,
];

/** The settings store's own version, checked here only to count it as present. */
const SETTINGS_VERSION = 1;

/**
 * Everything stored, as a JSON document the player can save and bring back.
 *
 * Only keys that hold something are included, so an export from a fresh browser is an
 * empty `data` object rather than four nulls. Indented, because the player may open it.
 */
export function exportPlayerData(): string {
  const data: Record<string, unknown> = {};
  for (const key of PLAYER_DATA_KEYS) {
    const value = readJson(key);
    if (value !== null) data[key] = value;
  }
  return JSON.stringify(
    { format: PLAYER_DATA_FORMAT, version: PLAYER_DATA_VERSION, data },
    null,
    2,
  );
}

/**
 * Restores an export made by {@link exportPlayerData}.
 *
 * Refused outright, with a reason the settings page can show, when the text is not JSON,
 * is not one of our files, or is a version this build does not read. Inside a file that
 * is accepted, only known keys holding plain objects are written and the rest is
 * skipped without comment — a later build may export a store this one has never heard
 * of, and that is no reason to refuse the favourites beside it. The stores sanitise on
 * read, so what a value contains is not checked here.
 *
 * Storage refusing a write is an error too, because it is the one failure the player
 * can do something about (free space, leave private browsing). Whatever was written
 * before the refusal stays, since it was valid data the player asked for.
 */
export function importPlayerData(
  text: string,
): { readonly imported: readonly string[] } | { readonly error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'That file is not valid JSON.' };
  }
  if (!isRecord(parsed) || parsed['format'] !== PLAYER_DATA_FORMAT) {
    return { error: 'That file is not a DuelBox player-data export.' };
  }
  if (parsed['version'] !== PLAYER_DATA_VERSION) {
    return {
      error: `That export was written by a different version of DuelBox (${String(parsed['version'])}) and this one cannot read it.`,
    };
  }
  const data = parsed['data'];
  if (!isRecord(data)) {
    return { error: 'That export has no data in it.' };
  }

  const imported: string[] = [];
  for (const key of PLAYER_DATA_KEYS) {
    const value = data[key];
    if (!isRecord(value)) continue;
    if (!writeJson(key, value)) {
      return { error: 'Your browser would not save the data. Storage may be full or disabled.' };
    }
    imported.push(key);
  }
  return { imported };
}

/** Removes everything the site has stored. Safe to call twice; safe with no storage at all. */
export function resetPlayerData(): void {
  for (const key of PLAYER_DATA_KEYS) removeJson(key);
}

/**
 * What the settings page shows beside the erase button, so the player knows what "all of
 * it" means before pressing. Counts, not contents: `games` is the number of games with a
 * remembered setup, and `hasSettings` is whether anything has been changed from the
 * defaults at all.
 */
export function playerDataSummary(): {
  favourites: number;
  recent: number;
  hasSettings: boolean;
  games: number;
} {
  return {
    favourites: readFavourites().length,
    recent: readRecent().length,
    hasSettings: readVersioned(SETTINGS_KEY, SETTINGS_VERSION) !== null,
    games: rememberedGames().length,
  };
}
