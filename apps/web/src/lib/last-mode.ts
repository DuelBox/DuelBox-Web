/**
 * The configuration a player last used for a game, remembered as a default.
 *
 * A default rather than a decision: reopening a game you last played against a bot
 * pre-selects the bot, it does not start one. The alternative — remembering hard — means
 * a player who hands their phone to a friend once has to undo it every time afterwards.
 *
 * `localStorage` because it fits the hosting constraint exactly: no account, no server,
 * no sync. Losing it costs one tap, so every failure path here returns the fallback
 * rather than throwing. Storage is genuinely absent in private browsing on some engines,
 * and full on others, and neither is worth a broken pre-match screen.
 */

const KEY = 'duelbox:last-mode';

export type PlayMode = 'friend' | 'bot';

function isPlayMode(value: unknown): value is PlayMode {
  return value === 'friend' || value === 'bot';
}

/** Reads the stored map, or an empty one if anything at all is wrong with it. */
function readAll(): Record<string, PlayMode> {
  try {
    // No optional chaining: the type says localStorage is always there, and in private
    // browsing on some engines it is not. Reaching for it throws, which the catch below
    // handles — the same path as a parse failure, and for the same reason.
    const raw = globalThis.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Anything could be in storage — another tab, an older version, a user with the
    // console open. Validate rather than trust, and never let a bad value crash a page.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, PlayMode> = {};
    for (const [slug, mode] of Object.entries(parsed as Record<string, unknown>)) {
      if (isPlayMode(mode)) out[slug] = mode;
    }
    return out;
  } catch {
    return {};
  }
}

/** The mode this game was last played in, or null if it never has been. */
export function readLastMode(slug: string): PlayMode | null {
  return readAll()[slug] ?? null;
}

export function writeLastMode(slug: string, mode: PlayMode): void {
  try {
    const all = readAll();
    all[slug] = mode;
    globalThis.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage full, disabled, or unavailable. The player loses a convenience and
    // nothing else, so there is nothing to report and nothing to retry.
  }
}
