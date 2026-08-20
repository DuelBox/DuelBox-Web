import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'color-wars',
  name: 'Colour Wars',
  category: 'Board',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 240,
  controls: {
    keyboard: 'Arrow keys or W A S D to pick a cell, Space or Enter to add a dot',
    pointer: 'Tap an empty cell or one of your own',
  },
  tags: ['strategy', 'chain-reaction'],
});
