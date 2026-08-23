import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { ShipBattleGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new ShipBattleGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
