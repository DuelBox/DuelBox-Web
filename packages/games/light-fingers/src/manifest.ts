import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'light-fingers',
  name: 'Light Fingers',
  category: 'Party',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  // Two halves either side of the case: each seat reaches into its own copy of the rail.
  zoneSplit: 'horizontal',
  roundSeconds: 60,
  controls: {
    // Each seat gets its own half of the keyboard, never a choice between the two halves.
    keyboard:
      'Player one: A and D to slide, Space to grab. Player two: arrow keys to slide, Enter to grab.',
    pointer: 'Touch your half to send your hand to that pedestal; it grabs when it arrives.',
  },
  tags: ['reaction', 'party', 'nerve'],
  // A hand travels one pedestal per fixed interval whatever moved it, so a thumb that
  // names a pedestal outright and a key that walks towards it arrive at the same moment.
  // There is no tracking, no fine aim and no rapid repeat for a mouse to be better at.
  sameInputClassOnly: false,
});
