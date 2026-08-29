import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'brainrot-stack',
  name: 'Wobble Stack',
  category: 'Party',
  archetype: 'rt-split',
  modes: ['friend', 'bot', 'solo'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // Catalogue copy, and it ends nothing: the two bounds that do are `PIECE_CAP` and
  // `ROUND_SECONDS` in `rules.ts`. The measured mean match is 21 s and the longest of
  // 3600 was 41.5 s, so 45 is what a player should expect rather than what is enforced.
  roundSeconds: 45,
  controls: {
    keyboard:
      'Player one: A and D shunt a notch, Space drops. ' +
      'Player two: the arrow keys shunt, Enter drops.',
    pointer: 'Drag in your own half to shunt to the notch under your finger; tap to drop.',
  },
  tags: ['stacking', 'balance', 'physics'],
});
