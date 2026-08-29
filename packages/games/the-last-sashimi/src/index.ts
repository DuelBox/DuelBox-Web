import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { TheLastSashimiGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new TheLastSashimiGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
