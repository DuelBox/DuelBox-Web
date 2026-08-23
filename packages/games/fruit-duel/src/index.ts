import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { FruitDuelGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new FruitDuelGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
