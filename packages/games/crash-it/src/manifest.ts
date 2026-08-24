import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'crash-it',
  name: 'Crash It',
  category: 'Racing',
  archetype: 'rt-race',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 75,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'TODO: which keys do what, for both seats',
    pointer: 'TODO: the pointer idiom, or empty if this archetype has none',
  },
  tags: [],
});
