import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { StarCatcherGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new StarCatcherGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
