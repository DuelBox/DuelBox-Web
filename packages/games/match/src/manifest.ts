import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'match',
  name: 'Match Rush',
  category: 'Reaction',
  archetype: 'rt-arena',
  // Square, with each seat's fan of five in its own half. The board is point-symmetric and
  // every symbol is drawn without a top, so nothing needs rotating.
  logical: { width: 900, height: 900 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 40,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'W A S D and Space pick from the near fan, the arrow keys and Enter the far one',
    pointer: 'Touch the symbol in your own half that also appears in theirs. A wrong one costs you',
  },
  tags: ['reaction', 'party'],
});
