# Sudoku — specification

**Archetype:** `turn-board` · **Category:** Solo · **Logical box:** 900 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions. Every
> number below was measured against this package's own code, at the sample size stated.

A nine-by-nine grid with a row of digit keys under it. On your turn you take one empty
square and say what goes in it. Right, and the square is yours. Wrong, and the correct digit
goes in anyway and the square is your opponent's. The square you fill sends them into its
row and column for their turn. When the grid is full, whoever holds more of the twenty-seven
lines — nine rows, nine columns, nine boxes — has won.

## Observed rules, and the problem with them

The catalogue row reads: _"Play Sudoku, train your brain and beat your highscore."_ Solo,
one grid, a personal best.

That is the whole difficulty. **Sudoku is a solitaire, and the two obvious ways to seat a
second person at one both fail:**

- Two people filling the same grid cooperatively is not a duel. Nobody can lose.
- Two people filling separate grids is two solitaires with a shared timer. Neither player's
  choices ever reach the other, so there is no position to read and nothing to answer.

Everything below the observed row is therefore **[ours]**, and the rest of this document is
the argument for it. What we did not build from the row is the **highscore**: there is no
personal best, no streak, no solo mode. A best score is a single-player idea, the shell owns
result and tournament reporting, and a number that only ever goes up would have had to live
inside this package as a bespoke scoreboard — the thing CLAUDE.md calls a bug rather than a
feature.

## What makes it two-player **[ours]**

**Every square is owned by whoever answered it, and a wrong answer hands the square over.**

That one rule is the whole conversion. It turns a puzzle being finished into a board being
divided, and it makes the moment you are unsure the moment your opponent gains — which is
exactly the moment a solitaire has nothing riding on.

Three rules follow from it and finish the game:

1. **A digit already standing in the square's row, column or box is refused**, not counted
   wrong. An accepted answer is always a genuine candidate, so a square with one candidate
   left cannot be got wrong by anybody, and the interface cannot be used to throw a square
   away by fumbling.
2. **Your answer sends the other seat to its row and column** — the *cross*. They must
   answer inside it. If the cross has nothing empty in it they may answer anywhere.
3. **You score lines, not squares.** Each of the twenty-seven units goes to whoever owns
   more of its answered squares; a level unit goes to whoever owns its **head**, the first
   square in it that was not a given. Most units wins.

### The three candidates, and why this one

The brief named three shapes. All three were considered against the same three tests: does
either player's choice reach the other, can two `easy` bots always finish it, and can two
good players be separated.

| | reaches the other player | terminates | separates two good players |
|---|---|---|---|
| **Race to claim on one shared grid** | yes | **no** | yes |
| **Alternate, play a legal digit or forfeit** | barely | yes | **no** |
| **Claim, and block with the cross (shipped)** | yes | yes | yes |

**A race fails on termination and on the archetype.** The row says `turn-board`, and a race
is real-time; more to the point, a race that lets a wrong entry stand can poison the grid
into a position with no legal move anywhere, and the pairing that finds that position is
`easy` against `easy`. Designing the deadlock out of a race means re-deriving this
specification anyway.

**Alternate-or-forfeit fails on the third column, and that is the finding that shaped
everything else here.** With the whole grid visible and a unique solution, a player who
computes candidates properly can name the right digit for *some* available square nearly
always. Measured with the shipped hardest tier, which does exactly that:

| puzzle | squares to answer | `hard`'s answers correct |
|---|---|---|
| 33 givens | 48 | **100.0%** |
| 27 givens | 54 | **100.0%** |
| 25 givens | 56 | 99.9% |

About 3 000 answers a row. **A duel scored on right answers is a duel nobody can lose**, so two
good players finish level every time and the match is a draw. This is not a bot that is too
strong — it is what sudoku is: the deduction saturates. Any scoring rule that counts
correctness has no headroom at the top, and no amount of bot tuning creates any.

