'use client';

import { useEffect, useState } from 'react';
import { rotateHintFor, type GameManifest } from '@duelbox/game-sdk';
import styles from './RotatePrompt.module.css';

/**
 * "Turn the phone upright for a bigger board", and nothing more than that (#136).
 *
 * 71 of the 108 games declare an orientation their box is designed for. Held the other way
 * they letterboxes — every game in the catalogue is playable every way up, which is
 * `isDesignedForOrientation`'s own first paragraph and must stay true — so what is left to do
 * is *offer*. `rotateHintFor` in the SDK is the whole decision and this is the whole of what
 * the shell does with it.
 *
 * ## Never blocking, and that is the acceptance criterion rather than a style note
 *
 * No overlay over the board, no focus trap, no modal, nothing that pauses. The layer is
 * `pointer-events: none` and only the dismiss button takes a press, so a pair happy playing
 * sideways can ignore it for the whole match, or close it, and neither costs them a frame.
 * The match does not know this component exists.
 *
 * ## Why there is no orientation lock
 *
 * The issue asks for `screen.orientation.lock` "where permitted", and on the platforms this
 * product supports it is permitted nowhere. **iOS Safari does not implement
 * `ScreenOrientation.lock` at all**, and both iPhone projects in `playwright.config.ts` are
 * real WebKit because that is the audience. Chrome on Android implements it and rejects it
 * outside fullscreen, and this site never enters fullscreen — it is a page two people share,
 * not an app that takes the screen. So a lock call here would be a line that throws on one
 * tier-1 engine and no-ops on the other, and the words underneath it would be doing all the
 * work anyway. Recorded rather than written: see the comment on #136.
 */
export function RotatePrompt({ manifest }: { manifest: GameManifest }) {
  const [want, setWant] = useState<'portrait' | 'landscape' | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // `matchMedia` rather than a resize listener: the question is which way up the device is,
    // the browser already answers it, and a resize listener would run on every keyboard
    // opening and every address-bar retraction to re-derive the same two words.
    const portrait = globalThis.matchMedia('(orientation: portrait)');
    const read = () => {
      setWant(rotateHintFor(manifest, portrait.matches ? 'portrait' : 'landscape'));
    };
    read();
    portrait.addEventListener('change', read);
    return () => {
      portrait.removeEventListener('change', read);
    };
  }, [manifest]);

  if (want === null || dismissed) return null;
  return (
    <div className={styles.layer}>
      <p className={styles.prompt}>
        <span>
          Turn the device {want === 'portrait' ? 'upright' : 'sideways'} for a bigger board.
        </span>
        <button
          type="button"
          className={styles.dismiss}
          onClick={() => {
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </p>
    </div>
  );
}
