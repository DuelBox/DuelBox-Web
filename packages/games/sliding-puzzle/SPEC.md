# Sliding Puzzle — specification

**Archetype:** `turn-board` · **Category:** Solo · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against the shipped `rules.ts` rather than estimated.

A three-by-three board of numbered tiles with one gap. Slide a tile into the gap. You want
the tiles in order **reading from where you are sitting**; the other player wants them in
order reading from where *they* are. The two of you are solving the same puzzle from
opposite sides of the table, and every slide that helps one of you gets in the other's way.

## Observed rules, and what we did not build

The catalogue row reads: _"This is a classic Sliding Puzzle game. Move the boxes into the
correct order."_ It also says `modes: solo`.

**We did not ship it solo, and that is the whole design decision in this package.** DuelBox
is a box built for two people on one device; a solitaire in it is a dead end for whoever
picks it. The shell agrees: `PlaySurface` filters the manifest's modes down to `friend` and
`bot` before it draws a start button, so a solo-only game today renders a title, a controls
card and no way to begin. The manifest therefore declares `friend` and `bot`. Sliding a tile
into the gap, and the arrangement you are sliding towards, are exactly what the row
describes.

## What makes it two-player **[ours]**

**One board, one gap, and two goals that are each other's half-turn.**

Seat one's finished board is 1 to 8 in reading order with the gap bottom-right. Seat two's is
that board turned 180°, which is the same thing seen from the other chair — so *neither
player has to be told what their goal is*: it is "the tiles in order, from where you are
sitting", for both of them. The shell already turns the play area half a turn when the move
changes hands, and this makes that turn the rule of the game rather than a presentation
detail.

Two properties follow, and both are asserted in `rules.test.ts`:

- **Every cell is contested except one.** A tile in seat one's home cell for it is never in
  seat two's — except the centre, which is its own half-turn, so tile 5 in the middle is good
  for both. One cooperative square out of nine.
- **The rules are invariant under the half-turn.** Turn a position round, play every slide
  mirrored, and you get the identical match with the chairs swapped: same legality, same
  scores, same result. The test drives sixty matches slide for slide and compares the boards
  after every one. That is the strongest fairness statement this game can make, and it means
  any residual seat bias has to come from the *distribution of starting boards* — which is
  the next section.

### Why not the three alternatives

**A race on identical puzzles from the same seed.** Fair, and two solitaires: nothing either
player does is visible to the other, so there is no reason to look up. It also needs two
boards, which under rule 9 means each player sees half the screen — a 3×3 puzzle at a quarter
of the area on a 320px phone — and it is a real-time archetype, not the `turn-board` the
catalogue row names.

**A sabotage mechanic.** One player solves, the other scrambles. The roles are not
symmetric, so it has to be played twice and compared, which is a race with extra steps; the
saboteur's half is unpleasant to play; and a saboteur bot is trivially strong, which makes
the difficulty ladder meaningless in one direction and impossible in the other.

**Alternating moves on one shared puzzle toward opposing goals** — what we built. It keeps
the reference mechanic intact, needs one board at full size, is genuinely `turn-board`, and
makes the seat rotation load-bearing.

## Solvability is not a detail, and here is the proof

Exactly half of the 9! arrangements of a 3×3 sliding puzzle **cannot be reached from the
finished board by any sequence of slides**. A shuffle that permuted tiles would therefore
hand out an impossible puzzle one time in two, and silently: an unsolvable board looks like
a hard one.

The shuffle never permutes tiles. It **plays legal slides from the finished board**, so it
can only ever land inside the reachable half by construction. The test does not take that on
trust:

| | |
|---|---|
| Positions reachable from the finished board, by breadth-first search | **181,440** |
| 9! / 2 | **181,440** |
| Shuffles over 5,000 seeds found outside that set | **0** |
| A board with two tiles swapped, found inside it | **no** — so the test can fail |
| Both goals inside it | **yes** |
| Every position 40 whole bot matches passed through, inside it | **yes** |

The last two rows are the ones that matter for a two-player game. Seat two's goal is the
half-turn of seat one's, and the half-turn *could* have been in the other half of the state
space — it is not: it is an even permutation and it moves the gap an even taxicab distance,
so the parity invariant is satisfied. A separate test checks 2,000 shuffles against that
invariant directly, which is the other way of proving the same thing.

## The start is exactly balanced, and blind to which seat it is dealing for

The walk starts at *seat one's* finished board, so an unfiltered walk hands seat one a head
start that no bot tuning could undo. Two things fix it.

