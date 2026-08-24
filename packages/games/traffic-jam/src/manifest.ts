import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';
import { ARENA_HEIGHT, ARENA_WIDTH } from './rules.js';

export const manifest: GameManifest = parseGameManifest({
  id: 'traffic-jam',
  name: 'Traffic Jam',
  category: 'Puzzle',
  archetype: 'rt-race',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  // One island, read by both seats, in the middle of a portrait box. Taken from the rules
  // module rather than typed again, so the simulation and the letterbox cannot drift apart.
  logical: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
  orientation: 'portrait',
  // The board is shared but the *pointer surface* is not, and this is the honest half of
  // that: the host gives a game with no active seat a horizontal split, so a touch belongs
  // to whichever half of the glass it went down in. The controls below say so in words.
  zoneSplit: 'horizontal',
  // What the catalogue card advertises, not a clock that ends anything. The rules call the
  // match at 110 s as a backstop; see SPEC.md for the measured spread.
  roundSeconds: 45,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'W A S D steers player one, the arrow keys steer player two',
    pointer: 'Press your own half of the screen and drag — the car turns the way you drag',
  },
  tags: ['arena', 'reflex'],
  // Deliberately *not* `sameInputClassOnly`. The one thing a seat ever says is *which way to
  // point*, and a finger, a key and a bot all turn the car at exactly TURN_RATE. There is no
  // press to repeat, so there is nothing a keyboard can repeat faster than a thumb.
});
