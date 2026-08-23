import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'ship-battle',
  name: 'Ship Battle',
  category: 'Board',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  // Twelve hull sections a side, and at most two shots in four can ever be stopped, so a
  // match runs to about three minutes rather than the ninety seconds the archetype assumes.
  roundSeconds: 180,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  // Both halves of a turn, in both families. The first draft described only the gunner's
  // half — a keyboard player was never told the same keys slide the armour plate, which is
  // the half of the game the observed rule is actually about. `game.test.ts` drives every
  // claim below through the engine's own binding table rather than through a hand-written
  // input, so a string that names a key nothing reads fails the suite.
  controls: {
    keyboard:
      'Player one W A S D and Space, player two arrows and Enter: aim and fire, then slide your armour plate',
    pointer:
      'Drag to aim, lift to fire — then drag to slide your armour plate in front of the shell',
  },
  tags: ['board', 'duel', 'reflex'],
});
