import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'nuts-and-bolts',
  name: 'Nuts and Bolts',
  category: 'Solo',
  // Two seats take turns on ONE rack, and neither half of the screen belongs to a seat: a
  // turn-based shared board.
  archetype: 'turn-board',
  // The catalogue row says `solo`, and this ships `friend` and `bot` instead. A sorting
  // puzzle played alone is a solitaire in a box built for two, `PlaySurface` offers no way to
  // start a solo-only game at all, and the whole design here is what makes the puzzle a duel.
  // The schema calls `modes` the list a lobby may offer and says declaring one the game
  // cannot run is a build error, so `solo` is not carried for the sake of matching the row.
  // SPEC.md argues it and names what was rejected.
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Square, because the rack sits in the middle band and the half-turn has to carry each
  // seat's own margin to the edge in front of them.
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and again
  // from the pause menu, so a game without it would advertise nothing to a player holding a
  // keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one A and D then Space, player two the arrows then Enter: a bolt, then where the nut goes',
    pointer: 'Tap a bolt to lift its end nut, then tap the bolt you want it on',
  },
  tags: ['puzzle', 'sorting', 'turn-based'],
});
