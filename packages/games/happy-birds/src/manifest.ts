import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'happy-birds',
  name: 'Happy Birds',
  category: 'Platform',
  archetype: 'rt-split',
  // A strip of sky each, one above the other, with the horizon between them. Taller than
  // it is wide so a wing-beat is a sixth of the sky rather than a twitch on a phone.
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  // Horizontal: each player owns the half of the device nearest them, ground outward.
  zoneSplit: 'horizontal',
  // Nine flights of a few seconds each lands near a minute, which is what this advertises.
  // The hard backstops live in the rules, because `roundSeconds` ends nothing.
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec — and it names which
  // half of the keyboard belongs to which player, because the two halves are two people.
  controls: {
    keyboard:
      'Seat one flaps with Space or W, seat two with Enter or Up — hold Space or Enter to dive',
    pointer: 'Tap your own half of the screen to flap; keep the finger down to tuck and dive',
  },
  tags: ['reflex', 'survival', 'arcade'],
});
