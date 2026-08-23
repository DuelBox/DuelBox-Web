import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'mini-golf',
  name: 'Mini Golf',
  category: 'Sports',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  // Nine holes, alternating strokes, at about ninety seconds of play in the measured worst
  // case and half that when one player is clearly better.
  roundSeconds: 150,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one A and D then hold Space, player two arrows then hold Enter: aim, build power, release',
    pointer: 'Pull back from your ball and let go — a longer pull is a harder putt',
  },
  tags: ['sports', 'physics'],
});
