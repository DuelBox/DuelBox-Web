import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'sling-puck',
  name: 'Sling Puck',
  category: 'Sports',
  // The board turns to face whoever is shooting, so both halves are the same geometry the
  // same way up and no seat ever aims across a board it is reading upside down.
  archetype: 'turn-aim',
  logical: { width: 640, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  controls: {
    keyboard:
      'Space is player one, Enter is player two — press once for the line, once for the strength',
    pointer: 'Tap on your turn: once to set the line, once to set the strength',
  },
  tags: ['aim', 'timing', 'physics'],
});
