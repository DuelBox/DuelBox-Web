import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { CarromGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new CarromGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
