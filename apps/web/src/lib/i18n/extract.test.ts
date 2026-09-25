import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  catalogueSource,
  extractMessages,
  extractableFiles,
  GENERATED_LOCALES,
  isExtractable,
  messagesIn,
  renderOutputs,
  WEB_SRC,
} from './extract';
import { DEFAULT_LOCALE, LOCALE_CODES } from './locales';

/**
 * The extractor, and the generated files it is responsible for (#219, #220).
 *
 * Two jobs in one file, on one code path, because a generator that is not also the guard on
 * its own output is how a generated file goes stale. With `DUELBOX_EMIT_LOCALES=1` — which is
 * what `pnpm i18n:extract` sets — the last test **writes** `messages.en.generated.json` and the
 * pseudo-locale catalogues. Without it, the same test renders exactly the same bytes and asserts
 * that what is committed equals them, so a string converted to `t()` without the extractor being
 * re-run fails CI with the command that fixes it. `icon-sprite.test.ts` guards
 * `icon-sprite.generated.ts` the same way.
 *
 * The extractor itself is tested on fixtures first, so that a walk which found nothing —
 * the failure this repository keeps a count of — cannot pass by generating three empty files
 * that agree with three empty files on disk. The last fixture test reads the real tree and
 * requires the strings this batch converted to be in it.
 */

const EMIT = process.env['DUELBOX_EMIT_LOCALES'] === '1';

const IMPORTS =
  "import { t, plural } from '@/lib/i18n/messages';\nimport { T } from '@/lib/i18n/T';\n";

describe('reading one file', () => {
  it('finds a t() id, both branches of a conditional id, and a template literal', () => {
    const source =
      IMPORTS +
      "const a = t(m, 'Mute sound');\n" +
      "const b = t(m, muted ? 'Unmute sound' : 'Mute sound');\n" +
      'const c = t(m, `Play now`);\n' +
      "const d = t(m, (cond ? 'Left' : 'Right'), { n: 1 });\n";
    expect(messagesIn(source, 'x.ts')).toEqual([
      'Mute sound',
      'Unmute sound',
      'Mute sound',
      'Play now',
      'Left',
      'Right',
    ]);
  });

  it('finds both forms of a plural()', () => {
    const source =
      IMPORTS + "plural(m, locale, n, { one: '{count} game', other: '{count} games' });\n";
    expect(messagesIn(source, 'x.ts')).toEqual(['{count} game', '{count} games']);
  });

  it('finds <T id> as a string attribute and as an expression, self-closing or not', () => {
    const source =
      IMPORTS +
      'const a = <T id="Settings" />;\n' +
      "const b = <T id={'Skip to content'}>x</T>;\n" +
      'const c = <T id={flag ? "Yes" : "No"} values={{ k: <kbd>Esc</kbd> }} />;\n';
    expect(messagesIn(source, 'x.tsx')).toEqual(['Settings', 'Skip to content', 'Yes', 'No']);
  });

  it('follows an alias, and only the names imported from the i18n modules', () => {
    // `lib/format.ts` has a `plural` of its own and `hardened-json.ts` a type parameter `T`;
    // a walk that matched on names alone would read both. Only what came from the modules
    // counts, under whatever name the file gave it.
    const source =
      "import { t as translate } from '../lib/i18n/messages';\n" +
      "import { T as Text } from './i18n/T';\n" +
      "translate(m, 'Aliased');\n" +
      "t(m, 'Not ours');\n" +
      "plural(2, 'second');\n" +
      '<T id="Not ours either" />;\n' +
      '<Text id="Aliased element" />;\n';
    expect(messagesIn(source, 'x.tsx')).toEqual(['Aliased', 'Aliased element']);
  });

  it('leaves a non-literal id alone rather than guessing', () => {
    // `t(messages, entry.rule)` is legitimate and its strings come from `sources.ts`. What
    // must not happen is an identifier or a call being read as a message.
    const source = IMPORTS + "t(m, entry.rule);\nt(m, name());\nt(m, 'Real');\n";
    expect(messagesIn(source, 'x.ts')).toEqual(['Real']);
  });
});

describe('which files are read', () => {
  it('reads product source and skips tests, generated files, declarations and this directory', () => {
    expect(isExtractable(`${WEB_SRC}/components/SoundToggle.tsx`)).toBe(true);
    expect(isExtractable(`${WEB_SRC}/lib/settings.ts`)).toBe(true);
    expect(isExtractable(`${WEB_SRC}/lib/settings.test.ts`)).toBe(false);
    expect(isExtractable(`${WEB_SRC}/data/catalogue.generated.ts`)).toBe(false);
    expect(isExtractable(`${WEB_SRC}/lib/i18n/messages.ts`)).toBe(false);
    expect(isExtractable(`${WEB_SRC}/lib/i18n/catalogues/en-XA.generated.ts`)).toBe(false);
    expect(isExtractable(`${WEB_SRC}/types.d.ts`)).toBe(false);
    expect(isExtractable(`${WEB_SRC}/styles/globals.css`)).toBe(false);
  });

  it('walks the real tree, so an empty walk cannot pass', () => {
    // Hundreds of files; fifty is a floor, not a target.
    expect(extractableFiles().length).toBeGreaterThan(50);
  });
});

describe('the real extraction', () => {
  const msgids = extractMessages();

  it('contains the strings this batch converted, sorted and unique', () => {
    expect(msgids).toContain('Mute sound');
    expect(msgids).toContain('Unmute sound');
    expect(msgids).toContain('Language');
    expect(msgids).toContain('Settings');
    expect(msgids).toEqual([...new Set(msgids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('generates a catalogue for every registered non-default locale', () => {
    // A registered locale with no generator and no reviewed translation would be a chunk
    // `load.ts` cannot import. Today every non-default locale is a pseudo-locale; the day a
    // real one arrives, its catalogue is written by a translator and this list shrinks.
    expect([...GENERATED_LOCALES].sort()).toEqual(
      LOCALE_CODES.filter((code) => code !== DEFAULT_LOCALE).sort(),
    );
  });

  it('writes a module whose locale marker comes first, for check-size to recognise', () => {
    const source = catalogueSource('en-XA', ['Mute sound']);
    expect(source).toMatch(/const catalogue = \{\s*"locale": "en-XA",\s*"messages": \{/);
    expect(source).toContain('as const');
    expect(source).toContain('export default catalogue');
  });
});

describe(EMIT ? 'writing the generated files' : 'the generated files on disk', () => {
  it(EMIT ? 'writes them' : 'are exactly what the extractor would write now', async () => {
    const outputs = await renderOutputs(extractMessages());
    expect(outputs.size).toBe(1 + GENERATED_LOCALES.length);
    for (const [path, content] of outputs) {
      if (EMIT) {
        writeFileSync(path, content);
        continue;
      }
      let onDisk = '';
      try {
        onDisk = readFileSync(path, 'utf8');
      } catch {
        // Missing is stale: the assertion below names the file and the remedy.
      }
      expect(
        onDisk,
        `${relative(WEB_SRC, path)} is not what the extractor would write — run \`pnpm i18n:extract\` and commit the result`,
      ).toBe(content);
    }
  });
});
