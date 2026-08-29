# Darts — specification

**Archetype:** `turn-aim` · **Category:** Sports · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** ~90 s

> **The first `turn-aim` game in the catalogue.** The aiming idiom established here is
> the one the other twenty should follow unless they have a reason not to. Specified
> alongside the implementation; **[ours]** marks decisions with no basis in the observed
> rules.

## Observed rules

> Take turns throwing darts and be the first to score 301 points. The last dart must hit
> the exact score.

Unusually specific, and the second sentence is the whole game: the finish is exact.

## The board

Scoring is fixed geometry, expressed in fractions of the outer radius so nothing depends
on how large the board is drawn.

| Ring | From | To | Worth |
|---|---|---|---|
| Inner bull | 0 | 0.037 | 50, and counts as a double |
| Outer bull | 0.037 | 0.094 | 25 |
| Single | 0.094 | 0.582 | the sector |
| Triple | 0.582 | 0.629 | 3× the sector |
| Single | 0.629 | 0.953 | the sector |
| Double | 0.953 | 1.0 | 2× the sector |
| Miss | beyond 1.0 | | 0 |

**The twenty sectors are not in numeric order**, and that is the point: a real board
interleaves high and low so a near miss is punished. 20 sits between 1 and 5, which is why
aiming at treble twenty is a risk rather than a formality. A test asserts those neighbours
specifically — a board in numeric order would be a different game.

Scoring is a pure function of a point, so it is tested exhaustively without simulating a
throw: every sector at its own angle, both sides of every ring boundary, and four thousand
random points asserting no dart ever scores more than sixty.

## Scoring and the win condition

**Count down from 301. First to exactly zero wins.**

**The dart that reaches zero must be a double** (the inner bull counts). This is what the
observed rule means by "the exact score", and it is what makes the last dart the hardest
throw in the game rather than a formality.

Three ways to **bust**, each returning the score to where the turn began:

- Going below zero.
- Landing on exactly **one**, because one cannot be finished with a double.
- Reaching zero **without** a double.

A bust voids the **whole turn**, not just the offending dart — so a good first dart is
lost too, which is what makes a risky third dart a real decision.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Drag the circle at the bottom to aim, release to throw | `W A S D` or arrows to move the sight, Space or Enter to throw |

**This is the `turn-aim` idiom.** Aiming and committing are separate acts, so a player can
take as long as they like over the aim and the throw is never a surprise. A pointer commits
on **release**; a key commits on **press**, because there is nothing to preview while a key
is held.

Which of the two applies is decided by how the aim was *made*, not by whether a pointer is
present on the committing step — by the time a finger lifts, it is not. Getting that wrong
means the throw never happens, and it did: see below.

The aim control sits low on the board, within thumb reach on a phone, so the hand doing
the dragging does not cover the board being aimed at. A drag to the edge of the control
moves the reticle **across** the board but not off it, so the whole board is reachable and
the extremes are not wasted on misses.

Keys nudge the reticle at a rate rather than jumping it, so the keyboard and the pointer
are comparable instruments rather than one being strictly finer — which is the fairness
concern `docs/input-parity.md` raises for exactly this archetype.

## Edge cases

- **Releasing without having aimed.** Refused. Otherwise a stray release throws a dart at
  dead centre.
- **A dart in flight.** Nothing is accepted until it lands, so a fast tapper cannot throw
  three darts before the first is scored.
- **A drag beyond the control.** Clamped to its edge rather than flinging the reticle off
  the board.
- **Input while the board is turning.** Refused, as everywhere.
- **A turn ending.** The previous thrower's darts are cleared from the board, so the next
  player sees their own three and not six.

## Determinism

Bot thinking (0.7 s), dart flight (0.28 s) and the settle after a win (1.2 s) are counted
in whole simulation steps. The bot's scatter is drawn from the seeded RNG.

The scatter is Box-Muller, so the spread is a genuine normal distribution — a uniform box
would make the bot's misses look mechanical, clustering at the corners of a square.
`float()` can return zero and `log(0)` is `-Infinity`, which would place a dart at `NaN`
and score it as a miss forever after, so the draw is nudged into `(0, 1]`. A test throws
five thousand darts asserting every one is finite.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and a game that
assumed seat one would leave that rotation reaching nothing (#2487). It is read in the
game's own `#active`. Measured at 50 seeds x both opening seats on `normal`, equal tiers:
seat one takes **50.0%** of 100 decided matches, and all 50 seed pairs end differently when
only the opening seat changes.

## The bot

It plays the game a person plays: treble twenty while the score is high, the finishing
double once one is reachable, the bull on fifty. It knows only its own remaining score —
the same number shown on screen — so it has no information a human lacks.

Difficulty is **spread**, nothing else: how far its darts stray from where it aimed. A
test throws six hundred darts at each tier and requires the hard tier's average to beat
the easy tier's, so the tiers differ in strength rather than in label.

## A bug worth recording

The pointer throw did not work at all, and the unit tests passed anyway.

The game asked whether a pointer was present on the committing step. On the step a finger
lifts, it is not — so the code took the keyboard branch, found no key press, and never
threw. The suite missed it because the fake input kept `pointer` set through the release,
which is not what a real release looks like. Only driving it in a browser showed it.

The fake now clears the pointer on release, and with that fidelity restored the corrected
test fails against the original code.

## Presentations

Rotates to face whoever has the move in shared-screen; never rotates in single-seat.

## Not specified here

Art and audio, cross-device play, and the fairness audit.
