/* global self, caches, fetch, Request, Response, URL */
/**
 * The service worker. What makes "offline-capable" true for a browser that has been
 * closed, rather than only for a tab that is still open.
 *
 * ## The gap this closes
 *
 * CLAUDE.md's first paragraph has said "Offline-capable" since the repository was created,
 * `docs/adr/0002-no-backend-in-v1.md` lists it as one of four properties of v1, and
 * `e2e/offline.spec.ts` proved it — for a page that is *already loaded*. Nothing survived
 * closing the tab. `manifest-src 'self'` and `worker-src 'self'` had been sitting unused in
 * the content security policy the whole time, which is the shape of a claim nobody had run.
 *
 * ## What it is, and what it is deliberately not
 *
 * A cache. Not a client. It never originates a request the page would not have made:
 * every `fetch()` below is a request the document already asked for and this worker is
 * answering, and a cross-origin request is passed straight through untouched — no
 * `respondWith`, no interception, no copy. That is what keeps the privacy page's "we have
 * no server that receives anything from you" true with a worker in the picture.
 *
 * ## Strategy per asset class, and why each one is what it is
 *
 * | class | matched by | strategy | why |
 * |---|---|---|---|
 * | build assets | `/_next/static/**` | cache-first, **never** revalidated | every one is content-hashed, so the URL *is* the version. A conditional request on an immutable URL can only ever come back 304, which costs a round trip to learn nothing |
 * | documents | `request.mode === 'navigate'` | cache-first, then network, then the offline page | freshness comes from the worker update lifecycle below, not from re-fetching HTML. This is what makes a repeat play cost zero requests, and it is also what stops a half-updated session pairing yesterday's HTML with today's chunks |
 * | route payloads | `*.txt`, `?_rsc=` | cache-first | they are the same document in another form and belong to the same build; splitting their freshness from the HTML's is how a router ends up rendering two versions at once |
 * | everything else same-origin | icons, the web app manifest | stale-while-revalidate | small, unhashed, and nothing on the page blocks on one, so a background refresh is free. Never requested during a match, so it does not spend the zero-request budget |
 * | anything cross-origin | a different `origin` | **not intercepted at all** | see above. The worker is not a client |
 *
 * ## Freshness, and why a stale worker is the failure to design against
 *
 * Serving HTML from cache forever would make this site unfixable: a bad deploy would reach
 * nobody's browser and no amount of pushing would help. So the *only* freshness mechanism
 * is the one the browser drives and cannot be cached away: it re-fetches this file on
 * navigation, byte-compares it, and if it differs installs the new one. Every deploy
 * changes `REVISION` because it is a digest of the *contents* of everything precached — not
 * of the list of names, which would miss a change to a page's text, since HTML is the one
 * thing here that is not content-hashed. So every deploy produces a different file here.
 *
 * The new worker then **waits** rather than taking over, and the page shows a reload
 * prompt. That ordering matters: taking over immediately would swap the chunks under a
 * running match. The prompt is `apps/web/src/app/service-worker-client.ts` and the reload
 * path is the `SKIP_WAITING` message below. `e2e/offline.spec.ts` drives the whole sequence
 * against a second revision on disk; `service-worker-client.test.ts` is what pins the
 * message string itself, since the two files that have to agree about it cannot see each
 * other.
 *
 * The one exception is the very first install, where there is nothing to interrupt and
 * nothing to prompt about, so it claims the page straight away and this visit is already
 * protected.
 */

/** A digest of everything precached, written by `scripts/emit-service-worker.mjs`. */
const REVISION = '__DUELBOX_REVISION__';

/** `''` at the root, `/DuelBox-Web` on a GitHub Pages project page. Same source as `basePath`. */
const BASE = '__DUELBOX_BASE__';

