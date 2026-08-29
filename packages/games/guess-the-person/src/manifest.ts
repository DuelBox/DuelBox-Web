import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'guess-the-person',
  name: 'Guess Who',
  category: 'Deduction',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  // Twenty-seven characters, nine questions, and a measured mean of about 22 seconds of
  // play at equal skill. Advertising text on the catalogue card: it ends nothing, and the
  // bound that does is the candidate count in rules.ts.
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Player one W A S D then Space, player two the arrows then Enter: pick a slot',
    pointer: 'Tap a question along the foot of the board, or tap a character to name it',
  },
  tags: ['board', 'deduction', 'hidden-information'],
});
