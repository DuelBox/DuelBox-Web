import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, readSettings, writeSettings, type Settings } from './settings';
import { applySeatPalette, applySeatSwap, applyTheme } from './theme';

/**
 * The subscription every settings control shares (#171, #135, #76, #174, #219).
 *
 * The mute sits in the site header and in the match HUD, and the settings page has a switch
 * for the same value, so one screen can show the same setting two or three times over. Storage
 * is the only source of truth for it, and a control that kept a copy of its own would be the one
 * that disagreed with the others after a tap on any of them. So every control reads storage on
 * mount, tells the rest whenever it writes, and takes what it is told — a module-level set of
 * listeners rather than a store, because a handful of controls sharing one record is not what a
 * store is for.
 *
 * ## Why this is its own module
 *
 * It lived in `components/SoundToggle.tsx`, which is where the first control was. The locale
 * provider (`lib/i18n/provider.tsx`) needs the same subscription — the language is a setting,
 * and the provider is a settings control that renders no control — and a provider that imported
 * `SoundToggle` for a hook would have `lib/i18n` importing `components`, and `SoundToggle`
 * importing `lib/i18n` for its labels: a cycle through the module every settings control in the
 * product depends on. `SoundToggle` re-exports both names, so nothing that imported them from
 * there has to change.
 */

type Listener = (settings: Settings) => void;

const listeners = new Set<Listener>();

/**
 * Tells every mounted settings control what the settings now are.
 *
 * The value is handed over rather than re-read from storage so that a write storage refused —
 * private browsing on an older engine, a full quota — still reaches the speaker and every button
 * on the page: what the player sees and hears should be what they just did, and the setting
 * failing to survive a reload is a separate, smaller matter. Called with no argument by the
 * settings page after an import or an erase, where storage is the only place the new value
 * exists.
 */
export function notifySettingsChanged(settings: Settings = readSettings()): void {
  for (const listener of listeners) listener(settings);
}

/**
 * The stored settings, kept current, and a way to change them.
 *
 * The defaults render first and the stored values replace them once mounted: the page is
 * statically exported, and reading storage during render would make the server's HTML and the
 * browser's first paint disagree. A change from any control on the page arrives through
 * {@link notifySettingsChanged}; a change from another tab arrives as the browser's own
 * `storage` event. Both push the level into the audio system as well as into React state, so a
 * mute chosen in the header or in another tab reaches the speaker without each control having
 * to remember to do it.
 *
 * Nothing is applied on mount, deliberately: `audio()` builds the system from storage the first
 * time anything asks for it, so applying the same values again would only construct it early on
 * pages that never make a sound. The locale is the one setting that *is* applied on mount, and
 * it is applied by the provider rather than here, because it has to be applied on a plain page
 * load where nothing has changed — see `lib/i18n/provider.tsx`.
 *
 * ## The third element: whether storage has been read yet
 *
 * The defaults are what the first render holds, and for one render they are indistinguishable from
 * a stored choice that happens to equal them. The provider needs to tell the two apart: it stamps
 * `lang` and `dir` on `<html>` from the locale, and stamping the *default* over a stored
 * right-to-left choice flips the shell the inline script in `layout.tsx` had already put the right
 * way round. That is not a hypothetical — it was measured on the built export with a
 * `MutationObserver` on `<html>`, ar-XB stored: on every route, on Chromium and WebKit, the
 * document went `ar-XB/rtl → en/ltr → ar-XB/rtl` within 40 ms of `load`, WebKit held the wrong
 * values for 10–44 ms, and on two of the four routes probed it painted a frame that way. So the
 * tuple carries a `loaded` flag that turns true in the same effect that reads storage, and the
 * provider applies nothing until it does. The theme has never needed one because `applyTheme` is
 * called only from the change listener, never on mount; the locale has to be applied on a plain
 * load, which is what makes the distinction load-bearing here. Controls that only render the
 * settings ignore the flag, as `SoundToggle` and `SettingsPanel` do.
 *
 * **The audio module is reached by `import()` rather than by an import at the top.** This hook
 * runs in the site header, which is on every page, and `lib/audio` pulls `AudioSystem` — the
 * whole synthesiser — out of the engine, which belongs to the play route and not to a visitor
 * reading the catalogue.
 *
 * Measured before it was believed: with a static import here the shell came out one byte
 * smaller, so today this buys nothing and webpack was already keeping the synthesiser out of
 * every non-play chunk. It stays because it makes that independent of a bundler's judgement,
 * and because the cost is a microtask on the one gesture that changes a level, on a page where
 * the module is usually loaded already. It is insurance, not a saving, and `size-budget.json`
 * records it as insurance.
 */
export function useSettings(): readonly [Settings, (patch: Partial<Settings>) => void, boolean] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSettings(readSettings());
    setLoaded(true);
    const listener: Listener = (next) => {
      setSettings(next);
      // The colour scheme and the shell's seat palette are put into effect here as well as
      // into React state, so a choice made on the settings page reaches every open surface
      // the moment it changes rather than on the next load — the same argument the level
      // uses just below. The inline script in `layout.tsx` handles both before the first
      // paint; this handles them after. The swap (#161) rides along with the palette for the
      // same reason and through the same one attribute. The games take the seat palette and
      // the swap through the engine, which `GameHost` selects at match start.
      applyTheme(next.theme);
      applySeatPalette(next.seatPalette);
      applySeatSwap(next.seatSwap);
      void import('./audio').then((module) => {
        module.applySoundSettings(next);
      });
    };
    const onStorage = (): void => {
      listener(readSettings());
    };
    listeners.add(listener);
    globalThis.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      globalThis.removeEventListener('storage', onStorage);
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    notifySettingsChanged(writeSettings(patch));
  }, []);

  return [settings, update, loaded];
}
