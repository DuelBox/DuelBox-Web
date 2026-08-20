import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'hand-slap',
  name: 'Hand Slap',
  category: 'Reaction',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  // Two halves, one per seat, split across the middle: each player has their own hands.
  zoneSplit: 'horizontal',
  roundSeconds: 90,
  controls: {
    keyboard: 'Space or Enter to swing when attacking, or to pull away when defending',
    pointer: 'Tap your half to swing, or to pull your hands away',
  },
  tags: ['reflex', 'bluff'],
  // One button, pressed at a moment of your choosing. Nothing here rewards a mouse over a
  // thumb: there is no aiming, no tracking, and no rapid repeat — the whole skill is
  // *when* you press, and the bluff is what decides it rather than raw speed.
  sameInputClassOnly: false,
});
