# Contributing to DuelBox

Read [`CLAUDE.md`](CLAUDE.md) first. It is the constitution, its eleven rules are not
negotiable, and everything below assumes it.

This document covers the two things that document does not: **the boundary around how we
research a reference game**, and the mechanics of working here — branches, commits, the gate,
and how to add a game.

---

## The research scope boundary

This is the paragraph that matters most, so it is first.

**We research a reference app by playing it and writing down what we saw. We never
decompile, unpack, disassemble, or extract from an APK, an app bundle, or any packaged
build.** Not with `apktool`, not with `jadx`, not with `unzip`, not with a decompiler you
found this morning, not "just to check the frame timing", not once. If you find yourself
reaching for one of those tools, stop and say so in the issue. There is no version of this
that is acceptable because the output was only used for reference.

The line is between **mechanics** and **expression**, and it is not arbitrary — it is
roughly where the law puts it, and exactly where honest reimplementation puts it.

**Free to reimplement.** Rules, mechanics, systems, and the idea of a genre. That a
two-player air-hockey game has a puck, two paddles, and a goal at each end is a mechanic.
That a memory game hides pairs face down is a mechanic. Nobody owns those, and reimplementing
them from scratch, from observed behaviour, is legitimate and is most of what this repository
does.

**Never taken, in any form.** Art, sprites, icons, illustration, animation, audio, music,
sound effects, source code, compiled code, exact UI layouts, screen flows copied
element-for-element, fonts, colour palettes lifted wholesale, product names, game names, and
copy. All of that is expression. It is authored, it is owned, and taking it is the failure
that ends the product — not a style disagreement.

The reason the no-extraction rule is absolute even though mechanics are free: **once you
have read their code or opened their assets, you can no longer prove you did not copy them,
and neither can we.** An implementation written from a description of observed behaviour is
independently defensible. One written next to a decompiled listing is not, whatever the
author intended. The rule protects the work, not just the rules.

What this looks like in practice, and what [`docs/reference-analysis.md`](docs/reference-analysis.md)
actually did: install the app, play it, drive it with `adb shell input`, capture screenshots
with `adb exec-out screencap`, and write down the information architecture, the rules, the
timings and the feel — in your own words, as observations. Every game's `RESEARCH.md` is
written that way or it is not written. There are currently zero of them, and that is why
about a hundred "research the reference genre" issues are open rather than closed: they need
a person to play a game, and the shortcut is forbidden.

Three more consequences worth naming:

- **Every shipped asset needs an `assets.license.json` entry** with a source, a licence and
  an author. `scripts/check-asset-licenses.mjs` fails the build without one. The count is
  currently zero, because every game draws with primitives — which is exactly why it was
  cheap to enforce.
- **Names are expression.** Our games are named for what they are, not for what the reference
  app calls them. Check `data/catalog.yaml` before inventing one.
- **Colour is not a free copy either.** Our sky is currently within an RGB delta of (3, 40, 3)
  of a typical reference-app blue, which is awkward for an originality epic and is tracked in
  #2322. Being close by coincidence is survivable; matching on purpose is not.

If you are unsure whether something is mechanic or expression, the test is: **could two
honest teams arrive at this independently?** Two teams both put a puck between two paddles.
Two teams do not both pick the same shade of blue for the same button in the same corner.

---

## Getting set up

```bash
pnpm install
pnpm dev            # :3000, with its own .next-dev so a build cannot clobber it
```

`package.json` requires Node >= 20 and CI runs 22, so build on 22. pnpm comes from the
pinned `packageManager` field — do not install a different one.

## The gate

Six commands, in this order, and CI runs the same six in the same order.

```bash
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```

**`format:check` is first because it is the cheapest and because it is the one that gets
skipped.** CI failed on it for every commit until 20 August 2026 — 56 unformatted files — and
the green tick people were reading belonged to a different workflow. The gate everybody ran
locally omitted it. Run all six or say which you did not.

