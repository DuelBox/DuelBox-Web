import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { SeaBattleGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new SeaBattleGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
