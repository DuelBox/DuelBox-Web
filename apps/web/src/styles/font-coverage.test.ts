import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seatNamesFor, SEAT_KEYS } from '../lib/seats.js';

/**
 * No tofu in any launch language (#224): every letter, mark, digit and punctuation mark in a
 * launch locale's text reaches a self-hosted face that declares it, in all three stacks.
 *
 * The site ships five faces from its own origin (`fonts.css`), each with a `unicode-range`,
 * and three font stacks (`tokens.css`) that list them. A character is drawn in the first
 * face of its stack whose range contains it and whose file has the glyph; a character no
 * face in the stack declares falls through to the system, which is a different face on every
 * platform and, on a device with no face for the script, a box. Until #224 the three stacks
 * were Latin faces and system fallbacks only, so every Hindi and Arabic string the launch
 * locales (#221, #222) will put on screen was the system's problem. This holds the declared
 * ranges of every stack against a fixture of what those locales actually render.
 *
 * ## What is held, and against what
 *
 * Every `@font-face` in `fonts.css`: its family, its range, that its file is on disk, and that
 * the file has an entry in `assets.license.json` (rule 3 — `check-asset-licenses.mjs` holds
 * the same thing at build, but that runs after `pnpm test`, and a font added without a
 * licence entry should fail on the machine of whoever added it). Every family declared is
 * listed by at least one stack, because a face nothing lists is a file nothing fetches.
 *
 * Then, for each of the three stacks, every code point of every fixture string that is a
 * letter, a combining mark, a digit or a punctuation mark must lie inside the range of some
 * face the stack lists. The fixture is the native names of the five launch locales, one
 * sentence each in Hindi and Arabic with the punctuation those languages use, and the
 * strings the shell shows in every language regardless of locale: digits, the colon and the
 * dash the score line is drawn with, the seat names with the bot mark from `lib/seats.ts`,
 * and the key legends. Punctuation is held as well as letters because a comma drawn from a
 * different face than the word beside it is the visible seam — a Latin comma in Arabic text
 * sits at the wrong height — and both script ranges declare their own.
 *
 * ## What is exempt, and why
 *
 * Symbols, separators and controls: `\p{S}`, `\p{Z}`, `\p{C}`. Emoji are symbols, and they
 * come from the platform's colour emoji font by design — a colour emoji face is megabytes,
 * every platform ships one, and the colour formats are not portable between them. The arrows
 * in the second seat's key legend (`↑ ← ↓ →`) are symbols too, and only two of the four are
 * in Google's `latin` range, so they have always been drawn from the system and this does
 * not change that; it says so here rather than quietly widening the exemption to cover it.
 *
 * ## What this cannot see, plainly
 *
 * **This checks the declared ranges, not the glyphs inside the woff2.** There is no font
 * parser in this repository, and a `unicode-range` is a promise the stylesheet makes about a
 * file, not a fact read out of it. The two are not the same thing, and the measurement that
 * shows it is in `fonts.css`: Baloo Bhaijaan 2's `arabic` subset is 38,588 bytes and Noto
 * Sans Arabic's is 166,152, and Google's API declares the identical range for both, because
 * Google's ranges are per subset, not per face. A range edited to claim a block the file does
 * not have would pass here and draw boxes in a browser. What makes the declared range the
 * right thing to hold, given that, is that it is the range the browser trusts: a browser
 * never opens a font file to decide whether to fetch it, it believes the stylesheet, so the
 * range in `fonts.css` is what decides which face a character reaches. The ranges here are
 * Google's own for the subset each file *is*, copied verbatim and recorded with the request
 * that produced them, which is as close to the cmap as a check without a parser can get.
 * `e2e/fonts.spec.ts` is the half that watches a real browser draw Hindi and Arabic in the
 * face and not in a fallback, which is what would catch a range that lied.
 *
 * ## Proof it can fail
 *
 * A Bengali and a Thai sample — two scripts no face here declares — must come back reported,
 * code point by code point, from every stack. And a fixture with one range narrowed by hand
 * must fail on exactly the characters that range covered. Both are asserted below rather
 * than described, because a coverage check whose only evidence is a green run is the kind
 * of guard CLAUDE.md counts.
 */

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

