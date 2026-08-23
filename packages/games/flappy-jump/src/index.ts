import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { FlappyJumpGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new FlappyJumpGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
