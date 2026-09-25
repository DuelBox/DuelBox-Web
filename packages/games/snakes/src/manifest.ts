import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'snakes',
  name: 'Snake Clash',
  category: 'Racing & Trails',
  archetype: 'rt-arena',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 900, height: 900 },
  orientation: 'any',
  zoneSplit: 'shared-board',
  // A round ends when somebody crashes, and the clock is the backstop.
  roundSeconds: 90,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    // Never "the left snake": both snakes roam the whole arena and have swapped sides
    // within seconds of the countdown (#2488), so a player who read that before the match
    // finds their snake on the right in the middle of it. The seat is named by where the
    // person sits, which does not move, and the snake by the colour *and* the shape rule 7
    // already makes it carry — a ringed head for seat one, a bar across every segment for
    // seat two — so this describes what a player can still see at t = 30.
    keyboard:
      "A and D steer the near seat's ringed red snake; arrow keys the far seat's barred blue one — you cannot stop",
    pointer: 'Point where you want to go; your snake turns toward your finger',
  },
  tags: ['arena', 'reflex'],
});
