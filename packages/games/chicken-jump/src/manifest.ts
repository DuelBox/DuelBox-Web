import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'chicken-jump',
  name: 'Chicken Jump',
  category: 'Platform',
  archetype: 'rt-split',
  // Two perches stacked, one per seat, with a fence between them. Taller than it is wide so
  // each half is deep enough for a swinging block, a pole and a hop to read on a phone held
  // upright, and wide enough that the widest swing plus the widest block still fits.
  logical: { width: 680, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  // Horizontal: each player owns the half of the device nearest them, floor outward.
  zoneSplit: 'horizontal',
  // A match nobody plays runs 56 s and a bot match 14-48 s, so this is the honest label.
  // The hard backstop lives in the rules, because `roundSeconds` ends nothing: the block
  // budget bounds the worst case at 73.4 s and ROUND_SECONDS catches anything past that.
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and again
  // from the pause menu, so a game without it would advertise nothing to a player holding a
  // keyboard. Written for a player rather than as a spec.
  //
  // One press is the whole game, so both lines say one thing each and both are exactly true:
  // Space is seat one's action key and Enter is seat two's, and a press releases the block
  // and hops at the same instant. Nothing else on the keyboard does anything, and nothing is
  // held — see `game.test.ts`, which asserts the arrow keys and W A S D move nothing.
  controls: {
    keyboard: 'Seat one hops with Space, seat two with Enter — one press cuts the block loose',
    pointer: 'Tap anywhere on your own half of the screen to hop and cut the block loose',
  },
  tags: ['timing', 'platform', 'arcade'],
});
