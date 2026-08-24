import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'taxi-race',
  name: 'Taxi Race',
  category: 'Racing',
  archetype: 'rt-race',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // A window on the same road each, one above the other. Portrait, so each is a wide strip
  // the player faces, and each shows exactly the same depth of road ahead of their own taxi
  // (rule 9).
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // What the catalogue card advertises, and it is the *measured* typical rather than the
  // guarantee: over 900 seeded bot races, three hundred at each tier, the median came home
  // in 36 s on hard, 39 s on normal and 44 s on easy, and the slowest of the nine hundred
  // took 51.4 s. The hard backstop is ROUND_SECONDS in the rules, which is 105 s and covers
  // a measured worst case of 66.9 s — `roundSeconds` here ends nothing at all.
  roundSeconds: 45,
  // Required, and deliberately not optional: the shell shows this before the match and again
  // from the pause menu, so a game without it would advertise nothing to a player holding a
  // keyboard. Written for a player rather than as a spec.
  //
  // Every clause names a key the game actually reads. The arrow half is written out as three
  // named arrows rather than "the arrow keys" because the down arrow does nothing — a road
  // runs one way — and `game.test.ts` drives each clause of both lines through the real
  // InputManager and asserts the taxi did what the line promises.
  controls: {
    keyboard:
      'Player one steers with A and D and hops with W; player two with the left, right and up arrows',
    pointer: 'Slide a finger across your own half to pick a lane, and flick it up to hop',
  },
  tags: ['racing', 'reflex'],
  // Deliberately *not* `sameInputClassOnly`, which the other four-lane `rt-race` game
  // declares. Road Dodge's interaction is rapid discrete input — a lane change per press —
  // and no keyboard and thumb are equal at that. Here the steering asks for a *place* rather
  // than a press: a finger names it, a key walks towards it, and both arrive at exactly
  // STEER_SPEED. The one discrete act is the hop, and a hop is wanted about five times in a
  // race rather than several times a second, so nothing is decided by how fast an instrument
  // repeats.
});
