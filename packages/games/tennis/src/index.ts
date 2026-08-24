import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { TennisGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new TennisGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
