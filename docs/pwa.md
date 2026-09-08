# The service worker

What is saved on a player's device, under which rule, what deliberately is not saved, how a
new build reaches somebody who already has the old one, and which of those things a test
actually watches on which browser engine.

This is the design record for #192 (a strategy per asset class), #193 (the offline indicator
and the offline-aware catalogue), #194 (the update prompt) and #2445 (a second play that costs
no network request), which shipped together under #2544 because none of them is separable from
the others: a cache with no update path is a site nobody can fix, an indicator with no worker
behind it is a light wired to nothing, and #2445 is the *measurement* of #192 rather than a
feature standing beside it.

Five files hold the whole of it, and they are the authority — where this document and one of
them disagree, the file is right and this document is a bug:

| File | What it is |
|---|---|
| [`apps/web/public/sw.js`](../apps/web/public/sw.js) | The worker. The source, with three placeholders; never edit the copy in `out/` |
| [`scripts/emit-service-worker.mjs`](../scripts/emit-service-worker.mjs) | Fills those placeholders in from the finished export: the precache list, the revision, the offline route |
| [`apps/web/src/components/ServiceWorkerBridge.tsx`](../apps/web/src/components/ServiceWorkerBridge.tsx) | The page's end: registration, the update prompt, the connection flag |
| [`apps/web/src/app/offline/page.tsx`](../apps/web/src/app/offline/page.tsx) | The page a navigation falls back to when this device has never held the one that was asked for |
| [`e2e/offline.spec.ts`](../e2e/offline.spec.ts) | The acceptance test. It was on `main` for weeks before any of the above existed, which is why it reads as a specification rather than as a regression net |

## What is on the device

Two caches, filled in two different ways, and the difference between them is the difference
between what the site promises everybody and what it promises you.

### The precache: the shell, on the first visit, unasked

`install` fetches a list of URLs written into the worker at build time and stores them under
`duelbox-shell-<revision>`. `scripts/emit-service-worker.mjs` derives that list from the export
rather than from a list somebody maintains, because a list of content-hashed chunk names is
wrong by the next build:

- **Every document at the top level or one directory down.** `/`, `/games/`, `/how-to-play/`,
  `/settings/`, `/privacy/`, `/terms/`, `/dmca/`, `/attribution/`, `/404/` and `/offline/`. The
  depth rule is what keeps the three large families out without naming any of them: `/play/<slug>/`,
  `/embed/<slug>/`, `/games/<slug>/` and `/games/category/<name>/` all sit two or more directories
  down. A new top-level route joins the shell automatically, which is the right default — a route
  one segment deep is a route the site's own navigation reaches.
- **Everything those documents reference**, from their `src` and `href` attributes: the scripts,
  the stylesheets, the manifest, the icons.
- **What those stylesheets reference**, followed one level further, because no HTML mentions it:
  the self-hosted `.woff2` typefaces that #2469 brought in-house.
- **The icons only the manifest knows about**, including the maskable one, which exists for a
  launcher to crop and has no tag on any page.

Every URL is checked against the export before it is written into the worker. That check is not
belt-and-braces: `cache.addAll` rejects as a unit, so one bad URL means install fails, which
means the worker never activates, and the site then has a worker that can do nothing at all with
no symptom on our side. The build fails instead, naming the document and the missing file.

Every one of those requests is made with `cache: 'reload'`, so the browser's own HTTP cache is
bypassed while the shell is being filled. The documents are not content-hashed, so that cache may
still be holding the previous deploy's `/games/`, and precaching *that* under this revision's name
would pin the old page onto the device for the life of the deploy. The hashed assets cannot go
stale that way and are asked for the same way regardless, because a rule with one exception in it
is a rule somebody will get the wrong way round.

**What is deliberately not precached: the 108 play documents and the 108 game chunks.** Installing
already costs a first visit fifty-odd requests, on a visit nobody asked for it on. Saving the whole
catalogue is a different feature with a different shape, and it is built (#196) — but as something a
person asks for, from the settings page, never as part of install. The worker carries a second list,
`GAMES`, emitted by the same script: one entry per play route with the document, the route's own
chunks that are not shell, the game's chunk (the one reached through `import()`, which no HTML
names), and what they weigh gzipped, so the page can say "108 games, N MB" before anything is
fetched. On `DOWNLOAD_ALL` the worker saves each game this device does not already hold, one file at
a time into the runtime cache, reporting progress by `postMessage`; a cancel stops it after the file
in flight; a later press skips what is already here. Persistent storage is requested when the
download starts, and a refusal is shown in words. Under quota pressure the worker evicts the least
recently *opened* game — it notes a timestamp per game on every play-route navigation, in the cache
under a key no route has — and retries; `cache.put` is atomic per entry, so a refused write leaves
nothing behind and "quota pressure never corrupts the cache" is a property of the API rather than
of the code. The whole download runs inside the message event's `waitUntil`, so closing the settings
page does not stop it; the browser's own lifetime limit on an extended worker does, which is why
resuming is not optional.

