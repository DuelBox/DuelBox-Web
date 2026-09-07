'use client';

import { useEffect, useRef } from 'react';
import styles from './ExitControl.module.css';

/**
 * The persistent in-match exit control and its quit confirmation (#144).
 *
 * The reference app anchors an EXIT to the screen edge, and the real requirement behind it is
 * that leaving a match mid-play must not be a single accidental tap — a fat-fingered corner
 * should not throw away a game two people are in the middle of. So the edge-anchored control
 * only *opens* a confirmation; the confirmation is what actually forfeits, and it defaults to
 * "keep playing" so the destructive choice is never the one under the returning thumb.
 *
 * Controlled by the parent so the same confirmation can be opened from the button and from a
 * keyboard shortcut that is deliberately **not** a seat action key — Enter is seat two's
 * action and Space is seat one's, and while the board is live the host captures both, so a
 * shortcut on either could never reach here (HANDOFF: the Enter-is-seat-two bug). The play
 * surface opens this on Shift+Escape, which the host passes straight through.
 */
export interface ExitControlProps {
  /** Whether the confirmation is open. The persistent button is always shown. */
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  /** Confirmed: leave the match, forfeiting it. */
  onQuit: () => void;
}

export function ExitControl({ open, onOpen, onCancel, onQuit }: ExitControlProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // The safe default takes focus, so a keyboard user's first Enter keeps them playing.
    cancelRef.current?.focus({ preventScroll: true });

    const panel = dialogRef.current;
    if (panel === null) return;
    const trapped = panel;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        // Escape here cancels the confirmation rather than reaching the play surface's own
        // pause — a dialog owns Escape while it is up.
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      // Two buttons, kept in the trap: Tab moves between them and never out to the page
      // behind, which this dialog has declared inert.
      event.preventDefault();
      const stops = Array.from(
        trapped.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
      );
      if (stops.length === 0) return;
      const active = document.activeElement;
      const here = active instanceof HTMLElement ? stops.indexOf(active as HTMLButtonElement) : -1;
      const step = event.shiftKey ? -1 : 1;
      const next = here === -1 ? 0 : here + step;
      const wrapped = (next + stops.length) % stops.length;
      stops[wrapped]?.focus({ preventScroll: true });
    }

    // Capture, so the dialog decides what Escape and Tab mean before the page does.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, onCancel]);

  return (
    <>
      <button
        type="button"
        className={styles.exit}
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* A word, not only a glyph: the control has to say what it does at arm's length. */}
        <span aria-hidden="true">✕</span>
        <span className={styles.exitLabel}>Exit</span>
      </button>

      {open ? (
        <div
          ref={dialogRef}
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-label="Leave the match"
        >
          <div className={styles.panel}>
            <h2 className={styles.heading}>Leave the match?</h2>
            <p className={styles.detail}>
              Quitting now forfeits the match to the other player. This cannot be undone.
            </p>
            <div className={styles.actions}>
              <button ref={cancelRef} type="button" className={styles.keep} onClick={onCancel}>
                Keep playing
              </button>
              <button type="button" className={styles.quit} onClick={onQuit}>
                Quit and forfeit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
