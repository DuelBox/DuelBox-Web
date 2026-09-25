import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'paint-fight',
  name: 'Paint Fight',
  category: 'Party',
  archetype: 'rt-split',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 960, height: 1080 },
  orientation: 'any',
  zoneSplit: 'horizontal',
  // Forty-five seconds, and the clock is the only way it ends.
  roundSeconds: 45,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  // #2488: this said "the left roller", and there is no such thing. p1 only *spawns* upper
  // left — the two rollers free-roam one shared board and have swapped sides within seconds,
  // so a player who read the line before the match finds their roller on the right during
  // it. Worse, since the seeded opening the corner a seat starts in follows the opening seat
  // rather than the label. Named by colour **and** mark instead, which rule 7 already
  // requires the rendering to carry and which is true for the whole round.
  controls: {
    keyboard:
      'A and D steer seat one, the red ringed roller; arrow keys seat two, the blue barred one',
    pointer: 'Drag the way you want to go; your roller turns toward it',
  },
  tags: ['party', 'territory'],
});
