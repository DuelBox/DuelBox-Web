import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { ShutTheBoxGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new ShutTheBoxGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