The exact count and both sizes are printed by the emit step on every build, and that is where to
read them rather than from any figure written down here, because they move with the export:

```
emit-service-worker:
  revision <16 hex characters>
  precache: <n> URL(s), <n> KB on disk, <n> KB over the wire — what a first visit installs
```

### The runtime cache: what a play adds

`duelbox-runtime-<revision>` holds whatever the page asked for while the worker was controlling
it and the worker did not already have — in practice a game's own document and its chunk, the
first time somebody plays it. Nobody asks for it to be saved and nothing announces that it was.
That is the promise the site can keep without asking anybody anything: **what you played is what
you keep**.

One ordering detail is worth knowing before you go looking for a game in there and fail to find
it. On a very first visit the worker registers on `load`, then installs, then activates, then
claims the page — and by the time it claims, this document and most of its scripts have already
been fetched, outside the worker, and so were never seen by it. They are stored the way a real
second visit stores them: by being asked for again. `e2e/offline.spec.ts` reloads once before it
plays, for exactly this reason, and a player who opens a game on their very first visit to the
site may not have it saved until they open it a second time.

## One rule per request class

| Request | Strategy | Where a copy is kept | On a miss the network cannot answer |
|---|---|---|---|
| A navigation (`request.mode === 'navigate'`) | Cache first, **never revalidated**, keyed by path alone | Runtime cache | The precached `/offline/` page |
| `/_next/static/**` — hashed scripts, stylesheets, fonts | Cache first, kept on first sight, never revalidated | Shell cache, or runtime for a game's chunk | `504 Not saved to this device` |
| Unhashed same-origin files — `/manifest.webmanifest`, `/icons/*`, the router's `?_rsc=` payloads | The same rule | Shell cache, or runtime | The same 504 |
| Anything cross-origin | Not handled at all — it goes to the network as though the worker were not installed | Nowhere | Whatever the browser does |
| Anything that is not a `GET` | Not handled | Nowhere | Whatever the browser does |

**Cache first and never revalidated is the unusual choice, and it is the one #2445 asks for in
so many words.** A revalidation is a network request, so a site that revalidates cannot claim a
second play costs none. Freshness does not come from checking each document; it comes from the
browser's own check for a new copy of `sw.js`, which it makes on navigation, which no page waits
on, and which renames every cache when it finds one. The trade is explicit and worth stating in
one sentence: a visitor may read a document from the previous deploy for as long as it takes that
check to complete, and in exchange the site opens instantly and opens on a train.

For the hashed assets that rule needs no defence at all — the URL contains a hash of the file's
contents, so a changed file is a changed URL and arrives as a miss, and revalidating one is asking
a question whose answer is already known. For the unhashed ones it is a real trade: a cached
`manifest.webmanifest` genuinely can be a deploy behind. It is still not revalidated, because
those are exactly the requests a second play would otherwise make, and they are replaced when the
revision changes, which is the whole freshness story on this site.

Three smaller decisions inside those rules have already cost somebody an afternoon each, so they
are recorded rather than left to be rediscovered:

- **A document is keyed by its path, with the query thrown away.** A static export serves one file
  per path, so `/play/chess/?from=rail` and `/play/chess/` are the same bytes, and a link carrying
  a tracking parameter still finds the copy on the device. Narrowing the *key* rather than passing
  `ignoreSearch` to the lookup is load-bearing: `ignoreSearch` would let a navigation to
  `/play/air-hockey/` match the router's prefetch payload for that route, and serving a flight
  payload to a navigation gives the visitor a screen of React internals.
- **Lookups pass `ignoreVary`.** The precache is filled by requests the worker constructs and read
  by requests the browser constructs — different `Accept` headers — and the e2e suite's static
  server answers with `Vary: Accept-Encoding` besides. Honouring `Vary` would turn every one of
  those hits into a miss, and the site would be online-only while appearing to hold a full cache.
  There is nothing to honour: a static host has one representation per URL.
- **A failed `cache.put` never reaches the page.** Quota exhaustion, a `206`, a redirected response:
  none of those is a reason to fail the request a visitor is waiting on, so the write goes through
  `waitUntil` and its failure is swallowed. A device that cannot store the shell still serves the
  site; it just serves it from the network.

The `504` on an asset miss is deliberate, and it has a cost that is written into the spec rather
than hidden: with a worker installed, a gameplay module that reached for the network would be
answered from there instead of showing up as a blocked URL in the "match plays through with every
request blocked" test. The worker makes that test *weaker*. What replaces it is static —
`scripts/check-zero-cost.mjs` scans the sources, and `sw.js` is the one file it exempts, held to
three properties instead.

