import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'rat-race',
  name: 'Rat Race',
  category: 'Racing',
  archetype: 'rt-race',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Two bands of the same burrow, one above the other. Portrait, so each player faces their
  // own band across the width of the device and the burrow runs away from them.
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  // Each seat owns a full-width band, which is what lets a thumb reach every rail of its own
  // burrow directly rather than through a relative drag.
  zoneSplit: 'horizontal',
  roundSeconds: 75,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  // Each clause names a key the game reads and nothing it does not. The arrow half is
  // written as the left and right arrows rather than "the arrow keys" because up and down do
  // nothing here: a burrow runs one way. `game.test.ts` drives every clause of both lines
  // through the game and asserts the rat did what the line promises.
  controls: {
    keyboard:
      'Player one holds Space to run and taps A and D to change rail; player two holds Enter and the left and right arrows',
    pointer: 'Hold a finger in your own half to run, and slide it across to pick a rail',
  },
  tags: ['racing', 'timing'],
});
