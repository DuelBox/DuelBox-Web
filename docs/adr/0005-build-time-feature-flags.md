# ADR 0005 — Feature flags are constants in the build, and a game is switched off by a list in the source

**Status:** accepted
**Date:** 2026-09-08

## Context

Issue #208 asks for a feature flag system with a per-game kill switch, and states the
acceptance as **"a broken game can be disabled without a deploy"**. That clause is the whole
of the decision, because on this product it describes something that has no implementation
rather than an expensive one.

Three facts, each checkable in the tree, decide it together:

1. **The origin serves files and computes nothing.** ADR 0001, enforced by
   `scripts/check-zero-cost.mjs`, which fails the build on a dynamic route, on the edge
   runtime, or on `output: 'export'` disappearing from `next.config.ts`.
2. **A page may only talk to its own origin.** `scripts/security-headers.mjs` sets
   `connect-src 'self'`, and `docs/deploy.md` explains that the policy travels in each
   page's own `<meta http-equiv>` precisely so that it needs no host configuration. So the
   CSP is not a header we can relax at the edge; it is in the artefact.
3. **Putting a byte on that origin is a deploy.** `.github/workflows/deploy.yml` builds the
   export and uploads it to GitHub Pages. There is no other write path.

Put together: the only document a running page is allowed to fetch is a document a deploy
put there. "Change a flag without a deploy" is not a trade-off on this site, it is a
contradiction — and the two ways out of it are both worse than the thing they avoid.

### What the guards do and do not refuse

Worth stating exactly, because the obvious assumption is wrong.
`check-zero-cost.mjs`'s network check walks `packages/engine/src`, `packages/game-sdk/src`
and `packages/games` only. **A `fetch()` in `apps/web/src` passes it.** `e2e/offline.spec.ts`
does not catch one either: it blocks requests *after* load and then plays a match, so a flag
fetched during load has already arrived. A runtime flag file could therefore be added to this
repository and go green through the whole gate. Nothing mechanical is standing in its way,
which is the reason this record exists.

### What a deploy actually costs

The kill path is `deploy.yml`, which triggers on a push to `main`, has no `needs` on the CI
workflow, and runs no tests: checkout, install, `pnpm build`, upload, publish. No number for
it is recorded in this tree; the number that is recorded is in `ci.yml`, where the `verify`
job — `format:check`, `typecheck`, `lint`, the 2,666-test unit suite **and** `pnpm build` —
took 216 s on a runner. The deploy does strictly less than that. Minutes, and no review and
no gate stand in front of it.

Against that, what a runtime flag file would buy on this host: **nothing measured in
minutes**. GitHub Pages serves no response headers of ours at all — `docs/deploy.md` has the
table — so the freshness of any file published here is the host's decision, not ours.
GitHub's documented Pages cache is ten minutes (documented, not measured here). A flag file
fetched from this origin would therefore go stale for about as long as the deploy it was
meant to replace, and we would have no way to shorten it.

## Decision

**A flag on this site is a constant compiled into the artefact. The per-game kill switch is
`DISABLED_GAMES` in `apps/web/src/lib/flags.ts`, applied once in `apps/web/src/data/registry.ts`,
and switching a game off is a one-line edit and a push to `main`.**

Four options were considered.

**A runtime flag file on this origin.** Rejected: the file would live in the export, so
editing it is the same deploy — a request on every page load in exchange for nothing.

**A runtime flag file on a third-party origin** — a gist, a worker, a KV store. Rejected on
four counts. The page's own CSP forbids it, and widening `connect-src` is itself a deploy.
It would be a fourth row in ADR 0001's table of things that can cost money, with a cap and a
behaviour at the cap, for a feature used approximately never. It inverts the failure story
that ADR 0001 states as a rule — *everything degrades to local play when a paid dependency
is unavailable* — because a kill switch that fails open is not a kill switch and one that
fails closed takes the catalogue down when a third party has a bad afternoon. And it would
be expensive in the one currency this repository actually rations: the catalogue is
server-rendered at build time, so honouring a flag read at runtime means shipping JavaScript
to **every non-play route** to un-render what the HTML already says, against a shell budget
with about 1,650 bytes spare for a whole batch.

