import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'pinball',
  name: 'Pinball Duel',
  category: 'Arcade',
  archetype: 'rt-arena',
  // One table both players are on at once, with the bumper field between their two ends.
  // Portrait and taller than it is wide, so each end is deep enough to read a ball coming.
  logical: { width: 600, height: 960 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  // Both seats act at every moment and each owns its own end of the device, so a touch
  // belongs to the half it went down in. This is also what `GameHost` actually does with an
  // `rt-*` game whatever the manifest says, so declaring anything else would be a lie the
  // shell then contradicts.
  zoneSplit: 'horizontal',
  // Measured rather than guessed: over 1080 bot matches the six tier pairings mean 45 to 71
  // seconds, 56 across all of them. The catalogue card carries its own figure, from
  // data/catalog.yaml, which predates the build.
  roundSeconds: 55,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'A and D flip the near seat flippers, the left and right arrows the far seat pair',
    pointer: 'Touch your own end: the left half lifts your left flipper, the right half the right',
  },
  tags: ['arcade', 'physics', 'reflex'],
});
