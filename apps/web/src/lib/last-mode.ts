/**
 * The configuration a player last used for a game, remembered as a default.
 *
 * A default rather than a decision: reopening a game you last played against a hard bot
 * pre-selects the hard bot, it does not start one. The alternative — remembering hard —
 * means a player who hands their phone to a friend once has to undo it every time
 * afterwards.
 *
 * It remembers the whole pre-match setup, not only the mode: the tier and the match
 * length are choices a pair makes once and want kept, and a second store for them would
 * be a second set of failure paths to get right. One key, one shape, one set of
 * fallbacks.
 *
 * `localStorage` because it fits the hosting constraint exactly: no account, no server,
 * no sync. Losing it costs one tap, so every failure path here returns the fallback
 * rather than throwing. Storage is genuinely absent in private browsing on some engines,
 * and full on others, and neither is worth a broken pre-match screen.
 */

import {
  DEFAULT_SETUP,
  isBotDifficulty,
  isPlayMode,
  isRoundChoice,
  type MatchSetup,
  type PlayMode,
} from './match-setup';

const KEY = 'duelbox:last-mode';

/**
 * The shape written today, as #152 asks for.
 *
 * **Version 1 is the first numbered one.** Before it the value was a bare
 * `{ [slug]: mode }` map with no version at all, and that shape is still read below and
 * migrated on the next write — a player who chose "play against Bo" last week keeps that
 * choice through the upgrade rather than being quietly reset. An unrecognised version is
 * treated as no data at all: a future shape is not something this build can interpret,
 * and guessing at it is how one tab corrupts another's settings.
 */
const VERSION = 1;

/**
 * One game's remembered choices, each optional: a player may have set only one of them.
 *
 * Validated on the way *out* rather than on the way in, at one gate: what comes back from
 * storage is untrusted whoever wrote it — another tab, an older build, a console — so the
 * read has to check anyway, and checking twice is code that ships to every visitor to
 * re-answer a question already answered.
 */
type StoredSetup = Partial<MatchSetup>;

/**
 * Reads the stored map, or an empty one if anything at all is wrong with it.
 *
 * Accepts both the versioned shape and the original bare map, because storage is written
 * by whichever version of the site the player last had open — including one in another
 * tab, still running the old build.
 */
function readAll(): Record<string, StoredSetup> {
  try {
    // No optional chaining: the type says localStorage is always there, and in private
    // browsing on some engines it is not. Reaching for it throws, which the catch below
    // handles — the same path as a parse failure, and for the same reason.
    const raw = globalThis.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Anything could be in storage — another tab, an older version, a user with the
    // console open. Validate rather than trust, and never let a bad value crash a page.
    if (!isRecord(parsed)) return {};

    // The pre-version shape was a flat map of slug to mode, and nothing else. A player
    // upgrading mid-sitting keeps what they chose rather than being quietly reset.
    const versioned = parsed['version'] !== undefined;
    if (versioned && parsed['version'] !== VERSION) return {};
    const games = versioned ? parsed['games'] : parsed;
    if (!isRecord(games)) return {};

    const out: Record<string, StoredSetup> = {};
    for (const [slug, value] of Object.entries(games)) {
      out[slug] = versioned ? sanitise(value) : isPlayMode(value) ? { mode: value } : {};
    }
    return out;
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps the fields that are recognised and drops the rest, field by field. */
function sanitise(value: unknown): StoredSetup {
  if (!isRecord(value)) return {};
  // Field by field rather than all-or-nothing: a tier this build does not know about
  // should cost the player their tier, not their mode as well.
  return {
    ...(isPlayMode(value['mode']) ? { mode: value['mode'] } : {}),
    ...(isBotDifficulty(value['difficulty']) ? { difficulty: value['difficulty'] } : {}),
    ...(isRoundChoice(value['rounds']) ? { rounds: value['rounds'] } : {}),
  };
}

/** Everything remembered about this game, with the defaults filled in for what is not. */
export function readSetup(slug: string): MatchSetup {
  const stored = readAll()[slug];
  return {
    mode: stored?.mode ?? DEFAULT_SETUP.mode,
    difficulty: stored?.difficulty ?? DEFAULT_SETUP.difficulty,
    rounds: stored?.rounds ?? DEFAULT_SETUP.rounds,
  };
}

/** Remembers part of a setup, leaving the rest of it alone. */
export function writeSetup(slug: string, patch: Partial<MatchSetup>): void {
  try {
    const all = readAll();
    // Merged rather than replaced, so choosing a tier cannot silently overwrite the mode
    // a player picked in another tab a moment ago.
    all[slug] = { ...all[slug], ...patch };
    globalThis.localStorage.setItem(KEY, JSON.stringify({ version: VERSION, games: all }));
  } catch {
    // Storage full, disabled, or unavailable. The player loses a convenience and
    // nothing else, so there is nothing to report and nothing to retry.
  }
}

/** The mode this game was last played in, or null if it never has been. */
export function readLastMode(slug: string): PlayMode | null {
  return readSetup(slug).mode;
}

export function writeLastMode(slug: string, mode: PlayMode): void {
  writeSetup(slug, { mode });
}

export type { PlayMode };
