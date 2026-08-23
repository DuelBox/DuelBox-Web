import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BasketballGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new BasketballGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
