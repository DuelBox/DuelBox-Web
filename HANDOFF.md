# DuelBox — handoff prompt

Paste everything below the line into a fresh Claude Code session started in this repo.

---

You are picking up work on **DuelBox**, a browser collection of two-player mini-games.
The repo is `DuelBox/DuelBox-Web`, already cloned. **Read `CLAUDE.md` first** — it is the
constitution and its rules are non-negotiable.

## Where things stand

`main` is green and **CI passes** — verified. The gate, in the order CI runs it:

```
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```

**2,509 unit tests, 297 browser tests** across four Playwright projects — Desktop Chrome,
Pixel 7, and iPhone 14 Pro in both orientations, the last two on **real WebKit**.

That sentence has been wrong twice, so it is worth saying exactly what was fixed.

First: until 20 August, CI failed on every commit since the repository was created — 45
failures, 0 successes — because `pnpm/action-setup` was given `version: 9` while
`package.json` pins `packageManager`, which the action treats as a conflict and refuses to
install. Every job died before its first real step.

Second, and this document asserted otherwise: once the install was fixed, CI still failed
on every commit — on `pnpm format:check`, its **first** step, with 56 unformatted files.
The green tick people were reading belonged to the Security workflow, which runs
separately and did pass. The gate everyone was running locally omitted `format:check`
entirely, so the repository looked green from both directions and was not. Both are fixed
now, and CLAUDE.md spells the gate out so "I ran the gate" and "CI will pass" mean the
same thing.

Three other guards this project's own rules claimed to have, and did not:

- **`pnpm size`** did not exist. Rule 11 and the definition of done both require it, so
  `pnpm size` fell through to the system `size(1)`, which reported on a non-existent
  `a.out` and exited 0. There had never been a size budget. `scripts/check-size.mjs` now
  budgets the shell (274.1 KB gzipped) and each game's chunk (2.5–3.9 KB), and fails if
  any playable game has no chunk of its own.
- **Asset licensing** was not enforced either, though rule 3 says "CI enforces it".
  `scripts/check-asset-licenses.mjs` now does. The count is currently zero — every game
  draws with primitives — which is exactly why it was cheap to write today.
- **`roundSeconds` ends nothing.** Every manifest declares it, the schema validates it, and
  the only thing that reads it is the catalogue card printing "about 5 min". Two games have
  now shipped unable to finish — a survival mode, and a frame of Pool — and Air Hockey was
  a third, found by the guard below rather than by accident.

The lesson worth carrying: **a rule written in CLAUDE.md is not a rule that runs.** When
one of them matters, check whether anything actually executes it. Three of them did not.

### The guards that now exist

Each was checked by making it fail before being trusted:

| | What it refuses |
|---|---|
| `check-size.mjs` | a game chunk or the shell over budget, or a game with no chunk of its own |
| `check-asset-licenses.mjs` | any shipped image, sound, video or font without a source, licence and author |
| `termination.test.ts` | any game two `easy` bots cannot finish in ten minutes of play |
| `bot-cost.test.ts` | a bot spending more than a frame on one step, ceiling calibrated to the machine |
| `turn-seat.test.ts` | a `turn-*` game that never says whose turn it is, or an `rt-*` game that claims turns |
| `controls.test.ts` | a manifest offering both keyboard halves as one player's choice |

The termination one is worth a note: the first version played `hard` against `easy` and was
worthless — it passed with Pool's stalemate rule deleted, because that pairing finishes by
potting the black. **The weakest pairing is the one that finds positions nothing resolves.**

**~1,910 issues open.** The bulk is the per-game backlog: 19 issues each across the 78
games not yet built, of which about twelve are closeable by building the game.

**Twenty-nine games play end to end**, each with a `SPEC.md` and 38–90 tests:

| Archetype | Games |
|---|---|
| `turn-board` | Tic Tac Toe, Drop Four, Memory Match, Dots and Boxes, Reversi, Mancala Pits, Ultimate Tic Tac Toe, Checkers, Colour Wars, Pop It, Shut the Box, Sea Battle, Dice Yatzy, Ludo Dash |
| `turn-aim` | Darts, Cornhole, Pool, Bowling |
| `rt-split` | Air Hockey, Pull the Rope, Whack a Mole, Rock Paper Scissors, Hand Slap, Crabby Volley, Hot Potato, Mini Soccer, Penalty Kicks |
| `rt-arena` | Sumo Push, King of the Yard, Snake Clash |
| `rt-race` | Road Dodge |

