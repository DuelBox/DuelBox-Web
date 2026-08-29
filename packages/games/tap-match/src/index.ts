import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { TapMatchGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new TapMatchGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
