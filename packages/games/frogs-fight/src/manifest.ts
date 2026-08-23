import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'frogs-fight',
  name: 'Frogs Fight',
  category: 'Party',
  archetype: 'rt-arena',
  // Square, and every lily pad on it sits opposite another through the centre — so the
  // pond is the same picture upside down and neither seat has an easier half of it.
  logical: { width: 800, height: 800 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 40,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'W A S D hops player one, the arrow keys player two — hold to keep hopping',
    pointer: 'Press anywhere in your own half and pull the way you want to hop',
  },
  tags: ['party', 'reflex'],
});
