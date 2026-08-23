import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'ping-pong',
  name: 'Ping Pong',
  category: 'Sports',
  archetype: 'rt-split',
  // Seen from above, one end each. Taller than it is wide so both halves are deep enough
  // for a rally to be readable on a phone held upright.
  logical: { width: 640, height: 960 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // The rules call the match at 150 s; this is what the catalogue card advertises, and a
  // match that goes the distance is rare — seven points lands nearer a minute.
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'A and D slide the near racket, arrow keys the far one — sweep to add spin',
    pointer: 'Drag on your half to slide your racket; sweep as it hits to put spin on',
  },
  tags: ['sports', 'reflex'],
});
