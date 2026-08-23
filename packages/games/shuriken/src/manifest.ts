import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'shuriken',
  name: 'Shuriken',
  category: 'Shooter',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // The grove is mirror-symmetric about the centre line and the throwing hand sits on it,
  // so a half-turn of the board puts everything exactly where the other player needs it.
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Seat one: A and D aim, W and S spin, Space throws. Seat two: arrows and Enter. Your turn only',
    pointer: 'Press to grab the blade, drag to point it, sweep sideways for spin, lift to throw',
  },
  tags: ['aim', 'spin'],
});
