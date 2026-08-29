import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { GolfFootballGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new GolfFootballGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