## Two caches, one revision

Both caches are named for the revision, and that naming is the entire update mechanism. `activate`
deletes every `duelbox-` cache that is not one of this revision's two, so a deploy whose shell
differs by a byte lands in fresh caches and the previous deploy's copy is gone in the same breath.
`e2e/offline.spec.ts` asserts there is exactly one `duelbox-shell-` cache: two means that cleanup
has stopped running, which is how a device ends up holding three copies of the site.

**That deletion takes the runtime cache with it, and a played game is lost on every deploy.** It
looks kinder to keep it and it is wrong: a static export renames every chunk it emits, so
yesterday's cached play document points at chunk URLs that no longer exist on the origin, and the
player would get a page that renders and then fails to boot. Losing a saved game and re-saving it
on the next visit is the recoverable failure; a shell wired to deleted chunks is not.

**The revision is a hash of the precached files' contents and names — never a clock and never a
random.** Two builds of the same tree have to produce the same worker byte for byte, or a redeploy
of an unchanged site would rename every cache and throw away the copy on every visitor's device.
It is computed *after* `emit:host-config`, which is the last build step that rewrites an exported
document (it injects the CSP and referrer metas), because the rule is that **the revision must be
computed after the last step that changes a byte of anything precached**. Anything added to the
build later that touches `out/` has to go before it, or the hash stops describing what is served.

## The update, end to end

This is the half of the worker that has to work even more than the caching does, because a cached
shell that never updates is a site nobody can fix. The whole chain crosses two files:

1. The browser re-fetches `sw.js` on navigation. **A byte difference in that one file is the only
   trigger there is.** The registration's default `updateViaCache` is `'imports'`, so that fetch
   bypasses the HTTP cache for the top-level script.
2. The new worker installs. `install` precaches the shell and **does not call `skipWaiting()`**.
   That omission is the feature: a worker that took over the moment it installed would swap the
   chunk URLs under a match already being played, and the next lazy import in that match would 404
   against a deploy that no longer exists. So it sits in `installed`, waiting.
3. Install is cheap when it can be. Only URLs the cache does not already hold are fetched, so a
   worker update that changes nothing but this file — a strategy fix, a comment — installs for
   free rather than pulling the shell again. It also makes install recoverable: a run interrupted
   halfway leaves a partial cache and the next attempt finishes it.
4. `ServiceWorkerBridge` picks the new worker up from **three** places, and one `offer` function
   reads whichever slot is filled and then follows that worker's `statechange` until it reaches
   `installed`. `updatefound` is the live case — a new deploy found while this page is open, and
   the only one `e2e/offline.spec.ts` manufactures. `registration.waiting` at mount is the case
   that is easy to forget: the update installed during the last visit, nobody took it, and the
   person is back on a page still served by the old worker. `registration.installing` at mount is
   the one that is easy to reason wrongly about and is the ordinary path in production — the
   browser starts installing the moment it sees different bytes, which is while the document is
   still loading, and this registers on `load`, a beat later. Without that third read, `updatefound`
   has frequently already fired on a registration object nobody was holding yet, `waiting` is still
   null because the worker is `installing`, and the prompt appears one visit late, every time.
5. It offers only when `container.controller !== null`. A worker installing for the first time has
   nothing to displace and activates immediately, so there is nothing to ask anybody about.
6. A `role="status"` says **A new version of DuelBox is ready.** with a button named **Reload**.
   Offered, not imposed.
7. The button posts `{ type: 'SKIP_WAITING' }` to `registration.waiting`. That is the one thing a
   page may ask this worker to do, and it is the half of #194 that cannot live in the page: only
   the waiting worker can promote itself.
8. The worker calls `skipWaiting()`, takes over, and the page reloads on `controllerchange` — never
   on a timer, because the only thing worth waiting for is the new worker actually being in charge.
   The listener is attached inside the click rather than at mount, and that is the whole of the
   loop guard: `controllerchange` also fires the first time a worker claims a page, which every
   first visit does, so a handler installed at mount would reload every visitor's first page load.

The message string is a contract between two files that cannot import each other — a worker is a
separate script in a separate realm, loaded by URL. `SKIP_WAITING` is spelled once in
`apps/web/src/lib/offline-state.ts` for the page's half and once in `sw.js` for the worker's, and
**nothing enforces that the two agree**. What catches a mismatch is the end-to-end test: it presses
Reload and waits for the document to be replaced, so a worker listening for a different word fails
that test on a timeout.

