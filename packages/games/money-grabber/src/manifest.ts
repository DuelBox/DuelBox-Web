import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'money-grabber',
  name: 'Money Grabber',
  category: 'Party',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // One table down the middle of a portrait board with a safe at each end. Both players read
  // the same felt the same way up, so nothing is ever turned except one seat's own tally.
  // 600 x 900 also puts a whole number of precision-lattice cells on both axes, so a half-turn
  // maps the engine's input lattice onto itself (see presentation-parity's latticeSurvivesTurn).
  logical: { width: 600, height: 900 },
  orientation: 'portrait',
  // Real-time, so the pointer surface is genuinely divided: a gesture belongs to the seat
  // whose half of the device it started in, and both players grab at once.
  zoneSplit: 'horizontal',
  // Advertising text on the catalogue card, and it ends nothing anywhere in this repository.
  // What actually ends a match is the pile running out, with `MATCH_SECONDS` in rules.ts as
  // the backstop. Measured over 18000 bot matches: 20.3 s at `easy`, 19.6 s at `normal`,
  // 23.4 s at `hard`. Two people are slower than any of them.
  roundSeconds: 35,
  // Required, and deliberately not optional: the shell shows this before the match and again
  // from the pause menu, so a game without it would advertise nothing to a player holding a
  // keyboard. Written for a player rather than as a spec.
  //
  // Neither line mentions an action key, and that is the game rather than an omission: a hand
  // grips whatever it is over and empties itself in its own safe, so steering is the whole
  // interaction. See SPEC.md, "The multi-touch problem, and what was done about it".
  controls: {
    keyboard: 'W A S D move the near player’s hand; the arrow keys move the far player’s hand',
    pointer:
      'Hold a finger on your own half and slide — your hand follows it and grabs what it covers',
  },
  // Deliberately **not** `sameInputClassOnly`. The catalogue row says "all the fingers of your
  // hand", and ten fingers is the one thing this engine does not hand a game: `SeatInputView`
  // carries a single nullable pointer per seat and `pointerCount` never leaves `input.ts`. So
  // the choice was never "multi-touch or fair" — multi-touch is not buildable at the game
  // layer at all. What is left is a hand that chases a place at a rate, which a thumb, a
  // mouse, a trackpad and a held key all express identically, and `docs/input-idiom.md` rules
  // steering-towards-a-place fair. SPEC.md argues all three routes and shows the measurement.
  sameInputClassOnly: false,
  tags: ['party', 'reflex'],
});
