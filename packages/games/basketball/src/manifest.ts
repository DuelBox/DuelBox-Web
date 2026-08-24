import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'basketball',
  name: 'Basketball',
  category: 'Sports',
  // The court turns to face whoever is shooting, so the one hoop stands on the halfway
  // line and the whole floor is its own mirror image, whichever way up it is read.
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  // Fourteen possessions, seven each, at about three seconds a shot.
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Player one presses Space, player two Enter: first sets the line, second shoots',
    pointer: 'Tap anywhere on your turn — first tap sets the line, second shoots. Nothing to drag',
  },
  tags: ['sports', 'aim', 'timing'],
});
