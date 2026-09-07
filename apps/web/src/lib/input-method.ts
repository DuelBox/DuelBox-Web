/**
 * Which input the player actually reached for last, so the prompts can match it (#2424).
 *
 * Showing keyboard hints to someone using a mouse, or touch hints on a laptop, is the small
 * detail that makes an interface feel unconsidered. The fix is not to *sniff the device* —
 * a touchscreen laptop is both, and guessing from the hardware is exactly what produces the
 * wrong prompt — but to watch what the player uses and follow it.
 *
 * Two rules keep it from flickering on a hybrid device:
 *
 * 1. **Only deliberate actions switch it.** A `keydown` or a `pointerdown` is the player
 *    choosing an instrument; a `pointermove` (the mouse drifting, a pen hovering) is not, and
 *    is ignored. Without this, resting a hand on a trackpad would strobe the prompts.
 * 2. **A repeat of the current method is a no-op.** Subscribers are told only on an actual
 *    change, so a run of keystrokes notifies once, not once per key.
 *
 * This changes nothing about input handling: every path stays live whatever the prompt shows.
 * It is a presentation signal, not a mode — there is no "keyboard mode" a mouse is locked out
 * of, which is the whole point of the acceptance criterion "no input path is ever disabled
 * because another was detected".
 *
 * The core is a plain state machine, testable with no DOM; {@link InputMethodTracker.attach}
 * is the thin wrapper that wires it to real events.
 */

export type InputMethod = 'keyboard' | 'pointer';

export type InputMethodListener = (method: InputMethod) => void;

export interface InputMethodTrackerOptions {
  /**
   * What the prompts show before the player has touched anything. `'pointer'` by default —
   * a neutral first guess corrected the instant the first real input arrives, never a device
   * sniff.
   */
  readonly initial?: InputMethod;
}

export class InputMethodTracker {
  #current: InputMethod;
  readonly #listeners = new Set<InputMethodListener>();

  constructor(options?: InputMethodTrackerOptions) {
    this.#current = options?.initial ?? 'pointer';
  }

  /** The most recently used input method. */
  get current(): InputMethod {
    return this.#current;
  }

  /**
   * Record that the player just used `method`. Returns true if that changed the current
   * method (and notified subscribers), false if it was already current.
   */
  note(method: InputMethod): boolean {
    if (method === this.#current) return false;
    this.#current = method;
    for (const listener of this.#listeners) listener(method);
    return true;
  }

  /** Subscribe to changes; the listener is called with the new method on each switch. */
  subscribe(listener: InputMethodListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Wire the tracker to a DOM target's deliberate-action events and return the teardown.
   *
   * `keydown` marks keyboard; `pointerdown` marks pointer (mouse, pen and touch all arrive as
   * pointer events, so one listener covers every pointing device). Passive listeners, because
   * this never calls `preventDefault` — it only observes.
   */
  attach(target: {
    addEventListener: EventTarget['addEventListener'];
    removeEventListener: EventTarget['removeEventListener'];
  }): () => void {
    const onKey = (): void => {
      this.note('keyboard');
    };
    const onPointer = (): void => {
      this.note('pointer');
    };
    target.addEventListener('keydown', onKey, { passive: true });
    target.addEventListener('pointerdown', onPointer, { passive: true });
    return () => {
      target.removeEventListener('keydown', onKey);
      target.removeEventListener('pointerdown', onPointer);
    };
  }
}
