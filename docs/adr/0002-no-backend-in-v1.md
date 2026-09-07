# ADR 0002 — No backend in v1: static, accountless, offline-capable

**Status:** accepted
**Date:** 2026-08-29

## Context

ADR 0001 decided where the site is hosted and what serving it costs. It did not decide
what the product _is_, and the backlog has been groomed on the assumption of a different
answer.

About sixty open issues describe a system with a database, a room server, accounts,
sessions, leaderboards, telemetry, an on-call rotation and a rehearsed disaster-recovery
drill. Read on their own each is sensible. Read against this repository they describe
something that does not exist and, on the constitution as written, is not planned:

- `apps/web/next.config.ts` sets `output: 'export'`. There is no server runtime, no API
  route, no middleware, no `revalidate`, no edge function.
- `scripts/check-zero-cost.mjs` runs inside `pnpm build` and fails the build if a route
  opts into request-time rendering, if `output: 'export'` disappears from
  `next.config.ts`, or if any gameplay module reaches the network.
- There is no `fetch`, `XMLHttpRequest`, `WebSocket`, `RTCPeerConnection` or
  `sendBeacon` anywhere under `packages/**` or `apps/web/src/**`.
- No workspace package depends on a server library. No express, no ws, no socket.io, no
  ORM, no database driver, no auth library, no error-reporting SDK.
- The single persistent store in the product is `globalThis.localStorage`, read and
  written in one file: `apps/web/src/lib/last-mode.ts`.

CLAUDE.md's first paragraph has said this since the repository was created — "two people
on one device in one tab… No accounts. Offline-capable." `docs/threat-model.md` already
reasons from it, and names what the shape removes. What has never existed is a decision
record, so nothing stopped the backlog being written for a different product, and nothing
told a reader which of those issues to act on.

This repository's recorded failure mode is a rule written down that nothing enforces. This
is the mirror image: an architecture that is enforced by three scripts and a build, and
written down nowhere.

## Decision

**Version 1 has no backend. The browser is the whole product; the origin only serves
files.**

Four properties, each a claim about what v1 is rather than a preference about what would
be nice:

1. **No server we operate.** No origin compute, no API, no room server, no queue, no
   scheduled job. Enforced by `check-zero-cost.mjs` inside `pnpm build`.
2. **No accounts.** No sign-in, no session, no token, no cookie that carries identity.
   Nothing is gated, because there is nothing to gate behind.
3. **No database.** Everything a player accumulates lives on the device that made it, in
   `localStorage`, under a versioned schema validated on read.
4. **Offline-capable.** After the first load a match needs nothing from us. Proved by
   `e2e/offline.spec.ts`, which aborts every request after load and plays a bot match
   through to a scored result.

One caveat on that enforcement, recorded here because a guard believed to be wider than it
is has cost this repository six times. `checkNoServerRuntime` and `checkNoDynamicRoutes`
cover properties 1 and 2 completely. `checkNoNetworkInGameplay` does not cover property 4:
it walks `packages/engine/src`, `packages/game-sdk/src` and `packages/games` only, filters
on `extname(p) === '.ts'` so no `.tsx` file anywhere is read, and its pattern list has no
`RTCPeerConnection`. A `fetch` in a React component, or a peer connection in any game,
passes the build today. `e2e/offline.spec.ts` is the check that actually holds the line,
and it holds it for two games. Widening the static guard is cheap and should happen before
trigger 1 below, not after.

What follows for the backlog is the part worth writing down. The whole class of
infrastructure work — capacity modelling, indexing and read replicas, connection pooling,
edge rate limiting, distributed tracing, SLOs and error budgets, on-call rotas, backup and
restore, staged rollout with automatic rollback, room-server load testing — is **not
applicable**, not deferred. There is no tier to saturate, no primary to protect, no
records to lose, no deploy that can end a live match.

## What this decision does not excuse

The dangerous half of a decision like this is the sentence "we have no server, so the
security work does not apply." That sentence is false, and it is worth naming exactly
where, because every one of these has a server-sounding title and a client-side body.

- **Untrusted data read back from local storage.** `last-mode.ts` is written correctly —
  it validates rather than trusts, field by field, and falls back to defaults on anything
  unrecognised — but it builds its result on a plain `{}` and assigns keys taken straight
  from `Object.entries` of a `JSON.parse` result. A `__proto__` key survives `JSON.parse`
  as an own property, so that assignment writes a prototype rather than a value. Nothing
  exploitable follows from it today; it is precisely the pattern CWE-1321 names, in the
  one storage path we have, in the file the threat model cites as the good example.
- **Algorithmic complexity on player-supplied text.** `sanitisePlayerName` bounds length
  to 16 characters _after_ six full-string regex passes, an `NFC` normalisation and two
  array spreads. The patterns themselves are linear character classes, so this is not
  ReDoS — it is CWE-400, and it is the half of that issue that applies to a client.
- **The framing surface.** Any page can frame any route here today. `frame-guard.ts`
  mitigates clickjacking; it cannot express an origin allowlist, because that needs a
  header (see below).
- **Client-submitted scores.** There is no leaderboard, so nothing is submitted anywhere.
  But the moment tournaments persist a result to `localStorage`, the local store _is_ the
  scoreboard, and a number read back from it is a claim rather than a fact. The rule
  survives the absence of a server; only the re-simulation half of it needs one.
