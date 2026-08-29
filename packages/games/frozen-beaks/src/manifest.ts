import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'frozen-beaks',
  name: 'Frozen Beaks',
  category: 'Party',
  archetype: 'rt-split',
  // Two ice floes stacked, one per seat. Portrait, so each player's own floe is a
  // full-width band directly under their own thumb — which is what lets the pointer
  // binding be absolute (`docs/input-idiom.md`, `rt-split`).
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
  //
  // There is no action key. Space and Enter do nothing here on purpose: `actionHeld` is
  // `keys.action || pointerDown`, so binding anything to it would give a keyboard player
  // a signal a finger cannot send without also stopping the walk. Walking and letting go
  // of the walk are the whole vocabulary, and both instruments spell them the same way.
  controls: {
    keyboard: 'W A S D walk the near bird and the arrow keys walk the far one; let go to slide.',
    pointer: 'Hold a finger on your own floe and your bird walks to it; lift it to slide.',
  },
  tags: ['party', 'reflex', 'collect'],
  // Deliberately **not** `sameInputClassOnly`. A heading here is one of nine values and a
  // slide is one of three, so no instrument names a quantity another cannot, and the
  // fastest useful cadence is 0.76 releases a second against the two-a-second ceiling
  // `docs/input-idiom.md` sets. See SPEC.md, "Fairness across input families".
  sameInputClassOnly: false,
});
