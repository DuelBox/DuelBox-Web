import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'sudoku',
  name: 'Sudoku',
  category: 'Solo',
  archetype: 'turn-board',
  // The catalogue row records a solo game, because the reference app's is one, and `solo`
  // stays so the row and the manifest agree about what was observed. `friend` and `bot`
  // are ours: the duel in SPEC.md needs two seats, and without them the lobby offers no
  // way to start a match at all.
  modes: ['friend', 'bot', 'solo'],
  presentations: ['shared-screen', 'single-seat'],
  // Nine rows of grid, a gap, and one row of digit keys. Every simulation value in the
  // package is inside this box; nothing anywhere is in pixels.
  logical: { width: 900, height: 1000 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: pick a square, then a digit',
    pointer: 'Tap a bright square, then tap a digit on the pad below the grid',
  },
  tags: ['puzzle', 'logic', 'territory'],
});
