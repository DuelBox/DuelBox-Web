import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';

export const manifest: GameManifest = parseGameManifest({
  id: 'gravity-run',
  name: 'Gravity Run',
  category: 'Platform',
  archetype: 'rt-split',
  // A lane each, one above the other. Taller than it is wide so both corridors are deep
  // enough for a fall to be readable on a phone held upright.
  logical: { width: 600, height: 1000 },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'portrait',
  zoneSplit: 'horizontal',
  // The rules call the race at 120 s; this is what the catalogue card advertises, and a
  // race that goes the distance is unheard of — ninety cells lands nearer half a minute.
  roundSeconds: 60,
  // Required, and deliberately not optional: the shell shows this before the match and
  // again from the pause menu, so a game without it would advertise nothing to a player
  // holding a keyboard. Written for a player rather than as a spec.
  controls: {
    keyboard: 'Seat one flips gravity with W A S D or Space, seat two with the arrow keys or Enter',
    pointer: 'Touch your own lane — the half nearest you is the floor, the far half the ceiling',
  },
  tags: ['runner', 'reflex', 'race'],
});
