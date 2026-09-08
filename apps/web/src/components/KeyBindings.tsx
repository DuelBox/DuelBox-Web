'use client';

import { useCallback, useEffect, useState } from 'react';
import type { KeyBinding, SeatId } from '@duelbox/engine';
import type { BindingSlot, SeatBindings } from '@/lib/key-bindings';
import styles from './KeyBindings.module.css';

/**
 * The store, fetched rather than imported, and this is the same decision `SoundToggle` makes
 * about `lib/audio`.
 *
 * `lib/key-bindings.ts` imports `DEFAULT_BINDINGS`, `bindingConflicts` and `otherSeat` from
 * `@duelbox/engine`. A top-level import here would put the engine in the chunk `/settings/`
 * loads eagerly — **measured at 12.7 KB on the shell**, paid by every visitor to every
 * non-play route, for a panel most of them will never open. Reached through `import()` it is
 * an async chunk instead: on demand, which is the budget for code a visitor asks for.
 *
 * `BINDING_SLOTS` comes with it rather than being written out here, so the order the UI lists
 * and the order the store validates cannot drift.
 */
type Store = Awaited<ReturnType<typeof loadStore>>;
const loadStore = () => import('@/lib/key-bindings');

/**
 * Capture-a-key rebinding, per action, per seat (#129, #2428).
 *
 * `lib/key-bindings.ts` has held the store, the defaults, the reserved list and the conflict
 * rules since they were written, with a test file beside them — and **nothing imported it**.
 * No page offered a rebinding, and `GameHost` built its `InputManager` on the engine's
 * defaults, so a binding written by hand into storage would not have reached a match either.
 * This component and the two lines in `GameHost` are the missing consumer; everything the
 * decision needs was already there and already tested.
 *
 * ## What a press does
 *
 * A slot is a button. Pressing it arms a capture, and the next `keydown` anywhere in the
 * window is the answer — `event.code`, the physical key position, never `event.key`, so a
 * binding made on QWERTY is the same three-key shape on AZERTY (`key-bindings.ts` carries the
 * long form of that). The change goes through `writeSeatBinding`, which validates against the
 * *other* seat's current binding before anything is stored, so a refusal leaves storage
 * untouched and hands back the reasons — which are shown, verbatim, in a live region rather
 * than swallowed.
 *
 * `Escape` cancels rather than binds. It is on the reserved list, so binding it would be
 * refused anyway; cancelling is the useful answer to the same press, and it means an armed
 * capture is never a trap.
 *
 * ## Why the buttons show a dash first
 *
 * These pages are exported once for everybody, so there is no server render of one device's
 * bindings. Storage is read in an effect, as everything on this page is, and the first paint
 * shows the defaults — which is what an unbound device really has.
 */

/** The armed capture: which seat and slot are waiting for a key, or nothing. */
interface Capture {
  readonly seat: SeatId;
  readonly slot: BindingSlot;
}

/**
 * What each seat is called here, and it is the seat's *position* rather than its character.
 *
 * `lib/seats.ts` holds the names, and importing it from a settings-page component would drag
 * `@duelbox/engine` onto every non-play route — `size-budget.json` records that trade twice,
 * and it is why the name fields on this same page are labelled "near seat" and "far seat"
 * too. Position is also the more useful label in front of a keyboard: the question a player
 * is answering is which side of the device they are sitting on.
 */
const SEAT_LABELS: Record<SeatId, string> = {
  p1: 'The near seat',
  p2: 'The far seat',
};

const SLOT_LABELS: Record<BindingSlot, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  action: 'Action',
};

/**
 * The order the boxes are listed in, taken from the labels above rather than from the store.
 *
 * `BINDING_SLOTS` is the store's order and is the same five names; it is not read here because
 * reading it would mean a top-level import of the module this component deliberately fetches.
 * `key-bindings.test.ts` holds the two lists to each other, so a sixth slot cannot appear in
 * one and not the other.
 */
const SLOT_ORDER = Object.keys(SLOT_LABELS) as readonly BindingSlot[];

/**
 * Why a refusal happened, said to a player rather than to a reader of `key-bindings.ts`.
 *
 * Three causes, three fixes: a key the page keeps for itself, a key the other seat is using,
 * and a key this seat is already using for something else. Re-derived here from the same
 * facts the store validated — its own strings name seats as `p1` and slots as `action`, which
 * is right for a developer and has never been shown to anybody else.
 *
 * It is only ever called on a refusal, so it cannot invent one; if it disagreed with the
 * store about the reason, the store's answer is still the one that decided.
 */
