import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'memory',
  name: 'Memory Match',
  category: 'Memory',
  // Two seats take turns on ONE table of cards: a turn-based shared board, not a
  // real-time split, and neither half of the screen belongs to a seat.
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Four columns of four cards, with a score line above and a status line below.
  logical: { width: 800, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 60,
  controls: {
    keyboard: 'Arrow keys or W A S D to move between cards, Space or Enter to turn one over',
    pointer: 'Tap a card to turn it over',
  },
  tags: [],
});
