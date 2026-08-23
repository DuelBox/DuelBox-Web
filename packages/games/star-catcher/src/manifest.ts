import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'star-catcher',
  name: 'Star Catcher',
  category: 'Party',
  archetype: 'rt-split',
  // Two skies, one above the other. Portrait, so each is a wide band the player faces.
  logical: { width: 640, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'W A S D steers the near net, the arrow keys the far one — mind the black holes',
    pointer: 'Drag anywhere in your own half; your net follows your finger and cannot outrun it',
  },
  tags: ['party', 'reflex'],
});
