'use client';

import { useEffect, useRef } from 'react';
import type { SeatId } from '@duelbox/engine';
import { SeatGlyph } from './SeatGlyph';
import { handoffPrompt } from './handoff';
import styles from './HandoffOverlay.module.css';

/**
 * The pass-and-play hand-off blackout (#134).
 *
 * Between the turns of a hidden-information game the board has to disappear entirely, or the
 * player picking up the device sees the hand the last player left on screen. This is a full,
 * opaque cover — not a translucent panel like the pause overlay — so no frame of the other
 * seat's state shows through it, and it stays up until the incoming player taps Continue.
 *
 * It is rendered only when its parent decides a hand-off is due (see `handoff.ts`), and only
 * for a game that opted in, so a game that does not is never covered.
 */
export interface HandoffOverlayProps {
  /** The seat the device is being passed to. */
  toSeat: SeatId;
  /** What that seat is called. */
  toName: string;
  onContinue: () => void;
}

export function HandoffOverlay({ toSeat, toName, onContinue }: HandoffOverlayProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Focus the Continue button so the incoming player can take the device with the keyboard
  // as well as a tap, and so nothing behind the opaque cover holds focus.
  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className={styles.blackout} role="dialog" aria-modal="true" aria-label="Pass the device">
      <div className={styles.panel}>
        <SeatGlyph seat={toSeat} size={40} />
        <p className={styles.prompt}>{handoffPrompt(toName)}</p>
        <p className={styles.detail}>Hand the device over, then continue when you have it.</p>
        <button ref={buttonRef} type="button" className={styles.continue} onClick={onContinue}>
          I have it — continue
        </button>
      </div>
    </div>
  );
}
