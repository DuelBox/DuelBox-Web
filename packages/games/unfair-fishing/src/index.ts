import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { UnfairFishingGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new UnfairFishingGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
