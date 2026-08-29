import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'fatal-siege',
  name: 'Fatal Siege',
  category: 'Arena',
  archetype: 'rt-arena',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 800, height: 800 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 40,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'TODO: which keys do what, for both seats',
    pointer: 'TODO: the pointer idiom, or empty if this archetype has none',
  },
  tags: [],
});
