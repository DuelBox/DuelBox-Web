/**
 * The player's settings: sound, vibration, theme, seat palette and assist speed.
 *
 * One key for all of them rather than one each, for the reason `last-mode.ts` gives for
 * keeping the tier with the mode: a second key is a second set of failure paths, and this
 * file is mostly about what happens when a stored value is wrong. Field by field, so a
 * volume this build cannot read costs the player their volume and not their mute (#171),
 * and a mute chosen yesterday still holds today.
 *
 * Haptics is off by default and sound is on, and that asymmetry is deliberate (#135).
 * Sound is what a player expects from a game and turning it off is a choice they know how
 * to make. Vibration on a phone that is lying flat between two people is a surprise — it
 * buzzes against the table — so it is something a player opts into rather than out of.
 *
 * Three fields were added for the accessibility wave and all three default to "as the
 * device or the design already is", so a first-time visitor is unaffected and only a
 * deliberate choice changes anything. `theme` is `system`, which follows
 * `prefers-color-scheme` (#76); `seatPalette` is `default`, the brand red/blue (#174);
 * and `gameSpeed` is `1`, full speed (#179). The version below is unchanged because a
 * missing field reads back as its default, so a settings blob written before these
 * existed is still valid — only a value present and wrong is replaced.
 *
 * `readSettings` is safe to call anywhere except during a static render, because it
 * reaches storage through `local-store.ts` and never throws; a component reads it in an
 * effect, shows the defaults on the first paint, and applies the stored value a frame
 * later, which is the pattern `PlaySurface.tsx` sets. The one exception is the theme,
 * which an inline script in `layout.tsx` reads from this same key before the first paint
 * so the page never flashes the wrong background — see that file for why it duplicates the
 * key and the version rather than importing them.
 */

import { KEY_PREFIX, readVersioned, removeJson, writeVersioned } from './local-store';

/**
 * Which colour scheme to paint in.
 *
 * `system` is not a third palette: it means "whatever the device asks for through
 * `prefers-color-scheme`", and the other two are an explicit override of it. A player who
 * has never touched the setting is on `system`, so a device set to dark gets a dark site
 * with no choice made — the choice only records a disagreement with the device.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

/**
 * Which seat palette both the shell and the games draw with.
 *
 * `default` is the brand red/blue. `colourblind` is an alternative pair chosen for a large
 * seat-to-seat contrast under every dichromacy (#174), because the default pair is
 * 1.03:1 under deuteranopia — indistinguishable. It flows to the games through
 * `@duelbox/engine`'s `SEAT_PALETTES`, so it is one choice for the whole product rather
 * than a shell-only reskin. Shape and label differentiation (rule 7) is unaffected either
 * way; the palette is the belt, the shapes are the braces.
 */
export type SeatPaletteChoice = 'default' | 'colourblind';

export interface Settings {
  readonly muted: boolean;
  /** Master level in [0, 1]. Clamped on read and on write, never thrown over. */
  readonly volume: number;
  readonly haptics: boolean;
  /** Colour scheme, `system` unless the player overrode it (#76). */
  readonly theme: ThemeChoice;
  /** Seat colours, `default` unless the player chose the colour-blind pair (#174). */
  readonly seatPalette: SeatPaletteChoice;
  /**
   * Whether the two seats' colours are exchanged (#161): the near seat takes the far seat's
   * colour and vice versa. A third axis on the palette rather than a third palette — it is
   * the same pair either way round — and it is colour only: the shapes and the names stay
   * with their seats, because rule 7 says a seat differs by shape as well as colour, and a
   * shape that followed the colour would defeat that.
   */
  readonly seatSwap: boolean;
  /**
   * Assist-mode speed multiplier in [{@link MIN_GAME_SPEED}, 1] (#179). Scales how much
   * wall-clock time feeds the fixed loop, so the simulation runs the same steps in the
   * same order at every speed — it is slowed, never changed. `1` is full speed; below it
   * the match plays in slow motion. Never above 1: a faster match is a harder match, not
   * an assist, and would hand the quicker device an edge cross-device.
   */
  readonly gameSpeed: number;
}