**A build-time flag read from an environment variable**, set on a `workflow_dispatch` input,
so a kill needs no commit. Rejected, and it is the closest call: it genuinely removes the
edit, and the deploy is the same length either way, so it buys seconds. What it costs is
that the artefact stops being reproducible from the commit it names, and a reader of the
tree cannot tell why a game is missing from the site. `NEXT_PUBLIC_BASE_PATH` and
`NEXT_PUBLIC_SITE_URL` are read at build time already, and both are properties of *where*
the site is published; what the site *contains* should be in the source.

**A list in the source.** Taken. `DISABLED_GAMES` names the game, the sentence a player is
shown, and the issue that will end the switch.

### How it is applied

One filter, in one place. `data/registry.ts` derives `AVAILABLE` from `LOADERS` by asking
`killSwitchFor`, and everything a player can reach is derived from `AVAILABLE`: the play
route's `generateStaticParams`, the sitemap's play entries, the catalogue card's Play badge,
Surprise me, and the "play something else" list at the end of a match. A second notion of
"playable" beside the first would be a thing that drifts, and a game switched off in one and
on in the other is worse than a game nobody switched off.

The three things a switch changes, from the player's side:

- **No play route.** `PLAYABLE` no longer names it, so `out/play/<slug>/` is never written
  and the host answers with `not-found.tsx`. `app/play/[slug]/page.tsx` therefore has no
  branch for a switched-off game: it would be code no build could reach, and `CLAUDE.md`
  keeps a tally of guards that could not run.
- **No offer anywhere.** Every card, badge and shuffle reads the registry, so the game is
  never presented as something to start.
- **Its own page stays and says why.** `app/games/[slug]/page.tsx` shows "*X* is switched off
  at the moment", the reason, and no way in — not "still being built", which would be a lie
  about a game that was built, and not a 404, which would tell a reader and a crawler that a
  game this site has does not exist. The page also withholds the three mode cards, because
  "Play together here" a line above "switched off" is a page contradicting itself.

The game stays in the catalogue grid, marked unplayable, rather than vanishing from it. That
is deliberate: `scripts/check-zero-cost.mjs` requires one exported page per catalogue entry,
so removing the card would leave that page reachable from nothing — and an orphaned page is
the defect the category hubs of #200 were written to remove.

### What enforces it

- `apps/web/src/lib/flags.test.ts` — the registry with a switch really set, through the real
  matching function: gone from `PLAYABLE`, unplayable under both of the game's names,
  `loadGame` rejecting, and a control game beside it that stays playable. Watched failing:
  with the one-line filter removed from `registry.ts`, three of its four wiring assertions
  fail with `expected [ Array(108) ] to not include 'ball-games'`.
- `e2e/kill-switch.spec.ts` — the same question of the built site, which is the only place
  the step from "`PLAYABLE` excludes it" to "no HTML was written" can be answered. Driven
  from `DISABLED_GAMES`, with a positive control so an empty list cannot make it vacuous.
- One more, found by breaking it: `scripts/register-game.mjs` locates the end of the loader
  table in `registry.ts` by searching for a literal, and the kill switch was first written
  into precisely that gap, so the scaffold could no longer add a game. The filter moved
  below `LOADERS_FOR_TEST`, and `flags.test.ts` now reads the marker out of the script and
  asserts `registry.ts` still contains it, because the alternative repair was a comment and a
  comment is the thing this repository has learned not to trust on its own.

## What #208 asked for, and what this is not

This decision does not meet #208's acceptance criterion, and the issue should be closed
saying so rather than reported as done. Three of its lines, checked against what landed:

- **"A game can be hidden from the catalog within minutes and without a deploy."** Not met.
  A kill is an edit to `apps/web/src/lib/flags.ts`, a push to `main`, and `deploy.yml`. The
  whole of the Context above argues that "without a deploy" has no implementation on this
  origin rather than an expensive one — which may well be the right answer, and is still not
  the criterion. If the hosting model ever changes, this ADR is what to reopen.
- **"Client-evaluable flags with no flash of wrong content."** Not met, and nothing is
  evaluated client-side at all. The catalogue is server-rendered at build time, so there is
  no flash to avoid — and buying one would mean shipping JavaScript to every non-play route
  to un-render what the HTML already says.
