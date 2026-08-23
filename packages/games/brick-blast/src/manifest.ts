import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'brick-blast',
  name: 'Brick Blast',
  category: 'Arcade',
  archetype: 'rt-arena',
  // One court both players are in at once, with the wall between them. Portrait and taller
  // than it is wide, so each end is deep enough to read a ball coming on a shared phone.
  logical: { width: 640, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  // Both seats act at every moment and each owns its own end of the device, so a touch
  // belongs to the half it went down in. The wall in the middle is shared; the ends are not.
  zoneSplit: 'horizontal',
  roundSeconds: 40,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'A and D slide the near paddle, the left and right arrows the far one',
    pointer: 'Drag in your own half to slide your paddle; hit off centre to angle the ball',
  },
  tags: ['arcade', 'reflex'],
});