**Rejection.** A candidate is accepted only when the two seats have the same number of tiles
home **and** the same total distance to go. About one walk in twenty qualifies; the loop
tries up to 200 and has never had to settle for less. Over 20,000 seeds, **100.000%** of
starts are exactly level.

**A seeded coin.** The accepted set is closed under the half-turn, so flipping a coin and
turning the board round makes the *distribution* invariant too — the two seats do not merely
agree on two summary numbers, they face the same distribution of boards. A test checks that
the gap lands in each cell as often as in that cell's half-turn partner, cell by cell, over
8,000 seeds, so a lean that cancels in the total cannot hide.

| Shuffle, 20,000 seeds | |
|---|---|
| Walk | 22 legal slides, never immediately retracing its own step |
| Attempts | up to 200; the fallback has never been taken |
| Exactly level starts | 100.000% |
| Distance to go | 12 (5.8%), 14 (68.7%), 16 (25.4%) |
| Tiles already home | 0 (46.0%), 1 (49.0%), 2 (4.4%), 3 (0.6%) |

There is a floor under that distance and it is structural. The two finished boards are 20
taxicab units apart, so by the triangle inequality the two distances always sum to at least
20 — and a position equidistant from both is therefore **at least ten slides from either**.
A balanced start cannot be a nearly-finished board.

## The turn is two slides, and this is the most important number in the game

The first version alternated single slides. It was unplayable, and the measurement was not
close:

| Strict alternation, 600 matches a tier | the seat that **replies** wins |
|---|---|
| easy | 77.8% |
| normal | 95.9% |
| hard | **99.7%** |
| two uniformly random seats | 51.6% |

The random row is what rules out the shuffle and the seats: on the same boards, random play
splits evenly. **The better both sides play, the worse it is to be the one who commits
first.** Every slide gains something, and whoever answers takes the larger half of the
exchange — twenty-three exchanges running.

Two things it was *not*, both tested rather than assumed:

- **Not the last word.** Ending the match on the opening seat's slide instead of the
  replier's moved the result by 0.1 of a point.
- **Not the scoring.** Switching from final-position scoring to the banked high-water mark
  moved the replier's share from 99.9 / 90.1 / 73.2% to 99.7 / 95.9 / 77.8% — which is to
  say, nothing. (The high-water mark stays for its own reasons; see below.)

The fix is to hand the reply back and forth. **A turn is two slides; the opening turn and
the closing turn are single ones.** The order runs `A · BB · AA · BB · … · AA · B` — the same
sequence read backwards with the chairs swapped, which a test asserts — and each seat still
makes exactly 23 slides. The opening seat's share falls from 99.7% to between 48 and 52%.

A Thue–Morse order, the textbook answer to this problem, was measured too: slightly worse
(55–56% to the opener) and impossible to explain to a player.

### The bot's horizon has to line up with the turn

An odd search depth stops half way through somebody's turn and values a position in which
one seat still has a slide in hand. Depth three gave `normal` a 56.4% opening-seat share;
depth four — one slide deeper, ending on the turn boundary — brought it to 51.3% with
nothing else touched. **All three tiers search an even depth**, and a test asserts it.

## The score is the best arrangement you ever had

Tiles home for you, at the moment you had most of them, banked. It only ever climbs, so the
shell's HUD never takes back a tile a player earned, and the opponent's last slide cannot
undo twenty slides of building. Filling the board in your own order wins outright and on the
spot; that is simply the top of the same scale.

Level on best arrangements, the match goes to whoever came **closest** — the smallest total
distance either board ever reached. That tiebreak is not decoration, it is the score's
resolution:

| 4,000 matches a tier | tie on best arrangement | shipped draw rate |
|---|---|---|
| easy v easy | 28.5% | **4.2%** |
| normal v normal | 37.0% | **6.1%** |
| hard v hard | 46.9% | **6.8%** |

Two equal `hard` bots reach the same best arrangement in nearly half of all matches. Without
the tiebreak, nearly half of all matches would be draws.

**The evaluation the bot uses is this win condition and nothing else** — best arrangement at
weight 8192, closest approach at 128, and the live board at 4 and 1. Eight tiles are at most
32 units from home, so no amount of the lower term can reach one unit of the higher one; the
ordering is exactly `judge`'s. The live-board term is not part of the win condition and is
deliberately the smallest: a depth-limited search that cannot see a banked improvement from
where it stands would otherwise find every slide identical and take the first.

## The board

