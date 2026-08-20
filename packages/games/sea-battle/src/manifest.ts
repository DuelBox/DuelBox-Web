import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'sea-battle',
  name: 'Sea Battle',
  category: 'Board',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  // Two fleets of five, one shot at a time, and a hit buys another shot.
  roundSeconds: 240,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: move the sight and fire',
    pointer: 'Tap a square to place a ship or call a shot; tap it again to turn the ship',
  },
  tags: ['board', 'hidden-information'],
});
