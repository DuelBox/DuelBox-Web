import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'lumber-jack',
  name: 'Lumberjack',
  category: 'Party',
  archetype: 'rt-split',
  // A tree each, one above the other. Taller than it is wide because a tree is, and
  // because a horizontal split is the only one that gives each seat a full-width trunk
  // with room either side of it to stand.
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // The rules call the match at 120 s and nothing has ever come close: the slowest
  // pairing measured averages 33 s. This is what the catalogue card advertises.
  roundSeconds: 40,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'A and D swing at the near tree, the left and right arrows at the far one',
    pointer: 'Tap or hold the left or right of your own half to chop from that side',
  },
  tags: ['reflex', 'rhythm'],
  // Fair across input families, unlike the genre's usual shape. The whole interaction is
  // rapid discrete input, which is exactly what `docs/input-parity.md` says a keyboard
  // wins outright — so the axe has a cadence no input can beat, and a held key and a
  // resting finger chop at the identical rate. See `swingSeconds` in rules.ts.
  sameInputClassOnly: false,
});
