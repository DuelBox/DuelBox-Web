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
import { manifest as paintFight } from '@duelbox/game-paint-fight';
import { manifest as penaltyKicks } from '@duelbox/game-penalty-kicks';
import { manifest as popIt } from '@duelbox/game-pop-it';
import { manifest as pullTheRope } from '@duelbox/game-pull-the-rope';
import { manifest as reversi } from '@duelbox/game-reversi';
import { manifest as roadDodge } from '@duelbox/game-road-dodge';
import { manifest as rockPaperScissors } from '@duelbox/game-rock-paper-scissors';
import { manifest as seaBattle } from '@duelbox/game-sea-battle';
import { manifest as shutTheBox } from '@duelbox/game-shut-the-box';
import { manifest as snakes } from '@duelbox/game-snakes';
import { manifest as sumo } from '@duelbox/game-sumo';
import { manifest as ticTacToe } from '@duelbox/game-tic-tac-toe';
import { manifest as ultimateTtt } from '@duelbox/game-ultimate-ttt';
import { manifest as yazy } from '@duelbox/game-yazy';
import { manifest as whackAMole } from '@duelbox/game-whack-a-mole';
import { manifest as pingPong } from '@duelbox/game-ping-pong';
import { manifest as knifeThrower } from '@duelbox/game-knife-thrower';
import { manifest as mathQuiz } from '@duelbox/game-math-quiz';
import { manifest as fruitDuel } from '@duelbox/game-fruit-duel';
import { manifest as lumberJack } from '@duelbox/game-lumber-jack';
import { manifest as robotArena } from '@duelbox/game-robot-arena';
import { manifest as flappyJump } from '@duelbox/game-flappy-jump';
import { manifest as cannonDuel } from '@duelbox/game-cannon-duel';
import { manifest as slotCars } from '@duelbox/game-slot-cars';
import { manifest as gravityRun } from '@duelbox/game-gravity-run';
import { manifest as match } from '@duelbox/game-match';
import { manifest as frogsFight } from '@duelbox/game-frogs-fight';
import { manifest as brokenTiles } from '@duelbox/game-broken-tiles';
import { manifest as starCatcher } from '@duelbox/game-star-catcher';
import { manifest as hammerHit } from '@duelbox/game-hammer-hit';
import { manifest as spikeAttacks } from '@duelbox/game-spike-attacks';
import { manifest as slingPuck } from '@duelbox/game-sling-puck';
import { manifest as tankBattle } from '@duelbox/game-tanks';
import { manifest as wheelie } from '@duelbox/game-wheelie';
import { manifest as cupPong } from '@duelbox/game-cup-pong';
import { manifest as snakesLadders } from '@duelbox/game-snakes-ladders';
import { manifest as miniGolf } from '@duelbox/game-mini-golf';
import { manifest as beachBall } from '@duelbox/game-beach-ball';
import { manifest as wrestle } from '@duelbox/game-wrestle';
import { manifest as racingCars } from '@duelbox/game-racing-cars';
import { manifest as shipBattle } from '@duelbox/game-ship-battle';
import { manifest as backgammon } from '@duelbox/game-backgammon';
import { manifest as archery } from '@duelbox/game-archery';
import { manifest as basketball } from '@duelbox/game-basketball';
import { manifest as carrom } from '@duelbox/game-carrom';
import { manifest as chickenJump } from '@duelbox/game-chicken-jump';
import { manifest as lightFingers } from '@duelbox/game-light-fingers';
import { manifest as spinWar } from '@duelbox/game-spin-war';
import { manifest as taxiRace } from '@duelbox/game-taxi-race';
import { manifest as trafficJam } from '@duelbox/game-traffic-jam';
import { manifest as shuriken } from '@duelbox/game-shuriken';
import { manifest as soccerPool } from '@duelbox/game-soccer-pool';
import { manifest as happyBirds } from '@duelbox/game-happy-birds';
import { manifest as ratRace } from '@duelbox/game-rat-race';
import { manifest as brickBlast } from '@duelbox/game-brick-blast';
import type { GameManifest } from '@duelbox/game-sdk';
import { CATALOGUE } from './catalogue.generated';

export const MANIFESTS: readonly GameManifest[] = [
  airHockey,
  archery,
  backgammon,
  basketball,
  beachBall,
  bowling,
  brickBlast,
  brokenTiles,
  cannonDuel,
  carrom,
  checkers,
  chickenJump,
  colorWars,
  cornhole,
  crabbyVolley,
  cupPong,
  darts,
  dotsAndBoxes,
  flappyJump,
  fourInARow,
  frogsFight,
  fruitDuel,
  gravityRun,
  hammerHit,
  handSlap,
  happyBirds,
  hotPotato,
  kingOfTheYard,
  knifeThrower,
  lightFingers,
  ludo,
  lumberJack,
  mancala,
  match,
  mathQuiz,
  memory,
  miniGolf,
  miniSoccer,
  paintFight,
  penaltyKicks,
  pingPong,
  pool,
  popIt,
  pullTheRope,
  racingCars,
  ratRace,
  reversi,
  roadDodge,
  robotArena,
  rockPaperScissors,
  seaBattle,
  shipBattle,
  shuriken,
  shutTheBox,
  slingPuck,
  slotCars,
  snakes,
  snakesLadders,
  soccerPool,
  spikeAttacks,
  spinWar,
  starCatcher,
  sumo,
  tankBattle,
  taxiRace,
  ticTacToe,
  trafficJam,
  ultimateTtt,
  whackAMole,
  wheelie,
  wrestle,
  yazy,
];

export interface GameControls {
  readonly keyboard: string;
  readonly pointer: string;
}

/**
 * Controls by **slug**, for every game that has a playable build.
 *
 * By slug rather than by package id because the page that reads this is `/games/[slug]/`
 * and it looks its game up by slug. Keyed by id, `CONTROLS.get(game.slug)` returned nothing
 * for the eighteen games whose two names differ, so their pages showed no controls at all —
 * the same mismatch that made eleven of them unplayable. See the note in `registry.ts`.
 */
const SLUG_BY_ID: ReadonlyMap<string, string> = new Map(
  CATALOGUE.map((entry) => [entry.id, entry.slug]),
);

export const CONTROLS: ReadonlyMap<string, GameControls> = new Map(
  MANIFESTS.map((manifest) => [SLUG_BY_ID.get(manifest.id) ?? manifest.id, manifest.controls]),
);
