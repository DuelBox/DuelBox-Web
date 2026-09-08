/**
 * Which games are actually on this device, asked once and answered for the whole grid (#193).
 *
 * ## The question, and why the build cannot answer it
 *
 * A pair with no connection needs to know, before they tap, which of the hundred and eight
 * cards will open and which will land them on the "Not saved to this device" page. That is
 * not a fact about the catalogue; it is a fact about this browser's Cache Storage, minutes
 * old, different on the phone and the laptop the same two people played on last night. It
 * cannot be rendered into the HTML, so `GameCard` renders the *place* for the answer —
 * `data-offline-ready`, empty, meaning nobody has looked — and this module fills it in once
 * the browser can be asked.
 *
 * That order matters and is the whole reason this file exists rather than a prop on the
 * card. An empty attribute says "unknown"; `0` says "measured, and not here". A build that
 * shipped `0` in the markup would be the server asserting something about a device it has
 * never seen, and it would be wrong on exactly the cards the feature is for — the games the
 * player has already played.
 *
 * ## How it is asked, and what that costs
 *
 * One pass over Cache Storage that builds a set of the pathnames it holds, then a set lookup
 * per card. The obvious alternative reads far better at the call site — `caches.match(href)`
 * for each card — and it is a hundred and eight asynchronous round trips to the cache thread,
 * each one searching every cache in turn. This is `1 + n` calls for `n` caches, whatever the
 * catalogue grows to, and `offline-ready.test.ts` holds that as a property rather than as a
 * claim in a comment: it annotates a hundred and eight links and asserts the store was not
 * touched again.
 *
 * The set is measured once per page load and kept. A cache that gains an entry while the
 * catalogue is open — the router warming a route the pointer is near — is not noticed until
 * the next navigation. That is a stale answer in the safe direction: it can say a game is not
 * here that has just arrived, never that one is here that is not.
 *
 * ## What it looks at, and the one thing it cannot
 *
 * The link's own destination, `/play/<slug>/`, and nothing else. A game is *playable* offline
 * only when its own chunk is cached as well, and a page cannot tell which of
 * `_next/static/chunks/4127.8e3b….js` belongs to which game: the registry's dynamic imports
 * compile to numeric chunk ids and nothing in the browser maps one back to a slug. So there
 * is a window this gets wrong, and it is worth stating rather than discovering — a player who
 * opened a game's page and left without pressing Play has the document cached and not the
 * chunk, and this will say the game is on the device.
 *
 * Closing that window needs something from the other side of the wire: the build handing the
 * page a slug-to-chunk map, or the worker answering a message about what it holds. Neither
 * exists, so the wording on the card was chosen around the gap instead. "On this device" is a
 * statement about what is stored. It is not "Available offline", which would be a promise
 * about how the next tap behaves.
 *
 * ## Who calls this, and the one route that is annotated
 *
 * `CatalogBrowser`, after every one of its renders, over the subtree it rendered — and
 * nothing else. That is `/games/` alone. The landing page, the eighteen category hubs and
 * each game's own page render the same cards from the same server component and leave the
 * attribute empty, because the only way to fill it in on those routes is to put a client
 * component on them, and `lib/landing.test.ts` fails the build if one reaches the landing
 * page at all. An unannotated card says neither word, so the cost of that is a page that is
 * silent about storage rather than a page that is wrong about it.
 *
 * The consequence worth stating: on a first-ever visit the worker claims the page a few
 * hundred milliseconds after it loads, and this runs before that, so the grid stays silent
 * until something re-renders it — a keystroke, a chip, a star. A first visit has no games
 * saved yet, so what is being withheld is a hundred and eight cards all saying "Not on this
 * device", and saying nothing is the better of the two. A `controllerchange` listener would
 * close that window and costs shell bytes on the route with the least room for them.
 *
 * ## No BASE_PATH here, deliberately
 *
 * `app/base-path.ts` names "the service worker's scope, its precache list" as the callers that
 * have to carry it, and this is neither. Both sides of the comparison come out of the browser
 * with the prefix already on them: `next/link` writes `basePath` into every `href` it renders,
 * and a cache key is the absolute URL some request was actually made with. Adding it again
 * here is the only way to get this wrong on a project page.
 */

/**
 * The attribute the annotation is written into.
 *
 * Three files have to agree on this string: `GameCard.tsx` renders it empty on every card,
 * this module writes `1` or `0` into it, and `GameCard.module.css` shows one of the two words
 * on each value. Nothing in a browser fails when they drift — the cards simply stop being
 * annotated, silently, which is the failure this repository keeps finding — so
 * `offline-ready.test.ts` reads all three files and fails when one of them stops saying it.
 */
export const OFFLINE_READY_ATTRIBUTE = 'data-offline-ready';

/**
 * What this needs of a catalogue link, which an `HTMLAnchorElement` already is.
 *
 * Narrow on purpose: it is the whole seam that lets the marking below be tested at all. The
 * unit suite runs in Node with no DOM, and a function that reached for `document` would be
 * provable only by an end-to-end run of a browser — which is the one gate nobody runs while
 * they are working.
 */