/**
 * Everything the shell needs, and nothing a player did not ask for.
 *
 * The **shell** — every build asset that is not one game's own chunk, plus the six routes
 * that exist whatever games ship — is precached here, because it is exactly what a visitor
 * downloads before choosing anything and it is what has to be there when they come back
 * with no signal.
 *
 * The **108 game chunks are not**, and that is the deliberate part. Precaching them would
 * be a multi-megabyte download for the 107 games this player did not pick, on a connection
 * they may be paying for, to make offline a game they have never opened. They are cached
 * on play instead: the first match downloads the chunk through this worker, and from then
 * on that game works with no connection while the others honestly do not. Which ones a
 * player has is visible on the catalogue rather than guessed at — see `data-offline-ready`
 * in the client script.
 */
const PRECACHE = ['__DUELBOX_PRECACHE__'];

/** Served for a navigation to a route this device has never visited, while offline. */
const OFFLINE_URL = `${BASE}/offline/`;

/**
 * `public/sw.js` is copied into the export verbatim, so in `pnpm dev` — and in any build
 * where the emit step did not run — the constants above are still their own placeholders.
 * A worker that tried to precache the literal string `__DUELBOX_PRECACHE__` would fail its
 * install on every load and fill the console with it. Instead it installs, does nothing,
 * and gets out of the way: no interception, no caching, no stale anything in development.
 */
const BUILT = !REVISION.startsWith('__');

const SHELL_CACHE = `duelbox-shell-${REVISION}`;
const RUNTIME_CACHE = `duelbox-runtime-${REVISION}`;
const OURS = /^duelbox-(shell|runtime)-/;

/** Content-hashed, therefore immutable, therefore never worth revalidating. */
function isImmutable(url) {
  return url.pathname.startsWith(`${BASE}/_next/static/`);
}

/** A route payload: the same document the router would otherwise navigate to. */
function isRoutePayload(url) {
  return url.pathname.endsWith('.txt') || url.searchParams.has('_rsc');
}

/**
 * Only a same-origin, ordinary, successful response is worth keeping.
 *
 * `type === 'basic'` excludes an opaque cross-origin response, which has no readable status
 * and would be cached as a permanent mystery. A redirect is excluded because replaying a
 * cached redirect for a navigation throws in every engine.
 */
function isCacheable(response) {
  return response.ok && response.type === 'basic' && !response.redirected;
}

async function putInCache(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
}

/** Cache-first with no revalidation. For anything whose URL already carries its version. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) await putInCache(RUNTIME_CACHE, request, response.clone());
  return response;
}

/**
 * Cache-first, network, then the offline page.
 *
 * `ignoreSearch` because a document is the same document with a tracking parameter on the
 * end, and a player who arrives from a shared link with `?utm_...` should not be told they
 * are offline about a page they have.
 */
async function handleNavigation(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isCacheable(response)) await putInCache(RUNTIME_CACHE, request, response.clone());
    return response;
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('This page has not been saved for offline play.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

/** Serve what we have, refresh in the background. Only for small unhashed extras. */
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fresh = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) await putInCache(RUNTIME_CACHE, request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const response = await fresh;
  if (response) return response;
  return new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('install', (event) => {
  if (!BUILT) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One at a time rather than `addAll`, which is atomic: a single 404 in a list of two
      // hundred would abort the whole install and leave the visitor with no offline at all,
      // which is a worse answer than an offline site missing one font.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { credentials: 'same-origin' })).catch(() => undefined),
        ),
      );
      // First install only. There is no running worker to interrupt and nothing to prompt
      // about, so take over now and protect this visit rather than the next one.
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Every cache from an older revision goes, in one step, so a session can never mix
      // two builds. Anything not ours is left alone.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => OURS.test(name) && name !== SHELL_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (!BUILT) return;
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Rule: a cache, not a client. A cross-origin request is the page's business and is
  // handed to the network exactly as the page made it.
  if (url.origin !== self.location.origin) return;
  // Never serve this file from a cache. The browser's own update check bypasses the worker,
  // but a page that fetched it would otherwise be handed a copy of the worker it is trying
  // to replace, which is the one way to make a stale worker permanent.
  if (url.pathname === `${BASE}/sw.js`) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (isImmutable(url) || isRoutePayload(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

/**
 * The reload half of the update prompt.
 *
 * The waiting worker only ever takes over because a person pressed a button, so a match in
 * progress is never swapped out from under itself.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});