So the shipped design **moves the contest off correctness and onto position**, where it does
not saturate: *which* squares you take, and what you leave the other seat facing. Accuracy
still matters — it is what separates a careless player from a careful one, and it is the
whole of the gap between `easy` and `normal` — but it is not what decides a match between
two players who do not make mistakes. The cross is what makes position contested rather than
parallel, and lines are what make it countable.

## Scoring: lines, not squares, and why nothing simpler works

This took three attempts, and the two that failed both failed for a reason worth writing
down, because both are the sort of thing that looks obviously fine.

**Squares cannot decide it.** Each seat answers exactly half of them. With `k1` and `k2`
right answers the totals come out as `k1 + (T - k2)` and `k2 + (T - k1)`, so the difference
is exactly `2(k1 - k2)`: level on squares *means* level on right answers. Every tiebreak
phrased in terms of accuracy — fewer errors, better run, anything — is arithmetically
incapable of separating anybody, and two `hard` bots finish 27–27 on every seed.

**Per-unit margins cannot decide it either**, one step further along. The margins over all
twenty-seven units add up to three times the square difference, so when squares are level
the two seats' margin totals are equal too. Only a *sign* escapes that. Hence **units led**,
which is a count of signs and not a sum of anything.

**A level unit still had to go somewhere.** Left to nobody, two `hard` bots drew a quarter
of their matches. Three resolutions, 500 matches a tier, both seat orders:

| | `easy` opener | `normal` opener | `hard` opener | draws at `hard` |
|---|---|---|---|---|
| level unit goes to nobody | 45.1% | 47.2% | 58.8% | **27.2%** |
| to whoever answered its **last** square | 43.6% | 44.8% | **41.6%** | 0% |
| to whoever owns its **head** (**shipped**) | **44.8%** | **46.4%** | **52.0%** | 0% |

Both live rules end every match, because with every unit belonging to somebody and
twenty-seven being odd, a finished match cannot be level. They differ entirely in *when* the
deciding square is played. The last-square rule hands the seat that moves last a tempo
advantage worth eight points: the final answers of a match close several units at once and
pay nothing for where they send the opponent, and the second mover always makes the last
answer. A head is a **fixed square, known from the first turn and drawn on the grid**, so it
carries no tempo at all — and it gives a player something to plan around from the opening
rather than something that only matters at the end.

### The grid

| | Value | Why |
|---|---|---|
| Grid | 9 × 9 in 3 × 3 boxes, logical 810 × 810 at (45, 40) | |
| Square | 90 × 90 | |
| Digit pad | one row of nine, same 90 units, 25 below the grid | Row 9 of the same lattice |
| Squares to answer | **54** (27 givens) | Even, so both seats answer 27 |
| Units | 27 — nine rows, nine columns, nine boxes | The three families sudoku is made of |
| Ready freeze | 0.5 s | Longer than the shell's 0.36 s seat flip |
| Turn clock | 20 s | |
| Reveal | 0.55 s | |
| Bot think | 0.35 s | |
| Match | 54 turns, **77.5 s** of simulated play at every tier | Measured, 12 matches a tier |

**54 is the load-bearing number.** It must be even, or the opener answers one more square
than the responder and wins matches by arithmetic; and the generator's blank count is forced
to that parity, putting a given back if a dig fell short. Fifty-four is also the deepest a
uniqueness-checked greedy digger reliably reaches — past about 56 it stops being able to
remove anything, which is why the difficulty table above tops out where it does.

## The puzzle generator

Deterministic from the match seed and nothing else: a complete grid by most-constrained-first
backtracking with seeded digit orders, then squares removed in a seeded order, **each removal
kept only if the grid still has exactly one solution.**

Uniqueness is not decoration here. The scoring rule is "does this digit match the answer", so
with two answers a player could deduce a digit soundly and still be told they were wrong. A
test builds sixty puzzles and counts the solutions of each **to three** rather than to two,
so a bug that returned the cap could not pass by accident.

It costs **0.58 ms** for a whole puzzle, measured over fifty, which is why it can run inside
`init` rather than needing a build step or a table of canned grids.

