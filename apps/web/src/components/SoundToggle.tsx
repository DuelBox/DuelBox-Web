'use client';

import { t } from '@/lib/i18n/messages';
import { useMessages } from '@/lib/i18n/use-messages';
import { useSettings } from '@/lib/use-settings';
import styles from './SoundToggle.module.css';

/**
 * The subscription every settings control shares moved to `lib/use-settings.ts` so the locale
 * provider can use it without a cycle through this component; both names are re-exported here
 * so the settings page, and anything else that imported them from the first control that had
 * them, is unchanged.
 */
export { notifySettingsChanged, useSettings } from '@/lib/use-settings';

/**
 * Mute and unmute, as a toggle button (#171).
 *
 * It sits in the site header and in the match HUD, and the settings page has a switch for the
 * same value, so one screen can show the same setting two or three times over. Storage is the
 * only source of truth for it and `useSettings` is how every copy reads and writes it.
 *
 * The label names the action the press will take and `aria-pressed` carries the state, so a
 * screen reader hears "Unmute sound, pressed" while muted and a sighted player sees the
 * crossed-out speaker. Two signals on purpose: the glyph alone is 17px of emoji, and the emoji
 * alone is drawn differently on every platform.
 *
 * Those two labels are the first strings through the i18n framework (#219), chosen because they
 * are the hardest case rather than the easiest: this button is in the site header on every page
 * and in the match HUD, so a language chosen on `/settings/` has to reach it without a reload.
 * In English `t` returns the identical string the literal did — `e2e/settings.spec.ts` asserts
 * on exactly "Mute sound" and "Unmute sound" in both places, which is what turns "the default
 * locale is unchanged" into something CI checks — and `e2e/i18n.spec.ts` asserts the pseudo
 * rendering of the same label after a switch. Two calls rather than one with a conditional id,
 * so that each English string is a literal the extractor reads by shape (`extract.ts`). The rest
 * of the site's copy is #220 and is deliberately untouched here.
 */
export function SoundToggle({ className }: { className?: string | undefined }) {
  const [settings, update] = useSettings();
  const messages = useMessages();
  const { muted } = settings;
  return (
    <button
      type="button"
      className={className === undefined ? styles.toggle : `${styles.toggle} ${className}`}
      aria-pressed={muted}
      aria-label={muted ? t(messages, 'Unmute sound') : t(messages, 'Mute sound')}
      onClick={() => {
        update({ muted: !muted });
      }}
    >
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
    </button>
  );
}
