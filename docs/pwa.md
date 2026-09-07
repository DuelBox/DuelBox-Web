# Offline, and the service worker that makes it true

CLAUDE.md's first paragraph has said **"Offline-capable"** since the repository was created.
`docs/adr/0002-no-backend-in-v1.md` lists it as one of four properties of v1. The shipped
privacy page said the game "works with no connection at all". All three were describing a
product you could close the tab on, and until 29 August 2026 there was **no service worker,
no web app manifest and no registration anywhere** — `manifest-src 'self'` and
`worker-src 'self'` had been sitting in the content security policy the whole time with
nothing to permit.

What existed was real and was a smaller claim than the one being made: `e2e/offline.spec.ts`
loaded a page, aborted every subsequent request and played a match to a scored result. That
proves a match needs nothing from us. It says nothing about closing the tab, losing the
signal, and coming back — which is what a reader of any of those three documents would take
the sentence to mean.

This is the seventh entry in the same series as `pnpm size` resolving to the system `size(1)`
and the coverage gate nothing ran. The difference is only that this one was a claim with no
implementation rather than a guard with no execution.

## The pieces

| file | what it is |
|---|---|
| `apps/web/public/sw.js` | the worker, written by hand, copied into the export verbatim |
| `scripts/emit-service-worker.mjs` | injects the precache list and the revision, and refuses four ways of shipping one that cannot work |
| `apps/web/src/app/service-worker-client.ts` | registration, the update prompt and the offline indicator, as an inline script |
| `apps/web/src/app/manifest.ts` | the web app manifest, `/manifest.webmanifest` |
| `apps/web/src/app/offline/page.tsx` | what a navigation falls back to for a route this device has never opened |
| `apps/web/public/icons/*` | five icons, drawn by `scripts/make-icons.mjs` |

## Strategy per asset class

The build is content-hashed everywhere except its HTML, and HTML is served with
`cache-control: max-age=600`. That shape is what the table below is built around.

| class | matched by | strategy | why |
|---|---|---|---|
| build assets | `/_next/static/**` | cache-first, **never** revalidated | every one is content-hashed, so the URL *is* the version. A conditional request on an immutable URL can only ever return 304 — a round trip to learn nothing |
| documents | `request.mode === 'navigate'` | cache-first → network → the offline page | freshness comes from the worker update lifecycle, not from re-fetching HTML. This is what makes a repeat play cost zero requests, and what stops a session pairing yesterday's HTML with today's chunks |
| route payloads | `*.txt`, `?_rsc=` | cache-first | the same document in another form, belonging to the same build. Splitting their freshness from the HTML's is how a router renders two versions at once |
| everything else same-origin | the manifest, the icons | stale-while-revalidate | small, unhashed, nothing blocks on one — and never requested during a match, so it does not spend the zero-request budget |
| anything cross-origin | a different `origin` | **not intercepted at all** | the worker is a cache, not a client. No `respondWith`, no copy, no observation |
| `sw.js` itself | its own path | **never served from cache** | the browser's update check bypasses the worker, but a page that fetched it would be handed a copy of the worker it is trying to replace. That is the one way to make a stale worker permanent |

### What is precached, and what is deliberately not

**Precached at install (54 URLs, 1.64 MB uncompressed, 507 KB over the wire):** every
build asset that is not one game's own chunk — which is exactly `check-size.mjs`'s definition
of *the shell* — plus the six routes that exist whatever games ship (`/`, `/games/`,
`/how-to-play/`, `/privacy/`, `/terms/`, `/offline/`) and their route payloads, the web app
manifest and the icons. Most of it is already in the browser's HTTP cache from the page load
that triggered the install.

**Not precached: the 108 game chunks and the 214 per-game pages.** This is the deliberate
part and it is a policy, not an oversight. Pre-caching them is several megabytes to make
offline a hundred and seven games this pair did not choose, on a connection somebody may be
paying for, at a moment nobody asked for anything. **Cache on play** instead: the first match
downloads the chunk through the worker, and from then on that game works with no connection
while the others honestly do not.

