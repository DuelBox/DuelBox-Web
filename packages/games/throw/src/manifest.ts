import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'throw',
  name: 'Snowball Throw',
  category: 'Party',
  archetype: 'rt-split',
  // One field, seen from above, with a thrower at each end. Portrait, so each player's own
  // line is a full-width band directly under their own thumb — which is what lets the
  // pointer binding be absolute (`docs/input-idiom.md`, `rt-split`).
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // The clock in `rules.ts` is 90 seconds and this is the same 90, asserted by a test.
  // `roundSeconds` ends nothing — it is text on a catalogue card — so the two are only
  // equal because somebody keeps them equal.
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'A and D walk the near thrower; the arrow keys walk the far one. Space and Enter throw.',
    pointer:
      'Hold a finger in your own half and your thrower walks to it; lift to throw, leaning as you walk.',
  },
  tags: ['party', 'reflex', 'aim'],
  // Deliberately **not** `sameInputClassOnly`. A throw here carries two discrete values —
  // one of three sizes and one of three leans — on top of a rate-limited position, and
  // nothing in the game asks anybody to name a continuous quantity or to press faster than
  // about 1.7 times a second. See SPEC.md, "Fairness across input families".
  sameInputClassOnly: false,
});
