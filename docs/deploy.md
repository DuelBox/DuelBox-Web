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

The three config files are generated from one source,
[`scripts/security-headers.mjs`](../scripts/security-headers.mjs), by
`scripts/emit-host-config.mjs`, and checked by `scripts/check-headers.mjs` as part of
`pnpm build`. **Do not edit them in `out/` — they are overwritten on every build.** To
change a header, change the source; all three follow, and they cannot drift apart.

### The content security policy travels in the pages

Each page carries its own `<meta http-equiv="Content-Security-Policy">` with a SHA-256 hash
of every inline script it contains. That is why the artefact is genuinely host-agnostic: the
strongest part of the policy needs **no host configuration at all**, so it is identical on a
provider with a rich header story and on a bucket with static hosting switched on.

Only `frame-ancestors` is left to the header files, because a meta tag cannot express it —
`X-Frame-Options: SAMEORIGIN` covers the same ground for browsers that ignore it.

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

Then confirm the headers actually arrived — a host that silently ignores a config file is
the failure this is guarding against:

```bash
curl -sI https://your-deploy.example/ | grep -iE 'strict-transport|content-type-options|referrer|permissions|cross-origin|frame-options|content-security'
curl -s https://your-deploy.example/.well-known/security.txt
```

## What must stay true

- **No application code may reference a provider.** No `@vercel/*`, no `@netlify/*`, no
  edge-runtime imports, no `process.env` read at request time — there is no request time.
  `scripts/check-zero-cost.mjs` fails the build on anything that would put gameplay behind
  a round trip.
- **Host configuration stays in one small replaceable file per host**, generated, never
  hand-edited.
- **The same artefact goes to every host.** Nothing is rebuilt per provider. If a host needs
  something the artefact does not have, that is a reason to reconsider the host.
