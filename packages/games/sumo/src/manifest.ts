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
  controls: {
    keyboard: 'W A S D for the near seat, arrow keys for the far seat, to push',
    pointer: 'Drag from your wrestler in the direction you want to push',
  },
  tags: [],
});
