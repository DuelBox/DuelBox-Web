import { KEY_PREFIX } from './local-store';

/**
 * Where the custom bindings are stored.
 *
 * Apart from `key-bindings.ts` itself, and the reason is bytes rather than tidiness. That
 * module imports `DEFAULT_BINDINGS`, `bindingConflicts` and `otherSeat` from
 * `@duelbox/engine`, and **naming this key used to be enough to pull the engine onto every
 * non-play route**: `player-data.ts` and `SettingsPanel.tsx` want the string and nothing else,
 * they are both loaded eagerly by `/settings/`, and the shell measured 12.7 KB heavier for it
 * — a whole engine on the page a visitor opens to change the volume. `size-budget.json`
 * records the same trap twice for `lib/seats.ts`, which is why the name fields on that page
 * are labelled by seat position.
 *
 * So the key lives here, where it costs a template literal, and `key-bindings.ts` re-exports
 * it so there is still one spelling and one import for anybody who wants the store as well.
 */
export const KEY_BINDINGS_KEY = `${KEY_PREFIX}key-bindings`;
