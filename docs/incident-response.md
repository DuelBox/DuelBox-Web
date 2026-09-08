# Incidents

Issue #2415 asks for "the on-call and incident response process", with runbooks for room
server saturation, database exhaustion, bad deploy, and CDN failure.

**Three of those four do not exist here, and an on-call rotation would never fire.** This
document says what an incident actually is for a static site with no backend, no accounts and
no user data, writes the process for those, and names what is not applicable and why —
because a rota nobody is paged into is the same defect as a rule nothing enforces, and this
repository has found six of those already.

---

## What is not applicable, and why

| From the issue | Status |
|---|---|
| **Room server saturation** | There is no room server. There is no server of any kind: `output: 'export'`, and `scripts/check-zero-cost.mjs` fails the build if a route needs request-time rendering. Remote play is designed (`docs/play-configurations.md`) and not built — no `RTCPeerConnection`, no signalling, no `BroadcastChannel` anywhere |
| **Database exhaustion** | There is no database. The only persistence is one browser-local key, `duelbox:last-mode`, on the player's own device |
| **CDN failure** | There is a CDN — GitHub's, in front of Pages — but it is not ours. We have no origin to fail over to, no purge control, and no configuration. "CDN failure" here means "GitHub is down", which is handled below and is not something we respond to |
| **Bad deploy** | **Real, and the most likely incident by a wide margin.** [`docs/release-runbook.md`](release-runbook.md) is its runbook |

And the reason there is no rotation:

> **Nothing can page anyone, because nothing is watching.** There is no uptime monitor, no
> synthetic check, no error reporting, no analytics and no logs we can read — the privacy
> policy depends on the last three staying absent. The four workflows under `.github/` watch
> the repository, not the site. An outage would be discovered by a person opening the site.

A rota with no alerting source is theatre. What replaces it is written below: a **named
owner**, a **short list of things that can actually go wrong**, and one **cheap monitoring
change** that would make a rota meaningful if the product ever needs one.

---

## The named owner

