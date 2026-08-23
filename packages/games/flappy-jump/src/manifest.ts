import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'flappy-jump',
  name: 'Flappy Jump',
  category: 'Platform',
  archetype: 'rt-split',
  // Two lanes stacked, one per seat, with a shared band between them. Taller than it is
  // wide so each lane is deep enough for a wing-beat to read on a phone held upright.
  logical: { width: 640, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  // Horizontal: each player owns the half of the device nearest them, floor outward.
  zoneSplit: 'horizontal',
  // The hoop budget calls the match at about 62 s, which is what this advertises. The
  // hard backstop lives in the rules, because `roundSeconds` ends nothing.
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Seat one flaps with W or Space, seat two with Up or Enter — hold to glide',
    pointer: 'Tap your own half to flap; hold a finger down to glide slowly back down',
  },
  tags: ['reflex', 'platform', 'arcade'],
});
