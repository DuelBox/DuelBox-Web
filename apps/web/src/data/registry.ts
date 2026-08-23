import type { Game, GameManifest } from '@duelbox/game-sdk';
import { CATALOGUE } from './catalogue.generated';

/**
 * The playable-game registry.
 *
 * Each entry is a dynamic import, so opening Tic Tac Toe never downloads the air hockey
 * physics. The catalogue metadata lives in `catalogue.generated.ts` and is available
 * without loading any of this — the shell can list, filter and describe all 107 games
 * while shipping the code for none of them.
 */

export interface LoadedGame {
  readonly manifest: GameManifest;
  create(): Game;
}

type Loader = () => Promise<LoadedGame>;

const LOADERS: Record<string, Loader> = {
  'tic-tac-toe': () => import('@duelbox/game-tic-tac-toe').then((m) => m.default),
  'air-hockey': () => import('@duelbox/game-air-hockey').then((m) => m.default),
  'four-in-a-row': () => import('@duelbox/game-four-in-a-row').then((m) => m.default),
  'sumo': () => import('@duelbox/game-sumo').then((m) => m.default),
  'memory': () => import('@duelbox/game-memory').then((m) => m.default),
  'pull-the-rope': () => import('@duelbox/game-pull-the-rope').then((m) => m.default),
  'whack-a-mole': () => import('@duelbox/game-whack-a-mole').then((m) => m.default),
  'dots-and-boxes': () => import('@duelbox/game-dots-and-boxes').then((m) => m.default),
  reversi: () => import('@duelbox/game-reversi').then((m) => m.default),
  darts: () => import('@duelbox/game-darts').then((m) => m.default),
  mancala: () => import('@duelbox/game-mancala').then((m) => m.default),
  'ultimate-ttt': () => import('@duelbox/game-ultimate-ttt').then((m) => m.default),
  'road-dodge': () => import('@duelbox/game-road-dodge').then((m) => m.default),
  checkers: () => import('@duelbox/game-checkers').then((m) => m.default),
  'color-wars': () => import('@duelbox/game-color-wars').then((m) => m.default),
  cornhole: () => import('@duelbox/game-cornhole').then((m) => m.default),
  'mini-soccer': () => import('@duelbox/game-mini-soccer').then((m) => m.default),
  'king-of-the-yard': () => import('@duelbox/game-king-of-the-yard').then((m) => m.default),
  'hot-potato': () => import('@duelbox/game-hot-potato').then((m) => m.default),
  'crabby-volley': () => import('@duelbox/game-crabby-volley').then((m) => m.default),
  'pop-it': () => import('@duelbox/game-pop-it').then((m) => m.default),
  'hand-slap': () => import('@duelbox/game-hand-slap').then((m) => m.default),
  'shut-the-box': () => import('@duelbox/game-shut-the-box').then((m) => m.default),
  'sea-battle': () => import('@duelbox/game-sea-battle').then((m) => m.default),
  yazy: () => import('@duelbox/game-yazy').then((m) => m.default),
  pool: () => import('@duelbox/game-pool').then((m) => m.default),
  bowling: () => import('@duelbox/game-bowling').then((m) => m.default),
  ludo: () => import('@duelbox/game-ludo').then((m) => m.default),
  snakes: () => import('@duelbox/game-snakes').then((m) => m.default),
  'penalty-kicks': () => import('@duelbox/game-penalty-kicks').then((m) => m.default),
  'paint-fight': () => import('@duelbox/game-paint-fight').then((m) => m.default),
  'rock-paper-scissors': () =>
    import('@duelbox/game-rock-paper-scissors').then((m) => m.default),
  'ping-pong': () => import('@duelbox/game-ping-pong').then((m) => m.default),
  'knife-thrower': () => import('@duelbox/game-knife-thrower').then((m) => m.default),
  'math-quiz': () => import('@duelbox/game-math-quiz').then((m) => m.default),
  'fruit-duel': () => import('@duelbox/game-fruit-duel').then((m) => m.default),
  'lumber-jack': () => import('@duelbox/game-lumber-jack').then((m) => m.default),
  'robot-arena': () => import('@duelbox/game-robot-arena').then((m) => m.default),
  'flappy-jump': () => import('@duelbox/game-flappy-jump').then((m) => m.default),
  'cannon-duel': () => import('@duelbox/game-cannon-duel').then((m) => m.default),
  'slot-cars': () => import('@duelbox/game-slot-cars').then((m) => m.default),
  'gravity-run': () => import('@duelbox/game-gravity-run').then((m) => m.default),
  match: () => import('@duelbox/game-match').then((m) => m.default),
  'frogs-fight': () => import('@duelbox/game-frogs-fight').then((m) => m.default),
  'broken-tiles': () => import('@duelbox/game-broken-tiles').then((m) => m.default),
  'star-catcher': () => import('@duelbox/game-star-catcher').then((m) => m.default),
  'hammer-hit': () => import('@duelbox/game-hammer-hit').then((m) => m.default),
  'spike-attacks': () => import('@duelbox/game-spike-attacks').then((m) => m.default),
  'sling-puck': () => import('@duelbox/game-sling-puck').then((m) => m.default),
  'tanks': () => import('@duelbox/game-tanks').then((m) => m.default),
};

/**
 * The loader table, for tests that must cover every playable game rather than a list
 * someone remembered to update. Exported for that purpose only — the shell loads games
 * through `loadGame`.
 *
 * Keyed by **package id**, which is what `create-game` and `register-game` write. The site
 * routes by slug; the two are reconciled below.
 */
export const LOADERS_FOR_TEST: Readonly<Record<string, Loader>> = LOADERS;

/**
 * A game has two names, and the site had been using both.
 *
 * The catalogue gives every game an `id` — the package it lives in — and a `slug` — the
 * word in its URL. For most games they are the same word, and for eighteen of them they are
 * not: Snake Clash is the package `snakes` at `/games/snake-clash/`.
 *
 * **Everything a player touches routes by slug**: the catalogue card's link, the per-game
 * page, the controls lookup. This table was keyed by package id, so `isPlayable('snake-clash')`
 * was false and the card linked to the information page with "still being built" on it.
 * Eleven finished games were unreachable — Snake Clash, Drop Four, Colour Wars, Dice Yatzy,
 * Ludo Dash, Lumberjack, Mancala Pits, Math Duel, Memory Match, Sumo Push and Ultimate Tic
 * Tac Toe — with a `/play/<id>/` route generated that nothing linked to.
 *
 * The loaders stay keyed by package id, because that is what the scaffold writes and what a
 * test failure should name. Everything the site asks is answered in slug terms, and both
 * spellings are accepted so a stale link cannot 404.
 */
const ID_BY_SLUG: ReadonlyMap<string, string> = new Map(
  CATALOGUE.map((entry) => [entry.slug, entry.id]),
);

/** The package id behind a slug, or the argument unchanged if it is already one. */
function resolve(slugOrId: string): string {
  return ID_BY_SLUG.get(slugOrId) ?? slugOrId;
}

/** Slugs that are actually playable today, for the catalogue to mark and the router to build. */
export const PLAYABLE: readonly string[] = CATALOGUE.filter((entry) => entry.id in LOADERS).map(
  (entry) => entry.slug,
);

export function isPlayable(slugOrId: string): boolean {
  return resolve(slugOrId) in LOADERS;
}

export async function loadGame(slugOrId: string): Promise<LoadedGame> {
  const loader = LOADERS[resolve(slugOrId)];
  if (!loader) throw new Error(`No playable build for "${slugOrId}"`);
  return loader();
}
