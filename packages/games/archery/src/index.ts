import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { ArcheryGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new ArcheryGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
