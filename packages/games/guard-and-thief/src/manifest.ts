import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'guard-and-thief',
  name: 'Guard and Thief',
  category: 'Stealth',
  archetype: 'rt-split',
  // Two vaults stacked, one per seat, half-turn images of one another. Portrait, so each
  // player's own floor is a full-width band directly under their own thumb — which is what
  // makes a press reachable even though a runner is not.
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  // Declared honestly rather than aspirationally. The play *area* is shared — a runner's
  // whole job is to cross into the other half — but `GameHost` gives each seat only its
  // own band to *start* a gesture in, and that is what the pointer idiom has to live
  // inside. Saying `shared-board` here would change nothing in the shell (it maps every
  // non-vertical real-time game to a horizontal split) and would misdescribe the game.
  zoneSplit: 'horizontal',
  // The clock in `rules.ts` is 60 seconds and this is the same 60, asserted by a test.
  // `roundSeconds` ends nothing — it is text on a catalogue card — so the two are only
  // equal because somebody keeps them equal. Here it is also the *whole* win condition:
  // the catalogue row says "whoever has more coins at the end of the match wins", so the
  // end of the match is the only ending there is.
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  //
  // There is no action key. Space and Enter do nothing here on purpose: `actionHeld` is
  // `keys.action || pointerDown`, so a finger on the glass *is* the action, and binding
  // anything to it would ask one instrument for a signal the other cannot send without
  // also stopping. Running and stopping are the whole vocabulary.
  controls: {
    keyboard: "W A S D run the near seat's runner and the arrow keys run the far seat's.",
    pointer: 'Press anywhere on your own half and drag the way you want to run.',
  },
  tags: ['stealth', 'chase', 'collect'],
  // Deliberately **not** `sameInputClassOnly`. A heading here is one of nine values and
  // there is no second verb at all, so no instrument names a quantity another cannot and
  // nothing in the game rewards pressing quickly. See SPEC.md, "Fairness across input
  // families".
  sameInputClassOnly: false,
});
