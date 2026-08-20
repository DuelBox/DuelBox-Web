import type { Game, GameManifest } from '@duelbox/game-sdk';

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
  'rock-paper-scissors': () =>
    import('@duelbox/game-rock-paper-scissors').then((m) => m.default),
};

/**
 * The loader table, for tests that must cover every playable game rather than a list
 * someone remembered to update. Exported for that purpose only — the shell loads games
 * through `loadGame`.
 */
export const LOADERS_FOR_TEST: Readonly<Record<string, Loader>> = LOADERS;

/** Slugs that are actually playable today, for the catalogue to mark. */
export const PLAYABLE: readonly string[] = Object.keys(LOADERS);

export function isPlayable(slug: string): boolean {
  return slug in LOADERS;
}

export async function loadGame(slug: string): Promise<LoadedGame> {
  const loader = LOADERS[slug];
  if (!loader) throw new Error(`No playable build for "${slug}"`);
  return loader();
}