The honesty is the other half of the policy. A player should not have to guess which games
they have, so the catalogue says: with the connection gone, every card carries either "Saved
on this device" or "Needs a connection" — in words, because rule 7 says colour is never the
only signal and a dimmed card is not something anybody can read in greyscale.

`scripts/emit-service-worker.mjs` decides which chunk belongs to a game by the same rule
`check-size.mjs` uses — a chunk carries a manifest id, `id:"ping-pong"`, and names no other
game's. Deliberately restated rather than shared: one is a budget and one is a cache, and
they should be able to disagree about a chunk without one silently changing the other.

## Freshness, and why a stale worker is the thing to design against

A cached shell that never updates is a site nobody can fix — push all you like, no browser
will ever see it. So the only freshness mechanism is the one the browser drives and that
cannot be cached away: it re-fetches `sw.js` on navigation, byte-compares it, and installs a
new one if it differs. Every deploy produces different bytes because `REVISION` is a **digest
of the contents of everything precached** — contents, not names, because HTML is not
content-hashed and a change to a page's *text* changes no filename at all. A hand-maintained
version number catches that only when somebody remembers.

The new worker then **waits**. Taking over immediately would swap the chunks under a running
match. The page shows "A new version of DuelBox is ready" with a Reload button; pressing it
posts `SKIP_WAITING`, the worker takes over, `controllerchange` fires and the page reloads
onto the new build. `activate` deletes every cache from an older revision in one step, so a
session can never mix two builds. The only exception is the very first install, where there
is nothing to interrupt and nothing to prompt about, so it claims the page at once.

## The `check-zero-cost` collision, and how it was resolved

`scripts/check-zero-cost.mjs` fails the build on `fetch`, `WebSocket`, `RTCPeerConnection`
and friends anywhere in gameplay or the shell. A service worker's entire job is to answer a
`fetch` event, and it answers it by calling `fetch`. The conflict is genuine.

There were two ways out and one of them was much worse. **Softening the pattern** — dropping
`.js`, skipping `public/`, allowing `fetch` where a comment says it is fine — buys the
feature and leaves the guard wide for everything that comes afterwards, including whatever it
was written to stop. That is the worst available outcome and it is the easy one.

What was done instead:

1. **The scan was widened, not narrowed.** `apps/web/public` is now scanned, with a
   per-directory extension list so `.js` is read there and not across a hundred `dist/`
   folders. A new directory of shipped code that no guard looked at is exactly the blind spot
   this function has had twice already; adding the worker without adding its directory would
   have opened a third on the same day one was closed.
2. **One file is exempt from one pattern.** `apps/web/public/sw.js` may call `fetch`. It may
   still not open a socket, a peer connection, an `EventSource` or a beacon.
3. **The exemption is not a free pass.** It swaps the blanket ban for three properties the
   build checks on every run:
   - it must bail out on any cross-origin request, so it can never observe or rewrite traffic
     to another origin;
   - it must name **no remote host at all** — a literal `https://…` fails the build;
   - every `fetch` must take the event's own `request`, so it can only ever answer something
     the page already asked for, never something the worker composed.
4. **A stale exemption fails too.** If `apps/web/public/sw.js` stops existing, the build says
   so, rather than the exemption sitting there covering nothing.

Every one of those was watched failing on purpose — a cross-origin bail-out deleted, a
`https://example.com/collect` inserted, a `fetch(request.url + '?probe')` written, the file
moved away — and the same four properties are asserted again in
`apps/web/src/app/service-worker-client.test.ts` so they run on every push and not only on a
build.

**One of those checks was silently broken when written**, and finding it is the reason the
habit is worth the trouble. The remote-origin check ran over source with comments stripped,
and the line-comment stripper is a regex: `'https://example.com'` contains `//`, so stripping
turned the literal into `'https:` and the check could never fire on the exact thing it was
looking for. It now reads text with block comments removed and line comments left in, because
the pattern needs a quote immediately before the scheme.

