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
  SoundBus,
  SoundEvent,
} from './contract.js';

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

export { actionAbandoned } from './gesture.js';

// Exported because it was written, tested, and then unreachable: nothing outside its own
// test could import it, so it read as available and was not (#2486). Player names are not
// built yet (#161) - there is no name field anywhere in the shell, and the HUD's "Pip" is a
// fixed seat colour rather than anything a player chose - so this has no caller today. It is
// exported rather than deleted because the work is done and correct, and a tree-shaking
// bundler charges nothing for an unused export.
//
// **It is a character allowlist, not a profanity filter.** It stops control characters, bidi
// overrides and homoglyph tricks; it does not stop a real word. Whoever builds #161 must not
// read the presence of this file as the word-filter half being done - and if names ever
// become shareable (#164's share card would do that), the word filter is separate work.
export { sanitisePlayerName, isValidPlayerName, MAX_NAME_LENGTH } from './player-text.js';
export type { SanitiseResult, SanitiseReason } from './player-text.js';
