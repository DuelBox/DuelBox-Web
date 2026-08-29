import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'disco-battle',
  name: 'Disco Battle',
  category: 'Rhythm',
  archetype: 'rt-split',
  // Two lanes running out from the middle of the device to a platform at each end, so both
  // players read their own notes coming *towards* them. Portrait, because the lane is the
  // long axis and a horizontal split gives each seat a full-width band under its own thumb.
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // The track in `rules.ts` is exactly 40 seconds — a fixed multiset of gaps, shuffled, so
  // its length cannot vary with the seed — and this is the same 40, asserted by a test.
  // `roundSeconds` ends nothing; it is text on a catalogue card, and the two are only equal
  // because somebody keeps them equal.
  roundSeconds: 40,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Space is player one, Enter is player two. One press as the note lands.',
    pointer: 'Tap anywhere in your own half as the note lands on your platform.',
  },
  tags: ['rhythm', 'timing', 'reflex'],
  // Deliberately **not** `sameInputClassOnly`, and this is the archetype with the least to
  // argue about. The entire control surface is one binary press with a timestamp, identical
  // on a key, a trackpad and a thumb; there is no continuous quantity anywhere in the game
  // for one instrument to be finer at. See SPEC.md, "Fairness across input families".
  sameInputClassOnly: false,
});
