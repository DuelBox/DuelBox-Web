# Blocks — specification

**Archetype:** `turn-board` · **Category:** Solo · **Logical box:** 900 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against this package's compiled output at the sample
> size stated.

A nine-by-nine board with a tray of three shapes under it. On your turn you take one shape
out of the tray and put it on the board. Fill a row, a column or a three-by-three box and
it clears — and **every square that comes off pays the player who put it there**. The tray
is not refilled until all three are gone, so the third pick of every tray is whatever the
other two of you left behind. When nothing in the tray fits anywhere, the match is over,
and whoever has cleared more squares has won.

## Observed rules

From the catalogue row: _"Place blocks in the 9x9 board and fill rows, columns or squares
to clear them from the game."_ Solo, one grid, one player.

Everything below the row is **[ours]**, because the row describes a solitaire and this is a
duel. What we did **not** build from the row is the solo high score: there is no personal
best and no streak. A number that only ever goes up is a single-player idea, the shell owns
result and tournament reporting, and it would have had to live inside this package as a
bespoke scoreboard — the thing CLAUDE.md calls a bug rather than a feature. `solo` stays in
the manifest's `modes` so the row and the manifest agree about what was observed, alongside
the `friend` and `bot` that `PlaySurface` actually draws a start button for.

## What makes it two-player **[ours]**

Three things, and the first two are the whole conversion.

**One board, and every block belongs to whoever placed it.** A cleared square pays its
owner, not the player who happened to complete the line. That turns a puzzle being solved
into a board being divided: every placement is a bid on which lines you expect to profit
from, and completing a line that is mostly your opponent's hands them most of it.

**One tray, refilled only when it is bare.** You draw from the same three shapes your
opponent will draw from. Because three is odd and the seats alternate, the seat that gets
the free first pick of a tray changes every tray by itself, and the seat that opened a tray
is the one forced to take whatever is left of it. Being forced is where a strong player
gets stuck — and where the other one can aim them, by filling the board so the awkward
shape has nowhere to go.

**The box runs out.** Forty-eight shapes, sixteen trays. It is the ceiling that makes the
match unable to run for ever whatever the two players do; it is not the ending most matches
have at the weakest tier, and it is the ending most matches have at the strongest.

### The three candidates, and why this one

The brief named three shapes for the conversion. They were judged on the same three
questions Sudoku used, because Sudoku faced this exact problem — a natively single-player
game — the same week.

| | does either player's choice reach the other | can two `easy` bots always finish it | does it separate two good players |
|---|---|---|---|
| **Two boards, one shared queue** | only through the draft | yes | yes |
| **A claim mechanic on one shared board** | yes | not on its own | yes |
| **Alternating placements on one shared 9×9 (shipped)** | yes | yes, with the box | yes |

**Two boards is two solitaires with a draft bolted on.** Sudoku rejected two separate grids
for exactly this and the objection survives the shared queue: your placement never reaches
my board, so there is no position to read and nothing to answer — only a mild "which of
these three do I want you not to have". It also halves the board on a phone, twice.

**A claim mechanic is what shipped**, but it is not sufficient on its own: ownership decides
*who is paid*, and something still has to decide *when the match ends*. The shared board
supplies the interaction and the box supplies the ending.

So the shipped design is the first candidate with the claim folded into it, and the draft
kept as the shared tray. All three of the brief's ideas are in it; none of them is enough
alone.

### Sudoku's finding, applied here

Sudoku's lesson is that a duel scored on the thing that saturates at high skill is a duel
nobody can lose: its hardest tier answers 100.0% of squares correctly, so accuracy cannot
decide a match. **The equivalent here would have been survival.** A good player in
this genre does not get stuck. Measured with an endless box, one bot alone places, before it
jams: **45 shapes at `easy`, 440 at `normal` and 1 038 at `hard`** — and a quarter of `hard`'s
runs were still going at a 2 000-shape cap. Against a match of forty-eight, a duel scored on
"who fails first" is a duel that at the top never resolves at all.

So the contest is on **squares banked**, which is competitive rather than absolute: the
board is shared, and a line you clear is a line your opponent cannot. Nothing about it
saturates — two `hard` bots score 70.3 each and draw 2.8% of the time.

## Scoring: the cleared square pays the seat that placed it **[ours]**

