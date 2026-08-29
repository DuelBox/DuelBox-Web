# Nuts and Bolts — specification

**Archetype:** `turn-board` · **Category:** Solo · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against this package's own built `rules.js` at the sample
> stated, not estimated.

A rack of seven bolts with twenty nuts spread across them. Nuts only come off at the point of
a bolt, and a nut only goes onto a bolt that is bare or already showing its own kind. Ten of
the nuts are yours and ten are the other player's, marked from the deal. A bolt whose nuts are
all the same kind pays whoever owns the nuts standing in it, and your score is the best
line-up you ever had. You have seven moves. So has the other player.

## Observed rules, and what we did not build

The catalogue row reads: _"Move nuts between the bolts until all the nuts on each bolt are the
same colour! You can only move nuts onto other nuts of the same colour."_ It also says
`modes: solo`.

The mechanic is built exactly as observed: only the outermost nut of a bolt can be taken off,
and it may only go onto a bare bolt or onto a nut of its own kind. The score is literally the
row's win condition, counted per nut: *your nuts on bolts where every nut is the same kind.*

**We did not ship it solo.** DuelBox is a box built for two people on one device, `PlaySurface`
filters a manifest's modes down to `friend` and `bot` before it draws a start button, and the
schema calls `modes` the list a lobby may offer and a mode the game cannot run a build error.
A solo-only manifest is a title, a controls card and no way to begin. The manifest declares
`friend` and `bot`, and the whole of the next section is the argument for the design that
makes those honest.

## What makes it two-player **[ours]**

**Half the nuts are yours and half are mine, from the deal, and the marks never move.**

A sorting puzzle is a solitaire, and the thing it naturally scores — did you sort it —
saturates: two good players both finish, so a duel on "who solved it" is a duel nobody can
lose. This is the wall Sudoku hit and the answer is the same one: move the contest onto
territory, which does not saturate, because the rack is one puzzle that the two of you are
solving for different reasons.

The hands are not symmetric kind by kind, and that is the point. `KIND_SHARE` is `[3, 3, 2, 1,
1]`: two kinds are mostly yours, two are mostly the other seat's, and the middle one is split.
So the bolt you most want finished is not the bolt they want finished, and the nut in your way
is usually one of theirs — which you have to put *somewhere*, and where you put it decides
whether you have just paid them. The list is its own reverse, so seat two's hand is exactly
seat one's read backwards and neither seat is dealt the easier side of it.

Three properties of the scoring rule are doing the work, and **every one of them replaced a
version that was measured and found broken**. The three failures are the whole design history
of this package, so they are recorded rather than summarised.

### 1. A score paid at a moment either player can refuse to reach is not a score

The first version was the obvious one: a bolt pays out when it is **finished**, to whoever
moved the nuts standing in it. Measured over 600 seeds a tier:

| bolts finished per match | easy v easy | normal v normal | hard v hard |
|---|---|---|---|
| pay on finishing | 3.22 | 1.35 | **0.47** |

**The better both bots played, the less of the puzzle got solved**, and a quarter of `hard`
matches ended nil-nil. Completing a bolt the opponent has more marks on pays them more than
you, so a good player never does it — and the opponent, symmetrically, never finishes yours.
Two players who both understand the game refuse to play it. `easy` only scored because it was
blundering into completions at random.

The shipped score is read off the piles as they stand. There is no moment to refuse.

### 2. A mark has to be on the nut, not on the mover

The second version fixed the veto and kept "you mark what you move". It measured worse in a
more entertaining way: two `hard` bots spent **26 moves between them pushing one nut back and
forth**, and finished a match having touched one distinct nut each.

The reason is structural. Putting a nut on a pile leaves it *on top*, which is exactly where
the other seat can lift it — and with the mark travelling with the mover, lifting it took the
mark too. One move to build, one move to steal it back, for ever. Building was a gift, so
nobody built.

Dealing the marks removes the possibility. A nut belongs to one seat for the whole match and
nothing in `rules.ts` writes a mark except the deal; a test drives sixty whole matches and
asserts the multiset of (kind, owner) pairs on the rack at the end is exactly the one dealt.

### 3. The score is a high-water mark

Anything on top of a pile can be lifted off, so a score read from the **final** rack would go
to whoever moved last rather than to whoever played best, and the closing moves of every match
would be a scramble to disturb one pile. `bank()` takes each seat's count up to what the rack
shows after every move and never down again.

