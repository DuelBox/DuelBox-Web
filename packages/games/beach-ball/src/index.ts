import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BeachBallGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new BeachBallGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
