import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { StampedeGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new StampedeGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
