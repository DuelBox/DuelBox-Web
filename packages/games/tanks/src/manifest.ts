import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'tanks',
  name: 'Tanks',
  category: 'Shooter',
  archetype: 'rt-arena',
  // Square, and every crate on it sits opposite another through the centre — so the yard
  // is the same picture upside down and neither seat has an easier half of it.
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
    keyboard:
      'W A S D drives player one — A D swing, W S roll — and the arrow keys player two; let go to fire',
    pointer:
      'Hold in your own half and pull: sideways swings the gun, away rolls. Let go and it fires',
  },
  tags: ['arena', 'shooter'],
});
