import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'ballgames-physics',
  name: 'Ball Games',
  category: 'Sports',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  // One pitch, two ends, both players roaming all of it. The split divides the *pointer
  // surface* so a touch belongs to whoever it came from; it does not divide the pitch.
  zoneSplit: 'horizontal',
  roundSeconds: 90,
  controls: {
    keyboard: 'W A S D for the near seat, arrow keys for the far seat, to run at the ball',
    pointer: 'Touch down in your own half and drag: your player runs towards your finger',
  },
  tags: ['sports', 'physics', 'arena'],
});
