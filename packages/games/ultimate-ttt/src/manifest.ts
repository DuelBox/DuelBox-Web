import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'ultimate-ttt',
  name: 'Ultimate Tic Tac Toe',
  category: 'Board',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: move between squares and place',
    pointer: 'Tap a square in the highlighted board',
  },
  tags: ['strategy', 'deep'],
});
