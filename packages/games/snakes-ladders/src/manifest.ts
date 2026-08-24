import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'snakes-ladders',
  name: 'Snakes and Ladders',
  category: 'Board',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  // Sixty-four fields with two dice a turn is about thirty turns each, and a turn is quick.
  roundSeconds: 150,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one: A and D pick a die, Space rolls and moves. Player two: arrow keys and Enter',
    pointer: 'Tap to roll, then tap the square you want to move to, or its die',
  },
  tags: ['board', 'dice', 'race'],
});