| | Value | Why |
|---|---|---|
| Board | 3 × 3, eight tiles and a gap | See below |
| Logical box | 900 × 900 | Square, so the half-turn maps the board onto itself |
| Board square | 690, centred at (450, 450) | It **must** be centred or the flip would move it |
| Cell | 230; tile 206 with a 12-unit seam | The seam is dead space, so a tap on it slides nothing |
| Slides each | 23 | |
| Turn | 2 slides; the first and last turns are 1 | |
| Bot think | 0.42 s a slide, in whole steps | |
| Slide animation | 0.13 s, in whole steps | |
| Match | 46 slides, **25.9 simulated seconds** | Constant: nothing can add a slide |

### Three by three, not four by four

A 4×4 board was rejected on a measurement, not on taste. The separation between the two
goals scales badly: on a 3×3 the finished boards are 20 taxicab units apart, and on a 4×4
they are **58**. A balanced start is therefore at least 29 slides from either goal on a 4×4,
which puts an outright solve out of reach of any sane match length, and the game collapses
into progress-scoring with a decorative win condition nobody will ever see. On a 3×3 the
floor is 10 and the solve is reachable — rare, but real, and it happens (1.0% of `normal`
matches against a weak opponent).

The 3×3 also keeps the numbers legible on a 320px phone and keeps the search cheap.

## Termination

**Structural.** Two slide budgets, 23 each, and nothing that happens on the board can add
one. `roundSeconds` ends nothing anywhere in this repository and it does not here.

A test plays 200 matches with two `easy` bots and **no frame cap at all** — the loop has no
ceiling, so a match that failed to finish would hang the suite rather than pass quietly — and
asserts every one ended after exactly 46 slides with both budgets at zero. Through the game
class, with the shell's input plumbing, that is **25.9 simulated seconds every time**,
against the ten-minute guard in `apps/web/src/data/termination.test.ts`.

