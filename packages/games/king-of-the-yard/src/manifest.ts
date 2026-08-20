import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'king-of-the-yard',
  name: 'King of the Yard',
  category: 'Arena',
  archetype: 'rt-arena',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  // One open yard both players move around at once.
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  controls: {
    keyboard: 'W A S D or the arrow keys to run',
    pointer: 'Drag anywhere to run that way',
  },
  tags: ['arena', 'chase'],
});
