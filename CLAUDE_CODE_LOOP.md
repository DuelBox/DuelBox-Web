# Claude Code loops

Three loops. Run them in order.

1. **Research loop** — play the reference app on the emulator, document mechanics, refine specs.
2. **Backlog loop** — file and groom issues.
3. **Build loop** — pick the top issue, implement, PR, repeat.

---

## Setup

```bash
gh auth login                        # needs repo scope
cd DuelBox-Web
pip install pyyaml

python scripts/seed_issues.py --repo DuelBox/DuelBox-Web --dry-run   # inspect
python scripts/seed_issues.py --repo DuelBox/DuelBox-Web             # ~575 issues
```

Seeding takes about 8-15 minutes. It is idempotent — rerun it any time you add
games or templates. Add `--project 1` to also place created issues on the
DuelBox org project board.

---

## Loop 0 — Repo constitution

`CLAUDE.md` at the repo root is the constitution. Claude Code reads it on every
session, and it is what stops the build loop drifting. Do not weaken its rules.

---

## Loop 1 — Emulator research

**Scope boundary, stated once so the loop never crosses it:** observe by playing.
Do not decompile, unpack, or extract. The output is a written description of how a
genre plays, which is then implemented from scratch.

Launch the emulator, install the reference app, hand Claude Code the terminal, then:

```
You have adb access to a running Android emulator.

For each game in data/games.yaml, one at a time:

1. Play the corresponding genre in the reference app for ~3 minutes.
   Use `adb shell input` and `adb exec-out screencap` to interact and observe.
2. Write down ONLY observable behaviour:
   - round length from start to result screen
   - control mapping and how many inputs per player
   - how the game communicates its rules in the first 5 seconds
   - difficulty ramp: what changes as the match progresses
   - feedback timing: how long between an input and its visible result
   - what the result screen offers next
3. Append findings to packages/games/<id>/RESEARCH.md under
   "Observed behaviour". Describe in your own words. Do not screenshot,
   trace, or reproduce any art, layout, or text.
4. Open the matching "[Name]: write the game spec" issue and comment with
   the two or three findings that should change our spec.

Do not decompile the APK. Do not extract assets. Do not read the app's
resources, code, or data files. If you find yourself reaching for apktool,
jadx, or unzip on the APK, stop and say so.

Stop after 5 games and summarise.
```

---

## Loop 2 — Backlog grooming

Run once after seeding, then weekly.

```
Read data/games.yaml, data/issues.yaml, and the open issues in this repo.

1. Find gaps: work implied by an existing issue's acceptance criteria that
   has no issue of its own. File each one, granular enough that a single
   PR closes it.
2. Find issues over 8 points and split them into issues of 3 or less.
3. Find duplicates and close the weaker one with a link to the survivor.
4. Add `blocked` and a dependency note to any issue that cannot start yet.
5. Promote the launch-six game issues (ping-pong, air-hockey, tic-tac-toe,
   sumo-push, drop-four, quick-draw) to milestone "M1 First Playable".
6. Label groomed, unblocked, dependency-clear issues `milestone-ready`.
7. Report: total open, points per milestone, and the three biggest risks.

Use `gh issue create`, `gh issue edit`, `gh issue comment`. Do not close
anything without saying why in a comment.
```

**Splitting rule:** if an issue's title needs the word "and", it is two issues.

---

## Loop 3 — Build

The one that runs for weeks. `scripts/run-loop.sh` drives it. The per-iteration
prompt lives at `prompts/build-iteration.md` — one issue per iteration, verify
before PR, stop after one.

```bash
./scripts/run-loop.sh DuelBox/DuelBox-Web 20
```

Stopping after one issue matters. An agent that chains issues without a
checkpoint compounds a wrong assumption across a dozen files before anyone sees it.

---

## Ordering

```
engine loop + input abstraction   ← everything blocks on these
        ↓
game SDK contract + match flow
        ↓
6 launch games (ping-pong, air-hockey, tic-tac-toe,
                sumo-push, drop-four, quick-draw)
        ↓
shell UI + tournament mode        ← first shippable build
        ↓
remaining 38 games in parallel    ← now genuinely parallelisable
        ↓
3D landing + SEO + analytics + legal
        ↓
online multiplayer
```

Do not start game work before the input abstraction lands. Six games built
against a provisional input API means six rewrites.
