import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'tap-match',
  name: 'Tap Match',
  category: 'Solo',
  // Two seats take turns on ONE board of piles: neither half of the screen belongs to a
  // seat, and the board turns to face whoever is to move.
  archetype: 'turn-board',
  // The catalogue row calls this a solo game, because the reference is one. Both modes
  // here are ours: the seven-slot rack is a loss condition, and a loss condition with
  // nobody on the other side of it is a highscore rather than a duel. `solo` is
  // deliberately *not* declared — `PlaySurface` filters the mode list down to `friend`
  // and `bot`, so declaring a third would be a promise the lobby cannot keep.
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Six piles across the middle, with a seven-slot rack at each end.
  logical: { width: 900, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Player one moves with A and D and takes with Space, player two the arrows and Enter',
    pointer: 'On your turn, tap the face-up card of any pile to take it',
  },
  tags: ['cards', 'matching'],
});
