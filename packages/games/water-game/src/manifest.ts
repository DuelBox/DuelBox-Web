import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'water-game',
  name: 'Water Game',
  category: 'Party',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // One tall tank with a basket at each end, so the two baskets are half-turn images and
  // each player's own end is the one nearest them. Nothing is ever rotated: the water is
  // common ground and both people read it the same way up.
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  // Real-time, so the pointer surface is genuinely divided: a tap belongs to the seat whose
  // half of the device it started in, and both players may press at once.
  zoneSplit: 'horizontal',
  // The clock in `rules.ts` is 165 seconds and this is the same 165, asserted by a test.
  // `roundSeconds` ends nothing — it is text on a catalogue card — so the two are only
  // equal because somebody keeps them equal.
  roundSeconds: 165,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Space shoves the near seat’s ball and Enter shoves the far one. Timing is all.',
    pointer: 'Tap anywhere in your own half. Where you tap makes no difference — only when.',
  },
  tags: ['party', 'reflex', 'physics'],
  // Deliberately **not** `sameInputClassOnly`. The only thing this game ever reads from
  // either instrument is a press with a timestamp, which a thumb, a trackpad and a keyboard
  // produce identically, and nothing asks anybody to press faster than about four times a
  // second. See SPEC.md, "Fairness across input families and device classes".
  sameInputClassOnly: false,
});
