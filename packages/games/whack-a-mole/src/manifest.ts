import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'whack-a-mole',
  name: 'Whack a Mole',
  category: 'Reaction',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  // Both seats' moles rise from the same twelve holes and either seat may swing at any
  // of them, so the board is common ground rather than two halves.
  zoneSplit: 'shared-board',
  roundSeconds: 60,
  controls: {
    keyboard: 'W A S D or arrow keys to pick a hole, Space or Enter to strike',
    pointer: 'Tap a mole the moment it appears',
  },
  tags: [],
});
