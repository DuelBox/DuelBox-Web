/**
 * Each playable game's controls, for the landing page.
 *
 * The manifest is the single source for what a game's keys and pointer do, and the play
 * page already reads it. The landing page is a *server* component of a static export, so
 * importing the manifests here costs the browser nothing: only the rendered HTML ships.
 *
 * A manifest imports the SDK's validator and nothing else — no game code, no simulation —
 * so this pulls in a schema, not a hundred games.
 */
import { manifest as airHockey } from '@duelbox/game-air-hockey';
import { manifest as bowling } from '@duelbox/game-bowling';
import { manifest as checkers } from '@duelbox/game-checkers';
import { manifest as colorWars } from '@duelbox/game-color-wars';
import { manifest as cornhole } from '@duelbox/game-cornhole';
import { manifest as crabbyVolley } from '@duelbox/game-crabby-volley';
import { manifest as darts } from '@duelbox/game-darts';
import { manifest as dotsAndBoxes } from '@duelbox/game-dots-and-boxes';
import { manifest as fourInARow } from '@duelbox/game-four-in-a-row';
import { manifest as handSlap } from '@duelbox/game-hand-slap';
import { manifest as hotPotato } from '@duelbox/game-hot-potato';
import { manifest as kingOfTheYard } from '@duelbox/game-king-of-the-yard';
import { manifest as ludo } from '@duelbox/game-ludo';
import { manifest as mancala } from '@duelbox/game-mancala';
import { manifest as memory } from '@duelbox/game-memory';
import { manifest as miniSoccer } from '@duelbox/game-mini-soccer';
import { manifest as pool } from '@duelbox/game-pool';
import { manifest as popIt } from '@duelbox/game-pop-it';
import { manifest as pullTheRope } from '@duelbox/game-pull-the-rope';
import { manifest as reversi } from '@duelbox/game-reversi';
import { manifest as roadDodge } from '@duelbox/game-road-dodge';
import { manifest as rockPaperScissors } from '@duelbox/game-rock-paper-scissors';
import { manifest as seaBattle } from '@duelbox/game-sea-battle';
import { manifest as shutTheBox } from '@duelbox/game-shut-the-box';
import { manifest as sumo } from '@duelbox/game-sumo';
import { manifest as ticTacToe } from '@duelbox/game-tic-tac-toe';
import { manifest as ultimateTtt } from '@duelbox/game-ultimate-ttt';
import { manifest as yazy } from '@duelbox/game-yazy';
import { manifest as whackAMole } from '@duelbox/game-whack-a-mole';
import type { GameManifest } from '@duelbox/game-sdk';

export const MANIFESTS: readonly GameManifest[] = [
  airHockey,
  bowling,
  checkers,
  colorWars,
  cornhole,
  crabbyVolley,
  darts,
  dotsAndBoxes,
  fourInARow,
  handSlap,
  hotPotato,
  kingOfTheYard,
  ludo,
  mancala,
  memory,
  miniSoccer,
  popIt,
  pool,
  pullTheRope,
  reversi,
  roadDodge,
  rockPaperScissors,
  seaBattle,
  shutTheBox,
  sumo,
  ticTacToe,
  ultimateTtt,
  whackAMole,
  yazy,
];

export interface GameControls {
  readonly keyboard: string;
  readonly pointer: string;
}

/** Controls by slug, for every game that has a playable build. */
export const CONTROLS: ReadonlyMap<string, GameControls> = new Map(
  MANIFESTS.map((manifest) => [manifest.id, manifest.controls]),
);
