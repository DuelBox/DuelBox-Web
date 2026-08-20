import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'snakes',
  name: 'Snake Clash',
  category: 'Racing & Trails',
  archetype: 'rt-arena',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  // A round ends when somebody crashes, and the clock is the backstop.
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'A and D steer the left snake, arrow keys the right — you cannot stop',
    pointer: 'Point where you want to go; your snake turns toward your finger',
  },
  tags: ['arena', 'reflex'],
});
