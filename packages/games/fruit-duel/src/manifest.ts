import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'fruit-duel',
  name: 'Fruit Duel',
  category: 'Reaction',
  archetype: 'rt-split',
  // One thing in the middle, a blade at each end. Portrait, so the two players face each
  // other across the subject rather than sitting side by side.
  logical: { width: 640, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Space is player one, Enter is player two — cut fruit, leave everything else',
    pointer: 'Tap anywhere in your own half to cut. Nothing to aim; only when to move',
  },
  tags: ['reaction', 'party'],
});
