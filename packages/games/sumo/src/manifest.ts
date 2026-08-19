import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'sumo',
  name: 'Sumo Push',
  category: 'Arena',
  archetype: 'rt-arena',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 800, height: 800 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 40,
  tags: [],
});