One consequence worth stating because everything else leans on it: **the grid never holds a
false digit.** A wrong answer puts the *correct* digit in and hands the square over, so every
deduction anybody makes from the grid stays sound for the rest of the match, and every empty
square always has at least one candidate. That is what makes a forced legal answer always
exist, which is what makes the match unable to stall.

## Termination

**Structural, and it is arithmetic rather than a clock.** Every accepted turn fills exactly
one square, and the match ends when none are left. There are three ways a turn can end and
all three fill a square: an answer, a wrong answer, and the turn clock running out. A refused
answer — a filled square, a square outside the cross, a digit that already stands in the
square's row, column or box — costs no turn and changes nothing, exactly as an illegal square
costs no turn in Reversi.

A test plays a whole match with **every** answer deliberately wrong wherever a wrong answer
exists, with no cap on the loop at all, and asserts the blank count falls by exactly one a
turn and that the match takes exactly as many turns as the puzzle left squares. A loop with no ceiling hangs the suite on a
regression rather than passing quietly.

Two `easy` bots take **77.5 s** of simulated play against the cross-game guard's ten-minute
budget, and this package asserts the same thing itself so that a change which slowed a turn
down fails here first.

The turn clock is in the rules, not in the shell. A person has 20 s; when it runs out the
square they had chosen — or the first one they could have chosen — is revealed and goes to
the other seat, which is the same settlement a wrong answer gets. Anything softer would be a
turn that fills no square, and two people who have put the phone down would leave a
tournament match open for ever.

## The ready freeze is in the rules, not keyed off the flip

`READY_SECONDS = 0.5` freezes both seats at the start of every turn, in the simulation. It is
longer than the shell's 0.36 s seat flip on purpose, so no tap can land on a grid that is
part-way round.

It cannot be keyed off the flip instead, and this is the trap Cup Pong documented before us:
**`seatView` reports no rotation at all in single-seat play**, so a freeze that asked the flip
whether it had finished would step one match on a shared phone and a different one on two
phones playing remotely. Here it would be worse than a different feel, because the turn clock
is a simulation quantity: it would expire on different frames in the two presentations and
the two devices would disagree about who owned a square. A test drives the same seed through
both presentations and compares the whole trace.

