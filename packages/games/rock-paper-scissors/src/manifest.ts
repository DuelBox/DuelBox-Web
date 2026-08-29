import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'rock-paper-scissors',
  name: 'Rock Paper Scissors',
  category: 'Reaction',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    // Near and far, not left and right: a `horizontal` split seats p1 at the bottom of
    // the board and p2 at the top, and this game puts each seat's row of three buttons
    // under its own hands (`P1_ROW_Y` low, `P2_ROW_Y` high). Nobody sits on the left.
    // Only the sideways keys move the cursor — the row is three buttons wide.
    keyboard:
      'A and D then Space for the near seat, the left and right arrows then Enter for the far seat',
    pointer: 'Tap one of your three buttons before the bar runs out',
  },
  tags: ['quick', 'simultaneous'],
});
