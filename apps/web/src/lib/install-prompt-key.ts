import { KEY_PREFIX } from './local-store';

/**
 * The install offer's storage key and the event that wakes it (#195), apart from the store
 * for the reason `key-bindings-key.ts` and `control-hints-key.ts` give: the root layout's
 * bridge has to name the event, and `player-data.ts` the key, without either of them pulling
 * the store — and its decision — onto every route. The store is fetched when a match ends.
 */
export const INSTALL_KEY = `${KEY_PREFIX}install`;

/** Fired on `window` by `PlaySurface` once a result has been recorded. */
export const MATCH_FINISHED = 'duelbox:matchfinished';

/**
 * The event Chromium fires on an installable page, held rather than acted on (#195).
 *
 * Not in `lib.dom.d.ts`, because only Chromium and its relatives fire it; WebKit never
 * will, which is why the feature is a no-op there and `e2e/install-prompt.spec.ts` is
 * Chromium-only. The shape is the one every browser that fires it implements: `prompt()`
 * shows the browser's own sheet, `userChoice` says what was pressed on it.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}
