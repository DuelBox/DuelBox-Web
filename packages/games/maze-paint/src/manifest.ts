import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'maze-paint',
  name: 'Maze Paint',
  category: 'Solo',
  archetype: 'turn-board',
  // The catalogue row records a solo game, because the reference app's is one, and `solo`
  // stays so the row and the manifest agree about what was observed. `friend` and `bot` are
  // ours: the duel in SPEC.md needs two seats, and `PlaySurface` only renders start buttons
  // for those two, so a solo-only manifest would produce a page with no way to begin.
  modes: ['friend', 'bot', 'solo'],
  presentations: ['shared-screen', 'single-seat'],
  // Eleven squares each way, 76 units a square, 32 units of margin: 32 + 836 + 32. Every
  // simulation value in the package is inside this box and nothing anywhere is in pixels.
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  // Advertising text on the catalogue card; it ends nothing anywhere in this repository.
  // What ends a match is that all but a bounded run of rolls paints a square and squares run
  // out. Measured over 6 000 bot matches: 28.6 s at `easy`, 29.4 s at `hard`, longest 75 s.
  roundSeconds: 45,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Player one W A S D, player two the arrow keys: one press rolls you that way',
    pointer: 'Tap anywhere along one of the four lit lanes to roll to the end of it',
  },
  tags: ['maze', 'territory', 'strategy'],
});