Two alternatives were built as whole variants and each played against itself, 400 seeds a
tier played from both opening seats:

| what a clear pays | draws (easy / normal / hard) | opener's share (easy / normal / hard) | mean score |
|---|---|---|---|
| **each square to whoever placed it (shipped)** | **5.5 / 2.8 / 2.8%** | **53.7 / 49.4 / 50.6%** | 39 / 71 / 70 |
| every square to whoever completed the line | 9.8 / 5.8 / 4.0% | 50.1 / 46.9 / **44.3%** | 46 / 73 / 69 |
| one point per line, to whoever completed it | **15.0 / 12.0 / 12.5%** | **39.7 / 40.3 / 40.3%** | 4 / 8 / 7 |

**Points per line is the one that fails outright**, and it fails on resolution: a match is
decided by a number between four and eight, so an eighth of matches are drawn and the seat
that answers takes a ten-point advantage it never earned. That is the failure mode the
brief calls "too few distinct values", and no bot tuning touches it.

**Completer-takes-all is the brief's own suggestion and it is the closer call.** It plays
well — the "don't leave a line at eight" tension is real and sharp — but it draws twice as
often and it hands the responding seat 5.7 points at `hard`. Ownership scoring is finer
grained (a line splits six-three rather than going nine-nought), so two players of the same
standard land on the same total less often; and it makes the block colours *mechanical*
rather than decorative, which is the difference between rule 7 being a drawing decision and
being a rule of the game.

## The board

| | Value | Why |
|---|---|---|
| Board | 9 × 9, logical 792 × 792 at (54, 46) | |
| Square | 88 × 88 | |
| Units | 27 — nine rows, nine columns, nine boxes | The three families the reference clears |
| Tray | three shapes, 264 wide each, one row below the board | Row 9 of the same lattice |
| Shapes | 15, sizes 1 to 9 cells, mean 3.6 | Listed below |
| Shapes a match | **48** — sixteen trays | Even trays, so the free first pick is shared |
| Ready freeze | 0.5 s | Longer than the shell's 0.36 s seat flip |
| Bot think | 0.35 s | |
| Clear reveal | 0.45 s | |
| Settle | 1 s | |
| Match | 29 s at `easy`, 48 s at `normal` and `hard` | Measured, 24 matches a tier |

### The shapes

Fifteen polyominoes, written out as pictures in `rules.ts` so the set can be read at a
glance: one single, a pair and a three, four and five in a bar, each of those in both
orientations, a two-by-two, a three-by-three, and the four corner triominoes.

**They are placed exactly as dealt — there is no rotation.** That is a fairness decision,
not a simplification: rotation is a second control with no natural expression on a
keyboard, and a turn stays *one press on one of eighty-four slots* without it.

The set is deliberately **closed under the half-turn**: every shape's 180° rotation is also
in the set, nine of them being their own. That is what lets `rules.test.ts` turn a whole
position round, tray included, and require the evaluation to come out identical — the test
class that found two defects in Snowball Throw nothing else could see.

Mean size 3.6 cells against a row clear worth 9, so a player has to clear about one line
every two and a half shapes to break even. Forty-eight shapes is 173 squares onto an
81-square board: reaching the end of the box means clearing roughly 92 of them.

## Termination

**Two endings, and both are needed.**

**Nothing in the tray fits anywhere.** This is the reference's own game over made
two-player, and note that it is a fact about the *position* rather than about a seat: the
board and the tray are shared, so if the seat to move cannot place, neither could the
other. It is how **77.8% of `easy` matches end** — the weakest pairing, which is the one
`termination.test.ts` uses and the one the brief asks about — and 5.2% and 9.2% of `normal`
and `hard` ones.

**The box empties.** Forty-eight placements is a hard ceiling on the number of turns, so
the match cannot run for ever however well the two players clear. It is what stops a strong
pair playing indefinitely: measured with an endless box, `normal` places 250 shapes alone
without jamming, so survival is not a limit at the top and something else had to be.

`roundSeconds` ends nothing — it is catalogue text. There is no turn clock in this game, and
none is needed: every accepted turn spends a shape and there are forty-eight of them.

