import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'pop-it',
  name: 'Pop It',
  category: 'Puzzle',
  // Turn by turn, not real time. The catalogue had it as `rt-split`, which the rule it
  // ships with contradicts in its first three words — "players take turns".
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 180,
  controls: {
    keyboard: 'Arrow keys to pick a bubble, Space or Enter to start and end a run',
    pointer: 'Drag across the bubbles you want to press',
  },
  tags: ['strategy', 'classic'],
});
