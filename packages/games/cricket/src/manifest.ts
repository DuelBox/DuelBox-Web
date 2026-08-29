import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'cricket',
  name: 'Cricket',
  category: 'Sports',
  archetype: 'rt-split',
  // The striker stands at the centre of a circular ground, so the picture reads the same
  // from either end of the device. The 150 units above and below the boundary are where
  // the scorecard goes — chrome, never extra field of view (rule 9).
  logical: { width: 700, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // Two innings of two overs, plus the run-ups and the gaps between balls.
  roundSeconds: 150,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Bowling: W A S D for line and length, hold Space for pace. Batting: A D to move, Space to swing',
    pointer:
      'Bowling: drag to the pitch spot, release to bowl. Batting: tap where to meet the ball',
  },
  tags: ['sports', 'timing'],
});
