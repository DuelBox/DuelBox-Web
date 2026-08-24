import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'carrom',
  name: 'Carrom',
  category: 'Sports',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // Square board, centred, with a band at each end for the two players' readouts. The
  // board is exactly in the middle of the box so a half turn leaves it where it was.
  logical: { width: 720, height: 900 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  // A frame between two people who are thinking about it, at the pace bots keep.
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one A and D slide, W and S swing the aim, hold Space and let go to flick; player two arrows and Enter',
    pointer: 'Touch behind your line to slide, drag into the board and let go — further is harder',
  },
  tags: ['sports', 'physics'],
});
