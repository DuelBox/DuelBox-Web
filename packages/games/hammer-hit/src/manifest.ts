import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'hammer-hit',
  name: 'Hammer Hit',
  category: 'Party',
  // The board turns to face whoever is swinging, and every part of it is placed as
  // `centre ± offset`, so the half-turn leaves the geometry identical either way up.
  archetype: 'turn-aim',
  logical: { width: 700, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec, and it names which
  // half of the keyboard belongs to which person — there is one keyboard between two.
  controls: {
    keyboard: 'Space is player one, Enter is player two — one press swings the hammer',
    pointer: 'Tap anywhere on your turn to swing. Wait for a later pass to hit harder',
  },
  tags: ['timing', 'aim', 'party'],
});
