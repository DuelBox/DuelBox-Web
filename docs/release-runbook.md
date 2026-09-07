# Release and rollback runbook

For the person shipping at two in the morning. Everything below was checked against the live
origin and the workflows as they are today, not against how they are described.

[`docs/deploy.md`](deploy.md) explains the artefact, the hosts, and which security headers
survive a header-less host. This document is the procedure: how a release happens, how to
tell whether it worked, and how to undo it.

Site: <https://duelbox.github.io/DuelBox-Web/> · Workflow:
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

---

## What a release is here

**Pushing to `main` is the release.** There is no separate step, no tag, no approval and no
promotion between environments. `deploy.yml` triggers on `push: branches: [main]`, builds the
static export, and publishes it to GitHub Pages. The only other trigger is a manual
`workflow_dispatch`, and the `github-pages` environment's branch policy permits `main` only.

Observed end-to-end times over the last eight deploys: **2m17s to 4m11s.**

### The thing to understand before you push

**The deploy waits for CI, and publishes only the commit CI actually tested.**

That was not true until #2511. `ci.yml` and `deploy.yml` used to be triggered by the same
push and run in parallel — CI takes **10 to 18 minutes**, the deploy **2 to 4** — so the new
site was live to every visitor roughly ten minutes before anyone knew whether the tests had
passed, and a red CI neither stopped the deploy nor undid it. The gate was real, thorough,
and wired to nothing.

`deploy.yml` now triggers on `workflow_run` against the `CI` workflow, with two details that
carry the whole change:

- **`if: github.event.workflow_run.conclusion == 'success'`.** `workflow_run` fires when the
  other workflow *completes*, not when it succeeds. Without this line the trigger would look
  correct and gate nothing.
- **`ref: ${{ github.event.workflow_run.head_sha }}`.** `workflow_run` checks out the default
  branch's tip by default, not the commit that was tested. On a busy branch that would
  publish something nothing verified — the same defect one step along.

A `workflow_dispatch` is still allowed through unconditionally, so a rollback is never gated
on a green run of the commit you are rolling back *to*.

A cancelled CI run does not deploy. `ci.yml` sets `cancel-in-progress: true`, so a superseded
run ends as `cancelled` rather than `success`; the push that superseded it brings its own CI
and its own deploy.

**One gap remains, and it is a repository setting rather than a file.** `main` has no branch
protection and no ruleset — `gh api repos/DuelBox/DuelBox-Web/branches/main/protection`
returns 404 and `…/rulesets` returns `[]` — so there are no required status checks and a pull
request can still be merged red. That no longer publishes a broken site, because the deploy
is gated on CI for whatever lands. It does mean `main` can hold a red commit until the next
push. Deciding that is #2511's second half.

---

## Releasing

### 1. Before you push

```bash
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```

All six. `format:check` first, because it is the one that gets skipped — CI failed on it for
every commit until 20 August 2026 while everyone's local run of the other five was green.

If you are merging a pull request rather than pushing, check that the **CI run on the head
commit is green before you merge**, because nothing will check it for you afterwards.

### 2. Push, and watch the right run

```bash
git push origin main
gh run list --repo DuelBox/DuelBox-Web --workflow=deploy.yml --limit 3
gh run watch <run-id> --repo DuelBox/DuelBox-Web
```

The two jobs are `build` then `deploy`. The `deploy` job's summary carries the page URL.

Concurrency is `group: pages, cancel-in-progress: false` — one deployment at a time, and a
half-done one is never cancelled, because a partially uploaded site is worse than a slightly
stale one. Two pushes in quick succession therefore queue; the second waits.

### 3. Verify against the live origin

**Do not use the `PLAYWRIGHT_BASE_URL` command.** It appears in `docs/deploy.md` and it does
nothing: `PLAYWRIGHT_BASE_URL` occurs nowhere in this repository, `playwright.config.ts`
hard-codes `baseURL: 'http://127.0.0.1:4173'`, and its `webServer` block starts a local server
regardless. Running it tests your laptop's build and tells you nothing about the deploy. That
is the same class of mistake as the `curl -sI` header check that sat in that document for
months and could never have passed on this host.

