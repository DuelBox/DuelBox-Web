# Privacy policy

This is the source text of the policy, and the record of how each claim in it was checked.
The player-facing copy is rendered by `apps/web/src/app/privacy/page.tsx` and linked from
the footer in `apps/web/src/components/SiteFooter.tsx`.

A privacy policy is the easiest document in a repository to write from a template and the
easiest to be quietly wrong. "We collect nothing" is only worth writing if somebody has
checked, so the second half of this document is the check, with the greps that produced it.
Anyone changing the policy should re-run them rather than trust this page.

Where the rendered page and this text disagree today, the disagreements are listed at the
end under [Corrections owed to the page](#corrections-owed-to-the-page). They are small and
they are real.

---

## The policy

_Last updated 29 August 2026._

### What we collect

Nothing.

There is no account to create, no analytics, no advertising, no tracking and no server of
ours that receives anything from you while you play. There is no data for us to hold, lose,
sell, or be compelled to hand over, because none of it ever leaves your device.

### What stays on your device

One thing, and it is a preference rather than a record of play.

When you set up a match — playing a friend or a bot, which difficulty, how many rounds — the
site remembers that choice per game so the next match starts with the same setup already
selected. It is stored in your browser's own storage under the key `duelbox:last-mode`, on
the device you played on, and it is never sent anywhere.

It holds only the setup: the mode, the difficulty and the round count, for each game you
have opened. **No scores, no names, no times, no identifiers.** Clearing your browser's site
data removes it, and nothing else remembers it.

### What your browser keeps a copy of, so the site opens without a connection

Copies of this site's own files. Nothing about you.

The section above is about the one thing the site *writes down*. This is a different kind of
storage and it deserves its own paragraph rather than a clause, because it is larger, it
arrived recently, and a reader who found it themselves would be right to want it mentioned.

A **service worker** — a small script your browser runs on this site's behalf — saves the
site's pages, its JavaScript, its stylesheets, its fonts and its icons the first time you
visit, and then saves each game's page and code on the device you played it on. That is what
makes a game you have already opened start and play with no connection at all, and it is why
opening it a second time asks the network for nothing.

**Everything in it is a file this site served you.** The same HTML, JavaScript, CSS, `.woff2`
fonts and SVG icons GitHub Pages sent to your browser, stored in your browser's Cache Storage
under two names beginning `duelbox-shell-` and `duelbox-runtime-`. There is nothing in it
that came from you: no scores, no names, no settings, no identifier, and no log of what you
did — only the site's own files, which you can list yourself with the console command in the
verification table below.

**It goes nowhere.** The worker answers requests your browser was already making and does
nothing else. It has no analytics, no error reporting, no beacon and no counter; every URL it
touches is on this origin, and it refuses to answer a request for any other. There is no
server of ours for it to talk to, which is the same reason the rest of this page is short.

**You control it, and it is not permanent.** Clearing your browser's site data removes it
along with everything in the section above. It is replaced wholesale whenever a new version
of the site is published, and your browser may discard it on its own when it needs the space.
[`docs/pwa.md`](pwa.md) has the step-by-step for removing it deliberately, in each browser,
including what to do if the site seems stuck on an old version.

**The whole catalogue is not downloaded.** Only games you actually open are saved. Pulling a
hundred-odd games onto a phone that asked for one would be spending somebody else's data
allowance, so it is not done, and the feature that would do it deliberately and with a
progress bar is on the backlog rather than switched on quietly (#196).

### Cookies

There are none. The site sets no cookies, and there is no server to set one.

### How the site reaches you

The pages and games are static files with no server behind them. They are published on
**GitHub Pages**, and your browser downloads them from GitHub's infrastructure the same way
it downloads any web page.

Like every web host, GitHub receives the ordinary details of that request — your IP address,
your browser's user-agent string, and which page you asked for — and keeps its own server
logs. Those logs are GitHub's, not ours: we have no access to them, we have never requested
them, and nothing on this site is designed to make them more useful. GitHub's handling of
them is covered by [GitHub's Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement),
not by this one.

Once a game has loaded, it keeps running with the connection cut. It makes no further
requests of any kind.

### What the site never asks your browser for

No location, no camera, no microphone, no motion sensors, no contacts, no clipboard reading,
no device fingerprint. The games are forbidden from even asking: a lint rule refuses
`navigator`, `screen`, `devicePixelRatio` and `Date` in every game, in the engine and in the
game SDK, and a build-time guard refuses `fetch`, `XMLHttpRequest`, `WebSocket`,
`EventSource` and `sendBeacon` in the same code.

The site does read two things about your browser, neither of which is stored or transmitted:
whether you have asked your operating system to reduce motion, so animation can be turned
down, and your screen's pixel density, so the canvas is not blurry.

### Fonts and other third parties

There are none. The three typefaces are served from this site's own files. Nothing is fetched
from Google Fonts, a CDN, a tag manager, an error reporter or an A/B testing service, because
none of those are installed.

### Children

The games suit all ages. We collect no personal information from anyone, so we collect none
from children either.

### If this changes

Remote play between two devices is designed but not built. If it ships, this policy changes
before it does — a peer connection carries data between two players, and that is a disclosure
this document does not currently have to make.

Any change appears here first, with the date above updated. It will not change quietly.

### Contact

Open an issue at <https://github.com/DuelBox/DuelBox-Web/issues>, or for anything sensitive
use the private advisory route in [`SECURITY.md`](../SECURITY.md).

---

## How every claim above was checked

Run these again before changing the policy. Each is written so that a `nothing found` result
is the passing one.

| Claim | How it was checked | Result |
|---|---|---|
| No network call in shipped code | grep `apps/web/src` and `packages/*/src` for `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `axios` | Zero real hits. The only matches were `SoundEventSource` in `packages/engine/src/sound-events.ts` and the English word "plausible" in three files |
| No analytics | grep source and `package.json` for `gtag`, `googletagmanager`, `google-analytics`, `plausible`, `posthog`, `sentry`, `@vercel/analytics`, `next/third-parties` | Not in source, not in dependencies |
| No analytics in the built output | grep `apps/web/out` for `UA-\d{4,}`, `G-[A-Z0-9]{8,}`, `GTM-`, `gtag` | Two matches, both the privacy page's own sentence saying there are none |
| Fonts are self-hosted | `apps/web/src/styles/fonts.css` uses relative `src: url('./fonts/…woff2')`; built CSS references only `/_next/static/media/*.woff2`; grep `apps/web/out` for `googleapis`/`gstatic` | Nothing found. The `<head>` previously carried a `preconnect` and a Google Fonts stylesheet; both were removed when the site's own CSP was found to be blocking them |
| One storage key, and only that | grep for `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `caches.` | One writer: `apps/web/src/lib/last-mode.ts`, key `duelbox:last-mode`. No other `setItem` anywhere |
| No service worker, no app cache | search for `sw.js`, `service-worker*`, `manifest.webmanifest`, `next-pwa`, `workbox`, `serwist`; grep `apps/web/out` for `serviceWorker` | None exist. `apps/web/public` does not exist |
| No device fingerprinting | grep for `navigator.userAgent`, `navigator.language`, `hardwareConcurrency`, `getGamepads`, `mediaDevices`, `geolocation`, `screen.` | None present. Every "screen" hit is the English word in prose |
| The lint ban is real | `eslint.config.js`, the block over `packages/engine/**`, `packages/game-sdk/**`, `packages/games/**` sets `no-restricted-globals` on `Date`, `window`, `document`, `devicePixelRatio`, `screen`, `navigator`, `requestAnimationFrame`, `performance`, `matchMedia`, and `no-restricted-properties` on `Math.random` | Confirmed. One exemption, `packages/engine/src/loop.ts` |
| The network ban is enforced at build time | `scripts/check-zero-cost.mjs`, property `Gameplay never touches the network` | Confirmed, with the scope caveat below |
| Nothing external is loaded | Built `index.html` carries a hashed CSP with `default-src 'none'; connect-src 'self'; font-src 'self'; img-src 'self' data:`. No `preconnect`, no `dns-prefetch`, no `crossorigin` in any built HTML | Confirmed. The browser would refuse a cross-origin request even if one were added |
| Remote play collects nothing because it does not exist | grep for `RTCPeerConnection`, `WebRTC`, `BroadcastChannel`, signalling code; `PlayMode` in `apps/web/src/lib/match-setup.ts` is `'friend' \| 'bot'` | Not implemented. `docs/play-configurations.md` describes it as designed |

### Three caveats a careful reader deserves

**The zero-cost guard covers `packages/**` only.** `scripts/check-zero-cost.mjs` walks
`packages/engine/src`, `packages/game-sdk/src` and `packages/games`, and does **not** scan
`apps/web/src`. So the shell is not covered by that script. What covers the shell is the
CSP's `connect-src 'self'`, `apps/web/src/security/csp-origins.test.ts`, and grepping — which
is weaker than a build failure. Anyone adding a network call to the shell would not be
stopped by a guard; they would be stopped by review, or by the browser refusing the request.
Extending the guard to `apps/web/src` would close that, and is worth doing.

**The offline test does not prove the absence of Google font requests.** `e2e/offline.spec.ts`
loads the page, then aborts every subsequent request and plays a full match — a genuine proof
that gameplay touches nothing. But line 70 still filters `fonts.(gstatic|googleapis).com` out
of its blocked-request assertion, left over from before the fonts were self-hosted. The
evidence that no Google request is made is the build-output grep in the table above, not that
spec. The dead filter should go.

**One document in this repository still contradicts the policy.** `docs/threat-model.md`
still says the site fetches three typefaces from Google's CDN on every cold load and marks it
"Not mitigated". That was true and is not — the fonts were self-hosted in commit
"Self-host the fonts the site's own CSP was blocking". The threat model needs that row
updated; this policy is the one that matches the code.

### What "offline" means here, and what it does not

There is no service worker and no cache manifest. Once a page and its chunk are in the tab a
match runs with no further requests at all — the simulation, the bots and the physics are all
on the device, proved by `e2e/offline.spec.ts`, which aborts every request after load and
plays a bot match through to a scored result. That is **not the same as working offline**: a
cold load with no connection, or a hard reload of a page that was never opened, depends
entirely on the browser's ordinary HTTP cache, and nothing in this repository guarantees it.
The README, CLAUDE.md and ADR 0002 describe the product in the same terms, so no document
promises an offline cache this build does not ship.

### The one data flow that does exist

GitHub Pages is a web host with a CDN in front of it, and it necessarily sees each visitor's
IP address, user-agent and requested path. That is the only place a byte about a visitor goes
anywhere, and it is outside this repository's control.

Two consequences worth stating rather than glossing:

- The current page says the files come from "a content delivery network". Naming GitHub is
  more useful and no less true — `.github/workflows/deploy.yml` is unambiguous, and a reader
  can then go and read GitHub's own statement.
- The generated `Permissions-Policy` — which disables camera, geolocation, microphone,
  accelerometer, gyroscope, `interest-cohort`, `browsing-topics` and more — **is not served
  on this host.** GitHub Pages sends no custom response headers, so seven of the nine
  generated headers reach nobody (#2481, and see `docs/deploy.md`). The policy above
  therefore claims only that the site never *asks* for those permissions, which is a fact
  about the code and is true regardless of the host. It does not claim the browser is
  enforcing a policy nobody serves.

## Corrections owed to the page — all three applied, 29 August 2026

`apps/web/src/app/privacy/page.tsx` was accurate in substance and wrong in three details.
All three are now fixed on the page; the list is kept because a correction with no record of
what was wrong is indistinguishable from a rewrite.

1. **"Scores and settings are kept in your browser's own storage."** No scores are stored.
   The only key is `duelbox:last-mode`, holding play mode, bot difficulty and round count per
   game. "Settings" is true; "scores" is not. *Now reads "Your settings", and names the three
   things it holds.*
2. **"works with no connection at all."** Was true for an already-loaded page and not for a
   cold load, because there was no service worker. *Fixed by building one rather than by
   softening the sentence — see above. The page now also says what is **not** there: a game
   this device has never opened.*
3. **"a content delivery network."** It is GitHub Pages. *Now named, along with what its logs
   hold.*

A fourth was owed once the worker existed and is included: the page has to say that the
browser keeps copies of the site and of each game played, because that is storage on a
visitor's device that a privacy page had better mention before somebody finds it.

## What issue #212 asked for, and what remains

The issue asks for analytics, local storage, ads and account data covered in plain language,
and for the result to be **published, linked in the footer, and reviewed**.

Published and linked: already true, before this document existed. Ads and accounts: neither
exists, and the policy says so rather than reserving the right to add them quietly.

**Reviewed by someone qualified: not done, and this document cannot do it.** Everything above
is a verified description of the code, which is the part an engineer can establish. Whether it
is sufficient under any particular jurisdiction's law is a question for a person with that
training, and the honest state of #212 is that this half is finished and that half is not.
The good news is that the review is cheap here, because the subject matter is one
`localStorage` key and one host's access logs.
