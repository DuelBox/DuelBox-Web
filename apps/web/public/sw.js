/**
 * The DuelBox service worker (#192 #193 #194 #2445).
 *
 * This file is the *source*. It ships to `apps/web/out/sw.js` with three placeholders
 * substituted by `scripts/emit-service-worker.mjs`, which runs after the export is
 * finished and knows what the export actually contains. Editing the copy in `out/` does
 * nothing: it is overwritten on every build, and `docs/deploy.md` says so in the table of
 * what the artefact holds.
 *
 * ## The contract this file is held to
 *
 * `scripts/check-zero-cost.mjs` scans the sources for anything that would put the product
 * behind a round trip, and this is the **one file it exempts** — a worker that could not
 * call `fetch` would not be a worker. An exemption is only safe if it is narrow, so these
 * are the three properties that replace the check, written here as the contract rather
 * than left in the script that enforces them:
 *
 * 1. **One origin.** Every URL fetched below is same-origin, tested against
 *    `self.location.origin` at the top of the fetch handler. No URL from a message, a
 *    query string or the contents of a cached document is ever fetched. There is no
 *    configuration here that a deploy could point somewhere else.
 * 2. **No wakeups.** Four listeners — `install`, `activate`, `fetch`, `message` — and
 *    nothing else. No `push`, no `sync`, no `periodicsync`, no `notificationclick`. A
 *    service worker is the one piece of this product that a browser can start when nobody
 *    is looking, and the way to keep that from happening is to give it nothing to wake up
 *    for. Everything below runs because a page asked for something.
 * 3. **No telemetry.** Nothing is reported anywhere. No beacon, no counters, no error
 *    endpoint. The worker answers a request the page already made, and that is the whole
 *    of what it does.
 * 4. **One thing a page may ask for, and nothing about what it gets.** #196 lets the
 *    settings page ask for the whole catalogue to be saved. That is the one request the
 *    worker originates on a page's behalf outside install, and the page has no say in *what*
 *    is fetched: the list is {@link DOWNLOAD}, substituted at build time, and the message that
 *    starts the download carries no URL, no slug and no argument the download reads.
 *    `check-zero-cost.mjs` holds that shape — the helper is reached from the message
 *    handler alone, called with nothing, and touches nothing the message carried.
 *
 * ## Why the globals are declared in a comment
 *
 * `eslint.config.js` has no service-worker environment, and ESLint's flat config dropped
 * support for the old `eslint-env` comment, so a bare `self` or `caches` is a `no-undef`
 * error here. The `global` directive below is the narrow fix available from inside this
 * file: it names the six globals actually used and nothing more, so a typo in a seventh
 * still fails rather than being waved through. The wider fix is a block in
 * `eslint.config.js` scoping the `serviceworker` globals from the `globals` package to
 * this directory — a change to a file this change does not own, and a blanket
 * `eslint-disable` in its place would have switched off far more than the one rule that
 * does not apply.
 */

/* global self, caches, fetch, Request, Response, URL */

/**
 * A fingerprint of everything in `PRECACHE`, computed from the bytes of those files.
 *
 * Content, never a clock and never a random: two builds of the same tree must produce the
 * same revision, or every rebuild would rename the caches and throw away a visitor's copy
 * of a site that had not changed. `e2e/offline.spec.ts` depends on exactly that — it
 * manufactures a second deploy by appending a comment to `out/sw.js`, which changes the
 * bytes the browser compares (the only thing that triggers an update) while leaving every
 * precached file alone, and then asserts that `activate` deleted nothing.
 */
const REVISION = '__REVISION__';

