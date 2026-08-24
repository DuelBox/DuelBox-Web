import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'crash-it',
  name: 'Crash It',
  category: 'Racing',
  archetype: 'rt-race',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // The box each seat reads half of. One 600 x 430 pit is drawn into both halves, so the
  // two players are looking at the same cars in the same places from opposite sides of the
  // device — neither can see a corner the other cannot (CLAUDE.md rule 9).
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // The measured median of 900 seeded bot matches — 17.4 s, 18.8 s and 29.4 s by tier — not
  // the scaffold's guess. `ROUND_SECONDS` and `MATCH_SECONDS` in the rules are what actually
  // end a match; this prints a number on a catalogue card and ends nothing.
  roundSeconds: 20,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one drives with A and D, jumping with W or Space. Player two, on the arrow keys, jumps with Up or Enter.',
    pointer:
      'Hold in your own half where you want your car: it drives to your finger, and a flick towards the middle jumps.',
  },
  tags: ['cars', 'physics', 'duel'],
});
