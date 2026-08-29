import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';
import { GROUND } from './rules.js';

export const manifest: GameManifest = parseGameManifest({
  id: 'explosive-festival',
  name: 'Explosive Festival',
  category: 'Arena',
  archetype: 'rt-arena',
  // Taken from the rules rather than repeated, so the simulation and the box it is drawn in
  // can never disagree. Square, and every lantern on it sits opposite another through the
  // centre — so the ground is the same picture upside down and neither seat has an easier
  // half of it. Both are logical units; neither is a pixel.
  logical: { width: GROUND, height: GROUND },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'any',
  // Both seats fire at every moment and each owns the end of the device its cart runs along,
  // so a touch belongs to the half it went down in. This is also what `GameHost` actually
  // does with an `rt-*` game whatever the manifest says, so declaring `shared-board` would be
  // a lie the shell then contradicts — and it costs this game nothing, because the control is
  // a press with no position and there is nothing on the far half to reach for.
  zoneSplit: 'horizontal',
  // Measured rather than guessed: over 18 000 bot matches the nine tier pairings mean 23.6 to
  // 24.3 seconds, 24.0 across all of them, the longest of 1200 was 31.8, and the longest match
  // anybody can play at all is 56.2 — fourteen fuses that burn whether or not anybody presses.
  // The catalogue card carries its own figure, from data/catalog.yaml, which predates the
  // build.
  roundSeconds: 30,
  // Required, and deliberately not optional: the shell shows this before the match and again
  // from the pause menu, so a game without it would advertise nothing to a player holding a
  // keyboard. Written for a player rather than as a spec — and true of what the code does,
  // which is the part that keeps getting shipped wrong.
  controls: {
    keyboard: 'Space is player one and Enter is player two — hold to keep a column, let go to fire',
    pointer: 'Press in your own half to stop your cart, let go to fire. A fuse fires by itself',
  },
  tags: ['arena', 'timing'],
});
