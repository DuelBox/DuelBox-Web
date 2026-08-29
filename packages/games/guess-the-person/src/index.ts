import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { GuessWhoGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new GuessWhoGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
