import { expect, test, type Page } from '@playwright/test';

/**
 * The result of a match, as a picture two people can send to a third (#164).
 *
 * The layout and the words are unit-tested without a canvas in `lib/share-card.test.ts`.
 * What only a browser can answer is whether pressing the button produces a PNG at all, of
 * the size every messenger lays out for, through the share sheet where there is one and
 * into the downloads folder where there is not — and that the address it carries is the
 * game's page and nothing personal.
 *
 * Crash It, hard, one round: the same way `record.spec.ts` reaches a result screen without
 * anybody touching a control.
 */
test.describe.configure({ timeout: 90_000 });

/** What the page handed out, decoded rather than trusted: a size says nothing about shape. */
interface Captured {
  name: string;
  type: string;
  bytes: number;
  width: number;
  height: number;
  url?: string;
  title?: string;
}

declare global {
  interface Window {
    dbCaptured?: Captured;
  }
}

/**
 * Stubs the two ways out of the browser. `withShareSheet` gives the page a `navigator.share`
 * that accepts files and records what it was handed; without it there is none, and the
 * download path is what runs. Both decode the blob with `createImageBitmap`, so a PNG that
 * was never encoded fails to decode rather than passing as a name.
 */
async function capture(page: Page, withShareSheet: boolean): Promise<void> {
  await page.addInitScript((sheet: boolean) => {
    const record = async (blob: Blob, name: string, extra: Partial<Captured> = {}) => {
      const bitmap = await createImageBitmap(blob);
      window.dbCaptured = {
        name,
        type: blob.type,
        bytes: blob.size,
        width: bitmap.width,
        height: bitmap.height,
        ...extra,
      };
    };
    if (sheet) {
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (payload: { files?: File[]; url?: string; title?: string }) => {
          const file = payload.files?.[0];
          if (!file) throw new Error('shared without a file');
          await record(file, file.name, {
            ...(payload.url !== undefined ? { url: payload.url } : {}),
            ...(payload.title !== undefined ? { title: payload.title } : {}),
          });
        },
      });
    } else {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
      // The download is an anchor with an object URL. Keep the blob the URL was made from,
      // and swallow the click so the test is not navigated to a download.
      let pending: Blob | null = null;
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob: Blob) => {
        pending = blob;
        return create(blob);
      };
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with Reflect.apply below
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        if (this.download !== '' && pending !== null) {
          void record(pending, this.download);
          return;
        }
        Reflect.apply(click, this, []);
      };
    }
  }, withShareSheet);
}

async function playToTheEnd(page: Page): Promise<void> {
  await page.goto('/play/crash-it/');
  await page.getByRole('radio', { name: /Hard/ }).check();
  await page.getByRole('radio', { name: '1 round' }).check();
  await page.getByRole('button', { name: /Play against/ }).click();
  await expect(page.getByRole('button', { name: /Rematch/i })).toBeVisible({ timeout: 25_000 });
}

async function captured(page: Page): Promise<Captured> {
  await expect
    .poll(() => page.evaluate(() => window.dbCaptured !== undefined), { timeout: 10_000 })
    .toBe(true);
  const value = await page.evaluate(() => window.dbCaptured);
  if (value === undefined) throw new Error('nothing was captured');
  return value;
}

test.describe('sharing a result', () => {
  test('hands a 1200 by 630 PNG to the share sheet, addressed to the game page', async ({
    page,
  }) => {
    await capture(page, true);
    await playToTheEnd(page);
    await page.getByRole('button', { name: 'Share result' }).click();
    await expect(page.getByText('Shared.')).toBeVisible();

    const shared = await captured(page);
    expect(shared.type).toBe('image/png');
    expect([shared.width, shared.height], 'the Open Graph size').toEqual([1200, 630]);
    expect(shared.name).toMatch(/^duelbox-crash-it-\d+-\d+\.png$/);
    expect(shared.url).toMatch(/\/games\/crash-it\/$/);
    expect(shared.url).not.toContain('?');
    // The title is the verdict in words: a bot's win names the bot, not a colour.
    expect(shared.title).toMatch(/wins at Crash It$|^A draw at Crash It$/);
  });

  test('falls back to a download where there is no share sheet', async ({ page }) => {
    await capture(page, false);
    await playToTheEnd(page);
    await page.getByRole('button', { name: 'Share result' }).click();
    await expect(page.getByText(/^Saved as duelbox-crash-it-\d+-\d+\.png\.$/)).toBeVisible();

    const downloaded = await captured(page);
    expect(downloaded.type).toBe('image/png');
    expect([downloaded.width, downloaded.height]).toEqual([1200, 630]);
    expect(downloaded.name).toMatch(/^duelbox-crash-it-\d+-\d+\.png$/);
  });

  test('downloads the card code only when the button is pressed', async ({ page }) => {
    // The `import()` is the whole of "on demand": a visitor who never presses Share never
    // pays for a canvas renderer. Nothing may fetch it before the press.
    const fetched: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('.js')) fetched.push(request.url());
    });
    await capture(page, true);
    await playToTheEnd(page);
    const before = fetched.length;
    await page.getByRole('button', { name: 'Share result' }).click();
    await expect(page.getByText('Shared.')).toBeVisible();
    expect(fetched.length, 'a chunk arrived for the press').toBeGreaterThan(before);
  });
});
