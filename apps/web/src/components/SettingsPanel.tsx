'use client';

import { useCallback, useEffect, useId, useState, type ChangeEvent } from 'react';
import { clearFavourites, FAVOURITES_KEY } from '@/lib/favourites';
import { hapticsSupported, vibrate } from '@/lib/haptics';
import { LAST_MODE_KEY } from '@/lib/last-mode';
import {
  exportPlayerData,
  importPlayerData,
  playerDataSummary,
  resetPlayerData,
} from '@/lib/player-data';
import { clearRecent, RECENT_KEY } from '@/lib/recent';
import { SETTINGS_KEY, type Settings } from '@/lib/settings';
import { notifySettingsChanged, useSettings } from './SoundToggle';
import styles from './SettingsPanel.module.css';

/**
 * Every setting the product has, on one page, applied as it is changed (#91).
 *
 * Three sections. Sound and vibration write through `settings.ts` and reach the speaker
 * and the motor the moment they change — no save button, because a save button is a
 * second thing to press and a state in which the page disagrees with the device. The
 * third section is what the site keeps about the player, with the counts beside the
 * buttons so "erase everything" names what it is about to erase (#2448).
 *
 * Everything read from storage is read in an effect and never during render: the page
 * is statically exported, so the first paint shows the defaults and the stored values
 * replace them a frame later. `useSettings` does that for the settings; the two extra
 * facts this panel needs — whether the device can vibrate, and the counts — get an
 * effect of their own below.
 */

type Summary = ReturnType<typeof playerDataSummary>;

const EMPTY_SUMMARY: Summary = { favourites: 0, recent: 0, hasSettings: false, games: 0 };

const EXPORT_FILENAME = 'duelbox-player-data.json';

/**
 * How long the object URL outlives the click that downloads it.
 *
 * Revoked a moment later rather than immediately: Safari starts the download after the
 * click handler returns, and a URL revoked before then is a download of nothing. A second
 * is far longer than any browser needs and short enough that the blob is not kept for the
 * life of the page.
 */
const REVOKE_DELAY_MS = 1000;

/** What each stored key is called to a player, for the line that says what an import restored. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  [LAST_MODE_KEY]: 'the setup you last used for each game',
  [FAVOURITES_KEY]: 'your favourites',
  [RECENT_KEY]: 'your recently played games',
  [SETTINGS_KEY]: 'your settings',
};

/** "a, b and c" — a sentence, because the status line is read aloud as one. */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

function describeImport(imported: readonly string[]): string {
  const names = imported.map((key) => KEY_NAMES[key] ?? key);
  if (names.length === 0) {
    return 'Nothing to import: that file holds nothing this version of DuelBox keeps.';
  }
  return `Imported ${listed(names)}.`;
}