**A visitor who never takes the prompt still gets the new build eventually**, because a waiting
worker activates once the old one has no clients left. The realistic spread after a deploy is
therefore: seconds for anyone who takes the prompt, one visit for anyone who closes the tab, and
*indefinitely* for a tab left open and ignored. There is no push, no kill switch and no way to
reach a device. That is by design, and `docs/privacy-policy.md` depends on it staying that way.

## What a person sees

Three surfaces, and rule 7 governs all of them: colour is never the only signal, so every one of
these is carried in words.

`ServiceWorkerBridge` is mounted once, by the root layout, as the last child of `<body>` and a
sibling of `.db-shell` rather than a child of it — the panel it can render is `position: fixed`,
and a fixed element is positioned against the nearest ancestor carrying a `transform`, a `filter`
or `contain`, so being outside the shell is what keeps a future layout experiment from moving it.
Last, so a control that appears when the connection drops does not reorder the tab stops of a page
that was already being read. On almost every load it renders `null` and is not in the document at
all, which is also what keeps the site to a single `role="status"` region — two would break
`e2e/settings.spec.ts` and `e2e/record.spec.ts`, which both ask for the only one.

**The connection.** It reads `navigator.onLine` at mount and then the `online` and `offline`
events — the only signal a page gets without asking the network whether the network is there,
which is the one probe this site will not make. It stamps `data-net="offline"` on
`<html>` and shows a `role="status"` reading *Offline. The games saved on this device still play.*
The attribute is absent rather than `data-net="online"` when there is a connection, for the same
reason `data-theme` is absent for `system`: it is an exception being announced.

**The catalogue.** One attribute, `data-offline-ready`, written on the link itself, and a word
chosen from its value by CSS. It takes three files because the card that carries it is a server
component and has to stay one — `apps/web/src/lib/landing.test.ts` walks the landing page's import
graph, fails on any file in it carrying a `'use client'` directive, names the file, and asserts
`GameCard.tsx` is in the graph it walked, so the guard cannot go quiet by failing to reach it:

- **`GameCard.tsx`** renders the *place* for the answer — `data-offline-ready`, empty, on every
  playable card — and both possible words, hidden. Empty is a third state and not a synonym for
  "no": it means nobody has looked. A build that shipped `0` would be a server asserting something
  about a device it has never seen, and it would be wrong on precisely the cards the feature exists
  for.
- **`CatalogBrowser.tsx`**, the client component `/games/` already loads, calls
  `annotateOfflineReady` over its own subtree after **every** render. Every render rather than once
  on mount, because a keystroke in the search box or a category chip brings back cards carrying the
  server's empty attribute again. The subtree rather than the document is what keeps the annotation
  off navigation chrome — structurally, rather than by being trusted not to reach it — and the spec
  asserts `header a[data-offline-ready]` has a count of zero.
- **`lib/offline-ready.ts`** does the measuring: one pass over Cache Storage building a set of
  pathnames, then a set lookup per card. `1 + n` calls for `n` caches, whatever the catalogue grows
  to, rather than 108 round trips to the cache thread.

Two properties of that measurement are worth knowing because both are counter-intuitive and both
were arrived at the hard way. **Any cache entry carrying a query is skipped**: `next/link`
prefetches rows as they scroll into view, so a browser that has merely *displayed* the sudoku row
holds `/play/sudoku/?_rsc=…`, whose pathname is `/play/sudoku/` — counting it would mark a game
that has never been opened as saved, which is the one thing this annotation must never do. And
**the measurement is taken once per page load and kept**, so a cache that gains an entry while the
catalogue is open is not noticed until the next navigation: stale in the safe direction.

**Only `/games/` is annotated.** The landing page, the eighteen category hubs and each game's own
page render the same cards from the same server component and leave the attribute empty, because
the only way to fill it in there is to put a client component on those routes, which is the cost
this whole arrangement exists to avoid. An unannotated card says neither word. That is also the
state of the grid for the first few hundred milliseconds of a first-ever visit, before the worker
claims the page: `lib/offline-ready.ts` returns nothing while nothing is controlling the document,
so the grid stays silent until something re-renders it. What is being withheld on a first visit is
108 cards all saying the game is not here, and saying nothing is the better of the two.

**Two vocabularies are live for this attribute at the time of writing, and that wants resolving.**
`GameCard.module.css` reveals **On this device** / **Not on this device**, whenever the attribute
has a value, connection or not. `globals.css` separately puts **Saved on this device** /
**Needs a connection** in an `::after`, and dims the absent card, but only while
`html[data-net='offline']` — so a card in the grid with the connection gone carries both pairs at
once. Nothing fails: `e2e/offline.spec.ts` asserts the attribute values and not the words, and
`offline-page.test.ts` holds the fallback page's quoted marks against the `globals.css` pair, which
is still there. Two mechanisms for one fact is exactly how they come to disagree, and the fix is to
choose a pair and delete the other rules rather than leave them dormant.

