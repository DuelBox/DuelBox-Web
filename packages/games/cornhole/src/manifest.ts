import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'cornhole',
  name: 'Cornhole',
  category: 'Sports',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 240,
  controls: {
    keyboard:
      'Player one A and D then hold Space, player two arrows then hold Enter: aim, build power, release',
    pointer: 'Drag to aim and pull back for power, release to throw',
  },
  tags: ['aim', 'sports'],
});