- **"Hidden from the catalog"**, the other half of that same acceptance line. Not met as
  written, deliberately: the card stays in the grid, marked unplayable, because
  `scripts/check-zero-cost.mjs` requires one exported page per catalogue entry and a card
  removed from the grid leaves that page reachable from nothing. What a switch removes is
  the play route and every offer to start a match.

What was built is a per-game kill switch that takes minutes and one commit. That is worth
having; it is not what the acceptance line says.

## Consequences

- A kill takes minutes and needs no review, and it also takes a commit that is visible in
  the history. Both halves are intended.
- **A tournament in progress can name a game that has just been switched off**, and it is a
  fourth surface a switch changes rather than a fifth thing the list above forgot. The
  line-up is drawn once from `PLAYABLE` and then persisted, so a pair three legs into seven
  can come back to a build that no longer exports the route their next leg names — and a leg
  is only reportable from that route, so before this was handled the tournament could not
  advance and leaving it was the only way out. `lib/tournament-store.ts` now takes the
  playable list from its caller and drops the unplayed legs that are no longer in it; legs
  already played stay, because results are positional and dropping one would re-label every
  leg after it. A tournament whose whole remainder has gone resumes as a finished one.
- **A kill turns the unit suite red, and the red is telling the truth.** Measured, by
  switching `carrom` off and running `npx vitest run apps/web/src`: six assertions in four
  files fail — `data/routing.test.ts` ("cover exactly the games that have a build", "is
  playable whenever its package is in the registry", "loads"), `data/controls.test.ts`
  ("names no game that is not playable"), `data/catalogue-manifest.test.ts`, and
  `lib/landing.test.ts` ("promises a mode only where every game in the catalogue has it").
  Every one of them asserts that the site offers every game it has a build for, which is
  exactly what a switch makes untrue. None of them blocks the kill, because `deploy.yml`
  runs no tests. Teaching those six to subtract `DISABLED_GAMES` is a one-line change each
  and is the obvious follow-up; it was left undone here because those files belong to other
  work in flight.
- Two of those six — `catalogue-manifest.test.ts` and routing's "loads" — could be bought
  off by letting `loadGame` still load a switched-off game. That is refused: a stale tab
  calling `loadGame` is the last place a broken match can start, and a tidier test run is
  not worth the one guarantee that closes it.
- `LOADERS_FOR_TEST` deliberately keeps naming **every** game with a build, so the balance,
  fuzz, control-parity and cross-viewport suites keep playing a switched-off game. A game
  switched off because it is broken is the game whose tests most need to run, and a switch
  that silenced them would hide the repair it exists to buy time for.
- Killing one of the five games `e2e/smoke.spec.ts` names by hand — `chess`, `sudoku`,
  `solitaire`, `guess-who`, `ball-games` — fails that spec, which asserts each of them offers
  a way to play. Killing a game an e2e spec drives fails `data/e2e-slugs.test.ts` as well.
- Killing `tic-tac-toe` specifically breaks the build: `check-zero-cost.mjs` measures the
  session budget by reading `out/play/tic-tac-toe/index.html`, which would no longer exist.
  A kill of that one game needs that line changed in the same commit.
- A switched-off game's chunk is still built and shipped, unreferenced by any page. It costs
  no budget — nothing loads it — and keeping the loader in place is what keeps the tests
  above running.
- The runbook is below rather than in a doc of its own, because a runbook nobody can find
  during an incident is a runbook nobody has.

## Runbook: switching a game off

1. Add one entry to `DISABLED_GAMES` in `apps/web/src/lib/flags.ts`. The slug is the word in
   the URL of the bug report; the package id is accepted too.

   ```ts
   export const DISABLED_GAMES: readonly GameKillSwitch[] = [
     { slug: 'carrom', reason: 'A match can end with both seats shown as the winner.', issue: '#1234' },
   ];
   ```

2. Push to `main`. `deploy.yml` builds and publishes; nothing gates it.
3. Expect CI to go red on the six assertions listed above. That is the site telling you it
   now offers fewer games than it has builds for. Do not silence them by reverting the
   switch.
4. Check the live site: `/play/<slug>/` answers 404, `/games/<slug>/` says the game is
   switched off, and the catalogue card no longer carries a Play badge.

Switching it back on is deleting the line.