`pnpm build` is not only a build. It runs the manifest validator, emits the host config, then
the header check, the zero-cost guard, the bundle secret scan, the asset licence check and
the size budget. Any of them can fail it.

`pnpm e2e` includes the visual regression guard: five shell screens compared against the
committed `-linux` baselines in `e2e/__screenshots__`. It skips off Linux, so a change that
moves pixels goes red on the PR, not on your machine — accepting an intended change is two
`gh run download` commands, written up in [`docs/visual-regression.md`](docs/visual-regression.md).

Three things run **nightly** and this gate does not cover them: Firefox, the deep
seat-balance sweep across three bot tiers, and the 70% coverage floor. A change that drops
coverage merges green and is caught the next morning. That is a deliberate trade, written up
in [`.github/workflows/nightly.yml`](.github/workflows/nightly.yml).

### Markdown is not formatted or checked

`.prettierignore` excludes `*.md` and the whole of `docs/`, so `pnpm format:check` says
nothing about any document in this repository, including this one. Keep the line width near
100 by hand.

## Branches

Named `<kind>/<subject>`, lowercase, hyphenated. The kinds in use are the ones in the
history:

| Prefix | For |
|---|---|
| `fix/` | A defect in something that already ships |
| `feat/` | New functionality in the shell, engine or SDK |
| `games/` | One or more game packages |
| `ci/` | Workflows, guards, scripts |
| `docs/` | Documents only |
| `wip/` | Work you expect to rebase or abandon; not for review |

`main` is the default branch. Branch before you commit, always — the git guidance in this
repository is not to commit on `main` directly.

**`main` has no branch protection.** There is no ruleset and no required status check
(`gh api repos/DuelBox/DuelBox-Web/branches/main/protection` returns 404). Nothing mechanical
stops a push that has not passed CI, and `deploy.yml` fires on push to `main` regardless of
whether `ci.yml` is green. That is a real gap, it is why the gate is a discipline rather than
a gate, and it is the first thing to fix if this repository ever has more than a handful of
contributors. See [`docs/release-runbook.md`](docs/release-runbook.md).

## Commits

Look at `git log` and match it. The house style is a **single imperative sentence saying what
changed and, where there is one, what it found** — not a category prefix, not a ticket number
in the subject:

```
Stop the quick-tap test racing the board's opening rotation
Make the per-package typecheck stop lying about test files
Add eight games, and three harnesses that check what fifty issues ask for
Run the coverage gate, and enforce the hook rules that would have caught today's bug
```

- Sentence case, no trailing full stop, ~70 characters.
- No `feat:` / `fix:` prefixes. This repository does not use conventional commits.
- The `, and …` half is the useful half. If fixing something taught you something, the
  commit subject is where the next person finds it.
- **If a change makes an old test wrong, change the test and say so in the message.** A test
  quietly edited to match new behaviour is indistinguishable from a test edited to hide a
  regression.
- Body: the reasoning, not the diff. If a number moved, say what you measured and over how
  large a sample.

## Pull requests

[`.github/pull_request_template.md`](.github/pull_request_template.md) is the checklist and it
is not decorative. Delete a line that genuinely does not apply rather than leaving it
unticked, so an unticked box means something.

`Closes #…` once per issue — GitHub does not parse `Closes #1, #2`.

Review: [`.github/CODEOWNERS`](.github/CODEOWNERS) requires a named reviewer for
`packages/engine`, `packages/game-sdk`, `apps/web/src/components`, `CLAUDE.md`, `scripts/`,
`.github/` and `size-budget.json` — a change to those three packages is a change to a hundred
games, and CI cannot tell a safe engine change from one that quietly alters the fixed
timestep. A single game package is deliberately unowned, so game work is not bottlenecked.

## Definition of done

From `CLAUDE.md`, and the same list as the PR template:

Tests pass · types clean · lint clean · under the size budget · **both seats verified** ·
**both presentations verified** · correct from 320px to 4K in both orientations ·
cross-device match verified against the harness · works on iOS Safari and Chrome Android ·
keyboard accessible · reduced motion respected · **playable in greyscale** · assets licensed

