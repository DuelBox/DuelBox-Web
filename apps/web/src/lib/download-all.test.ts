import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_PROGRESS,
  describeDownload,
  downloadAction,
  formatBytes,
  isDownloadState,
  persistenceNote,
  type DownloadState,
} from './download-all';

const idle: DownloadState = {
  games: 108,
  bytesTotal: 1_400_000,
  done: 0,
  bytesDone: 0,
  saving: null,
  running: false,
  stopped: null,
};

/**
 * The empty catalogue: every lookup falls through to its English id, which is what the
 * default locale renders and what these assertions have always been about. A translated
 * catalogue is `i18n.test.ts`'s business, not this file's.
 */
const EN = {};

describe('the line a person reads', () => {
  it('says what a download costs before anything is fetched', () => {
    expect(describeDownload(EN, 'en', idle)).toBe(
      '108 games, 1.3 MB. Saved on this device, they open with no connection at all.',
    );
  });

  it('counts games and bytes while it runs', () => {
    expect(
      describeDownload(EN, 'en', { ...idle, running: true, done: 37, bytesDone: 430_080 }),
    ).toBe('Saving 37 of 108 — 420 KB of 1.3 MB');
  });

  it('says it is finished when every game is here', () => {
    expect(describeDownload(EN, 'en', { ...idle, done: 108, bytesDone: idle.bytesTotal })).toMatch(
      /^All 108 games, 1\.3 MB — on this device\.$/,
    );
  });

  it('says a cancel left what it had, and how much is left', () => {
    expect(describeDownload(EN, 'en', { ...idle, done: 40, stopped: 'cancelled' })).toBe(
      'Stopped. 40 of 108 saved, 68 still to save.',
    );
  });

  it('says a quota stop damaged nothing, because a put is atomic', () => {
    expect(describeDownload(EN, 'en', { ...idle, done: 90, stopped: 'quota' })).toContain(
      'nothing already saved was damaged',
    );
  });

  it('reads the truth on a page opened after a stopped download', () => {
    // No `stopped`, no `running`: a fresh page asked the worker and got a count back.
    expect(describeDownload(EN, 'en', { ...idle, done: 12, bytesDone: 150_000 })).toBe(
      '12 of 108 on this device, 96 still to save (1.2 MB).',
    );
  });

  it('has nothing to offer a build with no games', () => {
    expect(describeDownload(EN, 'en', { ...idle, games: 0, bytesTotal: 0 })).toBe(
      'Nothing to download in this build.',
    );
    expect(downloadAction({ ...idle, games: 0 })).toBeNull();
  });
});

describe('the button', () => {
  it('downloads when there is something left, cancels while running, and goes away when done', () => {
    expect(downloadAction(idle)).toBe('download');
    expect(downloadAction({ ...idle, running: true })).toBe('cancel');
    expect(downloadAction({ ...idle, done: 108 })).toBeNull();
  });
});

describe('the persistence note', () => {
  it('says nothing until the browser has been asked', () => {
    expect(persistenceNote(EN, null)).toBeNull();
  });
  it('states a refusal rather than hiding it', () => {
    expect(persistenceNote(EN, false)).toMatch(/may clear/);
    expect(persistenceNote(EN, true)).toMatch(/agreed to keep/);
  });
});

describe('formatBytes', () => {
  it('reads as a person does', () => {
    expect(formatBytes(EN, 430_080)).toBe('420 KB');
    expect(formatBytes(EN, 1_400_000)).toBe('1.3 MB');
    expect(formatBytes(EN, -1)).toBe('0 KB');
    expect(formatBytes(EN, Number.NaN)).toBe('0 KB');
  });
});

describe('a message from the worker', () => {
  it('is recognised by its shape and ignored otherwise', () => {
    expect(isDownloadState({ type: DOWNLOAD_PROGRESS, ...idle })).toBe(true);
    expect(isDownloadState({ type: 'SOMETHING_ELSE', ...idle })).toBe(false);
    expect(isDownloadState({ type: DOWNLOAD_PROGRESS })).toBe(false);
    expect(isDownloadState(null)).toBe(false);
  });
});

/**
 * The worker's own eviction order, run from its own source.
 *
 * `sw.js` cannot import a module and a module cannot import it, so the only way to hold the
 * function the worker actually runs — rather than a copy — is to evaluate the file with the
 * six globals it declares stubbed, and take the function out of the same scope. The
 * placeholders are still in the source at this point (`['__GAMES__']` is a one-string array)
 * and the listeners are no-ops, so nothing here registers anything.
 */
describe("the worker's eviction order", () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../public/sw.js', import.meta.url)),
    'utf8',
  );
  const self = { addEventListener: () => undefined, location: { href: 'https://x.test/' } };
  // The worker's own function, out of the worker's own source, is the point of this block;
  // `allocation.test.ts` makes the same exception for the same reason.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  const evictionOrder = new Function(
    'self',
    'caches',
    'fetch',
    'Request',
    'Response',
    'URL',
    `${source}\nreturn evictionOrder;`,
  )(self, {}, () => undefined, class {}, class {}, URL) as (
    lastOpened: Record<string, number>,
    slugs: readonly string[],
  ) => string[];

  it('drops games nobody has opened first, then the ones opened longest ago', () => {
    const order = evictionOrder({ chess: 300, ludo: 100, pool: 200 }, [
      'pool',
      'chess',
      'sudoku',
      'ludo',
      'darts',
    ]);
    expect(order).toEqual(['darts', 'sudoku', 'ludo', 'pool', 'chess']);
  });

  it('is deterministic, so a test can name the victim', () => {
    const twice = [1, 2].map(() => evictionOrder({}, ['b', 'a', 'c']));
    expect(twice[0]).toEqual(['a', 'b', 'c']);
    expect(twice[1]).toEqual(twice[0]);
  });

  it('ignores a timestamp that is not one', () => {
    expect(evictionOrder({ a: 'soon' as unknown as number, b: 5 }, ['b', 'a'])).toEqual(['a', 'b']);
  });
});
