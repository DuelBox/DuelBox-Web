# Research status — what was observed, what was not, and what is blocked on a person

This file answers issue #2514: *"No game has a RESEARCH.md, so 214 research and spec issues
are open by definition."* The premise is right and the arithmetic is not. This is the count,
how it was taken, and what a person would have to do to change it.

It exists because the gap it describes is currently invisible. A game whose rules came from
an hour of play and a game whose rules came from one sentence on a pre-game screen look
identical in this repository — same `SPEC.md`, same tests, same catalogue row. Until the
observation is actually done, the least dishonest thing available is to write down which of
the two every game is.

<!-- The two figures below are asserted by apps/web/src/data/research-provenance.test.ts.
     Change the files and the test will tell you to change the sentence. -->

**107 of the 107 reference-derived games have no `RESEARCH.md`.**

**107 research issues are open, and no agent can close any of them.**

---

## The count, and how it was taken

| | |
|---|---|
| Game directories under `packages/games/` | 108 |
| `SPEC.md` files | 108 |
| `RESEARCH.md` files | **0** |
| Catalogue rows in `data/catalog.yaml` | 108 |
| — of those, `confidence: observed` (a reference-app game) | 107 |
| — of those, `confidence: original` (ours: `cricket`) | 1 |
| Open per-game research issues | **107** |
| Open per-game spec issues | **0** |

```
find packages/games -name RESEARCH.md | wc -l          # 0
find packages/games -name SPEC.md      | wc -l         # 108
gh issue list --label type:research --state open       # 107, all per-game
gh issue list --label type:spec      --state open      # 24, none per-game
```

The 107 open research issues are exactly the 107 `confidence: observed` games. The
correspondence is exact and worth stating: `cricket` is our own game, has no counterpart in
the reference app, and has no research issue — correctly, because there is nothing to go and
observe. (It has no research issue by accident rather than by rule: it was added to the
catalogue after the last seeding run. `scripts/seed.py` now skips the research template for
`confidence: original` games so a future run cannot create one.)

### #2514's "214" should be 107

The issue counts 107 research issues plus 107 spec issues. **All 108 per-game spec issues are
already closed** — the 24 open `type:spec` issues are platform and meta issues, including
#2514 itself. The spec issues were never blocked, for a reason the issue body loses by
quoting `game_templates.yaml` line 40 with its second half removed:

> quoted in #2514: *"Every rule traces to a RESEARCH.md observation."*
>
> line 40 in full: *"Every rule traces to a RESEARCH.md observation **or an explicit, flagged
> design decision**"*

