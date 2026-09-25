import { DEFAULT_LOCALE, type LocaleCode } from './locales';
import type { Catalogue } from './messages';

/**
 * Fetching one locale's strings, and the reason only one of them is ever fetched (#219).
 *
 * ## The whole mechanism
 *
 * Every non-default locale is reached by `import()` and by nothing else, so webpack emits one
 * async chunk per catalogue and a browser downloads exactly the one whose code path runs.
 * `check-size.mjs` follows `.e(<id>)` out of the shell chunks, recognises a locale chunk by the
 * `locale: '…'` marker every catalogue module carries, weighs the largest on a line of its own
 * (`localeBytes`), and fails the build if a locale in the registry has no chunk, two chunks, or
 * a chunk that has been folded into the shell — so "only the active locale downloads" is a
 * number the build prints rather than a claim in a README. The guard in `i18n.test.ts` fails
 * earlier and cheaper if any module but this one names a file under the catalogues directory,
 * or if this one names one outside an `import()`: a single `import EN_XA from` anywhere would
 * fold every locale into the shell, silently, and cost nothing at type-check time.
 *
 * A JSON file under `public/` fetched at runtime would be the other obvious shape and is not
 * available: `scripts/check-zero-cost.mjs` fails the build on `fetch(` anywhere in
 * `apps/web/src`, because once a page has loaded this product needs no network. A chunk the
 * bundler emits and the service worker can see is the shape that rule leaves open, and it is the
 * better one anyway — it is typed, it is content-hashed, and it cannot 404 under a shell that
 * references it.
 *
 * ## No cache here
 *
 * There is deliberately no memo table. `import()` is already memoised by the module system: the
 * second call for a locale resolves from the browser's module registry without a second request,
 * and under Vitest from the module graph. A `Map` beside it would save nothing measurable and
 * would add the one thing this file should not have — state that a test has to reset and that a
 * locale switch has to invalidate.
 *
 * ## Offline
 *
 * A locale chunk is an async chunk, so `emit-service-worker.mjs` does not precache it: the
 * precache list is built from the shell documents' `src` and `href` references and what their
 * stylesheets pull, and nothing references a chunk that arrives by `import()`. It **is** kept by
 * the worker's runtime path once fetched — `respondToAsset` in `sw.js` saves every same-origin
 * `basic` response it answers from the network — so a locale chosen on one visit is answered
 * from the device on the next, and the site in that locale opens with no connection from the
 * second load. What does not work is the *first* switch to a locale this device has never
 * fetched while it is disconnected: the import rejects, this module resolves to the empty
 * catalogue, and the player sees English rather than a broken page. `docs/i18n.md` says the same
 * thing to a reader; precaching every locale for everybody was considered and declined, because
 * it would charge every visitor for languages they did not ask for.
 */

/** English has no catalogue; every lookup falls through to the English id at the call site. */
export const EMPTY_CATALOGUE: Catalogue = {};

/**
 * What a catalogue module looks like from here: a default export carrying the code it is for
 * and the strings.
 *
 * The `locale` field is not decoration. It is the marker `check-size.mjs` recognises a locale
 * chunk by in the minified output, it is what lets `i18n.test.ts` fail an importer pointed at
 * the wrong file, and it is what `plural()` would need if the locale ever stopped travelling
 * beside the catalogue in the context.
 */
export interface CatalogueModule {
  readonly default: {
    readonly locale: LocaleCode;
    readonly messages: Catalogue;
  };
}

/**
 * How a locale is fetched. Injectable so the unit suite can drive {@link loadCatalogue}
 * without a bundler and can prove the default locale imports nothing at all.
 */
export type CatalogueImporter = (locale: LocaleCode) => Promise<CatalogueModule>;

/**
 * Locale to the `import()` that fetches it, or `null` for a locale that has no catalogue.
 *
 * Static specifiers, one per locale, rather than `` import(`./catalogues/${locale}`) ``: a
 * template literal makes webpack build a context module over the whole directory, and this
 * table is something a test can read and compare against both the registry in `locales.ts` and
 * the directory listing. Adding a locale is three edits that have to agree — the registry, the
 * generated file, this line — and `i18n.test.ts` fails if any one of them is missed, so the
 * control can never offer a language whose chunk does not exist.
 */
export const IMPORTERS: Readonly<Record<LocaleCode, (() => Promise<CatalogueModule>) | null>> = {
  en: null,
  'en-XA': () => import('./catalogues/en-XA.generated'),
  'ar-XB': () => import('./catalogues/ar-XB.generated'),
};

/**
 * One locale's strings, fetched if they are not English.
 *
 * The default locale returns the empty catalogue **without importing anything** — no chunk, no
 * request, no promise tick that a bundler could hang a fetch on. That is the "behaves exactly as
 * today" promise, and the test asserts it against an importer that records whether it was
 * called.
 *
 * A failed import resolves to the empty catalogue rather than rejecting. A chunk that cannot be
 * fetched — offline on a first switch, a deploy that moved the file under a cached shell —
 * should cost the player their translation and not their page.
 */
export async function loadCatalogue(
  locale: LocaleCode,
  importer: CatalogueImporter = importCatalogue,
): Promise<Catalogue> {
  if (locale === DEFAULT_LOCALE) return EMPTY_CATALOGUE;
  try {
    return (await importer(locale)).default.messages;
  } catch {
    return EMPTY_CATALOGUE;
  }
}

/** The real importer: {@link IMPORTERS}, with a rejection for a locale that has no entry. */
function importCatalogue(locale: LocaleCode): Promise<CatalogueModule> {
  const load = IMPORTERS[locale];
  return load === null ? Promise.reject(new Error(`no catalogue for ${locale}`)) : load();
}
