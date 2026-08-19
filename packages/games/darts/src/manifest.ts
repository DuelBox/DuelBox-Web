import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'darts',
  name: 'Darts',
  category: 'Sports',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'W A S D or the arrow keys to move the sight, Space or Enter to throw',
    pointer: 'Drag the circle at the bottom to aim, release to throw',
  },
  tags: ['classic', 'aim'],
});
