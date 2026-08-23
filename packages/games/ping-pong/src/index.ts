import type { GameModule } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { PingPongGame } from './game.js';

export const gameModule: GameModule = {
  manifest,
  create: () => new PingPongGame(),
};

export default gameModule;
export { manifest };
export * from './rules.js';
