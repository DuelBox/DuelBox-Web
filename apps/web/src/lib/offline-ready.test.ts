import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OFFLINE_READY_ATTRIBUTE,
  cachedPathnames,
  markOfflineReady,
  type AnnotatableLink,
} from './offline-ready';

/**
 * The offline-aware catalogue (#193), held to the two things about it that can be checked
 * without a browser: what it answers, and what it costs to answer it.
 *
 * The annotation itself needs Cache Storage, a service worker and a hundred and eight cards,
 * and `e2e/offline.spec.ts` is where that is proved end to end. What this file exists for is
 * the pair of failures that end-to-end run would *not* name:
 *
 * - **The wrong answer, in the direction that matters.** A cached prefetch payload has the
 *   same pathname as the page it prefetches, so counting one would put "On this device" on a
 *   game that has never been opened. The spec would fail on `sudoku` with no clue why; here
 *   it fails on the sentence that caused it.
 * - **The right answer, bought too dearly.** One pass over the store and a set lookup per
 *   card is `1 + n` cache calls for `n` caches; `caches.match(href)` per card is a hundred
 *   and eight asynchronous searches of every cache in turn. Both pass the spec. The
 *   difference is a property of the code, so it is asserted as one, on a store that counts
 *   what it is asked.
 *
 * The third job is the one the running tally in CLAUDE.md keeps asking for. Three files have
 * to agree on the string `data-offline-ready` — this module, `components/GameCard.tsx` and
 * `components/GameCard.module.css` — and nothing in a browser fails when they drift: the
 * cards simply stop being annotated. So the files are read, and so is the spec that will
 * reject the build, rather than the words being written down a second time here where they
 * could only ever agree with themselves.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const root = join(here, '..', '..', '..', '..');
const spec = readFileSync(join(root, 'e2e', 'offline.spec.ts'), 'utf8');
const module = readFileSync(join(here, 'offline-ready.ts'), 'utf8');
const card = readFileSync(join(web, 'components', 'GameCard.tsx'), 'utf8');
const cardStyles = readFileSync(join(web, 'components', 'GameCard.module.css'), 'utf8');
const browser = readFileSync(join(web, 'components', 'CatalogBrowser.tsx'), 'utf8');

/**
 * A Cache Storage that keeps a tally of every question put to it.
 *
 * The tally is the point. `keys`, `open` and `match` are the three ways to the contents of a
 * cache, and which of them a change reaches for is precisely what decides whether annotating
 * the grid costs one pass or a hundred and eight — which is invisible in a passing test and
 * invisible in a browser until the catalogue is on a phone.
 */
function countingStore(contents: Readonly<Record<string, readonly string[]>>) {
  const asked = { keys: 0, open: 0, match: 0 };
  const store = {
    keys: () => {
      asked.keys += 1;
      return Promise.resolve(Object.keys(contents));
    },
    open: (name: string) => {
      asked.open += 1;
      return Promise.resolve({
        keys: () => Promise.resolve((contents[name] ?? []).map((url) => ({ url }))),
      });
    },
    match: () => {
      asked.match += 1;
      return Promise.resolve(undefined);
    },
  };
  return { store: store as unknown as CacheStorage, asked };
}

/** A catalogue link, with the one attribute this module is allowed to touch. */
function fakeLink(pathname: string, initial: string | null = null) {
  let held = initial;
  const written: { name: string; value: string }[] = [];
  const link: AnnotatableLink = {
    pathname,
    getAttribute: (name) => (name === OFFLINE_READY_ATTRIBUTE ? held : null),
    setAttribute: (name, value) => {
      written.push({ name, value });
      if (name === OFFLINE_READY_ATTRIBUTE) held = value;
    },
  };
  return { link, written, value: () => held };
}

