import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { ChickenJumpGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new ChickenJumpGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
