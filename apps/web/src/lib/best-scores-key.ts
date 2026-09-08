import { KEY_PREFIX } from './local-store';

/**
 * Where a solo run's best scores live (#1750), apart from the store for the reason
 * `key-bindings-key.ts` gives: `player-data.ts` is loaded eagerly by `/settings/` and wants
 * the string and nothing else, and the store is only ever needed on a result screen.
 */
export const BEST_SCORES_KEY = `${KEY_PREFIX}best-scores`;
