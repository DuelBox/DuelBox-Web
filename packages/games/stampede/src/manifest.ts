import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'stampede',
  name: 'Stampede',
  category: 'Platform',
  archetype: 'rt-split',
  // Two lanes stacked, one per seat, each the full width of the device. Portrait, because
  // the thing a player is reading is a *width* — a beast crossing their own lane from one
  // edge to the other — and a full-width band gives that the longest run-in the device has.
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // Advertising text on the catalogue card; it ends nothing anywhere in this repository.
  // What ends a match is the course in `rules.ts` running out of beasts. The course is laid
  // out before the first step and nobody can lengthen it, so every match is the same length
  // whoever is playing and however badly — measured at 37.9 s, and a test ties this number
  // to that one.
  roundSeconds: 38,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  //
  // One press is the entire vocabulary. There is no direction, no position and no duration
  // to send, so a key and a thumb are not merely levelled here — they cannot express a
  // difference at all. See SPEC.md, "Fairness across input families".
  controls: {
    keyboard: 'Space jumps the near runner and Enter jumps the far one. One press, no holding.',
    pointer: 'Tap anywhere in your own half to jump. A tap is the whole game.',
  },
  tags: ['reflex', 'timing', 'party'],
  // Deliberately **not** `sameInputClassOnly`. A bare timestamped press is the one input
  // `docs/input-parity.md` rules identical across every input family, and it is the only
  // input this game reads. The other half of the fairness question — whether a bigger
  // screen shows a danger sooner — is answered by the approach-time budget in SPEC.md
  // rather than by this flag.
  sameInputClassOnly: false,
});