interface Face {
  readonly family: string;
  readonly src: string;
  /** Inclusive `[first, last]` code point pairs, from the `unicode-range` descriptor. */
  readonly ranges: readonly (readonly [number, number])[];
}

/**
 * The code points a `unicode-range` descriptor covers.
 *
 * The three forms the CSS grammar allows: a range `U+0900-097F`, a single point `U+20B9`,
 * and a wildcard `U+00??`. The scripts that classify faces at build time
 * (`scripts/check-size.mjs`, `scripts/emit-service-worker.mjs`) read the same grammar; a
 * token none of the forms match throws rather than being skipped, because a typo in a range
 * that silently shrank a face's coverage is exactly the drift this file exists to notice.
 */
function parseUnicodeRange(descriptor: string): (readonly [number, number])[] {
  return descriptor.split(',').map((token) => {
    const match = /^U\+([0-9A-Fa-f?]{1,6})(?:-([0-9A-Fa-f]{1,6}))?$/.exec(token.trim());
    if (match === null) throw new Error(`unreadable unicode-range token: ${token.trim()}`);
    const [, first = '', last] = match;
    if (first.includes('?')) {
      if (last !== undefined) throw new Error(`a wildcard cannot start a range: ${token}`);
      return [parseInt(first.replaceAll('?', '0'), 16), parseInt(first.replaceAll('?', 'F'), 16)];
    }
    return [parseInt(first, 16), parseInt(last ?? first, 16)];
  });
}

/** Every `@font-face` in a stylesheet's source, comments stripped first so prose cannot match. */
function facesIn(css: string): Face[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...code.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, block = '']) => {
    const family = /font-family:\s*'([^']+)'/.exec(block)?.[1];
    const src = /src:\s*url\('([^']+)'\)/.exec(block)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
    if (family === undefined || src === undefined || range === undefined) {
      throw new Error(`a @font-face is missing a family, src or unicode-range:\n${block}`);
    }
    return { family, src, ranges: parseUnicodeRange(range) };
  });
}

