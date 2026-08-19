export {
  ARCHETYPES,
  PLAY_MODES,
  PRESENTATIONS,
  ORIENTATIONS,
  ZONE_SPLITS,
  gameManifestSchema,
  parseGameManifest,
} from './manifest.js';
export type { GameManifest, GameArchetype, PlayMode } from './manifest.js';

export type {
  Game,
  GameModule,
  GameContext,
  InputState,
  SeatInput,
  Renderer,
  MatchScore,
} from './contract.js';

export {
  reduce,
  canSend,
  legalEvents,
  initialMatchState,
  roundsToWin,
  isSimulating,
  isBoardVisible,
} from './match.js';
export type { MatchPhase, MatchEvent, MatchEventKind, MatchRules, MatchState } from './match.js';

export { resolve, resolveSimultaneous } from './win-conditions.js';
export type { WinCondition, Outcome, Tally } from './win-conditions.js';
