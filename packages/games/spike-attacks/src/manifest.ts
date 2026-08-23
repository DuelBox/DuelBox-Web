import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'spike-attacks',
  name: 'Spike Attacks',
  category: 'Survival',
  archetype: 'rt-split',
  // Portrait, with a row of stones each: the two players sit either side of the device and
  // each reads their own row upright. The two halves are point-symmetric, so neither seat
  // sees more of anything than the other (rule 9) and nothing here has to be rotated.
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec — and it names which
  // half of the keyboard belongs to which player, because the two halves are two people.
  controls: {
    keyboard: 'W A S D belong to player one and the arrow keys to player two — A and D walk you',
    pointer: 'Touch your own half and you walk towards your finger. Hold it where you want to be',
  },
  tags: ['survival', 'reflex'],
});
