import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'knife-thrower',
  name: 'Knife Thrower',
  category: 'Shooter',
  archetype: 'turn-aim',
  // The log sits at the centre and the throwing hand at the near edge, so a half-turn of
  // the board puts both exactly where the other player needs them.
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
    keyboard: 'Space throws for player one, Enter for player two — on your turn only',
    pointer: 'Tap anywhere on your turn to throw. There is nothing to aim; pick the moment',
  },
  tags: ['aim', 'timing'],
});
