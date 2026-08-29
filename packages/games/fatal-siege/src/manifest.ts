import { parseGameManifest } from '@duelbox/game-sdk';
import type { GameManifest } from '@duelbox/game-sdk';
import { BOARD } from './rules.js';

export const manifest: GameManifest = parseGameManifest({
  id: 'fatal-siege',
  name: 'Fatal Siege',
  category: 'Arena',
  archetype: 'rt-arena',
  // Taken from the rules rather than repeated, so the simulation and the box it is drawn in
  // can never disagree. Square, and every wall, road and band on it maps onto its opposite
  // number through the centre — so the field is the same picture upside down and neither seat
  // has an easier half of it. Both are logical units; neither is a pixel.
  logical: { width: BOARD, height: BOARD },
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  orientation: 'any',
  // Both seats fire at every moment and each owns the end of the device its own wall stands
  // at, so a touch belongs to the half it went down in. This is also what `GameHost` actually
  // does with an `rt-*` game whatever the manifest says, so declaring `shared-board` would be
  // a lie the shell then contradicts — and it costs this game nothing, because the control is
  // a press with no position and there is nothing on the far half to reach for.
  zoneSplit: 'horizontal',
  // Measured rather than guessed: the longest match anybody can play at all is 33.8 s — a
  // fixed army walking a fixed field at a fixed speed — and over 18 000 bot matches the nine
  // tier pairings mean 33.0 to 33.7 seconds. Unlike a game paced by its players, this one has
  // almost no spread: the wave is the clock. The catalogue card carries its own figure, from
  // data/catalog.yaml, which predates the build.
  roundSeconds: 34,
  // Required, and deliberately not optional: the shell shows this before the match and again
  // from the pause menu, so a game without it would advertise nothing to a player holding a
  // keyboard. Written for a player rather than as a spec — and true of what the code does,
  // which is the part that keeps getting shipped wrong.
  controls: {
    keyboard:
      'Space is player one and Enter is player two — press to keep a road, hold to shoot farther',
    pointer:
      'Press in your own half to stop your gun, keep holding to shoot farther, let go to fire',
  },
  tags: ['arena', 'timing'],
});
