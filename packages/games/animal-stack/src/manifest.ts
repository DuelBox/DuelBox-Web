import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'animal-stack',
  name: 'Animal Stack',
  category: 'Party',
  archetype: 'rt-split',
  modes: ['friend', 'bot', 'solo'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'TODO: which keys do what, for both seats',
    pointer: 'TODO: the pointer idiom, or empty if this archetype has none',
  },
  tags: [],
});
