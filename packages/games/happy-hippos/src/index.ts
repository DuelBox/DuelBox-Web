import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { HappyHipposGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new HappyHipposGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
