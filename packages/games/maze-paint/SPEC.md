# Maze Paint — specification

**Archetype:** `turn-board` · **Category:** Solo · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 45 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against this package's own `dist/rules.js`, at the sample
> size stated.

An eleven-by-eleven floor with sixteen blocks scattered on it, and a roller in opposite
corners. On your turn you pick a direction. Your roller slides that way until it meets a
block, the edge of the floor, or **the other player's paint**, laying your colour on every
bare square it crosses. Your own paint it rolls straight over. When neither of you has
anything left to paint, whoever covered more squares has won.

## Observed rules, and the problem with them

The catalogue row reads: _"Swipe to paint all squares to complete each level!"_ Solo, one
maze, a level to complete.

That is the whole difficulty. **Painting every square is a solitaire**, and the two obvious
ways to seat a second person at one both fail:

- Two people filling the same maze cooperatively is not a duel. Nobody can lose.
- Two people filling separate mazes is two solitaires with a shared timer. Neither player's
  choices ever reach the other, so there is no position to read and nothing to answer.

Everything below the observed row is therefore **[ours]**, and the rest of this document is
the argument for it. What we did not build from the row is the **level**: there is no
progression, no next maze on completion, no personal best. Levels are a single-player idea,
the shell owns rounds, result and tournament reporting, and a ladder of levels would have had
to live inside this package as a bespoke scoreboard — the thing CLAUDE.md calls a bug rather
than a feature. One maze is one match; the shell decides how many.

We also did not build the **swipe**, and that is a separate decision with its own section.

## What makes it two-player: one added rule **[ours]**

**Your own paint is a road and the other player's is a wall.**

That single sentence is the whole conversion, and it is one rule rather than a new game. The
slide is the reference genre's slide, unchanged: you go until something stops you. All that
is added is *what* stops you. It does three things at once:

1. **It makes the choices reach each other.** Painting a square is not only taking ground, it
   is putting up a barrier. Cutting the other roller off from a corner of the maze is the
   whole strategy, and it is the only channel between the two players.
2. **It keeps the solitaire's real problem alive.** In the single-player original the hard
   part is not covering the squares, it is not stranding yourself. That survives here, and it
   is now something an opponent can do to you.
3. **It terminates.** Squares never change hands and every roll but a bounded run of them
   paints at least one of the hundred and five, so the match cannot fail to end. The bound is
   arithmetic rather than a clock.

### The three candidates, and why this one

All three were built or costed against the same three tests: do either player's choices reach
the other, can two `easy` bots always finish it, and can two good players be separated?

| | reaches the other player | terminates | separates two good players |
|---|---|---|---|
| Two mazes, one timer, most squares wins | **no** | yes | yes |
| **All** paint blocks, including your own | yes | yes | **no** |
| **The other seat's paint blocks (shipped)** | yes | yes | yes |

The second row is the one that was actually built first, and it failed on the third column in
a way that is worth recording, because it looked obviously right. If a roller cannot cross
any paint at all, both rollers wall themselves in almost immediately: two `normal` bots
finished **after thirteen rolls with sixty-six of that version's ninety-one squares never
painted**, at 10–11. The scores are tiny, so the margin has no resolution, and the maze is a
third covered. Making only the *opponent's* paint a barrier keeps every blocking tactic and
gives a roller its own territory to move through, which is what lets the board actually fill:
the shipped rule paints 67–72% of it.

### You must paint if you can, and only then may you shift

A roll that paints nothing — back down a corridor you already own — is a move **only when no
roll paints anything**. Two reasons, and they pull in opposite directions, which is why the
rule is phrased as it is rather than as a flat yes or no.

Allowing it at all is what stops a player being written out of the match by their own trail.
A roller that has boxed itself in can shift somewhere else and carry on. Without it the match
ends the moment the *first* player runs out of straight lines, and the fill measured at 65%
against 51% with shifts forbidden.

Allowing it *freely* would make a paintless roll a waiting move, and two players who both
wait have a match that never ends. Forcing it means a turn that paints nothing only ever
happens to somebody who had no alternative, which is what keeps the stall limit below a
backstop rather than a clock anybody plays against.

## Scoring, and the rule the whole design turned on

**More squares wins. Level on squares, the seat that moved second wins. There are no draws.**

