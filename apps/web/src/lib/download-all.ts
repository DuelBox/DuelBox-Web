/**
 * The page's half of "download all games" (#196): the words the worker and the settings page
 * agree on, and the sentences a person reads.
 *
 * The worker (`apps/web/public/sw.js`) is a separate script in a separate realm and cannot
 * import this, so the four message types are a spelling both sides use rather than a
 * contract anything enforces — the same standing `SKIP_WAITING` has in `offline-state.ts`.
 * What catches a mismatch is `e2e/download-all.spec.ts`, which presses the button and waits
 * for the count to reach the catalogue.
 *
 * Everything below is pure so it can be held in a test without a browser. The component
 * that posts the messages and renders the result is `components/DownloadAll.tsx`, reached
 * through `lazy()` from the settings page so that none of it is shell.
 */

/** Page → worker: save every game this device does not hold. Carries nothing else. */
export const DOWNLOAD_ALL = 'DOWNLOAD_ALL';
/** Page → worker: stop after the file in flight. */
export const DOWNLOAD_CANCEL = 'DOWNLOAD_CANCEL';
/** Page → worker: say where you are, so a page opened mid-way reads the truth. */
export const DOWNLOAD_STATUS = 'DOWNLOAD_STATUS';
/** Worker → every page: the state below, on every change and on request. */
export const DOWNLOAD_PROGRESS = 'DOWNLOAD_PROGRESS';

/** Why a download stopped, in the worker's one word. */
export type DownloadStop = 'cancelled' | 'quota' | 'network';

export interface DownloadState {
  /** How many games the build offers — the length of the worker's list. */
  readonly games: number;
  /** What all of them weigh over the wire, gzipped. */
  readonly bytesTotal: number;
  /** How many are on this device in full. */
  readonly done: number;
  readonly bytesDone: number;
  /** The slug being saved right now, or null between games. */
  readonly saving: string | null;
  readonly running: boolean;
  readonly stopped: DownloadStop | null;
}

/** Whether a message from the worker is the progress shape, so a stray one is ignored. */
export function isDownloadState(value: unknown): value is DownloadState & { type: string } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['type'] === DOWNLOAD_PROGRESS &&
    typeof record['games'] === 'number' &&
    typeof record['bytesTotal'] === 'number' &&
    typeof record['done'] === 'number' &&
    typeof record['bytesDone'] === 'number' &&
    typeof record['running'] === 'boolean'
  );
}

/**
 * Bytes as a person reads them: `1.2 MB`, `420 KB`.
 *
 * Kilobytes of 1024 and one decimal above a megabyte, which is the convention the rest of
 * this repository's numbers already use (`check-size.mjs` prints the same way). Never "B":
 * nothing here is small enough to be worth a unit below a kilobyte.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * The one line the settings page shows, from the worker's state.
 *
 * Every state has a sentence, including the ones a person only reaches by closing the page
 * mid-way and coming back, because the count they read then has to be the count that is
 * true. The quota stop says what happened *and* that nothing was lost, since "the browser
 * refused" on its own reads as "your download is broken".
 */
export function describeDownload(state: DownloadState): string {
  const all = `${String(state.games)} games, ${formatBytes(state.bytesTotal)}`;
  if (state.games === 0) return 'Nothing to download in this build.';
  if (state.running) {
    return (
      `Saving ${String(state.done)} of ${String(state.games)} — ` +
      `${formatBytes(state.bytesDone)} of ${formatBytes(state.bytesTotal)}`
    );
  }
  if (state.done >= state.games) return `All ${all} — on this device.`;
  const rest = `${String(state.games - state.done)} still to save`;
  switch (state.stopped) {
    case 'cancelled':
      return `Stopped. ${String(state.done)} of ${String(state.games)} saved, ${rest}.`;
    case 'quota':
      return (
        `The browser ran out of room. ${String(state.done)} of ${String(state.games)} saved` +
        ' and nothing already saved was damaged; free some space and press again to continue.'
      );
    case 'network':
      return (
        `The connection went away. ${String(state.done)} of ${String(state.games)} saved;` +
        ' press again to continue from there.'
      );
    default:
      return state.done === 0
        ? `${all}. Saved on this device, they open with no connection at all.`
        : `${String(state.done)} of ${String(state.games)} on this device, ${rest} (${formatBytes(state.bytesTotal - state.bytesDone)}).`;
  }
}

/** What the button reads in each state, so a press always means one thing. */
export function downloadAction(state: DownloadState): 'download' | 'cancel' | null {
  if (state.games === 0) return null;
  if (state.running) return 'cancel';
  if (state.done >= state.games) return null;
  return 'download';
}

/**
 * What to say about persistence, honestly.
 *
 * `navigator.storage.persist()` asks the browser not to evict this origin's storage under
 * pressure. It is a request and browsers refuse it freely — Chromium grants it on engagement
 * heuristics, Firefox asks the person — so the refusal has to be a sentence rather than a
 * silence, because the whole reason somebody downloads a hundred games before a flight is
 * to still have them on the plane.
 */
export function persistenceNote(persisted: boolean | null): string | null {
  if (persisted === null) return null;
  return persisted
    ? 'The browser has agreed to keep these when it needs space.'
    : 'The browser may clear these when it needs space; they come back on the next download.';
}
