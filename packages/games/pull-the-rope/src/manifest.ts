import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'pull-the-rope',
  name: 'Pull the Rope',
  category: 'Party',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 60,
  controls: {
    keyboard: 'Tap Space for the near seat, Enter for the far seat, as fast as you can',
    pointer: 'Tap your half of the screen as fast as you can',
  },
  tags: [],
});
