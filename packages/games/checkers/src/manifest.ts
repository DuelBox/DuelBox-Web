import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'checkers',
  name: 'Checkers',
  category: 'Board',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Square, because the board is. The shell letterboxes it to whatever it is given.
  logical: { width: 900, height: 900 },
  orientation: 'any',
  // One board both players reach across, so it rotates to face whoever is to move.
  zoneSplit: 'shared-board',
  roundSeconds: 300,
  controls: {
    keyboard: 'Arrow keys or W A S D to pick a square, Space or Enter to lift and place',
    pointer: 'Tap a piece, then tap where it goes',
  },
  tags: ['strategy', 'classic'],
});
