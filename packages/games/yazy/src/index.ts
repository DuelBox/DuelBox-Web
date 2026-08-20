import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { YazyGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new YazyGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
