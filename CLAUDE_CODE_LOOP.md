# Claude Code loops

Three loops. The research loop feeds the backlog; the backlog feeds the build loop.

---

## Setup

```bash
gh auth login                 # needs repo scope
pip install pyyaml

python scripts/seed.py --repo DuelBox/DuelBox-Web --dry-run    # inspect
python scripts/seed.py --repo DuelBox/DuelBox-Web --project 1  # create
```

The seeder is idempotent and resumable: it skips any issue whose exact title
already exists, so rerun it any time a game or template is added. It backs off
automatically when GitHub applies a secondary rate limit.

---

## Loop 1 — Emulator research

**The boundary, stated once so the loop never crosses it: observe by playing.**
Do not decompile, unpack, or extract. The output is a written description of how a
genre plays, which is then implemented from scratch.

The app renders its text to canvas, so nothing is readable through `uiautomator` —
every observation comes from screenshots and interaction. That is by design.

Run this against the open `[Game] Research:` issues, one game at a time:

```
You have adb access to a running Android emulator with the reference app installed.

Take the lowest-numbered open issue titled "[<Game>] Research: ...".

1. Launch the app, find that game, and open its pre-game screen.
   Record the rule text, which play modes it offers (friend / bot / solo),
   and whether it has a per-game options gear.
2. Play it for at least three minutes driving BOTH seats with
   `adb shell input` and observing with `adb exec-out screencap`.
3. Deliberately trigger: a win, a loss, a draw if possible, a timeout,
   a boundary condition, rapid input, no input, and simultaneous input.
4. Record ONLY observable behaviour:
   - exact rules and how the win condition is expressed
   - round length from start to result screen
   - control mapping per seat, and how many inputs each player has
   - what the first five seconds teach without words
   - difficulty ramp: what changes as the match progresses
   - feedback timing between an input and its visible result
   - what the result screen offers next
5. Write it to packages/games/<id>/RESEARCH.md under "Observed behaviour",
   in your own words. Mark anything you could not verify as UNKNOWN.
6. Comment on the research issue with the two or three findings that should
   change the spec, then close it.

Do not decompile the APK. Do not extract assets. Do not read the app's
resources, code, or data files.

Stop after 5 games and summarise.
```

---

## Loop 2 — Backlog grooming

Run after seeding, then weekly.

```
Read data/catalog.yaml, data/platform_issues.yaml, and the open issues.

1. Find gaps: work implied by an issue's acceptance criteria that has no issue
   of its own. File each one, small enough that a single PR closes it.
2. Split anything larger than a single working session. If a title needs the
   word "and", it is two issues.
3. Close duplicates, always with a comment linking the survivor.
4. Add `blocked` plus a dependency note to anything that cannot start yet.
5. Label groomed, unblocked, dependency-clear issues `ready`.
6. Report: total open, count per milestone, and the three biggest risks.

Never close anything without saying why in a comment.
```

---

## Loop 3 — Build

The one that runs for weeks. Driven by `scripts/run-loop.sh`, one issue per
iteration, using `prompts/build-iteration.md`.

```bash
./scripts/run-loop.sh DuelBox/DuelBox-Web 20
```

Stopping after one issue matters. An agent that chains issues without a checkpoint
compounds a wrong assumption across a dozen files before anyone sees it.

---

## Ordering

```
repo + CI + design tokens
        ↓
engine loop + seats + input abstraction   ← everything blocks on these
        ↓
game SDK contract + match flow + HUD
        ↓
first playable games, one per archetype
   (turn-board, turn-aim, rt-split, rt-arena, rt-race)
        ↓
shell UI + catalog + tournament           ← first shippable build
        ↓
remaining games in parallel               ← now genuinely parallelisable
        ↓
3D landing + SEO + PWA + analytics + legal
        ↓
online multiplayer
```

Do not start game work before the input abstraction and the seat system land.
Games built against a provisional input API are games built twice.

Build one game per archetype first. Once an archetype is proven, the rest of its
group are variations on a solved problem — that is the whole reason the catalog is
tagged by archetype.
