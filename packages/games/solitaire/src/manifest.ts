import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'solitaire',
  name: 'Solitaire',
  category: 'Solo',
  // Two seats take turns on one deal: one tableau, one stock, four shared foundations, and
  // neither half of the screen belongs to a seat.
  archetype: 'turn-board',
  // The catalogue row records a solo game, because the reference app's is one, and `solo` stays
  // so the row and the manifest agree about what was observed. `friend` and `bot` are ours: the
  // duel in SPEC.md needs two seats, and `PlaySurface` draws a start button only for those two,
  // so a solo-only manifest would ship a game page with no way to begin.
  modes: ['friend', 'bot', 'solo'],
  presentations: ['shared-screen', 'single-seat'],
  // The header row of piles, seven tableau columns beneath it, and the ledger along the bottom.
  // Every simulation value in this package is inside this box; nothing anywhere is in pixels.
  logical: { width: 900, height: 1000 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and again
  // from the pause menu, so a game without it would advertise nothing to a player holding a
  // keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: pick a pile, put it down',
    pointer: 'Tap a pile to pick it up, then tap where it goes. Tap the stock to turn a card',
  },
  tags: ['cards', 'turn-based', 'territory'],
});
