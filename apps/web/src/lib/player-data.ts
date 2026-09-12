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
import { stripForbiddenKeys } from './hardened-json';
import { HEAD_TO_HEAD_KEY, readRecord } from './head-to-head';
import { BEST_SCORES_KEY } from './best-scores-key';
import { CATALOGUE_KEY } from './catalogue-filter-key';
import { HINTS_SEEN_KEY } from './control-hints-key';
import { INSTALL_KEY } from './install-prompt-key';
import { KEY_BINDINGS_KEY } from './key-bindings-key';
import { LAST_MODE_KEY, rememberedGames } from './last-mode';
import { isRecord, readJson, readVersioned, removeJson, writeJson } from './local-store';
import { PLAYER_NAMES_KEY } from './player-names';
import { readRecent, RECENT_KEY } from './recent';
import { SETTINGS_KEY } from './settings';
import { TOURNAMENT_KEY } from './tournament-store';

/** Identifies an export as ours, so a file of something else is refused before it is read. */
export const PLAYER_DATA_FORMAT = 'duelbox-player-data';

/** The version of the envelope, not of any store inside it. Each store versions itself. */
export const PLAYER_DATA_VERSION = 1;

/**
 * Every key the site writes. Erase removes exactly these; import accepts nothing else.
 *
 * The head-to-head record and the two names are in here for the reason the file exists: a
 * player who moves to another device and finds their favourites but not the record of
 * every match they have played would have been handed the smaller half of their data,
 * and a record that did not travel is the obvious gap in "all of it is yours to move".
 *
 * A tournament in progress travels for a sharper version of the same reason. It is the one
 * thing stored here that is *unfinished*: a pair three games into seven who move to another
 * device, or press erase without meaning to, have lost something they cannot rebuild by
 * playing, because the line-up was drawn at random and the games already played are gone.
 */
export const PLAYER_DATA_KEYS: readonly string[] = [
  LAST_MODE_KEY,
  FAVOURITES_KEY,
  RECENT_KEY,
  SETTINGS_KEY,
  HEAD_TO_HEAD_KEY,
  PLAYER_NAMES_KEY,
  TOURNAMENT_KEY,
  KEY_BINDINGS_KEY,
  HINTS_SEEN_KEY,
  CATALOGUE_KEY,
  INSTALL_KEY,
  BEST_SCORES_KEY,
];

/**
 * What each stored key is called to a player, for the line that says what an import restored.
 *
 * Beside `PLAYER_DATA_KEYS` rather than in the panel that renders it (#220). The panel shows
 * these through `t(messages, name)`, and a string that reaches a lookup through a variable is
 * invisible to the extractor — so it has to be registered in `lib/i18n/sources.ts`, and
 * `sources.ts` cannot import a `.tsx` file at all: this repository compiles with
 * `jsx: preserve` for Next, which leaves Vitest unable to transform one. Here the names also
 * sit next to the list they name.
 *
 * Four of the keys above have no name here — the tournament in progress, the catalogue
 * filter, the install offer's memory and the best scores — and an import of one of those
 * shows the key itself. That is a poor line and a true one; it is recorded in #220 rather
 * than fixed in the batch that was converting strings, because inventing four sentences is
 * writing copy rather than translating it.
 */
export const PLAYER_DATA_KEY_NAMES: Readonly<Record<string, string>> = {
  [LAST_MODE_KEY]: 'the setup you last used for each game',
  [FAVOURITES_KEY]: 'your favourites',
  [RECENT_KEY]: 'your recently played games',
  [SETTINGS_KEY]: 'your settings',
  [HEAD_TO_HEAD_KEY]: 'your head-to-head record',
  [PLAYER_NAMES_KEY]: 'the names you chose for the two seats',
  [KEY_BINDINGS_KEY]: 'the keys you chose for the two seats',
  [HINTS_SEEN_KEY]: 'which games have shown you their first-play hints',
};

/**
 * Why an import was refused, in the words the settings page shows.
 *
 * Hoisted out of {@link importPlayerData} for the reason above: the panel renders a refusal
 * as `t(messages, result.error, result.values)`, so these five have to be somewhere
 * `sources.ts` can import and register.
 *
 * `version` carries a `{version}` placeholder rather than the number itself, because a
 * message with a value baked into it cannot be a catalogue key — the value travels beside it
 * and `t()` fills it in, in whatever order the translation puts it.
 */
export const IMPORT_ERRORS = {
  notJson: 'That file is not valid JSON.',
  notOurs: 'That file is not a DuelBox player-data export.',
  version:
    'That export was written by a different version of DuelBox ({version}) and this one cannot read it.',
  noData: 'That export has no data in it.',
  storage: 'Your browser would not save the data. Storage may be full or disabled.',
} as const;

/** The settings store's own version, checked here only to count it as present. */
const SETTINGS_VERSION = 1;

/**
 * Everything stored, as a JSON document the player can save and bring back.
 *
 * Only keys that hold something are included, so an export from a fresh browser is an
 * empty `data` object rather than a null for each key — written that way rather than as a
 * count, because the count has already gone from four to six once. Indented, because the
 * player may open it.
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
 * Refused outright, with one of {@link IMPORT_ERRORS} for the settings page to show — and
 * the values that fill its placeholders, if it has any — when the text is not JSON,
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
export function importPlayerData(text: string):
  | { readonly imported: readonly string[] }
  | {
      readonly error: string;
      readonly values?: Readonly<Record<string, string | number>>;
    } {
  let parsed: unknown;
  try {
    // An imported file is chosen by the player but written by anyone — it is the one input
    // here that did not come from this site's own storage — so the pollution keys are
    // stripped before any of it is read or re-stored (#2365). The stores each re-validate
    // on their next read as well; this closes the gap in between.
    parsed = stripForbiddenKeys(JSON.parse(text));
  } catch {
    return { error: IMPORT_ERRORS.notJson };
  }
  if (!isRecord(parsed) || parsed['format'] !== PLAYER_DATA_FORMAT) {
    return { error: IMPORT_ERRORS.notOurs };
  }
  if (parsed['version'] !== PLAYER_DATA_VERSION) {
    return { error: IMPORT_ERRORS.version, values: { version: String(parsed['version']) } };
  }
  const data = parsed['data'];
  if (!isRecord(data)) {
    return { error: IMPORT_ERRORS.noData };
  }

  const imported: string[] = [];
  for (const key of PLAYER_DATA_KEYS) {
    const value = data[key];
    if (!isRecord(value)) continue;
    if (!writeJson(key, value)) {
      return { error: IMPORT_ERRORS.storage };
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
 * remembered setup, `hasSettings` is whether anything has been changed from the defaults
 * at all, and `matches` is how many finished matches the record holds — summed across
 * every game and across both kinds of opponent, because "42 matches" is a thing a pair can
 * picture before pressing erase and a per-game breakdown is not. The bot's matches count
 * here for the same reason: they are stored on this device, so erasing removes them.
 */
export function playerDataSummary(): {
  favourites: number;
  recent: number;
  hasSettings: boolean;
  games: number;
  matches: number;
} {
  return {
    favourites: readFavourites().length,
    recent: readRecent().length,
    hasSettings: readVersioned(SETTINGS_KEY, SETTINGS_VERSION) !== null,
    games: rememberedGames().length,
    matches: readRecord().matches,
  };
}
