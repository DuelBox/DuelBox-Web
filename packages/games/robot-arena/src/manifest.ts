import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'robot-arena',
  name: 'Robot Arena',
  category: 'Survival',
  archetype: 'rt-arena',
  // Square, and every hazard in it is symmetric about the centre — so the board is the
  // same picture upside down, and neither seat has an easier half.
  logical: { width: 900, height: 900 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 40,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'W A S D runs player one, the arrow keys player two — there is nothing to fire',
    pointer: 'Hold anywhere in your own half and pull the way you want to run',
  },
  tags: ['survival', 'reflex'],
});