That turns taking a nut off somebody's pile from a theft of their past into a denial of their
future — still a move worth playing, no longer the only move worth playing.

### The three alternatives that were rejected

| | reaches the other player | terminates | separates two good players |
|---|---|---|---|
| **Two racks, one seed, a race** | no | yes | yes |
| **One rack, sabotage** | yes | yes | **no** |
| **One rack, dealt nuts, alternating (shipped)** | yes | yes | yes |

**Two racks from one seed** is two solitaires with a shared timer: nothing either player does
is visible to the other, so there is no position to read and no reason to look up. Under rule 9
it also needs each player to see half the screen, which is a seven-bolt rack at a quarter of
the area on a 320 px phone, and it is a race — a real-time archetype, not the `turn-board` the
row names.

**One player sorts, the other scrambles** is not symmetric, so it has to be played twice and
compared, which is a race with extra steps. The saboteur's half is unpleasant, and a saboteur
bot is trivially strong — which makes the difficulty ladder meaningless in one direction and
impossible in the other.

## Scoring, and why both tiebreaks earn their place

Three levels, and each is the same quantity read a different way:

1. **Banked** — the most nuts of yours that ever stood on all-one-kind piles at once.
2. **Held** — how many of them are still standing there when the moves run out.
3. **Deep** — each of those counted as tall as the pile it stands in, so a nut in a finished
   bolt is worth four and a nut in a pair is worth two.

**A pile counts from two nuts up.** One nut dropped on a bare bolt satisfies "all the nuts on
this bolt are the same colour" on a technicality, and it is the cheapest move on the rack —
there is nearly always a bare bolt to drop onto — so a floor of one would pay every move that
had nowhere better to go. Two is the smallest number that is a *match* between nuts, which is
what the game is about. Three was measured too and is worse on every count: draws rise to 31%
at `hard` and the seat share drifts to 55–58%.

Levels two and three are not decoration; they are the score's resolution. 1 600 matches a row,
800 seeds played from each opening seat:

| draws | on the bank alone | + held | + deep (**shipped**) |
|---|---|---|---|
| easy v easy | 32.4% | 20.5% | **10.8%** |
| normal v normal | 36.5% | 27.4% | **13.6%** |
| hard v hard | 39.0% | 29.1% | **14.5%** |

Without them, two equal `hard` bots would draw two matches in five. The bank is a count from
nought to ten and two players of the same standard land on the same one of those eleven values
very often, which is exactly the failure Cup Pong records for cups-taken and Sliding Puzzle for
tiles-home.

`getScore()` reports the bank, so the shell's HUD only ever climbs and never takes back a nut a
player earned.

**A fully sorted rack is a draw, by arithmetic**, and that is the fact the match length is
chosen around: both seats own ten nuts, so if every bolt ends finished the score is ten-all
whatever either of them did. The budget is what makes the match a race for the rack rather
than a joint tidy-up — see below.

## The rack

| | Value | Why |
|---|---|---|
| Bolts | 7 | Five kinds plus two spare |
| Bolt | holds 4 nuts | |
| Kinds | 5, four nuts each — 20 nuts | |
| Owned | 10 a seat, split `[3, 3, 2, 1, 1]` | Its own reverse, so the two hands match |
| Free slots | 8, always | 28 slots against 20 nuts |
| Moves | **7 a seat**, 14 in a match | |
| Turn | 2 moves; the opening and closing turns are 1 | |
| Turn clock | 12 s a move | In the rules; see Termination |
| Bot think | 0.4 s, in whole steps | |
| Move animation | 0.2 s, in whole steps | |
| Match | **8.4 simulated seconds** at every tier | Constant unless the rack finishes early |
| Logical box | 900 × 900 | Square: the rack is centred and the margins are equal |

### Seven moves, and why the match is short

Both seats own ten nuts and a fully sorted rack is ten-all, so the budget is the only thing
that makes this a contest at all. Measured at 800 seeds a tier with everything else as shipped:

| moves a seat | draws, easy / normal / hard |
|---|---|
| **7 (shipped)** | **10.8 / 13.6 / 14.5%** |
| 9 | 16.9 / 21.8 / 22.7% |
| 13 | 41 / 48 / 31% |

Longer is not better here; longer is a rack both players have finished tidying. Seven moves a
seat is 14 decisions in a match, which is 8.4 s of bot play and, with the 12 s clock, up to
168 s if two people take every second of it.

