import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'backgammon',
  name: 'Backgammon',
  category: 'Board',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Square, because the board is drawn as two rows of twelve with the bar between them and
  // a tray at each end. The shell letterboxes it to whatever device it is given.
  logical: { width: 900, height: 900 },
  orientation: 'any',
  // One board both players reach across, so it turns to face whoever is to move.
  zoneSplit: 'shared-board',
  // Measured rather than guessed at: two bots settle a game in 47 s of simulated play on
  // easy and 97 s on the slowest pairing, so ninety is the middle of what a player will
  // actually sit through. The table is in SPEC.md.
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: press to roll, steer to pick a move, press to play',
    pointer:
      'Tap to roll, then tap the point you want to move from; tap nearer the landing point to pick a die',
  },
  tags: ['board', 'dice', 'classic'],
});
