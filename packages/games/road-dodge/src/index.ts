import type { GameModule } from '@duelbox/game-sdk';
import { RoadDodgeGame } from './game.js';
import { manifest } from './manifest.js';

export { manifest } from './manifest.js';
export { RoadDodgeGame } from './game.js';
export * from './rules.js';

const module: GameModule = {
  manifest,
  create: () => new RoadDodgeGame(),
};

export default module;
