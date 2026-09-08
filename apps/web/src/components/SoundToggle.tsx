'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, readSettings, writeSettings, type Settings } from '@/lib/settings';
import { applySeatPalette, applySeatSwap, applyTheme } from '@/lib/theme';
import styles from './SoundToggle.module.css';

/**
 * The one-tap mute (#171), and the subscription every sound control shares.
 *
 * It sits in the site header and in the match HUD, and the settings page has a switch for
 * the same value, so one screen can show the same setting two or three times over. Storage
 * is the only source of truth for it, and a control that kept a copy of its own would be
 * the one that disagreed with the others after a tap on any of them. So every control
 * reads storage on mount, tells the rest whenever it writes, and takes what it is told —
 * a module-level set of listeners rather than a store, because three controls sharing one
 * boolean is not what a store is for.
 */

type Listener = (settings: Settings) => void;

const listeners = new Set<Listener>();

/**
 * Tells every mounted sound control what the settings now are.
 *
 * The value is handed over rather than re-read from storage so that a write storage
 * refused — private browsing on an older engine, a full quota — still reaches the speaker
 * and every button on the page: what the player sees and hears should be what they just
 * did, and the setting failing to survive a reload is a separate, smaller matter. Called
 * with no argument by the settings page after an import or an erase, where storage is the
 * only place the new value exists.
 */
export function notifySettingsChanged(settings: Settings = readSettings()): void {
  for (const listener of listeners) listener(settings);
}

/**
 * The stored settings, kept current, and a way to change them.
 *
 * The defaults render first and the stored values replace them once mounted: the page is
 * statically exported, and reading storage during render would make the server's HTML and
 * the browser's first paint disagree. A change from any control on the page arrives
 * through {@link notifySettingsChanged}; a change from another tab arrives as the
 * browser's own `storage` event. Both push the level into the audio system as well as
 * into React state, so a mute chosen in the header or in another tab reaches the speaker
 * without each control having to remember to do it.
 *
 * Nothing is applied on mount, deliberately: `audio()` builds the system from storage the
 * first time anything asks for it, so applying the same values again would only construct
 * it early on pages that never make a sound.
 *
 * **The audio module is reached by `import()` rather than by an import at the top.** This
 * hook runs in the site header, which is on every page, and `lib/audio` pulls
 * `AudioSystem` — the whole synthesiser — out of the engine, which belongs to the play
 * route and not to a visitor reading the catalogue.
 *
 * Measured before it was believed: with a static import here the shell came out one byte
 * smaller, so today this buys nothing and webpack was already keeping the synthesiser out
 * of every non-play chunk. It stays because it makes that independent of a bundler's
 * judgement, and because the cost is a microtask on the one gesture that changes a level,
 * on a page where the module is usually loaded already. It is insurance, not a saving,
 * and `size-budget.json` records it as insurance.
 */
export function useSettings(): readonly [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(readSettings());
    const listener: Listener = (next) => {
      setSettings(next);
      // The colour scheme and the shell's seat palette are put into effect here as well as
      // into React state, so a choice made on the settings page reaches every open surface
      // the moment it changes rather than on the next load — the same argument the level
      // uses just below. The inline script in `layout.tsx` handles both before the first
      // paint; this handles them after. The games take the seat palette through the engine,
      // which `GameHost` selects at match start.
      applyTheme(next.theme);
      applySeatPalette(next.seatPalette);
      applySeatSwap(next.seatSwap);
      void import('@/lib/audio').then((module) => {
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

  return [settings, update];
}

/**
 * Mute and unmute, as a toggle button.
 *
 * The label names the action the press will take and `aria-pressed` carries the state, so
 * a screen reader hears "Unmute sound, pressed" while muted and a sighted player sees the
 * crossed-out speaker. Two signals on purpose: the glyph alone is 17px of emoji, and the
 * emoji alone is drawn differently on every platform.
 */
export function SoundToggle({ className }: { className?: string | undefined }) {
  const [settings, update] = useSettings();
  const { muted } = settings;
  return (
    <button
      type="button"
      className={className === undefined ? styles.toggle : `${styles.toggle} ${className}`}
      aria-pressed={muted}
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      onClick={() => {
        update({ muted: !muted });
      }}
    >
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
    </button>
  );
}