/**
 * A file with its comments taken out, for the three assertions below that are about what the
 * code *does*.
 *
 * Needed because both of these modules explain themselves at length, and the sentence
 * `caches.match(href)` — the shape this file exists to keep out — is written in
 * `offline-ready.ts`'s own docstring as the thing that was rejected. A guard that reads prose
 * fails on a file for describing the defect it does not have, which is the fastest way to
 * have a guard deleted. It is the same split `scripts/check-zero-cost.mjs` makes for the same
 * reason, and it is only sound while neither file contains a `//` inside a string literal;
 * neither does, and a URL in one would want the fuller parser that script has.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const ORIGIN = 'http://127.0.0.1:4173';

describe('reading what this device is holding', () => {
  it('collects the pathname of every document, across every cache', async () => {
    const { store } = countingStore({
      'duelbox-shell-abc': [`${ORIGIN}/`, `${ORIGIN}/games/`, `${ORIGIN}/offline/`],
      'duelbox-runtime-abc': [`${ORIGIN}/play/tic-tac-toe/`],
    });
    const paths = await cachedPathnames(store);
    expect([...paths].sort()).toEqual(['/', '/games/', '/offline/', '/play/tic-tac-toe/']);
  });

  /**
   * The one that decides whether the feature tells the truth.
   *
   * `next/link` prefetches the catalogue links that scroll into view, and the worker keeps
   * those payloads — under their full URL, query and all, which is exactly what `sw.js`'s
   * `documentKey` is for. Their pathname is the game's pathname. A version of this that
   * compared pathnames alone would report every game whose card had merely been *displayed*
   * as saved on the device, which is the one thing the annotation must never do, and it
   * would do it on a machine with a connection where nobody would notice.
   */
  it('does not mistake a prefetch payload for the page it prefetches', async () => {
    const { store } = countingStore({
      'duelbox-runtime-abc': [
        `${ORIGIN}/play/sudoku/?_rsc=1x9kq`,
        `${ORIGIN}/play/tic-tac-toe/`,
        `${ORIGIN}/_next/static/chunks/4127.8e3b.js`,
      ],
    });
    const paths = await cachedPathnames(store);
    expect(paths.has('/play/tic-tac-toe/')).toBe(true);
    expect(paths.has('/play/sudoku/')).toBe(false);
    // Not a rule about queries in general: a hashed chunk has none and stays, harmlessly.
    expect(paths.has('/_next/static/chunks/4127.8e3b.js')).toBe(true);
  });

  it('answers about a store with nothing in it, rather than throwing', async () => {
    const { store } = countingStore({});
    expect((await cachedPathnames(store)).size).toBe(0);
  });
});

describe('marking the grid', () => {
  it('says 1 for a game that is here and 0 for one that is not', () => {
    const held = new Set(['/play/tic-tac-toe/']);
    const saved = fakeLink('/play/tic-tac-toe/');
    const absent = fakeLink('/play/sudoku/');
    markOfflineReady([saved.link, absent.link], held);
    expect(saved.value()).toBe('1');
    expect(absent.value()).toBe('0');
    // The values the spec matches on, and the attribute it matches them under.
    expect(saved.written).toEqual([{ name: OFFLINE_READY_ATTRIBUTE, value: '1' }]);
  });

  /**
   * An empty attribute is a third state and not a synonym for `0`: it means nobody has
   * looked. The card's stylesheet shows neither word for it, which is what makes an
   * unannotated route — the landing page, a category hub, a browser with no worker — silent
   * rather than wrong. Nothing here may turn "unknown" into "measured, and not here" except
   * an actual measurement.
   */
  it('writes over the empty attribute the server rendered', () => {
    const unknown = fakeLink('/play/sudoku/', '');
    markOfflineReady([unknown.link], new Set());
    expect(unknown.value()).toBe('0');
  });

  it('leaves a card alone when it already says the right thing', () => {
    const marked = fakeLink('/play/chess/', '1');
    markOfflineReady([marked.link], new Set(['/play/chess/']));
    expect(marked.written).toEqual([]);
  });

  /**
   * Both halves of the base path, in one test, because either alone can be right while the
   * two disagree. `app/base-path.ts` names the worker's precache list as a caller that has
   * to carry the prefix; this is not one, and that is the claim being pinned. `next/link`
   * writes the prefix into every `href`, and a cache key is the URL a request was actually
   * made with, so both sides arrive with it already on them and adding it here would be the
   * only way to get a project page wrong.
   */
  it('compares what the browser gives it, on a site served from a subdirectory', () => {
    const held = new Set(['/DuelBox-Web/play/chess/']);
    const onProjectPage = fakeLink('/DuelBox-Web/play/chess/');
    const atRoot = fakeLink('/play/chess/');
    markOfflineReady([onProjectPage.link, atRoot.link], held);
    expect(onProjectPage.value()).toBe('1');
    expect(atRoot.value()).toBe('0');
  });
});

