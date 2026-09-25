import { KEY_PREFIX } from './local-store';

/**
 * Where the catalogue's sort preference is stored, apart from `catalogue-filter.ts` for the
 * reason `key-bindings-key.ts` gives: `player-data.ts` is loaded eagerly by `/settings/` and
 * wants the string and nothing else, and importing the module to get it put the whole filter
 * — the sort comparators, the category chips, the search — on the settings route. MEASURED:
 * 2.3 KB on the shell for a template literal. The store re-exports it, so there is still one
 * spelling.
 */
export const CATALOGUE_KEY = `${KEY_PREFIX}catalogue`;
