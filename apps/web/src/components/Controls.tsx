'use client';

import { useEffect, useState } from 'react';
import type { GameManifest } from '@duelbox/game-sdk';
import { t } from '@/lib/i18n/messages';
import { useMessages } from '@/lib/i18n/use-messages';
import { SEAT_CHARACTERS, SEAT_KEYS } from '@/lib/seats';
import { sharedInputMethod, type InputMethod } from '@/lib/input-method';
import { SeatGlyph } from './SeatGlyph';
import styles from './Controls.module.css';

/**
 * What the controls are, shown before the match and again from the pause menu.
 *
 * Two people sharing a laptop have one keyboard and no touchscreen, so the keyboard is
 * not a fallback — it is the whole desktop experience of a two-player site. A player who
 * cannot find out which keys are theirs cannot play, and asking them to guess is how a
 * shared-device game silently becomes a single-player one.
 *
 * The copy comes from each game's manifest, so the shell never invents a legend and a
 * game never draws its own.
 *
 * ## Following the instrument in the player's hand (#2424)
 *
 * Both hints are always here, always in the same order, and neither is ever removed, dimmed
 * or made harder to read. What `lib/input-method.ts` changes is which one is *marked*: the
 * row matching the instrument last used gains the word "in use" and its text steps from
 * `--db-body` to `--db-ink`. Everything about the adaptation is additive, so a stale or wrong
 * mark costs a player nothing they could not already read — and, far more to the point,
 * nothing here is wired to input handling, so the keyboard works on the first press however
 * long the touch hint stays marked. That is the difference between adapting a prompt and
 * having a mode, and it is the whole issue.
 *
 * **Reordering was the obvious design and is deliberately not taken.** Putting the used
 * instrument first reads well in a mock-up and is a visible jump every time the mark moves,
 * which is the flicker the issue is about, dressed as a feature. The order is fixed; only the
 * mark moves. The mark's own box is rendered in *both* rows at all times and merely made
 * `visibility: hidden` in the unmarked one, so even the mark cannot reflow the panel — the
 * layout is identical in all three states (nothing used yet, keys, touch) down to the pixel.
 *
 * Before the player has used anything the tracker reports `null` and neither row is marked,
 * which renders exactly the legend this component rendered before #2424. That is not a
 * fallback, it is the honest state: guessing "touch" from a touchscreen being present is the
 * device sniff the issue exists to avoid, and it would be wrong for every visitor on a
 * touchscreen laptop who is using the keyboard.
 */
export function Controls({ manifest }: { manifest: GameManifest }) {
  const messages = useMessages();
  const [used, setUsed] = useState<InputMethod | null>(null);

  // In an effect, never during render: the site is a static export, so a value read while
  // rendering is read on the build machine and baked into HTML the browser would then have to
  // disagree with. The subscription is torn down with the panel; the tracker itself keeps
  // listening for the life of the document, because a match happens entirely between two
  // mounts of this component (see `sharedInputMethod`).
  useEffect(() => {
    const tracker = sharedInputMethod();
    setUsed(tracker.current);
    return tracker.subscribe(setUsed);
  }, []);

  return (
    <div className={styles.controls}>
      <span className={styles.title}>{t(messages, 'Controls')}</span>

      <ul className={styles.seats}>
        {SEAT_KEYS.map(({ seat, move, action }) => (
          <li key={seat} className={styles.seat}>
            <SeatGlyph seat={seat} />
            <span className={styles.seatName}>{SEAT_CHARACTERS[seat]}</span>
            <span className={styles.keys}>
              <kbd>{move}</kbd>
              <kbd>{action}</kbd>
            </span>
          </li>
        ))}
      </ul>

      {/* The hint text is the game's own, from its manifest under `packages/games` — the same
          strings the game's page renders, registered once in `lib/i18n/sources.ts` from
          `data/controls.ts`, so the id is the manifest string and the lookup is the same (#220). */}
      <Hint
        label={t(messages, 'Keys')}
        text={t(messages, manifest.controls.keyboard)}
        marked={used === 'keyboard'}
      />
      {/* The only thing that has ever decided whether a touch hint exists is whether the game
          declares one. It is emphatically not decided by what the player last used: a game
          with a pointer mapping keeps offering it to a player who has been typing, because
          the pointer mapping still works. */}
      {manifest.controls.pointer ? (
        <Hint
          label={t(messages, 'Touch')}
          text={t(messages, manifest.controls.pointer)}
          marked={used === 'pointer'}
        />
      ) : null}
    </div>
  );
}

/**
 * One hint line, marked or not.
 *
 * The mark is a word rather than a colour or a weight on its own, which is rule 7: the panel
 * has to say which instrument it is following in greyscale, on an e-ink screen and to a
 * player who cannot tell `--db-ink` from `--db-body`. The colour step is a second, redundant
 * channel and never the only one.
 */
function Hint({ label, text, marked }: { label: string; text: string; marked: boolean }) {
  const messages = useMessages();
  return (
    <div className={marked ? `${styles.row} ${styles.marked}` : styles.row}>
      <span className={styles.label}>
        {label}
        <span className={styles.mark}>{t(messages, 'in use')}</span>
      </span>
      <span className={styles.text}>{text}</span>
    </div>
  );
}
