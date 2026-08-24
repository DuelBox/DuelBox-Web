import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { ArcheryMasterGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new ArcheryMasterGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
