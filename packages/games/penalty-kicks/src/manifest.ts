import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'penalty-kicks',
  name: 'Penalty Kicks',
  category: 'Sports',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // A shoot-out of about fifteen kicks.
  roundSeconds: 150,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'A and D then Space on the left, arrow keys then Enter on the right',
    pointer: 'Tap the square you want — the kicker aims there, the keeper dives there',
  },
  tags: ['sports', 'bluffing'],
});
