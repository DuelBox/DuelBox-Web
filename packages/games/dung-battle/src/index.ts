import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { DungBattleGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new DungBattleGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
