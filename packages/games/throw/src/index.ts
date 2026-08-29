import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { SnowballThrowGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new SnowballThrowGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
