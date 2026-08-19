# ADR 0001 — Static-first hosting, and the cost model that follows

**Status:** accepted
**Date:** 2026-08-20

## Context

A games site that needs a server per match cannot be run on a small budget. The target is
five million users, and the difference between an origin that computes and an origin that
serves files is the difference between a bill that scales with popularity and one that
does not.

## Decision

**The browser does the computing. The origin only ever serves files.**

Simulation, bots, physics and scoring all run on the player's device. The site is
`output: 'export'` — a directory of static files with no server runtime. A route that
needs request-time rendering fails the build rather than quietly adding a per-request
cost.

This is structural rather than a preference, and it is enforced:
`scripts/check-zero-cost.mjs` runs inside `pnpm build` and fails on a dynamic route, on
the edge runtime, on `output: 'export'` disappearing, or on any gameplay module reaching
the network.

## The cost model

Measured against the real build, not estimated. Gzipped, because that is what crosses the
wire.

| | Raw | Gzipped |
|---|---|---|
| First session (11 files: HTML, CSS, shared chunks, one game chunk) | 616 kB | **182 kB** |
| Repeat session (HTML only; every asset is content-hashed and immutable) | 13 kB | **3 kB** |
| Whole site, all 263 files | 5.7 MB | 1.2 MB |

Egress at scale, assuming every session is a first session — the pessimistic case, since
in practice most are repeats:

| First-time sessions | Egress |
|---|---|
| 10,000 | 1.7 GB |
| 100,000 | 17.4 GB |
| 1,000,000 | 174 GB |

**One million cold sessions is about 174 GB.** Cloudflare Pages bills nothing for
bandwidth; Netlify's free tier is 100 GB/month and its paid tier is $19/month for 1 TB;
GitHub Pages has a 100 GB/month soft limit. So a million first-time players a month is
free on one host, roughly $19 on another, and over the limit on a third.

The repeat-session figure is the more important one. At 3 kB, a returning player costs
essentially nothing, and a player who plays fifty matches in a sitting costs **zero** — a
match after the first needs no request at all.

## The host

**Cloudflare Pages**, with these alternatives considered:

- **Cloudflare Pages** — unlimited bandwidth on the free tier, global CDN, no per-request
  billing. The bandwidth position is the deciding factor: it removes the only variable
  that scales with success.
- **Netlify** — excellent developer experience, but 100 GB/month free and metered above
  it. That is a bill that grows with popularity, which is the thing this decision exists
  to avoid.
- **GitHub Pages** — free and already where the source lives, but the 100 GB/month soft
  limit is enforced by a human writing to you, and it does not support custom headers,
  which a strict CSP (#2374) needs.
- **Vercel** — the natural home for a Next app, but the free tier forbids commercial use
  and the pricing model assumes server-side rendering we deliberately do not use.

The build output is a plain directory, so this decision is cheap to reverse. Nothing in
the codebase names the host.

## The rule, plainly

**Local play — one device, or one player against a bot — must cost zero requests after
the first load.**

Verified in two ways. `e2e/offline.spec.ts` aborts every request after load and plays a
full bot match through, so the match provably needs nothing. And every asset is
content-hashed and immutable, so a repeat visit re-fetches only the 3 kB HTML.

*Caveat, stated because it is currently true:* the page also fetches three typefaces from
Google's CDN on a cold load, and the Next router prefetches route payloads for links in
the viewport. Neither is gameplay, both are cached, but neither is literally zero. #187
covers self-hosting the fonts, which would also remove a third-party dependency from the
critical path.

## The only things that can ever cost money

Three, each with a cap and a stated behaviour at the cap.

| Thing | Why it costs | Cap | At the cap |
|---|---|---|---|
| **Signalling** for peer-to-peer matchmaking | A brief server-side handshake; the match itself is peer-to-peer and never touches us | Free-tier serverless function, hard request limit (#2450) | Remote play unavailable; local play and bot play unaffected |
| **TURN relay** for peers behind symmetric NAT | Media relay is metered by the GB | Not deployed. Matches that cannot connect directly fail to connect | The pair is told to play locally instead |
| **Error reporting** | Per-event billing | Free-tier only, sampled, no PII (#2454) | Reporting stops; the site does not |

The rule for all three: **everything degrades to local play when a paid dependency is
unavailable.** A player must never see a broken site because a free tier ran out.

## Consequences

- No leaderboard, no accounts, no saved profiles without revisiting this decision. Each
  needs a database, which needs a server, which is a per-request bill.
- Cross-device play must be peer-to-peer. A relayed architecture would be simpler and is
  ruled out by this decision.
- The catalogue can grow to 107 games and beyond without changing the cost curve, because
  each game is a separate chunk downloaded only by players who open it.
- SEO benefits are a side effect rather than the reason: 107 static pages are indexable in
  a way a client-rendered catalogue is not.
