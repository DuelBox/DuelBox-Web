import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'air-hockey',
  name: 'Air Hockey',
  category: 'Sports',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 90,
  controls: {
    keyboard: 'W A S D for the near seat, arrow keys for the far seat, to move your mallet',
    pointer: 'Drag your mallet anywhere in your half',
  },
  tags: ['physics', 'fast'],
});
