import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'slot-cars',
  name: 'Slot Cars',
  category: 'Racing',
  archetype: 'rt-race',
  // One circuit, drawn once, with both cars on it. Portrait, so the two players sit either
  // side of it and each has their own gauge along their own edge.
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 75,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Hold Space for player one, Enter for player two — let go before the bends',
    pointer: 'Hold anywhere in your own half for power. Let go to slow down for a corner',
  },
  tags: ['racing', 'timing'],
});