The second sentence is the single most load-bearing rule in the package, and it exists
because of a measurement.

**A maze symmetric under the half-turn hands the responder a mirroring strategy.** Answer
every roll with its image and the match finishes exactly level. And **no tie-break written in
board coordinates can ever settle the result of one** — a covariant rule applied to a
mirror-image position gives a mirror-image answer, so it ties too. The only rule that can
break a mirrored finish is one that is not a function of the board at all.

The scale of it, at the shipped tuning, over 1 000 matches a tier:

| | easy | normal | hard |
|---|---|---|---|
| matches finishing exactly level | 13.6% | 18.4% | **31.4%** |
| matches whose final board is an exact mirror image | 10.8% | 17.4% | 29.0% |

Before this rule those were **draws**, which is the defect `paint-fight` is recorded with in
`balance-aggregate.test.ts`: _"every one of 2000 matches ended 245-245. Two normal bots mirror
each other exactly on a symmetric board … the game cannot be balance-tested at all."_ This
game would have been a milder version of the same thing.

It is also the right compensation on its own terms rather than a device bolted on. The opener
paints first and it is worth **2.9 to 3.8 squares out of about 37**, so requiring it to be
*ahead* rather than merely level is half a square handed back — and half a square turns out to
be close to the right price:

| opener's share of decided matches | easy | normal | hard |
|---|---|---|---|
| if a level match were a draw | 56.5% | 62.0% | 69.4% |
| **level goes to the second mover (shipped)** | **48.8%** | **50.6%** | **47.6%** |

The bot plays this rule rather than the square count: its evaluation carries the half-square
as a constant offset — komi, in the Go sense — and its terminal score settles a finished
position by the real win condition. A search that stopped at the count would walk the opener
happily into a level finish it loses.

### Two rules were written on the centre square, measured and deleted

The centre is the one square the half-turn leaves where it is, which makes it the only square
a mirroring responder cannot answer: every other square has a distinct image, so a roll that
takes the middle puts its owner one ahead in a game that was otherwise going to finish level.
That is a real and useful property, and it is *already* how the centre behaves as an ordinary
square. Two attempts to make more of it both measured flat.

**A level match used to go to whoever held the centre**, before falling through to the second
mover. It almost never fired, and the reason is the giveaway: painting the centre is itself a
square, so a match in which somebody took it is usually a match that is no longer level. Over
1 000 matches a tier the centre finishes painted 54–56% of the time — but among matches that
finish *level* it is painted in 14.7% (easy), 3.3% (normal) and 7.0% (hard) of them. So the
rule could decide at most 2.2% of matches, and it decided them 1.3 to 2.7 points in the
opener's favour, because the opener reaches the middle first. It was a first-mover bonus
wearing a tie-break's clothes, which is what Sudoku warns against, and it went.

**The generator used to keep the middle three-by-three clear of blocks** so the centre could
always be reached. At the shipped tuning, over 800 matches a tier, it moved the level rate by
less than its own noise and cost two points of fill. It went too.

## Termination

**Structural, and it is arithmetic rather than a clock.** Every turn either paints at least
one of the hundred and five floor squares — and squares never change hands — or is one of at
most `STALL_LIMIT` paintless shifts in a row, after which the match is called. So no match can
exceed `105 × 6` turns whatever either player does.

One property makes the turn machine simple and it is worth stating: **a roller that cannot
move at all can never move again.** Travel is stopped only by blocks, by the edge and by the
other seat's paint, and the other seat's paint only ever grows. So a seat with nothing to roll
is skipped for the rest of the match rather than made to sit through turns it cannot use, and
that is a fact rather than a guess about the future. `rules.test.ts` asserts it directly, over
three hundred random positions, by playing the other seat on and re-checking.

`rules.test.ts` plays eighty matches with two `easy` bots and **no ceiling on the loop at
all**, so a regression that stopped the match terminating hangs the suite pointing at that
line rather than passing quietly with a null winner. Measured over 6 000 matches, a match
takes **34 rolls and 29 simulated seconds**, and the longest was **75 seconds** against the
ten-minute budget `apps/web/src/data/termination.test.ts` allows. This package asserts two
minutes itself, so a change that slowed a turn down fails here first.

`roundSeconds: 45` in the manifest is advertising text on the catalogue card and ends nothing.

## The board

