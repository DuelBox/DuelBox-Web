import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'four-in-a-row',
  name: 'Drop Four',
  category: 'Board',
  archetype: 'turn-board',
  modes: ["friend","bot"],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  tags: [],
});