## Controls, and why the pad is row nine of the grid **[ours]**

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W A S D`, then `Space` | arrows, then `Enter` |
| Pointer | tap a square, then tap a digit | tap a square, then tap a digit |

A turn needs two things: a square and a digit. The obvious build is a grid plus a modal digit
picker, and it is the wrong one — it needs a second control scheme, a way out of a picker you
did not mean to open, and a rule about what a cancel does to your turn.

**The grid and the pad are one ten-row lattice.** Row 9 is the pad. One `GridCursor` carries a
keyboard player from the square they want to the digit they want with no modes at all, and a
tap and a key press mean exactly the same thing: the slot under me. Choosing a square is free
and reversible — it commits nothing, and choosing another simply moves the choice. Only a
digit spends the turn.

Both instruments are equivalent by construction, which is what rule 10 asks for: every action
in the game is *one press on one of ninety slots*, and a thumb cannot place a press on a slot
more finely than a key can. There is no drag, no charge, no continuous quantity anywhere. The
game is **not** same-input-class-only.

### The pad shows which digits are legal, and does not show which is right

With a square chosen, a digit that already stands in that square's row, column or box is drawn
struck through and is refused if pressed.

This is a deliberate line and it is worth being explicit about where it falls. What is shown
is a fact about **digits already on the grid** — the same argument Reversi makes for drawing a
dot on every legal square, and for the same reason: counting along a row by eye is bookkeeping
rather than skill, and it is bookkeeping a thumb and a keyboard are not equally quick at, so
leaving it to the player quietly makes the game a test of the peripheral. What is never shown
is which of the remaining digits is **right**, which unit has a hidden single in it, or what
any square is worth as territory.

The 20 s clock is what stops the remainder being free. A player can probe square after square
to compare candidate counts, and probing costs the only thing a turn has.

## Rule 6: what the bot can and cannot see

**`chooseMove` takes the grid, who owns what, where each unit's head is, which seat is to
move, and the square the mover is confined to. There is no sixth argument, and specifically
the solution is not one.** Rule 6 is easiest to break in this game because the information
that decides everything is a single array; passing the whole `MatchState` would have left it
one property access away in every tier for ever, so it is not passed. The guarantee is
structural rather than a habit.

A test scrambles the solution between two calls with the same generator and asserts the bot
plays the identical move — it does, because it cannot reach the array. The behavioural check
matters more: **on its weakest tier the bot answers 88.7% of its squares correctly.** A bot
reading the answer would be at 100.0% on every tier and every puzzle.

`hard` *is* at 100.0% on the puzzles this game ships, and that is the honest, uncomfortable
number in this document. It gets there by deduction — naked candidates, hidden singles, and
disproving a candidate by propagating it until the grid contradicts itself — on a grid that
27 givens leave tractable. Set it a harder puzzle and it slips, which is the evidence that it
is deducing rather than reading:

| puzzle given to `hard` | its accuracy |
|---|---|
| 48 blanks | 1.000 |
| 54 blanks (shipped) | 1.000 |
| 56 blanks (the digger's floor) | 0.999 |

The propagation is the part most at risk of quietly becoming a solver, so it is deliberately
built so that it cannot: **it never branches.** It fills in what is forced and looks for the
wreck, so it can only ever answer "this digit is impossible", never "this digit is right" —
the shape of the technique a person uses at the board. It is bounded by the SDK's node budget,
so a turn costs the same on a phone as on a laptop, and `bot-cost` measures its worst step at
well inside a frame.

## The bot ladder

Two axes, both honest: how deep the deduction goes, and how often it settles for a square it
had already judged was not the best one.

| Tier | naked candidates | hidden singles | contradiction | slip | answers correct |
|---|---|---|---|---|---|
| easy | yes | — | — | 0.18 | **88.7%** |
| normal | yes | yes | — | 0.15 | **95.8%** |
| hard | yes | yes | yes | 0 | **100.0%** |

Every tier plays for the same thing — units — so the ladder is skill at reading the grid
rather than a different game per tier. Among the squares it is equally sure of, a bot takes
the one that wins it the most ground and leaves the other seat the least; that valuation is
the whole of the contest at the top, where both seats answer everything correctly.

### A third axis was written, measured and deleted

`examine` capped how many of the squares a tier looked at — three, for `easy` — which reads
like a hurried player and is not. The mover faces the whole grid whenever the cross runs dry
and eight or nine squares otherwise, so a fixed sample of three is a far worse sample in the
wide positions than in the narrow ones, **and the two seats do not get equal shares of each.**
400 matches, both seat orders:

| `easy` | opener's share of decided |
|---|---|
| examine 3, slip 0.30 | **42.6%** |
| examine 3, slip 0 | 45.9% |
| every square, slip 0.50 | **48.0%** |
| every square, slip 0 | 49.6% |

The tier is exactly as weak either way. Only one of the two spellings is weak in a way that
does not depend on which chair you are sitting in.

### The opening anchor is seeded, for the same reason

The opener used to get the one turn in the match with the whole grid to choose from. That is
worth a different amount to a careless player than to a careful one, so it was a seat bias
that varied by tier — which is the worst kind, because tuning one tier moves another. Drawing
the opening anchor from the match seed gives **the first turn the same shape as every other
one**. 400 matches a tier, both seat orders:

| opener's share of decided | free first turn | seeded anchor |
|---|---|---|
| easy v easy | 44.8% | **46.4%** |
| normal v normal | 46.4% | **49.2%** |
| hard v hard | 52.0% | **52.4%** |

It pulls the weakest pairing towards the middle without touching the strongest, which is what
a fix should look like: the asymmetry it removed only ever mattered to the player least able
to use it.

## Balance, 750 seeds a pairing in each seat order

Equal tiers — 1 500 matches a row, each seed played once with each opening seat:

| | p1 | p2 | draws | seat-one share of decided | opener's share |
|---|---|---|---|---|---|
| easy v easy | 734 | 766 | **0** | **48.9%** | 45.5% |
| normal v normal | 763 | 737 | **0** | **50.9%** | 50.6% |
| hard v hard | 760 | 740 | **0** | **50.7%** | 51.6% |

Cross tier, both seat orders, 750 seeds each:

| | p1 | p2 | draws | stronger tier's share of decided |
|---|---|---|---|---|
| hard as p1 v easy | 713 | 37 | 0 | 95.1% |
| easy as p1 v hard | 38 | 712 | 0 | 94.9% |
| hard as p1 v normal | 584 | 166 | 0 | 77.9% |
| normal as p1 v hard | 194 | 556 | 0 | 74.1% |
| normal as p1 v easy | 663 | 87 | 0 | 88.4% |
| easy as p1 v normal | 79 | 671 | 0 | 89.5% |

Every equal-tier share is within 1.1 points of even. Every pairing is monotone and agrees with itself
within 3.8 points across the two seat orders. The opener's share runs 45.5% to 51.6%; the
weakest pairing is the outlier, and `openingSeat` — which this game reads rather than
assuming `p1` — is what the shell alternates across the rounds of a best-of so that what is
left of it washes out.

**There are no draws at any tier**, by construction rather than by luck: every unit belongs to
somebody once the grid is full, and twenty-seven cannot be shared equally. The squares
fallback in `winnerOf` exists only for the pathological grid where some unit has no square to
answer at all; it has never fired in measurement, and it is there so that "the match cannot
end in an undefined state" is true by construction.

## Rule 7: colour is never the only signal

There is text — this game is digits, and pretending otherwise would be worse than useless —
but nothing that matters is told by colour alone.

- **Seat one is a filled disc and seat two is a hollow square, everywhere.** A square seat one
  owns carries a solid dot in its corner; one seat two owns carries a small outlined square.
  The wash behind the digit only confirms what the corner already said, and the two washes are
  nearly the same grey.
- **The twenty-seven line marks are the same pair of shapes**: a solid disc down the left for a
  row seat one leads, a ring for one seat two leads, a faint dot for a line nobody leads yet.
  Rows down the left margin, columns across the top, boxes in their own centre — so the score
  is on the board, in the place the thing being scored actually is.
- **The heads are three different shapes**, not three colours: a bar on the left edge for the
  head of a row, a bar on the top edge for the head of a column, a small block in the corner
  for the head of a box. They are on the grid from the first turn because a line that ends
  level goes to whoever holds its head, and that is worth planning around from the first turn.
- **The squares you may answer this turn are the only ones on bright paper**, so the cross
  reads as a shape on the grid rather than as a tint.
- **An answer is revealed by shape**: a ring round the square for one that was right, a cross
  through it for one that was not.
- **An illegal digit is struck through** on the pad as well as dimmed.
- The turn clock is a bar with ticks in it, so it is readable as a quantity and not only as a
  length of colour.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the seat flip, the palette and the drawing, and reads the simulation without
adding to it — a test renders at four different alphas and asserts the state is byte-identical
afterwards. The grid geometry is exported from `game.ts` rather than duplicated, because
working out which square a tap landed in is not a rendering question and the tests and the
control-parity harness need the same mapping the game uses.

`update` allocates nothing on a human's turn. On a `hard` bot's turn it builds one
`SearchBudget`, which is the same shape Reversi ships and amounts to under one small object a
second.

## What the shell owns, and this package does not

Countdown, HUD, score display, pause, result, rematch, seat rotation, difficulty selection,
turn indicator and tournament reporting. `getScore()` reports units led — nought to
twenty-seven, summing to twenty-seven at the end — and `getActiveSeat()` reports whose turn
it is, which is how the shell knows the game is turn-based at all. The only clock this package
draws is the 20 s turn clock, which is a rule of the game rather than a piece of match
furniture.
