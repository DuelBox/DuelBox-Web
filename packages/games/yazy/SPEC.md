# Dice Yatzy — specification

**Archetype:** `turn-board` · **Category:** Dice · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 420 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Five dice, three rolls a turn, keeping whichever you like between rolls. Then the hand must
be spent on one of thirteen categories, each usable once. Thirteen turns each, highest
total wins.

## Where the game is

In the word *must*. Late on, every good category is used and you are choosing which of your
remaining ones to waste. **Scoring zero somewhere is ordinary play, not a mistake**, and the
interface has to make that possible without making it an accident — which is why a spent box
shows its zero rather than looking untouched.

## The sheet is two columns, not thirteen rows

Thirteen rows in the space available is 46 logical units each, which on a 320-pixel phone
is a fifteen-pixel row: below anything a thumb can hit and below anything a person can read.
Two columns of seven halves the count and doubles the row. The upper section fills the left
column, its seventh row showing the bonus, which is displayed and never chosen.

Verified at 320 × 640: all thirteen boxes, five dice, the roll control and both totals fit
with room to spare.

## Every open box shows what this hand would score in it

The one thing a paper scoresheet cannot do for you, and the whole of the decision. Without
it a player has to add five dice thirteen ways in their head while someone waits.

## Scoring

| | |
|---|---|
| Ones–Sixes | the pips of that face |
| Three / four of a kind | the sum of all five dice |
| Full house | 25 |
| Small straight (four in a row) | 30 |
| Large straight (five in a row) | 40 |
| Yatzy | 50 |
| Chance | the sum of all five dice |
| Upper bonus | 35, at an upper total of 63 |

Five of a kind counts as a full house, because it is three of a kind and two of a kind.

## Determinism

No wall clock, no `Math.random`, one `Rng` from the context. Only the dice that are not
being kept are re-rolled, and the same seed replays to the same hands, asserted by tracing
two runs.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and a game that
assumed seat one would leave that rotation reaching nothing (#2487). It is read in
`resetGame`. Measured at 50 seeds x both opening seats on `normal`, equal tiers: seat one
takes **50.0%** of 98 decided matches, and 49 of the 50 seed pairs end differently when only
the opening seat changes.

## The bot

| | Keeps dice | Chases the upper bonus | Drops a low pair |
|---|---|---|---|
| easy | no | no | no |
| normal | yes | no | no |
| hard | yes | yes | yes |

Every tier sees the dice and the sheet and nothing else, per rule 6.

Measured over 3,000 solo games:

| | Average | Best | Took the bonus |
|---|---|---|---|
| easy | 110.9 | 227 | 0.0% |
| normal | 178.0 | 322 | 1.9% |
| hard | 185.8 | 318 | 11.3% |

**The honest note about these numbers.** The step from easy to normal is enormous — 67
points — because it is the step from not knowing you may keep dice to knowing it, and that
is genuinely most of Yatzy. The step from normal to hard is 8 points, about 4%. That is
not a weak implementation; it is the game. Yatzy's variance is huge — hard's own results
range from well under a hundred to 318 — and the strategic ceiling above "keep the biggest
group" is modest. Inflating the gap would mean making `normal` play badly on purpose, which
is a different thing from making `hard` play well. **[ours]**

### What was measured rather than assumed

Two behaviours were added to `hard` on the reasoning that experts do them, and then swept
over 3,000 games each:

- **Dropping a low pair** (a pair of ones or twos is worth less than two fresh dice):
  **+1.5 points**. Kept.
- **Chasing a straight from three in a row**, not only from four: **−6.3 points**, and it
  halved the bonus rate. Two dice do not fill two gaps often enough to be worth giving up a
  developing group, however much it looks like the clever play. Removed rather than left in
  as an unused flag.

The weight on being ahead of the upper-section pace was swept too: at 1.5 it averaged 184.6
and took the bonus 8.6% of the time; at 3 it averages the same with the bonus at 15.7%, so
3 it is. Past that it starts buying the bonus with points it should have kept — 183.5 at 5,
181.9 at 8.

That weight also needed a **cap**, found by a test rather than by the averages: uncapped,
five sixes scored 30 + 36 = 66 in the weighting and beat a 50-point yatzy. A hand that good
is rare enough that the average never noticed, and it is plainly the wrong play. Being
ahead of pace cannot be worth more than the bonus it is chasing, so it is clamped to half
of it.

A wasted turn goes to the **cheapest** category — ones before yatzy. That ordering was
inverted in the first draft, so every zero went into yatzy, which is precisely the
beginner's mistake it exists to avoid. A test caught it on the first run.

## Controls

W A S D and Space are player one's, the arrows and Enter player two's, and the sheet turns
to face whoever is playing. The cursor lives on the dice row — five dice and the roll
control — and **down** enters the sheet, **up** from its first row returns to the roll
control, which is where a turn starts.

Pointer play is tapping: a die to keep it, the roll control to roll, a box to spend the hand.
A tap in the gap between two dice, or between the two sheet columns, is ignored rather than
rounded to a neighbour.

## Rule 7

A kept die is warmer **and** carries a bar across its foot. A spent box is dimmed **and**
struck through. The dice are pips rather than numerals — a die a player has to read as a
number is not a die.

## Not specified here

The joker rules for a second Yatzy, three or more players, the six-column variant, or
re-rolling into a category already taken. All are real Yatzy; none earns its complexity on
a screen two people are sharing.
