import { KEY_PREFIX } from './local-store';

/**
 * Which games have shown their first-play hints on this device (#137).
 *
 * Apart from `control-hints.ts` for the reason `key-bindings-key.ts` gives: a module that
 * only wants the string should not have to import the store to name it. This one costs less
 * than that one did — `control-hints.ts` reaches no further than `local-store.ts` — and the
 * two are kept the same shape deliberately, so the next store added here is added the same
 * way rather than the cheap way that turns out to be expensive.
 */
export const HINTS_SEEN_KEY = `${KEY_PREFIX}hints-seen`;
