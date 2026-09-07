import { AudioSystem } from '@duelbox/engine';
import { readSettings, type Settings } from './settings';

/**
 * The shell's one audio system.
 *
 * Built on first use rather than at module scope, because this site is a static export:
 * anything that touches `window` or `AudioContext` while the page is being rendered on the
 * build machine throws, and a module-level `new AudioSystem()` would do exactly that.
 *
 * One per tab is the right number. A second context does not get a second permission — the
 * autoplay policy is granted per document — so two systems would mean one unlocked and one
 * silently suspended, which is the confusing half of the bug this exists to avoid.
 *
 * Built with the stored settings, so a mute chosen yesterday holds today (#171). The
 * alternative — construct silent-by-default and apply the settings from an effect — has a
 * gap between the first flush and that effect in which a muted player hears the countdown,
 * and the countdown is the first sound of every match. Reading storage here is safe for
 * the same reason the construction is: nothing calls `audio()` until a component has
 * mounted, so the build machine never reaches this line.
 */
let system: AudioSystem | null = null;

export function audio(): AudioSystem {
  if (system === null) {
    const settings = readSettings();
    system = new AudioSystem({ muted: settings.muted, masterGain: settings.volume });
  }
  return system;
}

/**
 * Pushes settings into the running system, for the control that just changed them.
 *
 * The argument is there so a control can hand over the value `writeSettings` returned
 * rather than reading storage a second time; left out, it reads what is stored. Both the
 * mute and the level are applied every time, because a control that changed one has no
 * way to know the other did not change in another tab.
 */
export function applySoundSettings(settings: Settings = readSettings()): void {
  const a = audio();
  a.setMuted(settings.muted);
  a.setMasterGain(settings.volume);
}

/**
 * Arm the unlock, and keep it armed across backgrounding.
 *
 * Idempotent, so a component may call it on every mount. The listeners are one-shot and
 * remove themselves once a gesture has been seen; `observeVisibility` is what re-arms them
 * after iOS suspends the context for a phone call or a backgrounded tab, which is a state
 * that is not in the spec and which code comparing only against `suspended` never notices.
 *
 * There is deliberately no prompt anywhere in this path. Unlocking is a side effect of the
 * tap the player was already making.
 */
export function armAudio(): void {
  const a = audio();
  a.unlock();
  a.observeVisibility();
}