There is one, from [`.github/CODEOWNERS`](../.github/CODEOWNERS) and
[`SECURITY.md`](../SECURITY.md): **[@jatinsingh1603](https://github.com/jatinsingh1603)**,
owner of `packages/engine`, `packages/game-sdk`, `apps/web/src/components`, `scripts/`,
`.github/`, `CLAUDE.md` and `size-budget.json`.

Anything scored **Sev 1 or Sev 2** below, and anything touching those paths, is that person's
to triage and is not delegated by default. A defect in a single game package may be handed to
whoever is working on that game — game packages are deliberately unowned so game work is not
bottlenecked.

**Response expectations.** The only external commitment this project has made is in
`SECURITY.md`, and it applies to vulnerability reports: acknowledgement within **3 working
days**, first assessment within **10**, a fix or a dated plan within **90**. Nothing else
promises anyone anything, and this document does not invent a promise the project cannot keep.
There is no follow-the-sun anything. Deploys should be made when someone is awake to check
them.

---

## Severity

Ranked by what it costs a player, not by how alarming it sounds.

| | Definition | Examples | Response |
|---|---|---|---|
| **Sev 1** | The origin serves something we did not build, or code a visitor did not ask for | Compromised dependency reaching the bundle, repository or Actions compromise, XSS reachable from a link | Immediately. Take the site down before diagnosing — see the runbook below. This is the failure that ends the product |
| **Sev 2** | The site is broken for everyone, or something is legally wrong | Blank page, all games fail to load, a build that does not run, an asset we do not have the right to ship, a privacy claim that is false | Same day. Roll back first, understand second |
| **Sev 3** | One game or one route is broken, or a class of device is | A game unplayable on iOS Safari, a route 404ing, a control that does nothing on touch | Next working session. Open an issue with a reproduction |
| **Sev 4** | Visible but not blocking | Wrong copy, a stale count, an accessibility annoyance with a workaround | Normal backlog |

Two calibrations from this repository's history, so the scale means something:

- *"A tap did not place a mark — only a ~150 ms hold registered"* made the product unplayable
  by touch, on every turn-based game. **Sev 2.** It shipped, and it was found by playing.
- *"49 game pages read 'about 1 minutes'"* is **Sev 4**, and the fix went in with everything
  else.
- A **compromised transitive dependency** is Sev 1 and is judged the most realistic route to
  serving malware from our own origin — see [`docs/threat-model.md`](threat-model.md). It
  requires no mistake on our part at all.

Accessibility barriers are graded on the same scale, not a separate one. A game that cannot be
played in greyscale is Sev 3 because it is unplayable for someone, and rule 7 exists because
our two seat colours measure 1.03:1 contrast under deuteranopia.

---

## How anything gets noticed

This is the honest weak point, so it is listed before the runbooks.

| Signal | Covers | Latency |
|---|---|---|
| Somebody plays the site | Everything | Unbounded |
| `ci.yml` on push and PR | Regressions the suite covers | 10–18 min |
| `nightly.yml` at 03:15 UTC | Firefox, deep seat balance, the 70% coverage floor | Up to 24 h — **and nobody is assigned to read it** |
| `security.yml` — CodeQL, dependency review, `pnpm audit`, secret scans; PR, push and nightly | New advisories and injection paths | Up to 24 h |
| Dependabot, weekly | Dependency drift | Up to 7 days |
| GitHub secret scanning with push protection | A credential being committed | At push time |
| A private security advisory | Anything a researcher finds | Unbounded |
| **Nothing at all** | **The site being down, blank, or serving a bad build** | **Unbounded** |

**The one change that would fix the bottom row** is a scheduled workflow that curls the live
origin for a 200 and greps the served HTML for the meta CSP and a known string, failing the
run when either is missing. It costs one job on a cron, it needs no new service, and it turns
"an outage lasts until someone notices" into "an outage lasts under an hour". Until it exists,
do not describe this project as monitored.

**Second: assign the nightly.** A red nightly that nobody reads is a guard that does not run,
which is the exact failure mode this repository has hit six times.

---

## Runbooks

### 1. Bad deploy — the site is broken or wrong

The most likely incident, and it has its own document.

Go to [`docs/release-runbook.md`](release-runbook.md) → *Rolling back*. In summary: revert the
commit and push (about three minutes to deploy), or re-run the last good Deploy run to stop
the bleeding and revert afterwards.

Two facts that decide how urgent it is:

- **There is a service worker now, and this bullet used to say the opposite.** It said a bad
  build could not pin itself in anyone's browser, and that was true until the worker landed.
  It is not true any more, and this is the paragraph that decides how urgent a bad deploy is,
  so read the mechanism rather than the summary.

  A returning visitor is served the *previous* build's documents out of their own device
  before the network is consulted — that is the whole point of it, and it is what makes the
  site work on a train. What limits the damage is that the browser re-fetches `sw.js` on
  every navigation, so a rollback reaches a device on its next page load: the new worker
  installs, the page offers **Reload**, and taking it lands on the fixed build. A person who
  does not take it stays on the broken one until they reopen the tab.

  So the honest worst case is no longer ten minutes for everybody. It is: the CDN's
  `max-age=600` for a first-time visitor, and *one navigation plus one accepted prompt* for a
  returning one — which for somebody who leaves the tab open is unbounded. If a build is bad
  enough that people must not keep using it, rolling back is not sufficient on its own; see
  [`docs/pwa.md`](pwa.md) → *Clearing a worker that is stuck*, which is written for exactly this
  moment.

  What cannot happen is a device pinned to a broken build **permanently**: `sw.js` is
  deliberately excluded from its own precache, so it is never answered from the cache and the
  update check always reaches the origin. That is the property the rollback depends on, and
  it is the one to check first if a rollback ever appears not to be landing.
- **Nothing persists server-side**, so there is nothing to repair after the rollback. No
  migration, no queue, no half-written state.

Do not skip the post-incident step just because the fix was three minutes.

### 2. Something we did not build is being served — Sev 1

The order matters: **stop serving it, then find out why.**

1. **Take the site down.** Settings → Pages → unpublish, or delete the `github-pages`
   deployment. An origin serving malware once, to anyone, is worse than an origin that is
   down. There is no state to lose by turning it off.
2. **Rotate what can be rotated.** There are no application secrets — the build refuses to
   ship anything credential-shaped (`check-bundle-secrets.mjs`) and scans the source for the
   same (`check-source-secrets.mjs`) — so the exposure is the repository and its Actions.
   Review recent workflow runs, deploy keys, and any Actions permissions change.
   [`docs/secret-rotation.md`](secret-rotation.md) is the procedure.
3. **Find the entry point.** In order of likelihood, from the threat model: a compromised
   dependency (most realistic), a compromised action, a compromised account. Compare
   `pnpm-lock.yaml` against the last known-good commit; every action is SHA-pinned, so a
   changed pin is visible in the diff.
4. **Rebuild from a known-good commit** and verify the artefact before republishing. The
   verification block in the release runbook, plus a diff of `apps/web/out` against a local
   build of the same SHA.
5. **Publish an advisory.** GitHub private advisories, then public. If a visitor could have
   been served something, say so, with the window.

### 3. A security report arrives

`SECURITY.md` is the process and it is already specific: private advisories at
<https://github.com/DuelBox/DuelBox-Web/security/advisories/new>, acknowledgement in 3 working
days, assessment in 10, fix or dated plan in 90, credit unless declined, safe harbour for
good-faith research.

Two things to check before treating a report as an incident, both from that file's scope
section: **cheating in a local match is not a vulnerability** — a player editing their own
score on their own device has cheated at a game — and **missing headers are known**. GitHub
Pages serves no custom response headers, so seven of the nine generated ones reach nobody
(#2481). A scanner grading this origin down is reporting a fact already recorded in
`docs/deploy.md`, not a finding.

One live gap worth knowing when a report arrives: **`/.well-known/security.txt` returns 404 on
the live origin** although the artefact contains it and `/security.txt` serves fine. RFC 9116
names the `.well-known` path as canonical, so a researcher following the standard finds
nothing. See the release runbook.

### 4. A game ships broken

Sev 3 unless it is every game, in which case it is Sev 2 and rule 1 applies.

1. Reproduce on the live origin, on the device class it was reported for. **Both seats, both
   orientations** — seat two could not play on a keyboard at all for weeks because nobody
   played as seat two.
2. If it is a whole class of game, check whether the cause is in the engine or the SDK.
   Twenty-nine games have shipped and **every one found a platform bug**; the odds favour the
   shared layer.
3. Fix forward if the fix is small and testable within the session. Revert if it is not — the
   game is one chunk, and reverting one game costs the other 106 nothing.
4. **Write the test that fails first.** Then fix it. Roughly one test in six written here has
   turned out to prove nothing, and two of those were hiding real bugs.

### 5. GitHub is down

Check <https://www.githubstatus.com>. If Pages or Actions is degraded, there is nothing to do
and nothing to fix — we have no second origin, no failover and no control over the CDN.

Record the window in an issue so it is not later mistaken for a defect of ours. Do not push a
deploy during a degraded Actions window: the `pages` concurrency group is
`cancel-in-progress: false`, so a stuck deployment blocks the next one rather than being
superseded.

If Pages outages ever become frequent enough to matter, the fix is the one already costed in
`docs/deploy.md`: the artefact is host-agnostic, and moving to Cloudflare Pages, Netlify or
Vercel needs nothing from this repository except deleting `deploy.yml` and updating
`DEPLOY_TARGET`. That move also fixes #2481.

### 6. An originality or licensing complaint

The one incident type unique to this product, and the reason `CLAUDE.md` rules 1 and 2 are
absolute.

1. **Do not argue in public and do not delete anything yet.** Preserve the state.
2. Establish what is claimed: a **mechanic** (free to reimplement, and the substance of every
   game here) or **expression** — art, audio, code, layout, name, copy. See the research scope
   boundary in [`CONTRIBUTING.md`](../CONTRIBUTING.md).
3. Check provenance. Every shipped asset needs an `assets.license.json` entry with a source, a
   licence and an author; `scripts/check-asset-licenses.mjs` enforces it, and the count is
   currently zero because every game draws with primitives. That makes this the easiest
   provenance question this project will ever face — for now.
4. If the claim is about a name, `data/catalog.yaml` records which of the thirteen renamed
   games were renamed and why.
5. If the claim is good, **remove first and discuss after.** One game is one chunk.

---

## After an incident

The acceptance criterion in #2415 is that post-incident actions are tracked as issues rather
than lost in a document. That is the right criterion and it is the whole of this section.

**Blameless means blameless about people and merciless about systems.** The failure is never
that somebody pushed a bad commit; it is that something let a bad commit reach players. This
repository is unusually good at this already — read the commit log, or `HANDOFF.md`, where
every discovered defect is written down with how it hid.

Within a working day of the site being healthy, open **one issue** with:

1. **Timeline.** When it shipped, when it was noticed, when it was safe. Include the gap
   between the first two — that number is the argument for the uptime check above.
2. **What players experienced**, in the same plain register as the rest of the product.
3. **Why it was not caught.** Which guard should have caught it, and what it was doing
   instead. Six guards in this repository have been found asserting nothing at all.
4. **The guard that would catch it next time** — as a separate issue, linked, with an owner.
   **And prove it fails.** Break the thing on purpose, watch the new check go red, restore.
   An action item that is only a resolution to be more careful is not an action item.
5. Label it `type:bug`, and link the commits both ways.

There is no `incident` label in this repository today. If more than two of these are ever
written, create one; until then `type:bug` plus the issue's own timeline section is enough,
and a label with two members is worse than none.

**The action item is not "be careful."** From the six phantom guards: what actually worked was
running the thing that was supposed to enforce the rule and watching it fail on purpose. Five
of the six were found in one day, by looking. That is the shape every post-incident action
here should take.

---

## Rehearsal

#2415 asks that the runbooks have been rehearsed. **They have not been, and this document does
not claim otherwise.** Two are cheap to rehearse and worth doing before the first real
incident:

- **Runbook 1, bad deploy.** Push a harmless visible change to `main`, watch it go live, then
  revert it and time the whole loop including the CDN's ten minutes. That is the only way to
  find out whether the numbers in the release runbook are right.
- **Runbook 5, host outage.** Read `githubstatus.com` and confirm there is genuinely nothing
  to do. Five minutes, and it settles an argument at three in the morning.

Runbooks 2, 3 and 6 cannot be rehearsed without inventing a real incident. What can be
rehearsed is the first step of each, which in all three cases is "stop, preserve, and tell the
named owner" — and that is short enough to remember.
