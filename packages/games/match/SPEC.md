# Match Rush — specification

**Archetype:** `rt-arena` · **Category:** Reaction · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 40 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Two sets of five symbols share **exactly one** symbol between them. Find it in your own set
and touch it before the other player finds it in theirs. First to ten.

## Observed rules

From the reference genre: _"Compare the 2 sets of objects. Find the 1 matching object before
your opponent to earn a point. First to 10 points wins!"_

## Each player searches their own set **[ours]**

The obvious reading — one shared pile both players reach into — **cannot be played on a
shared board**, because the shell divides one into two pointer zones and neither player can
touch anything in the other's half. Giving each seat its own set of the pair turns that
constraint into the design: the board is one puzzle, each half of it is one player's half of
that puzzle, and both are looking for the same answer in a different place.

## Exactly one shared symbol, by construction

A pair of sets sharing exactly one symbol needs `1 + 2·(SET_SIZE − 1)` distinct kinds, or
the two are forced to share a second. With five to a set that is nine; twelve is used, so
the pairs stay varied rather than nearly the same every round.

The deal is a **shuffle of all twelve kinds**: the first is the common one, the next four
fill out seat one's set and the four after that seat two's. Built that way rather than by
rejection sampling because it *cannot* produce a second shared symbol — the property is a
fact about the construction, not something to test for and retry. A test deals three
thousand rounds and checks it anyway.

## Fairness, and the part of it that cannot be equalised

The common symbol sits at the **same ring index in both sets**. The board is
point-symmetric, so the same index is the same position relative to each player — neither
seat has a longer look than the other. Knowing the index is no help, because the only way to
learn it is to have already found it.

What cannot be equalised is which **distractors** it sits among: two identical sets would
make the puzzle trivial. That residue is measured rather than assumed — see the balance
table below, where equal tiers come out at 52%, 51% and 53% over four hundred seeds.

## The board

| | Value | Why |
|---|---|---|
| Board | 900 × 900 | Square; each fan in its own half |
| Set | 5 symbols in a ring of radius 155 | |
| Symbol | radius 62 | Comfortably thumb-sized at 320 px wide |
| Kinds | 12 | Six shapes × repeated colours |
| Round | 5 s, then a 0.9 s reveal | |
| Wrong touch | 1.2 s lockout | |
| Match | first to 10, 24 rounds maximum | |

**The lockout is the whole cost of guessing.** Without it the fastest strategy is to touch
all five symbols as quickly as possible, which is not searching — a set of five would be
solved by mashing in under a second. A lockout longer than an honest search makes guessing
strictly worse than looking, and a test asserts that inequality against the bot's own
reading speed rather than trusting the number.

## Termination

Structural. Twenty-four rounds each with a five-second clock, so nothing about how the match
is played can extend it. A match where neither player ever touches anything finishes 0–0 as
a draw.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `A` / `D` walk the ring, `Space` confirms | `←` / `→` walk it, `Enter` confirms |
| Pointer | touch the symbol directly | touch the symbol directly |

A fan of five has no grid to move a cursor over, so the engine's `GridCursor` does not fit:
left and right **walk round the ring**, which is the only motion the shape suggests. Up and
down do the same, so a player reaching for `W` is not met with silence. A tap leaves the
cursor where the finger went, so switching to keys carries on from there.

## The bot

Three tiers, expressed as how fast a tier reads a symbol and how often it jumps to a guess —
never as a look at the answer. Every tier searches its own set in an order it drew *before*
the deal was useful, one symbol at a time, and finds the common one when it reaches it. A
tier that simply knew the index would not be a difficulty setting; it would be a different
game with the same rules.

| Tier | Per symbol | Settles in | Guesses |
|---|---|---|---|
| easy | 0.62 s | 0.50 s | 24% |
| normal | 0.34 s | 0.28 s | 10% |
| hard | 0.19 s | 0.15 s | 3% |

Exactly `SET_SIZE` values per round — four for the shuffle of its search order, one for the
guess roll — unconditionally. A seat whose draw count depended on what it found would shift
the other seat's stream, which is the seat bias Fruit Duel was caught by. The deal itself
draws a constant twelve for the same reason.

### Measured

400 seeded matches for the equal tiers, 80 for the rest:

| | p1 | p2 | draws | p1 share of decided |
|---|---|---|---|---|
| easy v easy | 202 | 188 | 10 | 52% |
| normal v normal | 200 | 193 | 7 | 51% |
| hard v hard | 209 | 182 | 9 | 53% |
| hard v easy | 80 | 0 | 0 | 100% |
| easy v hard | 0 | 80 | 0 | 0% |
| normal v easy | 80 | 0 | 0 | 100% |
| hard v normal | 80 | 0 | 0 | 100% |
| normal v hard | 0 | 80 | 0 | 0% |

**It took three sample sizes to believe that.** The same `hard` pairing read 58% at eighty
seeds, 61.5% at a hundred and twenty, and 53% at four hundred — three answers from one
unchanged game. A match is a dozen searches of a second or two, so a single unlucky deal
moves the whole result. The temptation each time was to widen the band; the honest fix was
more samples, and the band in the test is the one the bot issue actually asks for.

## Rule 7: shape first, and no text at all

Here rule 7 is **load-bearing rather than a courtesy**: the entire game is telling two
symbols apart at a glance, so a pair differing only in hue would be unplayable for one
person in twelve and merely hard for everybody else.

- Six distinct silhouettes — disc, square, ring, cross, bar, six-pointed burst — and the
  colours **repeat across shapes on purpose**, so colour alone never identifies a kind.
- Every shape is symmetric under a half turn, which is what lets one board serve two people
  sitting opposite each other with nothing rotated. An arrow or a letter could not be one of
  the twelve.
- A lockout draws a cross over the whole fan, so a penalty reads as a shape rather than a
  shade.
- Points are pips along each player's own outer edge — circles for p1, squares for p2. A
  test asserts the renderer's `text` method is never called: a number has a top, and this
  board is read from both ends.
- The search clock shrinks from both ends toward the middle, so it is the same object read
  the same way from either side.
