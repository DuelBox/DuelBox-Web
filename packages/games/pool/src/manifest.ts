import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'pool',
  name: 'Pool',
  category: 'Sports',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 1000, height: 640 },
  orientation: 'landscape',
  zoneSplit: 'shared-board',
  // A frame of pool between two people who are thinking about it.
  roundSeconds: 300,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one A and D then hold Space, player two arrows then hold Enter: aim, build power, release',
    pointer: 'Pull back from the cue ball and let go — further back is a harder shot',
  },
  tags: ['sports', 'physics'],
});