That annotation reads the document and not the chunk, and the gap is real: a player who opened a
game's page and left without pressing Play has the document cached and not the code, and the card
will say the game is on the device. Closing it needs something that does not exist — a
slug-to-chunk map from the build, or the worker answering a question about what it holds — so the
wording was chosen around it instead, and both live pairs of words are chosen the same way: they
are statements about what is *stored*. Neither says *Available offline*, which would be a promise
about how the next tap behaves, and neither says *Downloaded*, which is nearly honest and quietly
wrong in the same direction — nobody downloaded anything, the worker kept a copy of a page that
was opened.

**The fallback page.** `/offline/` is precached like the rest of the shell, so the fallback is
itself available with the connection gone — one that needed the network would not be a fallback.
It is a server component with not a byte of client JavaScript, because it has to render from the
precached document alone at the exact moment hydration is least likely to happen. It never learns
which page was asked for (the worker answers the request with this document rather than
redirecting, so the address bar still reads `/play/sudoku/`), so nothing on it names a game. It has
no Retry button — a control that cannot know when it will succeed is a control that lies — and it
does not say "you are offline", because it cannot know that: the fetch that failed was the
worker's, and the same bytes are served to somebody who opens `/offline/` with a perfect
connection. What does know is the indicator, which appears on that page like any other.

## What is verified, and where it is not

`e2e/offline.spec.ts` is the acceptance test for all four issues. `playwright.config.ts` runs four
browser projects on every push — `chromium` and `mobile` (Pixel 7, Chromium), `notched-portrait`
and `notched-landscape` (iPhone 14 Pro, **real WebKit**) — plus `firefox` nightly behind
`DUELBOX_ALL_ENGINES=1`. This spec is in none of the config's exclusion lists, so each test in it
runs everywhere except where the test itself stands down.

| Test | What it pins | Where it runs |
|---|---|---|
| the service worker installs, claims the page and precaches the shell | Registration, install, `clients.claim()` on a plain `goto('/')` with no reload, exactly one `duelbox-shell-` cache, `/` and `/offline/` inside it, more than 20 entries | **All four projects**, and Firefox nightly |
| a match against the bot plays through with every request blocked | Nothing in a running match needs the network | **All four projects**, and Firefox nightly |
| the whole shell survives a blocked network without a blank screen | A second game starts and keeps score with every route aborted | **All four projects**, and Firefox nightly |
| the page offers a reload, and taking it lands on the new worker | The whole update chain: waiting at `installed`, the prompt, `SKIP_WAITING`, the reload, nothing left waiting | `chromium` **only** |
| a game already played opens cold with no network and plays out | A closed-and-reopened browser, offline, opens a played game and plays it | The two **Chromium** projects |
| the second play of a game costs no network request at all | Every response has `fromServiceWorker()` true, bar the browser's own `sw.js` check | The two **Chromium** projects |
| a game never opened says so, rather than showing a browser error | The `Not saved to this device` heading, offline, for a game never opened | The two **Chromium** projects |
| the catalogue says which games are on this device, in words | `html[data-net="offline"]`, the `Offline` status, `data-offline-ready` of `1` and `0` on the right links, and none in the header | The two **Chromium** projects |

Two different reasons sit behind the two narrowed rows, and they are worth telling apart.

**The update test is narrowed for a housekeeping reason.** The only way to manufacture a second
deploy is to change the bytes the browser compares, which means editing the `sw.js` the preview
server is serving — a directory shared with every other Playwright worker in the run. The edit is
made deliberately inert (a trailing comment, so the revision is untouched, so `activate` deletes
nothing) and written by a rename so nobody can read half a file, but two of these at once would
still be two tests editing one file. Hence a guard on `test.info().project.name` rather than on
`browserName`: `mobile` is Chromium too.

**The cold-start block is narrowed for a Playwright reason, and that is the gap.**

### The WebKit gap, stated plainly

Everything in the block headed *with the network gone before the page even opens* — the cold start
of a played game, the zero-request measurement, the `Not saved to this device` fallback, and the
offline indicator with its catalogue annotation — **runs on Chromium and on nothing else.** So
iOS Safari, which is half this audience and the engine where a service worker is most likely to
behave differently, has **no cold-start coverage at all**.

The reason is mechanical rather than a judgement about what matters:

- Cutting the network with `page.route(...).abort()` does not work, and finding that out is why
  the comment in the spec is as long as it is. `page.route` intercepts at the *page's* network
  layer, and a service worker's own `fetch()` is not made by the page. The first version of that
  test blocked every route, navigated to a game that had never been opened, and got the game,
  fully rendered, off the live server. It would have passed its offline assertions on a machine
  with a working connection and failed on a train.
