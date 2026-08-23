import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'wheelie',
  name: 'Wheelie',
  category: 'Racing',
  // Two lanes, one above the other. Portrait, so each is a wide strip the player faces and
  // each sees exactly the same amount of course ahead of their own bike (rule 9).
  logical: { width: 640, height: 1000 },
  archetype: 'rt-race',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 75,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'W A S D leans player one, the arrow keys player two — up lifts the front wheel',
    pointer: 'Hold your thumb high in your own half to lean back, low to put the wheel down',
  },
  tags: ['racing', 'balance'],
});
