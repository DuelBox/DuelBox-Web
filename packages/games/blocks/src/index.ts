import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BlocksGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new BlocksGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
