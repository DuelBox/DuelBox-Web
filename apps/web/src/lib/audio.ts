import { AudioSystem } from '@duelbox/engine';

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
 */
let system: AudioSystem | null = null;

export function audio(): AudioSystem {
  system ??= new AudioSystem();
  return system;
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
