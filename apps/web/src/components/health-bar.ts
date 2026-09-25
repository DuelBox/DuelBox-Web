import { seatRotated, type Presentation, type SeatId } from '@duelbox/engine';

/**
 * The pure model behind the health-bar HUD (#1753).
 *
 * Kept out of the component so it can be tested without a DOM, and so the one place that
 * decides "what does 0.2 health mean" is not a CSS class buried in a render. A game reports
 * a single value in [0, 1] and the bar is drawn from this; the game never owns the widget.
 */

export type HealthLevel = 'ok' | 'low' | 'critical';

/**
 * The thresholds at which the bar changes state.
 *
 * These drive a change of **shape and label**, not only colour (CLAUDE.md rule 7): at or
 * below `low` the bar carries a "Low" tag and a warning notch, at or below `critical` a
 * "Critical" tag and a denser hatch. In greyscale the level is still legible, which is the
 * acceptance criterion the issue names.
 */
export const LOW_THRESHOLD = 0.5;
export const CRITICAL_THRESHOLD = 0.2;

export interface HealthBarView {
  /** The reported value, clamped into [0, 1]; a non-finite report reads as empty, not full. */
  readonly value: number;
  /** The same value as a 0–100 width, so the component never does the arithmetic. */
  readonly percent: number;
  readonly level: HealthLevel;
}

export function healthBarView(value: number): HealthBarView {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const level: HealthLevel =
    clamped <= CRITICAL_THRESHOLD ? 'critical' : clamped <= LOW_THRESHOLD ? 'low' : 'ok';
  return { value: clamped, percent: clamped * 100, level };
}

/** The word shown beside the bar, so the state survives greyscale and reads at arm's length. */
export function healthLevelLabel(level: HealthLevel): string {
  switch (level) {
    case 'critical':
      return 'Critical';
    case 'low':
      return 'Low';
    case 'ok':
      return 'Healthy';
  }
}

/**
 * Whether a seat's bar is turned to face the player at the far side of a shared device.
 *
 * The same {@link seatRotated} the board flip and the scoreboard use, so a seat's health bar
 * turns exactly when its half of everything else does — and never in single-seat, where the
 * local player owns the whole viewport upright.
 */
export function healthBarRotated(
  seat: SeatId,
  presentation: Presentation,
  localSeat: SeatId = 'p1',
): boolean {
  return seatRotated(seat, presentation, localSeat);
}
