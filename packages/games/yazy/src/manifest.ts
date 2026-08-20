import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'yazy',
  name: 'Dice Yatzy',
  category: 'Dice',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  // Thirteen turns each, three rolls a turn, and a scoresheet to think about.
  roundSeconds: 420,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: keep dice, roll, pick a box',
    pointer: 'Tap a die to keep it, tap Roll, then tap the box to spend the hand in',
  },
  tags: ['dice', 'scoresheet'],
});
