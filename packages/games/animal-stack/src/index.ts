import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { AnimalStackGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new AnimalStackGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
