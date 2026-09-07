import { AudioSystem, EngineSoundBus, registerSoundBank } from '@duelbox/engine';
import type { SoundBus, SoundEvent } from '@duelbox/engine';
import {
  readSoundPreference,
  writeSoundPreference,
  type SoundPreference,
} from './sound-preference';

/**
 * The shell's one audio system, and the one bus every game and the match flow speak through.
 *
 * Built on first use rather than at module scope, because this site is a static export:
 * anything that touches `window` or `AudioContext` while the page is being rendered on the
 * build machine throws, and a module-level `new AudioSystem()` would do exactly that.
 *
 * One per tab is the right number. A second context does not get a second permission — the
 * autoplay policy is granted per document — so two systems would mean one unlocked and one
 * silently suspended, which is the confusing half of the bug this exists to avoid.
 */
let system: AudioSystem | null = null;
let bus: SoundBus | null = null;
let banked = false;

export function audio(): AudioSystem {
  if (system === null) {
    const preference = readSoundPreference();
    system = new AudioSystem({ masterGain: preference.volume, muted: preference.muted });
  }
  return system;
}

/** The bus handed to games through `GameContext.audio` and used by the match flow. */
export function soundBus(): SoundBus {
  bus ??= new EngineSoundBus(audio());
  return bus;
}

/** Say something happened. Used by the shell for the four match cues. */
export function emitCue(event: SoundEvent, intensity?: number): void {
  soundBus().emit(event, intensity);
}

/**
 * Arm the unlock, load the sounds, and keep both alive across backgrounding.
 *
 * Idempotent, so a component may call it on every mount. The gesture listeners are one-shot
 * and remove themselves once a gesture has been seen; `observeVisibility` is what re-arms
 * them after iOS suspends the context for a phone call or a backgrounded tab, which is a
 * state that is not in the spec and which code comparing only against `suspended` never
 * notices.
 *
 * The order matters. `unlock()` attaches the gesture listeners and deliberately creates no
 * context — creating one before the gesture is what leaves it suspended. `registerSoundBank`
 * then does create one, still suspended, and renders the ten cues into it. That is not a
 * contradiction: a suspended context can be built and filled, it just cannot be heard, and
 * doing it now is what stops the first hit of the first match arriving before its sound
 * exists. By the time the player taps Start the buffers are already in memory and the same
 * tap resumes the context.
 *
 * There is deliberately no prompt anywhere in this path, and there must never be one.
 * Unlocking is a side effect of a tap the player was already making.
 */
export function armAudio(): void {
  const a = audio();
  a.unlock();
  a.observeVisibility();
  if (!banked) banked = registerSoundBank(a);
}

/** The current preference, as the shell would render it in a control. */
export function soundPreference(): SoundPreference {
  return readSoundPreference();
}

/** Mute or unmute, and remember it. Returns the new state so a button can render from it. */
export function setSoundMuted(muted: boolean): boolean {
  const next = writeSoundPreference({ muted });
  audio().setMuted(next.muted);
  return next.muted;
}

/** Set the master level in [0, 1], and remember it. Out-of-range values are clamped. */
export function setSoundVolume(volume: number): number {
  const next = writeSoundPreference({ volume });
  audio().setMasterGain(next.volume);
  return next.volume;
}

/** For tests: drop the singletons so the next call builds a fresh system. */
export function resetAudioForTest(): void {
  system?.dispose();
  system = null;
  bus = null;
  banked = false;
}
