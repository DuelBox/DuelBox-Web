import type { GameManifest } from '@duelbox/game-sdk';
import { SEAT_CHARACTERS, SEAT_KEYS } from '@/lib/seats';
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
 */
export function Controls({ manifest }: { manifest: GameManifest }) {
  return (
    <div className={styles.controls}>
      <span className={styles.title}>Controls</span>

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

      <div className={styles.row}>
        <span className={styles.label}>Keys</span>
        <span className={styles.text}>{manifest.controls.keyboard}</span>
      </div>
      {manifest.controls.pointer ? (
        <div className={styles.row}>
          <span className={styles.label}>Touch</span>
          <span className={styles.text}>{manifest.controls.pointer}</span>
        </div>
      ) : null}
    </div>
  );
}
