# Performance budgets

A budget nobody wrote down is a budget nobody meets (#183). These are the numbers a change is
measured against: the Core Web Vitals targets on the device the audience actually holds, the
frame-rate targets for gameplay, and the per-route JavaScript budgets that already gate the
build. Where a budget is enforced by something that runs, this document points at it rather
than restating it.

**The reference device is a mid-range Android phone on a 4G connection**, not a developer
laptop on office fibre. Scores measured on the latter bear no relation to what a player sees
(#184), so every field target below is stated for that device and that network, matching the
throttling a mobile Lighthouse profile applies (roughly a 4× CPU slowdown and a ~1.6 Mbps /
150 ms RTT link).

## Core Web Vitals — the field targets

Measured on the landing page and the catalogue (the routes a first-time visitor lands on) and
on a game's play route (the route that pulls a chunk).

| Metric | Target (good) | Hard ceiling (fail) | What it means here |
|---|---|---|---|
| **LCP** — Largest Contentful Paint | ≤ **2.5 s** | 4.0 s | The hero or the first row of catalogue cards is painted. Helped by the static export: the meaningful content is server-rendered HTML, not client-drawn. |
| **INP** — Interaction to Next Paint | ≤ **200 ms** | 500 ms | Tapping a card, opening the mode picker, pressing play. Not the in-game frame loop — that is the fps target below. |
| **CLS** — Cumulative Layout Shift | ≤ **0.1** | 0.25 | Nothing jumps as fonts swap or images load. The fonts are self-hosted with `font-display` tuned (#187) and the catalogue tiles are inline SVG with fixed geometry, so the two usual causes are already designed out. |

These are the Google "good" thresholds, chosen deliberately rather than invented: they are
what the field data a real deploy collects will be graded against, so grading ourselves
against anything looser would be measuring a number nobody else uses.

## Gameplay frame rate

The Web Vitals above are about *getting into* a game. Once a match is running, the target is
different and the fixed timestep makes the two independent:

- **60 fps is the target** for the render loop on the reference device. The simulation runs on
  a fixed timestep regardless (CLAUDE.md rule 4), so rendering is what this budget governs.
- **30 fps is the floor.** Below it a real-time game stops being fair — a reaction resolved on
  a device dropping frames is a reaction the player did not get to make. `docs/input-parity.md`
  resolves reactions on source timestamps and counts holds in simulation steps precisely so a
  30 fps device and a 144 fps device step the *identical* match; the 30 fps floor is where that
  guarantee is still honest.
- **No per-frame allocation** in engine or game `update()` (CLAUDE.md rule 5), because GC
  pauses are how a 60 fps game becomes a 45 fps one for a frame — Penalty Kicks' bot-cost guard
  first failed on a single collection.

The bot's per-step cost is already budgeted deterministically: `bot-cost.test.ts` fails a bot
spending more than a frame on one step, and searching bots run under a `SearchBudget` node cap
rather than a stopwatch, because a time budget would make depth depend on the device and rule
8 forbids that (HANDOFF.md).

## Per-route JavaScript budgets

These are enforced today. `size-budget.json` holds the numbers and `scripts/check-size.mjs`
fails `pnpm build` if any is exceeded — the one performance budget in this document that is
not aspirational. All figures are **gzipped bytes, because that is what crosses the wire.**

| Budget | Current limit | What it covers |
|---|---|---|
| **Shell** | `shellBytes` — **163.0 KB** (166,912 B) | Everything a visitor downloads before choosing a game: the scripts every non-play route loads eagerly. Does not grow when a game is added, so it is the number worth defending. |
| **On demand** | `onDemandBytes` — **41.0 KB** (41,984 B) | The play route's own scripts plus anything reached by an `import()`. Nobody downloads it by arriving; it is paid when a player commits to a game. |
| **One game chunk** | `gameChunkBytes` — **12.0 KB** (12,288 B) | The marginal cost of the one game a player actually picked. One chunk per game is the whole point of the layout. |

Three properties of these budgets, because they were each written wrong once and the
reasoning is load-bearing (`scripts/check-size.mjs`, `size-budget.json`):

- **They are ratchets, not targets.** Generous on purpose. Raising a number is a decision that
  must say why in the commit; sliding past one silently is what the guard prevents.
- **Deferring work must not be punished.** The shell is computed from the build's own route
  manifests (what each route loads eagerly), not "everything that is not a game chunk" — the
  old definition made moving work into an async chunk *raise* the shell via webpack
  boilerplate, rewarding the opposite of what the layout is for.
- **Every emitted script lands in exactly one bucket, or the build fails.** An unclassified
  chunk means the guard has stopped understanding the build output, and a guard that has
  stopped understanding its input must not report success.

Font and image payloads have their own budgets in their own issues — font subsetting and
preload (#187), the image pipeline with explicit dimensions to hold CLS (#186). They are named
here so the CLS target above has an owner, but the byte limits live with those issues.

## What enforces what — and the gap

| Budget | Enforced by | Runs |
|---|---|---|
| Per-route JS (shell / on-demand / game) | `check-size.mjs` inside `pnpm build` | every build, every push |
| No per-frame allocation, bot step cost | `bot-cost.test.ts`, lint bans in engine/SDK/games | every push |
| Deterministic step across frame rates | `docs/input-parity.md` mechanisms + their tests | every push |
| **LCP / INP / CLS field targets** | **nothing yet — issue #184** | — |

**The Web Vitals targets are not enforced in CI.** That is issue #184 (Lighthouse CI against
preview deployments, mobile-throttled, failing below threshold) and it is **explicitly out of
scope here** — #183 is the budgets, #184 is the gate. Until #184 lands, the three CWV numbers
above are verified by a manual Lighthouse run on a mobile profile against a preview build, and
that manual step belongs on the pre-launch checklist (`docs/pre-launch-checklist.md`), which
flags it as blocked-on-#184. The JS budgets *are* enforced now; the field metrics are the half
still waiting on a gate.