That escape hatch is not theoretical, and it is not a loophole somebody found later — it is
the convention `docs/game-spec-template.md` mandates in its own words ("Mark anything that is
our decision rather than an observation with **[ours]**"), and the specs use it: **103 of the 108
`SPEC.md` files carry `[ours]` markers, and 93 say "Written from the implementation, not before
it."** The specs are not pretending to be grounded in observation. They say plainly
that they are not, game by game and decision by decision. That is the criterion being met,
not dodged.

So the honest headline is not "214 issues are open by definition". It is: **107 research
issues are blocked on a person, and the spec issues that depend on them were closed correctly
by flagging every rule as ours.**

### One closed research issue, closed on nothing

`#1509 [Whack Attack] Research` is the single closed per-game research issue. It was closed on
2026-08-19 with all three acceptance boxes unticked and no file at the
`packages/games/whack/RESEARCH.md` its own action item names — a path that does not exist,
because the game is `whack-a-mole` and `whack` is a stale id. `whack-a-mole` still has its own
open research issue.

Nothing detected any of that, which is the point. This is the seventh instance of the pattern
CLAUDE.md already lists six of: **an acceptance criterion that nothing executes.** The others
were caught by running the guard and watching it fail. This one cannot be caught that way,
because nothing was ever written to run.

---

## What *was* observed

Observation did happen, and it is real. It is recorded in `docs/reference-analysis.md` and
`docs/observed-rules.md`: the app on a rooted Android emulator, driven with `adb shell input`
and captured with `adb exec-out screencap`, session 2026-08-19. No APK was unpacked or
decompiled. It just did not go as deep as `RESEARCH.md` asks, and it stopped in a place that
is easy to mistake for having gone further.

Three tiers, and they are very different sizes:

**Tier A — one game played through a full match.** Mini Golf, in `reference-analysis.md` §7:
turn structure, the drag-and-release putt, that holing out scores and immediately hands over
with the 180° flip, the *lead by 2* win condition, per-hole obstacle escalation (hole 1 an
empty rectangle, hole 2 two diamond blocks), and the feedback order at the end of a turn. This
is the only game in the catalogue with in-play observation on record.

**Tier B — eight games with a recorded implication.** Guess the Person, Ultimate Tic Tac Toe,
Crash It, Throw, Wheelie, Shut the Box, Brainrot Stack, Slot Cars (`reference-analysis.md` §4)
have their pre-game rule text plus a note on what it implies for the build. Still not play.

**Tier C — all 107 games, pre-game screen only.** From `observed-rules.md`: the reference
app's own name for the game, its one-line rule statement transcribed verbatim, which of the
three modes it offers, and whether it has an options gear. Plus, from `reference-analysis.md`,
the seven games badged online-capable.

**Platform-wide**, and this is the strongest part of the record: information architecture,
the card grid, the shared pre-game screen, the in-match HUD, the 180° seat rotation and
recolour, red-P1/blue-P2, tournament structure, and that every game offers a bot. This is what
CLAUDE.md sends you to `reference-analysis.md` for before touching engine or SDK code, and it
is well supported.

`reference-analysis.md` closes by saying exactly where it stops:

> *"Per-game mechanics beyond the above are recorded in each game's own research issue — they
> are filled in by playing that specific game, never guessed."*

That sentence is the whole gap. The deferral was deliberate and documented; what never
happened is the thing it deferred to.

---

## What is UNKNOWN, for all 107 games

The research issue's action items name the fields. Every one of them is **UNKNOWN for every
game**, with a single reason: *no one played this game; only its pre-game screen was read.*
Mini Golf is the one partial exception, in the column below.

| Field the research issue asks for | Observed for | Status |
|---|---|---|
| Exact rules, as they play | 0 of 107 | **UNKNOWN** — the pre-game blurb is one sentence and settles almost nothing |
| Round length, start to result | 0 of 107 | **UNKNOWN** — every `roundSeconds` in the repo is ours |
| Control mapping per seat | 0 of 107 | **UNKNOWN** — the blurb sometimes names one gesture, never a seat mapping |
| What the first five seconds teach | 0 of 107 | **UNKNOWN** |
| Difficulty ramp | 0 of 107 | **UNKNOWN** |
| Feedback timing | 1 of 107 (Mini Golf) | **UNKNOWN** for the rest |
| What the result screen offers | 0 of 107 | **UNKNOWN** per game; the shared shell's result screen is described platform-wide |
| Win triggered deliberately | 0 of 107 | **UNKNOWN** |
| Loss triggered deliberately | 0 of 107 | **UNKNOWN** |
| Draw triggered deliberately | 0 of 107 | **UNKNOWN** |
| Timeout triggered deliberately | 0 of 107 | **UNKNOWN** |
| Boundary conditions triggered | 0 of 107 | **UNKNOWN** |
| Rapid input, no input, simultaneous input | 0 of 107 | **UNKNOWN** |

Our answers to most of those rows exist — they are in each game's `SPEC.md`, measured against
the implementation and marked `[ours]`. **They are not observations and must never be copied
into a `RESEARCH.md` as if they were.** A `RESEARCH.md` whose fields were filled from our own
`rules.ts` would say the reference app does what we do, which nobody checked, and would launder
a guess into the record. That is worse than the empty gap, because the gap is at least visible.

### Why 107 near-identical `RESEARCH.md` files were not written

The template's criterion — *"every field of the observation template filled or explicitly
marked UNKNOWN"* — does permit a file that is entirely UNKNOWN, and writing 107 of them would
technically satisfy it. That is the argument against doing it. It would convert an unmet
criterion into a met one without a single new observation, and hand somebody 107 closeable
issues. The table above says the same thing once, truthfully, and cannot be mistaken for work.

Two smaller reasons: the observed material is already recorded verbatim in
`observed-rules.md` and cited by the specs, so per-game copies would be duplication that can
drift; and **the observation template the criterion refers to does not exist** — nothing in
the repository defines it, so "every field" has no referent. The field list in the table above
is reconstructed from the research issue's own action items, which is the closest thing there is.

---

## What a person would have to do

Only one route makes the criteria honest without changing them: **play the reference game and
write down what you see.** Three minutes per game with both seats, the floor the issue's own action
item sets, is five and a half hours of play across 107 games before a word is written, and
three minutes is nowhere near enough to trigger the win, loss, draw, timeout, boundary and
simultaneous-input cases the third action item also asks for. It cannot be delegated to an
agent. CLAUDE.md rule 2 permits exactly one method and it requires hands and eyes:

> *"Reference apps are researched by playing them and writing down what is observed."*

If that is not going to happen for all 107, the criteria should change to describe what the
project will actually do, rather than staying as a criterion nothing checks and nobody meets.
The exact edits, for whoever decides:

**Option 2 — drop the artefact.** In `data/game_templates.yaml`, replace the research
template's line 24 acceptance criterion with one naming an artefact that will exist, and line
40's "RESEARCH.md observation" with `docs/observed-rules.md`. Cheapest, and it gives up the
distinction between observed and derived entirely.

**Option 3 — require it only where the genre does not settle the rules** (what #2514 favours,
and what the evidence supports). Add a `research: required | genre-derived` field per game in
`data/catalog.yaml`; gate the research template in `scripts/seed.py` on it, the way the
`confidence: original` skip now works; and for `genre-derived` games have the spec issue
require the sentence the specs are largely already writing. Chess and Checkers do not need an
emulator to know how they play. *Hand Slap*, *Pop It*, and *Light Fingers* are not decidable
from their names, and those are where observation buys something.

Either way the decision is a person's. Nothing in this pass changed a single acceptance
criterion, and nothing here should be read as authority to close a research issue.

---

## What this pass did change

- **Removed a false claim from the site.** `scripts/generate_catalog.py` emitted
  `researched: bool(rule)` under the comment *"False when the game still has an open research
  issue"*. It was `true` for all 108 games while 107 research issues were open, because every
  game has a rule blurb and that is all the expression tested. Its only reader, the home page's
  `featured` filter, removed nothing — so the falsehood was invisible from the page as well as
  from the data. Both are gone; the rendered page is unchanged.
- **Removed a false claim from the seeder.** `scripts/seed.py` attached *"Recorded by playing
  the reference game"* to every game's rule blurb — a line that was read off a pre-game screen,
  not recorded by playing, and that for `cricket` claimed a reference game that does not exist.
  It now states its real provenance, and says per game that no `RESEARCH.md` exists.
- **Made a dead branch live.** The seeder's *"Mechanics for this game are not yet confirmed"*
  caveat was gated on `confidence == "research"`, a value no catalogue row has ever held, so it
  had never printed once. It is now gated on the RESEARCH.md that is really absent.
- **Added the missing guard.** `apps/web/src/data/research-provenance.test.ts` fails if a
  research-provenance field reappears in the catalogue before the files it would describe do,
  if `observed-rules.md` stops holding exactly one transcription per observed game or stops
  agreeing with `catalog.yaml` about which reference game each row was read from, if a
  catalogue rule turns out to be a copy of the transcription rather than our own words, or if
  either coverage figure — that file's and this one's — stops matching what is on disk.

  That rule-text assertion used to be the exact opposite: it required the catalogue rule to be
  the transcription **verbatim**. #2513 item 7 then rewrote all 108 rules out of the reference
  app's voice and into ours, which is what CLAUDE.md rule 1 requires of a string that ships as
  a page's `<meta>` description — so the old assertion could only have been satisfied by
  putting the borrowed copy back. The transcription stays on file as evidence and the
  catalogue is now independent of it, so the guard checks that independence instead of
  sameness: no rule may be the transcription, and none may share eight words in a row with it.
  Both halves were watched failing on purpose, and so were the coverage and reference-name
  assertions that replaced the equality check's other job.

## Recommendations not acted on

- **Mini Golf's spec does not use the one in-play observation we have.**
  `packages/games/mini-golf/SPEC.md` quotes the one-line blurb, says it settles nothing about
  hole count or layout, and marks the round structure `[ours]` — while
  `reference-analysis.md` §7 records observed per-hole obstacle escalation and the
  score-then-flip order for this exact game. The spec understates our evidence rather than
  overstating it, which is the safe direction, but it should cite §7.
- **`wheelie`'s modes disagree three ways**: `catalog.yaml` says `friend,bot,solo`, its
  manifest says `['friend', 'bot']`, and `observed-rules.md` records `friend, solo`. The
  catalogue/observation difference is deliberate and flagged with a `modesNote`; the manifest
  is a third answer that nothing compares. `catalogue-agrees.test.ts` checks `roundSeconds` and
  `name` between catalogue and manifest, but not `modes`.
- **`#1509` should be reopened or deleted** rather than left as a closed research issue for a
  game id that does not exist.
