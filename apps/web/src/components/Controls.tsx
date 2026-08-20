import type { GameManifest } from '@duelbox/game-sdk';
import { seatColour } from '@/styles/tokens';
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
/**
 * Which keys belong to which seat, from the engine's own defaults.
 *
 * Written out rather than described, because "W A S D or the arrow keys" tells a player
 * what the game accepts and not what is *theirs* — and two strangers sitting down at one
 * laptop need the second thing far more than the first.
 */
const SEAT_KEYS: readonly { seat: 'p1' | 'p2'; move: string; action: string }[] = [
  { seat: 'p1', move: 'W A S D', action: 'Space' },
  { seat: 'p2', move: '↑ ← ↓ →', action: 'Enter' },
];

export function Controls({ manifest }: { manifest: GameManifest }) {
  return (
    <div className={styles.controls}>
      <span className={styles.title}>Controls</span>

      <ul className={styles.seats}>
        {SEAT_KEYS.map(({ seat, move, action }) => (
          <li key={seat} className={styles.seat}>
            <SeatGlyph seat={seat} />
            <span className={styles.seatName}>{seatColour[seat].name}</span>
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