/** The three `--db-font-*` stacks, each as the ordered list of family names it names. */
function stacksIn(css: string): Map<string, readonly string[]> {
  const stacks = new Map<string, readonly string[]>();
  for (const [, name = '', value = ''] of css.matchAll(
    /--db-font-(display|body|mono):\s*([^;]+);/g,
  )) {
    stacks.set(
      name,
      value.split(',').map((family) => family.trim().replace(/^['"]|['"]$/g, '')),
    );
  }
  return stacks;
}

/** The faces a stack can reach, in stack order. System families are not faces this can see. */
const facesOf = (stack: readonly string[], faces: readonly Face[]): Face[] =>
  stack.flatMap((family) => faces.filter((face) => face.family === family));

/** Letters, marks, digits and punctuation: what a face has to draw. Everything else is exempt. */
const MUST_BE_DRAWN = /[\p{L}\p{M}\p{N}\p{P}]/u;

const label = (char: string): string =>
  `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')} "${char}"`;

/**
 * The code points of `text` that no face in `faces` declares, as `U+XXXX "x"` labels.
 *
 * A code point is covered if any face's range contains it. Order of the stack does not
 * matter to coverage — it decides which face draws a character, not whether one can.
 */
function uncovered(text: string, faces: readonly Face[]): string[] {
  const missing: string[] = [];
  for (const char of text) {
    if (!MUST_BE_DRAWN.test(char)) continue;
    const point = char.codePointAt(0) ?? 0;
    const covered = faces.some((face) =>
      face.ranges.some(([first, last]) => point >= first && point <= last),
    );
    if (!covered && !missing.includes(label(char))) missing.push(label(char));
  }
  return missing;
}

const fontsCss = readFileSync(here('./fonts.css'), 'utf8');
const tokensCss = readFileSync(here('./tokens.css'), 'utf8');
const manifest = JSON.parse(readFileSync(here('../../assets.license.json'), 'utf8')) as {
  readonly assets: readonly { readonly file: string }[];
};

const faces = facesIn(fontsCss);
const stacks = stacksIn(tokensCss);

/**
 * What the launch locales render, in their own scripts.
 *
 * The native names are what a language switcher shows for every locale at once, so all five
 * are on one page together. The two sentences are shaped like the shell's own copy — a
 * heading, a seat's turn, a score — with the punctuation each language uses: the Devanagari
 * danda `।`, the Arabic comma `،` and question mark `؟`, and the digits each script has of
 * its own (`३`, `٣`), which a locale may choose over ASCII digits and which the faces must
 * carry either way.
 */
const bots = seatNamesFor({ p1: 'easy', p2: 'easy' });
const SAMPLES: Readonly<Record<string, string>> = {
  'Hindi — native name': 'हिन्दी',
  'Indonesian — native name': 'Bahasa Indonesia',
  'Portuguese — native name': 'Português',
  'Spanish — native name': 'Español',
  'Arabic — native name': 'العربية',
  'Hindi — a sentence with its punctuation':
    'खेल शुरू करें: पिप की बारी है, बो का स्कोर ३—७ है। फिर से खेलें?',
  'Arabic — a sentence with its punctuation':
    'ابدأ اللعبة: دور بيب، نتيجة بو ٣—٧. هل تلعب مرة أخرى؟',
  'the score line, in every language': '0123456789 : — 12:34',
  'the seat names and the bot mark': `${bots.p1} ${bots.p2}`,
  'the key legends': SEAT_KEYS.map((seat) => `${seat.move} ${seat.action}`).join(' '),
};

describe('the faces fonts.css declares', () => {
  it('finds them, with a range each', () => {
    // The control on the parse: eight `@font-face` blocks over five families today, and a
    // parse that found none would make every coverage assertion below vacuous. The floor is
    // the count on the day this was written; a face added raises it, a face lost fails here.
    expect(faces.length).toBeGreaterThanOrEqual(8);
    const families = new Set(faces.map((face) => face.family));
    expect([...families].sort()).toEqual([
      'Fredoka',
      'JetBrains Mono',
      'Noto Sans Arabic',
      'Noto Sans Devanagari',
      'Plus Jakarta Sans',
    ]);
  });

  it.each(faces.map((face) => [face.src, face] as const))(
    '%s is on disk and in the licence manifest',
    (src, face) => {
      expect(existsSync(here(src)), `${src} is declared and not on disk`).toBe(true);
      const listed = manifest.assets.some(
        (asset) => asset.file === `src/styles/${src.replace(/^\.\//, '')}`,
      );
      expect(listed, `${face.family} (${src}) has no entry in assets.license.json`).toBe(true);
    },
  );

  it('are each listed by at least one stack, so every file can be fetched', () => {
    const listed = new Set([...stacks.values()].flat());
    for (const face of faces) {
      expect(listed.has(face.family), `${face.family} is declared and no stack lists it`).toBe(
        true,
      );
    }
  });
});

describe('the three stacks', () => {
  it('are all found, each reaching a self-hosted face', () => {
    expect([...stacks.keys()].sort()).toEqual(['body', 'display', 'mono']);
    for (const [name, stack] of stacks) {
      expect(facesOf(stack, faces).length, `--db-font-${name} lists no face`).toBeGreaterThan(0);
    }
  });

  it('list the script faces after the primary face, before any system family', () => {
    // Order is what decides who draws a character both faces declare. The primary face
    // must win for Latin — that is the site's typography — and a script face must come
    // before `system-ui`, or the system's Devanagari draws Hindi while Noto sits unused.
    for (const [name, stack] of stacks) {
      const primary = stack.indexOf(facesOf(stack, faces)[0]?.family ?? '');
      const devanagari = stack.indexOf('Noto Sans Devanagari');
      const arabic = stack.indexOf('Noto Sans Arabic');
      const system = stack.findIndex((family) =>
        /^(ui-|system-ui$|sans-serif$|monospace$)/.test(family),
      );
      expect(primary, `--db-font-${name}`).toBe(0);
      expect(devanagari, `--db-font-${name} does not list Noto Sans Devanagari`).toBeGreaterThan(0);
      expect(arabic, `--db-font-${name} does not list Noto Sans Arabic`).toBeGreaterThan(0);
      expect(system, `--db-font-${name} keeps no system fallback`).toBeGreaterThan(0);
      expect(
        Math.max(devanagari, arabic),
        `--db-font-${name}: a script face is after the system`,
      ).toBeLessThan(system);
    }
  });
});

describe('every launch locale reaches a face that declares its characters', () => {
  const cases = [...stacks].flatMap(([name, stack]) =>
    Object.entries(SAMPLES).map(([sample, text]) => [name, sample, text, stack] as const),
  );

  it.each(cases)('--db-font-%s draws %s', (_name, _sample, text, stack) => {
    expect(uncovered(text, facesOf(stack, faces))).toEqual([]);
  });

  it('has something to check in every sample', () => {
    // A sample of only spaces and symbols would pass every stack for nothing.
    for (const [sample, text] of Object.entries(SAMPLES)) {
      expect(
        [...text].some((char) => MUST_BE_DRAWN.test(char)),
        sample,
      ).toBe(true);
    }
  });
});

describe('the checker itself', () => {
  it('reports a script no face here declares, code point by code point', () => {
    // Bengali and Thai: neither is a launch locale, no face declares either, and the report
    // names every letter and mark. This is the run that proves a green run means something.
    for (const [, stack] of stacks) {
      const reached = facesOf(stack, faces);
      expect(uncovered('বাংলা', reached)).toEqual([
        'U+09AC "ব"',
        'U+09BE "া"',
        'U+0982 "ং"',
        'U+09B2 "ল"',
      ]);
      expect(uncovered('ไทย', reached)).toEqual(['U+0E44 "ไ"', 'U+0E17 "ท"', 'U+0E22 "ย"']);
    }
  });

  it('fails on exactly the characters a narrowed range stops covering', () => {
    // The plant: the Devanagari face with its main block taken out of the range, leaving
    // only the Vedic extensions and the punctuation it shares. Every Hindi letter is then
    // uncovered and nothing else changes.
    const narrowed = faces.map((face) =>
      face.family === 'Noto Sans Devanagari'
        ? { ...face, ranges: face.ranges.filter(([first]) => first !== 0x0900) }
        : face,
    );
    const body = stacks.get('body') ?? [];
    expect(uncovered('हिन्दी', facesOf(body, narrowed))).toEqual([
      'U+0939 "ह"',
      'U+093F "ि"',
      'U+0928 "न"',
      'U+094D "्"',
      'U+0926 "द"',
      'U+0940 "ी"',
    ]);
    expect(uncovered('Español', facesOf(body, narrowed))).toEqual([]);

    // And the Latin side: `ñ` and `ê` are in the Latin-1 half of the `latin` block
    // (U+0080–00FF), not in `latin-ext`, so a base face whose range stops at ASCII fails on
    // Spanish and Portuguese by exactly those two letters, while the script samples and the
    // ASCII around them are untouched.
    const noLatin = faces.map((face) =>
      face.family === 'Plus Jakarta Sans'
        ? {
            ...face,
            ranges: face.ranges.map(([first, last]): readonly [number, number] =>
              first === 0 && last === 0xff ? [0, 0x7f] : [first, last],
            ),
          }
        : face,
    );
    expect(uncovered('Español', facesOf(body, noLatin))).toEqual(['U+00F1 "ñ"']);
    expect(uncovered('Português', facesOf(body, noLatin))).toEqual(['U+00EA "ê"']);
    expect(uncovered('हिन्दी', facesOf(body, noLatin))).toEqual([]);
  });

  it('reads every form of the unicode-range grammar, and refuses what it cannot read', () => {
    expect(parseUnicodeRange('U+0900-097F, U+20B9, U+00??')).toEqual([
      [0x0900, 0x097f],
      [0x20b9, 0x20b9],
      [0x0000, 0x00ff],
    ]);
    expect(() => parseUnicodeRange('U+0900-097F, 0900')).toThrow(/unreadable/);
    expect(() => parseUnicodeRange('U+09??-097F')).toThrow(/wildcard/);
  });

  it('exempts symbols and separators, and nothing that must be drawn', () => {
    expect(uncovered('🎲 → ←   ', [])).toEqual([]);
    expect(uncovered('a', [])).toEqual(['U+0061 "a"']);
    expect(uncovered('।', [])).toEqual(['U+0964 "।"']);
  });
});