### Two moves a turn is what makes the rack actually get sorted

The nut you want is usually under somebody else's, so a turn of one move is a turn in which
you can lift the lid or place a nut but never both. 400 seeds a tier, at `hard`:

| | bolts finished | nuts sorted | draws |
|---|---|---|---|
| one move a turn | 0.94 | 5.2 of 10 | 10.3% |
| **two (shipped)** | **2.20** | **7.5 of 10** | 13.8% |

Three and a half points of draw rate buys a rack that ends twice as sorted, which is the game
the catalogue row describes.

**It is not what the pairing was originally for, and that is worth recording.** Under the
superseded rule where the mover took the mark, strict alternation gave the *opening* seat 76 to
78% of the decided matches at every tier, and pairing the turns was the cure — the same fix
Sliding Puzzle needed, with the sign reversed. With the shipped rule the opener sits at 44 to
51% either way, so the pairing survives for a completely different reason from the one it was
introduced for. A number nobody re-measured after the design changed would have been a number
about a game that no longer exists.

The opening turn is a single move and seven is odd, so the closing turn is one too: the order
runs `A · BB · AA · … · BB · A`, which is the same sequence read backwards with the chairs
swapped, and a test asserts exactly that. An even budget would hand one seat a double turn more
than the other, which is a seat bias made of arithmetic.

## Solvability, proved rather than asserted

A sorting puzzle dealt by scattering nuts is unsolvable a good share of the time — four nuts of
one kind buried under four different lids is a rack nothing can take apart — and it fails
**silently**, because an impossible rack looks exactly like a hard one.

The deal never scatters. It **plays legal moves backwards from the finished rack**, so the walk
it took is itself a solution and the position is reachable by construction. Reading a forward
move backwards gives two conditions, and both are in `reverseMovesInto`:

- the bolt the nut is lifted from must be bare underneath or still showing the same kind — the
  "only onto its own kind" rule, read backwards;
- putting the nut back must not **finish** the bolt it goes back to, because a finished bolt is
  locked and a forward move out of one is not legal.

The tests do not take that on trust. `rules.test.ts` carries an **independent depth-first
solver**, written for the test, parameterised over the rack's shape and knowing nothing about
how the deal works, with a visited set keyed on the rack canonicalised by sorting the bolts.

| | |
|---|---|
| Racks dealt and handed to the solver | **400** |
| Racks it could not sort | **0** |
| Worst positions it had to visit | 70 |
| A hand-made rack with no legal move on it, called solvable | **no** — so the test can fail |
| Deals holding a bolt already finished, over 20 000 | **0** |
| Deals holding a pile already all one kind, over 20 000 | **0** |

The last row is a separate requirement and it is about fairness rather than solvability: a rack
dealt with two nuts of a kind already stacked would credit whoever happened to own them the
moment the first move banked, and both seats would open with a score neither of them played
for. Every point in this game is earned. It also makes the rack look like the mess a puzzle
should start as: 5.29 of the seven bolts hold two or more kinds, and 1.29 are bare.

A whole deal — up to 60 walks of 26 reverse moves, with acceptance — costs **0.027 ms**, which
is why it runs inside `init` rather than needing a table of canned racks.

The deal has **no seat in it**: no orientation, no goal that belongs to one player, only the
ownership of the nuts. So unlike a game with two goals there is nothing to balance between the
seats in the geometry, and the only rejection sampling is the one above. The ownership is
balanced by construction (ten each) and its *distribution* is made invariant by a seeded coin
that swaps the two seats outright at the end of the deal — the same device Sliding Puzzle uses
for its half-turn.

## Termination

**Structural, and three ways to reach it.** A test plays 200 matches with two `easy` bots and
**no ceiling on the loop at all** — a match that failed to finish would hang the suite rather
than pass quietly — and another asserts that all three endings actually happen:

| | share of 800 `easy` matches |
|---|---|
| Every kind finished | 84 |
| Both move budgets spent | 1 489 |
| The rack jammed: no legal move anywhere | 27 |

The third is the one a sorting puzzle can genuinely produce — every bolt with room showing a
kind nothing on top of another bolt matches — and it is why "both budgets spent" alone would
not be enough. It is a real position rather than a bug, and a test builds one by hand.

