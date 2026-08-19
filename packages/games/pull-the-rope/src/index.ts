import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { PulltheRopeGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new PulltheRopeGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
