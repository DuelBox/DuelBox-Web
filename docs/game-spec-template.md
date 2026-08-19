# Game spec template

Copy this into `packages/games/<slug>/SPEC.md` and fill it in. A worked example is
`packages/games/air-hockey/SPEC.md`.

The point of a spec here is not ceremony. It is that a hundred games written by different
people at different times need to make the same decisions the same way, and the questions
below are the ones that turn out to matter. A spec that answers them is a spec someone can
implement from without re-deriving the rules or guessing.

**Two rules about honesty in a spec.**

Mark anything that is our decision rather than an observation with **[ours]**. The
observed rules are usually one sentence; everything else is a choice, and pretending
otherwise makes it impossible later to tell what we may freely change.

If the spec is written after the implementation — which is fine, and true of the first
seven — say so at the top. A spec that claims to have come first when it did not is a
document nobody can trust.

---

# <Game name> — specification

**Archetype:** `<archetype>` · **Category:** <category> · **Logical box:** W × H ·
**Zone split:** <horizontal | vertical | shared-board> · **Round length:** ~N s

## Observed rules

> Quote the reference genre's own rule text here, verbatim, from `docs/observed-rules.md`.

State plainly how much of the game that actually determines. It is usually one sentence
and usually leaves most decisions open.

## The board / table / arena

A table of every constant that defines the play space, each with the reason it has that
value. Read them out of the code rather than from memory — a spec whose numbers have
drifted from the implementation is worse than none.

## Scoring and the win condition

Which shared helper resolves it (`first-to`, `lead-by`, `highest-when-time-expires`,
`reduce-to-zero`, `last-standing`) and with what parameters. **Never write a comparison
by hand**: the helpers exist so "first to seven" means the same in every game and draws
are never left undefined.

State what happens after a score: who serves, restarts, or moves next, and after how long.

## Controls

A row per seat, a column per input family. Every game must be completable with the
keyboard alone and, where the archetype allows, with the pointer alone. If either is
impossible, that is a defect rather than a design choice — see #2422.

Say how the two sources combine. There must be no mode to switch between them.

## Edge cases

At minimum: simultaneous input, no input, input in the other seat's zone, boundary
conditions, and whatever stalemate looks like in this game. For each, say what happens
and why that is the right answer rather than merely what the code does.

## Determinism

The property everything else rests on. State anything that needed care:

- Are delays counted in simulation steps rather than seconds?
- Does any decay or integration behave identically at 60 Hz and 144 Hz? A per-step
  multiplier does not; a rate with the matching analytic integral does.
- Is all randomness seeded?

If nothing here needed care, say that — it is useful to know a game is trivially
deterministic.

## The bot

What information it reads, and the confirmation that it is only what a human can see on
the same screen (CLAUDE.md rule 6). How the three difficulty tiers differ — reaction
delay, error, speed — rather than by giving the hard tier information the easy one lacks.

## Presentations

What shared-screen and single-seat each look like for this game, and whether the play area
rotates. Refer to `docs/presentation.md` rather than re-deciding.

## What is not specified here

Name the issues covering the parts that are still open, so a reader knows the difference
between "decided and not written down" and "not decided".
