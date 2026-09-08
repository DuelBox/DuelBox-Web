import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  ECHO_WINDOW_MS,
  InputMethodTracker,
  SETTLE_MS,
  sharedInputMethod,
  type InputMethod,
} from './input-method';

/**
 * A device that can produce both kinds of event, driven on an explicit clock.
 *
 * Everything is driven through {@link InputMethodTracker.attach} rather than through `note`,
 * because the interesting failures live in the wrapper: which events are listened for at all,
 * what a lone modifier does, what an auto-repeat does. A test that only called `note` would
 * pass on a module that listened to `click` — which is the exact defect this whole design is
 * arranged around.
 *
 * The suite runs in Vitest's node environment with no DOM, so the target and the events are
 * doubles. They carry only the three fields the module reads: `timeStamp`, `key`, `repeat`.
 */
class Device {
  readonly tracker = new InputMethodTracker();
  /** Every prompt change, with the millisecond it happened on. */
  readonly changes: { method: InputMethod; at: number }[] = [];
  readonly listeners = new Map<string, EventListener>();
  readonly detach: () => void;
  #now = 0;

  constructor() {
    this.detach = this.tracker.attach({
      addEventListener: (type: string, handler: EventListenerOrEventListenerObject | null) => {
        this.listeners.set(type, handler as EventListener);
      },
      removeEventListener: (type: string) => {
        this.listeners.delete(type);
      },
    });
    this.tracker.subscribe((method) => {
      this.changes.push({ method, at: this.#now });
    });
  }

  /** A finger, a pen or a mouse going down. One event, whatever the pointing device. */
  tap(at: number): void {
    this.#fire('pointerdown', at, {});
  }

  /** A key going down. `repeat` is what the browser sets while a key is physically held. */
  press(at: number, key = 'w', repeat = false): void {
    this.#fire('keydown', at, { key, repeat });
  }

  #fire(type: string, at: number, extra: Readonly<Record<string, unknown>>): void {
    this.#now = at;
    const handler = this.listeners.get(type);
    if (handler === undefined) throw new Error(`nothing is listening for ${type}`);
    handler({ type, timeStamp: at, ...extra } as unknown as Event);
  }
}

describe('what counts as the player choosing an instrument (#2424)', () => {
  it('marks nothing at all until something has actually been used', () => {
    // The prompt starts neutral rather than guessing. A default of 'pointer' is a device
    // sniff in disguise: it tells a keyboard visitor they are touching, on no evidence.
    const device = new Device();
    expect(device.tracker.current).toBeNull();
    expect(device.changes).toEqual([]);
  });

  it('follows the instrument the player actually used, in the order they used it', () => {
    const device = new Device();
    device.tap(0);
    expect(device.tracker.current).toBe('pointer');
    device.press(2_000);
    expect(device.tracker.current).toBe('keyboard');
    device.tap(4_000);
    expect(device.tracker.current).toBe('pointer');
  });

  it('does not take a lone modifier as evidence of anything', () => {
    // Shift on its own commits nothing — it changes what a later key means — and it is also
    // what an on-screen-keyboard shim and an OS gesture emit on a touchscreen laptop.
    const device = new Device();
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead']) {
      device.press(1_000, key);
    }
    expect(device.tracker.current).toBeNull();

    // ...and an ordinary key immediately afterwards still counts, so the deny-list has not
    // quietly swallowed the keyboard.
    device.press(1_000, 'w');
    expect(device.tracker.current).toBe('keyboard');
  });

  it('counts a held key as one press, so holding a key does not blind the prompt to a tap', () => {
    // Auto-repeat fires every few tens of milliseconds. Counted, each repeat would push the
    // echo shadow forward and a tap arriving mid-hold would be refused as an echo — on a
    // shared device, exactly when the *other* player is reaching for the screen.
    const device = new Device();
    device.press(0, 'w');
    for (let at = 30; at <= 1_000; at += 30) device.press(at, 'w', true);
    device.tap(1_100);
    expect(device.tracker.current).toBe('pointer');
  });

  it('listens for the two commit events and for nothing else', () => {
    // This exact assertion is the one that matters most, and it is written as an equality
    // rather than a list of absences so a fourth listener cannot be added without failing it.
    //
    // `click` is the trap. A browser synthesises mousedown/mouseup/click after a touch, and
    // activating a focused button FROM THE KEYBOARD dispatches a click that arrives as a
    // PointerEvent — so a version of this module listening on click would read every keyboard
    // activation as a pointer, on every device, and would look correct in a mouse-only test.
    // `pointermove` is the other: a drifting mouse or an approaching pen is not a choice.
    const device = new Device();
    expect([...device.listeners.keys()].sort()).toEqual(['keydown', 'pointerdown']);
  });

  it('removes exactly what it added', () => {
    const device = new Device();
    device.detach();
    expect(device.listeners.size).toBe(0);
  });
});

