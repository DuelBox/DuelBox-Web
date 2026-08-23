import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { TanksGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new TanksGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
