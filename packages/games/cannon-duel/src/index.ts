import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { CannonDuelGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new CannonDuelGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
