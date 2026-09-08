/**
 * Which instrument the player actually reached for last, so the prompts can match it (#2424).
 *
 * Showing keyboard hints to someone tapping, or touch hints to someone on a laptop, is the
 * small detail that makes an interface feel unconsidered. The fix is not to *sniff the device*
 * — a touchscreen laptop is both, a tablet with a keyboard case is both, and guessing from the
 * hardware is exactly what produces the wrong prompt — but to watch what the player uses and
 * follow it. Rule 10 says no game may ask what device it is on; nothing here is reachable from
 * a game, and the only consumer is the shell's own control legend.
 *
 * ## This changes what is shown and never what works
 *
 * There is no mode. Nothing here is wired to input handling at all: the engine's
 * `InputManager` keeps taking every key and every pointer whatever this module currently
 * believes, so a player who has been tapping and then reaches for the keyboard finds the
 * keyboard working on the first press, before the prompt has caught up and regardless of
 * whether it ever does. That is deliberate and it is the whole of the acceptance criterion
 * "no input path is ever disabled because another was detected": a wrong guess here costs a
 * misplaced emphasis on a hint, and it is not able to cost anything else, because this module
 * has no way to reach the thing that would.
 *
 * ## Nothing is marked until something has been used
 *
 * {@link InputMethodTracker.current} starts `null` and stays `null` until a real input
 * arrives. A default of `'pointer'` (which this module shipped with, and which nothing
 * consumed) is a device sniff wearing a different hat: it tells a keyboard visitor that touch
 * is what they are using, on the strength of no evidence at all. `null` renders as today's
 * neutral legend with both halves equal, which is also what makes the static export and the
 * first client paint agree — the tracker is created and attached inside an effect, never at
 * import time, exactly as `local-store.ts` defers its first read for the same reason.
 *
 * ## What counts as evidence, and why flicker is the hard part
 *
 * A hybrid device generates both kinds of event, sometimes for one physical action, so
 * "switch on any event" strobes. Four rules, in the order they bite:
 *
 * 1. **Only `keydown` and `pointerdown`.** A commit, not a hover: `pointermove` is a mouse
 *    drifting or a pen approaching and is never listened for. `click` and `mousedown` are not
 *    listened for either, and that is the load-bearing one — a browser synthesises
 *    `mousedown`/`mouseup`/`click` after a touch, and activating a focused button *from the
 *    keyboard* fires a `click` that arrives as a `PointerEvent`. A naive version of this
 *    module listening on `click` would read every keyboard activation as a pointer. Choosing
 *    the two commit events is the primary defence against the whole synthetic-event family,
 *    and it is free.
 * 2. **A lone modifier commits nothing.** Shift, Control, Alt, Meta, AltGraph, Caps Lock and
 *    the IME's `Dead`/`Unidentified` change what a *later* key means and are not themselves a
 *    player choosing the keyboard. They are also what an on-screen keyboard shim and an OS
 *    gesture emit on a touchscreen laptop. See {@link UNCOMMITTED_KEYS}.
 * 3. **Echo suppression.** An event of the *other* method within {@link ECHO_WINDOW_MS} of the
 *    last accepted one is treated as part of the same physical action, not as a change of
 *    instrument. This is what covers the residue rule 1 cannot: a tap that lands on a focused
 *    control and is followed by an activation key, and a tap that raises a virtual keyboard
 *    whose own keys then report as `keydown`. Deliberate use is what switches the prompt; an
 *    event is not on its own deliberate use.
 * 4. **Hysteresis.** After a switch the prompt holds for {@link SETTLE_MS} before it may move
 *    again. This is the bound rather than the fix — it caps the visible change rate at one per
 *    0.7 s no matter what arrives, which matters here more than on most sites because this
 *    product puts *two people on one device* and one of them may be tapping while the other
 *    types. A disagreement between two players then settles on whoever last held it for
 *    three-quarters of a second instead of strobing between them.
 *
 * A refused event is dropped rather than queued, and it does not extend the echo shadow
 * either — only an accepted event moves {@link InputMethodTracker} time forward. So a genuine
 * change of instrument is delayed by at most one further press, which is what typing or
 * tapping supplies within milliseconds, and never lost.
 *
 * The core is a plain state machine taking an explicit timestamp, testable with no DOM and
 * with no clock; {@link InputMethodTracker.attach} is the thin wrapper that wires it to real
 * events and is the only part that knows what a `KeyboardEvent` is.
 */

export type InputMethod = 'keyboard' | 'pointer';

export type InputMethodListener = (method: InputMethod) => void;

/**
 * How close an opposite-method event has to be to the last accepted one to read as an echo of
 * the same physical action rather than a change of instrument.
 *
 * Chosen to sit in the gap between two populations that do not overlap. A synthesised
 * companion event, a virtual keyboard's key, or an activation key on a control a tap has just
 * focused all arrive within a frame or three of the action that caused them — tens of
 * milliseconds. A player *deciding* to change instrument then has to move a hand from a
 * keyboard to a screen or back, and the reach alone is several hundred milliseconds before
 * anything is pressed. 300 ms is comfortably above the first and below the second. It is also
 * the figure browsers used for the old click delay, for the same question: is this one gesture
 * or two.
 */
export const ECHO_WINDOW_MS = 300;

