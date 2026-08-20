import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'dots-and-boxes',
  name: 'Dots and Boxes',
  category: 'Board',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  controls: {
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: move between lines and draw one',
    pointer: 'Tap the line you want to draw',
  },
  tags: ['classic', 'strategy'],
});