A test plays whole matches with **no loop ceiling at all**, so a regression that could not
finish would hang the suite rather than pass quietly, and asserts that both endings are
reachable — a jam in over ten of forty matches driven into the corner, and the box in at
least one. Measured match length is 29–49 simulated seconds against the cross-game guard's
ten-minute budget, and this package asserts under two minutes itself so a change that
slowed a turn down fails here first.

## The score settles on complete rounds, and it measures as inert

A round is one shape each. `winnerOf` and `getScore` report the score at the last closed
round, not the live tally.

The position it protects against is real and only the seat that moves first can reach it: a
placement that banks a line *and* jams the board ends the match with that seat one shape up
on the other, for free. **It also measures as nothing**, 400 seeds a tier, because neither
bot reads the score and so neither goes looking for it:

| the score settles | opener's share, easy | normal | hard | placements discarded on a jam |
|---|---|---|---|---|
| every placement | 54.2% | 49.4% | 51.2% | none |
| **every round — one shape each (shipped)** | **53.7%** | **49.4%** | **50.6%** | at most 1 |
| every two whole trays — three shapes each | 51.1% | 49.4% | 51.2% | at most 5 |

It is kept for the reason Cup Pong kept its own provably-inert lead alternation: it costs
two numbers, and it is what keeps the property true the moment a player who *does* read the
score sits down. The two-tray version buys 2.6 points at `easy` and nothing at the other two
tiers, which is about one standard error of this sample, and pays for it by throwing away up
to five placements of a thirty-five-placement match. That is a bad trade and it was not
taken.

The visible cost of the shipped rule is that the HUD settles a turn late: you clear a line,
the board shows it going, and the score moves when your opponent has answered.

