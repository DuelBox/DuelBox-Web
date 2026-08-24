import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'archery-master',
  name: 'Archery Master',
  category: 'Shooter',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // The gallery fills the far end and the bow stands on the shooting line at the near
  // edge, so a half turn of the board puts both exactly where the other archer needs them.
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  //
  // Both halves are named one player at a time, because nothing ever remaps the keyboard:
  // handing the board to whoever is to move moves the *pointer* and only the pointer, so
  // "W A S D or the arrows" would be false in the quiet way — the other half simply does
  // nothing until it is that player's turn. `game.test.ts` drives every key named here
  // through the real InputManager and asserts it does what this string says.
  controls: {
    keyboard:
      'Player one: A and D swing the bow, W and S set the draw, hold Space and let go to shoot. ' +
      'Player two: arrows and Enter',
    pointer: 'Slide your finger across the pad to aim, further down to draw deeper, lift to shoot',
  },
  tags: ['aim', 'arc'],
});
