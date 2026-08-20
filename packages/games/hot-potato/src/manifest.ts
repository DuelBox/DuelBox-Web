import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'hot-potato',
  name: 'Hot Potato',
  category: 'Party',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  // One potato, one fuse, one bar — but each seat acts only when it is holding it.
  zoneSplit: 'horizontal',
  roundSeconds: 90,
  controls: {
    keyboard: 'Space or Enter to throw when the marker crosses the band',
    pointer: 'Tap your half when the marker crosses the band',
  },
  tags: ['timing', 'party'],
});