What does work, and takes about a minute:

```bash
U=https://duelbox.github.io/DuelBox-Web

# Every route the site links to answers.
for p in / /games/ /how-to-play/ /privacy/ /terms/ /games/tic-tac-toe/ /play/tic-tac-toe/; do
  printf '%s -> %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$U$p")"
done

# The two header protections that survive a header-less host travel in the markup.
curl -s "$U/" | grep -c 'http-equiv="Content-Security-Policy"'   # expect 1
curl -s "$U/" | grep -c 'name="referrer"'                        # expect 1
curl -s "$U/" | grep -c 'top===w.self'                           # the frame guard: expect 1

# The security contact is reachable.
curl -s -o /dev/null -w '%{http_code}\n' "$U/security.txt"
curl -s -o /dev/null -w '%{http_code}\n' "$U/.well-known/security.txt"
```

Then **open the site and play a match.** Two games, one turn-based and one real-time, on a
phone if you have one. Every bug worth finding in this repository was found by running the
product; the suite was green through all of them, and it is green through the three defects
listed below.

### 4. What that check returns today, so you can tell new from old

Measured against the live origin on 29 August 2026, deployed SHA `914e7db`:

| Check | Result | Reading |
|---|---|---|
| All seven routes | `200` | Good |
| meta CSP | present | Good |
| `<meta name="referrer">` | **absent** | Ships with the header-delivery work currently in the tree, not yet on `main` |
| frame guard inline script | **absent** | Same |
| `/security.txt` | `200` | Good |
| `/.well-known/security.txt` | **`404`** | A defect — see below |
| an unknown path | `404`, unstyled | See below |

Two of those are worth filing rather than shrugging at.

**`/.well-known/security.txt` 404s on the live origin while `/security.txt` serves.**
`scripts/emit-host-config.mjs` writes both, at the deployed SHA as well as the current one,
and `.nojekyll` is created before upload. So the artefact contains the file and the host is
not serving it. RFC 9116 names the `.well-known` location as the canonical one, and
`SECURITY.md` depends on a researcher finding it. The cause is not established — the dot
directory is being lost somewhere between `apps/web/out` and the served origin. **Do not
"fix" this by deleting the root copy**; the root copy is the one that currently works.

**A 404 shows Next's default error page** — black-on-white, system font, "This page could not
be found", with no DuelBox chrome and no link back. There is no `not-found.tsx` anywhere in
`apps/web/src`. That is the page a visitor gets from a stale link or a typo, which is exactly
the moment the site should look like itself.

---

## Rolling back

There is **no rollback button.** GitHub Pages sourced from a workflow has no "restore previous
deployment" control, so a rollback is a new deployment of old content. Two routes, in order of
preference.

### Route A — revert the commit (the default)

The one that leaves an honest history and works in every case.

