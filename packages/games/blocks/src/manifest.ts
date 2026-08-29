import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'blocks',
  name: 'Blocks',
  category: 'Solo',
  archetype: 'turn-board',
  // The catalogue row records a solo game, because the reference app's is one, and `solo`
  // stays so the row and the manifest agree about what was observed. `friend` and `bot`
  // are ours: the duel in SPEC.md needs two seats, and `PlaySurface` draws a start button
  // for those two modes only — a solo-only manifest is a game page nobody can start.
  modes: ['friend', 'bot', 'solo'],
  presentations: ['shared-screen', 'single-seat'],
  // Nine rows of board, a gap, and the tray of three. Every simulation value in the
  // package is inside this box; nothing anywhere is in pixels.
  logical: { width: 900, height: 1000 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: pick a shape, then a square',
    pointer: 'Tap a shape in the tray, then tap any square with a dot on it',
  },
  tags: ['puzzle', 'territory', 'draft'],
});