- `context.setOffline` is browser-level emulation, so it does reach the worker. Playwright
  implements it on Chromium and Firefox and **not on WebKit**.

Two things about that block are worth stating precisely rather than rounding off:

- Its guard is `browserName !== 'chromium'`, which is narrower than the capability — Firefox
  implements `setOffline` and is skipped anyway, and Firefox only runs nightly in any case.
  Widening it is an open question this document records rather than settles.
- The zero-request test sits inside the block and inherits the guard, though it never switches the
  network off: it measures with the connection **up**, counting responses whose
  `fromServiceWorker()` is false. Playwright's service-worker inspection is itself a Chromium
  capability, so whether that assertion would mean anything on another engine has not been
  measured here.

**What *is* covered on WebKit, on every push, on two real-WebKit projects**: the worker registers,
installs, activates, claims the page without a reload, and its precache holds the shell — the exact
cache name, `/`, `/offline/`, and more than twenty entries — rather than being an empty cache with
the right name. Both network-cut-after-load tests run there too, so a match needing nothing from
the network is verified on WebKit and always has been. What is unverified on WebKit is specifically
the **cold start**: opening the site again with the connection genuinely gone.

That distinction matters for how much comfort to take from a green run, because WebKit's storage
policies are exactly the kind of thing this suite cannot see. Apple documents an eviction of
script-writable storage — Cache Storage included — for sites without recent user interaction, and
a cache that has been evicted is a cold start that lands on the browser's error page rather than on
ours. Nothing in this repository measures that, and no amount of Chromium coverage will.

**The only answer available today is a manual pass**, and it belongs with the standing manual QA
issue #230 rather than in a comment nobody runs. On a real iPhone: open the site, play one game,
turn on Airplane Mode, force-quit Safari, reopen it and open that game — it should start and play —
then open a game you have never opened, which should show *Not saved to this device* rather than a
Safari error page. Then leave the device alone for a week and repeat the first half; that is the
eviction question, and it is the one nobody has an automated answer to.

### What the static guards hold, and what they cannot

Five things run in `pnpm test` and `pnpm build` and are cheap to trust:

- `scripts/check-zero-cost.mjs` exempts `sw.js` from its no-network scan — a worker that could not
  call `fetch` would not be a worker — and holds it to three properties instead: it names no
  absolute URL and its fetch handler compares origins; it listens for `install`, `activate`,
  `fetch` and `message` and nothing else, so it never runs without a page; and it originates no
  request of its own beyond the install precache.
- `scripts/emit-service-worker.mjs` fails the build rather than writing a worker that could not
  install, or one that would install and be useless: a precache URL the export does not contain,
  a missing `/offline/`, a missing `/`, a placeholder that is not present exactly once, fewer than
  21 entries, or emitted JavaScript that does not compile.
- `apps/web/src/lib/offline-state.test.ts` pins the two URLs a registration is built from (with and
  without a base path), the `data-net` decision, the three ways registering has to be a silent
  no-op, and — reading `e2e/offline.spec.ts` itself — that the words the bar says are still the
  words the spec greps for.
- `apps/web/src/app/offline/offline-page.test.ts` pins the fallback's heading against the spec, its
  two quoted marks against the strings `globals.css` actually renders, and that it ships no client
  JavaScript.
- `apps/web/src/lib/offline-claims.test.ts` computes whether a worker exists — from the sources,
  the public directory and the dependencies — and holds every describing file in the repository to
  it in whichever direction the answer goes. **This document is one of the files it reads**, along
  with `README.md`, `CLAUDE.md` and everything else under `docs/`. It is the guard that closed the
  eighth entry in `CLAUDE.md`'s tally, where the README called the product offline-capable for
  months and nothing could fail.

**None of them can prove the caching strategy is right.** That the shell is cache-first, that a
navigation falls back to `/offline/`, that a second play asks for nothing — those are behaviour,
they are what the end-to-end spec exists for, and no reading of the file replaces it. The static
half is what survives the worker being able to intercept its own examiner.

## Known gaps, named rather than papered over

- **No cold-start coverage on WebKit.** The section above. The largest of these by some distance.
- **The offline indicator cannot be tested from a cold start under Playwright at all.** Chromium's
  offline emulation does not make `navigator.onLine` false in a page created *after* emulation was
  switched on; it stays `true`, and the indicator reads exactly that flag. A real device with the
  radio off reports `false`. What the suite covers is losing the connection with a page open, which
  is what the catalogue test does.
- **`data-offline-ready` reads the document, not the game's chunk.** A game opened but never played
  is marked as saved. See *What a person sees*.
- **Two sets of words are live for that attribute**, one in `GameCard.module.css` and one in
  `globals.css`, and offline a card carries both. Nothing fails on it, which is why it is written
  down here. See *What a person sees*.
