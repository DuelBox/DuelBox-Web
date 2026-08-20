# DuelBox — handoff prompt

Paste everything below the line into a fresh Claude Code session started in this repo.

---

You are picking up work on **DuelBox**, a browser collection of two-player mini-games.
The repo is `DuelBox/DuelBox-Web`, already cloned. **Read `CLAUDE.md` first** — it is the
constitution and its rules are non-negotiable.

## Where things stand

`main` is green and **CI passes**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build
&& pnpm e2e`. **1,169 unit tests, 165 browser tests** across four Playwright projects —
Desktop Chrome, Pixel 7, and iPhone 14 Pro in both orientations, the last two on **real
WebKit**.

That CI sentence is newer than it sounds. Until 20 August, CI had failed on every commit
since the repository was created — 45 failures, 0 successes — because `pnpm/action-setup`
was given `version: 9` while `package.json` pins `packageManager`, which the action treats
as a conflict and refuses to install. Every job died before its first real step, so nothing
the workflow claimed to verify had ever been verified there. A green tick now means
something.

**~2,160 issues open.** The bulk is the per-game backlog: 14 issues each across the 95
games not yet built.

**Thirteen games play end to end**, each with a `SPEC.md` and 40–80 tests:

| Archetype | Games |
|---|---|
| `turn-board` | Tic Tac Toe, Drop Four, Memory Match, Dots and Boxes, Reversi, Mancala Pits, Ultimate Tic Tac Toe |
| `turn-aim` | Darts |
| `rt-split` | Air Hockey, Pull the Rope, Whack a Mole, Rock Paper Scissors |
| `rt-arena` | Sumo Push |
| `rt-race` | Road Dodge |

Building one closes about twelve of its fourteen issues; the other two (research, art and
audio) are blocked on things that do not exist yet. `docs/game-spec-template.md` and any
of the thirteen `SPEC.md` files are the pattern.

## Start here

1. **Build more games.** It is the highest-value work available and the pattern is
   established: scaffold, rules module with tests, game module, spec, verify in a browser,
   close the twelve issues with evidence. `rt-race` has nothing built, so a game there
   proves the last untested archetype. Checkers, Snowball Throw and Crabby Volley are all
   well-specified in `data/catalog.yaml`.
2. **#2322 needs a decision from a person, and it is blocking design work.** Our two seat
   colours give **1.03:1 contrast under deuteranopia** — indistinguishable, for roughly
   one man in sixteen. Our sky is also within an RGB delta of (3, 40, 3) of a typical
   reference-app blue, which is awkward for an originality epic. The measurements and five
   candidate palettes are in the issue comment. I did not change them: it is the product's
   identity, and `palette-vision.test.ts` records the gap with the 3:1 target named so
   raising the assertion is a one-line change once someone chooses.
3. **#1863 — the declarative layout API.** Games currently place their own geometry and
   the shell letterboxes around it. That works for seven single-board games and will not
   survive the first game wanting a separate control strip per seat.
4. **The precision envelope (#1865's open item).** Pointer position reaches games
   unquantised, so a mouse can aim finer than a thumb. **This now bites**: Darts shipped,
   and `turn-aim` is exactly the archetype where it does. Darts mitigates it locally — its
   keys nudge the reticle at a rate rather than jumping it, so the two families are
   comparable — but the envelope belongs in the engine's input path where every game gets
   it without asking.


## Why platform work first

Every platform fix multiplies by 95. The evidence: all seven games built before the shared
palette existed had invented their own seat colours — four palettes, two disagreeing about which player was the warm colour — so
the scoreboard named a colour that was not on the board. One `SEAT_PALETTE` in the engine
fixed all seven. The same fix after 107 games exist would be 107 corrections.

## The bugs found so far, and how

**Every one was found by running the product, not by reading it.** The suite was green
through all of them.

- **Bot mode was completely broken.** Every bot match in every game froze on the countdown,
  silently. A fresh object literal in a `useEffect` dependency array rebuilt the host, and
  the rebuilt loop was never started because the effect that starts it only fires when the
  *phase changes*. Every browser test used "Play together here", so the entire bot path had
  zero coverage.
- **A tap did not place a mark.** Only a ~150ms hold registered — on a touchscreen the game
  was unplayable. `actionPressed` was *sampled* at step time, so a tap between two steps was
  invisible; and the pointer position was withheld on exactly the step the press was
  reported, so the game got "a press happened" with nowhere to put it.
- **Landscape was unplayable.** A square board rendered 686px tall in a 343px viewport.
- **Seat two could not play on a keyboard.** Enter is its action key, and with focus on any
  button it activated the button instead. Pressing your own action key opened the pause menu.
- **Two games had no keyboard input at all**, while their manifests advertised keyboard
  controls — the shell was telling players about a control that did not exist.
- **Safe-area tokens were inert**, consumed in one place that double-counted them.
- **49 game pages read "about 1 minutes."**

## How to work

- **Run the product.** `pnpm dev` serves on :3000 with its own `.next-dev`, so a build
  cannot clobber it. Drive it with Playwright and take screenshots. Every bug above was
  invisible to a green suite.
- **Prove a test can fail before trusting it.** Break the code, watch it go red, put it
  back. This caught four would-be-vacuous checks in two days:
  - the zero-cost guard matched `output: 'export'` inside the *comment explaining why it
    mattered*, and passed with the setting commented out;
  - the keyboard-play test hashed every 997th canvas byte and stepped straight over the
    cursor it was asserting;
  - the shared-viewport fairness tests passed with the negotiation deliberately inverted,
    because every assertion checked a device sees the whole negotiated box — true of any
    box, including a wrong one;
  - the listener-leak test needed a guard against comparing zero to zero.
- **Beware checks satisfied by a comment.** That has now happened twice.
- **Verify an edit landed.** Two edits to `e2e/offline.spec.ts` silently did nothing —
  scripted `replace` calls whose pattern no longer matched after Prettier reformatted the
  file, reporting success anyway. CI failed twice on an exclusion I believed I had added.
  Read the file back, or check `git show --stat`.
- Close an issue only with evidence: what landed, what was verified, what is still open and
  why. Several issues are deliberately open on a single unmet item.
- If a test encodes old behaviour, change it *and say so in the message*.
- **Do not close an issue on a claim you have not checked.** I closed #2422 asserting
  keyboard-only play worked, then found two games had no keyboard path at all, and had to
  reopen it.

## What twelve games taught, worth knowing before the thirteenth

- **The bot must never see what a human cannot.** It is easy to break and always feels
  like cheating: a Reversi bot counting chains, a Memory bot peeking at face-down cards, a
  Whack a Mole bot seeing a mole before it surfaces. Difficulty belongs in *errors* and
  *search depth*, never in information.
- **A refusal must be distinguishable from a legal move that did nothing.** `-1` rather
  than `0`, `false` rather than a no-op — because "refused" and "legal but scoreless" mean
  opposite things for whose turn it is.
- **Delays in whole simulation steps, never seconds.** And a delay sized in `init` is sized
  before the step rate is known: Rock Paper Scissors' first round lasted one step because
  of exactly that.
- **Shape as well as colour, every time.** Whack a Mole is the sharpest case — telling the
  two seats' moles apart *is* the game, so colour-only would make it unplayable rather
  than merely harder.
- **Write the fixture arithmetic out.** Four Mancala fixtures were wrong before the code
  was, and one Reversi fixture claimed a position that could not exist.

## What is enforced, so you cannot regress it by accident

- `pnpm build` runs **manifest validation**, the **zero-cost guard** (no server runtime, no
  dynamic routes, no gameplay touching the network, a 700 kB session budget) and the
  **bundle secret scan** (17 credential formats, non-public env vars).
- ESLint bans `Math.random`, `Date`, `window`, `document`, `devicePixelRatio`, `screen`,
  `navigator`, `requestAnimationFrame`, `performance` and `matchMedia` across the engine,
  the SDK and every game. `loop.ts` is the one exemption.
- `pnpm typecheck` covers the packages, **every test file**, and the Next app. Test files
  were excluded until 19 August, and seven test doubles claiming `implements Renderer` had
  silently drifted from the interface.
- A breakpoint outside the four named device classes fails a test.

## Backlog hygiene, already done — do not redo

79 issues of pure debt cleared: 56 byte-identical duplicates from a seed script that ran
twice, and 23 legacy issues superseded by the platform backlog. Three legacy issues were
genuinely unique and kept (#11, #31, #2459). Three orphan milestones closed.

## A caution about audits

A multi-agent audit was extremely productive — it found the dependency-array bug — but
**5 of 7 skeptic passes died on a session limit**, and the workflow mapped a failed
refutation to `refuted: false`, which is indistinguishable from "verified clean". Check
that verification actually ran before trusting a verdict.

## Commands

```bash
pnpm dev            # :3000, own .next-dev
pnpm test           # unit
pnpm e2e            # browser, against the static build in apps/web/out
pnpm build          # static export + all three guards
pnpm typecheck      # packages + test files + the Next app
```

## Where to look

| File | What it holds |
|---|---|
| `CLAUDE.md` | The constitution — read first |
| `docs/adr/0001-static-first-hosting.md` | The hosting decision and the measured cost model |
| `docs/threat-model.md` | Risks ranked by likelihood, and what the architecture removes |
| `docs/secure-coding.md` | Ten rules, each mapped to a threat and a tool |
| `docs/presentation.md` | Shared-screen vs single-seat |
| `docs/responsive.md` | Canvas letterboxing and the device classes |
| `docs/input-parity.md` | Where hardware rather than skill would decide a match |
| `docs/play-configurations.md` | Solo, Together, Remote |
| `docs/differentiation-brief.md` | Why this is not a clone; the reviewer's three questions |
| `docs/keyboard-rollover.md` | Why the default bindings are what they are |
| `docs/game-spec-template.md` | The pattern for the remaining 100 games |
| `packages/engine/src/flip.ts` | The clearest example of the fixed-step, device-free style |
| `packages/game-sdk/src/match.ts` | The match state machine every game runs inside |
| `apps/web/src/data/cross-viewport.test.ts` | The cross-device determinism proof |

Start by reading `CLAUDE.md`, then `gh issue list --repo DuelBox/DuelBox-Web --label
priority:P0 --state open`, and work item 1 above — it needs a human decision and blocks the
design epic.
