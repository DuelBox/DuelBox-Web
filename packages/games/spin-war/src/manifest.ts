import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'spin-war',
  name: 'Spin War',
  category: 'Arena',
  archetype: 'rt-arena',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Square, and the bowl sits dead centre in it, so the board is the same picture upside
  // down and neither seat has the easier half.
  logical: { width: 800, height: 800 },
  orientation: 'any',
  // One dish both tops move around at once.
  zoneSplit: 'shared-board',
  roundSeconds: 40,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec — and true of what the
  // code does, which is the part that keeps getting shipped wrong.
  controls: {
    keyboard: 'W A S D steers player one, the arrow keys player two — there is no other key',
    pointer:
      'Start on your own side of the bowl and your top drives at your finger, wherever you take it',
  },
  tags: ['arena', 'push-out'],
});
