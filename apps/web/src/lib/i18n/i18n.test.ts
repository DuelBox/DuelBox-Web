import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyLocale,
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_CODES,
  LOCALES,
  localeFromSearch,
  resolveLocale,
} from './locales';
import { EMPTY_CATALOGUE, IMPORTERS, loadCatalogue, type CatalogueImporter } from './load';
import { plural, t } from './messages';
import { pseudoAccent, pseudoMirror } from './pseudo';

/**
 * The i18n framework, held to the things #219 actually promises.
 *
 * "Only the active locale downloads" and "switching applies immediately" are properties of the
 * *build*, not of a function, so most of what is below is written to fail on the shapes that
 * would quietly break them rather than on a return value:
 *
 *  - a catalogue named by a static `import` anywhere would fold every locale into the shell
 *    chunk, type-check cleanly, pass every behavioural test here, and cost every visitor every
 *    language. `the lazy guard` is the test that fails on it, and it is the one that matters
 *    most in this file; `check-size.mjs` catches the same thing a build later, by weight;
 *  - the default locale importing *anything* would mean English pays for the framework, so it
 *    is asserted against an importer that records whether it was called rather than against the
 *    value it returns;
 *  - a locale in the registry with no catalogue file, or a catalogue file no importer reaches,
 *    or an importer pointed at the wrong file, would offer a language whose chunk cannot be
 *    fetched or is the wrong one. The registry, the directory, the importer table and the
 *    module each importer resolves are checked against each other in every direction;
 *  - a catalogue key the site never renders, or a msgid a pseudo-locale lacks, is a gap
 *    between the extractor and the catalogues, and both pseudo-locales exist to make such gaps
 *    visible — so neither is allowed to have one;
 *  - the inline script in `layout.tsx` stamps `lang` and `dir` before paint from its own copy
 *    of the codes, and a copy is a thing that drifts.
 *
 * Every one of these was watched failing on purpose before it was believed, and the PR that
 * added them lists the mutation and the failure text for each.
 */

const here = dirname(fileURLToPath(import.meta.url));
/** `apps/web/src` — the tree `check-zero-cost.mjs` and `check-size.mjs` both reason about. */
const webSrc = join(here, '..', '..');
const catalogueDir = join(here, 'catalogues');
const loader = join(here, 'load.ts');
const self = join(here, 'i18n.test.ts');
const extractor = join(here, 'extract.ts');
const layout = join(webSrc, 'app', 'layout.tsx');
const fontsCss = join(webSrc, 'styles', 'fonts.css');

/** The msgid list the extractor wrote, which `extract.test.ts` holds to the source. */
const msgids = JSON.parse(
  readFileSync(join(here, 'messages.en.generated.json'), 'utf8'),
) as string[];

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) found.push(path);
  }
  return found;
}

/** The locale codes a catalogue file exists for, from the directory rather than from code. */
function catalogueFiles(): string[] {
  return readdirSync(catalogueDir)
    .filter((entry) => entry.endsWith('.generated.ts'))
    .map((entry) => entry.slice(0, -'.generated.ts'.length))
    .sort();
}

const nonDefaultLocales = LOCALE_CODES.filter((code) => code !== DEFAULT_LOCALE);
const rtlLocales = LOCALE_CODES.filter((code) => LOCALES[code].dir === 'rtl');

