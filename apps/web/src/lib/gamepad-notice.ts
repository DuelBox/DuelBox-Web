import type { GamepadEvent, SeatId } from '@duelbox/engine';
import { t, type Catalogue } from './i18n/messages';

/**
 * What the pause panel says when a controller comes or goes mid-match (#130).
 *
 * A pure function of the event and the two seat names, so the words are testable without a
 * canvas and so there is exactly one place they are chosen. Seats are named by their
 * players — "Ada's" rather than "the near seat" — because the person holding the pad that
 * just went dead is the one reading this, and a label they had to translate is a label read
 * twice.
 *
 * The three kinds are three sentences, and each one says what to do. A connect with no free
 * seat is the one case where the honest sentence is "nothing changed": the pad is plugged in
 * and drives nobody, and the swap button beside this is how it gets a seat.
 */
export function gamepadNotice(
  messages: Catalogue,
  event: GamepadEvent,
  names: Readonly<Record<SeatId, string>>,
): string {
  const who = event.seat === null ? null : names[event.seat];
  switch (event.kind) {
    case 'connected':
      return who === null
        ? t(
            messages,
            'A controller was plugged in, but both seats already have one. Swap it in below if it should drive a seat.',
          )
        : t(messages, "A controller was plugged in. It will drive {who}'s seat.", { who });
    case 'disconnected':
      return who === null
        ? t(messages, 'A controller was unplugged. It was not driving a seat.')
        : t(
            messages,
            "{who}'s controller was unplugged. That seat is back on the keyboard and touch until one is plugged in.",
            { who },
          );
    case 'reassigned':
      return who === null
        ? t(messages, 'The controllers were swapped.')
        : t(messages, "The controllers were swapped. {who}'s seat now has the other one.", { who });
  }
}
