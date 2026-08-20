import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { PoolGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new PoolGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
