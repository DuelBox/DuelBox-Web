import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'sliding-puzzle',
  name: 'Sliding Puzzle',
  category: 'Solo',
  // Two seats take turns sliding tiles on ONE board towards two goals that are each
  // other's half-turn: a turn-based shared board, and neither half of the screen belongs
  // to a seat.
  archetype: 'turn-board',
  // The catalogue row says `solo`, and this ships `friend` and `bot` instead. A sliding
  // puzzle played alone is a solitaire in a box built for two, the shell offers no way to
  // start a solo-only game at all, and the whole design here is what makes the puzzle a
  // duel. SPEC.md argues it and names what was rejected.
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Square, because the board is square and the half-turn has to map it onto itself: the
  // 3x3 sits dead centre, with a slide counter in each of the two equal margins.
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  controls: {
    keyboard:
      'Player one W A S D, player two the arrow keys: slide the tile on that side of the gap',
    pointer: 'Tap a tile beside the gap to slide it in',
  },
  tags: ['puzzle', 'tiles', 'turn-based'],
});
