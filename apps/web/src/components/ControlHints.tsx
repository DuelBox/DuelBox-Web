'use client';

import type { SeatId } from '@duelbox/engine';
import { SeatGlyph } from './SeatGlyph';
import styles from './ControlHints.module.css';

/**
 * Which half of the screen is yours, said once, for five seconds (#137).
 *
 * The observed failure this exists for is not a player who cannot work out the controls. It
 * is a player who does not know **which half of the device is theirs** in the first five
 * seconds of their first game — two people either side of one screen, one board, and nothing
 * on it saying who owns which end.
 *
 * `lib/control-hints.ts` has held the "once per game per device" memory since it was written
 * and, like `key-bindings.ts` before #2550, **nothing imported it**. This component and the
 * `onSeatInput` callback in `GameHost` are the missing consumer.
 *
 * ## Three properties, and each is a rule rather than a preference
 *
 * **It cannot obstruct an interactive area.** `pointer-events: none` on the layer, so a tap
 * that lands on a hint reaches the board underneath it. That is the acceptance criterion, and
 * it is the only version of it that survives a game whose whole surface is interactive —
 * "put it somewhere nothing is" has no answer on a full-bleed board.
 *
 * **The far seat's hint is upside down, like everything else it reads.** Two people sit on
 * opposite sides; a label the far player has to walk around the table to read is worse than
 * no label. The same 180° the HUD already takes.
 *
 * **It fades on that seat's first *successful* input, per seat.** Not on a timer, and not on
 * both at once: a player who has started moving does not need to be told where they are, and
 * a player who has not still does. What counts as successful is the state the game was handed
 * — a key the shell swallowed or a touch that began in the other seat's zone is not this seat
 * playing, and `GameHost` is where that is decided.
 */
export function ControlHints({
  names,
  used,
}: {
  /** What each seat is called, from `seatNamesFor` — never a second spelling. */
  names: Readonly<Record<SeatId, string>>;
  /** The seats that have already played, and whose hint is therefore gone. */
  used: Readonly<Record<SeatId, boolean>>;
}) {
  return (
    <div className={styles.layer} aria-hidden="true">
      {(['p2', 'p1'] as const).map((seat) => (
        <p
          key={seat}
          className={styles.hint}
          data-hint-seat={seat}
          data-gone={used[seat] || undefined}
        >
          <SeatGlyph seat={seat} size={18} />
          {names[seat]} plays this half
        </p>
      ))}
    </div>
  );
}
