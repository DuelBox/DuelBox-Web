export {
  ARCHETYPES,
  PLAY_MODES,
  PRESENTATIONS,
  ORIENTATIONS,
  ZONE_SPLITS,
  GAME_OPTION_TYPES,
  DEVICE_CLASSES,
  gameManifestSchema,
  gameOptionSchema,
  parseGameManifest,
  supportedPresentations,
  supportsViewport,
  supportsDeviceClass,
} from './manifest.js';
export type {
  GameManifest,
  GameArchetype,
  PlayMode,
  GameOption,
  GameOptionType,
  DeviceClass,
} from './manifest.js';

export type {
  Game,
  GameModule,
  GameContext,
  InputState,
  SeatInput,
  Renderer,
  MatchScore,
} from './contract.js';

export { defaultLayout, resolveLayout, placeLayout, mirrorRect } from './layout.js';
export type {
  LayoutRect,
  ControlRole,
  ControlZone,
  HudSlot,
  GameLayout,
  LayoutContext,
  LayoutAware,
  PlacedZone,
  PlacedLayout,
} from './layout.js';

export { createPresentationToggle, otherPresentation } from './presentation-toggle.js';
export type { PresentationToggle } from './presentation-toggle.js';

export {
  reduce,
  canSend,
  legalEvents,
  initialMatchState,
  openingSeatFor,
  roundsToWin,
  isSimulating,
  isBoardVisible,
} from './match.js';
export type { MatchPhase, MatchEvent, MatchEventKind, MatchRules, MatchState } from './match.js';

export { resolve, resolveSimultaneous } from './win-conditions.js';
export type { WinCondition, Outcome, Tally } from './win-conditions.js';

export {
  commit,
  createJudgement,
  invalidate,
  misjudgement,
  resetJudgement,
  shouldDecide,
} from './bot-judgement.js';
export type { Judgement } from './bot-judgement.js';

export { SearchBudget, DEFAULT_SEARCH_NODES, deepen } from './search-budget.js';

export {
  createClock,
  advanceClock,
  clockElapsed,
  clockRemaining,
  clockExpired,
  clockWarning,
  resetClock,
  formatClock,
} from './match-clock.js';
export type { MatchClock } from './match-clock.js';

export {
  BOT_TIERS,
  BOT_DIFFICULTIES,
  isBotTier,
  difficultyForTier,
  isStronger,
} from './bot-difficulty.js';
export type { BotTier, BotDifficulty } from './bot-difficulty.js';

export { guard, errorMessage } from './guard.js';

export { actionAbandoned } from './gesture.js';

export { sanitisePlayerName, isValidPlayerName, MAX_NAME_LENGTH } from './player-text.js';
export type { SanitiseResult, SanitiseReason } from './player-text.js';
