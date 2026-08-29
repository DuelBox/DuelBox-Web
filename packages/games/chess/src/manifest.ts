import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'chess',
  name: 'Chess',
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
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: pick a square, lift and place',
    pointer: 'Tap a piece to lift it, then tap a dot to move there',
  },
  tags: ['strategy', 'classic'],
});