/**
 * How long the prompt holds after it moves.
 *
 * Not a fix for any particular false positive — rules 1 to 3 above are the fixes — but the
 * ceiling on how bad any of them can look. Whatever arrives, the marked hint cannot change
 * more than once in this window, so the failure mode of every rule above degrades to "the
 * emphasis is a beat late" rather than "the panel strobes". The cost is that a genuine switch
 * inside the window needs a second press; typing and tapping both produce one immediately.
 */
export const SETTLE_MS = 700;

/**
 * Keys that are not a player choosing the keyboard.
 *
 * A modifier alone commits nothing — it changes what the *next* key means — and Caps Lock,
 * the IME's `Dead` and the `Unidentified` a shim emits when it cannot say what was pressed are
 * the same thing. Left deliberately as a small deny-list rather than an allow-list of keys the
 * shell binds: an allow-list would have to be kept in step with `lib/key-bindings.ts`, which a
 * player can rebind, and a rebound key that fell off the list would stop moving the prompt
 * with no visible cause. Anything that is not on this list counts, which is the safe direction
 * to be wrong in — the worst case is a prompt that follows a key the shell ignores, and rule 4
 * bounds what that can look like.
 */
const UNCOMMITTED_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'Dead',
  'Unidentified',
]);

/** The DOM surface {@link InputMethodTracker.attach} needs, so a test can hand it a double. */
interface ListenerTarget {
  addEventListener: EventTarget['addEventListener'];
  removeEventListener: EventTarget['removeEventListener'];
}

export class InputMethodTracker {
  #current: InputMethod | null = null;
  /** When the last *accepted* event arrived. Refused events do not extend the echo shadow. */
  #lastUse = Number.NEGATIVE_INFINITY;
  /** When {@link current} last changed, which is what {@link SETTLE_MS} is measured from. */
  #lastChange = Number.NEGATIVE_INFINITY;
  readonly #listeners = new Set<InputMethodListener>();

  /**
   * The instrument the player last used, or `null` before they have used one.
   *
   * `null` is not "unknown device" — it is "no evidence yet", and the caller's job is to show
   * a legend that favours neither. Nothing else may be inferred from it.
   */
  get current(): InputMethod | null {
    return this.#current;
  }

  /**
   * Record that the player used `method` at `atMs`, and return whether that moved the prompt.
   *
   * `atMs` is any monotonic millisecond clock — {@link attach} passes `event.timeStamp`, which
   * is high-resolution and same-origin in every engine this ships to, and only differences are
   * ever taken, so an engine that still reports an epoch there behaves identically.
   */
  note(method: InputMethod, atMs: number): boolean {
    if (method === this.#current) {
      this.#lastUse = atMs;
      return false;
    }
    // Part of the physical action that is already in progress, not a new choice of instrument.
    if (atMs - this.#lastUse < ECHO_WINDOW_MS) return false;
    // Too soon after the last switch: hold what is shown rather than let it oscillate.
    if (atMs - this.#lastChange < SETTLE_MS) return false;
    this.#current = method;
    this.#lastUse = atMs;
    this.#lastChange = atMs;
    for (const listener of this.#listeners) listener(method);
    return true;
  }

  /** Subscribe to changes. The listener is called with the new method on each switch only. */
  subscribe(listener: InputMethodListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Wire the tracker to a target's two commit events and return the teardown.
   *
   * Passive listeners, because this never calls `preventDefault` — it observes and nothing
   * else, and a passive listener cannot become the reason a scroll or a tap felt slow. One
   * `pointerdown` listener covers mouse, pen and touch alike; there is no touch-specific
   * listener to keep in step with it, and no branch on `pointerType`, because which pointing
   * device it is has never been the question this module answers.
   *
   * `event.repeat` is skipped: a held key auto-repeats every few tens of milliseconds and all
   * of them are one press. Counting them would keep pushing the echo shadow forward for as
   * long as a finger stayed down, which on a shared device is exactly when the other player is
   * most likely to reach for the screen.
   */
  attach(target: ListenerTarget): () => void {
    const onKey = (event: Event): void => {
      const key = event as KeyboardEvent;
      if (key.repeat || UNCOMMITTED_KEYS.has(key.key)) return;
      this.note('keyboard', event.timeStamp);
    };
    const onPointer = (event: Event): void => {
      this.note('pointer', event.timeStamp);
    };
    target.addEventListener('keydown', onKey, { passive: true });
    target.addEventListener('pointerdown', onPointer, { passive: true });
    return () => {
      target.removeEventListener('keydown', onKey);
      target.removeEventListener('pointerdown', onPointer);
    };
  }
}

let shared: InputMethodTracker | undefined;

/**
 * The one tracker the shell reads, created and attached on first use.
 *
 * **Browser only, and only from an effect.** It reaches for `window`, so calling it while
 * rendering would run it on the build machine during the static export and put a value into
 * the server's HTML that the browser's first paint could disagree with.
 * `local-store.ts` defers its first read for the identical reason and states the identical
 * rule; this follows it rather than inventing a second convention.
 *
 * The teardown from `attach` is deliberately dropped. Two passive listeners live for as long
 * as the document, because what the tracker knows has to outlive the component that shows it:
 * the control legend is mounted in the lobby and in the pause panel and nowhere in between, so
 * a tracker that only listened while a legend was on screen would miss the entire match and
 * then tell a player who had just spent three minutes on the keyboard that they were tapping.
 */
export function sharedInputMethod(): InputMethodTracker {
  if (shared === undefined) {
    shared = new InputMethodTracker();
    shared.attach(window);
  }
  return shared;
}
