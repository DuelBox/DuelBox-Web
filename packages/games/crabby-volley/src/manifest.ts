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
    // Jumping is the action button, not W and not Up: the game reads `move.x` and
    // `actionHeld`, and nothing anywhere reads `move.y`. Offering W as the jump key sent
    // the left player pressing a key the game never looks at, and never told the right
    // player that Enter is the one that jumps at all.
    keyboard: 'A and D walk the left crab and Space jumps; arrow keys and Enter for the right crab',
    pointer: 'Drag on your half to move, tap to jump',
  },
  tags: ['sports', 'reflex'],
});