describe('the locale registry', () => {
  it('offers the default locale and gives every locale a name and a direction', () => {
    expect(LOCALE_CODES).toContain(DEFAULT_LOCALE);
    for (const code of LOCALE_CODES) {
      expect(LOCALES[code].name.length, code).toBeGreaterThan(0);
      expect(['ltr', 'rtl'], code).toContain(LOCALES[code].dir);
    }
    expect(LOCALES[DEFAULT_LOCALE].dir).toBe('ltr');
  });

  it('has something to lazy-load and something right-to-left, or none of this is tested', () => {
    // A registry with only English in it would pass every behavioural test below without
    // ever fetching a chunk or mirroring a page. The pseudo-locales are what make them mean
    // anything.
    expect(nonDefaultLocales.length).toBeGreaterThan(0);
    expect(rtlLocales.length).toBeGreaterThan(0);
  });

  it('keeps a code it knows and falls back for anything else', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('en-XA')).toBe('en-XA');
    expect(resolveLocale('ar-XB')).toBe('ar-XB');
    // A code from a build that shipped a locale this one does not have. Keeping it would
    // leave the switcher showing a language whose chunk cannot be fetched.
    expect(resolveLocale('de')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('EN')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(42)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({ locale: 'en' })).toBe(DEFAULT_LOCALE);
  });

  it('recognises exactly the codes it lists', () => {
    for (const code of LOCALE_CODES) expect(isLocale(code), code).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

/**
 * The language menu renders every locale's name on every visit to `/settings/`, in every locale,
 * so a name is subject to the font rule an English page is. `styles/fonts.css` gates each
 * `-latin-ext` face behind a `unicode-range`, and `size-budget.json`'s first-session line rests
 * on "fetched only when a glyph in that range renders, which no English page does". The first
 * draft of the registry broke that with one letter: `Éñglïšh` has a `š` (U+0161), and WebKit
 * fetched the 21,688-byte `plus-jakarta-sans-latin-ext` face on the English settings page to
 * shape an `<option>` nobody had selected. The ranges are read out of the stylesheet rather than
 * copied here, so a face that changes its subset moves this guard with it.
 */
describe('the locale names and the range-gated faces', () => {
  /** The `[from, to]` code-point ranges of every `-latin-ext` face in `fonts.css`. */
  const latinExt = (): [number, number][] => {
    const ranges: [number, number][] = [];
    for (const block of readFileSync(fontsCss, 'utf8').split('@font-face')) {
      if (!/src:\s*url\('[^']*-latin-ext\.woff2'\)/.test(block)) continue;
      const declared = /unicode-range:\s*([^;]+);/.exec(block)?.[1] ?? '';
      for (const match of declared.matchAll(/U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?/g)) {
        ranges.push([parseInt(match[1]!, 16), parseInt(match[2] ?? match[1]!, 16)]);
      }
    }
    return ranges;
  };
  /** The characters of `text` that would make a browser fetch a `-latin-ext` face. */
  const needingLatinExt = (text: string): string[] => {
    const ranges = latinExt();
    return [...text].filter((char) => {
      const point = char.codePointAt(0) ?? 0;
      return ranges.some(([from, to]) => point >= from && point <= to);
    });
  };

  it('reads the ranges out of fonts.css and recognises a glyph inside them', () => {
    // The control: the letter the first draft shipped is inside, and the base subset is not.
    expect(latinExt().length).toBeGreaterThan(0);
    expect(needingLatinExt('Éñglïšh')).toEqual(['š']);
    expect(needingLatinExt('Éñglïsh (pseudo) — English')).toEqual([]);
  });

  it('names every locale with glyphs the base subset covers', () => {
    for (const code of LOCALE_CODES) {
      expect(needingLatinExt(LOCALES[code].name), `${code}: ${LOCALES[code].name}`).toEqual([]);
    }
  });
});

/**
 * `?lang=` is the whole of "routing-aware" that a `output: 'export'` build can honestly
 * offer — see `provider.tsx`. It is read, never written back.
 */
describe('a locale asked for on the URL', () => {
  it('reads a code this build has, and nothing else', () => {
    expect(localeFromSearch('?lang=en-XA')).toBe('en-XA');
    expect(localeFromSearch('lang=ar-XB')).toBe('ar-XB');
    expect(localeFromSearch('?from=share&lang=en-XA&x=1')).toBe('en-XA');
    expect(localeFromSearch('?lang=en')).toBe('en');
  });

  it('distinguishes "asked for nothing" from "asked for something unknown"', () => {
    // Both are null: neither may overwrite a choice the player already made. They are
    // separated from a *valid* request, which is the only thing that writes.
    expect(localeFromSearch('')).toBeNull();
    expect(localeFromSearch('?theme=dark')).toBeNull();
    expect(localeFromSearch('?lang=')).toBeNull();
    expect(localeFromSearch('?lang=de')).toBeNull();
    expect(localeFromSearch('?lang=../../etc/passwd')).toBeNull();
  });
});

describe('the registry, the catalogue files, the importers and the modules', () => {
  it('lists one generated catalogue for every locale but the default', () => {
    // Three places have to agree or the control offers a language that cannot load. The
    // default locale is the one with no file: English is the fallback itself.
    expect(catalogueFiles()).toEqual([...nonDefaultLocales].sort());
    expect(catalogueFiles()).not.toContain(DEFAULT_LOCALE);
  });

  it('has an importer for every locale, and only the default has none', () => {
    expect(Object.keys(IMPORTERS).sort()).toEqual([...LOCALE_CODES].sort());
    for (const code of LOCALE_CODES) {
      expect(IMPORTERS[code] === null, code).toBe(code === DEFAULT_LOCALE);
    }
  });

  it('resolves each importer to a module that says it is for that locale', async () => {
    // A copy-pasted importer pointing at the wrong file type-checks and lazy-loads and
    // renders the wrong language. The module carries its own code so that this can fail.
    for (const code of nonDefaultLocales) {
      const module = await IMPORTERS[code]!();
      expect(module.default.locale, code).toBe(code);
    }
  });
});

/**
 * The guard the acceptance criterion rests on.
 *
 * `import()` is what makes a catalogue an async chunk; a static `import … from` on the same
 * file makes it part of whatever chunk imported it, which for anything in the shell means every
 * visitor downloads every language. Nothing else in the unit suite would notice: it
 * type-checks, it renders identically, and every other test in this file still passes.
 */
describe('the lazy guard', () => {
  /**
   * A module specifier that reaches the catalogues: `'…/catalogues/<file>'`, or the directory
   * itself — `'./catalogues'`, which resolves to a barrel `catalogues/index.ts` if one exists.
   * The first draft matched only the form with a slash after the name, and a review showed the
   * gap: a barrel in the directory (exempt below, because the directory is the thing being
   * protected) imported as `'./catalogues'` folded a catalogue into the shell while every test
   * here passed. The word has to sit where a path segment sits — after the quote or after a
   * `/` — so a user-facing string with "catalogues" in its prose is not a specifier.
   * Backticked prose is not one either.
   */
  const specifier = String.raw`['"](?:[^'"\n]*\/)?\.?catalogues(?:\/[^'"\n]*)?['"]`;
  const quoted = new RegExp(specifier, 'g');
  const dynamic = new RegExp(String.raw`\bimport\(\s*` + specifier + String.raw`\s*\)`, 'g');

  /**
   * This file (it contains the patterns above); the catalogues themselves, which are the thing
   * being protected rather than a route to it; and the extractor, which names the directory in
   * order to *write* it and is a build-time module — the test below it holds that nothing but
   * its own test imports it, so the exemption cannot become a route into the shell.
   */
  const exempt = (file: string): boolean =>
    file === self || file === extractor || file.startsWith(catalogueDir + sep);

  it('finds the app source tree, so an empty walk cannot pass', () => {
    // The failure this repository keeps a count of: a scan that found nothing and said
    // everything held. `apps/web/src` is hundreds of files; fifty is a floor, not a target.
    expect(sources(webSrc).length).toBeGreaterThan(50);
  });

  it('matches the shapes it is for, and not prose', () => {
    // The pattern is the guard; a pattern nobody has run on its own inputs is a guess.
    for (const hit of [
      "'./catalogues/en-XA.generated'",
      '"../i18n/catalogues/x"',
      "'./catalogues'",
      "'@/lib/i18n/catalogues'",
      "'catalogues'",
    ]) {
      expect(hit.match(quoted), hit).not.toBeNull();
    }
    for (const miss of ["'Browse the catalogues'", "'catalogues-of-old'", '`./catalogues`']) {
      expect(miss.match(quoted), miss).toBeNull();
    }
  });

  it('lets only load.ts name a catalogue, or the directory they live in', () => {
    const naming = sources(webSrc)
      .filter((file) => !exempt(file))
      .filter((file) => [...readFileSync(file, 'utf8').matchAll(quoted)].length > 0);
    expect(naming.map((file) => relative(webSrc, file))).toEqual([relative(webSrc, loader)]);
  });

  it('keeps the extractor a build-time module, imported by nothing but its own test', () => {
    // The exemption above would otherwise be a route: `extract.ts` names the directory, and a
    // component that imported it would carry the TypeScript compiler into the shell as well.
    // Every way of reaching it: the sibling form, the `@/` alias, and any relative path that
    // ends in `/i18n/extract` — static or `import()`. The first draft matched the first two
    // only, so `'../lib/i18n/extract'` from `app/` or `components/` walked past it.
    const reaches = /(?:from\s+|import\(\s*)['"](?:\.\/extract|[^'"\n]*\/i18n\/extract)['"]/;
    const importers = sources(webSrc)
      .filter((file) => file !== extractor)
      .filter((file) => reaches.test(readFileSync(file, 'utf8')))
      .map((file) => relative(webSrc, file));
    expect(importers).toEqual(['lib/i18n/extract.test.ts']);
  });

  it('keeps the catalogues directory to generated modules, so a barrel cannot exist there', () => {
    // The directory is exempt from the specifier scan, which is what makes a barrel inside it
    // invisible to the scan; so the directory itself is held to one shape instead.
    const entries = readdirSync(catalogueDir);
    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.filter((entry) => !/^[A-Za-z][A-Za-z0-9-]*\.generated\.ts$/.test(entry)),
    ).toEqual([]);
  });

  it('lets load.ts name one only inside import()', () => {
    const source = readFileSync(loader, 'utf8');
    const named = [...source.matchAll(quoted)];
    const imported = [...source.matchAll(dynamic)];
    expect(named.length, 'load.ts names no catalogue at all').toBe(nonDefaultLocales.length);
    expect(imported.map((match) => match[0])).toHaveLength(named.length);
  });
});

describe('loading a catalogue', () => {
  it('imports nothing at all for the default locale', async () => {
    // The "behaves exactly as today" promise, as a fact rather than a claim: a visitor who
    // never touches the control pays no chunk, no request and no rejected promise.
    let asked = false;
    const importer: CatalogueImporter = () => {
      asked = true;
      return Promise.reject(new Error('the default locale must not import anything'));
    };
    const catalogue = await loadCatalogue(DEFAULT_LOCALE, importer);
    expect(asked).toBe(false);
    expect(catalogue).toEqual(EMPTY_CATALOGUE);
  });

  it('fetches a real locale through its own importer', async () => {
    for (const code of nonDefaultLocales) {
      const catalogue = await loadCatalogue(code);
      // Not merely loaded: actually different from English, or the locale proves nothing.
      expect(t(catalogue, 'Mute sound'), code).not.toBe('Mute sound');
    }
  });

  it('falls back to English when the chunk cannot be fetched', async () => {
    // Offline on a first switch, or a deploy that moved the file under a cached shell. The
    // player loses their translation, not their page.
    const catalogue = await loadCatalogue(nonDefaultLocales[0]!, () =>
      Promise.reject(new Error('offline')),
    );
    expect(catalogue).toEqual(EMPTY_CATALOGUE);
    expect(t(catalogue, 'Mute sound')).toBe('Mute sound');
  });
});

describe('the extracted messages and the catalogues', () => {
  it('has a msgid list with the strings this batch converted in it', () => {
    expect(msgids.length).toBeGreaterThan(0);
    expect(msgids).toContain('Mute sound');
    expect(msgids).toContain('Unmute sound');
  });

  it('ships no catalogue key the site never renders', async () => {
    // A catalogue is a place strings go to be forgotten. Anything in one must be a msgid the
    // extractor found at a call site or in `sources.ts`, or it is copy the site stopped
    // showing — or a key a translator invented.
    for (const code of nonDefaultLocales) {
      const module = await IMPORTERS[code]!();
      const stray = Object.keys(module.default.messages).filter((key) => !msgids.includes(key));
      expect(stray, code).toEqual([]);
    }
  });

  it('has every pseudo-locale translate every msgid, so a gap means a gap in the extraction', async () => {
    // Not a requirement of the format — a catalogue may be partial and the fallback is tested
    // above. It is the pseudo-locales' job: anything left in English on one of their screens
    // should be a literal #220 has not reached, never a msgid #219 forgot. When a reviewed
    // translation arrives (#221) it is allowed to be incomplete, and this loop should skip it.
    for (const code of nonDefaultLocales) {
      const module = await IMPORTERS[code]!();
      expect(Object.keys(module.default.messages).sort(), code).toEqual([...msgids].sort());
      for (const id of msgids) expect(module.default.messages[id], `${code}: ${id}`).not.toBe(id);
    }
  });
});

describe('the lookup', () => {
  it('prefers the catalogue and falls through to the English id for a key it lacks', () => {
    expect(t({ 'Mute sound': 'Silenciar' }, 'Mute sound')).toBe('Silenciar');
    expect(t({ 'Mute sound': 'Silenciar' }, 'Unmute sound')).toBe('Unmute sound');
    expect(t({}, 'Mute sound')).toBe('Mute sound');
  });

  it('fills placeholders, numbers included, and the same one more than once', () => {
    expect(t({}, 'Round {n} of {total}', { n: 2, total: 5 })).toBe('Round 2 of 5');
    expect(
      t({ 'Round {n} of {total}': '{total} rondas, ahora la {n}' }, 'Round {n} of {total}', {
        n: 2,
        total: 5,
      }),
    ).toBe('5 rondas, ahora la 2');
    expect(t({}, '{count} and again {count}', { count: 3 })).toBe('3 and again 3');
  });

  it('leaves a placeholder with no value as written', () => {
    // A translator's typo in a placeholder name should be visible, not a blank in a sentence.
    expect(t({}, 'Round {n} of {total}', { n: 2 })).toBe('Round 2 of {total}');
    expect(t({}, 'Round {n} of {total}')).toBe('Round {n} of {total}');
  });
});

describe('the plural rule', () => {
  const forms = { one: '{count} game', other: '{count} games' };

  it("picks English's two categories from the English forms", () => {
    expect(plural({}, 'en', 1, forms)).toBe('1 game');
    expect(plural({}, 'en', 0, forms)).toBe('0 games');
    expect(plural({}, 'en', 7, forms)).toBe('7 games');
  });

  it('translates the chosen form through the catalogue', () => {
    const catalogue = { '{count} game': '{count} juego', '{count} games': '{count} juegos' };
    expect(plural(catalogue, 'es', 1, forms)).toBe('1 juego');
    expect(plural(catalogue, 'es', 3, forms)).toBe('3 juegos');
  });

  it('takes a suffixed form for a category English does not have, and degrades without it', () => {
    // Arabic has six categories; `ar-XB` inherits its rule, which is what makes it the
    // locale that exercises this. A catalogue supplies the extra forms under `<other>#<cat>`.
    const catalogue = {
      '{count} games': 'X {count}',
      '{count} games#two': 'TWO',
      '{count} games#few': 'FEW {count}',
    };
    expect(plural(catalogue, 'ar-XB', 2, forms)).toBe('TWO');
    expect(plural(catalogue, 'ar-XB', 5, forms)).toBe('FEW 5');
    // `many` not supplied: the translated `other`, not the English, and never a blank.
    expect(plural(catalogue, 'ar-XB', 11, forms)).toBe('X 11');
    // No catalogue at all: English.
    expect(plural({}, 'ar-XB', 11, forms)).toBe('11 games');
  });
});

describe('the pseudo-locale transforms', () => {
  it('are deterministic', () => {
    expect(pseudoAccent('Mute sound')).toBe(pseudoAccent('Mute sound'));
    expect(pseudoMirror('Mute sound')).toBe(pseudoMirror('Mute sound'));
  });

  it('accents every letter, pads to half again the length, and brackets the result', () => {
    const out = pseudoAccent('Mute sound');
    expect(out.startsWith('⟦')).toBe(true);
    expect(out.endsWith('⟧')).toBe(true);
    // No plain Latin letter survives: a string that still reads as English on the pseudo
    // screen is one this never saw.
    expect(out).not.toMatch(/[A-Za-z]/);
    expect(out).toContain('Ṁûŧé šöûñð');
    // Ten characters in, at least fifteen out before the brackets are even counted.
    expect(out.length - 2).toBeGreaterThanOrEqual(Math.ceil(10 * 1.5));
  });

  it('is at least 150% of the source length for every string, which is what #223 asks', () => {
    // The acceptance criterion of #223 is a ratio, so it is asserted as one — over short
    // strings, long ones, a single word, punctuation and a string that is mostly
    // placeholder, because the padding is scaled from a length the placeholders count
    // towards and a string can be nearly all placeholder.
    const strings = [
      'OK',
      'Go',
      'Mute',
      'Play together here',
      'Press again to reset everything',
      '{count} games',
      'Round {n} of {total}',
      '{name} wins',
      'Best of 3 — first to 2 takes it.',
      'Every game on this site is playable by two people on one device, right now.',
    ];
    for (const source of strings) {
      expect(pseudoAccent(source).length, source).toBeGreaterThanOrEqual(source.length * 1.5);
    }
  });

  it('pads after the words rather than inside one, so every word can still break', () => {
    // A padded word is a word no engine can break, which would be a different failure from
    // the long line #223 is looking for.
    const out = pseudoAccent('Mute sound');
    expect(out).toMatch(/^⟦\S+ \S+ ·+⟧$/u);
    expect(out).not.toMatch(/[^ ·]·/u);
  });

  it('mirrors each word with a bidi override and closes every override it opens', () => {
    const out = pseudoMirror('Mute sound');
    expect(out).toBe('\u202EMute\u202C \u202Esound\u202C');
    expect((out.match(/\u202E/g) ?? []).length).toBe((out.match(/\u202C/g) ?? []).length);
  });

  it('keeps every placeholder intact in both, so t() can still fill it', () => {
    const id = 'Round {n} of {total}';
    expect(pseudoAccent(id)).toContain('{n}');
    expect(pseudoAccent(id)).toContain('{total}');
    expect(t({ [id]: pseudoAccent(id) }, id, { n: 2, total: 5 })).toContain('2');
    expect(t({ [id]: pseudoAccent(id) }, id, { n: 2, total: 5 })).not.toContain('{');
    expect(pseudoMirror(id)).toContain(' {n} ');
    expect(pseudoMirror(id)).not.toContain('\u202E{');
  });
});

describe('applying a locale to the document', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeDocument() {
    const attrs = new Map<string, string>();
    return {
      documentElement: {
        setAttribute: (name: string, value: string) => attrs.set(name, value),
        removeAttribute: (name: string) => attrs.delete(name),
      },
      attrs,
    };
  }

  it('stamps lang and dir, and puts both back for the default rather than removing them', () => {
    // Unlike `data-theme`, `lang` is in the server-rendered markup: removing it would leave
    // the page with no declared language at all, which is worse than declaring English. And
    // `dir` has to go back to `ltr` or a switch away from `ar-XB` leaves the shell mirrored.
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    applyLocale('ar-XB');
    expect(doc.attrs.get('lang')).toBe('ar-XB');
    expect(doc.attrs.get('dir')).toBe('rtl');
    applyLocale('en-XA');
    expect(doc.attrs.get('lang')).toBe('en-XA');
    expect(doc.attrs.get('dir')).toBe('ltr');
    applyLocale(DEFAULT_LOCALE);
    expect(doc.attrs.get('lang')).toBe(DEFAULT_LOCALE);
    expect(doc.attrs.get('dir')).toBe('ltr');
  });

  it('does nothing, and does not throw, where there is no document', () => {
    vi.stubGlobal('document', undefined);
    expect(() => {
      applyLocale('en-XA');
    }).not.toThrow();
  });
});

/**
 * The before-paint copy of the registry. `THEME_SCRIPT` in `layout.tsx` cannot import
 * `locales.ts`, so it carries the non-default codes and their directions in one object `D`,
 * and this reads it back. A code the registry does not have must never be stamped; a
 * right-to-left locale the script does not know flashes left-to-right; a direction the script
 * disagrees with is the same flash the other way.
 */
describe('the inline head script in layout.tsx', () => {
  const source = readFileSync(layout, 'utf8');
  /** `D={'en-XA':'ltr',…}` out of the script, as code → direction. */
  const table = (): Record<string, string> | null => {
    const match = /\bD=\{([^}]*)\}/.exec(source);
    if (match === null) return null;
    return Object.fromEntries(
      [...(match[1] ?? '').matchAll(/'([^']+)':'([^']+)'/g)].map((m) => [m[1]!, m[2]!]),
    );
  };

  it('carries the table and stamps both attributes, so it cannot pass by silence', () => {
    expect(table(), 'no D={…} in THEME_SCRIPT').not.toBeNull();
    expect(Object.keys(table() ?? {}).length).toBeGreaterThan(0);
    expect(source).toContain('el.lang=l');
    expect(source).toContain('el.dir=d');
  });

  it('stamps exactly the non-default codes the registry has', () => {
    expect(Object.keys(table() ?? {}).sort()).toEqual([...nonDefaultLocales].sort());
  });

  it('gives every code the direction the registry gives it', () => {
    for (const code of nonDefaultLocales) {
      expect((table() ?? {})[code], code).toBe(LOCALES[code].dir);
    }
    expect(
      Object.entries(table() ?? {})
        .filter(([, dir]) => dir === 'rtl')
        .map(([code]) => code)
        .sort(),
    ).toEqual([...rtlLocales].sort());
  });
});
