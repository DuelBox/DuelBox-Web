# Checkers — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~300 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

## The board

| | Value | Why |
|---|---|---|
| Squares | 8 × 8, of which **32 are playable** | Only the dark squares are ever used, so the board is stored as 32 slots rather than 64 |
| Pieces | 12 a side, three rows each | Two empty rows between them |
| Kinds | man, king | A man moves forward only; a king moves both ways |

**The odd-row offset is the whole trick of the storage.** Dark squares alternate which half
of a row they start in, so `columnOf` adds one on even rows. Getting it wrong is the
classic checkers bug — moves work on half the board and quietly wrap around the edge on
the other half — and it is pinned by a round-trip test over all 32 slots, plus a rendering
test that asks the renderer whether every piece actually landed on a square it painted
dark. That second test exists because I misread a screenshot and spent a while chasing a
bug that was not there: reading a checkerboard off a 358-pixel-wide screenshot is genuinely
hard, and asking the renderer is not.

## The rules that make it a game

**Capturing is compulsory.** If any capture exists, only captures are legal. This is what
lets a player *set a trap* rather than merely hope one is taken.

**A jump that can continue must continue.** While a chain is running the turn does not
pass, and only the chaining piece may move.

**Crowning ends the turn, even mid-chain.** A man that reaches the far row becomes a king
and stops there. Letting it carry on jumping as a king would conjure a free extra move out
of the promotion **[ours]** — this is a genuine rules variant, and we take the strict one.

**Being stalemated is a loss, not a draw.** A seat with no legal move loses. Not obvious,
and the sort of thing a player only discovers by being on the wrong end of it.

## Scoring and the win condition

Score is **pieces captured**, so the HUD counts up from zero for both seats rather than
down from twelve. A seat wins by taking every piece or by leaving the opponent with no
move.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap a piece, then tap where it goes | Arrows or `W A S D` to pick a square, Space or Enter to lift and place |

A move has **two halves**: lift, then place. Everything about that lives in the game
module; the rules know only about positions.

## Edge cases

- **Pressing a different piece of your own.** Re-lifts. A player changing their mind is the
  common case, and making them press twice to undo a selection is a worse answer than
  simply believing the second press.
- **Pressing the lifted piece again.** Puts it down.
- **Pressing your own piece mid-chain.** Refused silently. The player has no choice of
  piece there, so lifting one that then cannot move would be a lie.
- **Pressing a light square.** Nothing. It is never a move and never a piece.
- **Pressing an illegal destination.** Nothing, and the piece stays lifted.
- **Pressing during the seat flip.** Ignored — the square under a finger is moving, so a
  tap would name one nobody meant.
- **A capture is available and the player has not noticed.** Every piece that is forced to
  move is ringed. Without it, a player finds every other move refused with no explanation;
  the marker turns a mystery into a rule.

## The cursor

The keyboard cursor walks all sixty-four squares, light ones included. A cursor that
skipped half the board would jump two columns at a time and read as broken **[ours]**.

## Determinism

