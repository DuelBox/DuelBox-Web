import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'racing-cars',
  name: 'Racing Cars',
  category: 'Racing',
  archetype: 'rt-race',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // A window on the track each, one above the other. Portrait, so each is a wide strip the
  // player faces and each shows exactly the same depth of road ahead of their own car
  // (rule 9).
  logical: { width: 600, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // The rules call the race on distance at 110 s; this is what the catalogue card
  // advertises, and a race that goes the distance is unheard of — sixty-four cells lands
  // nearer three quarters of a minute.
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'A and D steer player one, the left and right arrows steer player two',
    pointer: 'Slide your finger across your own half and the car drives to it',
  },
  tags: ['racing', 'reflex'],
  // Deliberately *not* `sameInputClassOnly`, which the other `rt-race` game declares. Road
  // Dodge's interaction is rapid discrete input — a lane change per press — and no keyboard
  // and thumb are equal at that. This one asks for a *place* rather than a press: a finger
  // names it, a key walks towards it, and both arrive at exactly `STEER_SPEED`. There is
  // nothing to repeat and therefore nothing to repeat faster.
});
