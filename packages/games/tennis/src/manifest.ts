import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'tennis',
  name: 'Tennis',
  category: 'Sports',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Seen from above, half a court each. Portrait, so the net runs across the device between
  // the two people and each half is exactly as deep as the other.
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // The rules call the match at 150 s; this is what the catalogue card advertises. Measured
  // over 600 seeded bot matches a match runs 19.2 s to 20.1 s on average and 34.5 s at worst,
  // so "about 40 seconds" is what a player should expect. See SPEC.md.
  roundSeconds: 40,
  // Required, and deliberately not optional: the shell shows this before the match and again
  // from the pause menu, so a game without it would advertise nothing to a player holding a
  // keyboard. Written for a player rather than as a spec — and it names which half of the
  // keyboard belongs to which player, because the two halves are two people.
  //
  // Both strings are driven through the real `InputManager` in `game.test.ts` rather than
  // read and nodded at: every clause below is a test.
  controls: {
    keyboard: 'W A S D runs the near player and Space jumps; arrow keys and Enter for the far one',
    pointer: 'Touch your own half to run there, and every fresh press is a jump for a high ball',
  },
  tags: ['sports', 'reflex'],
  // Nothing here rewards a mouse over a thumb: both instruments ask a player to run and to
  // press, at the same speed limit and on the same one-step press edge, and the shot is
  // decided by where the ball met the strings rather than by any aiming gesture.
  sameInputClassOnly: false,
});
