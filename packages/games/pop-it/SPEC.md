# Pop It — specification

**Archetype:** `turn-board` · **Category:** Puzzle · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~180 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Rows of bubbles. On your turn you press **any number of bubbles in one row, so long as
they are next to each other**. The player who presses the last bubble on the board loses.

## The sheet

Five rows of 3, 4, 5, 4, 3 — nineteen bubbles, a rounded sheet rather than a rectangle
**[ours]**. Short rows are centred under the widest, and the whole sheet is centred in the
logical box, which is not decoration: see *What this game found*.

## The rule that inverts the endgame

Losing by moving last is **misère** play. For most of the match you want to clear a row;
at the very end you want to leave exactly one bubble for your opponent. A player who has
not noticed will win the whole board and lose the game on the final press.

**Pressing from the middle of a row splits it in two**, and the halves are then independent
games. That is why a position is a bag of runs rather than a set of rows, and why this is
much deeper than it looks.

## Scoring

Bubbles pressed, for the HUD. It is not what decides the match — the last press does — but
it is the number both players can watch going up.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Drag across the bubbles you want | Arrows to pick a bubble, Space or Enter to start and end a run |

A finger **begins** a run on the press and **commits** it on the release, so you can drag
along a row and see the run before making it. A run cannot leave the row it began in. The
keyboard has no release worth the name, so its second press commits instead — which also
lets a player see the run they are about to make.

## Edge cases

- **A quick tap**, where press and release land on one step: presses a single bubble. This
  is most touchscreen taps, and getting it wrong makes a game silently unplayable.
- **A finger going down between the bubbles**: nothing. It does not fall back on the
  cursor, nor on whichever bubble the finger last touched.
- **Beginning on a bubble already down**: refused.
- **Dragging backwards**: the same run, right to left.
- **Dragging into another row**: the run stays in the row it began in.
- **A press during the seat flip**: ignored.
- **A half-chosen run when the game pauses**: dropped. Coming back to a selection you
  cannot remember starting is worse than starting again.

## Determinism

The bot's blunder rolls come from the seeded RNG; the think delay is counted in whole
simulation steps, sized once the step rate is known.

## The bot

| Tier | Blunder |
|---|---|
| easy | 70% |
| normal | 25% |
| hard | 0% |

**`hard` plays perfectly.** The position is solved exactly rather than evaluated: runs are
sorted into a canonical bag, memoised, and searched to the end. Misère, so the base case is
inverted — with nothing left, the player to move has *already won*, because their opponent
pressed the last bubble.

Difficulty is the blunder rate alone. Search depth is not an honest dial here: the whole
position is in front of both players, so a shallower search is not a plausible human
weakness, it is just a worse answer to a visible question.

There is no evaluation function to tune, so the solver is checked instead — against a
brute-force search sharing none of its code, over every position up to three runs of five.
A shorter list would not have done: a solver that dropped the *left* half of a split
agreed on every position small enough that the left half was always empty.

**A curiosity, recorded because it cost me time.** Dropping that left half changes no
verdict at all for any position up to three runs of seven — I checked, while trying to work
out why mutating the line failed no test. Every split successor is worth the same as its
right-hand part alone. The line stays because it is what the game does, and because the
coincidence is a property of these sizes rather than a rule.

## What this game found

**Two bugs, and only one of them was mine.**

1. **The sheet was not centred in its logical box.** `pushRotation` turns about the logical
   centre, so an off-centre board *moves* when it rotates to face the other player — the
   sheet jumped across the screen between turns, and every tap the second player aimed at
   it landed on nothing. It looks perfectly fine until somebody takes their turn. The
   origin is now computed from the logical size, and two tests hold it there: one that the
   sheet is centred, and one that a 180-degree turn maps every bubble back onto a bubble.

2. **Drop Four could not be played by tapping**, and had shipped that way. It armed a
   column on the press and waited for a *later* step to see the release — but a quick tap
   puts both on one step, which on a touchscreen is most taps, so only a deliberate hold
   ever dropped a disc. This is the bug the repository fixed once in Tic Tac Toe, still
   present in another game, because the tap test only ever covered Tic Tac Toe. Six games
   are now covered.

## Not specified here

Art, audio and haptics. A bubble sheet is the one thing in this catalogue that genuinely
wants a haptic, and there is not one yet.
