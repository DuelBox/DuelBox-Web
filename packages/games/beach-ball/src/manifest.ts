import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'beach-ball',
  name: 'Beach Ball',
  category: 'Sports',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Seen from above, one half of the sand each. Portrait, so the net runs across the device
  // between the two people and each half is exactly as deep as the other.
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // The rules call the match at 180 s; this is what the catalogue card advertises, and three
  // points lands between fifteen and forty-five seconds at every tier — measured, see SPEC.md.
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec — and it names which
  // half of the keyboard belongs to which player, because the two halves are two people.
  controls: {
    keyboard: 'W A S D runs the near player, the arrow keys the far one — get under the ball',
    pointer: 'Drag in your own half; your player runs to your finger and returns what it reaches',
  },
  tags: ['sports', 'reflex'],
  // Nothing here rewards a mouse over a thumb: both instruments ask a player to run, at the
  // same speed limit, and the shot is decided by where you are standing when the ball
  // arrives rather than by any aiming gesture. See `movePlayer` in rules.ts.
  sameInputClassOnly: false,
});
