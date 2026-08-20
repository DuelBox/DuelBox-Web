import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'crabby-volley',
  name: 'Crabby Volley',
  category: 'Sports',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // The court is wide: two halves side by side with a net between them.
  logical: { width: 1000, height: 620 },
  orientation: 'landscape',
  zoneSplit: 'vertical',
  roundSeconds: 120,
  controls: {
    keyboard: 'A and D or the arrow keys to move, W or Space to jump',
    pointer: 'Drag on your half to move, tap to jump',
  },
  tags: ['sports', 'reflex'],
});
