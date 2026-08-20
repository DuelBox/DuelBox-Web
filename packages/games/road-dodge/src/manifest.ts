import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'road-dodge',
  name: 'Road Dodge',
  category: 'Racing',
  archetype: 'rt-race',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  // Two separate roads running side by side. Neither seat can touch the other's traffic,
  // so the seats share a screen without sharing a board.
  zoneSplit: 'vertical',
  roundSeconds: 60,
  controls: {
    keyboard: 'A and D or the arrow keys to change lane',
    pointer: 'Tap or drag the left or right half of your road',
  },
  tags: ['reflex', 'endless'],
  // The first game in the repository to declare this, and `rt-race` is the archetype
  // docs/input-parity.md rules genuinely unfair across input families. The interaction
  // *is* rapid discrete input — the thing a key is for and a touchscreen is worst at —
  // and no shared viewport or precision envelope closes that, because the gap is not
  // precision or field of view but how fast a thumb can leave the glass and come back.
  sameInputClassOnly: true,
});
