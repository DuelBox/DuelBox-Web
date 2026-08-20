import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { LudoGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new LudoGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
