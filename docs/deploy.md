# Deploying

The build output is a plain directory of files. There is no adapter, no runtime, no
serverless function and no provider SDK anywhere in the application code — `pnpm build`
produces `apps/web/out/` and that directory is the whole site.

That is a deliberate constraint rather than a happy accident. Free tiers change their terms;
the point of having no host-specific glue is that moving is an afternoon.

```bash
pnpm install
pnpm build          # → apps/web/out/
```

## What is in the artefact

| | |
|---|---|
| `index.html`, `games/`, `play/…` | The site. One directory per route, `trailingSlash: true`, so directory-style hosts work unmodified |
| `_next/static/chunks/*.js` | The shell, plus one lazily-loaded chunk per game |
| `_headers` | Netlify, Cloudflare Pages and Cloudflare Workers static assets read this — Workers has since April 2025, so `wrangler.jsonc` needs nothing added to it |
| `vercel.json` | Vercel reads this |
| `security-headers.conf.txt` | nginx, Apache and Caddy blocks, commented, for anyone serving it themselves |
| `security.txt`, `.well-known/security.txt` | RFC 9116, both locations |
| `sw.js` | The service worker, with its precache list and revision injected by `scripts/emit-service-worker.mjs`. **Do not edit it in `out/` — it is overwritten on every build**; the source is `apps/web/public/sw.js` |
| `manifest.webmanifest`, `icons/` | The web app manifest and its five icons |

A host needs to do nothing for the offline story to work: the worker is a file like any
other and everything it needs travels in the export. Two properties of it are worth knowing
before the section that follows, because that section is a warning and these two are the
facts it rests on.

**Its scope is the directory it is served from, which is not the origin root.** `sw.js` sits
beside `index.html` in the export, so on a root-served host its scope is `/` and on the
GitHub Pages *project* page it is `/DuelBox-Web/`. That is correct and sufficient — the whole
site is under that prefix — but it means the worker's scope, and every URL in its precache
list, must carry the base path or they name pages that are not there. That is the same
`NEXT_PUBLIC_BASE_PATH` `next.config.ts` reads and `.github/workflows/deploy.yml` sets, and
`apps/web/src/app/base-path.ts` names the worker's scope and its precache list, by those
words, as two of the four places a hand-built URL has to carry it. A precache list that
forgot it 404s every entry **on the deployed host and nowhere else** — not in `pnpm dev`, not
in the e2e suite, both of which run root-served.

**A service worker requires a secure context**, so the site must be on HTTPS or `localhost`.
Every host in this document is, and the e2e suite runs on `127.0.0.1`, which counts.

### `sw.js` must not be served with a long cache lifetime

**This is the one host setting that can strand every visitor on a build you have already
deleted**, and it is worth being blunt about because nothing in this repository can stop a
host getting it wrong.

The mechanism is short. A returning visitor is served the site out of the worker's cache and
asks the network for nothing — that is #2445, and it is the feature. The *only* thing that
tells that device a new build exists is the browser re-fetching `sw.js` on navigation and
finding different bytes. Serve that file with a long `Cache-Control` and the browser answers
its own check out of the HTTP cache, finds the same bytes it had, and concludes there is
nothing new. The deploy is then live, correct, and invisible to everybody who already has the
site.

Two things bound the damage, and neither is a reason to relax:

- **The specification caps the worker script's own HTTP cache at 24 hours** during an update
  check, so `max-age=31536000` on `sw.js` behaves as `max-age=86400`. Bounded rather than
  broken — but a day is a very long time to be shipping a fix nobody can receive.
- **A registration's default `updateViaCache` is `'imports'`**, which makes the browser
  bypass the HTTP cache entirely for the top-level worker script on an update check. That is
  a property of how the worker is registered rather than of the host, so it is a real defence
  and it is not one the host operator controls or can see. If a registration is ever changed
  to `updateViaCache: 'all'`, the 24-hour cap is the only thing left.

### What the artefact says about caching, per class of file

Until #188 this repository shipped **no cache directive of any kind**: the generated headers
were nine security headers and none of them was a `Cache-Control`, so every file's lifetime
was whatever the host did by default. It now ships two, drawn along the only line that
matters — **does the URL change when the bytes change?**