Nothing can stall either. The gap always has at least two neighbours, so banning the one
immediate takeback can never leave a player with nothing legal to do — checked over every
cell and every previous direction. There is no pass rule because there cannot be a position
that needs one.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W` `A` `S` `D` | the arrow keys |
| Pointer | tap a tile beside the gap | tap a tile beside the gap |

A key **names the tile on that side of the gap**, in that player's own frame: seat two reads
the board half a turn round, so their "up" is the board's "down" and the game inverts it for
them. A tap names the tile directly. The two instruments say exactly the same thing — one of
four discrete choices — so neither can express something the other cannot, and no precision
advantage exists to be had. Nothing here is a drag or a swipe.

**A press, never a hold.** Holding a direction slides once and then stops. With 23 slides to
spend, an auto-repeating key would empty a player's whole turn allowance in a third of a
second; a test holds a key for two seconds and asserts at most one slide.

Input is refused while the board is part-way through its half-turn — the tile under a finger
is moving, so a tap would slide one the player did not mean.

## The bot

Three tiers, expressed only as how far ahead the bot looks and how often it throws the
position away. It searches the same board a player is looking at, using the same win
condition a player is playing for; it has no reach into the shuffle, no solution, and no
state kept between slides. A test asserts it leaves the match byte-identical to how it found
it, so it cannot be reading or writing anything a player has no access to.

| Tier | Search depth | Blunders |
|---|---|---|
| easy | 2 slides | 45% |
| normal | 4 slides | 15% |
| hard | 6 slides | 0% |

Negamax with an alpha-beta window over a module-level board that is mutated and undone, so a
slide costs no allocation — not even the closure `deepen` is handed, which is defined once at
module scope. A seat that is part-way through its turn keeps the sign and the window, so a
two-slide turn is searched as one plan rather than as two halves handed to different players.

**Randomness.** A generator per seat, derived in `init`, and **exactly two values per slide**,
drawn unconditionally before anything branches. A conditional draw count is how one seat's
play quietly becomes a function of how its opponent is playing; both are asserted.

### Cost

`packages/game-sdk`'s node budget, at the default 1,500. The measured worst is **263 nodes**,
so the shipped depths are always reached and the budget is a guard rather than a limiter —
which is the right way round: it is what stops a later depth increase from silently costing a
frame, and it is deterministic, so the same board spends the same budget and returns the same
slide on a phone and on a laptop. A clock would make the depth depend on how fast the device
is, which rule 8 forbids.

Worst single `update` on the development machine: **0.09 ms** at `hard`, against a 16.7 ms
frame.

### Balance, 2,000 seeds per opening seat

Equal tiers. Each row is 4,000 matches: 2,000 with seat one opening and 2,000 with seat two.

| | p1 / p2 / draw (opens p1) | p1 / p2 / draw (opens p2) | **seat one, both orders** | **opening seat** | draws |
|---|---|---|---|---|---|
| easy v easy | 998 / 919 / 83 | 921 / 994 / 85 | **50.1%** | 52.0% | 4.2% |
| normal v normal | 992 / 876 / 132 | 943 / 946 / 111 | **51.5%** | 51.6% | 6.1% |
| hard v hard | 908 / 959 / 133 | 972 / 889 / 139 | **50.4%** | 48.2% | 6.8% |

Every seat share is inside 47–53%, and the two seat orders are near mirror images of each
other, which is the empirical form of the invariance proved in `rules.test.ts`.

The **opening seat** column is the residual first-mover effect after the two-slide turn: two
points at `easy` and `normal`, and slightly negative at `hard`. The SDK alternates
`context.openingSeat` across the rounds of a best-of precisely so an effect of that size
washes out, and this game reads it — `resetMatch` takes the opener from the context, and a
replication of `balance-aggregate.test.ts` against this package records the opening seat
swinging the result in 29 of 60 seed pairs, with seat one on 50.0% of 116 decided matches.

Cross tier, 1,200 matches in each seat order:

| | stronger tier as p1 | as p2 | average |
|---|---|---|---|
| hard v easy | 98.0% | 97.1% | **97.6%** |
| normal v easy | 86.8% | 83.4% | **85.1%** |
| hard v normal | 82.4% | 78.5% | **80.4%** |

Monotone, and each pairing agrees with itself within 4 points across the two seat orders.

### Solo, per tier

Each tier against a uniformly random legal opponent, 1,200 matches, so a tier's own reach is
visible without another tier's play mixed into it. "Best" is out of 8.

| Tier | wins | its best arrangement | opponent's | solved outright |
|---|---|---|---|---|
| easy | 86.8% | 3.45 | 1.93 | 0.33% |
| normal | 97.5% | 3.96 | 1.47 | 1.00% |
| hard | 99.8% | 4.29 | 1.26 | 0.75% |

Two equal bots hold each other to far less than that — 2.53, 2.11 and 1.92 at easy, normal
and hard — because every slide one of them spends improving its own order is a slide the
other has to answer. That is the game working: an outright solve is a knockout against weak
opposition and essentially unreachable against a good one, which is why the closest-approach
tiebreak carries most of the decisions.

## Rule 7: colour is never the only signal

- **Every tile carries its number**, which is the whole of its identity, and the board turns
  with the player so both of them read their numbers upright.
- **Seat one is a ring and seat two a cross**, everywhere: the frame of the board, the
  slide counters, and the badge on a tile standing in a seat's home cell. Seat one's badge
  sits in the tile's top-left corner and seat two's in the bottom-right, so under the
  half-turn each player finds their own mark in the same place.
- **A tile that is home for somebody is drawn brighter**, so progress reads at a glance
  before anybody looks at the badges.
- **The gap is a recess with a cross-hatch**, so it is a hole rather than a pale tile.
- **What can be slid is drawn**: an arrow on each tile that can move into the gap, pointing
  at the gap, and a **bar** across the one tile that cannot — the slide that would
  immediately undo the last one. The ban is a rule a player has to know about, so it is on
  the board rather than in a paragraph.
- **Slides left are pips, one per slide**, countable rather than a bar to estimate; spent
  ones are hollow. Each seat's row sits in the margin nearest them, and seat two's row is the
  exact half-turn of seat one's, so each player's own counter arrives in front of them when
  the board turns.

A test strips every colour out of the draw calls and asserts the two seats still produce
different pictures.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in cell indices and imports nothing from `game.ts`.
Every delay is converted to whole simulation steps before it is counted down, so a 60 Hz
phone and a 144 Hz laptop step the identical match. `game.ts` owns the seat flip, the palette
and the drawing, and reads the simulation without adding to it — a test renders eighty frames
at two different alphas and asserts the match state is byte-identical afterwards.

A test also drives the same seed through both presentations and asserts a bit-identical
match. `seatView` reports no rotation at all in single-seat play, so anything keyed off the
board's half-turn would step one match on a shared phone and a different one on two phones
playing remotely.

## Fairness across devices

Fair across every input family and every device class, and it does not need
`sameInputClassOnly`. The whole of a player's expression is one of four discrete choices,
made by a key press or by a tap on a large target; there is no continuous quantity, no
timing window and no precision envelope to be had. A thumb, a mouse, a trackpad and a
keyboard can each name a tile exactly, and none of them can name it more finely than
another. Nothing in the game is decided on reaction time, so nothing depends on when a
packet arrives.