export const SETTINGS_KEY = `${KEY_PREFIX}settings`;

/**
 * The shape written today: `{ version: 1, muted, volume, haptics, theme, seatPalette,
 * seatSwap, gameSpeed }`. The version is 1 and stays 1 through the three fields added for
 * the accessibility wave and the swap that followed them (#161): each reads back as its
 * default when absent, so no migration is owed and a blob from before they existed is
 * still a valid version-1 blob.
 */
const VERSION = 1;

/** The slowest assist speed offered. Half wall-clock rate; the sim is untouched. */
export const MIN_GAME_SPEED = 0.5;

export const DEFAULT_SETTINGS: Settings = {
  muted: false,
  volume: 1,
  haptics: false,
  theme: 'system',
  seatPalette: 'default',
  seatSwap: false,
  gameSpeed: 1,
};

const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
const SEAT_PALETTES: readonly SeatPaletteChoice[] = ['default', 'colourblind'];

/**
 * Keeps each recognised field if it is the right shape and takes the default otherwise.
 *
 * A volume outside [0, 1] is clamped rather than discarded: a slider that was dragged to
 * 1.2 by a build with a different range still means "loud", and a player who chose loud
 * should not come back to the default because of it. A volume that is not a finite number
 * means nothing, and that one does become the default. Game speed is clamped the same way,
 * into [MIN_GAME_SPEED, 1]; the enumerated fields (theme, seat palette) fall back to their
 * default for any value not in their small set, so a `theme` of `"midnight"` from a build
 * that shipped a fourth option does not leave the reader holding a string it cannot map.
 */
function sanitise(value: Record<string, unknown>): Settings {
  const volume = value['volume'];
  const speed = value['gameSpeed'];
  const theme = value['theme'];
  const seatPalette = value['seatPalette'];
  return {
    muted: typeof value['muted'] === 'boolean' ? value['muted'] : DEFAULT_SETTINGS.muted,
    volume:
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.min(1, Math.max(0, volume))
        : DEFAULT_SETTINGS.volume,
    haptics: typeof value['haptics'] === 'boolean' ? value['haptics'] : DEFAULT_SETTINGS.haptics,
    theme: THEMES.includes(theme as ThemeChoice) ? (theme as ThemeChoice) : DEFAULT_SETTINGS.theme,
    seatPalette: SEAT_PALETTES.includes(seatPalette as SeatPaletteChoice)
      ? (seatPalette as SeatPaletteChoice)
      : DEFAULT_SETTINGS.seatPalette,
    // A boolean, so anything that is not exactly `true` reads as the default: an old blob
    // has no field and reads `false`, which is what "the seats as they have always been"
    // means. The version stays 1 for the same reason it stayed 1 through #174.
    seatSwap: value['seatSwap'] === true,
    gameSpeed:
      typeof speed === 'number' && Number.isFinite(speed)
        ? Math.min(1, Math.max(MIN_GAME_SPEED, speed))
        : DEFAULT_SETTINGS.gameSpeed,
  };
}

/** The settings in storage with the defaults filled in for anything missing or wrong. */
export function readSettings(): Settings {
  const stored = readVersioned(SETTINGS_KEY, VERSION);
  return stored === null ? DEFAULT_SETTINGS : sanitise(stored);
}

/**
 * Changes some of the settings, leaving the rest alone, and returns the result.
 *
 * Merged rather than replaced, so a mute button cannot silently reset a volume the player
 * set on another page. The merged value goes through the same sanitiser as a read, so a
 * volume of 7 from a control with a bug is stored as 1 and returned as 1, and the caller
 * renders what was kept rather than what it asked for.
 */
export function writeSettings(patch: Partial<Settings>): Settings {
  const next = sanitise({ ...readSettings(), ...patch });
  writeVersioned(SETTINGS_KEY, VERSION, { ...next });
  return next;
}

export function resetSettings(): void {
  removeJson(SETTINGS_KEY);
}
