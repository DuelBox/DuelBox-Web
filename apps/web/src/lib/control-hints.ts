/**
 * Which games have already shown their on-screen control hints on this device (#137).
 *
 * The observed failure is a player not knowing which half of the screen is theirs in the
 * first five seconds. The fix is a per-seat hint shown on the *first* play of a game and
 * faded the moment that seat makes a successful input — so it never nags a returning player
 * and never sits over the board once they have started.
 *
 * This module owns only the "once per game per device" memory; the fade-on-first-input and
 * clear-of-play placement are the overlay component's job. Kept out of `settings.ts` for the
 * same reason the bindings are: a set of game ids is a different shape with a different
 * migration path. It is resettable, which is the "resettable from settings" acceptance
 * criterion — a returning player can ask to be shown the hints again.
 */
import {
  KEY_PREFIX,
  isRecord,
  readJson,
  removeJson,
  uniqueStrings,
  writeVersioned,
} from './local-store';

export const HINTS_SEEN_KEY = `${KEY_PREFIX}hints-seen`;

const VERSION = 1;

/** The game ids whose hints have been shown on this device. */
function readSeen(): string[] {
  const parsed = readJson(HINTS_SEEN_KEY);
  if (!isRecord(parsed) || parsed['version'] !== VERSION) return [];
  return uniqueStrings(parsed['seen']);
}

/** Whether this game's hints have been shown on this device before. */
export function hasSeenHints(gameId: string): boolean {
  if (gameId.length === 0) return false;
  return readSeen().includes(gameId);
}

/**
 * Record that this game's hints have now been shown, so the next visit does not repeat them.
 *
 * Idempotent: marking a game already seen writes the same set back rather than duplicating it,
 * because `uniqueStrings` drops repeats on the way out.
 */
export function markHintsSeen(gameId: string): void {
  if (gameId.length === 0) return;
  const seen = readSeen();
  if (seen.includes(gameId)) return;
  seen.push(gameId);
  writeVersioned(HINTS_SEEN_KEY, VERSION, { seen });
}

/** Forget every game, so first-play hints show again — the "reset from settings" path. */
export function resetHints(): void {
  removeJson(HINTS_SEEN_KEY);
}