**The turn clock is in the rules, not in the shell**, and it is what makes a match with nobody
at the device finish. A forfeited move spends the budget exactly as a played one does, so two
people who put the phone down finish in `2 × 7 × 12` = **168 simulated seconds** — measured
through the game class, exactly, against the ten-minute guard in
`apps/web/src/data/termination.test.ts`. `roundSeconds` ends nothing anywhere in this
repository and it does not here.

The clock is deliberately ticked **above** the board-flip input guard. `seatRotated` reports no
rotation at all in single-seat play, so a clock frozen while the board turns would expire on
different steps in the two presentations and two devices would disagree about whose move it
was — the defect `presentation-parity.test.ts` records against three shipped games. A test
drives the same seed through both presentations with nobody playing at all, which is the
sharpest form of it: nothing but the clock decides that match, and the two traces are identical
to the step.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `A` and `D`, then `Space` | the arrow keys, then `Enter` |
| Pointer | tap a bolt, then tap another | tap a bolt, then tap another |

A move needs two things: a bolt to lift from and a bolt to put on. Both are named the same way
— **one press on one of seven columns** — so a key press and a tap mean exactly the same thing,
and neither instrument can name a column more finely than the other. There is no drag, no
charge, no timing window and no continuous quantity anywhere in the game, so the manifest does
not need `sameInputClassOnly` and this game is fair across every input family and device class.
Nothing is decided on reaction time, so nothing depends on when a packet arrives.

**A bolt is a whole column of the rack**, from one edge of the box to the other, because that
is the largest target the layout can offer a thumb and the two margins hold nothing else to
tap. Six logical units of dead space between columns means a press on the seam picks neither.

**Lifting is free and reversible.** Pressing a bolt that has nothing to give does nothing;
pressing the bolt you are holding puts it back; pressing a different bolt that has a nut to
give simply moves the choice. Only putting a nut down spends a move, and a test asserts that
holding the action key for two seconds spends none at all — with seven moves a seat, an
auto-repeating key would empty a player's whole budget in a third of a second.

Input is refused while the rack is part-way through its half-turn: the nut under a finger is
moving, so a tap would name one the player did not mean.

### What is drawn rather than left to be worked out

With a bolt in hand, **every bolt it may legally go on is ringed**, and every bolt with a nut
free to come off carries a caret past its point. Counting which bolts show a matching kind is
bookkeeping rather than skill, and it is bookkeeping a thumb and a keyboard are not equally
quick at — leaving it to the player quietly makes the game a test of the peripheral. It is the
same argument Reversi makes for marking its legal squares.

What is never drawn is which move is *good*: nothing on the rack says which pile will finish,
which nut is worth stealing, or what either seat has banked beyond the pips both players can
already count.

## The bot

Negamax with an alpha-beta window over the same rack a player is looking at, using the same win
condition a player is playing for. It has no reach into the deal, no solution, and no state
kept between moves; a test asserts it leaves the match byte-identical to how it found it, so it
cannot be reading or writing anything a player has no access to.

**The evaluation is the win condition and nothing else** — bank at 4 096, held at 192, deep at
1 — with the weights chosen only so that no amount of a lower term can outweigh one unit of the
one above it (twenty nuts held is 3 840 against one banked nut at 4 096; eighty deep is 80
against one held nut at 192). The ordering is exactly `judge`'s.

| Tier | Search depth | Blunders |
|---|---|---|
| easy | 1 move | 55% |
| normal | 2 moves | 12% |
| hard | 5 moves | 0% |

### Both knobs swept alone, both monotone, both kept

300 seeds in each seat order, against an untouched `normal`, with everything else as shipped.

| `hard` depth | 1 | 2 | 3 | 4 | **5** | 6 |
|---|---|---|---|---|---|---|
| wins vs `normal` | 40.2% | 57.8% | 69.5% | 73.7% | **76.4%** | 79.6% |

| `easy` blunder | 0 | 0.15 | 0.3 | 0.45 | **0.55** | 0.8 |
|---|---|---|---|---|---|---|
| `normal` wins | 59.8% | 64.8% | 70.3% | 73.2% | **74.8%** | 84.2% |

Both are strictly monotone over their whole range and neither is flat, so both stay. Depth six
is a further three points and is the first depth that spends the whole node budget, which makes
its answer a fact about the ceiling rather than about the position; five is the last that
always completes. `easy` needs the blunder rate because depth one with no blunders still takes
40% off `normal`, which is not a bottom rung.

