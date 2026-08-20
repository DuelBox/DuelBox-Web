import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'four-in-a-row',
  name: 'Drop Four',
  category: 'Board',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  controls: {
    keyboard: 'Player one A and D then Space, player two arrows then Enter: slide across and drop',
    pointer: 'Tap or drag over a column, release to drop',
  },
  tags: [],
});
