import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { FrogsFightGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new FrogsFightGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
