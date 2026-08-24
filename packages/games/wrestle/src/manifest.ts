import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';
import { ARENA_HEIGHT, ARENA_WIDTH } from './rules.js';

export const manifest: GameManifest = parseGameManifest({
  id: 'wrestle',
  name: 'Wrestle',
  category: 'Arena',
  archetype: 'rt-arena',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Taken from the rules rather than repeated, so the simulation and the box it is drawn
  // in can never disagree. Both are logical units; neither is a pixel.
  logical: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
  // A side-on mat needs width to have anywhere to leap to.
  orientation: 'landscape',
  // One mat, both wrestlers on it at once, neither half of it owned by a seat.
  zoneSplit: 'shared-board',
  // The clock on a single round. Five of them at most; see SPEC.md.
  roundSeconds: 40,
  controls: {
    keyboard:
      'A and D lean for the near seat, left and right arrows for the far seat; Space and Enter leap',
    pointer:
      'Touch your half: left or right of your wrestler leans, and each fresh press is a leap',
  },
  tags: ['arena', 'physics'],
});
