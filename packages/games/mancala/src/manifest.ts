import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'mancala',
  name: 'Mancala Pits',
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
    keyboard: 'Player one A and D then Space, player two arrows then Enter: pick a pit and sow it',
    pointer: 'Tap one of your own pits to sow it',
  },
  tags: ['classic', 'strategy'],
});