```bash
git fetch origin && git checkout main && git pull --ff-only
git revert --no-edit <bad-sha>          # or a range: <first>^..<last>
git push origin main
gh run watch $(gh run list --repo DuelBox/DuelBox-Web --workflow=deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

**Time to safe: about three minutes to deploy, plus up to ten minutes of CDN cache** — see
below. Verify with the block in step 3.

If several agents or people are working in this repository, do this in a
`git worktree`, not by changing branches in a directory someone else is using. That has
destroyed work three times; see [`docs/parallel-work.md`](parallel-work.md).

### Route B — re-run the last good deploy

Faster to type, and it does not touch the history — but it leaves `main` still holding the bad
commit, so the next push re-ships it. Use it to stop bleeding, then do Route A.

```bash
gh run list --repo DuelBox/DuelBox-Web --workflow=deploy.yml --limit 10
gh run rerun <good-run-id> --repo DuelBox/DuelBox-Web
```

A re-run checks out the **original commit** of that run and rebuilds it. Because
`pnpm install --frozen-lockfile` pins every dependency, that rebuild is effectively the same
artefact. Two caveats: re-runs are only available while GitHub retains the run, and if the
cause of the outage is a dependency or an action rather than our code, rebuilding old code
will not save you — Route A will not either. In that case pin the dependency and go forward.

### What the caches do

The live origin serves `cache-control: max-age=600` on **both** HTML and hashed assets
(measured). So:

- A visitor who loaded the bad page may keep it for **up to ten minutes** after the rollback
  deploys. Plan the "it is fixed" message around that, not around the workflow finishing.
- There is **no service worker and no app cache** — verified: no `sw.js`, no
  `service-worker*`, no `next-pwa`, no `workbox`, and nothing registering one. **A bad build
  cannot pin itself in anyone's browser.** That is the single most important fact about
  rollback here, and it is why a ten-minute worst case is the whole story.
- `x-proxy-cache` / `via: varnish` in the response headers confirm a CDN in front. There is no
  purge control available to us; waiting out `max-age` is the mechanism.

### What cannot be rolled back

Nothing. There is no database, no migration, no user state on any server, and no accounts.
The only thing that persists across a release is one browser-local preference key,
`duelbox:last-mode`, which holds each game's last-used mode, difficulty and round count. If a
release changes its shape, `apps/web/src/lib/last-mode.ts` wraps every read in a `try/catch`
that falls back to defaults — so a stale value degrades to "the setup form starts empty",
never to a broken page. Bump its `version` field rather than inventing a migration.

---

## Communications

Be honest about the scale before importing a comms plan. There is **no status page, no
analytics, no error reporting, no mailing list and no way to contact a player** — by design,
and the privacy policy depends on it staying that way.

So the whole of comms is:

1. **Open an issue** describing what shipped, what broke, what you did, and when it was safe.
   Label it `type:bug`. Link the bad commit and the rollback commit.
2. **Say it in the commit message.** The revert's message is where the next person finds out
   what happened; `git log` is the incident history this project actually has.
3. **If a security researcher is involved**, `SECURITY.md` commits us to acknowledgement within
   three working days. That clock is the only external commitment in the repository.

Nothing else is owed to anyone, and inventing a notification channel to satisfy a template
would be worse than saying this.

---

## Checklist

Copy this into the issue.

```
Release
[ ] All six gate commands run locally, green
[ ] CI green on the head commit (nothing enforces this — check it)
[ ] Pushed to main; Deploy run watched to completion
[ ] Seven routes return 200
[ ] meta CSP, meta referrer, frame guard present in the served HTML
[ ] /security.txt returns 200
[ ] Played one turn-based and one real-time game on the live origin
[ ] Checked on a phone

Rollback (if needed)
[ ] Route chosen and why (A revert / B re-run)
[ ] Deploy run completed
[ ] Verification block re-run and green
[ ] Ten minutes elapsed since the deploy before declaring it fixed (CDN max-age=600)
[ ] Issue opened with cause, action, and what would have caught it
```

## The gaps this runbook cannot close

A first-timer can follow everything above. These are the things that would have to change in
configuration or code, and they are named here so the next person does not assume they are
already handled:

1. **CI does not gate the deploy** (no branch protection, no required checks, no `needs:`).
   The largest one.
2. **`PLAYWRIGHT_BASE_URL` does nothing**, so there is no automated verification against a
   real origin. Threading it through `playwright.config.ts` — and skipping the `webServer`
   block when it is set — would give this runbook a real smoke test instead of a curl loop.
3. **`/.well-known/security.txt` 404s** on the live origin.
4. **No `not-found.tsx`**, so every 404 is Next's default page.
5. **No custom domain**, so the site's URL contains the repository name and moving hosts
   changes every link anyone has saved. Worth deciding before that matters.
