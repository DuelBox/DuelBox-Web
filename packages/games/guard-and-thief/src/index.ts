import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { GuardandThiefGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new GuardandThiefGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
