# DuelBox — handoff prompt

Paste everything below the line into a fresh Claude Code session started in this repo.

---

You are picking up work on **DuelBox**, a browser collection of two-player mini-games.
The repo is `DuelBox/DuelBox-Web`, already cloned. **Read `CLAUDE.md` first** — it is the
constitution and its rules are non-negotiable.

## Where things stand

`main` is green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e`.
**799 unit tests, 93 browser tests** across four Playwright projects (Desktop Chrome,
Pixel 7, and iPhone 14 Pro in portrait and landscape — the last two on **real WebKit**,
so iOS Safari is genuinely covered rather than emulated by a phone-sized chromium window).

**2,265 issues open.** Roughly 1,860 are the per-game backlog (14 issues each across the
100 games not yet built). The rest is platform work, and that is where the leverage is —
see "Why platform work first" below.

Seven games play end to end: Tic Tac Toe, Air Hockey, Drop Four, Sumo Push, Memory Match,
Pull the Rope, Whack a Mole.

## Start here — the highest-value work, in order

1. **Finish #1861** (last M0 P0, two of three criteria already met). The remaining item is
   build-time manifest validation. `parseGameManifest` is a runtime Zod parse that only
   runs when a game module is imported, and the web app imports games dynamically in the
   browser — so `pnpm build` validates nothing. Write `scripts/validate-manifests.mjs`
   that walks `packages/games/*`, parses each manifest, asserts `logical` is a positive
   integer box; wire it into `build` and CI. The issue comment lists all three remaining
   sub-tasks concretely.
2. **Guard the rules that currently hold by discipline alone.** `eslint.config.js` already
   fences `Math.random` and `Date` out of `packages/games` and `packages/engine`. Extend
   that block to ban `window`, `document`, `devicePixelRatio`, `screen`, `navigator`,
   `requestAnimationFrame` and `performance`, with a narrow exception for `browserClock`
   in `loop.ts`. Today "no game reads the device" is true because people were careful.
3. **#2421 / #2422 — the keyboard.** The audit found `DEFAULT_BINDINGS` is sound (WASD +
   Space, arrows + Enter, non-overlapping) and Escape correctly reaches the pause menu.
   Missing: no manifest field for a per-game keyboard scheme, and nothing shows either
   player their bindings before or during a match. Also note Space and Enter activate a
   focused button, so the HUD's pause button can double-fire.
4. **#1860 / #1863 — the presentation abstraction.** Specs then implementation. This is
   the gateway to single-seat play and therefore to everything cross-device.
5. **Then the game pipeline.** 100 games × 14 issues. Mechanical once the shell is done.

## Why platform work first

Every platform fix multiplies by 100. This session's evidence: all seven games had
invented their own seat colours — four different palettes, and two of them disagreed about
which player was the warm colour — so the shell's scoreboard named a colour that was not
on the board. One `SEAT_PALETTE` in the engine fixed all seven at once. The same fix
applied after 107 games exist would have been 107 separate corrections.

## What this session changed, and what it taught

Five bugs, none of which the test suite caught. **Every one was found by running the
product, not by reading it.**

- **Bot mode was completely broken.** Every bot match in every game froze on the countdown
  and never started, silently. A fresh object literal in a `useEffect` dependency array
  rebuilt the game host; the rebuilt loop was never started because the effect that starts
  it only fires when the *phase changes*, and the phase had not changed. Fixed in
  `5a4a489`. The reason it shipped: every browser test started matches with "Play together
  here", so the entire bot path had zero coverage.
- **A tap did not place a mark.** Only a press held ~150ms registered — on a touchscreen
  the game was effectively unplayable. `actionPressed` was derived by *sampling* whether a
  pointer was down when the step ran, so a tap that began and ended between two steps was
  invisible. Fixing that alone was not enough: the pointer *position* was withheld on
  exactly the step the press was reported, so the game got "a press happened" with nowhere
  to put it. Both are latched now (`8e663a3`).
- **Landscape was unplayable.** A square game rendered 686px tall inside a 343px viewport,
  most of the board below the fold. Three compounding causes, all in `8e663a3`'s message.
- **Safe-area tokens were inert.** Declared correctly from `env(safe-area-inset-*)` and
  consumed in exactly one place — a runtime read that double-counted them — while every
  surface that can land under a notch used none.
- **49 game pages read "about 1 minutes."**

**Two systemic gaps closed, both of which had been hiding real problems:** `pnpm typecheck`
covered neither `apps/web` nor **any test file** (every package tsconfig excludes
`src/**/*.test.ts`), so seven test doubles declaring `implements Renderer` had silently
drifted from the interface. Both are in the typecheck now.

## How to work

- **Run the product.** Not just the tests. `pnpm dev` serves on :3000; drive it with
  Playwright and take screenshots. Every bug above was invisible to a green suite.
- **Prove a test can fail before trusting it.** Break the code, watch the test go red, put
  it back. Done for every fix this session, and it caught a would-be-vacuous one:
  50 leaked listeners pass a 5MB heap threshold, so the heap test alone would not have
  found the leak the listener test does.
- **Beware tests that pass vacuously**, especially determinism tests. `cross-viewport.test.ts`
  carries two explicit guards against it.
- One issue at a time. Close only with evidence: what landed, what was verified, what is
  still open and why. Comment rather than close when an acceptance criterion is genuinely
  unmet — several issues here are deliberately left open on a single item.
- If a test encodes old behaviour, change the test *and say so*. Three rotation tests now
  settle the seat flip before tapping, because tapping the instant a turn passes is aiming
  at a board nobody could have seen.

## Backlog hygiene, already done

Do not redo this. 79 issues of pure debt were cleared: 56 byte-identical duplicates from a
seed script that ran twice on 2026-08-19 (26 seconds apart), and 23 legacy issues
superseded by the platform backlog. Three legacy issues were genuinely unique and kept
(#11 Changesets, #31 DPR-aware rendering, #2459 WebKit/Firefox). Three orphan milestones
are closed.

## A caution about audits

A multi-agent audit of the P0s was extremely productive — it found the dependency-array
bug — but **5 of 7 skeptic passes died on a session limit**, and the workflow mapped a
failed refutation to `refuted: false`, which is indistinguishable from "verified clean".
If you run one, check that the verification actually ran before trusting a verdict.

## Commands

```bash
pnpm dev            # :3000, its own .next-dev so a build cannot clobber it
pnpm test           # unit
pnpm e2e            # browser, against the static build in apps/web/out
pnpm build          # static export
pnpm typecheck      # packages + all test files + the Next app
python3 scripts/list_issues.py --repo DuelBox/DuelBox-Web --format md > BACKLOG.md
```

## Where to look

| File | What it holds |
|---|---|
| `CLAUDE.md` | The constitution — read first |
| `docs/reference-analysis.md` | What was observed by playing the reference app |
| `docs/observed-rules.md` | Verbatim rules for all 107 games |
| `packages/engine/src/flip.ts` | The seat flip — the clearest example of the fixed-step, device-free style |
| `packages/game-sdk/src/match.ts` | The match state machine every game runs inside |
| `apps/web/src/data/cross-viewport.test.ts` | The cross-device determinism proof |
| `data/catalog.yaml` | Single source of truth for the games |

Start by reading `CLAUDE.md`, then
`gh issue list --repo DuelBox/DuelBox-Web --label priority:P0 --state open`, and work item
1 above.
