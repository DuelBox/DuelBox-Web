# Manual playtest protocol and score sheet

Automated tests cannot tell you a game feels bad or that the controls are confusing (#228).
The suite proves a game *runs*; it cannot prove a first-time pair understands it, or that a
round ends before either player is bored. This is the manual pass that answers those, and
**a game is not marked done until it has one recorded** (issue #228's acceptance criterion).

It complements, and does not replace, the harnesses and guards. Where a property can be
measured deterministically it already is — seat balance (`balance-aggregate`), control parity
(`control-parity.test.ts`), termination (`termination.test.ts`), greyscale legibility
(`greyscale`). This sheet is for the four things only a person watching a person can judge.

## When to run it

Once per game, by one tester, before the game's "build the game" tracker is closed — and
again after any change to that game's controls, layout, or bot difficulty. It is a
single-tester pass on the four dimensions below; the **moderated ten-pair sessions** with
strangers are a separate, heavier activity (QA issue #229) and are not this.

Run it in a real browser on a real device, not against a unit test. Every platform bug this
project has found was found by running the product, not by reading it (HANDOFF.md). Run it in
at least two of: touch on a phone, keyboard on a laptop shared by two people, and one seat
against a bot — because a game can be clear on one input and baffling on another.

## The four dimensions

Each is scored **1–5**, with 3 the pass line. Anything below 3 blocks "done" and becomes an
issue (see the last section). Write one concrete sentence of evidence for every score — a
number with no observation behind it is the failure mode this sheet exists to avoid.

### 1. Control clarity

*Can each player tell, without being told, what their controls are and that they are theirs?*

- The controls panel names which keys are whose, not just what the game accepts ("W A S D or
  the arrows" tells a player what exists, not what is *theirs* — a bug this project shipped).
- On touch, the first tap does something visible and correct — no dead hold-to-register.
- Seat two's controls work as readily as seat one's (Enter-opens-pause and far-half-dead-zone
  were both real bugs here).

| Score | Meaning |
|---|---|
| 5 | Both players act correctly on the first attempt with no hesitation |
| 3 | Correct within a few seconds; one moment of "which is mine?" |
| 1 | A player cannot find or trust their control; taps or keys do nothing or the wrong thing |

### 2. First-30-second comprehension

*Within half a minute, does a player who has never seen this game understand the goal and
what a good move looks like?*

- Watch, do not explain. Note the moment (if any) they "get it", and what they misunderstood
  first.
- The pre-match screen and the first few seconds of play should carry this — DuelBox's promise
  is to teach a game by showing it moving (#2328), not by a paragraph.

| Score | Meaning |
|---|---|
| 5 | Goal and a good first move are obvious within ~10s, unprompted |
| 3 | Understood within 30s, after one wrong assumption self-corrected |
| 1 | Still confused about the goal after 30s |

### 3. Fairness (as felt)

*Does the loser understand why they lost, and does neither seat nor input feel handed the
game?*

- The measured checks own the numbers — seat balance, control parity, bot honesty. This
  dimension is the *felt* version: a match can be inside the 45–55% band and still feel unfair
  if the losing player cannot see the cause.
- The bot must not appear to cheat: no seeing a face-down card, a mole before it surfaces, or
  a move a human could not read. Difficulty must live in error and search depth, never in
  information (HANDOFF.md).
- If the felt result contradicts a measured harness, **trust the harness and file the feeling**
  — it usually means a presentation bug (a cursor drawn on a shared goal handed the keeper the
  answer in Penalty Kicks).

| Score | Meaning |
|---|---|
| 5 | Losses feel earned; neither seat nor input is advantaged in play |
| 3 | Fair, but one moment where a player wondered if the bot saw too much |
| 1 | A player feels the game, the seat, or the input decided it, not their play |

### 4. Round-length feel

*Does a round last about as long as it should — long enough to matter, short enough to want
another?*

- `roundSeconds` is the manifest's claim and the catalogue card's promise ("about 5 min").
  Check the game actually *ends* near it (the guard `termination.test.ts` proves it *can* end;
  this checks it ends when it should) and that the ending does not overstay — Bowling's ball
  flew for eight seconds after every delivery, and that is a round-length-feel defect.
- Note dead time: a countdown that drags, a turn with nothing to watch, a result screen that
  waits.

| Score | Meaning |
|---|---|
| 5 | Ends at a satisfying moment near its stated length; immediate want-another |
| 3 | Slightly long or short; one stretch of dead time |
| 1 | Drags, ends abruptly, or never resolves — the match outstays or stalls |

## The score sheet

Copy this block into the game's playtest issue and fill it in. It is deliberately plain text
so it pastes into a GitHub issue unchanged.

```
Game:            <slug>
Tester:          <name / handle>
Date:            <YYYY-MM-DD>
Build:           <commit SHA>
Devices tried:   [ ] touch/phone   [ ] keyboard/laptop (two seats)   [ ] one seat vs bot
                 [ ] other: __________

Dimension                        Score (1–5)   Evidence (one concrete observation)
1. Control clarity               [ ]           ____________________________________
2. First-30s comprehension       [ ]           ____________________________________
3. Fairness (as felt)            [ ]           ____________________________________
4. Round-length feel             [ ]           ____________________________________

Overall:  [ ] PASS (all four ≥ 3)   [ ] BLOCKED (one or more < 3)

Findings filed as issues (one per finding):
  - #____  <one line>
  - #____  <one line>

Notes / anything surprising:
```

## How a finding becomes an issue

One finding, one issue — never a batch. The moderated-playtest rule (QA #229) is "file every
finding as its own issue", and it applies here for the same reason: a bundled report is a
report nobody can close, because closing it means fixing all of it.

1. **File it with the bug template.** Use `.github/ISSUE_TEMPLATE/bug.yml`, which already
   requires the game slug, the seat, the input family, the device and the viewport — the
   context a playtest finding needs to be actionable. The footer's "Report a bug" link opens
   that form.
2. **Label it.** `type:bug` for a defect (the template sets this), or `type:feat` for a
   feel/clarity improvement that is not a defect. Add the game's own label if one exists.
3. **Score < 3 blocks "done".** A dimension below the pass line means the game's tracker stays
   open until the finding it produced is fixed or explicitly accepted with a reason written
   down. "Noted and shipped" is the outcome this sheet exists to prevent.
4. **Link the issue back into the score sheet** (the "Findings filed" block), so the playtest
   record and the issues that came out of it point at each other.

A passing sheet (all four ≥ 3) with its evidence filled in is the artefact that lets a game's
"build the game" tracker close on the QA criterion — the same standard the definition of done
in `CLAUDE.md` sets, made checkable.
