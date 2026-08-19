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
};

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