export function SettingsPanel() {
  const id = useId();
  const [settings, update] = useSettings();
  const [supported, setSupported] = useState(false);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [status, setStatus] = useState('');

  const refreshSummary = useCallback(() => {
    setSummary(playerDataSummary());
  }, []);

  useEffect(() => {
    setSupported(hapticsSupported());
    refreshSummary();
  }, [refreshSummary]);

  // The counts include whether the settings have been changed from the defaults, so a
  // change to any of them is a change to the summary too.
  const change = useCallback(
    (patch: Partial<Settings>) => {
      update(patch);
      refreshSummary();
    },
    [update, refreshSummary],
  );

  const tryHaptics = useCallback(() => {
    if (vibrate('tap')) setStatus('That was a tap.');
    else if (!settings.haptics) setStatus('Turn vibration on first, then try again.');
    else setStatus('This device did not vibrate.');
  }, [settings.haptics]);

  const clearRecentPlayed = useCallback(() => {
    clearRecent();
    refreshSummary();
    setStatus('Recently played cleared.');
  }, [refreshSummary]);

  const clearFavs = useCallback(() => {
    clearFavourites();
    refreshSummary();
    setStatus('Favourites cleared.');
  }, [refreshSummary]);

  const exportData = useCallback(() => {
    const blob = new Blob([exportPlayerData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = EXPORT_FILENAME;
    // In the document for the click, because Firefox ignores a click on an anchor that
    // is not; out again straight after, because nothing else should find it.
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, REVOKE_DELAY_MS);
    setStatus(`Saved as ${EXPORT_FILENAME}.`);
  }, []);

  const importData = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      if (file === undefined) return;
      // Cleared before the read, not after, so choosing the same file again fires a
      // change: a player retrying after freeing storage should not have to pick a
      // different file to be allowed a second attempt.
      input.value = '';
      file
        .text()
        .then((text) => {
          const result = importPlayerData(text);
          if ('error' in result) {
            setStatus(result.error);
            return;
          }
          // Imported values are written raw and read back sanitised, so every control on
          // the page re-reads rather than trusting what the file said.
          notifySettingsChanged();
          refreshSummary();
          setStatus(describeImport(result.imported));
        })
        .catch(() => {
          setStatus('That file could not be read.');
        });
    },
    [refreshSummary],
  );

  const resetAll = useCallback(() => {
    resetPlayerData();
    notifySettingsChanged();
    refreshSummary();
    setStatus('Everything DuelBox kept on this device has been erased.');
  }, [refreshSummary]);

  const percent = Math.round(settings.volume * 100);
  const volumeId = `${id}-volume`;
  const importId = `${id}-import`;

  return (
    <div className={styles.panel}>
      <section className={styles.section} aria-labelledby={`${id}-sound`}>
        <h2 id={`${id}-sound`}>Sound</h2>
        <Switch
          label="Mute"
          checked={settings.muted}
          onChange={(muted) => {
            change({ muted });
          }}
        />
        <div className={styles.row}>
          <label htmlFor={volumeId} className={styles.label}>
            Volume
          </label>
          <div className={styles.slider}>
            {/* Written straight through as the thumb moves. The level is handed to the
                engine's `setMasterGain`, which owns the gain node and is the one place a
                change to it should be shaped; the panel does not smooth the value itself,
                because two things smoothing one node is how a fade gets doubled. The
                step is small so each write is a small move. */}
            <input
              id={volumeId}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              aria-valuetext={`${String(percent)}%`}
              className={styles.range}
              onChange={(event) => {
                change({ volume: Number(event.currentTarget.value) });
              }}
            />
            {/* The percentage beside the slider is for eyes only, so it is a plain span
                and `aria-hidden`. It was an `<output>`, which carries an implicit
                `role="status"` — a second live region on this page, announcing on every
                step of a drag, saying what the slider's own `aria-valuetext` already
                says, and colliding with the panel's real status line below. */}
            <span className={styles.value} aria-hidden="true">
              {percent}%
            </span>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby={`${id}-vibration`}>
        <h2 id={`${id}-vibration`}>Vibration</h2>
        <Switch
          label="Vibration"
          checked={settings.haptics}
          onChange={(haptics) => {
            change({ haptics });
          }}
        />
        <p className={styles.note}>
          A short buzz when a round ends and a longer one when the match does. Off unless you turn
          it on, and it does nothing on a device without the Vibration API — which includes every
          iPhone.
        </p>
        <div className={styles.actions}>
          {/* Disabled from the effect above rather than from render: the build machine has
              no `navigator.vibrate` and neither does an iPhone, so the first paint shows
              it disabled everywhere and Android enables it a frame later. */}
          <button
            type="button"
            className={styles.button}
            disabled={!supported}
            onClick={tryHaptics}
          >
            Try it
          </button>
        </div>
      </section>

      <section className={styles.section} aria-labelledby={`${id}-data`}>
        <h2 id={`${id}-data`}>Your data</h2>
        <p className={styles.note}>
          Everything DuelBox keeps, all of it in this browser&apos;s storage and none of it sent
          anywhere. Export it to carry it to another device, import it there, or erase it here.
        </p>
        <dl className={styles.counts}>
          <div className={styles.count}>
            <dt>Favourites</dt>
            <dd>{summary.favourites}</dd>
          </div>
          <div className={styles.count}>
            <dt>Recently played</dt>
            <dd>{summary.recent}</dd>
          </div>
          <div className={styles.count}>
            <dt>Games with a remembered setup</dt>
            <dd>{summary.games}</dd>
          </div>
          <div className={styles.count}>
            <dt>Settings</dt>
            <dd>{summary.hasSettings ? 'Changed' : 'Defaults'}</dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={clearRecentPlayed}>
            Clear recently played
          </button>
          <button type="button" className={styles.button} onClick={clearFavs}>
            Clear favourites
          </button>
          <button type="button" className={styles.button} onClick={exportData}>
            Export
          </button>
        </div>
        <div className={styles.row}>
          <label htmlFor={importId} className={styles.label}>
            Import
          </label>
          <input
            id={importId}
            type="file"
            accept="application/json,.json"
            className={styles.file}
            onChange={importData}
          />
        </div>
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.danger}`} onClick={resetAll}>
            Reset everything
          </button>
        </div>
      </section>

      {/* Always rendered, even empty: a live region that appears along with its first
          message is announced by some screen readers and not by others. */}
      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

/**
 * An on/off control, as a button with the switch role.
 *
 * A button rather than a checkbox because it is keyboard operable and focusable as it
 * stands, and the browser's own switch has no styling hook worth the trouble. The word
 * beside the track — On or Off — is what survives greyscale (CLAUDE.md rule 7): a knob's
 * position is a signal a player has to learn, and a word is not.
 */
function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  return (
    <div className={styles.row}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        className={styles.switch}
        onClick={() => {
          onChange(!checked);
        }}
      >
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
        <span className={styles.word}>{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}
