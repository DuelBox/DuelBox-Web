import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'golf-football',
  name: 'Golf Football',
  category: 'Sports',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 60,
  // One gesture, two moments — and the same gesture on both instruments, because the game
  // reads `actionPressed`, `actionHeld` and `actionReleased` and never a pointer position.
  // A press is one binary event with a timestamp on a phone, a trackpad and a keyboard
  // alike, and a press *length* is counted in simulation steps, so neither family can place
  // either dial more finely than the other. See SPEC.md.
  controls: {
    keyboard:
      'Player one uses Space, player two Enter: press to keep the line, hold for power, release to kick.',
    pointer: 'Press anywhere on your turn to keep the line, hold for power, release to kick.',
  },
  tags: ['golf', 'football', 'aim', 'timing', 'turn-based'],
});
