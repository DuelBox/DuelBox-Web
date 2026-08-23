import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'archery',
  name: 'Archery',
  category: 'Shooter',
  archetype: 'turn-aim',
  // The boss stands at the far end and the shooting line at the near edge, so a half turn
  // of the board puts both exactly where the other archer needs them.
  logical: { width: 700, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one: W A S D to aim, hold Space to draw, let go to loose. Player two: arrows, Enter',
    pointer: 'Drag anywhere on the field to aim, hold to draw the bow, lift your finger to loose',
  },
  tags: ['aim', 'wind'],
});
