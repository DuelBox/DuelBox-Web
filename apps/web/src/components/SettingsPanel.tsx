'use client';

import { useCallback, useEffect, useId, useState, type ChangeEvent } from 'react';
import type { SeatId } from '@duelbox/engine';
import { clearFavourites, FAVOURITES_KEY } from '@/lib/favourites';
import { hapticsSupported, vibrate } from '@/lib/haptics';
import { clearRecord, HEAD_TO_HEAD_KEY, mostPlayed, type GameRecord } from '@/lib/head-to-head';
import { LAST_MODE_KEY } from '@/lib/last-mode';
import {
  exportPlayerData,
  importPlayerData,
  playerDataSummary,
  resetPlayerData,
} from '@/lib/player-data';
import {
  MAX_NAME_LENGTH,
  PLAYER_NAMES_KEY,
  readPlayerNames,
  writePlayerName,
} from '@/lib/player-names';
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
 * buttons so "erase everything" names what it is about to erase (#2448). That section now
 * also holds the two things a pair own rather than merely accumulate: what they are called
 * (#161) and the head-to-head record they have built up (#160, #162), each with a way to
 * clear it that does not take the rest with it.
 *
 * Everything read from storage is read in an effect and never during render: the page
 * is statically exported, so the first paint shows the defaults and the stored values
 * replace them a frame later. `useSettings` does that for the settings; the two extra
 * facts this panel needs — whether the device can vibrate, and the counts — get an
 * effect of their own below.
 */

type Summary = ReturnType<typeof playerDataSummary>;

const EMPTY_SUMMARY: Summary = {
  favourites: 0,
  recent: 0,
  hasSettings: false,
  games: 0,
  matches: 0,
};

/** How many games the record lists here. Enough to recognise a habit, not a second catalogue. */
const MOST_PLAYED = 5;

/**
 * A slug as a title.
 *
 * The catalogue's display names are deliberately not in this bundle — no client component
 * imports `catalogue.generated.ts`, and the settings page is shell code every visitor
 * downloads — so the route slug is turned back into words here. "tic-tac-toe" is a game a
 * player recognises as "tic tac toe"; the stylesheet capitalises the first letter.
 *
 * The first letter and no others. `text-transform: capitalize` capitalises every word, so
 * seven playable games rendered here under a name the catalogue never uses — "Whack A Mole"
 * against its own page's "Whack a Mole", and the same for Dots and Boxes, Guard and Thief,
 * King of the Yard, Nuts and Bolts, Pull the Rope and Shut the Box. Sentence case is not
 * the catalogue's spelling either, but it never invents a capital the game does not have.
 */
function titleOf(slug: string): string {
  return slug.replace(/-/g, ' ');
}

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
  [HEAD_TO_HEAD_KEY]: 'your head-to-head record',
  [PLAYER_NAMES_KEY]: 'the names you chose for the two seats',
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
  const [played, setPlayed] = useState<readonly { slug: string; record: GameRecord }[]>([]);
  const [names, setNames] = useState<Readonly<Partial<Record<SeatId, string>>>>({});
  const [status, setStatus] = useState('');

  /**
   * Everything on this page that comes from storage, re-read together.
   *
   * One function rather than three, because every caller wants all of it: an import, an
   * erase and a clear each change more than one of them, and a page that refreshed two of
   * three would show a record beside a count that disagreed with it.
   */
  const refresh = useCallback(() => {
    setSummary(playerDataSummary());
    setPlayed(mostPlayed(MOST_PLAYED));
    setNames(readPlayerNames());
  }, []);

  useEffect(() => {
    setSupported(hapticsSupported());
    refresh();
  }, [refresh]);

  // The counts include whether the settings have been changed from the defaults, so a
  // change to any of them is a change to the summary too.
  const change = useCallback(
    (patch: Partial<Settings>) => {
      update(patch);
      refresh();
    },
    [update, refresh],
  );

  const tryHaptics = useCallback(() => {
    if (vibrate('tap')) setStatus('That was a tap.');
    else if (!settings.haptics) setStatus('Turn vibration on first, then try again.');
    else setStatus('This device did not vibrate.');
  }, [settings.haptics]);

  const clearRecentPlayed = useCallback(() => {
    clearRecent();
    refresh();
    setStatus('Recently played cleared.');
  }, [refresh]);

  const clearFavs = useCallback(() => {
    clearFavourites();
    refresh();
    setStatus('Favourites cleared.');
  }, [refresh]);

  const clearHeadToHead = useCallback(() => {
    clearRecord();
    refresh();
    setStatus('The head-to-head record is cleared. Both of you are back on nothing.');
  }, [refresh]);

  /**
   * A name, written on every keystroke and settled on blur.
   *
   * The field holds what is being typed and storage holds the tidied version of it, which
   * is why the two are separate: feeding the tidied value straight back into the field
   * would eat the space in the middle of "Ada B" as it was typed. On blur the field shows
   * what was actually stored, so a player sees the trim rather than discovering it on the
   * scoreboard later.
   */
  const changeName = useCallback((seat: SeatId, value: string) => {
    setNames((previous) => ({ ...previous, [seat]: value }));
    writePlayerName(seat, value);
  }, []);

  const settleNames = useCallback(() => {
    setNames(readPlayerNames());
  }, []);

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
          refresh();
          setStatus(describeImport(result.imported));
        })
        .catch(() => {
          setStatus('That file could not be read.');
        });
    },
    [refresh],
  );

  const resetAll = useCallback(() => {
    resetPlayerData();
    notifySettingsChanged();
    refresh();
    setStatus('Everything DuelBox kept on this device has been erased.');
  }, [refresh]);

  /**
   * Which destructive button is waiting for its second press, by label.
   *
   * One piece of state rather than one per button, so arming a second disarms the first
   * and two buttons can never both be a press away from erasing something.
   */
  const [armed, setArmed] = useState('');

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
            <dt>Matches recorded</dt>
            <dd>{summary.matches}</dd>
          </div>
          <div className={styles.count}>
            <dt>Settings</dt>
            <dd>{summary.hasSettings ? 'Changed' : 'Defaults'}</dd>
          </div>
        </dl>

        {/* #161. Two fields rather than a screen of their own: naming yourselves is
            something a pair do once, on the page that already holds everything else this
            device remembers about them. */}
        <h3 className={styles.subhead}>What you are called</h3>
        <p className={styles.note}>
          The names on the scoreboard during a match, on this device and nowhere else. Leave one
          empty and that seat keeps its own name.
        </p>
        <NameField
          id={`${id}-p1`}
          label="Name for the near seat"
          value={names.p1 ?? ''}
          onChange={changeName}
          onSettle={settleNames}
          seat="p1"
        />
        <NameField
          id={`${id}-p2`}
          label="Name for the far seat"
          value={names.p2 ?? ''}
          onChange={changeName}
          onSettle={settleNames}
          seat="p2"
        />

        <div className={styles.actions}>
          <Confirm
            label="Clear recently played"
            armed={armed}
            onArm={setArmed}
            onConfirm={clearRecentPlayed}
          />
          <Confirm label="Clear favourites" armed={armed} onArm={setArmed} onConfirm={clearFavs} />
          <Confirm
            label="Clear the record"
            armed={armed}
            onArm={setArmed}
            onConfirm={clearHeadToHead}
          />
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
          <Confirm
            label="Reset everything"
            className={styles.danger}
            armed={armed}
            onArm={setArmed}
            onConfirm={resetAll}
          />
        </div>

        {/*
          Last in the section, and rendered whether or not there is anything in it.

          `played` is empty until the mount effect has read storage, so while this block sat
          mid-section a pair with a record watched a heading and up to five rows — about two
          hundred pixels — appear above the buttons one frame after the page had painted
          them, moving every control in the section down. It is the largest jump on the
          page, and the same stylesheet already guards against a far smaller one (`.status`
          holds its height while empty). Below everything else, the only thing it can move
          is the status line, which reserves its own height; and the heading and its legend
          are in the exported HTML either way, so what arrives after hydration is rows
          rather than structure.
        */}
        <h3 className={styles.subhead}>Most played</h3>
        {/* The convention, on screen rather than only in the markup: the visible tally is
            `aria-hidden`, so without this line the sighted reader was the one who could not
            tell whose three wins those were, between two fields named for the two seats. */}
        <p className={styles.note}>
          Wins, losses and draws are the near seat&apos;s, bot matches included.
        </p>
        {played.length > 0 ? (
          <ul className={styles.games}>
            {played.map((entry) => (
              <li key={entry.slug}>
                <span className={styles.game}>{titleOf(entry.slug)}</span>
                {/* Spelled out for a screen reader, which would otherwise be handed
                    "3W 2L 1D" to say aloud. */}
                <span className={styles.tally} aria-hidden="true">
                  {entry.record.p1}W {entry.record.p2}L {entry.record.draws}D
                </span>
                <span className="db-visually-hidden">
                  the near seat has won {entry.record.p1}, lost {entry.record.p2} and drawn{' '}
                  {entry.record.draws}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>Nothing yet. Finish a match and it appears here.</p>
        )}
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
 * One seat's name.
 *
 * A plain text field, capped in the markup as well as in the store: `maxLength` stops the
 * thirteenth character being typed at all, which is a kinder way to say "twelve" than
 * silently dropping it on the way to storage. Autocomplete and spellcheck are off — a
 * browser offering a saved postal address here, or underlining a nickname in red, is
 * answering a question nobody asked.
 */
function NameField({
  id,
  label,
  seat,
  value,
  onChange,
  onSettle,
}: {
  id: string;
  label: string;
  seat: SeatId;
  value: string;
  onChange: (seat: SeatId, value: string) => void;
  onSettle: () => void;
}) {
  return (
    <div className={styles.row}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        className={styles.text}
        value={value}
        maxLength={MAX_NAME_LENGTH}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          onChange(seat, event.currentTarget.value);
        }}
        onBlur={onSettle}
      />
    </div>
  );
}

/**
 * A destructive action that takes two presses.
 *
 * #160 asks for the record's reset to require explicit confirmation, and the same
 * argument covers the other three: every one of these erases something a pair built up
 * over an evening, none of it is recoverable, and all four sat one stray press from
 * gone — "Reset everything" most of all, which takes the favourites, the record, the
 * names and the settings together.
 *
 * Two presses on the button itself rather than a dialog. `window.confirm` blocks the page
 * and looks like the browser rather than the site; a modal is a focus trap, an overlay and
 * an escape key to get right, which is a great deal of shell budget for a question with
 * two words in it. The label changing to "Press again to …" is the whole mechanism: it
 * says what the next press does, it is the same control the player is already pointing at,
 * and it cannot be dismissed by accident because the only thing that arms it is a press.
 *
 * `aria-live` on the label means a screen reader hears the label change rather than
 * silently arming, and moving focus away disarms — so a player who tabs off and comes
 * back does not find a button that is still one press from erasing their evening.
 */
function Confirm({
  label,
  className,
  armed,
  onArm,
  onConfirm,
}: {
  label: string;
  className?: string | undefined;
  armed: string;
  onArm: (label: string) => void;
  onConfirm: () => void;
}) {
  const isArmed = armed === label;
  return (
    <button
      type="button"
      className={className === undefined ? styles.button : `${styles.button} ${className}`}
      aria-live="polite"
      onBlur={() => {
        if (isArmed) onArm('');
      }}
      onClick={() => {
        if (!isArmed) {
          onArm(label);
          return;
        }
        onArm('');
        onConfirm();
      }}
    >
      {isArmed ? `Press again to ${label.toLowerCase()}` : label}
    </button>
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