## What this costs, in bytes

| | |
|---|---|
| shell (`.js` a visitor downloads before choosing a game) | **+287 bytes gzipped** — the `/offline/` route chunk (163 B) and Next's client stub for the manifest route (124 B) |
| registration, the update prompt and the offline indicator | **0 bytes of shell.** It is an inline script: 2,248 bytes of markup per page, under a kilobyte gzipped in isolation and less in place, hashed into each page's `script-src` by `emit-host-config.mjs` exactly as the frame guard already is |
| `sw.js` | **2.0 KB gzipped** (6,104 bytes raw), on its own budget line in `size-budget.json`, not folded into the shell |
| icons | 14.2 KB on disk, fetched only when a platform wants one |

The shell measured **278.7 KB against the 280.0 KB budget** on the build that closed this
work, and `pnpm build` passes end to end. Most of that headroom is not this change's doing —
the shell was over the line when this started and a concurrent change moved a synthesiser out
of it. What this change contributed is the 287 bytes above.

No budget was raised. `serviceWorkerBytes` is a new line rather than a bigger old one, and the
comment in `size-budget.json` argues for it: the worker is not part of what a visitor must
have before choosing a game — it is fetched after load, off the critical path — and on the
next visit it is the reason the shell costs nothing at all. Counting it against the number it
exists to eliminate would be arithmetic that punishes the fix. It is still budgeted, because
"not in the shell" is not "unmeasured", and `check-size.mjs` now **fails if `sw.js` is
missing entirely** — a site claiming to be offline-capable in three documents should not be
able to ship without it.

The emitted worker is the source with its comments stripped by the build step. The reasoning
stays in `apps/web/public/sw.js`, where the next person will look for it and where it costs
nobody anything; the wire gets 6.1 KB of code instead of the source's 11.3 KB of code and
prose.

## Evidence

`e2e/offline.spec.ts`, against the real static build served as plain files:

- **the worker installs, claims the page and precaches the shell** — on all four projects,
  Chromium and real WebKit. Asserts exactly one shell cache, that `/` and `/offline/` are in
  it, and that it holds more than twenty entries rather than being an empty cache with the
  right name.
- **a game already played opens cold with no network and plays out** — a fresh page, an empty
  heap, `setOffline(true)`, a full three-move match to a scored result.