**A third term was written, measured and deleted.** The first evaluation carried a `PROMISE`
term — marks on an unfinished pile, weighted by its height — as a proxy for what a position was
worth. It was a proxy for the score under a scoring rule that has since been replaced, and
under the shipped rule the thing it was approximating *is* the score: `liveMarks` is already
the position, read exactly. It went, and the evaluation is now three readings of one quantity
rather than a quantity and a guess at it.

### Randomness

**A generator per seat**, derived in `init` from `context.rng` before anything else touches it,
and **exactly two draws per move**, both taken before the bot branches. A test counts the calls
and asserts the tier that never blunders spends exactly as much of its stream as the tier that
blunders on more than half its moves — a conditional draw count is how one seat's play quietly
becomes a function of how its opponent happens to be playing.

Counted on the *calls* rather than on raw 32-bit words, and the distinction is honest rather
than convenient: `Rng.int` samples by rejection, so the words a call consumes depend on how many
legal moves the rack offers. That range is a property of the shared rack, which both seats
already see, and never of the opponent's tier — which is the thing a per-seat stream has to be
independent of.

### Cost

`SEARCH_NODES = 12 000`, above the SDK's 1 500 default, because a rack branches far wider than a
board of squares — seven bolts each offering up to six destinations. With bare bolts folded
together (two bare bolts are the same bolt to the rules, so a search that tried both would
double its work to reach one position) and finishing moves examined first, it settles at about
eight moves a position.

The budget is a **guard rather than a limiter**, which is the right way round: over 4 800
measured matches the worst single sweep spent **8 692** nodes, so every tier always reaches its
declared depth, and the ceiling exists to stop a later depth increase silently costing a frame.
It is deterministic rather than a clock, so a phone and a laptop spend the same budget and
return the same move — a clock would make the depth depend on how fast the device is, which
rule 8 forbids.

Worst single `botMove` on the development machine: **4.0 ms** at `hard`, mean 0.23 ms, against a
16.7 ms frame.

## The seat swap is this game's mirror, and it is tested

Snowball Throw measured seat one at 64.3% and bisecting found two defects that no other test in
the repository could see, both of them a rule written in board coordinates rather than in the
mover's own frame. The analogue here is a rule written in terms of `p1` and `p2` rather than in
terms of *the seat to move*.

So: take a rack, swap whose nuts are whose, hand the move to the other chair, and every answer
the rules give must come back swapped. Over 300 racks driven to varying depths, the tests
require it of `liveMarks`, `depthMarks`, `hasAnyLegalMove`, `judge` and the legal-move list, and
over 360 more they require it of **every decision the bot makes at every tier** — the same
generator state on both sides, so only the rack and the chair differ.

## Balance, 800 seeds in each opening seat

Equal tiers. Each row is 1 600 matches: 800 with seat one opening and 800 with seat two.

| | p1 | p2 | draws | **seat one, both orders** | **opening seat** | bolts finished | nuts sorted |
|---|---|---|---|---|---|---|---|
| easy v easy | 702 | 726 | 172 | **49.2%** | 49.0% | 2.08 | 7.33 / 7.38 |
| normal v normal | 672 | 710 | 218 | **48.6%** | 48.2% | 2.34 | 7.68 / 7.69 |
| hard v hard | 665 | 703 | 232 | **48.6%** | 44.6% | 2.25 | 7.61 / 7.63 |

Every seat share is inside 48–50%, comfortably inside the 45–55% band
`apps/web/src/data/balance-aggregate.test.ts` asserts. That harness's own run puts this game at
**52.3% of 86 decided matches** on its cheap 50-seed sample, and records the opening seat
changing the result in **21 of 50 seed pairs** — which is the observable form of this game
reading `context.openingSeat` rather than assuming `p1`.

The **opening seat** column is the residual first-mover effect after the two-move turn: within a
point of even at `easy` and `normal`, and 5.4 points *against* the opener at `hard`. The SDK
alternates `context.openingSeat` across the rounds of a best-of precisely so an effect of that
size washes out, and `resetMatch` takes the opener from the context.

Cross tier, both seat orders, 3 200 matches a row:

| | stronger tier as p1 | as p2 | **average** | draws |
|---|---|---|---|---|
| hard v easy | 90.1% | 89.0% | **89.6%** | 8.1% |
| hard v normal | 75.9% | 77.6% | **76.7%** | 13.0% |
| normal v easy | 74.2% | 75.3% | **74.8%** | 8.8% |

