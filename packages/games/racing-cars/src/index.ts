import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { RacingCarsGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new RacingCarsGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
