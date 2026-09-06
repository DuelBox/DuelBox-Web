# ADR 0002 — Next.js App Router with `output: 'export'`, over a Vite SPA or Astro

**Status:** accepted
**Date:** 2026-09-06

## Context

The site is a catalogue of 107 games and a play route for each. Two constraints pulled in
opposite directions when the framework was chosen.

The first is discovery. `PLAN.md` (Stack table) puts it in one line: "A client-rendered
games portal earns no organic traffic; SSG/SSR is the whole discovery strategy." Every
game needs a page that a crawler can read without executing JavaScript, and there are 107
of them plus the catalogue index — `scripts/check-zero-cost.mjs` counts 108 pre-rendered
`index.html` files under `out/games/` and fails the build if any are missing.

The second is cost. ADR 0001 decided that the origin only ever serves files; a framework
that needs a server at request time was ruled out before this decision was made. Whatever
was chosen had to produce a plain directory.

Three candidates were weighed against those two constraints:

- **A Vite single-page app.** The smallest runtime and the simplest build, but it produces
  one HTML file. Every game page would be rendered on the client, which is exactly the
  portal `PLAN.md` says earns no traffic. Pre-rendering could be bolted on, but then the
  project would be maintaining its own static-site generator.
- **Astro.** Static by default and cheap on the wire, and a real contender. It lost on the
  play route: the game host is a stateful client component (`apps/web/src/components/GameHost.tsx`
  owns the canvas, the loop and the input manager through React refs and effects), and
  the HUD, options and result overlay around it — `MatchHud.tsx`, `MatchOptions.tsx`,
  `MatchOverlay.tsx`, `PlaySurface.tsx` — are client components sharing that state. Astro
  islands would have put the framework boundary through the middle of the shell.
- **Next.js 15 App Router with `output: 'export'`.** Server components render the catalogue
  at build time; client components own the play surface; `generateStaticParams` in
  `apps/web/src/app/play/[slug]/page.tsx` turns the registry into 107 static routes. The
  build is a directory.

## Decision

**The site is a Next.js 15 App Router application built with `output: 'export'`. Server
components exist only at build time; there is no server at run time.**

`apps/web/next.config.ts` sets four things, each for a stated reason:

- `output: 'export'` — the build is files any static host will serve, and a route that needs
  request-time rendering fails the build rather than adding a per-request cost.
- `basePath` from `NEXT_PUBLIC_BASE_PATH` — a GitHub Pages project page serves at `/<repo>/`,
  so every asset URL needs the prefix or the page loads and none of its JavaScript does.
  Defaults to empty so `pnpm dev`, the e2e suite and root-served hosts are unchanged.
- `distDir` from `NEXT_DIST_DIR` — `next build` and `next dev` share `.next` by default, and a
  build run beside a dev server deletes the manifests it is serving from.
- `trailingSlash: true` — directory-style hosts (GitHub Pages, a plain bucket) resolve
  `/games/chess/` to `/games/chess/index.html`; without it they 404.

The decision is enforced rather than remembered. `scripts/check-zero-cost.mjs` runs inside
`pnpm build` and refuses: an `out/api` directory or an `out/_next/server` bundle; any
source setting `dynamic = 'force-dynamic'`, `revalidate = 0` or `runtime = 'edge'`;
`next.config.ts` losing `output: 'export'` (comments are stripped first, so the setting
cannot survive only in the prose); any engine, SDK or game module calling `fetch`,
`XMLHttpRequest`, `WebSocket`, `sendBeacon` or `EventSource`, or importing a network
client; a play session over 700 kB of scripts; and fewer than 108 pre-rendered game pages.

The framework is kept out of the games. `apps/web/src/data/registry.ts` maps every game
to a dynamic `import('@duelbox/game-<id>')`, so opening one game never downloads another.
`scripts/check-size.mjs` classifies every emitted chunk from the build's own manifests
into shell, on-demand and one-chunk-per-game, and fails on a game with no chunk of its own
or on any chunk it cannot place. The catalogue itself is read by server components and
baked into the HTML; `apps/web/src/data/game-names.generated.ts` is the only catalogue data
the client bundle carries — the slug-to-name map, nothing else.

## Consequences

- No request-time rendering, anywhere. A leaderboard, an account or a saved profile is a
  new ADR, not a route.
- React never enters a game loop. `packages/game-sdk/src/contract.ts` defines a game as
  `init`, `update`, `render`, `getScore` and `destroy` with no framework imports, and
  `eslint.config.js` scopes the React hook rules to `apps/web` because it is the only
  React in the repository. The host creates the `FixedLoop` and `Canvas2DRenderer` inside
  a `useEffect` and hands them a plain object.
- Every page must be statically exportable, so nothing reads `window`, `document`,
  `localStorage` or `navigator` during render. The first paint shows defaults and a stored
  value replaces them in an effect, one frame later.
- The size budget in `size-budget.json` is measured against this layout: 151,552 gzipped
  bytes for the shell every visitor pays, 37,888 for what a player pulls on choosing a
  game, and 12,288 for any one game's chunk. Raising a number is a decision, and the
  commit has to say why.
- Next.js emits a pages-router surface this export never loads — `scripts/check-size.mjs`
  measured 94.8 kB of it — and it is excluded from every budget because no visitor fetches
  it. That is dead weight on disk, not on the wire, and it is the tax this framework charges
  over Astro.
- `basePath` means an asset URL is never written by hand; anything that builds one must go
  through Next's helpers or the page loads without its JavaScript on a project-page host.
- This decision should be revisited if the App Router's static export ever stops
  supporting a feature the shell needs, or if the pages-router surplus begins to be fetched.
