import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'pizza-memory',
  name: 'Pizza Memory',
  category: 'Memory',
  // Both cooks work at once, each on their own counter, so the device is genuinely divided:
  // a touch belongs to the seat whose half it started in.
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // A counter each, one above the other. Seat two's is the exact half-turn image of seat
  // one's, so neither player ever reads anything upside down and nothing is ever rotated.
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // Advertising text on the catalogue card, and it ends nothing anywhere in this repository.
  // The clock that actually ends a match is `MATCH_SECONDS` in rules.ts, and the race to
  // `TARGET_SERVED` gets there first often enough to matter: measured over 3000 bot matches
  // a tier, 65.4 s at `hard`, 74.4 at `normal` and 75.0 at `easy`.
  roundSeconds: 75,
  // Required, and deliberately not optional: the shell shows this before the match and again
  // from the pause menu, so a game without it would advertise nothing to a player holding a
  // keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      "A and D slide player one's hand, Space drops it; the arrow keys and Enter do player two",
    pointer: 'Hold your own half and slide to walk your hand along the rail; lift to drop',
  },
  tags: ['memory', 'sequence'],
});
