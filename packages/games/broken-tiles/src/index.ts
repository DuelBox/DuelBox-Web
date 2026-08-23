import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BrokenTilesGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new BrokenTilesGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
