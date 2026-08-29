import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { DiscoBattleGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new DiscoBattleGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
