import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { TargetPracticeGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new TargetPracticeGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
