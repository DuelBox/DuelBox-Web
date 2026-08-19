import type { Game, GameModule } from '@duelbox/game-sdk';
import { PullTheRopeGame } from './game.js';
import { manifest } from './manifest.js';

function create(): Game {
  return new PullTheRopeGame();
}

export const gameModule: GameModule = { manifest, create };

export { manifest };
export { PullTheRopeGame, TUG_STEPS } from './game.js';
export * from './rules.js';

export default gameModule;