describe('a hybrid device does not flicker (#2424)', () => {
  it('never moves the prompt for a tap and the key that tap produces', () => {
    // The hybrid case the issue names: a tap on a touchscreen laptop lands on a focused
    // control and is followed by a keyboard-looking event — an activation key, or a key from
    // the virtual keyboard the tap raised. Twelve of them, at a realistic typing rate.
    const device = new Device();
    for (let cycle = 0; cycle < 12; cycle += 1) {
      const at = cycle * 260;
      device.tap(at);
      device.press(at + 34, 'Enter');
    }

    // One change — the very first tap, which is genuine evidence. Not one per cycle, and not
    // twenty-four alternating changes, which is what "switch on any event" produces here.
    expect(device.changes).toEqual([{ method: 'pointer', at: 0 }]);
    expect(device.tracker.current).toBe('pointer');
  });

  it('holds through a realistic hybrid session and still follows a genuine change', () => {
    // A touchscreen laptop, in the lobby, narrated:
    const device = new Device();
    device.tap(0); // taps the button that opens the game
    device.press(42, 'Enter'); // the activation key that tap produced
    device.tap(980); // taps again
    device.press(1_016, 'Enter'); // and its companion again
    device.press(1_400, 'Shift'); // a hand settles on the keyboard: modifier only
    device.press(2_600, 'w'); // now they are genuinely typing
    device.press(2_660, 'a');
    device.press(2_690, 'a', true); // held
    device.tap(2_710); // the other player brushes the screen mid-keystroke

    // Two changes in three seconds, both of them real: the opening tap and the moment the
    // player picked up the keyboard. Nothing in between moved anything.
    expect(device.changes).toEqual([
      { method: 'pointer', at: 0 },
      { method: 'keyboard', at: 2_600 },
    ]);
  });

  it('bounds how often the prompt can change when two people use two instruments at once', () => {
    // This product puts two people on one device, so "both event families at once, for six
    // seconds, from two different humans" is ordinary rather than exotic. One types slowly,
    // the other taps steadily; 45 events between them, interleaved in real time as they
    // would actually arrive.
    const device = new Device();
    const duration = 6_000;
    const events: { at: number; press: boolean }[] = [];
    for (let at = 0; at < duration; at += 400) events.push({ at, press: true });
    for (let at = 150; at < duration; at += 200) events.push({ at, press: false });
    events.sort((a, b) => a.at - b.at);
    for (const event of events) {
      if (event.press) device.press(event.at);
      else device.tap(event.at);
    }
    expect(events).toHaveLength(45);

    // Two invariants, and the first is the one that means "does not flicker": whatever
    // arrives, two prompt changes are never closer together than the settle window.
    for (let i = 1; i < device.changes.length; i += 1) {
      const gap = device.changes[i]!.at - device.changes[i - 1]!.at;
      expect(gap).toBeGreaterThanOrEqual(SETTLE_MS);
    }
    expect(device.changes.length).toBeLessThanOrEqual(Math.ceil(duration / SETTLE_MS));

    // And it does not merely rate-limit: it settles. Nothing changes in the last five of the
    // six seconds, because whoever is producing events faster ends up holding the shadow.
    expect(device.changes.length).toBeGreaterThan(0);
    expect(device.changes[device.changes.length - 1]!.at).toBeLessThan(1_000);
  });

  it('refuses a change inside the settle window and honours it once the window is out', () => {
    const device = new Device();
    device.tap(0);
    device.press(1_000);
    expect(device.tracker.current).toBe('keyboard');

    // Outside the echo window, so this is not an echo — it is refused purely by hysteresis.
    device.tap(1_000 + ECHO_WINDOW_MS + 100);
    expect(device.tracker.current).toBe('keyboard');
    // One more press of the same instrument, now past the settle window, and it is honoured.
    device.tap(1_000 + SETTLE_MS + 100);
    expect(device.tracker.current).toBe('pointer');
  });

  it('does not let a refused event extend the shadow, so a change is delayed and never lost', () => {
    const device = new Device();
    device.press(0);
    // Taps every 100 ms — closer together than the echo window, so the early ones are all
    // refused. Only accepted events move the clock: if a refused one did, each tap would
    // renew the shadow the next tap was measured against and the pointer could NEVER take
    // over, however long the player kept tapping. Asserted as a count rather than a
    // timestamp so it survives a change to either constant.
    for (let at = 100; at <= 800; at += 100) device.tap(at);
    expect(device.tracker.current).toBe('pointer');
    expect(device.changes).toHaveLength(2);
  });
});