## Controls, and why the tray is row nine **[ours]**

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W A S D`, then `Space` | arrows, then `Enter` |
| Pointer | tap a shape, then tap a square | tap a shape, then tap a square |

**The board and the tray are one ten-row lattice.** Row 9 is the tray, three columns per
shape. One `GridCursor` carries a keyboard player from the shape they want to the square
they want with no modes at all, and a tap and a key press mean exactly the same thing: the
slot under me. This is Sudoku's digit-pad idea and the reasoning is its.

Choosing a shape is free and reversible — it commits nothing. Only a square spends the
turn. Every turn begins with the first tray shape that fits somewhere already selected, so
a player who only ever taps is never made to spend a tap on selecting, and a turn is one
press for a thumb and one press for a key alike. The game is **not** same-input-class-only:
there is no drag, no charge and no continuous quantity anywhere, so no instrument can aim
more finely than another.

### The squares a shape may go on are marked, and that is not advice

A dot appears on every square the chosen shape fits on. Which squares a five-long bar fits
on is a fact about the position; working it out by eye is bookkeeping rather than skill, and
it is bookkeeping a thumb and a keyboard are *not* equally quick at — leaving it to the
player quietly makes the game a test of the peripheral. Reversi marks its legal squares for
the same reason. What is never shown is which square is *good*.

### Where a shape lands relative to the press, and the asymmetry we accepted

A shape is dropped with the middle of its bounding box, rounded down, on the square pressed.
Odd shapes are centred on the press exactly; a two-wide shape hangs one square off it, and
that offset is fixed in **board** coordinates, so it points the other way for the seat
reading the board upside down.

It cannot be made covariant. A two-wide shape is its own half-turn, so a covariant anchor
would need `a = 1 - a`. Making the anchor depend on the seat instead would fix the shared
screen and break single-seat play, where `seatView` reports no rotation at all — the trap
Cup Pong and Sudoku both documented.

We accepted it, because it costs nothing that matters. **The set of legal placements is
identical for the two seats** — asserted cell-for-cell over 120 random positions — and a
live ghost under the keyboard cursor shows exactly which squares a placement will cover. It
is the same property a chess knight has when read from the far side of the board: the shape
points the other way, and the rules do not care.

## Rule 6: what the bot can and cannot see

**`chooseMove` takes the board, the shared tray, which seat it is, a generator and a tier.
There is no sixth argument, and specifically the deal is not one.** The undealt shapes are
the one piece of information that would make this bot cheat, so the signature is what stops
it rather than a habit — the same structural guarantee Sudoku made about its solution array.
A test scrambles every undealt shape between two calls and asserts the identical move.

The horizon is honest for the same reason: when `hard` looks a move ahead and its own move
empties the tray, it **stops** rather than guessing what the next three will be, because
neither player can see them.

It does not read the running score either, which is information a player *does* have. That
is a real limitation and it is why the complete-round rule above measures as inert: a bot
that knew it was ahead would go looking for the placement that banks a line and jams the
board, and no tier does.

## The bot ladder

Two knobs, and it was four.

| Tier | blunder | beam | wins against `normal` | shapes placed alone before jamming |
|---|---|---|---|---|
| easy | 0.45 | 0 | 12.5% | 45 |
| normal | 0.10 | 0 | — | 440 |
| hard | 0 | 4 | 71.5% | 1 038 |

Win rates are from the 500-seed balance sweep below, played from both opening seats.

`blunder` is a shape put wherever it will go instead of where the bot decided — the ordinary
way a person plays without thinking. `beam` is how many of its own candidate moves the tier
checks the answer to; nought means it does not look ahead at all.

The solo column is the genre's own yardstick: one bot alone with an endless box, 20 runs a
tier, shapes placed before it jams. It is reported because the head-to-head numbers alone
cannot tell a weak evaluation from a strong one that is being blundered away. The sweeps
below use a cheaper form of the same yardstick — squares cleared per shape over a fixed 250
placements — because it has far less variance per second of measurement.

### Every knob, swept alone

Win rate is against the shipped `normal` (or the shipped `hard` for the middle table), 150
seeds played from both opening seats. All three are monotone across their whole range except
where noted.

| `easy` blunder | wins v `normal` | solo |
|---|---|---|
| 0 | 63.6% | 3.544 |
| 0.15 | 43.7% | 3.376 |
| 0.30 | 22.8% | 3.053 |
| **0.45 (shipped)** | **11.9%** | **2.670** |
| 0.60 | 6.4% | 2.213 |
| 0.80 | 1.7% | 1.467 |

| `normal` blunder | wins v `hard` | solo |
|---|---|---|
| 0 | 43.8% | 3.544 |
| 0.05 | 36.1% | 3.504 |
| **0.10 (shipped)** | **25.9%** | **3.456** |
| 0.20 | 16.6% | 3.314 |
| 0.40 | 4.4% | 2.782 |
| 0.70 | 0.3% | 1.998 |

| `hard` beam | wins v `normal` | solo |
|---|---|---|
| 0 | 63.6% | 3.544 |
| 1 | 62.6% | 3.542 |
| 2 | 71.3% | 3.532 |
| **4 (shipped)** | **74.1%** | **3.530** |
| 8 | 70.5% | 3.532 |
| 12 | 73.9% | 3.516 |

**The beam is a step, not a slope, and the step is where it should be.** A beam of one is
inert *by construction* — with one candidate there is nothing to choose between — and the
measurement agrees to within a point. Everything the lookahead is worth arrives at two, and
two to twelve is flat inside this sample's noise. Four is the cheapest value comfortably
inside the flat region.

### Two difficulty knobs were deleted, and one term with them

**`line` and `open` were per-tier switches — whether a tier counts the lines it owns, and
whether it notices the board running out of room — and both were promoted to always-on
rather than kept.** Both are real skills and both make a tier stronger. The reason they are
not difficulty settings is that turning either off moved the share of matches won by the
seat that *opens*, which is a fairness defect rather than a weak tier:

| | opener's share, equal tiers |
|---|---|
| `easy` with `line` on, `open` **off** | 55.0% |
| `easy` with `line` on, `open` on | **50.8%** |
| `hard` with `open` **off** for both seats | 58.0% |
| `hard` with `open` on for both seats | **46.2%** |

400 seeds each. A weak tier has to be weak in a way that does not depend on which chair you
are sitting in — which is the finding Sudoku recorded about its own `examine` cap, arrived
at here independently and in the same direction.

**A fourth evaluation term was written, swept and deleted.** `EMPTY_WEIGHT` counted empty
squares, on the reasoning that a board that is merely fragmented should still read as worse
than a bare one. It measured flat at every value from 0 to 8 — 26.8, 28.2, 28.6, 27.9 and
24.9 percent for `normal` against `hard` — and it moved the opener's share by 0.3 points.
`openSquares` was already saying everything it said. It went.

### The three design weights, swept against the shipped build

A shared weight cannot be swept by tuning one seat, so each value was compiled into a whole
variant module and sat opposite the shipped one, `normal` on both sides, 200 seeds from both
opening seats.

| `LINE_WEIGHT` | wins v shipped | solo |
|---|---|---|
| 0 | 8.4% | 3.265 |
| 1 | 49.1% | 3.424 |
| **2 (shipped)** | **50.0%** | **3.440** |
| 3 | 50.1% | 3.429 |
| 4 | 49.4% | 2.881 |
| 8 | 1.0% | 0.677 |

| `OPEN_WEIGHT` | wins v shipped | solo |
|---|---|---|
| 0 | 45.5% | 3.349 |
| 1 | 52.3% | 3.440 |
| **3 (shipped)** | **50.0%** | **3.440** |
| 6 | 48.5% | 3.424 |
| 12 | 42.0% | 3.460 |
| 24 | 27.0% | 3.473 |

| `SCORE_WEIGHT` | wins v shipped | solo |
|---|---|---|
| 10 | 0.8% | 0.625 |
| 30 | 3.3% | 0.898 |
| **100 (shipped)** | **50.0%** | **3.440** |
| 300 | 50.1% | 3.440 |

All three have a peak rather than a direction, which is the shape a weight should have and
the reason each was swept past its shipped value in both directions. `SCORE_WEIGHT` is the
clearest: below about 100 the positional terms start outvoting a square actually banked and
the bot collapses; above it nothing changes, because the term already dominates. The 50.0%
row in each table is the shipped module playing itself, which is the sanity check that the
harness is measuring what it claims to.

### Ties are broken at random, and that is a behaviour rather than a measurement

Among moves that evaluate to exactly the same number the bot picks uniformly. Taking the
first in generation order means taking the lowest board index, and on an early board — where
most moves are genuinely equivalent — that is a bot that fills one corner every match.

Honestly: **it does not move the numbers.** At 800 seeds the opener's share at `easy` is
54.2% with the random tie-break and 52.9% without, which is inside one standard error. It is
kept because two bots that always fill the same corner first look like one bot playing
itself, not because the measurement asks for it.

## Balance, 500 seeds a pairing in each seat order

Equal tiers — 1 000 matches a row, each seed played once with each opening seat:

| | p1 | p2 | draws | seat one, opening | seat one, answering | **seat one overall** | mean turns | ended on the box |
|---|---|---|---|---|---|---|---|---|
| easy v easy | 474 | 474 | 52 | 54.0% | 46.0% | **50.0%** | 34.9 | 22.2% |
| normal v normal | 489 | 489 | 22 | 49.5% | 50.5% | **50.0%** | 47.5 | 94.8% |
| hard v hard | 486 | 486 | 28 | 49.6% | 50.4% | **50.0%** | 47.1 | 90.8% |

Cross tier, both seat orders, 500 seeds each:

| | p1 | p2 | draws | stronger tier's share of decided |
|---|---|---|---|---|
| hard as p1 v easy | 952 | 38 | 10 | 96.2% |
| easy as p1 v hard | 38 | 952 | 10 | 96.2% |
| hard as p1 v normal | 691 | 276 | 33 | 71.5% |
| normal as p1 v hard | 276 | 691 | 33 | 71.5% |
| normal as p1 v easy | 855 | 122 | 23 | 87.5% |
| easy as p1 v normal | 122 | 855 | 23 | 87.5% |

**Seat one takes exactly 50.0% at every tier, and it is a proof rather than a sample.**
There is one board, one tray and no seat-specific geometry anywhere, so exchanging the two
seats is a relabelling and nothing else; and `init` derives **one generator for the seat
that opens and one for the seat that answers, in that order**, so the two halves of a paired
seed are the same match with the labels swapped. A test asserts exactly that, board by
board, over both `rules.ts` and the real `Game`: `b.p1 === a.p2`, the same number of turns,
and the mirrored winner. The two seat orders of every cross-tier row above come out
identical for the same reason, which is worth stating plainly — those ladder numbers carry
**no** seat component at all, which is the thing issue #2489 says a one-chair measurement
cannot promise.

**The opener takes 54.0% at `easy` and is inside half a point of even at `normal` and
`hard`.** That is a genuine first-move advantage and it is not the extra-turn artefact — it
survives the complete-round rule, both tie-break rules and every blunder rate from 0.3 to
0.6. Weak play shortens the match (34.9 turns against 47.5), and moving first is worth more
relative to a smaller total. Sudoku records the same shape of result from the same cause —
45.5% at its weakest tier against 51.6% at its strongest — and the shell's alternation of
`openingSeat` across the rounds of a best-of is what it exists for. **This game reads
`openingSeat`** rather than assuming `p1`.

## Cost

`hard`'s worst single `update` is **1.32 ms** over 24 whole matches on the development
machine, against a 16.7 ms frame and `bot-cost.test.ts`'s 22 ms reference ceiling; `easy` and
`normal` are 0.20 and 0.21 ms. The first match of a process is discarded as JIT warm-up,
which was worth 10 ms of nonsense before it was.

The search is bounded by the SDK's `SearchBudget` at its default 1 500 nodes rather than by
a clock, because a clock makes the move depend on how fast the device is and rule 8 says a
phone and a laptop step the identical match. The default is enough, and the arithmetic says
why: the widest position this game has is an empty board with three single squares in the
tray, which offers 3 × 81 = 243 moves; each of the four the beam keeps leaves a tray of two,
so at most 2 × 81 = 162 answers. 243 + 4 × 162 = 891. An earlier version re-scored every
root move on the second sweep and needed 2 400; reusing the first sweep's scores brought it
inside the default and cut a third of the cost, and it changed no decision — the equal-tier
tables came out bit-identical either side of the change.

The chunk is **5.15 KB** minified and gzipped, against the 12 KB game budget.

## Rule 7: colour is never the only signal, and there is no text at all

A test asserts the renderer's `text` method is never called through a whole match, and a
second reads back every mark and requires each seat to have drawn at least one shape the
other never does, on every sampled frame where both are on screen.

- **Seat one's blocks carry a solid stud and seat two's carry a ring**, at every size a
  block is drawn — on the board and in the tray alike. Both seats' material sits mixed
  together on one shared board, which is exactly the case the rule was written about.
- **The tray is drawn in the colour and the shape of whoever is about to own it**, so a
  player can see that these three are theirs to take before they take one.
- **The squares the chosen shape may go on carry a dot**, so the legal set is a pattern on
  the board rather than a tint.
- **A line going out is a cross through every square**, drawn for the reveal — an outcome
  told by shape, with colour confirming what the shape already said.
- **The chosen tray slot is ringed**, and the keyboard cursor draws the shape's outline on
  the squares it would cover, so what a press will do is visible before the press.
- **The box is a bar with a tick every six shapes**, so what is left reads as a count and
  not only as a length. One object, shared by both players.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the seat flip, the palette and the drawing, and reads the simulation without
adding to it — a test renders at five different alphas and asserts the state is byte
identical afterwards. The board and tray geometry is exported from `game.ts` rather than
duplicated, because working out which slot a tap landed in is not a rendering question and
the tests and the control-parity harness need the same mapping the game uses.

`update` allocates nothing on a human's turn. On a bot's turn it builds one `SearchBudget`,
which is the same shape Reversi ships and amounts to about one small object a second.
`#shouldRotate` calls `seatRotated` rather than `seatView`, because `seatView` returns a
fresh object and this is asked on every step.

## The ready freeze is in the rules, not keyed off the flip

`READY_SECONDS = 0.5` freezes both seats at the start of every turn, in the simulation. It
is longer than the shell's 0.36 s seat flip on purpose, so no tap can land on a board that is
part-way round, and it applies to a **bot** as much as to a person — a bot does not go
through the shell and would otherwise get half a second of thinking a person cannot have.

It cannot be keyed off the flip instead, and this is the trap Cup Pong documented and Sudoku
repeated: **`seatView` reports no rotation at all in single-seat play**, so a freeze that
asked the flip whether it had finished would step one match on a shared phone and a
different one on two phones playing remotely. A test drives the same seed through both
presentations, from both local seats, and compares the whole trace.

## What the shell owns, and this package does not

Countdown, HUD, score display, pause, result, rematch, seat rotation, difficulty selection,
turn indicator and tournament reporting. `getScore()` reports squares banked in complete
rounds, and `getActiveSeat()` reports whose turn it is, which is how the shell knows the game
is turn-based at all. The only clock this package draws is none: the box bar is a count of
shapes, which is a rule of the game rather than a piece of match furniture.