Building one closes about twelve of its nineteen issues. The rest are blocked on things
that do not exist: research means playing the reference genre (a person's job), art and
audio means an audio pipeline nobody has built, and the QA and remote-play issues wait on
the cross-device harness in #1862. `docs/game-spec-template.md` and any of the twenty-seven
`SPEC.md` files are the pattern.

**Every game so far has found a platform bug.** That is the real reason to keep building
them, and it has not stopped being true at twenty-seven: Mini Soccer found five lying
control strings, Shut the Box found that the engine dropped quick taps of direction keys in
every keyboard game, Sea Battle found that a game's zone split could not change mid-match,
Dice Yatzy found a bot weighting that preferred 30 in sixes to a 50-point yatzy, and Pool
found that a match had no way to end — which then found the same hole in Air Hockey,
Bowling found that the ball sailed on for eight seconds after every delivery, and Ludo Dash
found a stuck state a human could reach with no move and no pass, Snake Clash found that a
`getActiveSeat` returning null was being refused by our own guard, and Penalty Kicks found
that the bot-cost guard failed on a single garbage collection.

**Two habits earned their keep repeatedly.** *Measure the thing you are about to argue
about* — Ludo's capture-avoidance was worth −0.2 points, Dice Yatzy's straight-chasing cost
6.3, and Penalty Kicks' difficulty tiers turned out to be worth **nothing** until identical
bots were played against each other and the 63% "skill" gap proved to be first-kicker
advantage. *And look at it in a browser* — Bowling's ball flew for eight seconds after every
delivery, Ludo's status line sat under the board, and Penalty Kicks drew both players'
cursors on a shared goal, which simply hands the keeper the answer.

**Bots now think under a node budget** (`SearchBudget` in the SDK). The five searching games
were spending up to 31.5 ms on the single step a bot commits to a move — twice a 60 Hz
frame on a development machine, several frames on a phone. A stopwatch is the wrong
instrument, because the depth reached would then depend on the device and rule 8 forbids
that; counting nodes is deterministic. The ceiling was picked by measuring the trade —
1,500 nodes keeps 87.5% of the strongest tier's edge against 93.3% unbounded, for a fifth
of the cost.

## Start here

1. **Build more games.** It is the highest-value work available and the pattern is
   established: scaffold, rules module with tests, game module, spec, verify in a browser,
   close the twelve issues with evidence. All five archetypes have at least one game, so any
   of the 80 remaining is a matter of picking a well-specified one from `data/catalog.yaml`.

   Two habits are worth copying rather than rediscovering. **Mutate every test until it
   fails before trusting it** — roughly one in six turned out to prove nothing, and two of
   those were hiding real bugs. And **measure the bot rather than reasoning about it**: in
   Dice Yatzy, three of four "experts do this" settings made it play worse, and one of them
   cost 6.3 points a game.
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
- **A match decided by survival never ended.** The host reported the winner only when one
  of the two *score numbers* changed, and a crash changes neither, so Road Dodge played to
  its end and sat frozen behind a live pause button. Twelve games had shipped without
  hitting it because every one of them scores points.
- **A tap in the far half of the device did nothing, on every turn-based shared board.**
  Seat zones exist so two people playing at once each own their touches; on a board that
  rotates to face whoever has the move, the far side sits in the *other* seat's zone and
  every tap there was dropped. In Tic Tac Toe the far row could not be reached by touch at
  all. Ten games had it. It hid because the tap test aimed at a point commented as "well
  clear of the seat midline" — that is, only where it already worked.
- **Drop Four could not be played by tapping**, and had shipped that way. It waited for a
  *later* step to see the release, but a quick tap puts press and release on one step. The
  same bug had already been fixed in Tic Tac Toe; the test only covered Tic Tac Toe.
- **A rotating board that is not centred in its logical box moves when it turns.**
  `pushRotation` turns about the logical centre, so Pop It's sheet jumped across the screen
  between turns and the second player's taps landed on nothing.
- **The renderer never clipped to the logical box**, so a board turning through the seat
  flip painted fragments over the letterbox bars — one player seeing outside the shared
  viewport, which is a rule 9 problem rather than a cosmetic one.
- **Three of the site's own navigation links 404ed** on every page: `/tournament/`,
  `/how-to-play/` and `/privacy/`.
- **Portrait games were unplayable in landscape**, rendering an 85px-wide board on a phone
  held sideways, because two scoreboards took the height.
- **The site header had no safe-area inset at all**, so on a notched phone its brand,
  navigation and Play button sat under the cutout. The play surface had none either, which
  put the pause button in the home-indicator band. The unit test listing which surfaces
  inset themselves had holes, and that list *was* the check.
- **The pause panel could not fit a phone held sideways** — 146px tall in a 343px window
  with its top at -31, so the heading was off-screen and the first button unreachable.
- **A live match could be thrown away by pull-to-refresh.** The canvas declared
  `touch-action: none`, but a swipe starting on the letterbox beside the board never
  touches the canvas.
- **Every game landing page said "This game is still being built"**, including the
  twenty-two that were playable, with no link offered to the game one click away.
- **The controls panel never said which keys were whose.** "W A S D or the arrow keys"
  tells a player what the game accepts, not what is theirs.

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
- **A passing grep is not a passing suite.** Filtering `pnpm test` output through
  `grep "Tests "` hides a suite that failed to *collect* — the summary line still prints.
  Watch `Test Files` too, or the count.
- **Check the build succeeded before trusting a mutation.** A mutation that fails to
  compile leaves the previous `apps/web/out` in place, so the e2e suite runs against the
  *fixed* build and passes — which looks exactly like a vacuous test.
- **Assume nothing is a new file.** I overwrote `tokens.test.ts` believing I had created
  it, silently destroying six tests.
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
- **A bot's error must be drawn once and held, never re-rolled per step.** A fresh random
  error sixty times a second averages to zero, so the bot sits on exactly the right answer
  however large its supposed inaccuracy and every tier plays identically. This has now been
  written wrong three times — Road Dodge, Crabby Volley, King of the Yard — so it lives in
  `packages/game-sdk/src/bot-judgement.ts` with the measurements that justify it. **Use it
  rather than writing the counter again.**
- **Measure a bot's tiers; never assume them.** Every real-time bot in this repository has
  had at least one lever pointing the wrong way on the first attempt: looking further ahead
  was worse, jumping more was worse, a wrong-way mistake barely graded. Play the tiers
  against each other and count.
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