/**
 * The shell: what this device needs in order to open the site with no connection at all.
 *
 * Emitted from the export rather than written here, because a list of hashed chunk names
 * maintained by hand is a list that is wrong by the next build. What goes in it is decided
 * in `scripts/emit-service-worker.mjs`; the short version is the documents for the routes
 * that are not one game's page, everything those documents reference, the fonts their CSS
 * pulls, and the icons and manifest.
 *
 * What is deliberately **not** in it: the 108 play documents and the 108 game chunks.
 * Installing already costs a visitor fifty-odd requests and something under half a
 * megabyte, and it happens on a first visit, unasked. Saving every game on top of that is
 * a different feature with a different shape — it needs a quota strategy, a progress
 * indication and a way to say no — and it is #196. A game a player has actually opened
 * gets saved by the runtime path below, which is the honest version of the same promise:
 * what you played is what you keep.
 *
 * Nor the faces a first visit never asks for: a `@font-face` whose `unicode-range` excludes
 * printable ASCII — the three `latin-ext` faces and the two script faces of #224, 318 KB
 * between them — is left out by `scripts/emit-service-worker.mjs` and left to the same
 * runtime path, saved the first time a page draws a glyph in its range; `docs/fonts.md`
 * records what that costs a device that is offline the first time it needs one.
 */
const PRECACHE = ['__PRECACHE__'];

/**
 * The page shown when a navigation asks for a document this device has never held.
 *
 * Precached like the rest of the shell, so the fallback is itself available offline —
 * a fallback that needs the network is not one.
 */
const OFFLINE_URL = '__OFFLINE__';

/**
 * Every game, with what it takes to open one cold (#196).
 *
 * Emitted by `scripts/emit-service-worker.mjs` from the export, in a shape that does not
 * repeat itself: `shared` is the play route's own chunks — the same files for every game,
 * listed and weighed once — and each game is its slug, the file name of its chunk under
 * `prefix`, and the gzipped weight of its document plus that chunk. The chunk is the one the
 * play page reaches through `import()`, which no HTML mentions and which is why a page
 * cannot compute this list for itself (`lib/offline-ready.ts` records the gap).
 *
 * The runtime path above saves a game when it is played. This list is for the person who
 * wants all of them before a flight, and it is only ever read by {@link downloadGames},
 * which only ever runs because a page asked.
 */
const DOWNLOAD = ['__GAMES__'];

/**
 * Where the worker remembers when each game was last opened, so it knows which to drop first
 * when the browser runs out of room.
 *
 * A JSON document under a key no route will ever have, inside the runtime cache rather than
 * anywhere a page could confuse with a page. Two facts about it worth stating: it holds slugs
 * and timestamps and nothing about a person, and it goes with the cache when the cache goes —
 * clearing site data removes it, a new deploy renames the cache and starts it again.
 */
const LAST_OPENED_KEY = '/__duelbox/last-opened';

/**
 * Two caches, both named for the revision, and that naming is the whole update mechanism.
 *
 * `activate` deletes every `duelbox-` cache that is not one of these two, so a deploy
 * whose shell differs by a byte lands in fresh caches and the previous deploy's copy is
 * gone in the same breath. That is deliberately blunt. The alternative — keeping the
 * runtime cache across revisions so a played game survives a deploy — sounds kinder and is
 * wrong: a static export renames every chunk it emits, so yesterday's cached play document
 * points at chunk URLs that no longer exist on the origin, and the player would get a page
 * that renders and then fails to boot. Losing the saved game and re-saving it on the next
 * visit is the recoverable failure; a shell wired to deleted chunks is not.
 *
 * `duelbox-shell-` is the prefix `e2e/offline.spec.ts` counts, and it asserts there is
 * exactly one. Two means this cleanup stopped running, which is how a device ends up
 * holding three copies of the site.
 */
const SHELL_CACHE = `duelbox-shell-${REVISION}`;
const RUNTIME_CACHE = `duelbox-runtime-${REVISION}`;

/**
 * The cache key for a document, which is its path and nothing else.
 *
 * A static export serves one file per path: `/play/chess/?from=rail` and `/play/chess/`
 * are the same bytes on every host in `docs/deploy.md`, because none of them runs anything
 * that could vary a response by query string. So a document is stored and looked up under
 * its path, and a link that carries a tracking parameter or a scroll target still finds
 * the copy on the device.
 *
 * Stripping the query at the *key* rather than passing `ignoreSearch` to the lookup is not
 * a style choice, and the difference bites. `ignoreSearch` would let a navigation to
 * `/play/air-hockey/` match a runtime entry for `/play/air-hockey/?_rsc=...` — the router's
 * prefetch payload for that route, which the landing page fetches for its quick-play tiles.
 * That is a flight payload, not a document, and serving it to a navigation gives the
 * visitor a screen of React internals. Narrowing the key instead means the two can never
 * be confused: prefetch payloads keep their query and are only ever found by an exact
 * match from the router that asked for them.
 */
