import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { SnakesGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new SnakesGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
