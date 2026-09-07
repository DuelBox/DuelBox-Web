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
| `_headers` | Netlify and Cloudflare Pages read this |
| `vercel.json` | Vercel reads this |
| `security-headers.conf.txt` | nginx, Apache and Caddy blocks, commented, for anyone serving it themselves |
| `security.txt`, `.well-known/security.txt` | RFC 9116, both locations |
| `sw.js` | The service worker, with its precache list and revision injected by `scripts/emit-service-worker.mjs`. **Do not edit it in `out/` — it is overwritten on every build**; the source is `apps/web/public/sw.js` |
| `manifest.webmanifest`, `icons/` | The web app manifest and its five icons |

A host needs to do nothing for the offline story to work: the worker is a file like any
other, its scope is the site root, and everything it needs travels in the export. Two host
behaviours are worth knowing about anyway. A host that served `sw.js` with a long
`cache-control` would slow down how fast a deploy reaches returning visitors — browsers cap
the worker script's own cache at 24 hours, so it is bounded rather than broken, and GitHub
Pages' `max-age=600` is well inside that. And a service worker requires a secure context, so
the site must be on HTTPS or `localhost`; every host in this document is, and the e2e suite
runs on `127.0.0.1`, which counts.

`docs/pwa.md` is the design record: what is cached, what deliberately is not, and how a
stale worker is prevented from becoming permanent.

The three config files are generated from one source,
[`scripts/security-headers.mjs`](../scripts/security-headers.mjs), by
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

## Two hosts, one artefact

### Cloudflare Pages

```bash
npx wrangler pages deploy apps/web/out --project-name duelbox
```

Or connect the repository and set: build command `pnpm build`, output directory
`apps/web/out`, Node 22. `_headers` is picked up automatically. Note that Cloudflare caps a
`_headers` file at 100 rules — ours has one, deliberately; see the note in
`emit-host-config.mjs` for the version that had 150 and why it was abandoned.

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
