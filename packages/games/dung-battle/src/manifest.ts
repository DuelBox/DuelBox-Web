import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'dung-battle',
  name: 'Dung Battle',
  category: 'Arena',
  archetype: 'rt-arena',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // One square pit both beetles run around at once, 800 x 800 — exactly the box rules.ts
  // simulates, offset so the middle of the pit is the middle of the box. Square, so it reads
  // the same way up in either orientation and neither seat sees more of it than the other.
  logical: { width: 800, height: 800 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  // The clock the match actually ends on. See "Termination" in SPEC.md.
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  //
  // Every clause here is driven through the real InputManager in `game.test.ts` — the keys
  // named, the seat each half belongs to, and the pointer keeping its seat across the
  // middle of the device. A control string is a promise, not a description.
  controls: {
    keyboard:
      'W A S D runs the near beetle, arrow keys the far one — shove the ball into your base',
    pointer: 'Start a drag on your own side; your beetle runs at your finger wherever you take it',
  },
  tags: ['arena', 'chase'],
});