The bot's blunder rolls come from the seeded RNG; the think delay is counted in whole
simulation steps, sized on the first update once the step rate is known rather than in
`init`, where it would be sized before the rate is known.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and a game that
assumed seat one would leave that rotation reaching nothing (#2487). It is read in
`resetGame`. Measured at 50 seeds x both opening seats on `normal`, equal tiers: seat one
takes **55.0%** of 100 decided matches, and all 50 seed pairs end differently when only the
opening seat changes. The residue is not the opener: it is the same seat-one lean under
either one.

That figure was re-measured after #2524 and it moved: the same harness gives **60.0%** for
the pre-fix search, so scoring the chains properly took about five points off the seat-one
lean rather than adding to it. The **58.0%** recorded here before that was measured on a
harness that is not in the tree, so it is the 60.0% and not the 58.0% that the 55.0% should
be read against.

## The bot

Negamax with alpha-beta over a reused stack of positions — no node allocates a board or a
move array. Every tier sees exactly the board a human sees.

| Tier | Depth | Blunder |
|---|---|---|
| easy | 1 | 50% |
| normal | 3 | 16% |
| hard | 5 | 0% |

**A jump chain does not pass the turn, and the search has to know that — twice over.**

The first half is the sign. It flips on whose move it is, not on every ply; a negamax that
negates unconditionally will evaluate a double jump as a gift to the opponent and refuse to
take it.

The second half is what "depth" counts, and it was wrong until #2524. **Depth is a count of
turns, so a chain continuation spends none of it**, and **a position with a capture pending
is never scored**. It used to be both: a chain spent a ply like any other move, so within
one sweep leaves were reached after different numbers of *turns*, and some were reached
in the middle of a capture. Since evaluation is material, a half-taken chain was booked as
though it had stopped — undervalued for the mover by exactly the pieces he was guaranteed
to take next, in precisely the branches where the swing is largest. Measured over 40 hard
games, per sweep depth:

| sweep depth | leaves of the minority turn-parity | leaves scored mid-chain |
|---|---|---|
| 1 | 0.00% → 0.00% | 0.18% → **0.00%** |
| 2 | 0.51% → 0.00% | 0.54% → **0.00%** |
| 3 | 0.67% → 0.00% | 0.55% → **0.00%** |
| 4 | 1.14% → 0.00% | 0.87% → **0.00%** |
| 5 | 3.19% → **0.00%** | 1.37% → **0.00%** |

Not decrementing the depth is not on its own the fix — tried alone it measured as a wash —
and it is not what makes the mid-chain leaf go away. Refusing to *stop* on a pending
capture is: every place the search can end a line is conditioned on the chain being over,
the exhausted budget included, because running out of budget is a reason to stop thinking
rather than a reason to score a half-taken chain.

**It does not cost a deeper search, and the ceiling still holds.** Asked the same 6,000
hard-tier positions before and after: the budget charges at most 1,500 nodes either way,
real node visits go 1,261 → 1,274 on average and 1,528 → 1,523 at worst, the completed
depth spread is unchanged (d3 22.0% / d4 36.3% → 37.8% / d5 41.8% → 40.3%), and the worst
single think is 2.96 ms → 2.86 ms. The worst single `update` over 1.2 M steps a tier is
0.08 → 0.05 ms easy, 0.58 → 0.54 ms normal, 1.94 → 1.96 ms hard.

**The ladder, re-measured.** 120 games a row, seats alternated, randomised 2/4/6-ply
openings, and a game that outlives the 300-turn cap settled the way the shell settles one
on its round timer — on captures. Score is win + ½ draw for the first-named side.

| | before | after |
|---|---|---|
| d2 v d1 | 99.2% | 100.0% |
| d3 v d2 | 70.8% | 72.9% |
| d4 v d3 | 62.5% | **66.3%** |
| d5 v d4 | 53.8% | 52.9% |
| normal v easy | 96.7% | 98.3% |
| hard v normal | 97.1% | 95.4% |
| hard v easy | 100.0% | 100.0% |

And head to head, the fixed search against the old one at the same tier: easy **60.0%**,
normal **52.5%**, hard **55.8%**. Every tier is at or above even and the ladder keeps its
order, which is as much as 120 games can say — the gain is real but it is a ply of
accuracy, not a new bot, and #2524 was filed as a correctness wart rather than a visible
defect for that reason.

Evaluation is material first — a king is worth 17 to a man's 10 — with two small
positional terms: an advanced man is worth a little more because it is closer to a crown,
and a piece on the edge file is worth a little more because it can never be captured there.

## Presentations

- **Shared-screen** — one board both players reach across, turned to face whoever is to
  move. Input is refused for the whole turn.
- **Single-seat** — the same board, never turned.

## What this game found

Two engine bugs, both visible only by watching a board turn:

1. **The renderer never clipped to the logical box.** A game could paint over the
   letterbox bars, and a 720-unit board rotating about its centre sweeps its corners out by
   a factor of root two — well past the edge of a 900-unit box. On screen it was fragments
   of checkerboard scattered above and below the play area, on the page's own background.
   It is a fairness bug rather than a cosmetic one: the letterbox is where rule 9's
   boundary lives, so anything spilling past it shows a player more of the world.
2. **Clipping alone then cut the corners off a turning board**, and the pieces standing in
   them vanished for a few frames. `pushRotation` now scales by `1 / (|cos| + |sin|)`, so a
   board tucks in as it turns and back out at the end. The factor is 1 at every resting
   angle, so a settled board is never scaled.

Both affect every game that rotates a board, which is seven of the built ones.

## Not specified here

Art, audio and haptics. The renderer draws primitives; nothing is licensed yet.
Draw-by-repetition and the forty-move rule are not implemented — a long endgame is settled
by the shell's round timer instead **[ours]**, which is honest for a party game and is
recorded here rather than hidden.
