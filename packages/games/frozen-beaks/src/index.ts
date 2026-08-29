import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { FrozenBeaksGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new FrozenBeaksGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
