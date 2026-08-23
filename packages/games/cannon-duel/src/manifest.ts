import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'cannon-duel',
  name: 'Cannon Duel',
  category: 'Shooter',
  // The board turns to face whoever is firing, so both cannons sit on the centre line and
  // the geometry is identical either way up.
  archetype: 'turn-aim',
  logical: { width: 700, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Space is player one, Enter is player two — press once for angle, once for power',
    pointer: 'Tap on your turn to stop the needle. Twice: once for angle, once for power',
  },
  tags: ['aim', 'timing'],
});
