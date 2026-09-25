import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'pool',
  name: 'Pool',
  category: 'Sports',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 1000, height: 640 },
  orientation: 'landscape',
  zoneSplit: 'shared-board',
  // A frame of pool between two people who are thinking about it.
  roundSeconds: 300,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard:
      'Player one A and D then hold Space, player two arrows then hold Enter: aim, build power, release',
    // The second clause is the whole of #1965's control fix, in the one place a player is
    // told about it: full power is the edge of the table rather than a fixed distance, so a
    // ball tight on a cushion can still be hit hard with a short draw. Without it, someone
    // on the rail would pull until their finger left the glass and wonder why nothing came.
    pointer:
      'Pull back from the cue ball and let go — further back is harder, and the table edge is as hard as it goes',
  },
  tags: ['sports', 'physics'],
});
