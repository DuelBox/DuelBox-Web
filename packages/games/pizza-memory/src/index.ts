import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { PizzaMemoryGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new PizzaMemoryGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
