import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'ludo',
  name: 'Ludo Dash',
  category: 'Board',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  // A race decided by the die, and it does not take long.
  roundSeconds: 150,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: roll, pick a token, move it',
    pointer: 'Tap to roll, then tap the token you want to move',
  },
  tags: ['board', 'dice'],
});
