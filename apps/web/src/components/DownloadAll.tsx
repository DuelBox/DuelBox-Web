'use client';

import { useEffect, useState } from 'react';
import {
  DOWNLOAD_ALL,
  DOWNLOAD_CANCEL,
  DOWNLOAD_STATUS,
  describeDownload,
  downloadAction,
  formatBytes,
  isDownloadState,
  persistenceNote,
  type DownloadState,
} from '@/lib/download-all';
import styles from './SettingsPanel.module.css';

/**
 * "Download all games", on the settings page (#196).
 *
 * The page's whole job is to ask, and to say what it was told. The worker holds the list of
 * what every game needs and what it weighs, does the fetching one file at a time into the
 * same cache the played-games path uses, evicts the least recently opened game when the
 * browser refuses a write, and reports by `postMessage`. So the first thing this does on
 * mount is ask where things stand, which is how a page opened mid-download — or after a
 * cancel, or after the browser ended a long one — reads the true count rather than zero.
 *
 * ## Bytes
 *
 * `/settings/` is a shell route, and the shell has about a kilobyte and a half to spare. This
 * component is reached through `lazy()` from `SettingsPanel`, so the sentences below, the
 * progress bar and the two storage calls land on the on-demand line — the budget for code a
 * visitor asked for — and the shell pays for a heading, a note and the mount.
 *
 * ## Storage, honestly
 *
 * `navigator.storage.persist()` is asked for when the download starts, not on load: asking
 * on arrival is the same mistake as an install prompt on arrival (#195), and a browser that
 * prompts for it would be prompting somebody who has not decided anything yet. It is a
 * request the browser may refuse, and a refusal is shown in words rather than swallowed,
 * because the person downloading a hundred games before a flight needs to know whether they
 * will still be there on the plane. `estimate()` is the quota line beside it.
 *
 * ## Why there is no `role="status"` here
 *
 * The site keeps exactly one status region — `ServiceWorkerBridge`'s bar — and two specs ask
 * for "the" one. The progress line is `aria-live="polite"` on an element that is not a status
 * region, the same arrangement `KeyBindings` uses for its refusals.
 */

const NOT_CONTROLLED = 'Available once the site has finished saving itself to this device.';

function controller(): ServiceWorker | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.controller;
}

export default function DownloadAll() {
  const [state, setState] = useState<DownloadState | null>(null);
  const [controlled, setControlled] = useState<boolean | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [quota, setQuota] = useState<string | null>(null);

  useEffect(() => {
    const worker = controller();
    setControlled(worker !== null);
    if (worker === null) return;
    const onMessage = (event: MessageEvent): void => {
      if (isDownloadState(event.data)) setState(event.data);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    worker.postMessage({ type: DOWNLOAD_STATUS });
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, []);

  const start = (): void => {
    const worker = controller();
    if (worker === null) return;
    worker.postMessage({ type: DOWNLOAD_ALL });
    const storage = navigator.storage as
      { persist?: () => Promise<boolean>; estimate?: () => Promise<StorageEstimate> } | undefined;
    if (storage?.persist !== undefined) {
      storage
        .persist()
        .then(setPersisted)
        .catch(() => {
          setPersisted(false);
        });
    }
    if (storage?.estimate !== undefined) {
      storage
        .estimate()
        .then(({ usage, quota: limit }) => {
          if (typeof usage === 'number' && typeof limit === 'number') {
            setQuota(
              `${formatBytes(usage)} of ${formatBytes(limit)} of this site's storage in use`,
            );
          }
        })
        .catch(() => undefined);
    }
  };

  const cancel = (): void => {
    controller()?.postMessage({ type: DOWNLOAD_CANCEL });
  };

  if (controlled === false) return <p className={styles.note}>{NOT_CONTROLLED}</p>;
  if (state === null) return <p className={styles.note}>Asking what is on this device…</p>;

  const action = downloadAction(state);
  const note = persistenceNote(persisted);
  return (
    <div>
      <p className={styles.note} aria-live="polite">
        {describeDownload(state)}
      </p>
      {state.running ? (
        <progress className={styles.progress} max={state.games} value={state.done}>
          {String(state.done)} of {String(state.games)}
        </progress>
      ) : null}
      {action === null ? null : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={action === 'download' ? start : cancel}
          >
            {action === 'download' ? 'Download all games' : 'Cancel'}
          </button>
        </div>
      )}
      {note === null ? null : <p className={styles.note}>{note}</p>}
      {quota === null ? null : <p className={styles.note}>{quota}</p>}
    </div>
  );
}
