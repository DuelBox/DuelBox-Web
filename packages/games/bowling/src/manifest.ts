import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'bowling',
  name: 'Bowling',
  category: 'Sports',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  // Four frames each, two balls a frame, and pins to watch fall.
  roundSeconds: 180,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one A and D then hold Space, player two arrows then hold Enter: aim, build power, release',
    pointer: 'Drag sideways to aim and back down the lane for power, then let go',
  },
  tags: ['sports', 'physics'],
});
