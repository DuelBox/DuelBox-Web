import type { Game, GameModule } from '@duelbox/game-sdk';
import { BrickBlastGame } from './game.js';
import { manifest } from './manifest.js';

function create(): Game {
  return new BrickBlastGame();
}

export const gameModule: GameModule = { manifest, create };

export { manifest };
export { BrickBlastGame, MATCH_SECONDS, POINT_TARGET, SERVE_STEPS } from './game.js';
export * from './rules.js';

export default gameModule;
