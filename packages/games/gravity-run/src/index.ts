import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { GravityRunGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new GravityRunGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