describe('subscription', () => {
  it('notifies on a change and never on a repeat of the same instrument', () => {
    const device = new Device();
    device.press(0);
    device.press(50);
    device.press(100);
    expect(device.changes).toEqual([{ method: 'keyboard', at: 0 }]);
  });

  it('stops notifying after unsubscribe', () => {
    const tracker = new InputMethodTracker();
    const listener = vi.fn();
    const off = tracker.subscribe(listener);
    tracker.note('keyboard', 0);
    off();
    tracker.note('pointer', 10_000);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('the shared tracker', () => {
  it('is created once and listens for the life of the document', () => {
    // The legend is mounted in the lobby and in the pause panel and nowhere in between, so a
    // tracker that only listened while a legend was on screen would sleep through the match
    // and then tell a player who had spent it on the keyboard that they were tapping.
    const added: string[] = [];
    let removed = 0;
    vi.stubGlobal('window', {
      addEventListener: (type: string) => added.push(type),
      removeEventListener: () => {
        removed += 1;
      },
    });
    try {
      const first = sharedInputMethod();
      expect(sharedInputMethod()).toBe(first);
      expect(added.sort()).toEqual(['keydown', 'pointerdown']);
      expect(removed).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(here, path), 'utf8');

describe('the prompt this drives (components/Controls.tsx)', () => {
  const tsx = read('../components/Controls.tsx');
  const css = read('../components/Controls.module.css');

  it('shows both hints whatever was last used, so no input path is ever taken away', () => {
    // The keyboard hint is unconditional. The touch hint's ONLY condition is whether the game
    // declares a pointer mapping — a fact about the game, not about the device or about what
    // the player last touched. Nothing here is disabled, hidden or made inert by a detection.
    expect(tsx).toMatch(/<Hint label="Keys" text=\{manifest\.controls\.keyboard\}/);
    expect(tsx).toMatch(/\{manifest\.controls\.pointer \? \(/);
    expect(tsx).not.toMatch(/\bdisabled\b|aria-disabled|pointer-events/);
    expect(css).not.toContain('pointer-events');
  });

  it('marks the used hint with a word, not with colour alone (rule 7)', () => {
    expect(tsx).toContain("marked={used === 'keyboard'}");
    expect(tsx).toContain("marked={used === 'pointer'}");
    expect(tsx).toMatch(/<span className=\{styles\.mark\}>in use<\/span>/);
  });

  it('reserves the mark in every row, so the mark moving cannot move anything else', () => {
    // Hidden with `visibility`, which keeps the box, and never with `display: none`, which
    // would make every switch a reflow — the flicker this issue is about, arriving by the
    // back door. There is one Hint and it always renders the mark, so both rows reserve it.
    expect(tsx.match(/styles\.mark\}/g)).toHaveLength(1);
    expect(css).toMatch(/\.mark\s*\{[^}]*visibility:\s*hidden/);
    expect(css).toMatch(/\.marked\s+\.mark\s*\{[^}]*visibility:\s*visible/);
    // A declaration, not the words: the comment above `.mark` names `display: none` as the
    // thing it is deliberately not doing, and the first version of this line failed on it.
    expect(css).not.toMatch(/^\s*display:\s*none/m);
  });

  it('adds emphasis to the marked hint and never removes it from the other', () => {
    // The unmarked hint keeps `--db-body`, which is AA on the panel. A stale or wrong mark
    // therefore costs a player nothing they could not already read.
    expect(css).toMatch(/\.text\s*\{[^}]*color:\s*var\(--db-body\)/);
    expect(css).toMatch(/\.marked\s+\.text\s*\{[^}]*color:\s*var\(--db-ink\)/);
    // Nothing on this panel is ever painted in the one neutral that misses AA on it. The
    // token is named in a comment here and must stay out of every declaration.
    expect(css).not.toMatch(/color:\s*var\(--db-faint\)/);
  });

  it('reads the tracker in an effect and never while rendering', () => {
    // The site is a static export: a value read during render is read on the build machine
    // and baked into HTML the first client paint would then have to disagree with.
    expect(tsx).toMatch(/useEffect\(\(\) => \{\s*const tracker = sharedInputMethod\(\);/);
    expect(tsx.match(/sharedInputMethod\(\)/g)).toHaveLength(1);
  });
});
