import type { GameOption } from '@duelbox/game-sdk';
import { isRecord, KEY_PREFIX, readJson, writeJson } from '../lib/local-store';

/**
 * The per-game options a player has chosen, persisted and applied at match start (#1751).
 *
 * The panel that shows these is generic — it renders whatever a game declares in
 * `manifest.options` with no bespoke UI — so the reading, writing and validating of the
 * values lives here rather than in the component, testable without a DOM and shared with the
 * match flow that has to apply them.
 *
 * The store mirrors `last-mode.ts` exactly, and deliberately: one versioned key, a per-game
 * map, values validated on the way *out* against the game's current schema rather than
 * trusted, and every failure path returning the default rather than throwing. What comes back
 * from storage was written by another tab, an older build, or a game whose options have since
 * changed, so a stored value is checked against the option it claims to be before it is used.
 */

export type OptionValue = string | number | boolean;

export const GAME_OPTIONS_KEY = `${KEY_PREFIX}game-options`;

const VERSION = 1;

/** The default value declared for each option, keyed by option id. */
export function defaultOptionValues(options: readonly GameOption[]): Record<string, OptionValue> {
  const out: Record<string, OptionValue> = {};
  for (const option of options) out[option.id] = option.default;
  return out;
}

/**
 * A stored value coerced to something the option can actually take, or its default.
 *
 * A select value must still be one of the choices, a toggle must be a boolean, and a range
 * value must be a finite number inside the bounds — clamped rather than rejected, so tightening
 * a range in a later build nudges an out-of-range choice back in rather than resetting it.
 */
export function coerceOptionValue(option: GameOption, stored: unknown): OptionValue {
  switch (option.type) {
    case 'select':
      return typeof stored === 'string' && option.choices.some((c) => c.value === stored)
        ? stored
        : option.default;
    case 'toggle':
      return typeof stored === 'boolean' ? stored : option.default;
    case 'range':
      return typeof stored === 'number' && Number.isFinite(stored)
        ? Math.min(option.max, Math.max(option.min, stored))
        : option.default;
  }
}

/** This game's stored raw map, or an empty one if anything is wrong with what is there. */
function readGame(slug: string): Record<string, unknown> {
  const parsed = readJson(GAME_OPTIONS_KEY);
  if (!isRecord(parsed)) return {};
  if (parsed['version'] !== VERSION) return {};
  const games = parsed['games'];
  if (!isRecord(games)) return {};
  const game = games[slug];
  return isRecord(game) ? game : {};
}

/**
 * Every option's value for this game: the stored choice where it is valid, the default where
 * it is missing or invalid. A game with no options returns an empty object and shows no panel.
 */
export function readOptionValues(
  slug: string,
  options: readonly GameOption[],
): Record<string, OptionValue> {
  const stored = readGame(slug);
  const out: Record<string, OptionValue> = {};
  for (const option of options) {
    out[option.id] = coerceOptionValue(option, stored[option.id]);
  }
  return out;
}

/** Remembers one option's value, leaving this game's other options and every other game alone. */
export function writeOptionValue(slug: string, id: string, value: OptionValue): void {
  const parsed = readJson(GAME_OPTIONS_KEY);
  const root = isRecord(parsed) && parsed['version'] === VERSION ? parsed : {};
  const gamesValue = root['games'];
  const games = isRecord(gamesValue) ? { ...gamesValue } : {};
  const currentGame = isRecord(games[slug]) ? games[slug] : {};
  games[slug] = { ...currentGame, [id]: value };
  // The result is ignored on purpose, exactly as `last-mode` ignores it: storage full,
  // disabled or absent costs a convenience and nothing an app can act on.
  writeJson(GAME_OPTIONS_KEY, { version: VERSION, games });
}
