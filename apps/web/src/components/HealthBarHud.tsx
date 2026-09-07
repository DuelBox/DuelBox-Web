'use client';

import type { Presentation, SeatId } from '@duelbox/engine';
import { healthBarRotated, healthBarView, healthLevelLabel } from './health-bar';
import { SeatGlyph } from './SeatGlyph';
import styles from './HealthBarHud.module.css';

/**
 * A per-seat health bar, one of the shell's shared HUD pieces (#1753).
 *
 * Health-based games need a bar each player can read from their own side, in their own
 * colour, without it being colour-only (CLAUDE.md rule 7). A game reports a single value in
 * [0, 1] and this draws it; the game never owns the widget, so forty-five games cannot grow
 * forty-five slightly different bars.
 *
 * The seat's colour is one signal and never the only one: the bar carries the seat's glyph,
 * a state word ("Healthy" / "Low" / "Critical") and a `data-level` the stylesheet turns into
 * a hatch and a notch, so the reading survives greyscale and a colour-blind player. The fill
 * transitions smoothly with the reported value, and a drop pulses once as a non-colour damage
 * cue that reduced motion switches off.
 */
export interface HealthBarHudProps {
  seat: SeatId;
  /** The seat's health in [0, 1]; clamped, and a non-finite report reads as empty. */
  value: number;
  /** What this seat is called, for the announced label. */
  name: string;
  presentation?: Presentation;
  /** The seat sitting at the bottom of the device; defaults to p1. */
  localSeat?: SeatId;
}

export function HealthBarHud({
  seat,
  value,
  name,
  presentation = 'shared-screen',
  localSeat = 'p1',
}: HealthBarHudProps) {
  const view = healthBarView(value);
  const rotated = healthBarRotated(seat, presentation, localSeat);
  const percent = Math.round(view.percent);
  return (
    <div
      className={[styles.bar, rotated ? styles.rotated : ''].join(' ')}
      data-seat={seat}
      data-level={view.level}
      role="img"
      aria-label={`${name} health: ${healthLevelLabel(view.level)}, ${String(percent)} percent`}
    >
      <SeatGlyph seat={seat} size={16} />
      <div className={styles.track}>
        {/* The width is the smooth part; the hatch under `data-level` is the non-colour one. */}
        <div className={styles.fill} style={{ width: `${String(view.percent)}%` }} />
      </div>
      <span className={styles.tag}>{healthLevelLabel(view.level)}</span>
    </div>
  );
}
