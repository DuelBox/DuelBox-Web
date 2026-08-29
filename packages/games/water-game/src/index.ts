import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { WaterGameGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new WaterGameGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
