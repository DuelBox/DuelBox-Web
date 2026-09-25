import { otherSeat, seatRotated, type Presentation, type SeatId } from '@duelbox/engine';

/**
 * One rendered copy of the pre-match countdown, and whether it is turned to face its seat.
 *
 * The countdown was a single centred number "stated upright" that was upright for exactly
 * one of the two people sharing the device (#142). Two seats sit on opposite sides, so the
 * count reads upside down for whoever is at the top — the same problem the scoreboard solved
 * by rendering itself twice, once turned. This is that answer for the count-in.
 */
export interface CountdownView {
  readonly seat: SeatId;
  /** True for the seat reading the device upside down; drawn with the rotate-180 pattern. */
  readonly rotated: boolean;
}

/**
 * The copies of the countdown to render, in reading order for the local seat first.
 *
 * In shared-screen there are two — the local seat upright and the far seat turned to face
 * them — reusing the engine's own {@link seatRotated}, the single source of "does this seat
 * read the device upside down" the board flip and the HUD already share. In single-seat
 * there is one, upright, because there is nobody at the other end of the device (see
 * `docs/presentation.md`).
 *
 * The local seat is always first so the announced, upright copy is the one assistive
 * technology and the layout reach first; the turned copy is decorative and `aria-hidden`,
 * exactly as the flipped HUD is.
 */
export function countdownViews(
  presentation: Presentation,
  localSeat: SeatId = 'p1',
): readonly CountdownView[] {
  const near: CountdownView = {
    seat: localSeat,
    rotated: seatRotated(localSeat, presentation, localSeat),
  };
  if (presentation === 'single-seat') return [near];
  const far = otherSeat(localSeat);
  return [near, { seat: far, rotated: seatRotated(far, presentation, localSeat) }];
}
