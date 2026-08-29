import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'sticky-tongues',
  name: 'Sticky Tongues',
  category: 'Party',
  archetype: 'rt-split',
  // One marsh stacked into two banks, one per seat, with the dragonflies in the middle.
  // Portrait, so each player's own bank is a full-width band directly under their own
  // thumb — which is what lets the pointer binding be absolute (`docs/input-idiom.md`,
  // `rt-split`).
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // The clock in `rules.ts` is 100 seconds and this is the same 100, asserted by a test.
  // `roundSeconds` ends nothing — it is text on a catalogue card — so the two are only
  // equal because somebody keeps them equal.
  roundSeconds: 100,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  //
  // The pointer line teaches the separation rather than describing only one half of it,
  // because a finger that presses to move would otherwise flick a tongue every time it
  // began to steer — the fault `docs/input-idiom.md` records against tennis and wrestle.
  controls: {
    keyboard:
      'W A S D hop the near frog and Space flicks its tongue; the arrow keys and Enter do ' +
      'the same for the far seat.',
    pointer: 'Hold and drag inside your own half to hop; a quick tap flicks your tongue.',
  },
  tags: ['party', 'reflex', 'duel'],
  // Deliberately **not** `sameInputClassOnly`. A heading here is one of nine values and a
  // shot is one binary event with a timestamp, so no instrument names a quantity another
  // cannot, and the shot cycle caps the cadence at 1.33 a second against the two-a-second
  // ceiling `docs/input-idiom.md` sets. See SPEC.md, "Fairness across input families".
  sameInputClassOnly: false,
});