| Class | `Cache-Control` | Why that one |
|---|---|---|
| `/_next/static/*` — every chunk, stylesheet, font and the Noto faces: 177 files | `public, max-age=31536000, immutable` | Next names each of these by a hash of its own bytes, so a changed file is a changed URL and an old URL is never asked to serve new content. `immutable` is the half that does the work: a long `max-age` alone still revalidates on a reload, and 177 conditional requests to be told 304 is the thing #188 asks to stop |
| `/sw.js` | `public, max-age=0, must-revalidate` | The section above, in one line: it is the only file whose staleness cannot be fixed from here, so it gets a rule of its own rather than inheriting whatever the default happens to be |
| Documents (all 223), `index.txt` route payloads, `manifest.webmanifest`, `sitemap.xml`, `robots.txt`, `.well-known/*` | `public, max-age=0, must-revalidate` | Their URLs outlive their bytes — same address, new content every deploy — so a stored copy is last week's site. Storable and re-checked, not `no-store`: the file may be cached, it must be asked about, and a 304 costs a round trip and no payload |

The third row is written out in `vercel.json` and **deliberately absent from `_headers`**, which
is the one surprise here. Cloudflare documents what happens when two `_headers` rules match one
path, and it is not what everybody assumes: "an incoming request which matches multiple rules'
URL patterns will inherit all rules' headers", and "if a header is applied twice in the
`_headers` file, the values are joined with a comma separator"
([Workers](https://developers.cloudflare.com/workers/static-assets/headers/),
[Pages](https://developers.cloudflare.com/pages/configuration/headers/)). So the obvious file — a
`/*` default plus a `/_next/static/*` exception — answers a hashed chunk with
`max-age=0, must-revalidate, public, max-age=31536000, immutable`, the first `max-age` wins, and
the immutable rule is inert while the word `immutable` sits in the file for any check that greps
for it. Every rule that file contains is therefore disjoint, and `check-headers.mjs` fails the
build if any path is ever matched by two of them. Vercel's `source` is a path-to-regexp pattern
and can express a complement, so there the document rule is stated outright.

What the documents get on a `_headers` host instead is that host's default, and both document
the same value this would have written: Cloudflare sends `public, max-age=0, must-revalidate`
on a static asset and says "headers defined in the `_headers` file override what Cloudflare
ordinarily sends"; Netlify's documented default for static assets is the identical string.
Enumerating the complement by hand instead comes to 45 rules that grow with every route added,
against a 100-rule limit this repository has already abandoned one design over.

**On GitHub Pages — the current host — none of it arrives**, for the same reason seven of the
nine security headers do not: Pages reads neither file. Documents and hashed assets alike come
back `max-age=600`, which is the host's default and not a decision of ours (measured; see
`docs/release-runbook.md`). What makes a repeat visit free there is the **service worker**, not
the CDN — `e2e/offline.spec.ts`, "the second play of a game costs no network request at all" —
and that needs no host configuration at all, which is why the offline story was built the way
it was. On any host that reads `_headers` or `vercel.json` the two compose: the worker answers
from the device, and whatever it does not hold comes back from the edge without a revalidation.
There is nothing to remember on those hosts and nothing to set by hand; the `sw.js` rule above
is in the file.

The failure has no symptom on our side. Every route answers 200, the artefact is correct, CI
is green, and a proportion of real people are on last week's build with no way to find out.
The check that sees it is in `docs/release-runbook.md` step 3, and it is a check on the
*revision inside the served `sw.js`* rather than on any status code.

`docs/pwa.md` is the design record: what is cached, under which strategy, what deliberately
is not, why the update waits rather than taking over, what is verified on which engines, and
how to clear a worker that is stuck.

The three config files are generated from two sources —
[`scripts/security-headers.mjs`](../scripts/security-headers.mjs) for the header set and
[`scripts/cache-headers.mjs`](../scripts/cache-headers.mjs) for the cache rules — by
`scripts/emit-host-config.mjs`, and checked by `scripts/check-headers.mjs` as part of
`pnpm build`. **Do not edit them in `out/` — they are overwritten on every build.** To
change a header, change the source; all three follow, and they cannot drift apart.

## Which of those headers a visitor actually receives

**Today: two of the nine.** The site deploys to GitHub Pages, which serves no custom
response headers at all — `_headers` is a Cloudflare Pages / Netlify file, `vercel.json` is
Vercel's, and Pages reads neither. So seven of the nine generated headers are written,
CI-checked and then discarded by the host.

That is not a bug in the generation. It is the host, and moving hosts fixes all of it in one
step. What matters is that it is written down somewhere a build can fail on rather than in a
comment: [`scripts/header-delivery.mjs`](../scripts/header-delivery.mjs) classifies every
generated header by **how it can be delivered**, and `check-headers.mjs` fails the build if a
header is added to the set without a classification. The table below is printed on every
build by `pnpm build`; this copy is here so it can be read without running one.

| Header | On GitHub Pages | Why |
|---|---|---|
| `Content-Security-Policy` | **Served**, in every page | `<meta http-equiv>`, hashed per page. Missing only `frame-ancestors` and `upgrade-insecure-requests`, which a meta policy cannot carry |
| `Referrer-Policy` | **Served**, in every page | `<meta name="referrer">`, built from the same value as the header |
| `Strict-Transport-Security` | Discarded | No meta equivalent. `*.github.io` is in the browsers' preload list, so the effect survives on this domain and would not on a custom one |
| `X-Content-Type-Options` | Discarded | No meta equivalent. MIME sniffing is unconstrained |
| `Permissions-Policy` | Discarded | No meta equivalent was ever implemented by any engine |
| `Cross-Origin-Opener-Policy` | Discarded | No meta equivalent. No `window.opener` severance, no cross-origin isolation |
| `Cross-Origin-Embedder-Policy` | Discarded | No meta equivalent |
| `Cross-Origin-Resource-Policy` | Discarded | No meta equivalent |
| `X-Frame-Options` | Discarded | No meta equivalent, and neither has CSP `frame-ancestors`. Partly mitigated by the frame guard — see below |

On Cloudflare Pages, Netlify or Vercel every row becomes "served". Nothing in the artefact
changes; only the host does.

### The frame guard, and what it is not

Because both framing controls are header-only, `apps/web/src/app/frame-guard.ts` ships an
inline script in every page: a framed document hides itself before it paints, so there is
nothing for an attacker's overlay to sit on and nothing for a victim to click.

It is a mitigation, not the header. It does nothing in an `<iframe sandbox>` without
`allow-scripts` — an iframe the attacker writes — and the page is still *loaded* either way.
It busts unconditionally because no embeddable route exists; when #2367 lands, the exemption
belongs here as a path allowlist, and the origin allowlist that issue actually needs is
`frame-ancestors`, which needs a host that serves headers.

### The content security policy travels in the pages

Each page carries its own `<meta http-equiv="Content-Security-Policy">` with a SHA-256 hash
of every inline script it contains. That is why the artefact is genuinely host-agnostic: the
strongest part of the policy needs **no host configuration at all**, so it is identical on a
provider with a rich header story and on a bucket with static hosting switched on.

`frame-ancestors` and `upgrade-insecure-requests` are left to the header files — the first
because a meta tag cannot express it, the second because in a page it broke every plain-HTTP
origin on WebKit. `X-Frame-Options: SAMEORIGIN` covers the first for browsers that ignore
`frame-ancestors`. **On the current host all three are discarded**, which is what the frame
guard above is for; see the table.

The reasoning, including the two approaches that failed on size first, is at the top of
[`scripts/emit-host-config.mjs`](../scripts/emit-host-config.mjs).

## What this project actually deploys to

**GitHub Pages**, via `actions/deploy-pages` in `.github/workflows/deploy.yml`. That matters
more than it looks, because **Pages serves no custom response headers at all**, so most of
the set generated above is written, CI-checked, and then discarded by the host.

What survives, and what does not:

| | on GitHub Pages |
|---|---|
| Content-Security-Policy | **served** — it travels in each page's `<meta http-equiv>` |
| HSTS | **served**, but by Pages itself on a `github.io` domain, not by us |
| `frame-ancestors` | **not served** — a meta tag cannot express it |
| COOP, COEP, CORP | **not served** |
| Permissions-Policy | **not served** |
| `X-Frame-Options`, `X-Content-Type-Options` | **not served** |

So `_headers` and `vercel.json` are real and correct and nobody reads them today. The
strongest half of the policy does apply, because it was deliberately built to need no host
configuration — but any threat model that assumes COOP, CORP or `frame-ancestors` is in
force is assuming something this deployment does not provide. Issue #2481 tracks the choice
between moving to a host that reads `_headers` — Cloudflare Pages and Netlify both do, both
free — and accepting the gap deliberately.

`scripts/check-headers.mjs` checks the *artefact*, not the origin. It cannot tell you a
header reached a browser; only `curl -sI` against the live origin can, which is why the
verification step below exists.

## Two hosts that would serve the whole set

### Cloudflare Pages

```bash
npx wrangler pages deploy apps/web/out --project-name duelbox
```

Or connect the repository and set: build command `pnpm build`, output directory
`apps/web/out`, Node 22. `_headers` is picked up automatically. Note that Cloudflare caps a
`_headers` file at 100 rules — ours has three: the security set on `/*` and the two cache
rules, which are disjoint from it and from each other because an overlap there is joined
rather than resolved. See the note in `emit-host-config.mjs` for the version that had 150
rules and why it was abandoned, and `cache-headers.mjs` for why the count did not go to 45.

**Cloudflare Workers static assets reads the same file**, which is what `wrangler.jsonc` in
the repository root deploys to, and has done since April 2025. Custom headers are not applied
to responses a Worker script generates — irrelevant here, because that config has no `main`
at all and every response is an asset response.

### Netlify

```bash
npx netlify-cli deploy --dir apps/web/out --prod
```

Or connect the repository with build command `pnpm build` and publish directory
`apps/web/out`. Netlify reads the same `_headers` file, unchanged.

### The others, for completeness

- **Vercel** — `npx vercel deploy --prebuilt` after pointing the output directory at
  `apps/web/out`, or connect the repo. Reads `vercel.json`.
- **GitHub Pages** — **this is the current host**, via `.github/workflows/deploy.yml`, which
  triggers on a successful `CI` run rather than on the push itself and checks out the exact
  SHA that CI tested (#2511). A `workflow_dispatch` bypasses that gate on purpose, so a
  rollback is not blocked by the state of the commit being rolled back to. Pages
  serves no custom headers at all, which is exactly the case the meta-tag policy exists for:
  the CSP and the referrer policy still apply, and HSTS is provided by the preloaded
  `github.io` parent domain rather than by us. The other seven headers are discarded; see the
  table above.
- **S3 + CloudFront, or any bucket** — upload the directory, set the index document to
  `index.html`, and paste the CloudFront response-headers policy from
  `security-headers.conf.txt`.
- **Your own server** — `security-headers.conf.txt` has an nginx `server`, an Apache
  `.htaccess`, and a Caddy block, all commented and all generated from the same source.

## Verifying a deploy

Point the e2e suite at it. The specs are written against the built artefact rather than a
dev server, so this is the same check CI runs, against the real origin:

```bash
PLAYWRIGHT_BASE_URL=https://your-deploy.example npx playwright test --project=chromium
```

Then verify what the host actually delivers. **Which check applies depends on the host, and
running the wrong one is how this went unnoticed for months** — the `curl -sI` below was in
this document, was never run against the real origin, and cannot pass there: GitHub Pages
sends none of those headers, so it would have printed nothing and failed, every time.

**On GitHub Pages — the current host.** There are no response headers to check. What must be
true is that the two things that survive a header-less host are in the markup, and that
`security.txt` is served:

```bash
curl -s https://your-deploy.example/ | grep -oE '<meta (http-equiv="Content-Security-Policy"|name="referrer")[^>]*>'
curl -s https://your-deploy.example/ | grep -c 'w.top===w.self'   # the frame guard: expect 1
curl -s https://your-deploy.example/.well-known/security.txt
```

And confirm what **cannot** be verified here, so nobody reads a green run as more than it is.
On this host `curl -sI` will show no HSTS, no `X-Content-Type-Options`, no
`Permissions-Policy`, no COOP/COEP/CORP and no `X-Frame-Options`, because the host does not
send them — that is expected, and it is the state the table above records. An external header
scanner will grade this origin accordingly, and no amount of work in this repository changes
that while the host is Pages. That is issue #2481.

**On Cloudflare Pages, Netlify or Vercel.** Now the headers are real and the original check is
the right one:

```bash
curl -sI https://your-deploy.example/ | grep -iE 'strict-transport|content-type-options|referrer|permissions|cross-origin|frame-options|content-security'
curl -s https://your-deploy.example/.well-known/security.txt
```

Expect all nine. A missing one means the host ignored the config file, which is the failure
this is guarding against. Then update `DEPLOY_TARGET` in `scripts/header-delivery.mjs` — the
build check reads `deploy.yml` and will go red until you do, which is deliberate: the
served-versus-discarded table must never describe a host the site has left.

## What must stay true

- **No application code may reference a provider.** No `@vercel/*`, no `@netlify/*`, no
  edge-runtime imports, no `process.env` read at request time — there is no request time.
  `scripts/check-zero-cost.mjs` fails the build on anything that would put gameplay behind
  a round trip.
- **Host configuration stays in one small replaceable file per host**, generated, never
  hand-edited.
- **The same artefact goes to every host.** Nothing is rebuilt per provider. If a host needs
  something the artefact does not have, that is a reason to reconsider the host.