function refusalWords(
  store: Store,
  bindings: SeatBindings,
  capture: Capture,
  code: string,
): string {
  const key = store.keyLabel(code);
  if (store.RESERVED_KEYS.has(code)) {
    return `${key} is one DuelBox needs for the page itself. Pick another.`;
  }
  const other = capture.seat === 'p1' ? 'p2' : 'p1';
  if (SLOT_ORDER.some((slot) => bindings[other][slot] === code)) {
    return `${key} already belongs to ${SEAT_LABELS[other].toLowerCase()}. One key cannot drive both.`;
  }
  const clash = SLOT_ORDER.find(
    (slot) => slot !== capture.slot && bindings[capture.seat][slot] === code,
  );
  return clash === undefined
    ? `${key} cannot be used here.`
    : `${key} is already this seat's ${SLOT_LABELS[clash].toLowerCase()}.`;
}

export function KeyBindings({ id }: { id: string }) {
  const [store, setStore] = useState<Store | null>(null);
  const [bindings, setBindings] = useState<SeatBindings | null>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadStore().then((loaded) => {
      if (!live) return;
      setStore(loaded);
      setBindings(loaded.readBindings());
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (capture === null || bindings === null || store === null) return;
    const onKey = (event: KeyboardEvent) => {
      // Whatever happens, this press was for the capture and not for the page: without it a
      // Space bar aimed at a slot also presses the button that armed it, which re-arms it.
      event.preventDefault();
      if (event.code === 'Escape') {
        setCapture(null);
        setRefusal(null);
        return;
      }
      const next: KeyBinding = { ...bindings[capture.seat], [capture.slot]: event.code };
      const result = store.writeSeatBinding(capture.seat, next);
      setBindings(result.bindings);
      setRefusal(result.ok ? null : refusalWords(store, bindings, capture, event.code));
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [capture, bindings, store]);

  const reset = useCallback(
    (seat: SeatId) => {
      if (store === null) return;
      setBindings(store.resetSeatBinding(seat));
      setRefusal(null);
    },
    [store],
  );

  return (
    <div>
      {(['p1', 'p2'] as const).map((seat) => (
        <div key={seat} className={styles.seat}>
          <h3 className={styles.subhead} id={`${id}-${seat}`}>
            {SEAT_LABELS[seat]}
          </h3>
          <div className={styles.slots} role="group" aria-labelledby={`${id}-${seat}`}>
            {SLOT_ORDER.map((slot) => {
              const armed = capture?.seat === seat && capture.slot === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  className={styles.slot}
                  aria-label={`${SLOT_LABELS[slot]} for ${SEAT_LABELS[seat]}`}
                  onClick={() => {
                    setRefusal(null);
                    setCapture(armed ? null : { seat, slot });
                  }}
                >
                  <span className={styles.slotName}>{SLOT_LABELS[slot]}</span>
                  <span className={styles.slotKey}>
                    {armed
                      ? 'Press a key'
                      : bindings === null || store === null
                        ? '–'
                        : store.keyLabel(bindings[seat][slot])}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              reset(seat);
            }}
          >
            Reset {SEAT_LABELS[seat].toLowerCase()}&apos;s keys
          </button>
        </div>
      ))}
      {/*
        A refusal in words a player can act on, and it names which of the three problems it is
        because they have three different fixes. The strings `validateBindingChange` returns
        are the authority on *whether* — this only ever shows when `writeSeatBinding` refused —
        but they are written for a developer (`Cannot bind ArrowUp to p1.action: p2.up already
        uses it`) and a seat id is not something a player has ever been shown.

        `aria-live` without `role="status"`, deliberately. The site has exactly one status
        region — `SettingsPanel`'s — and `e2e/settings.spec.ts` and `e2e/record.spec.ts` both
        ask for "the" one; a second would break them, and `app/layout.tsx` carries the same
        note about `ServiceWorkerBridge`. Polite rather than assertive: the player has just
        pressed a key and is looking at the box that changed.
      */}
      <p className={styles.note} aria-live="polite">
        {refusal ?? 'Press a key box, then press the key you want. Escape cancels.'}
      </p>
    </div>
  );
}