- **Only `/games/` annotates its cards.** The landing page, the category hubs and the per-game
  pages render the same cards and say nothing about storage, because filling the attribute in
  needs a client component and those routes are the ones that must not grow one.
- **A deploy costs every player their saved games.** The runtime cache is named for the revision
  and `activate` deletes it. Deliberate, and explained under *Two caches, one revision*.
- **The measurement behind the catalogue annotation is taken once per page load.** A cache that
  gains an entry while the catalogue is open is not noticed until the next navigation — stale in
  the safe direction: it can say a game is not here that has just arrived, never the reverse.
- **#196 is built, with one honest limit:** the download runs for as long as the browser keeps
  an extended worker alive, which in Chromium is about five minutes, so a slow connection may need a
  second press — and a second press continues rather than restarts.
- **#195, a custom install prompt, is not built**, and WebKit does not fire `beforeinstallprompt`
  at all, so it would never be the whole answer.
- **#191 is half done.** The manifest ships with its icons, `display: 'standalone'` and a base-path
  aware `start_url` and `scope`; it has no `shortcuts`, so a long-press on an installed icon offers
  nothing.

## Clearing a worker that is stuck

The honest framing first: **a worker that is broken has to be replaced by the mechanism that is
broken.** If a deploy ships a worker that cannot update, no revert reaches a device that already
has it until that device fetches `sw.js` again and finds different bytes. Nothing in this
repository can shorten that. What follows is the manual escape, and it is the only one there is.

### For a player

Every one of these is asking for the same thing in different words — *remove this site's stored
data* — and removing it unregisters the worker along with everything else. Menu wording moves
between browser versions, so treat the paths as a description rather than a script:

| Browser | Where |
|---|---|
| Chrome, Edge (desktop) | The icon left of the address bar → *Cookies and site data* → *Manage on-device site data* → delete. With DevTools open: *Application* → *Storage* → **Clear site data** |
| Firefox (desktop) | *Settings* → *Privacy & Security* → *Cookies and Site Data* → *Manage Data* → remove the site. Or `about:debugging#/runtime/this-firefox` → *Service Workers* → **Unregister** |
| Safari (macOS) | *Safari* → *Settings* → *Privacy* → *Manage Website Data…* → find the site → **Remove**. *Develop* → *Empty Caches* clears the browser's own caches and does not remove the worker |
| Safari (iOS, iPadOS) | *Settings* → *Safari* → *Advanced* → *Website Data* → swipe the site → **Delete** |
| Chrome (Android) | The icon left of the address bar → *Cookies and site data* → **Delete data** |

A hard reload (<kbd>Shift</kbd> + reload, <kbd>⌘</kbd><kbd>Shift</kbd><kbd>R</kbd>) is worth trying
first and is not the same thing: it loads that one page from the network, bypassing the worker,
but leaves it registered, so the next ordinary navigation goes back through it. It is a diagnosis,
not a fix — if the hard reload is correct and the ordinary one is not, the worker is holding a
stale copy and the site data needs clearing.

After clearing, the next visit installs the current worker from scratch, and every game that
device had saved is gone with it. Say so if you are telling somebody to do this.

### For a developer

**`pnpm dev` does not give you a working worker, and it is not supposed to.** The dev server
serves `apps/web/public/sw.js` verbatim — placeholders and all — so the file the browser gets has
a precache list containing the literal string `__PRECACHE__` and a cache name of
`duelbox-shell-__REVISION__`. Registration is attempted (localhost is a secure context), `addAll`
is handed a URL the server does not have, install fails, and nothing controls the page. That is
read out of the two files rather than measured in a browser, so treat the detail as a prediction
and the conclusion as certain: **offline behaviour cannot be exercised against `pnpm dev`.**

To see the real thing, build and serve the export the way the e2e suite does:

```bash
pnpm build                                   # runs emit:host-config, then emit:service-worker
npx serve apps/web/out -l 4173 --no-clipboard
```

`127.0.0.1` counts as a secure context, so the worker registers there. To re-emit the worker alone
against an existing export — which is what `emit:service-worker` does and all it does:

```bash
node scripts/emit-service-worker.mjs [outDir]   # default: apps/web/out
```

Four things about working on it:

- **Editing `apps/web/out/sw.js` does nothing.** It is overwritten on every build. The source is
  `apps/web/public/sw.js`.
- **The three placeholders must each appear exactly once** in the source (`'__REVISION__'`,
  `'__OFFLINE__'`, `['__PRECACHE__']`). Renaming one leaves a worker that is syntactically fine and
  semantically empty; the emit step fails instead, which is the one moment that mismatch is visible.
