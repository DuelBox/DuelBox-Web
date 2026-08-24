import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';
import { BOARD_HEIGHT, BOARD_WIDTH } from './rules.js';

export const manifest: GameManifest = parseGameManifest({
  id: 'soccer-pool',
  name: 'Soccer Pool',
  category: 'Sports',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: BOARD_WIDTH, height: BOARD_HEIGHT },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  // Eighteen shots between two people who are thinking about them.
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  //
  // The two keyboard halves are two different people's, in this archetype as in every
  // other: nothing remaps them when the turn changes, so seat one's keys simply do
  // nothing while seat two is up. Saying "A and D or the arrows" would be a lie, and it
  // is the exact lie `controls.test.ts` was written to catch.
  controls: {
    keyboard:
      'Player one aims with A and D, player two with arrows; hold Space or Enter for power, release to shoot',
    pointer: 'Pull back from the ball and let go — further back is a harder shot',
  },
  tags: ['sports', 'physics', 'aim'],
});