Monotone, and every pairing agrees with itself within 1.7 points across the two seat orders.

### Each tier against a uniformly random legal opponent

3 200 matches a row, so a tier's own reach is visible without another tier's play mixed into it.

| Tier | wins | draws | its bank | opponent's | bolts finished |
|---|---|---|---|---|---|
| easy | 65.4% | 7.2% | 7.28 | 6.73 | 1.81 |
| normal | 84.6% | 4.5% | 7.54 | 6.08 | 1.73 |
| hard | 92.9% | 4.4% | 7.61 | 5.62 | 1.67 |

Two equal bots hold each other to less than that, which is the game working: every move one of
them spends putting a nut where it belongs is a move the other has to answer.

## Rule 7: colour is never the only signal, and here it is the mechanic

This game is *"all the nuts on this bolt are the same colour"* and *"whose nuts are these"*. Both
questions would be colour alone if a nut were drawn as a plain disc, so shape was designed in
before a line was written rather than layered on afterwards. **There is no text on the rack at
all** — a test renders a whole match and asserts `text` is never called.

**How a greyscale player reads the board.** Every nut carries a silhouette stamped on its face
telling you what kind it is, and an outline telling you whose it is. Round things are seat
one's and square things are seat two's, everywhere, with no exceptions and nothing else to
learn.

- **The five kinds are five silhouettes**: a disc, a block, a triangle, a cross and a bar. The
  five colours run from near-white to near-slate — deliberately spread in lightness rather than
  in hue, so they agree with the glyphs on a greyscale screen instead of collapsing together.
- **The glyph is stamped twice**, either side of the shank, which makes a nut its own half-turn:
  the rack turns between players and a nut looks the same from both chairs.
- **Seat one's nuts are ringed and seat two's are boxed.** The ring's radius and the box's side
  are sized so the two cover the **same area** — `side = radius × √π` — so neither reads as the
  bigger or heavier thing, which is the pairing Happy Hippos arrived at for the same reason.
  Every nut has an owner from the deal, so both seats' marks are on screen in every frame of
  every match; `greyscale.test.ts` reaches a verdict on this game rather than reporting it
  undecidable, and this package asserts the same thing itself on every sampled frame.
- **A finished bolt carries a bar across its head** in the colour of whoever holds most of it,
  or a neutral bar when it is level.
- **Score is pips**, one per nut, countable rather than a bar to estimate; **moves left are
  ticks**, one per move, filled while unspent. Each seat's row sits in the margin nearest them
  and seat two's row is the exact half-turn of seat one's, so each player's own counters arrive
  in front of them when the rack turns. A test asserts that mirroring, mark for mark.
- **The turn clock is a bar with ticks in it**, so it reads as a quantity and not only as a
  length of colour.

### What the half-turn does to a stack, and what is done about it

Nuts only come off at the **point** of a bolt. That is a fact about the rack and not about who
is looking at it, so when the board turns half way round the point that was at the top of the
screen is at the bottom. There is no way to make a stack orientation-free, so three drawn things
carry it and none of them is colour: the **head** is a solid block with a flange under it, the
**point** is a taper, and every bolt with a nut free to move carries a **caret past its point**,
aimed off the end. "The nut under the caret is the one that moves" is true from either chair.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in bolt and level indices and imports nothing from
`game.ts`. Every delay is converted to whole simulation steps before it is counted down, so a
60 Hz phone and a 144 Hz laptop step the identical match.

`game.ts` owns the seat flip, the palette and the drawing, and reads the simulation without
adding to it — a test renders at five different alphas and asserts the match state is
byte-identical afterwards, and another asserts every `pushRotation` is paired with a
`popSeatRotation`.

`#shouldRotate` calls `seatRotated` rather than `seatView`: it is asked on every fixed step, and
the object form allocates once a step, which rule 5 forbids.

## What the shell owns, and this package does not

Countdown, HUD, score display, pause, result, rematch, seat rotation, difficulty selection, turn
indicator and tournament reporting. `getScore()` reports each seat's banked nuts — nought to ten,
only ever climbing — and `getActiveSeat()` reports whose turn it is, which is how the shell knows
the game is turn-based at all. The only clock this package draws is the 12 s move clock, which is
a rule of the game rather than a piece of match furniture.