- **`emit:service-worker` must run after `emit:host-config` and before the `check:` steps.**
  `emit:host-config` rewrites every exported document to inject the CSP and referrer metas, and
  those documents are precached and hashed here.
- **In DevTools, use *Update on reload*** (Application → Service Workers) while iterating, and
  *Bypass for network* when you want the page without the worker in the way. Neither survives the
  tab closing, and neither is a substitute for testing the update path properly — that path is what
  `e2e/offline.spec.ts` manufactures a second deploy to exercise.

The CSP needs nothing new: `scripts/security-headers.mjs` already allows `worker-src 'self'`,
`manifest-src 'self'` and `connect-src 'self'`, and the worker adds no inline script to hash.

## What a release has to check now that it did not before

A returning visitor is served the site out of their own browser's cache and asks the network for
nothing — that is the feature, and it is also why **a route-status check can no longer tell you
whether a deploy reached anybody.** Every route answers 200 either way: from the CDN for you, from
the cache for them. `docs/release-runbook.md` step 3 has the checks that do see it; the short
version of what changed:

1. **`/sw.js` answers 200 with a JavaScript content type.** A browser refuses to register a worker
   served as `text/plain`, and the registration then fails silently — everybody keeps whatever they
   last installed.
2. **The revision inside the served `sw.js` has changed since the last deploy.** This is the one
   that matters. If it has not changed, the deploy did not reach the worker, and every device that
   already has the site will go on serving the old build with nothing to tell it otherwise.

   Read it from the `REVISION` constant and not from the cache name, because the cache name is not
   in the file. The worker builds it at runtime — `` const SHELL_CACHE = `duelbox-shell-${REVISION}` ``
   — so a grep for `duelbox-shell-` matches the literal prefix in the source and prints the same
   thing after every deploy that has ever been made. The line that does change:

   ```bash
   curl -s "$U/sw.js" | grep -o 'REVISION = "[0-9a-f]*"'
   ```

   `docs/release-runbook.md`'s verification block greps for `duelbox-shell-[A-Za-z0-9._-]*`
   instead, which prints a bare `duelbox-shell-` for every build and cannot tell two deploys
   apart — a check that reads as the most important line in the release and can never fail. Use
   the command above until that block is corrected.
3. **`Cache-Control` on `/sw.js` is short, on any host that lets you set it.** This repository
   ships no cache directive of any kind, so the lifetime is whatever the host defaults to — ten
   minutes on GitHub Pages today, and silently something else the day the site moves. Two things
   bound the damage and neither is a reason to relax: the specification caps the worker script's
   own HTTP cache at 24 hours during an update check, and the registration's default
   `updateViaCache: 'imports'` bypasses that cache for the top-level script. See
   `docs/deploy.md`, which is blunter about this than this document needs to be.
4. **On the live origin, with DevTools open**: one worker, *activated and is running*, nothing
   stuck at *waiting* that nothing offered you; `await caches.keys()` answering with exactly one
   `duelbox-shell-` name, matching the one the release runbook's `curl` printed. Two names means
   `activate` is not cleaning up.
5. **On a second visit to a game you have already played**, Network → Size reads *(ServiceWorker)*
   against every row. That is #2445, checked by eye.

And one thing that is now true of every release and was not: **the worst case is no longer bounded
by a timer.** It is bounded by the visitor. A rollback is a new worker like any other; it reaches
whoever takes the prompt in seconds, whoever closes the tab on their next visit, and a tab left
open and ignored never. Plan a bad release around that rather than around a CDN TTL.

## What this deliberately does not do

Listed because each is a thing a service worker *could* do, and because the absence is the product
rather than an omission waiting to be filled in.

- **No `push`, no `sync`, no `periodicsync`, no `notificationclick`.** Four listeners — `install`,
  `activate`, `fetch`, `message` — and `check-zero-cost.mjs` fails the build on a fifth. A service
  worker is the one piece of this product a browser can start when nobody is looking, and the way
  to keep that from happening is to give it nothing to wake up for.
- **No telemetry of any kind.** No beacon, no counter, no error endpoint. Nothing is reported
  anywhere, and there is no server of ours to report it to.
- **Nothing cross-origin.** Every URL it touches is on this origin, checked against
  `self.location.origin` at the top of the fetch handler. No URL from a message, a query string or
  the contents of a cached document is ever fetched.
- **No instruction-taking.** `{ type: 'SKIP_WAITING' }` is the only message accepted. A worker that
  took orders from a page would be a way to reach the cache from any script that got into a page,
  and the page needs no such thing — `caches` is available in a window, which is exactly how the
  catalogue annotation reads what is stored.
- **Nothing of the player's is in either cache.** No scores, no names, no settings, no identifier.
  Only files this site served, which is what lets `docs/privacy-policy.md` describe the whole thing
  in five paragraphs.
