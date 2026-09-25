import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
 * Every `@font-face` in `fonts.css` that names a file: its family, its range, that its file is
 * on disk, and that the file has an entry in `assets.license.json` (rule 3 —
 * `check-asset-licenses.mjs` holds the same thing at build, but that runs after `pnpm test`,
 * and a font added without a licence entry should fail on the machine of whoever added it).
 * Every family declared is listed by at least one stack, because a face nothing lists is a
 * file nothing fetches.
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
 * ## The second list, and why it covers nothing
 *
 * Three `@font-face` blocks in `fonts.css` name no file at all. They are the metric-matched
 * fallbacks of #187: `src: local('Arial')`, four descriptors, no `url()` and no
 * `unicode-range`, sitting second in each stack so that the face which draws before the real
 * one arrives is already the right size. They are parsed into `fallbacks` rather than `faces`,
 * and they contribute **no coverage whatsoever**.
 *
 * That is the honest reading, not a convenience. A `local()` face does not ship a glyph; it
 * borrows the device's, and which glyphs the device has is exactly the thing this file cannot
 * see — the same unknown as `ui-rounded` or `system-ui`, which the stack lists and this guard
 * has always treated as no coverage. Counting them as covering everything, which is what a
 * missing `unicode-range` means to a browser, would make the Bengali and Thai control below
 * come back empty from every stack and quietly gut the whole guard: a face that covers
 * everything covers Bengali. Counting them as nothing keeps every assertion here about the
 * files this repository actually ships, and the assertions about the fallbacks themselves —
 * that they exist, carry all four descriptors, name no file, and sit immediately after their
 * primary and ahead of the generics — are held separately below.
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
 * A face with no file: `src: local(…)` and the descriptors that bend the device's face onto
 * a primary's metrics. It has no range because it has no cmap this repository can read.
 */
interface FallbackFace {
  readonly family: string;
  /** The names its `src` asks the device for, in order. */
  readonly locals: readonly string[];
  /**
   * What it is allowed to draw. Not what it *can* draw — that is the device's cmap — but the
   * ceiling this stylesheet puts on it, which must be its primary's own claim and no more.
   */
  readonly ranges: readonly (readonly [number, number])[];
  /** Every descriptor in the block, by name, as written. */
  readonly descriptors: Readonly<Record<string, string>>;
}

/** `[first, last]` pairs sorted and merged, so two spellings of one claim compare equal. */
function mergeRanges(
  ranges: readonly (readonly [number, number])[],
): (readonly [number, number])[] {
  const merged: [number, number][] = [];
  for (const [first, last] of [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const previous = merged.at(-1);
    if (previous !== undefined && first <= previous[1] + 1)
      previous[1] = Math.max(previous[1], last);
    else merged.push([first, last]);
  }
  return merged;
}

/** The four descriptors a metric-matched fallback is not a metric match without. */
const OVERRIDES = ['size-adjust', 'ascent-override', 'descent-override', 'line-gap-override'];

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

/**
 * Every `@font-face` in a stylesheet's source, split by whether it ships a file.
 *
 * Comments are stripped first so prose cannot match. A block whose `src` is `local()` goes to
 * `fallbacks` and is held to a different standard — four descriptors and no file, but the same
 * requirement of a `unicode-range` — while a block that names a file must still carry a
 * family, a `url()` and a `unicode-range` or this throws,
 * because a face parsed into neither list is a face no assertion below can see. A block that
 * mixes the two is refused rather than guessed at: a `local()` in front of a `url()` is a
 * real pattern elsewhere, it would need a range and a licence entry as well as the
 * descriptors, and nothing here declares one.
 */
function facesIn(css: string): { faces: Face[]; fallbacks: FallbackFace[] } {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const faces: Face[] = [];
  const fallbacks: FallbackFace[] = [];
  for (const [, block = ''] of code.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const family = /font-family:\s*'([^']+)'/.exec(block)?.[1];
    if (family === undefined) throw new Error(`a @font-face is missing a family:\n${block}`);
    const locals = [...block.matchAll(/local\('([^']+)'\)/g)].map(([, name = '']) => name);
    if (locals.length > 0) {
      if (/url\(/.test(block)) {
        throw new Error(`a @font-face mixes local() and url(), which this cannot read:\n${block}`);
      }
      const descriptors = Object.fromEntries(
        [...block.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)].map(([, name = '', value = '']) => [
          name,
          value.trim(),
        ]),
      );
      const fallbackRange = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
      if (fallbackRange === undefined) {
        throw new Error(`a local() @font-face is missing a unicode-range:\n${block}`);
      }
      fallbacks.push({ family, locals, ranges: parseUnicodeRange(fallbackRange), descriptors });
      continue;
    }
    const src = /src:\s*url\('([^']+)'\)/.exec(block)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
    if (src === undefined || range === undefined) {
      throw new Error(`a @font-face is missing a src or unicode-range:\n${block}`);
    }
    faces.push({ family, src, ranges: parseUnicodeRange(range) });
  }
  return { faces, fallbacks };
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
  readonly assets: readonly { readonly file: string; readonly family?: string }[];
};

