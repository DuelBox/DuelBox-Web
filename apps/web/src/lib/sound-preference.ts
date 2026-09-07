/**
 * Whether this device makes a noise, and how much of one.
 *
 * Modelled on `last-mode.ts` deliberately rather than invented: same versioned key, same
 * "validate on the way out because storage is untrusted whoever wrote it", same rule that
 * every failure path returns the fallback instead of throwing. `localStorage` is disabled
 * in private browsing on some engines and full on others, and neither is worth a broken
 * play page. A second storage idiom in the same app would be a second set of failure paths
 * to get right.
 *
 * ## What "respects the OS" can honestly mean
 *
 * There is **no media query for sound**. The platform offers `prefers-reduced-motion`,
 * `prefers-reduced-transparency`, `prefers-contrast` and `prefers-color-scheme`, and
 * nothing at all for audio — a muted device does not tell the page it is muted, and it
 * should not have to.
 *
 * So the OS signal used here is `prefers-reduced-motion: reduce`, and it is used for one
 * thing only: **the default when nothing has been stored yet.** Somebody who has told
 * their system to cut back on sensory intensity should not be handed sound they did not
 * ask for on their first visit. It is a default, not a decision — the first tap of the
 * sound control overrides it, and that choice is written down and wins from then on, for
 * exactly the reason `last-mode.ts` gives about remembering the hard bot.
 *
 * The reading is done here, in the shell, and nowhere else. No game may read the device
 * (rule 10) and nothing about the simulation may depend on any of this.
 */

const KEY = 'duelbox:sound';

/** First numbered version. An unrecognised one is treated as no data, never guessed at. */
const VERSION = 1;

/**
 * Default level when nothing is stored.
 *
 * Not 1: these cues sit under a shared-screen conversation between two people a foot from
 * the device, and a game that has to be turned down before it can be played has already
 * lost the argument. Loud is a choice the slider can make; it is not a good first guess.
 */
export const DEFAULT_VOLUME = 0.7;

export interface SoundPreference {
  readonly muted: boolean;
  /** Master level in [0, 1]. Remembered through a mute, so unmuting restores it. */
  readonly volume: number;
}

/** Whether this device has asked for less sensory intensity. See the note above. */
export function prefersReducedMotion(): boolean {
  try {
    // Guarded rather than assumed: this module is imported by a statically exported page
    // and evaluated during the build, in Node, where there is no `matchMedia`.
    if (typeof globalThis.matchMedia !== 'function') return false;
    return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** What to use when nothing has been stored. Derived from the OS, never from a guess. */
export function defaultSoundPreference(): SoundPreference {
  return { muted: prefersReducedMotion(), volume: DEFAULT_VOLUME };
}

function clampVolume(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * The stored preference, or the OS-derived default if there is nothing usable stored.
 *
 * Field by field, as `last-mode.ts` sanitises a setup: a corrupt volume should cost the
 * player their volume, not their mute.
 */
export function readSoundPreference(): SoundPreference {
  const fallback = defaultSoundPreference();
  try {
    const raw = globalThis.localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
    const record = parsed as Record<string, unknown>;
    if (record['version'] !== VERSION) return fallback;
    const volume = clampVolume(record['volume']);
    return {
      muted: typeof record['muted'] === 'boolean' ? record['muted'] : fallback.muted,
      volume: volume ?? fallback.volume,
    };
  } catch {
    return fallback;
  }
}

/**
 * Remembers part of the preference, leaving the rest alone, and returns what now applies.
 *
 * Normalised on the way in as well as on the way out: the return value is what the caller
 * applies to the audio system this instant, so a slider that hands over 1.4 must get 1
 * back rather than a number the next read would quietly correct.
 */
export function writeSoundPreference(patch: Partial<SoundPreference>): SoundPreference {
  const merged: SoundPreference = { ...readSoundPreference(), ...patch };
  const next: SoundPreference = {
    muted: merged.muted,
    volume: clampVolume(merged.volume) ?? DEFAULT_VOLUME,
  };
  try {
    globalThis.localStorage.setItem(
      KEY,
      JSON.stringify({ version: VERSION, muted: next.muted, volume: next.volume }),
    );
  } catch {
    // Storage full, disabled, or unavailable. The choice still applies to this session;
    // what is lost is remembering it, which costs one tap next time and nothing else.
  }
  return next;
}