function documentKey(url) {
  return `${url.origin}${url.pathname}`;
}

/**
 * Look in every cache this origin holds.
 *
 * `ignoreVary` is on for a reason worth stating, because it looks like a shortcut. The
 * precache is filled by requests this worker constructs, and it is read by requests the
 * browser constructs for a document, a script or a font — different `Accept` headers, and
 * the e2e suite's `npx serve` answers with `Vary: Accept-Encoding` besides. Honouring
 * `Vary` would turn every one of those hits into a miss and the site would be online-only
 * while appearing to have a full cache. There is nothing to honour: a static host has one
 * representation per URL, so a stored response is *the* response.
 *
 * ## Why a failed lookup is `undefined` rather than a rejection
 *
 * Because of what `respondWith` does with a rejected promise, which is not what it looks
 * like it does. A promise passed to `respondWith` that rejects does **not** fall through to
 * the network — the browser treats it as a network error and the visitor gets the failure
 * page. So a rejection anywhere in the two strategies below is a working online site turned
 * into a broken one, by the one piece of code on this site that survives the reload somebody
 * would try next.
 *
 * `caches.match` can reject. Storage cleared from another tab while this page is open, a
 * quota eviction landing mid-lookup, Firefox's private windows keeping the API and refusing
 * it: none of those is exotic, and none of them is a reason to refuse to serve a page the
 * network is perfectly willing to give us. Swallowing here means a cache this worker cannot
 * read behaves exactly like a cache that does not hold the thing — a miss — and a miss goes
 * to the network. The site degrades to the site as it was before this file existed, which is
 * the worst outcome a caching layer is allowed to have.
 *
 * It also makes the 503 at the bottom of `respondToNavigation` reachable, which its own
 * comment already claims it is: a cache that cannot be read *and* a network that is gone is
 * the one state where there is genuinely nothing left to answer with.
 */
function cached(key) {
  return caches.match(key, { ignoreVary: true }).catch(() => undefined);
}

/**
 * Put a copy in a cache without making the page wait for it, and without letting a failure
 * reach the page.
 *
 * `cache.put` rejects on a full quota, and on a `206` or a redirected response. None of
 * those is a reason to fail the request the visitor is actually waiting on — the response
 * is already in hand and is returned either way — so the write is passed to `waitUntil`
 * (so the browser keeps the worker alive long enough to finish it) and its failure is
 * swallowed. A device that cannot store the shell still serves the site; it just serves it
 * from the network.
 */
function save(cacheName, key, response) {
  return caches
    .open(cacheName)
    .then((cache) => cache.put(key, response))
    .catch(() => undefined);
}

/**
 * Fill the shell cache, and top it up rather than refetching it.
 *
 * `cache: 'reload'` on every request: the documents are not content-hashed, so the HTTP
 * cache may still be holding the previous deploy's copy of `/games/`, and precaching that
 * under this revision's name would pin the old page onto the device for the life of the
 * deploy. The hashed assets under `_next/static/` cannot go stale that way, but they are
 * asked for the same way rather than special-cased, because a rule with one exception in
 * it is a rule someone will get the wrong way round.
 *
 * Only what is missing is fetched. The cache is *named* for the content it holds, so a
 * cache that already exists under this revision already holds this revision's shell — and
 * that makes a worker update that changes only this file (a strategy fix, a comment)
 * install for free instead of pulling half a megabyte the device already has. It also
 * makes install recoverable: a run interrupted halfway leaves a partial cache, and the
 * next attempt finishes it instead of starting again.
 *
 * `addAll` is atomic in the way that matters — one 404 and the whole thing rejects, install
 * fails, and the worker never activates. A worker that activated with a shell it only
 * partly holds would be worse than none: it would answer navigations from a cache with
 * holes in it and there would be nothing to notice.
 */
async function precache() {
  const cache = await caches.open(SHELL_CACHE);
  const keys = await cache.keys();
  const held = new Set(keys.map((request) => request.url));
  const missing = PRECACHE.filter((url) => !held.has(new URL(url, self.location.href).href));
  if (missing.length === 0) return;
  await cache.addAll(missing.map((url) => new Request(url, { cache: 'reload' })));
}

