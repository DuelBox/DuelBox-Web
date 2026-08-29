import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'happy-hippos',
  name: 'Happy Hippos',
  category: 'Party',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // One pond down the middle of a portrait board, a bank at each end. Both players read the
  // same water the same way up, so nothing is ever turned except one seat's own tally.
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  // Real-time, so the pointer surface is genuinely divided: a tap belongs to the seat whose
  // half of the device it started in, and both players snap at once.
  zoneSplit: 'horizontal',
  // Advertising text on the catalogue card, and it ends nothing anywhere in this repository.
  // The clock that actually ends a match is `MATCH_SECONDS` in rules.ts. Measured over 4500
  // bot matches: 22 s at `hard`, 32 s at `easy`, and a person is slower than any of them.
  roundSeconds: 40,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'A and D walk the near hippo, Space snaps it; the arrow keys and Enter do the far seat',
    pointer: 'Tap your own half to snap; keep your finger down and slide to walk your hippo',
  },
  tags: ['party', 'reflex'],
});
