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
- **Quality steps down before the frame rate does** (#31). `AdaptiveQuality` in the engine is fed
  every animation frame's wall-clock length by the loop; two seconds averaging over the 1/60 s
  budget steps the rung down (backing-store ratio 2 → 1.5 → 1, effects off on the last rung),
  four seconds comfortably under steps it back up. A game may cap its own ratio with `dprCap`
  in its manifest. All of it is presentation — the logical box and the fixed step never move.
- **A low battery halves the picture, not the match** (#190). At or under 20% and off the cable
  — the platforms' own Low Power Mode threshold — alternate frames are drawn and effects take
  the reduced-motion path. WebKit exposes no battery API, so on every iPhone this is a no-op;
  there is no thermal API on any browser, and nothing here pretends otherwise.
  `e2e/adaptive-quality.spec.ts` measures the halving and holds the match clock to its time.

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
| **Shell** | `shellBytes` — **129.0 KB** (132,096 B) | Everything a visitor downloads before choosing a game: the scripts every non-play route loads eagerly. Does not grow when a game is added, so it is the number worth defending. |
| **Legacy polyfills** | `legacyPolyfillBytes` — **40.0 KB** (40,960 B) | `polyfills-*.js`, which Next references as `<script nomodule>`. No engine in tiers 1 or 2 of `docs/support-matrix.md` fetches it; only the tier-3 engines that document says are not supported. Budgeted rather than exempt, because the file is the framework's. |
| **On demand** | `onDemandBytes` — **59.0 KB** (60,416 B) | The play route's own scripts plus anything reached by an `import()`. Nobody downloads it by arriving; it is paid when a player commits to a game. |
| **One game chunk** | `gameChunkBytes` — **12.0 KB** (12,288 B) | The marginal cost of the one game a player actually picked. One chunk per game is the whole point of the layout. |
| **Speculated** | `speculatedBytes` — **496.0 KB** (507,904 B) | The 108 `/play/<slug>/index.txt` route payloads a browse of the catalogue prefetches for cards nobody presses. Not JavaScript, which is why no guard saw it until #2545. |
| **First session** | `firstSessionBytes` — **320.0 KB** (327,680 B) | Arrive, pick a game, play it: the landing document, its stylesheets, the three base-subset faces, the shell, the worker, the play route's code and the largest game chunk. Wire bytes, derived from the lines above plus the three non-JavaScript ones nothing weighed before (#2446). |
| **Browsing session** | `browsingSessionBytes` — **768.0 KB** (786,432 B) | Arrive at the catalogue and scroll to the end of it, pressing nothing: the catalogue document, stylesheets, faces, shell, worker and all 108 speculated payloads. The most a visitor who buys nothing can cost (#2446). |
| **Catalogue on screen** | `catalogueBytes` — **260.0 KB** (266,240 B) | What the grid costs before any card comes near the viewport: document, stylesheets, faces, shell. There is no `<img>` in the export — every tile is inline SVG through one sprite — so this is the catalogue's whole asset budget (#2419). |

**The three session lines are wire bytes, not JavaScript.** Fonts count at file size (a woff2
is compressed internally; gzip adds 0.1%), and only the base subsets — `unicode-range` means a
`-latin-ext` face is fetched only when a glyph in that range renders, which no English page
does. **The first session is not held to ADR 0001's 182 KB**, and the reason is written in
`size-budget.json` → `_set_2026_09_08_sessions`: that figure was measured on 20 August over
eleven files, before the faces were self-hosted (86 KB of today's 313) and before the service
worker existed, and the hosting decision it justified is unchanged by the session being larger.
`check-zero-cost.mjs` prints a "session weight" that is a different question — the *raw* size
of the scripts one play page's tags reference, polyfills in and game chunk out — and it is a
ratchet on that page's tags, not a session.

**What the two issues asked for and cannot be done:** field data. This site has no analytics
by design (the privacy page promises none), so bytes per real session cannot be measured
without breaking that promise. The lab number is what is enforced.

**The shell number moved 163.0 → 129.0 without the shell shrinking.** It stopped counting the
polyfills, which are now the row below it: the old figure billed 38.5 KB nobody supported
downloads to the line that claims to describe what every visitor downloads.
`size-budget.json` → `_rederived_2026_09_08_polyfills` carries the measurement and the check
that keeps it true.

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
| Per-route JS (shell / on-demand / game), speculated payloads, the three session lines | `check-size.mjs` inside `pnpm build` | every build, every push |
| Every `<img>` carries its dimensions (CLS) | `check-images.mjs` inside `pnpm build` | every build, every push |
| No per-frame allocation, bot step cost | `bot-cost.test.ts`, lint bans in engine/SDK/games | every push |
| Deterministic step across frame rates | `docs/input-parity.md` mechanisms + their tests | every push |
| **LCP / INP / CLS — lab proxies** | `lighthouse.yml` (`@lhci/cli` against the export, mobile-throttled, `lighthouserc.json` thresholds) | every pull request, every push to main |
| **LCP / INP / CLS — field** | **nothing, by design** | — |

**The Web Vitals are held in the lab, not the field.** #184 runs Lighthouse against the built
export served locally — the same artefact a host serves — on the landing page, the catalogue,
a game page and a play route, median of three, with simulated slow-4G throttling. The
thresholds in `lighthouserc.json` were set from a measured run rather than copied from the
table above: performance ≥ 0.85 (measured 0.90–0.96, and the catalogue read 0.90 and 0.96 on
consecutive runs of one build, so 0.9 would fail at random), **LCP ≤ 4.0 s** (the table's
"poor" boundary; measured 2.9–3.5 s simulated, dominated by the faces swapping in), TBT ≤ 200 ms
as the lab stand-in for INP (measured 0–24 ms), CLS ≤ 0.1 (measured 0). The field 2.5 s LCP
can only be verified in the field, and this site collects no field data — the privacy page
promises no analytics — so that row says "nothing" and means it.
