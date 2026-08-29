import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'the-last-sashimi',
  name: 'The Last Sashimi',
  category: 'Party',
  // The belt turns to face whoever is eating, both counters sit on the centre line, and the
  // whole surface takes a tap: there is nothing to point at, only a moment to pick.
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // One bare press and nothing else — no gauge to read, no distance to keep. A key, a
  // trackpad and a thumb cannot even express a difference, which is the strongest form rule 10
  // takes in this catalogue.
  controls: {
    keyboard: 'Player one presses Space, player two Enter — one press closes the chopsticks',
    pointer: 'Tap anywhere on your turn to close the chopsticks on whatever is passing',
  },
  tags: ['timing', 'reflex'],
});
