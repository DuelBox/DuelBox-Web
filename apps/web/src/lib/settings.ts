/**
 * The player's settings: sound on or off, how loud, and whether the phone vibrates.
 *
 * One key for all three rather than one each, for the reason `last-mode.ts` gives for
 * keeping the tier with the mode: a second key is a second set of failure paths, and this
 * file is mostly about what happens when a stored value is wrong. Field by field, so a
 * volume this build cannot read costs the player their volume and not their mute (#171),
 * and a mute chosen yesterday still holds today.
 *
 * Haptics is off by default and the other two are on, and that asymmetry is deliberate
 * (#135). Sound is what a player expects from a game and turning it off is a choice they
 * know how to make. Vibration on a phone that is lying flat between two people is a
 * surprise — it buzzes against the table — so it is something a player opts into rather
 * than out of.
 *
 * `readSettings` is safe to call anywhere except during a static render, because it
 * reaches storage through `local-store.ts` and never throws; a component reads it in an
 * effect, shows the defaults on the first paint, and applies the stored value a frame
 * later, which is the pattern `PlaySurface.tsx` sets.
 */

import { KEY_PREFIX, readVersioned, removeJson, writeVersioned } from './local-store';

export interface Settings {
  readonly muted: boolean;
  /** Master level in [0, 1]. Clamped on read and on write, never thrown over. */
  readonly volume: number;
  readonly haptics: boolean;
}

export const SETTINGS_KEY = `${KEY_PREFIX}settings`;

/** The shape written today: `{ version: 1, muted, volume, haptics }`. */
const VERSION = 1;

export const DEFAULT_SETTINGS: Settings = { muted: false, volume: 1, haptics: false };

/**
 * Keeps each recognised field if it is the right shape and takes the default otherwise.
 *
 * A volume outside [0, 1] is clamped rather than discarded: a slider that was dragged to
 * 1.2 by a build with a different range still means "loud", and a player who chose loud
 * should not come back to the default because of it. A volume that is not a finite number
 * means nothing, and that one does become the default.
 */
function sanitise(value: Record<string, unknown>): Settings {
  const volume = value['volume'];
  return {
    muted: typeof value['muted'] === 'boolean' ? value['muted'] : DEFAULT_SETTINGS.muted,
    volume:
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.min(1, Math.max(0, volume))
        : DEFAULT_SETTINGS.volume,
    haptics: typeof value['haptics'] === 'boolean' ? value['haptics'] : DEFAULT_SETTINGS.haptics,
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
