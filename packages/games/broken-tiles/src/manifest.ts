import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'broken-tiles',
  name: 'Broken Tiles',
  category: 'Party',
  archetype: 'rt-split',
  // Two floors, one above the other, each seven by seven. Portrait so both are square.
  logical: { width: 640, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'W A S D skates the near player, the arrow keys the far one — keep moving',
    pointer: 'Hold in your own half and pull the way you want to skate. Standing still costs ice',
  },
  tags: ['survival', 'party'],
});