- **the second play of a game costs no network request at all** (#2445) — measured with the
  connection *up*, by checking `fromServiceWorker()` on every response. Nothing goes out
  except the browser's own check for a new worker.
- **a game never opened says so** — the offline page, not the browser's error.
- **the catalogue says which games are on this device, in words.**
- **a new deploy offers a reload, and taking it lands on the new worker** (#194).

### Two things the suite does not prove, named rather than glossed

**The cold-start tests are Chromium-only, and not for a product reason.** `page.route(...)
.abort()` does not cut the network for a service worker: the worker's own `fetch` is not made
by the page and sails straight past. The first version of the cold-start test blocked every
route, navigated to a game that had never been opened, and got the game — off the live server,
fully rendered. It would have passed on a machine with a connection and failed on a train.
`setOffline` is browser-level emulation and does reach the worker, and Playwright implements
it on Chromium and Firefox but not WebKit. So what is unverified on WebKit is specifically
the *cold* start; the worker installing, claiming and precaching **is** verified there, as is
offline play on an already-loaded page.

**The update test does not isolate `SKIP_WAITING`.** Measured: with the worker's message
handler removed, the test still passes, because Chromium ends up activating the waiting worker
anyway once a client has asked. What the test does prove is the user-visible contract — a
prompt appears on a new deploy, the new worker waits rather than taking over, and taking the
prompt lands the page on it with nothing left waiting. The message itself is pinned by
`service-worker-client.test.ts`, which asserts both files use the same string and that the
worker calls `skipWaiting()` in exactly two places.

### And one exemption that is now dormant rather than dead

`e2e/offline.spec.ts`'s first test excludes `?_rsc=` prefetches and `/_next/static/` from its
blocked-request assertion. Measured by deleting them: with the worker installed the list is
empty on all four projects anyway, because the worker answers a prefetch from cache and the
request never reaches the network layer `route` sits on.

They are kept, and the distinction from the Google Fonts exclusion that was deleted in #2469
is real: that one named a dependency that had gone, while these name a behaviour that is
merely being intercepted. A browser with service workers off still prefetches.

The consequence worth stating: **the worker makes that test weaker.** A gameplay module that
fetched something would now be answered by the worker instead of showing up as a blocked URL.
What replaces it is static — `check-zero-cost.mjs` now scans `apps/web/src` and `.tsx` files,
and `sw.js` is the single exempted file, held to the three properties above.

## The web app manifest (#191)

`display: 'standalone'`, not `fullscreen`: two people share a phone here, and fullscreen takes
the system back gesture away from whoever is holding it. **Orientation is not locked**,
deliberately — two seats read a shared screen differently in portrait than in landscape, and a
manifest that pinned one would overrule the choice the players just made by turning the device.

Icons are drawn by `scripts/make-icons.mjs` — arithmetic, no design tool, no third-party
artwork — from the geometry of `apps/web/src/components/Wordmark.tsx`, so the installed icon
and the header mark are the same object. One departure: the wordmark draws both seats as
filled discs, and `#ff5a4e` and `#21b0e8` sit close enough in luminance that a greyscale home
screen shows two identical dots. The second seat is a ring. `any` and `maskable` are two
different drawings rather than one file labelled twice — the maskable one fills its square
edge to edge and shrinks the seats inside the 40%-radius safe circle.

Shortcuts are **routes, not games**. A shortcut to one game is a guess about which of a
hundred and eight a particular pair plays, made once at install time and wrong for almost
everybody. Both shortcuts point at routes the worker precaches, so they work with no
connection; a shortcut that opens the offline page would be worse than no shortcut.
`manifest.test.ts` asserts that, along with every icon file actually existing.

## What is not done, and why it needs its own work

**#195, install prompt timing.** Not a `beforeinstallprompt` listener — a policy. The question
is when it is acceptable to interrupt two people who are mid-match to ask them to install
something, and there is no answer to that in this repository yet: no telemetry (ADR 0002 gives
that up explicitly), no notion of a returning pair, and a shared-screen product where an
install banner covers the play area for *both* players at once. Shipping a prompt on the
platform's default trigger would put a dialog over somebody's board. It needs a decision about
the moment, and probably a rule that it never fires on `/play/*`.

**#196, download-all with a quota strategy.** Deliberately out of scope here and genuinely a
separate piece of work, because it is the one feature that has to reason about a budget this
worker never touches. Precaching on install is bounded by the shell; a download-all is
unbounded by construction — several megabytes across 108 chunks — so it needs
`navigator.storage.estimate()`, a policy for what to evict when the origin's quota is reached
(and quotas differ by an order of magnitude between iOS Safari and Chrome on desktop), a
progress and cancel UI, resumption after a dropped connection, and an answer to what happens
when a deploy invalidates a download somebody waited four minutes for. None of that shares
code with the cache-on-play policy above; all of it depends on a UI that does not exist. It
should start from a decision about how much of somebody's device this product may ask for.

## Verifying it by hand

```bash
pnpm build
npx serve apps/web/out -l 4173
```

Open `http://127.0.0.1:4173`, play one game, then switch the network off in devtools —
**Application → Service Workers** should show one activated worker and
**Application → Cache Storage** two `duelbox-` caches. Close the tab, reopen it with the
network still off: the site loads, the game you played loads, the games you did not say
"Needs a connection".

For the update path, build twice with any change in between and reload — the prompt appears,
and the reload lands on the new revision.
