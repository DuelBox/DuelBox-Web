import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'cup-pong',
  name: 'Cup Pong',
  category: 'Sports',
  // The table turns to face whoever is throwing, so both racks sit on the centre line and
  // the geometry is one shape mirrored, whichever way up it is read.
  archetype: 'turn-aim',
  logical: { width: 700, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Space is player one, Enter is player two — press once for the line, once for the throw',
    pointer: 'Tap on your turn to stop the marker. Twice: once for the line, once for the throw',
  },
  tags: ['aim', 'timing'],
});
