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
    keyboard: 'Arrow keys or W A S D to move between the lines, Space or Enter to draw one',
    pointer: 'Tap the line you want to draw',
  },
  tags: ['classic', 'strategy'],
});