/**
 * The cost, asserted rather than described.
 *
 * `offline-ready.ts` says in its own docstring that the obvious version — `caches.match(href)`
 * per card — is a hundred and eight asynchronous searches of every cache, and that this is
 * `1 + n` calls for `n` caches whatever the catalogue grows to. A sentence in a comment is
 * not a guard, so the store counts what it is asked and the grid is the size the catalogue
 * actually is.
 */
describe('what annotating a full catalogue costs', () => {
  it('reads the store once, whatever the size of the grid', async () => {
    const games = Array.from({ length: 108 }, (_, index) => `/play/game-${String(index)}/`);
    const { store, asked } = countingStore({
      'duelbox-shell-abc': [`${ORIGIN}/`, `${ORIGIN}/games/`],
      'duelbox-runtime-abc': games.slice(0, 3).map((path) => `${ORIGIN}${path}`),
    });

    const cached = await cachedPathnames(store);
    const links = games.map((path) => fakeLink(path));
    markOfflineReady(
      links.map((entry) => entry.link),
      cached,
    );

    expect(links.filter((entry) => entry.value() === '1')).toHaveLength(3);
    expect(links.filter((entry) => entry.value() === '0')).toHaveLength(105);
    // One listing of the caches, one open per cache, and no per-card lookup at all.
    expect(asked).toEqual({ keys: 1, open: 2, match: 0 });
  });

  /**
   * And the shape that would make the count above meaningless. `caches.match` is not banned
   * because it is wrong — it is what the worker itself uses — but a call to it *here* is the
   * per-card version arriving back, and it would pass every other test in this file.
   */
  it('never asks the cache about one card', () => {
    const code = withoutComments(module);
    expect(code).not.toContain('caches.match(');
    expect(code).not.toContain('store.match(');
    // The stripper itself, watched failing on purpose: the docstring *does* name the shape
    // being kept out, so a comment-blind version of this test would fail on the file it is
    // meant to pass, and somebody would delete the assertion rather than the comment.
    expect(module).toContain('caches.match(');
  });
});

/**
 * The three files that have to agree, and the spec that will reject the build if they do not.
 *
 * Read rather than restated. CLAUDE.md's tally is mostly one failure repeated — a guard that
 * compares two hard-coded lists to each other and so cannot fail — and writing
 * `data-offline-ready` into this file as a literal and asserting the module equals it would
 * be exactly that.
 */
describe('the attribute the whole feature is written into', () => {
  it('is the one the end-to-end spec asserts on', () => {
    const asserted = [...spec.matchAll(/\[data-offline-ready="([01])"\]/g)].map(
      (match) => match[1],
    );
    // A floor, so a regex that has stopped matching the spec cannot pass this vacuously.
    expect(asserted.length).toBeGreaterThan(1);
    expect(new Set(asserted)).toEqual(new Set(['1', '0']));
    expect(spec).toContain(`[${OFFLINE_READY_ATTRIBUTE}]`);
  });

  it('is rendered by the card and read by the stylesheet under the same name', () => {
    expect(card).toContain(`${OFFLINE_READY_ATTRIBUTE}=`);
    expect(cardStyles).toContain(`[${OFFLINE_READY_ATTRIBUTE}='1']`);
    expect(cardStyles).toContain(`[${OFFLINE_READY_ATTRIBUTE}='0']`);
  });

  /**
   * The header assertion in the spec is a claim about *scope*, and this is the half of it
   * that can be checked here: the annotation is handed a subtree rather than the document.
   * `CatalogBrowser` is the only caller, it passes its own ref, and everything above it —
   * the site header, the page's heading, the Surprise me button — is unreachable from there.
   */
  it('is applied to a subtree, so it cannot reach the navigation', () => {
    const code = withoutComments(module);
    expect(code).toContain('root.querySelectorAll');
    expect(code).not.toContain('document.querySelectorAll');
    expect(withoutComments(browser)).toContain('annotateOfflineReady(root.current)');
    expect(spec).toContain('header a[data-offline-ready]');
  });
});

/**
 * Rule 7, which is the point of this feature rather than a condition on it.
 *
 * A pair with no signal are reading the card to decide what to play. A dot, a tint or a
 * border tells somebody who cannot see the difference nothing at all — so each state has to
 * be a different *sentence*, and the stylesheet has to switch which sentence is on screen
 * rather than only what colour it is. Both halves are checked: that the two values reveal
 * two different elements, and that those elements carry two different strings.
 */
