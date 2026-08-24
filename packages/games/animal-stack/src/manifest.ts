import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'animal-stack',
  name: 'Animal Stack',
  category: 'Party',
  archetype: 'rt-split',
  // Two platforms stacked, one per seat, with a strip between them. Taller than it is wide so
  // each half is deep enough for a tower to read on a phone held upright, and wide enough that
  // the crane's full reach plus the widest animal still fits with room either side.
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot', 'solo'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  // Horizontal: each player owns the half of the device nearest them, platform outward.
  zoneSplit: 'horizontal',
  // Measured: a bot match runs 8-22 s, a match nobody plays 10-34 s, and two people who spin
  // every animal and let the crane drop the lot 54 s. So 45 is the honest label for two people
  // who dither. `roundSeconds` ends nothing either way: the animal budget bounds the worst case
  // at 62.1 s and ROUND_SECONDS (80) in the rules catches anything past that.
  roundSeconds: 45,
  // Required, and deliberately not optional: the shell shows this before the match and again
  // from the pause menu, so a game without it would advertise nothing to a player holding a
  // keyboard. Written for a player rather than as a spec.
  //
  // Both lines describe the same single gesture, because there is only one: a tap turns the
  // animal round, a press held and then let go drops it, and left and right walk it. Every
  // clause is driven through the real InputManager and asserted in `game.test.ts` — including
  // that nothing else on the keyboard does anything at all.
  controls: {
    keyboard:
      'Seat one walks with A and D, seat two the left and right arrows; tap to turn, hold and let go to drop',
    pointer:
      'Drag in your own half to walk the animal and lift to drop it; a quick tap turns it round',
  },
  tags: ['party', 'stacking', 'balance'],
});
