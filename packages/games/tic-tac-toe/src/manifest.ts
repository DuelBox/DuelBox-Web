import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'tic-tac-toe',
  name: 'Tic Tac Toe',
  category: 'Board',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 60,
  controls: {
    keyboard: 'Arrow keys or W A S D to pick a square, Space or Enter to place your mark',
    pointer: 'Tap the square you want',
  },
  tags: ['classic', 'quick'],
});
