import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { LumberjackGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new LumberjackGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