Two of those are load-bearing and routinely skipped:

**Both seats.** Seat two could not play on a keyboard at all for weeks, because Enter is its
action key and with focus on any button it activated the button instead. Nothing in the suite
noticed. Play as seat two.

**Greyscale.** Rule 7 — colour is never the only signal. Every player-owned element must also
differ by shape, pattern or label. Our two seat colours currently measure **1.03:1 contrast
under deuteranopia**, which is indistinguishable for roughly one man in sixteen, so colour is
doing less work than it looks like it is doing.

## Close an issue only with evidence

Say what landed, what you verified, what is still open and why. Several issues in this
repository are deliberately open on a single unmet item, and closing on an unchecked claim
has had to be reversed more than once — #2422 was closed asserting keyboard-only play worked,
and two games turned out to have no keyboard path at all.

**Do not close a per-game issue by declaring it done.** About 356 of them are blocked on
things that do not exist — no `RESEARCH.md` (see the boundary above), no art or audio
pipeline, no networking of any kind, and no hand-verification on real devices — rather than
on effort.

## Prove a guard can fail before you trust it

The habit that has paid best here, and the cheapest one to adopt: **when a rule matters, run
the thing that is supposed to enforce it and watch it fail on purpose.** Break the code, see
the test go red, put it back.

Six guards in this repository were found asserting nothing: `pnpm size` falling through to the
system `size(1)` and reporting on a non-existent `a.out`; the asset-licence check CLAUDE.md
said CI enforced; CI itself red on every commit behind another workflow's green tick; a
balance harness that named a band it did not assert; a coverage gate no workflow invoked; and
the React hook rules, enforced by nothing at all. Five of the six were found in one day, by
looking.

Related traps, each of which has cost real time:

- A check can be satisfied by a **comment**. The zero-cost guard once matched `output: 'export'`
  inside the comment explaining why it mattered, and passed with the setting commented out.
- A **passing grep is not a passing suite.** Filtering `pnpm test` through `grep "Tests "`
  hides a suite that failed to collect. Watch `Test Files` and the count.
- A **mutation that fails to compile** leaves the previous `apps/web/out` in place, so e2e
  runs against the *fixed* build and passes — which looks exactly like a vacuous test.
- **Verify an edit landed.** Read the file back or check `git show --stat`.

---

## Adding a game

Roughly fifteen minutes to a registered, compiling, placeholder-rendering package.

### 1. Check the catalogue row exists

```bash
grep -n "id: <id>" data/catalog.yaml
```

The scaffolder reads the game's name, category, archetype and observed rules from the
generated catalogue. If your game is not in `data/catalog.yaml`, add the row first and run
`pnpm catalogue` to regenerate `data/catalog.generated.json`.

### 2. Scaffold and register

```bash
pnpm create-game <id>                    # lowercase kebab-case; creates packages/games/<id>
node scripts/register-game.mjs <id>      # wires it into the places the shell reads
```

`register-game` is idempotent, so it is safe to re-run after a rebase. **Both scripts edit
shared files, so run them yourself before dispatching parallel work** — two agents running
them at once race, and the losing one silently loses its entry.

### 3. Build once, so the guards can see it

```bash
npx tsc --build packages/games/<id>/tsconfig.build.json
```

The cross-game guards in `apps/web/src/data/` load games from **`dist/`, not `src/`**. Until
this has run, every one of them is testing the placeholder scaffold and failing for reasons
that do not exist.

### 4. Play it

```bash
pnpm dev     # then open /play/<id>
```

Do this before writing any rules. It is the fastest way to learn what the shell already gives
you, and **every bug worth finding in this repository was found by running the product, not by
reading it.** The suite was green through all of them.

### 5. Write it

| File | What goes in it |
|---|---|
| `src/manifest.ts` | Name, archetype, logical size, zone split, orientation, modes, controls strings |
| `src/rules.ts` | The simulation. Pure, deterministic, allocation-free, no pixels |
| `src/game.ts` | Input handling and drawing — the `Game` contract |
| `src/rules.test.ts` | The rules, including the fixtures whose arithmetic you wrote out by hand |
| `src/game.test.ts` | Input, drawing, lifecycle |
| `SPEC.md` | Written from the implementation. `docs/game-spec-template.md` is the pattern |