describe('the words on the card', () => {
  /** The declarations of the first rule whose selector contains `needle`. */
  const blockFor = (needle: string): string => {
    const at = cardStyles.indexOf(needle);
    if (at === -1) return '';
    return cardStyles.slice(cardStyles.indexOf('{', at) + 1, cardStyles.indexOf('}', at));
  };

  /** The class each value reveals, taken out of the stylesheet rather than assumed. */
  const revealed = (value: string): string =>
    new RegExp(`\\[${OFFLINE_READY_ATTRIBUTE}='${value}'\\]\\s+\\.([A-Za-z][\\w-]*)`).exec(
      cardStyles,
    )?.[1] ?? '';

  /**
   * The sentence the card puts inside one of those classes.
   *
   * Either as a literal or through the i18n lookup (#220) — `<T id="…" />` with no values
   * renders its id and nothing else, so the words on the card are the words written in the
   * `id`, and reading only the bare form would have turned this guard into one that reports
   * an empty sentence for a card that says exactly what it always said. Whitespace is
   * collapsed first, because prettier puts the `<T>` on a line of its own.
   */
  const wordsIn = (className: string, source: string = card): string => {
    const flat = source.replace(/\s+/g, ' ');
    const found = new RegExp(
      `className=\\{styles\\.${className}\\}>\\s*(?:<T id="([^"{}]*)" \\/>|([^<]*))`,
    ).exec(flat);
    return (found?.[1] ?? found?.[2] ?? '').trim();
  };

  it('shows a different element for each of the two answers', () => {
    const present = revealed('1');
    const absent = revealed('0');
    expect(present, 'no class is revealed for a game that is on the device').not.toBe('');
    expect(absent, 'no class is revealed for a game that is not').not.toBe('');
    expect(present, 'both answers reveal the same element').not.toBe(absent);
    // Switching `display`, not only a colour: a rule that changed the tint alone would leave
    // both sentences on the card, and both in the accessibility tree.
    expect(blockFor(`${OFFLINE_READY_ATTRIBUTE}='1'`)).toContain('display:');
    expect(blockFor(`${OFFLINE_READY_ATTRIBUTE}='0'`)).toContain('display:');
  });

  it('says each answer in words, and in different words', () => {
    const present = wordsIn(revealed('1'));
    const absent = wordsIn(revealed('0'));
    // The reader, on both shapes and on one it must refuse — so a pattern that had stopped
    // matching cannot report "no words" for a card that has them. On fixtures rather than on
    // the card's real wording, which is the thing this file is here to read rather than to
    // restate.
    expect(wordsIn('stored', '<span className={styles.stored}>Here it is</span>')).toBe(
      'Here it is',
    );
    expect(
      wordsIn('stored', '<span className={styles.stored}>\n  <T id="Here it is" />\n</span>'),
    ).toBe('Here it is');
    expect(wordsIn('stored', '<span className={styles.missing}>Here it is</span>')).toBe('');
    expect(present, 'the card does not say a game is on the device').not.toBe('');
    expect(absent, 'the card does not say a game is missing from the device').not.toBe('');
    expect(present).not.toBe(absent);
    // Words rather than a glyph or a single letter. Both of these are sentences a person
    // reads, and either is the whole of what the card tells somebody with no connection.
    for (const words of [present, absent]) {
      expect(words.split(/\s+/).length, `"${words}" is not a phrase`).toBeGreaterThan(2);
    }
  });

  /**
   * Neither sentence may promise how the next tap behaves. The module's own docstring sets
   * out why: a page can see a game's document in the cache and cannot tell which numbered
   * chunk is its code, so a game whose page was opened and never played reads as saved.
   * "On this device" is a statement about storage and survives that gap; "Available offline"
   * and "Ready to play" do not.
   */
  it('claims storage rather than a promise about the next tap', () => {
    const said = `${wordsIn(revealed('1'))} ${wordsIn(revealed('0'))}`.toLowerCase();
    for (const promise of ['available offline', 'ready to play', 'works offline', 'downloaded']) {
      expect(said, `the card promises "${promise}", which nothing here can hold`).not.toContain(
        promise,
      );
    }
  });
});