const { faces, fallbacks } = facesIn(fontsCss);
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
    // The control on the parse: eight file-bearing `@font-face` blocks over five families
    // today — the three `local()` blocks of #187 are counted in the describe below, not here
    // — and a parse that found none would make every coverage assertion below vacuous. The
    // floor is the count on the day this was written; a face added raises it, one lost fails.
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
    for (const face of [...faces, ...fallbacks]) {
      expect(listed.has(face.family), `${face.family} is declared and no stack lists it`).toBe(
        true,
      );
    }
  });

  it('are the whole of what the fonts directory ships', () => {
    // Both directions, because the two failures look nothing alike: a face declared and not
    // on disk 404s in a browser (the assertion above), and a file on disk that no
    // `@font-face` names is bytes in the repository nothing can ever fetch. The count is what
    // makes the #187 faces' claim — "no `url()`, so no file" — checkable rather than stated.
    const shipped = readdirSync(here('./fonts')).filter((name) => name.endsWith('.woff2'));
    expect(shipped.sort()).toEqual(
      faces.map((face) => face.src.replace('./fonts/', '')).sort((a, b) => a.localeCompare(b)),
    );
  });
});

/**
 * The metric-matched fallbacks of #187: what they must be, and where they must sit.
 *
 * Each is `src: local(…)` and four descriptors, computed in `fonts.css`'s header from metrics
 * read out of both faces with fontkit. What is held here is everything about them that can be
 * held without a browser — that one exists per primary, that all four descriptors are present
 * and are percentages, that none of them names a file or takes a licence entry, and that each
 * sits immediately after its primary and ahead of the generics in every stack. That they
 * actually make the swap shiftless is `e2e/font-swap.spec.ts`, which needs a real face to
 * measure and so cannot live here.
 */
