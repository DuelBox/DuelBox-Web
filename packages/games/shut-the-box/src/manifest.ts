import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'shut-the-box',
  name: 'Shut the Box',
  category: 'Dice',
  archetype: 'turn-board',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  // Two full turns of rolling, and a bad run of dice can make a turn long.
  roundSeconds: 150,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  // Turn-based: the box belongs to whoever is playing, so both key halves drive the
  // active seat and "or" is the truth here rather than the lie it is in a simultaneous
  // game. The board turns to face them.
  controls: {
    keyboard:
      'Player one W A S D then Space, player two arrows then Enter: pick a tile and shut it',
    pointer: 'Tap the roll button, then tap tiles adding up to your roll',
  },
  tags: ['dice', 'solo-turn'],
});
