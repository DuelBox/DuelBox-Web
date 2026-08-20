import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'mini-soccer',
  name: 'Mini Soccer',
  category: 'Sports',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 1000, height: 640 },
  orientation: 'landscape',
  // One pitch, two ends. Both players roam all of it.
  zoneSplit: 'vertical',
  roundSeconds: 90,
  controls: {
    keyboard: 'W A S D for the left seat, arrow keys for the right seat, to run',
    pointer: 'Drag anywhere to run that way',
  },
  tags: ['sports', 'arena'],
});
