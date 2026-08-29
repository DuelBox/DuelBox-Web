import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { FatalSiegeGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new FatalSiegeGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