| | Value | Why |
|---|---|---|
| Floor | 11 × 11, 121 squares | Odd both ways, so the centre is its own mirror image |
| Blocks | **8 mirrored pairs**, 16 squares | Below |
| Floor squares | 105 | |
| Squares | 76 logical units, board 836 at (32, 32) | Centred, so the half-turn maps it onto itself |
| Starts | (0, 10) and (10, 0) | Each is the other's image under the half-turn |
| Opening freeze | 0.5 s | Longer than the shell's 0.36 s board flip |
| Bot think | 0.3 s | After the freeze every seat gets |
| Settle | 0.9 s | |
| Stall limit | 6 paintless turns in a row | |

### Every maze is symmetric under the half-turn, and that is the fairness argument

Blocks go in as **mirrored pairs**, and the two starts are each other's image. So the same
seed played from the two openings is **one match and its exact mirror image** — a property
`rules.test.ts` asserts square by square, not approximately.

That is what makes seat balance structural rather than measured. Seat one's share at equal
skill is **exactly 50.0%**, at every tier, by construction; and it makes the catalogue-wide
`balance-aggregate.test.ts` a *sharp covariance test* for this game rather than a statistical
one, because any rule that is not covariant under the half-turn shows up immediately as a
share away from 50 rather than hiding inside the noise.

Everything is written to keep it true. The bot ranks its four directions **in the mover's own
frame** — seat two's order is seat one's order mapped through the half-turn — because a
tie-break in board coordinates is the exact defect Snowball Throw shipped. The space
evaluation is a breadth-first *distance*, not an order of visits, so it cannot depend on which
square came off the queue first. The keyboard's ambiguous-input rule resolves to the
horizontal axis, which the half-turn maps onto itself. And the two bot generators are handed
out **by role rather than by seat**: whoever opens gets the first stream, so the mirror is
exact rather than merely statistical.

### No two blocks ever touch, and that constraint carries the game

Corners included. Blocks that join up make corridors, corridors make dead ends, and a roller
that rolls into a dead end is stranded. The first generator placed blocks freely and produced
the thirteen-roll matches described above.

Scattered single blocks are also what the reference genre actually looks like: an open floor
with things to carom off, where the interesting question is which one you choose to stop
against. A field of isolated blocks cannot disconnect a grid either, so the connectivity check
in the generator never fires — it is kept as insurance, and asserted over 200 mazes.

### Eight pairs, and the row that ran backwards

`normal` against `normal`, 250 seeds a row, each played from both openings.

| pairs | squares painted | rolls a match | finish level | opener's share |
|---|---|---|---|---|
| 0 | 45.7% | 15 | 0.0% | **8.8%** |
| 2 | 62.4% | 22 | 17.6% | 46.0% |
| 4 | 68.4% | 28 | 22.4% | 49.6% |
| 6 | 70.8% | 33 | 20.0% | 50.4% |
| **8 (shipped)** | **69.3%** | **35** | **17.2%** | **55.2%** |
| 12 | 62.8% | 32 | 24.0% | 54.0% |
| 16 | 61.9% | 32 | 29.6% | 47.2% |
| 20 | 61.9% | 32 | 29.6% | 47.2% |

The first row is the finding, and it ran opposite to expectation: **on an empty floor the
second player wins 91% of matches.** With nothing to stop a roll, every roll crosses the whole
board, the responder can answer each one with its image, the mirror never breaks — and the
level-match rule then decides everything. **Blocks are what convert the opener's tempo into
squares.** The last two rows are identical because sixteen pairs is as many as fit under the
no-touching rule.

### The stall limit is a plateau, not a knob

`normal` against `normal`, 250 seeds a row, at eight wall pairs.

| limit | squares painted | rolls | simulated seconds |
|---|---|---|---|
| 1 | 51.5% | 16 | 14.0 |
| 3 | 64.4% | 26 | 22.4 |
| **6 (shipped)** | **69.3%** | **35** | **29.2** |
| 12 | 72.0% | 46 | 38.1 |
| 40 | 73.7% | 82 | 67.7 |

It buys fill and pays for it in match length, and it runs out of fill long before it runs out
of length. Some squares simply cannot be reached in a straight line from anywhere a roller can
stand, so the board is not going to fill however long anybody is given. Six is the knee, and
the match is still under half a minute.

