import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'sword-throwing',
  name: 'Sword Throwing',
  category: 'Shooter',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // A long arena end to end: each fighter stands at their own end with their rack behind
  // them, so the whole board is its own mirror and neither player reads it upside down.
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Player one: A and D, Space throws. Player two: left and right arrows, Enter throws',
    pointer: 'Drag to point your sword, lift to throw. Slide your finger to parry theirs',
  },
  tags: ['aim', 'parry'],
});
