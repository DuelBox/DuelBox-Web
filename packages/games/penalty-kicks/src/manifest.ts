import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'penalty-kicks',
  name: 'Penalty Kicks',
  category: 'Sports',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // A shoot-out of about fifteen kicks.
  roundSeconds: 150,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    // Near and far, not left and right: a `horizontal` split seats p1 at the bottom of the
    // board and p2 at the top, and each seat's selector is drawn in its own half. The
    // selector is three by three, so all four movement keys are read, not just A and D.
    keyboard:
      'W A S D then Space for the near seat, arrows then Enter for the far seat: move over your own three-by-three',
    pointer: 'Tap the square you want — the kicker aims there, the keeper dives there',
  },
  tags: ['sports', 'bluffing'],
});