## The swipe is four presses, never a drag **[ours]**

The catalogue row describes the control as a swipe. **We did not build one**, and on a lattice
that costs nothing at all — which is the unusual part, because normally it does.

`docs/input-parity.md` and `docs/input-idiom.md` rule that a drag hands a thumb a continuous
quantity a key cannot match, and Cup Pong made the general argument and paid for it by
redesigning its throw. Here there is nothing to pay. **A swipe on a grid is a direction**, and
a direction is four discrete values. There is no magnitude in it, no angle finer than a right
angle, and nothing for sub-pixel precision to buy. A key expresses one of four values exactly;
so does a press; so does a swipe. The three are equivalent by construction rather than by
normalisation, and `game.test.ts` makes that concrete by sweeping the whole unit circle through
the movement reader and counting what comes out: **four values, and no more.**

So the gesture is `turn-board`'s declared base idiom, tap-to-commit, and neither of the
variations the idiom document allows:

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W A S D` | the arrow keys |
| Pointer | tap a lit lane | tap a lit lane |

**One press is one roll.** A held key does not repeat, and a key still held when a new turn
opens does not fire by itself — you release and press again, exactly as a swipe needs the
finger lifted. That is asserted twice in `game.test.ts`, because it is the difference between
a control that feels like a gesture and one that runs away with your turn.

`Space` and `Enter` are deliberately unbound. A confirm step would make the keyboard two
gestures where the pointer is one, which is precisely the asymmetry rule 10 is about.

### The lanes are drawn, and only what is drawn can be pressed

For each direction the seat to move may actually roll, the squares that roll would cross are
outlined on the board, with a marker where it would stop. A press anywhere inside one of those
lanes plays it. A press anywhere else does nothing at all — it does not fall back on the
nearest lane and it does not select anything, which is what `docs/input-idiom.md` requires of
this archetype.

The four lanes leave the roller along different axes, so they are disjoint: a square can name
at most one of them, and a press never has to be resolved by a tie-break. `rules.test.ts`
asserts the disjointness over 200 random positions rather than taking it on trust.

A lane is a run of squares rather than a single cell, so it is a large target — far larger than
a fingertip, and no easier to hit with a mouse. When a seat has nothing left to paint, its
forced shifts are the lanes, so the pointer can always play whatever the rules allow. That last
clause was a real bug: the lane test caught a version in which a stranded player could shift
with the keyboard and not with a thumb.

### Two presses of ambiguity, and how it is resolved

The dominant axis wins. An exact tie — which for a keyboard means two direction keys held at
once, a real thing a person does — resolves horizontally rather than being refused, so a press
never silently does nothing. That rule is covariant under the half-turn, because a half-turn
maps each axis onto itself; resolving it by, say, "clockwise from the mover" would not have
been.

A direction that is not a move is **refused and costs no turn**, exactly as an illegal square
costs no turn in Reversi. Choosing is free and only a legal roll spends anything.

### Cross-device: fair, and not same-input-class-only

`sameInputClassOnly` is false, and this is the archetype `docs/input-parity.md` already rules
fair: _"Discrete targets, no time pressure; a cell is a cell."_ Nothing in this game weakens
that. There is no drag, no charge, no timing window, no continuous quantity anywhere, and no
reaction to resolve. Every action in the game is **one press choosing one of four values**, and
a thumb cannot choose one of four values more finely than a key can. The engine's precision
envelope is not even reached: the target is a lane many squares long.

The one thing a cross-device match still needs is the shared logical viewport, and this game
declares a square 900 × 900 box with the board centred in it, so both devices letterbox to the
same thing and neither sees more of the maze than the other.

## The opening freeze is in the rules, not keyed off the flip

`READY_SECONDS = 0.5` freezes both seats at the start of every turn, **in the simulation**. It
is longer than the shell's 0.36 s board flip on purpose, so no press can land on a board that
is part-way round.

It cannot be keyed off the flip instead, and this is the trap Cup Pong and Sudoku both
documented before us: **`seatView` reports no rotation at all in single-seat play**, so a
freeze that asked the flip whether it had finished would step one match on a shared phone and
a different one on two phones playing remotely. Nothing in this package reads
`SeatFlip.acceptsInput` at all — the flip is a rendering concern here and nothing else — and
`game.test.ts` drives the same seed through both presentations and compares the whole trace,
frame by frame, including the phase.

## Rule 6: what the bot can and cannot see

`chooseDirection` takes the position, which seat is to move, a generator, a tier and who
opened. There is no sixth argument. Everything it reasons about is on the board in front of
both players: how many squares each has, which direction each roll would go and how far, and
which parts of the maze each roller is nearer to. The last of those is a plain breadth-first
walk over squares nobody has painted, with a square both rollers reach in the same number of
steps counting for neither — "which part of this maze is mine to get to", which is what a
person reads off the board by eye.

The bot works out where a roll ends by calling **the same function the simulation calls**, so
the move it believes it is playing and the move that gets played are one computation rather
than two that agree today. That is issue #2465's failure mode designed out rather than tested
for.

A test asserts the bot is a pure function of the position it is shown: the same board and the
same generator give the same move however the board was arrived at.

## The bot ladder

Two axes, both honest, and both swept alone across their whole range.

| Tier | search depth | blunder rate |
|---|---|---|
| easy | 1 | 0.55 |
| normal | 3 | 0.15 |
| hard | 7 | 0 |

It searches with negamax and an alpha–beta window under the SDK's node budget, deepening one
ply at a time and keeping the best move from the last depth that finished, so a turn costs the
same on a phone as on a laptop. Measured over 108 000 simulated steps at the shipped tier, its
worst step is **4.68 ms** and its 99th percentile **0.37 ms**, against `bot-cost`'s 22 ms
reference ceiling.

### Randomness

**A generator per seat**, derived in `init` from `context.rng`, and **exactly two draws per
bot turn**, taken unconditionally before anything branches. Both are asserted by tests. A
generator that spent a different number of values depending on what it found would make a
seat's play a function of its opponent's, which is the coupling Cup Pong measured.

The streams are handed out **by role rather than by seat** — whoever opens gets the first one
— which is what makes the mirror property exact rather than statistical. See "Every maze is
symmetric" above.

### Depth, swept alone

`hard` against an untouched `normal`, 250 seeds each played from both openings, 500 matches a
row, everything else as shipped.

| depth | hard's share |
|---|---|
| 1 | 47.4% |
| 2 | 49.6% |
| 3 | 51.6% |
| 4 | 51.4% |
| 5 | 58.8% |
| 6 | 60.0% |
| **7 (shipped)** | **66.4%** |
| 8 | 66.0% |

Monotone over the range with a clear odd-ply sawtooth: the jumps are at 3, 5 and 7, and 4 and
8 are flat against the odd ply below them. An even depth ends the line on the opponent's
reply, which is worth about nothing here. **All three shipped tiers therefore sit on odd
depths.** Past 7 it stops paying: 8 costs half as much again per step and measures the same.

### Blunder rate, swept alone

Same conditions, at the shipped depth of 7.

| blunder | hard's share |
|---|---|
| **0 (shipped)** | **66.4%** |
| 0.05 | 63.8% |
| 0.15 | 62.4% |
| 0.3 | 54.2% |
| 0.5 | 44.0% |
| 0.75 | 39.2% |
| 1 | 32.4% |

Strictly monotone across the whole range. The last row is the useful one for calibration: a
bot playing entirely at random still takes **32.4%** from `normal`, which is what the ladder
is compressed against and why the tiers are spaced the way they are.

### A third axis was written, swept and deleted

`readsSpace` turned off the part of the evaluation that counts ground nobody has painted yet,
so a tier without it took the longest run available and nothing else. Swept alone against an
untouched `normal`, with blunder at zero, it is a real knob:

| depth | without the space term | with it |
|---|---|---|
| 1 | 36.6% | 47.4% |
| 3 | 44.8% | 51.6% |
| 6 | 57.4% | 60.0% |

Ten points at depth one, shrinking as the search rediscovers by looking ahead what the term
was telling it. **But at the only place it shipped — `easy`, at blunder 0.55 — it is worth 2.1
points against `normal` and 1.9 against `hard` over 1 000 matches each**, because a tier that
plays at random more than half the time cannot use a better evaluation. It read in the source
as a kind of judgement and was in practice a second, weaker spelling of the blunder rate. It
went, which is the same finding Cup Pong records for its `wander`.

## Balance, 500 seeds a pairing, each seed played from both openings

Equal tiers — 1 000 matches a row:

| | seat one | opener | finish level | squares painted | rolls | simulated seconds |
|---|---|---|---|---|---|---|
| easy v easy | **50.0%** | 48.8% | 13.6% | 67.3% | 33.9 | 28.6 |
| normal v normal | **50.0%** | 50.6% | 18.4% | 68.7% | 34.3 | 28.9 |
| hard v hard | **50.0%** | 47.6% | 31.4% | 71.5% | 35.0 | 29.4 |

**There are no draws at any tier**, by construction rather than by luck. Seat one's 50.0% is
exact rather than rounded, and it is the mirror property rather than a large sample.

Cross tier, the named tier in seat one, both openings played:

| | share | mirrored, in seat two |
|---|---|---|
| hard v easy | 74.9% | 25.1% |
| hard v normal | 67.4% | 32.6% |
| normal v easy | 61.9% | 38.1% |

Every pairing is monotone, and the two seat orders agree **exactly** — 25.1 is 100 − 74.9 to
the last decimal, not within a tolerance — because playing a tier in seat two is the mirror
image of playing it in seat one. `rules.test.ts` asserts that identity rather than a band.

The opener's share runs 47.6% to 50.6%, which is the number that actually matters here since
the seat share is fixed by construction; `openingSeat` is read rather than assumed, so the
shell's alternation across the rounds of a best-of reaches this game and washes what is left
of it out.

### The honest, uncomfortable number

**31.4% of `hard` against `hard` finishes exactly level**, and is settled by the second-mover
rule rather than by the board. That is not a bot defect: on a board symmetric under the
half-turn, two players of identical strength claim the ground each is nearer to and the split
comes out even. It falls to 18.4% at `normal` and 13.6% at `easy`, and to 13.6–17.4% across
tiers, because two players who are *not* identical do not divide a maze evenly. A person will
see it much less often than a `hard` bot playing itself does.

Three things were tried against it and two are documented above as deletions. What is left is
the rule that works: give the level match to the player who did not have the first move, which
is a compensation the opener's measured 2.9–3.8 square advantage earns anyway.

## Rule 7: colour is never the only signal, and there is no text at all

A test asserts the renderer's `text` method is never called through a whole match.

- **Seat one is round and seat two is square, everywhere.** A square seat one has painted
  carries a filled disc; one seat two has painted carries an open square outline. The rollers
  are the same two shapes at a larger size, so the thing you are moving and the ground you have
  taken read as the same object.
- The wash over a painted square only confirms what the mark inside it already said, and the
  two washes are the same lightness. In greyscale the board is read entirely by shape.
- **A block carries a notch** across it as well as being the one dark thing on a pale floor.
- **A roller that can no longer move is crossed out**, so a player can see why the turn has
  stopped coming back to them without anything having to be written down.
- The lanes are outlines on the squares they would paint, with the stopping square marked in
  the mover's own shape — a ring for seat one, a bar for seat two.

`game.test.ts` runs the same analysis `apps/web/src/data/greyscale.test.ts` runs, against this
package alone: it collects every mark drawn in either seat's palette across a match and
requires each seat to draw at least one shape the other never does.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the board flip, the palette and the drawing, and reads the simulation without
adding to it — a test renders at four different alphas and asserts the state is byte-identical
afterwards. The board geometry is exported from `game.ts` rather than duplicated, because
working out which square a press landed in is not a rendering question and the tests and the
control-parity harness need the same mapping the game uses.

A test walks every mark the game draws over 900 steps and asserts its bounding box is inside
the declared 900 × 900 box, outlines and line widths included.

`update` allocates nothing on a person's turn. On a bot's turn it builds one `SearchBudget`,
which is the same shape Reversi ships and amounts to about one small object a second. The
search itself allocates nothing per node: one whole position per ply, held at module scope, as
Reversi does.

## What the shell owns, and this package does not

Countdown, HUD, score display, pause, result, rematch, seat rotation, difficulty selection,
turn indicator and tournament reporting. `getScore()` reports squares painted — one apiece at
the start, 34 and 37 or so at the end — and `getActiveSeat()` reports whose turn it is, which
is how the shell knows the game is turn-based at all. This package draws no clock, no banner
and no text of any kind.
