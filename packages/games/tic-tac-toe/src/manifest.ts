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
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: pick a square and place your mark',
    pointer: 'Tap the square you want',
  },
  tags: ['classic', 'quick'],
});
