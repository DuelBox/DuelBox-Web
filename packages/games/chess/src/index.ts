import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { ChessGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new ChessGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