`packages/games/ping-pong` is the worked example. Read
[`docs/architecture.md`](docs/architecture.md) for what belongs in the game and what the shell
already owns — a bespoke countdown, HUD, pause, result, rematch, rotation or difficulty
selector inside a game package is a bug, not a variation.

### 6. Verify the package properly — both projects

```bash
npx tsc --build  packages/games/<id>/tsconfig.build.json   # rebuilds dist for the guards
npx tsc --noEmit -p packages/games/<id>/tsconfig.json      # typechecks the tests too
```

Both, not either. `tsconfig.build.json` excludes `*.test.ts`, and Vitest transpiles without
typechecking, so you can edit thirty-eight test files, run the first command, see everything
pass and still have left type errors behind. That is issue #2464 and it has recurred.

### What the guards will refuse

Not an exhaustive list, but these are the ones a new game hits:

- A game with **no chunk of its own**, or a chunk over `size-budget.json` — `check-size.mjs`.
- A game **two `easy` bots cannot finish** in ten minutes — `termination.test.ts`. The weakest
  pairing is the one that finds positions nothing resolves; `hard` against `easy` passed with
  Pool's stalemate rule deleted.
- A bot spending **more than a frame** on one step — `bot-cost.test.ts`.
- A `turn-*` game that never says **whose turn it is**, or an `rt-*` game claiming turns —
  `turn-seat.test.ts`.
- A manifest offering **both keyboard halves** as one player's choice — `controls.test.ts`.
- `Math.random`, `Date`, `window`, `document`, `navigator`, `performance`, `matchMedia`,
  `screen`, `devicePixelRatio` or `requestAnimationFrame` anywhere in a game — ESLint.

## Things twenty-nine games taught, before you write the thirtieth

- **The bot never sees what a human cannot.** Difficulty lives in *errors* and *search depth*,
  never in information. A Memory bot peeking at face-down cards is the easy mistake.
- **Draw the bot's error once and hold it.** A fresh random error sixty times a second
  averages to zero, so every tier plays identically. Use
  `packages/game-sdk/src/bot-judgement.ts` rather than writing the counter a fourth time.
- **Measure the tiers; never assume them.** Every real-time bot here has had a lever pointing
  the wrong way on the first attempt. In Dice Yatzy, three of four "experts do this" settings
  made it play worse, one by 6.3 points a game. Penalty Kicks' difficulty tiers turned out to
  be worth nothing at all — the 63% "skill" gap was first-kicker advantage.
- **A refusal must be distinguishable from a legal move that did nothing.** `-1`, not `0`.
- **Delays in whole simulation steps, never seconds** — and a delay sized in `init` is sized
  before the step rate is known.
- **Mirror-symmetry testing finds seat bias nothing else does.** Mirror the board, mirror the
  inputs, require mirrored results. It found a tie-break written in board coordinates that was
  not covariant under the half-turn.
- **Write the fixture arithmetic out by hand.** Four Mancala fixtures were wrong before the
  code was.

## Working alongside other agents

If more than one agent or person is editing this repository at once, read
[`docs/parallel-work.md`](docs/parallel-work.md) before starting. The short version:

- **File territories isolate; `HEAD` does not.** Never change branches in a working directory
  someone else is using — `git worktree add` instead.
- **Recover one file, not a path.** `git checkout <ref> -- <dir>` is a silent revert of
  everything else under it. Use `git show <ref>:<path> > <path>`.
- **A red test is evidence about the tree, not about the agent that found it.** Ask what else
  was in flight before acting on a failure report.

## Reporting a security problem

Do not open a public issue. Use the private advisory route in [`SECURITY.md`](SECURITY.md),
which also states what is in and out of scope — cheating in a local match, for instance, is
not a vulnerability.