describe('the metric-matched fallback faces (#187)', () => {
  const primaries = [...new Set(faces.map((face) => face.family))].filter((family) =>
    [...stacks.values()].some((stack) => stack[0] === family),
  );

  it('gives every primary family one, and declares nothing else with local()', () => {
    expect(primaries.sort()).toEqual(['Fredoka', 'JetBrains Mono', 'Plus Jakarta Sans']);
    expect(fallbacks.map((face) => face.family).sort()).toEqual(
      primaries.map((family) => `${family} Fallback`).sort(),
    );
  });

  it.each(fallbacks.map((face) => [face.family, face] as const))(
    '%s asks the device for a named face and carries all four descriptors',
    (family, face) => {
      expect(face.locals, `${family} asks the device for nothing`).not.toHaveLength(0);
      for (const descriptor of OVERRIDES) {
        expect(face.descriptors[descriptor], `${family} has no ${descriptor}`).toMatch(
          /^\d+(?:\.\d+)?%$/,
        );
      }
      // A fallback face ships no glyph, so rule 3 has nothing to bite on — and an entry for
      // one would be a licence claim over somebody else's installed font.
      expect(
        manifest.assets.filter((asset) => asset.family === family),
        `${family} has a licence entry for a file it does not ship`,
      ).toEqual([]);
    },
  );

  it('sits immediately after its primary in every stack, and ahead of the generics', () => {
    for (const [name, stack] of stacks) {
      const primary = facesOf(stack, faces)[0]?.family ?? '';
      expect(stack[1], `--db-font-${name} does not put the fallback second`).toBe(
        `${primary} Fallback`,
      );
      const generic = stack.findIndex((family) =>
        /^(ui-|system-ui$|sans-serif$|monospace$)/.test(family),
      );
      expect(generic, `--db-font-${name}: the fallback is after the system`).toBeGreaterThan(1);
    }
  });

  it('claims exactly what its primary claims, and not one code point more', () => {
    // The assertion this file exists for twice over. A `local()` face with no `unicode-range`
    // claims every code point, and the faces these ask the device for are not Latin-only:
    // Arial and Courier New both carry Arabic, Hebrew, Greek and Cyrillic. Written without a
    // range, `'Plus Jakarta Sans Fallback'` sat between Plus Jakarta Sans and Noto Sans Arabic
    // in the body stack and drew Arabic out of the device's Arial — Noto Sans Arabic was never
    // fetched, and #224's one-Arabic-face-everywhere was undone by a face added to stop a
    // reflow. `e2e/fonts.spec.ts` is what caught it, on all four browser projects.
    //
    // Derived from the primary's own faces rather than written out, so the two cannot be
    // edited apart: add a subset to a family and its stand-in's range has to grow with it.
    for (const fallback of fallbacks) {
      const primary = fallback.family.replace(/ Fallback$/, '');
      const declared = faces.filter((face) => face.family === primary);
      expect(declared.length, `${fallback.family} stands in for no declared face`).toBeGreaterThan(
        0,
      );
      expect(
        mergeRanges(fallback.ranges),
        `${fallback.family} does not claim exactly what ${primary} claims`,
      ).toEqual(mergeRanges(declared.flatMap((face) => face.ranges)));
    }
  });

  it('is listed by a stack and still reaches no face, so it covers nothing', () => {
    // The two halves that have to hold together. The stacks really do list them — otherwise
    // the descriptors above are decoration — and `facesOf`, which is what every coverage
    // assertion in this file runs on, still comes back with only the faces that ship a file.
    const named = new Set(fallbacks.map((face) => face.family));
    for (const [name, stack] of stacks) {
      expect(
        stack.some((family) => named.has(family)),
        `--db-font-${name}`,
      ).toBe(true);
      expect(facesOf(stack, faces).filter((face) => named.has(face.family))).toEqual([]);
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

  it('puts a local() face in the other list, where it covers nothing', () => {
    // The proof that the split is the split it says it is, on a sheet small enough to read.
    // The last assertion is the one that matters: were a `local()` face counted as a Face,
    // its missing `unicode-range` would mean "everything" — the meaning a browser gives it —
    // and the Bengali control above would come back empty from every stack having checked
    // nothing at all.
    const sheet = [
      "@font-face { font-family: 'Primary';",
      "  src: url('./fonts/primary.woff2') format('woff2');",
      '  unicode-range: U+0000-00FF; }',
      "@font-face { font-family: 'Primary Fallback';",
      "  src: local('Arial'), local('Helvetica');",
      '  size-adjust: 99.57%;',
      '  ascent-override: 97.82%;',
      '  descent-override: 23.7%;',
      '  line-gap-override: 0%;',
      '  unicode-range: U+0000-00FF; }',
    ].join('\n');
    const read = facesIn(sheet);
    expect(read.faces.map((face) => face.family)).toEqual(['Primary']);
    expect(read.fallbacks.map((face) => face.family)).toEqual(['Primary Fallback']);
    expect(read.fallbacks[0]?.locals).toEqual(['Arial', 'Helvetica']);
    expect(read.fallbacks[0]?.descriptors['size-adjust']).toBe('99.57%');
    expect(uncovered('বাংলা', read.faces)).toHaveLength(4);
  });

  it('refuses a face it cannot classify rather than dropping it', () => {
    // A block that reaches neither list is a face no assertion in this file can see, which is
    // the quietest way a coverage guard stops covering something.
    expect(() =>
      facesIn("@font-face { font-family: 'X'; src: local('Arial'), url('./x.woff2'); }"),
    ).toThrow(/mixes local\(\) and url\(\)/);
    expect(() => facesIn("@font-face { src: url('./x.woff2'); unicode-range: U+0020; }")).toThrow(
      /missing a family/,
    );
    expect(() => facesIn("@font-face { font-family: 'X'; src: url('./x.woff2'); }")).toThrow(
      /missing a src or unicode-range/,
    );
    // And the one that would give a stand-in the run of every script the device has.
    expect(() => facesIn("@font-face { font-family: 'X'; src: local('Arial'); }")).toThrow(
      /local\(\) @font-face is missing a unicode-range/,
    );
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
