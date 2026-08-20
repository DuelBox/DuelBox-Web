import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'paint-fight',
  name: 'Paint Fight',
  category: 'Party',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 960, height: 1080 },
  orientation: 'any',
  zoneSplit: 'horizontal',
  // Forty-five seconds, and the clock is the only way it ends.
  roundSeconds: 45,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'A and D steer the left roller, arrow keys the right — you cannot stop',
    pointer: 'Drag the way you want to go; your roller turns toward it',
  },
  tags: ['party', 'territory'],
});
