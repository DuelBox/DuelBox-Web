import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { MatchRushGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new MatchRushGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
