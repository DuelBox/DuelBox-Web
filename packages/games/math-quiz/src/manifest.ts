import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'math-quiz',
  name: 'Math Duel',
  category: 'Reaction',
  archetype: 'rt-split',
  // Two panels, one above the other, each holding a sum and a diamond of four answers.
  logical: { width: 640, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'W A S D pick the four answers for player one, the arrow keys for player two',
    pointer: 'Tap the answer you want in your own half. A wrong one scores for the other player',
  },
  tags: ['reaction', 'brain'],
});
