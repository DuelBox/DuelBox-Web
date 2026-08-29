import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'unfair-fishing',
  name: 'Unfair Fishing',
  category: 'Party',
  archetype: 'rt-split',
  // One pond down the middle of a portrait board with a boat moored at each end. Both
  // players read the same water, and each one's own boat is the near one.
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  // Real-time and simultaneous, so the pointer surface is genuinely divided: a tap belongs
  // to the seat whose half of the device it started in, and both rods work at once.
  zoneSplit: 'horizontal',
  // Advertising text on the catalogue card; it ends nothing anywhere in this repository.
  // The clock that actually ends a match is `MATCH_SECONDS` in rules.ts, and a test
  // asserts the two are the same number. Measured over 2400 bot matches, both seat
  // orders: 57 s at `hard`, 70 s at `normal`, 108 s at `easy`.
  roundSeconds: 180,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  //
  // There is no steering. W A S D and the arrow keys do nothing here on purpose — a rod
  // is worked with one button, and giving a keyboard a second axis a finger cannot spell
  // would be exactly the cross-device gap `docs/input-parity.md` exists to close.
  controls: {
    keyboard: 'Space throws and then rewinds the near seat’s rod; Enter works the far seat’s.',
    pointer: 'Tap your own half to throw the bait, and tap again to rewind the reel.',
  },
  tags: ['party', 'reflex', 'timing'],
  // Deliberately **not** `sameInputClassOnly`. The whole input surface is one boolean edge
  // with a timestamp, which a thumb, a trackpad and a key all produce identically, and
  // nothing anywhere reads a pointer's position or its velocity. See SPEC.md, "Fairness
  // across input families".
  sameInputClassOnly: false,
});