- **A second deserialisation path already exists.** `importTrace` in
  `packages/engine/src/record.ts` parses a replay trace and hand-validates every field. It
  is unreachable from any UI today — `TracePanel` only exports — but it is the shape a
  peer message will take, and it is where the rule in `docs/threat-model.md` gets tested.
- **The supply chain.** A compromised transitive dependency is the most realistic route to
  serving malware from our origin, and it requires no server and no mistake of ours.

A static site has a smaller attack surface than a service. It does not have an empty one.

## Hosting is a different axis, and a different answer

One category must not be folded into this ADR: work that is applicable, correct, and
blocked by the deployment target rather than by the architecture.

The full security header set is generated by `scripts/security-headers.mjs`, rendered to
`_headers`, `vercel.json` and a server block by `scripts/emit-host-config.mjs`, and
verified against the emitted artefact by `scripts/check-headers.mjs`. It is then discarded
in its entirety, because the site deploys to GitHub Pages and GitHub Pages serves no
custom response headers at all. That is #2481.

Nothing in this ADR bears on it. A static export is byte-identical on Cloudflare Pages,
Netlify or Vercel — ADR 0001 chose Cloudflare Pages and the deploy went elsewhere — so the
fix is a deployment change, not an architectural one, and it also unblocks per-PR preview
URLs and everything that needs a URL to scan. Closing those issues as "not applicable, we
have no server" would be wrong twice over: they are applicable, and what blocks them is a
host.

## What this decision costs

Stated plainly, because a decision recorded without its price is an excuse.

- **No leaderboards.** Not daily, weekly or all-time. The reason to play a solo game a
  second time has to come from somewhere else.
- **No cross-device play at all.** Not one game. Two people must share a device, which
  makes rule 9's negotiated shared viewport, the precision envelope, and the
  presentation abstraction all correct-but-unexercised, and leaves a large tranche of
  per-game "wire up remote play" issues unbuildable rather than merely unbuilt.
- **No server-side score validation.** Re-simulating a submitted trace is the only
  defence that actually works against a fabricated score, and it needs compute we do not
  have. The determinism and seeded RNG that would make it possible are already in place;
  the place to run them is not.
- **No telemetry of any kind.** No funnel, no per-game abandonment, no field Core Web
  Vitals, no error tracking with source maps, no feature flags, no per-game kill switch.
  This project's best habit is _measure the thing you are about to argue about_ — and
  under this decision that habit applies to bots and never to players. Every question
  about what real people do here is unanswerable, and a game that is broken on one
  browser stays broken until someone deploys.
- **No portability without an account.** A pair who change phone lose their history,
  unless export/import is built locally.
- **No moderation surface** — which is also, exactly, why there is nothing to moderate.
- **No preview deployments**, so DAST and Lighthouse CI have nothing to point at.

Two of those — no leaderboard and no remote play — are large enough that a reasonable
person could decide the other way. This ADR records that we have not, yet.

## What would revisit it

Four triggers, named so the decision is reopened deliberately rather than eroded.

1. **Peer-to-peer cross-device play ships (#2449, #1872).** This is the likeliest, and it
   is desirable: the match itself stays browser-to-browser, so the cost model of ADR 0001
   survives. But signalling is origin compute (#2450), and the day it exists, room and
   signalling abuse hardening, rate limiting on that one function, and observability for
   that one component all become live and applicable.
2. **Anything is stored off the device.** Leaderboards, accounts, or cross-device sync.
   This is the trigger that brings back the whole database class — schema, indexing,
   backup, restore, retention — plus authentication, sessions, and treating every
   submission as untrusted. It should not be crossed by accident, one feature at a time.
3. **A TURN relay is deployed.** Metered by the gigabyte, and the single most plausible
   route to an unaffordable invoice. Needs its own policy decision first.
4. **Money changes hands.** Purchases imply accounts, which imply everything in 2.

Each of those is a new ADR superseding the relevant clause here, not a pull request.

## Consequences

- The infrastructure issues are closeable **as not applicable under this ADR**, not as
  done. The distinction matters: nothing was built, and the record should say so. A future
  reader who crosses trigger 2 needs to find them, which is why the trigger list above is
  specific about which class returns with which trigger.
- The security backlog splits three ways rather than two: applicable to a static client,
  not applicable without a server, and blocked on the host. Sorting them by title puts
  several in the wrong bucket, so they have to be read.
- `docs/threat-model.md` and this ADR now say the same thing from two directions — the
  threat model lists what the architecture removes, this records why the architecture is
  that shape. If one changes, both must.
- ADR 0001 stands unchanged in substance and is wrong in one detail this ADR does not fix:
  it chose Cloudflare Pages, and `deploy.yml` deploys to GitHub Pages — the option ADR 0001
  rejected, partly because it serves no custom headers and partly for a 100 GB/month soft
  limit its own egress table says a million cold sessions would exceed. That gap is #2481's
  to close, and it should be closed by moving the deploy rather than by amending the ADR.
- The reversal risk is that this ADR is read as a permanent product position rather than a
  v1 scope decision. It is not. Nothing here says leaderboards or remote play are bad
  ideas; it says they are not in v1, and that the work behind them starts with a decision
  and not with an issue.