export interface AnnotatableLink {
  /** The link's own path — `/play/tic-tac-toe/` — with any base path already on it. */
  readonly pathname: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/**
 * Every pathname the browser is holding a *document* for, across every cache.
 *
 * Pathnames rather than URLs because that is what a link can be compared against: the same
 * document is `http://127.0.0.1:4173/play/chess/` in the cache and `/play/chess/` on the
 * card, and the origin is the same for both by construction — the worker only ever caches
 * this site.
 *
 * ## Why an entry with a query is skipped, which is not a tidying-up
 *
 * Because without it this reports the opposite of the truth on exactly the cards the feature
 * is about. `sw.js` keys a document under `${origin}${pathname}` and everything else under
 * the request it was made with, and it says why in `documentKey`: the router's prefetch
 * payload for a route is `/play/sudoku/?_rsc=…`, it is a flight payload rather than a page,
 * and the two must never be confused. The catalogue is a grid of a hundred and eight links
 * and `next/link` prefetches the ones that scroll into view, so a browser that has merely
 * *displayed* the row sudoku is in holds an entry whose pathname is `/play/sudoku/` — and
 * counting it would put "On this device" on a game that has never been opened, which is the
 * one thing the annotation must not do. Dropping every entry that carries a query keeps
 * exactly the keys `documentKey` writes, and `e2e/offline.spec.ts` asserts sudoku reads `0`
 * on a page whose links have had every chance to be prefetched.
 *
 * The static assets under `/_next/static/` survive the filter — they have no query either —
 * and are harmless: no catalogue link points at one.
 *
 * The caches are read one after another rather than in parallel. There are two or three of
 * them (the precached shell, and whatever the worker names its runtime cache), so the
 * round trips saved by `Promise.all` are worth less than the line being obvious.
 */
export async function cachedPathnames(store: CacheStorage): Promise<ReadonlySet<string>> {
  const paths = new Set<string>();
  for (const name of await store.keys()) {
    const cache = await store.open(name);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (url.search === '') paths.add(url.pathname);
    }
  }
  return paths;
}

/**
 * Writes the answer onto every link handed in.
 *
 * Synchronous, and that is the design rather than an implementation detail: it takes the
 * measurement already made, so there is no way to write a version of this that asks the cache
 * once per card. The whole cost of annotating the grid is this loop.
 *
 * The attribute is only written when it would change. A card that is already marked is left
 * alone, because this runs again after every render of the catalogue — a keystroke in the
 * search box, a category chip, a star — and a filtered grid remounts the cards it brings
 * back, which is exactly why it has to run again rather than once on mount.
 */
export function markOfflineReady(
  links: Iterable<AnnotatableLink>,
  cached: ReadonlySet<string>,
): void {
  for (const link of links) {
    const value = cached.has(link.pathname) ? '1' : '0';
    if (link.getAttribute(OFFLINE_READY_ATTRIBUTE) !== value) {
      link.setAttribute(OFFLINE_READY_ATTRIBUTE, value);
    }
  }
}

/**
 * The measurement, kept for the life of the page. `null` while it is still unknown, which is
 * not the same as an empty set and must never be allowed to become one.
 */
let measured: ReadonlySet<string> | null = null;

/**
 * Reads Cache Storage, or decides that this browser cannot be asked.
 *
 * Three ways to come back with nothing, and all three end in cards that say neither word:
 *
 * - No `caches` at all. A service worker needs a secure context, and so does its cache; on
 *   `http://` there is no offline story to describe.
 * - Nothing controlling this page. A cache with no worker serving from it will not answer the
 *   next navigation, so its contents are not an answer to "will this open offline" — this is
 *   the state of a first-ever visit until the worker claims, and of a shift-reload.
 * - A throw. Firefox's private windows keep the API and refuse it, and a private window is
 *   precisely a browser that is not storing anything for later.
 *
 * "Nothing" is deliberately not memoised: two of those three change during the life of a page
 * — a first visit's worker claims a few hundred milliseconds in — so the next render tries
 * again, and trying again costs two `typeof` checks.
 */
async function measure(): Promise<ReadonlySet<string> | null> {
  if (typeof caches === 'undefined') return null;
  if (!('serviceWorker' in navigator) || navigator.serviceWorker.controller === null) return null;
  try {
    return await cachedPathnames(caches);
  } catch {
    return null;
  }
}

/**
 * Annotates every catalogue link inside `root`.
 *
 * `root` is the catalogue's own container, not the document, and that is what keeps the
 * annotation off the navigation. `e2e/offline.spec.ts` asserts `header a[data-offline-ready]`
 * has a count of zero: the header is chrome, it is the same on every route, and marking the
 * link to a *page* with whether a *game* is downloaded would be nonsense. Scoping the query
 * to the subtree the catalogue rendered makes that structural — this cannot reach the header,
 * rather than being trusted not to.
 */
export async function annotateOfflineReady(root: ParentNode): Promise<void> {
  measured ??= await measure();
  if (measured === null) return;
  markOfflineReady(
    root.querySelectorAll<HTMLAnchorElement>(`a[${OFFLINE_READY_ATTRIBUTE}]`),
    measured,
  );
}