/**
 * A navigation: the request for a page, and the one that decides whether this product's
 * claim is true.
 *
 * **Cache first, and never revalidated.** That is the unusual choice here and it is the
 * one #2445 asks for in so many words: the second play of a game must cost *no* network
 * request at all, and a revalidation is a network request. Freshness does not come from
 * checking each document; it comes from the browser's own check for a new copy of this
 * file, which it makes on every navigation, which no page waits on, and which renames
 * every cache when it finds one. So the trade is explicit: a visitor may read a document
 * from the previous deploy for exactly as long as it takes that check to complete, and in
 * exchange the site opens instantly and works on a train.
 *
 * On a miss the document is fetched and **kept**, which is what makes a game a player has
 * opened available next time without anybody having asked for it to be saved. It is also
 * why the catalogue can say which games are on this device (#193): a page can ask
 * `caches.match('/play/chess/')` directly and get a truthful answer, with no message to
 * this worker and no second list to keep in step.
 *
 * On a miss that the network cannot satisfy, the precached offline page — a real page of
 * this site that says what has happened and offers what *is* saved, rather than the
 * browser's error, which says the site is broken.
 */
async function respondToNavigation(event, request) {
  const url = new URL(request.url);
  const key = documentKey(url);
  event.waitUntil(touchGame(url));
  const hit = await cached(key);
  if (hit !== undefined) return hit;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && !response.redirected) {
      event.waitUntil(save(RUNTIME_CACHE, key, response.clone()));
    }
    return response;
  } catch {
    const fallback = await cached(OFFLINE_URL);
    if (fallback !== undefined) return fallback;
    // Only reachable if the shell cache has been evicted out from under an activated
    // worker, since install cannot complete without the offline page. Plain text, because
    // anything richer would need assets this device has just been shown not to have.
    return new Response('Offline, and this page is not saved to this device.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

/**
 * Everything else the page asks for: scripts, stylesheets, fonts, icons, the manifest, the
 * router's prefetch payloads.
 *
 * **Cache first, kept on first sight, never revalidated** — one rule for the lot, and the
 * reasoning divides into two cases that happen to want the same behaviour.
 *
 * Under `/_next/static/` the URL contains a hash of the file's contents, so the answer can
 * never be wrong: a changed file is a changed URL and arrives as a miss. Revalidating one
 * of those is asking a question whose answer is already known.
 *
 * Everything else — `/manifest.webmanifest`, `/icons/*`, a `?_rsc=` payload — is not
 * hashed, so a cached copy genuinely can be a deploy behind. It is still not revalidated,
 * for the same reason the navigation above is not: #2445 is a claim about requests, not
 * about caching, and these are exactly the requests a second play would otherwise make.
 * They come from the same deploy as the document that referenced them, and they are
 * replaced when the revision changes, which is the whole freshness story on this site.
 *
 * The 504 on a miss the network cannot satisfy is deliberate and is named in
 * `e2e/offline.spec.ts`: with a worker installed, a gameplay module that reached for the
 * network would be answered from here instead of showing up as a blocked URL in that
 * spec's list, so the static scan in `check-zero-cost.mjs` is what catches that now.
 */
async function respondToAsset(event, request) {
  const hit = await cached(request);
  if (hit !== undefined) return hit;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && !response.redirected) {
      event.waitUntil(save(RUNTIME_CACHE, request, response.clone()));
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Not saved to this device' });
  }
}

/* ------------------------------------------------------------- download all (#196) --- */

/**
 * The slug a play-route URL names, or null for any other page.
 *
 * `/play/<slug>/` with the base path in front of it. Read from the URL rather than looked up
 * in {@link GAMES} so a game this list does not know about — a build with a game switched off
 * (#208) — is still touched when it is played and still counts as recently used.
 */
function gameSlug(url) {
  const match = /\/play\/([a-z0-9-]+)\/$/.exec(url.pathname);
  return match === null ? null : match[1];
}

/** The last-opened record: `{ [slug]: epoch milliseconds }`, or empty. Never throws. */
async function readLastOpened() {
  const hit = await cached(new URL(LAST_OPENED_KEY, self.location.href).href);
  if (hit === undefined) return {};
  try {
    const parsed = await hit.json();
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeLastOpened(record) {
  const key = new URL(LAST_OPENED_KEY, self.location.href).href;
  await save(RUNTIME_CACHE, key, new Response(JSON.stringify(record)));
}

/**
 * Note that a game was opened, so the eviction below knows it is one of the wanted ones.
 *
 * On every navigation to a play route, hit or miss, because "recently used" is about the
 * player and not about the network. Swallowed on failure like every other write here: a
 * record that could not be updated costs one game its place in the queue, not the page.
 */
async function touchGame(url) {
  const slug = gameSlug(url);
  if (slug === null) return;
  try {
    const record = await readLastOpened();
    record[slug] = Date.now();
    await writeLastOpened(record);
  } catch {
    // Nothing to do: the navigation this rode along with has already been answered.
  }
}

/**
 * Which games to drop first when the browser refuses a write: the ones nobody has opened,
 * then the ones opened longest ago.
 *
 * Pure, and tested as a pure function by `lib/download-all.test.ts`, which evaluates this
 * file's source and calls it — the only way to test a worker's logic without a browser and
 * without a second copy of it in a module the worker cannot import.
 *
 * A game never opened sorts first and ties sort by slug, so two runs over the same record
 * give the same order and a test can say which game goes rather than "one of them".
 */
function evictionOrder(lastOpened, slugs) {
  return [...slugs].sort((a, b) => {
    const ta = typeof lastOpened[a] === 'number' ? lastOpened[a] : 0;
    const tb = typeof lastOpened[b] === 'number' ? lastOpened[b] : 0;
    if (ta !== tb) return ta - tb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** The absolute cache key for a URL from {@link DOWNLOAD}: the document rule, applied to all. */
function gameKey(url) {
  return documentKey(new URL(url, self.location.href));
}

/** The games in the list, or an empty array on the source file where the placeholder still stands. */
function games() {
  return Array.isArray(DOWNLOAD.games) ? DOWNLOAD.games : [];
}

/** The two files that are one game's own: its play document and its chunk. */
function ownUrls(game) {
  const route = OFFLINE_URL.replace(/\/offline\/$/, `/play/${game.slug}/`);
  return [route, `${DOWNLOAD.prefix}${game.chunk}`];
}

async function allCached(urls) {
  for (const url of urls) {
    if ((await cached(gameKey(url))) === undefined) return false;
  }
  return true;
}

/** Whether every file a game needs — its own two and the shared route — is on this device. */
async function gameIsSaved(game) {
  return (await allCached(ownUrls(game))) && (await allCached(DOWNLOAD.shared));
}

/**
 * Drop one game's own files from the runtime cache. The shared route chunks stay: they are
 * every game's, and a played game needs them too. Deleting is idempotent and never throws.
 */
async function evictGame(game) {
  const cache = await caches.open(RUNTIME_CACHE);
  for (const url of ownUrls(game)) {
    await cache.delete(gameKey(url)).catch(() => undefined);
  }
}

/**
 * The download in progress, if there is one. One at a time: a second "Download all" while
 * the first is running is answered with the first's progress rather than a second loop.
 */
let running = null;
let cancelled = false;
const progress = { done: 0, bytesDone: 0, saving: null, stopped: null };

/** Tell every open page where the download has got to. */
async function broadcast() {
  const clients = await self.clients.matchAll({ type: 'window' });
  const message = await status();
  for (const client of clients) client.postMessage(message);
}

/** What the settings page shows: totals from the list, progress from the counters. */
async function status() {
  return {
    type: 'DOWNLOAD_PROGRESS',
    games: games().length,
    bytesTotal: DOWNLOAD.sharedBytes + games().reduce((sum, game) => sum + game.bytes, 0),
    done: progress.done,
    bytesDone: progress.bytesDone,
    saving: progress.saving,
    running: running !== null,
    stopped: progress.stopped,
  };
}

/**
 * Count what is already here, so a page that opens mid-way — or after a cancel, or after the
 * browser ended a long download — reads the truth rather than zero.
 */
async function recount() {
  let done = 0;
  let bytesDone = (await allCached(DOWNLOAD.shared)) ? DOWNLOAD.sharedBytes : 0;
  for (const game of games()) {
    if (await gameIsSaved(game)) {
      done += 1;
      bytesDone += game.bytes;
    }
  }
  progress.done = done;
  progress.bytesDone = bytesDone;
}

/**
 * Save one file, and make room for it if the browser refuses.
 *
 * `cache.put` is atomic per entry: a write the browser refuses leaves nothing behind, so
 * "quota pressure never corrupts the cache" is a property of the API rather than of this
 * code, and what this code decides is only *which entries go* to make the write fit. It
 * evicts the least recently used game that is not the one being saved, retries, and repeats
 * while there is still something to evict — bounded by the length of the list, and stopping
 * the download honestly when nothing is left to give up.
 */
async function saveOne(cache, game, url) {
  const response = await fetch(new Request(url, { cache: 'reload' }));
  if (!response.ok || response.type !== 'basic' || response.redirected) {
    throw new Error(`could not fetch ${url}`);
  }
  const key = gameKey(url);
  const candidates = evictionOrder(
    await readLastOpened(),
    games()
      .filter((other) => other.slug !== game.slug)
      .map((other) => other.slug),
  );
  for (;;) {
    try {
      await cache.put(key, response.clone());
      return;
    } catch (error) {
      const victim = candidates.shift();
      if (victim === undefined) throw error;
      const evicted = games().find((other) => other.slug === victim);
      if (evicted !== undefined && (await gameIsSaved(evicted))) {
        await evictGame(evicted);
        progress.done -= 1;
        progress.bytesDone -= evicted.bytes;
      }
    }
  }
}

/**
 * Save every game this device does not already hold, one file at a time (#196).
 *
 * The one request this worker originates outside install, and it is bounded the same way
 * precaching is: a fixed list built into the file, same origin by construction, run only
 * because a page asked. It takes no argument — the message that starts it says nothing but
 * "start" — and `check-zero-cost.mjs` holds it to that.
 *
 * Resumable by construction: a game whose files are all already cached is skipped, so a
 * download stopped by a cancel, a closed browser or a quota picks up where it left off the
 * next time somebody presses the button. Cancel is checked between files; the file in
 * flight finishes, and since a put is atomic that never leaves half a game.
 *
 * It runs inside the message event's `waitUntil`, so the browser keeps this worker alive for
 * it after the settings page has gone. That lifetime is the browser's to grant and it is not
 * unlimited — Chromium ends a worker that has been extended for about five minutes — which
 * is the honest reason "resumable" is not optional: a slow connection may need two presses.
 */
async function downloadGames() {
  cancelled = false;
  progress.stopped = null;
  await recount();
  await broadcast();
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    // The play route's own chunks first, once. `saveOne` is handed the first game only so its
    // eviction leaves the shared files alone; there is nothing to evict for them but games.
    const first = games()[0];
    if (first !== undefined && !(await allCached(DOWNLOAD.shared))) {
      for (const url of DOWNLOAD.shared) {
        if (cancelled) break;
        if ((await cached(gameKey(url))) !== undefined) continue;
        await saveOne(cache, first, url);
      }
      if (await allCached(DOWNLOAD.shared)) progress.bytesDone += DOWNLOAD.sharedBytes;
    }
    for (const game of games()) {
      if (cancelled) {
        progress.stopped = 'cancelled';
        break;
      }
      if (await gameIsSaved(game)) continue;
      progress.saving = game.slug;
      await broadcast();
      for (const url of ownUrls(game)) {
        if (cancelled) break;
        if ((await cached(gameKey(url))) !== undefined) continue;
        await saveOne(cache, game, url);
      }
      if (cancelled) {
        progress.stopped = 'cancelled';
        break;
      }
      progress.done += 1;
      progress.bytesDone += game.bytes;
    }
  } catch (error) {
    // A network that went away, or a quota nothing more can be evicted for. Both are
    // reported in one word the page can turn into a sentence; both leave the cache in a
    // state a later press can continue from.
    progress.stopped = /quota/i.test(String(error && error.name)) ? 'quota' : 'network';
  }
  progress.saving = null;
  running = null;
  await broadcast();
}

self.addEventListener('install', (event) => {
  // No `skipWaiting()` here, and that omission is the feature. A worker that took over the
  // moment it installed would swap the chunk URLs under a match already being played, and
  // the next lazy import in that match would 404 against a deploy that no longer exists.
  // The new worker waits; `e2e/offline.spec.ts` asserts it is sitting in `installed`; and
  // the page asks the player, which is #194.
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const stale = names.filter(
        (name) => name.startsWith('duelbox-') && name !== SHELL_CACHE && name !== RUNTIME_CACHE,
      );
      // A delete that fails is swallowed, and the ordering around it is the point. Deleting
      // is housekeeping — a stale cache costs a device some bytes until the next activation
      // sweeps it up — while claiming is the behaviour the whole first visit depends on. And
      // `Promise.all` rejects on the first failure, so a single `caches.delete` refusing
      // would have skipped `clients.claim()` entirely: the visitor loses control of the page,
      // nothing they then look at is cached, and the site is worse than it would have been
      // with no worker at all — in order to guarantee a cleanup nobody can see.
      //
      // The order stays delete-then-claim rather than the reverse, though, because the
      // reverse races the thing it is meant to guarantee: a page claimed before the sweep has
      // finished can read `caches.keys()` and find two `duelbox-shell-` caches, which is the
      // count `e2e/offline.spec.ts` asserts is exactly one.
      await Promise.all(stale.map((name) => caches.delete(name).catch(() => undefined)));
      // Claim, so a first visit is controlled without needing a reload. Without this the
      // person who arrives, installs the worker and closes the tab has downloaded the whole
      // shell and cached none of what they then looked at, because none of it went through
      // a worker. It is also what `e2e/offline.spec.ts` waits on: a plain `goto('/')` and
      // then `navigator.serviceWorker.controller` becoming non-null, with no reload.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Anything but a GET goes straight to the network, because a cache is not something it
  // could be answered from: the Cache API stores GET responses and nothing else, so a POST
  // reaching the strategies below would miss on every lookup, be fetched, and then fail to be
  // stored — the network path with two pointless cache round trips wrapped around it.
  // Returning without calling `respondWith` is also stronger than that: it hands the request
  // back to the browser untouched, rather than through a promise this worker could reject.
  if (request.method !== 'GET') return;
  // Property 1 of the contract at the top of this file, and the only place it is decided.
  // A cross-origin request is not answered, not cached and not inspected — it goes to the
  // network as though this worker were not installed. Note what that costs: it makes a
  // third-party request visible to `e2e/offline.spec.ts`'s second-play assertion as a
  // response that did not come from the worker, which is the right way for one to be
  // found. There are none today; the typefaces became self-hosted in #2469.
  if (new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(respondToNavigation(event, request));
    return;
  }
  event.respondWith(respondToAsset(event, request));
});

self.addEventListener('message', (event) => {
  // The one thing a page may ask this worker to do, and it is the half of #194 that cannot
  // live in the page: only the waiting worker can promote itself. The page decides *when*
  // — after the person has been shown a prompt and pressed Reload — and this obeys. The
  // message shape is the contract between this file and the client that registers it:
  // `{ type: 'SKIP_WAITING' }`, posted to `registration.waiting`.
  //
  // Nothing else is accepted. A worker that took instructions from a page would be a way
  // to reach the cache from any script that got into a page, and the page needs no such
  // thing: `caches` is available in a window, so a page reads what is stored by asking the
  // CacheStorage directly rather than by asking this.
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // #196. Three more words, and none of them carries anything: start, stop, and "where are
  // you". The download reads the list built into this file and nothing from the message —
  // `downloadGames()` is called with no argument, which `check-zero-cost.mjs` insists on —
  // so a page that has been got at can waste a device's bandwidth on this site's own files
  // and nothing else. `waitUntil` is what keeps the worker alive once the page has gone.
  if (event.data?.type === 'DOWNLOAD_ALL') {
    if (running === null) running = downloadGames();
    event.waitUntil(running);
  }
  if (event.data?.type === 'DOWNLOAD_CANCEL') {
    cancelled = true;
  }
  if (event.data?.type === 'DOWNLOAD_STATUS') {
    event.waitUntil(
      (async () => {
        if (running === null) await recount();
        event.source?.postMessage(await status());
      })(),
    );
  }
});
