# Tap Match — specification

**Archetype:** `turn-board` · **Category:** Solo · **Logical box:** 900 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against this package's own `dist/rules.js`, at the sample
> size stated.

Six piles of face-down cards lie between two players, one card of each turned up. On your
turn you take one of those six cards into your rack. Three alike in your rack clear and
score. Your rack holds seven, and there is no eighth slot: take a card that completes
nothing when you are already holding seven and you are out.

## Observed rules

The catalogue row reads: _"Tap to collect cards. Complete sets of 3 to clear cards. You can
hold up to 7 cards in your stack, so collect strategically."_

Three numbers come straight from it and none of them moved: **seven** slots, **three** alike
to clear, and a filled rack as the thing that ends you. Everything else below is **[ours]**,
because the row describes a solitaire and this is a catalogue of duels.

**What we did not build from the row: the highscore.** There is no personal best, no streak
and no `solo` mode in the manifest. `PlaySurface` filters a manifest's modes down to `friend`
and `bot`, so a third would be a promise the lobby cannot keep; and a best score is a number
that only ever goes up, which would have to live inside this package as a bespoke scoreboard
— the thing CLAUDE.md calls a bug rather than a feature. The solitaire survives here as a
*measurement* instead: "one seat alone against the board, how many cards before it goes out"
is the cleanest reading of a tier's skill this game has, and it is in the ladder table below.

## What makes it two-player **[ours]**

**One board. Two racks. Every card you take is a card your opponent cannot have.**

That single sentence is the conversion, and the seven-slot rack is what gives it teeth. In
the solitaire the rack is a clock: it fills, and you lose. With two people drawing from one
board it becomes a negotiation, because the six cards face up are the same six cards for
both of you and there are only ever six.

Three consequences, and they are the whole game:

1. **A full rack has at most three cards that can save it.** Seven cards, at most two of any
   kind, is at best 2+2+2+1 — so a player at the limit needs one of at most three kinds to be
   face up on one of six piles, and needs it to still be there when their turn comes round.
2. **You can take that card first.** Denial is not a flourish here; it is the difference
   between the two strongest tiers, worth **12.6 points** of win rate on its own (table
   below). The card your opponent is waiting for is face up in front of you too.
3. **Greed is priced.** Taking a kind you hold none of costs you a slot and buys you a
   quarter of a set. Late in a match that is a real decision, and it is a decision the
   reference game never has to make because nobody is racing you to the pile.

### The three candidates, and why this one

The brief named two shapes and we wrote a third. All three were judged on the same three
questions: does either player's choice reach the other, can two `easy` bots always finish it,
and can two good players be separated.

| | reaches the other player | terminates | separates two good players |
|---|---|---|---|
| **Two racks, two private draw piles** | no | yes | yes |
| **Alternating taps with a shared discard** | yes | **no** | yes |
| **One shared board, two racks (shipped)** | yes | yes | yes |

**Parallel solitaires fail the first column outright.** Two people filling separate racks off
separate piles is two highscores with a shared timer; neither player's choices ever reach the
other, so there is no position to read and nothing to answer.

**A shared discard fails on termination**, and it fails in the way that is hardest to notice.
Anything that lets a card come back off a discard breaks the one property this game's ending
rests on — that the board only ever gets smaller — and the pairing that finds the resulting
loop is `easy` against `easy`, which is exactly the pairing the cross-game guard uses.

## The board

| | Value | Why |
|---|---|---|
| Board | 900 × 1000 logical | |
| Piles | **6**, each **15** deep, one card face up | |
| Deck | **9 kinds × 10 copies = 90 cards** | Even, and 9 kinds is 9 distinct glyphs |
| Rack | 7 slots a seat, sorted by kind | The reference's number |
| Set | 3 alike, cleared on the take | The reference's number |
| Ready freeze | 0.5 s | Longer than the shell's 0.36 s seat flip |
| Settle | 0.45 s | |
| Bot think | 0.45 s | Pacing, not difficulty — every tier waits it |
| A turn | **1.4 s** of simulated play | ready + settle + think |
| Match | **20–41 turns**, 28–58 s | Measured, 3000 matches a tier |

Three properties of that shape are load-bearing.

**Ninety is even.** A match that ran the board right out would give both seats exactly
forty-five cards. An odd board hands the opener one extra card, and given the rack arithmetic
in *Scoring* below that is not a small edge, it is a guaranteed one. `createGame` refuses an
odd shape rather than trusting anyone to remember.

**Six piles is the difficulty dial**, and it is the number the whole game sits on: it is how
many chances a rack at the limit has of finding one of its at-most-three rescues. Measured
across shapes at 1200 matches a cell, with everything else held:

| board | tier | board ran out | both racks out | draws | opener share | turns |
|---|---|---|---|---|---|---|
| **4** × 15, 10 kinds | easy | 0.0% | **34.3%** | 12.0% | 49.2% | 18 |
| **4** × 15, 10 kinds | hard | 0.0% | **35.9%** | 14.0% | 50.2% | 18 |
| **6** × 15, 9 kinds (**shipped**) | easy | 0.0% | 21.4% | 8.4% | 48.8% | 21 |
| **6** × 15, 9 kinds (**shipped**) | normal | 5.3% | 6.8% | **5.7%** | 51.0% | 41 |
| **6** × 15, 9 kinds (**shipped**) | hard | 0.0% | 19.8% | 8.0% | 49.5% | 20 |
| **8** × 15, 10 kinds | normal | 2.1% | 4.9% | 3.0% | 52.7% | 46 |

Four piles is a lottery — a third of matches end with both racks going out in the same round,
which is to say the board stopped offering either player anything. Eight is calmer still than
six and was rejected on a different axis: eight piles across 900 logical units puts a card at
**35 device pixels** wide on a 320 px phone, and a tap target that small is a fairness problem
between a thumb and a mouse. Six gives 45 px.

**The board is deliberately deeper than a match needs.** Running ninety cards out takes
twenty-six of the twenty-seven sets the deck can yield, and two `normal` bots manage it in
5.3% of matches. A rack going out is what usually ends things, which is what the reference
game is about — but the ending is reachable, so the code that handles it is exercised rather
than aspirational. A shallower board (6 × 9, 54 cards) puts it at 16% and takes the draw rate
to 15.4%, for the reason in the next section.

## A match ends only on a completed round **[ours]**

**This is the single most important rule in the document, and it is not about fairness in the
abstract — it is worth eleven points of first-mover penalty.**

The seat that opens acts first in every round. So at the moment the board stops offering a
player a card they can survive, whose turn it happens to be is decided by nothing but the
parity of the match. A rack that goes out therefore does **not** end the match on the spot:
if the opener goes out, the responder still takes the turn they are owed, and may go out too.

1500 seeds a tier, each played from both opening seats, opener's share of decided matches:

| | overflow ends it at once | completed round (**shipped**) |
|---|---|---|
| easy v easy | **39.4%** | **50.1%** |
| normal v normal | 47.1% | **50.1%** |
| hard v hard | **39.2%** | **50.3%** |

An eleven-point first-mover penalty is larger than the whole gap between `normal` and a
tier that slips 12% of the time. It is invisible to `getScore`, invisible to a unit test, and
it would have been invisible to the shared balance harness too — that harness plays both
opening seats and pools them, so a game with a savage opener penalty and no other asymmetry
reports a perfectly innocent 50% for seat one. The counterfactual above is the only thing
that finds it.

Note the middle row. At `normal` the penalty is only three points, because `normal` racks
sit further from the limit and the parity matters less often. Measuring one tier would have
made this look like a rounding difference.

## Scoring, and the tiebreak that cannot work

**Sets cleared is the score.** The winner is the seat still standing; if both are standing
(the board ran out) or neither is (they went out in the same round), it is the higher set
count, then **fewer different kinds left in hand**, then a draw.

That second tiebreak needs explaining, because the obvious one is arithmetically incapable of
separating anybody. Both seats reach either of those endings having taken exactly the same
number of cards, and `taken = 3 × sets + held`. So level on sets *means* level on cards held.
Every tiebreak phrased in cards — fewer held, more taken, anything — is a restatement of the
first rule and decides nothing at all. It is the same trap Sudoku documented one row along,
in different arithmetic.

The *composition* of those cards is free of that identity. Six cards as three pairs is a rack
one card from three clears; six singletons is a rack that was going nowhere. Both racks are
face up on the table for the whole match, so it is something to play for rather than
something explained afterwards. 3000 matches a tier:

| | one rack out | both out same round | board ran out | draws overall |
|---|---|---|---|---|
| easy v easy | 79.5% | 20.5% (**38.3%** of them drawn) | 0.0% | **7.8%** |
| normal v normal | 88.3% | 5.5% (42.1% drawn) | 6.2% (48.4% drawn) | **5.3%** |
| hard v hard | 78.6% | 21.4% (41.7% drawn) | 0.0% | **8.9%** |

So the tidier-rack rule separates about **six in ten** of the matches where both racks go out
together, and the remaining draws are honest: two racks of eight cards, level on sets, level
on shape. The overall draw rate of 5–9% is in the same range as Cup Pong's 4.5–9.1%.

`hard` draws more than `normal`, which reads backwards until you see why: `hard` plays for
denial, so both racks are pushed to the limit at once and the match ends in a round where
neither seat had anything left. That is the game working, not the bot failing.

## Termination

**Structural, and it is arithmetic rather than a clock.** Every settled turn takes exactly one
card off the board and nothing ever puts one back, so a match is at most `piles × depth` turns
long — ninety, plus at most one more to finish the last round — whatever either player does. A
refused take (an empty pile, the wrong seat, a board mid-freeze) changes nothing at all and so
cannot extend it either, exactly as an illegal square costs no turn in Reversi.

A test plays sixty matches with both seats deliberately taking the lowest-numbered pile every
time, with a guard that **throws** rather than returning, and asserts the card count falls by
exactly one a turn and that the match ends.

`roundSeconds` ends nothing here, as it ends nothing anywhere. At 1.4 s a turn the structural
ceiling is **127 s of simulated play**, against the cross-game guard's ten minutes; two `easy`
bots actually take **29 s**, and the same guard's own instrumentation measures a `normal`
match at **62.5 s**. There is no clock in this package at all — a table nobody touches simply
waits, which is the right behaviour for a game two people are playing on one phone.

## The ready freeze is in the rules, not keyed off the flip

`READY_SECONDS = 0.5` freezes the board at the start of every turn, in the simulation, and it
is longer than the shell's 0.36 s seat flip on purpose.

It cannot be keyed off the flip instead, and this is the trap Cup Pong and Sudoku both
documented before us: **`seatView` reports no rotation at all in single-seat play**, so a
freeze that asked the flip whether it had finished would step one match on a shared phone and
a different one on two phones playing remotely. A test drives the same seed through both
presentations and compares score, winner, active seat and cards left on every step.

A bot does not go through the shell either. Without the freeze in the rules it would be
choosing while the board was still turning under a person's thumb.

This game is also, deliberately, immune to the defect `presentation-parity.test.ts` records
against Archery, Archery Master and Soccer Pool: their `if (!flip.acceptsInput) return;`
early-return sits above a shot clock, so a shared screen gives 0.36 s more aiming per turn
than a single seat does. **There is no clock above or below that gate here** — nothing in this
game runs down while a player thinks.

## Controls, and why it is one press on one of six slots

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `A` and `D` to move, `Space` to take | arrows to move, `Enter` to take |
| Pointer | tap the face-up card of any pile | tap the face-up card of any pile |

Every action in this game is **one press on one of six slots**. There is no drag, no charge,
no aim and no continuous quantity anywhere, so a thumb cannot place a press more finely than
a key can and the two instruments are equivalent by construction rather than by tuning. The
game is **not** same-input-class-only, and it is fair across device classes: the whole board
is one shared logical viewport that both seats see all of (rule 9), and nothing in it is
sized to a device.

The keyboard is a `GridCursor` over one row of six — the shared component, not a per-game
one, so learning to move in Tap Match teaches you Memory Match and Reversi. It stays invisible
until a direction is pressed, so a player who only ever taps never sees a highlight.

A tap that lands in the gap between two piles takes nothing rather than being rounded to the
nearer pile: on a shared phone, "near enough" is decided by whoever has the larger thumb.

## Rule 6: what the bot can and cannot see

**`chooseTake` takes a `BoardView`. There is no field on it for the cards underneath, and no
overload that takes a `Game`.**

The view holds the six face-up kinds, how many cards are left in each pile, and both racks by
kind — all of which are on the table in front of a person. The order of the cards *buried*
under each pile is hidden from both seats, and it is held in `Game.cards`, which nothing that
chooses a move is ever handed. Rule 6 is easiest to break in this game because the information
that would decide everything is a single array one property access away; passing the whole
`Game` would have left it there for every future tier, so it is not passed. The guarantee is
structural rather than a habit.

Two tests hold it. One asserts the view's own shape — the set of its keys — so a field for the
buried cards cannot be added without a test failing. The other is behavioural: it plays nine
turns in, records the move, **shuffles every buried card under every pile**, and asserts the
bot plays the identical move. It does, because it cannot reach them.

There is no hidden-information transport in the repository, and this game does not assume one.
The secret is a shuffled array inside the simulation, both devices step the same seeded deal,
and nothing about it needs a network layer to stay secret.

## The bot ladder

Three tiers, expressed as three things a player has learned to notice, plus how often they
stop noticing anything at all.

| Tier | complete a set | prefer a second copy | take what the other rack needs | slip |
|---|---|---|---|---|
| easy | 30 | — | — | 0.35 |
| normal | 30 | 4 | — | 0.12 |
| hard | 30 | 4 | 40 | 0 |

**A take that would overflow is refused by every tier, and that is not a difficulty knob.**
Whether the card in front of you kills you is arithmetic on your own face-up rack — the one
thing here that no skill at all is needed to see. A tier that walked into it deliberately
would not be a weaker player, it would be a broken one. The slip is what kills the weak tiers,
and it kills them the way a person dies: by taking the wrong card for a reason.

A tier is not always *able* to survive. At the limit with none of its pairs face up there is
no legal move that does not end it, and that is the game rather than a failure: both racks go
out in the same round in 20.5% of `easy` matches and 21.4% of `hard` ones, which is the board
having nothing left that either player could live with.

### Randomness

**A generator per seat**, both derived in `init` from the match's own before the deal touches
it, and **exactly three values per decision** (`BOT_DRAWS_PER_TURN`), drawn unconditionally
before anything branches. Both are asserted, the second across four deliberately unalike
positions and all three tiers.

The coupling a shared stream would create is worse in this game than in the turn games that
have documented it, and for a reason specific to this one: turns alternate only until a rack
goes out, and from that moment the two seats do **not** take equal numbers of turns. So the
two seats would not even sit on fixed residues of a shared stream, which is the property that
made a shared stream provably harmless in Cup Pong.

**Ties are broken by a uniform draw among the equal-scoring piles, never by the lowest index.**
The board is one shared row read from opposite ends of a table, and a bot that always reached
for the left-hand pile would be reaching for a different pile depending on which chair it was
sitting in.

### Every knob, swept alone

Win rate is against an untouched `normal` over 1600 seeds in each seat order; the solo columns
are one seat alone against the board over 2000 runs, which no opponent can flatter.

| `setValue` at hard | win vs normal | solo cards | solo sets |
|---|---|---|---|
| 0 | 62.0% | 19.7 | 3.88 |
| 5 | 67.5% | 19.5 | 3.82 |
| 15 | 67.5% | 19.5 | 3.82 |
| **30 (shipped)** | **67.5%** | **19.5** | **3.82** |
| 60 | 66.3% | 19.5 | 3.82 |
| 120 | 65.5% | 19.5 | 3.82 |

| `pairValue` at hard | win vs normal | solo cards | solo sets |
|---|---|---|---|
| 0 | 46.1% | 15.1 | 2.35 |
| 2 | 67.5% | 19.5 | 3.82 |
| **4 (shipped)** | **67.5%** | **19.5** | **3.82** |
| 10 | 67.5% | 19.5 | 3.82 |
| 20 | 67.5% | 19.5 | 3.82 |
| 40 | 65.9% | 19.4 | 3.81 |

| `denyValue` at hard | win vs normal | solo cards |
|---|---|---|
| 0 | **54.9%** | 19.5 |
| 5 | 64.9% | 19.5 |
| 10 | 65.5% | 19.5 |
| 20 | 66.3% | 19.5 |
| **40 (shipped)** | **67.5%** | **19.5** |
| 90 | 67.5% | 19.5 |

| `slip` at hard | win vs normal | solo cards | solo sets |
|---|---|---|---|
| **0 (shipped)** | **67.5%** | **19.5** | **3.82** |
| 0.05 | 65.6% | 19.3 | 3.78 |
| 0.12 | 60.8% | 18.3 | 3.45 |
| 0.25 | 52.1% | 17.0 | 3.01 |
| 0.4 | 43.0% | 15.4 | 2.46 |
| 0.6 | 29.4% | 13.3 | 1.78 |
| 1 | 9.0% | 9.6 | 0.54 |

All four are monotone over the range they are shipped in. Three things in those tables are
worth saying out loud.

**`denyValue` is the whole of the top of the ladder.** Zero to forty is 12.6 points of win
rate, and it moves the solo columns not at all — 19.5 cards and 3.82 sets at every value —
because there is nobody to deny in a solitaire. That is the cleanest evidence in this document
that the two-player conversion is doing real work rather than decorating a highscore.

**`setValue` changes sign across the ladder, and that is the finding this sweep exists for.**
At `easy`, where it is the only signal the tier has, it is worth 4.5 points (17.1% → 21.6%
against `normal`) and lifts solo survival from 11.8 cards to 13.2. At `hard` it is flat from 5
to 30 and then turns *negative*: at 120 it out-shouts denial and costs two points. Explosive
Festival's target rule did the same thing and it was found the same way. The shipped value is
the top of the flat region rather than the peak of a noisy one.

**`pairValue` at 0 costs 21 points**, which is far more than its shape suggests. Holding a
second copy is not a nicety in this game, it is the *only* thing that can rescue a full rack,
so a tier that does not prefer it is a tier that arrives at seven slots with nothing to play.

### Two knobs were written, swept and deleted

**`narrowValue`** paid a bonus for emptying a pile, on the reasoning that a pile which
vanishes narrows what both seats have to choose from — the one thing about a take that
*position* can genuinely tell you when the rest of the pile is face down. Swept alone at
`hard` against the shipped tiers it moved the win rate by **0.4 points across its entire
range** — 67.1% at 0, then 67.4, 67.4, 67.3, 67.3, 67.2 and 67.0 at 80 — which is a quarter
of the standard error of the 1600 seeds that measured it, and moved solo survival from 19.45
cards to 19.39. It also cost the model its position independence, which the mirror-symmetry
test below depends on. It went, and the test that could not have been written with it in
place is the better half of the trade.

**`dangerValue`** is the more interesting deletion, because it was written *specifically* to
be non-redundant and it was not. Its term, `exposure(size, pairs)`, was deliberately
non-linear: zero while the rack has two slots of slack, flat one slot from the limit, and
then `4 − pairs` at the limit itself. The argument in the source was that anything linear in
this game is already spoken for — a weight on how much room a take leaves is `setValue`
spelled differently, since a set take always ends three cards lower than a keep, and a weight
on how many pairs the rack holds is `pairValue` spelled differently.

The argument was right and the term still collapsed, one level down. It only ever fires at
`size = 6`, and there the only thing separating the options is whether the card makes a new
pair — which is exactly the comparison `pairValue` already makes. Swept alone:

| `dangerValue` | at normal, vs easy | at normal, vs hard | solo cards | at hard, vs normal | solo cards |
|---|---|---|---|---|---|
| 0 | 78.7% | 32.0% | 18.26 | 66.2% | 19.31 |
| 4 | 79.3% | 32.7% | 18.26 | 67.6% | 19.31 |
| 8 | 79.3% | 32.7% | 18.26 | 67.8% | 19.31 |
| 16 | 79.3% | 32.7% | 18.26 | 67.3% | 19.31 |
| 32 | 79.3% | 32.7% | 18.26 | 67.5% | 19.31 |
| 64 | 79.3% | 32.7% | 18.26 | — | — |

The solo column is the tell: **byte-identical at every value from 0 to 64**, at both tiers. A
weight that never changes a decision in a thousand solitaires is not a weight. Deleting it
moved the shipped ladder by less than a point in every cell and the draw rate down slightly.

### Balance, 1500 seeds a pairing in each opening seat

3000 matches a row, each seed played once with each opening seat.

| | p1 | p2 | draws | **seat-one share of decided** | **opener's share** | turns |
|---|---|---|---|---|---|---|
| easy v easy | 1406 | 1359 | 235 | **50.8%** | **50.1%** | 20.9 |
| normal v normal | 1400 | 1441 | 159 | **49.3%** | **50.1%** | 41.4 |
| hard v hard | 1363 | 1369 | 268 | **49.9%** | **50.3%** | 20.2 |

Cross tier, both seat orders, 1500 seeds each:

| | p1 | p2 | draws | stronger tier's share of decided |
|---|---|---|---|---|
| hard as p1 v easy | 2462 | 411 | 127 | 85.7% |
| easy as p1 v hard | 409 | 2462 | 129 | 85.8% |
| hard as p1 v normal | 1960 | 921 | 119 | 68.0% |
| normal as p1 v hard | 977 | 1898 | 125 | 66.0% |
| normal as p1 v easy | 2297 | 616 | 87 | 78.9% |
| easy as p1 v normal | 625 | 2296 | 79 | 78.6% |

Every equal-tier share is within 0.8 points of even on both measures. Every cross-tier pairing
is monotone and agrees with itself within 2.0 points across the two seat orders.

The repository's own gate, `apps/web/src/data/balance-aggregate.test.ts` at its default fifty
seeds with both bots on `normal`, independently measures **49.5% for seat one** over 93 decided
matches, 7.0% draws, a 62.5 s mean match, **45 distinct outcomes from 100 matches** — the seed
is doing real work — and the opening seat changing the match in **46 of 50 seed pairs**. This
game reads `context.openingSeat` rather than assuming `p1`; that column is how the harness
knows.

### Solo, per tier

One seat alone against the board, taking until its rack goes out. 3000 runs a tier. This is
the reference game, and it is the only measurement here with no opponent in it.

| Tier | cards taken | sets cleared |
|---|---|---|
| easy | 13.3 | 1.76 |
| normal | 18.3 | 3.45 |
| hard | 19.5 | 3.83 |

`hard` is barely ahead of `normal` here — 19.5 against 18.3 — and that is exactly right: the
whole of `hard`'s advantage is denial, and denial is worth nothing when there is nobody to
deny. The head-to-head gap between those two tiers is 66–68%, all of it earned across the
table rather than in the rack.

### Cost

The bot scores six options with O(1) arithmetic each and allocates nothing: its view is
allocated once in `createBotState` and refilled in place. `bot-cost.test.ts` measures the
worst step at far inside a frame; there is no search, no budget and no node count.

## Mirror symmetry

The half-turn this game makes is a **seat** swap, not a spatial one — both seats read the same
six piles, in the same order, from opposite sides of one table. So the property that must hold
is that the two seats are the same player, and two tests hold it over hundreds of random
positions:

- **The same position from either seat gives the same answer.** Four hundred random boards and
  racks, all three tiers, seats relabelled: the choice must be identical.
- **A pile is scored by what is on it, never by where it is.** Three hundred random boards,
  the piles permuted, and the scores must permute with them. This is the covariance Snowball
  Throw's 64.3% seat-one share turned out to be missing, in the form this game's geometry
  gives it: a tie-break or a valuation written in board coordinates would fail here.

Position independence is not merely tidy, it is the honest model. With the rest of a pile face
down, the only knowable consequence of taking a card is that the card has left the board — and
it is the same card whichever pile it was lying on.

The layout is mirror-symmetric too, to the last bit: `slotCentre` puts seat one's slot *i*
exactly where the half-turn takes seat two's slot *i*, and the eighth card a spilled rack
drops does the same. Without the index mirroring, each player would read their own sorted rack
in the opposite direction from the other, which is a small thing that a player would notice
every single turn.

## Rule 7: colour is never the only signal, and there is no text at all

A test asserts the renderer's `text` method is never called through a whole match.

- **Seat one's rack slots are circles and seat two's are squares** — seven of each, on screen
  from the first frame to the last, in the seat's own palette. That is the discriminator the
  catalogue-wide `greyscale.test.ts` reads, and it is a *fixed* multiplicity rather than one
  that moves with the score, which is the distinction that harness is careful about.
- **Nine card kinds, nine distinct shapes**: disc, ring, filled square, hollow square,
  triangle, cross, plus, diamond, chevron. The shape alone says which kind a card is, so three
  alike are three alike in greyscale. The colours agree with the shapes and carry nothing on
  their own.
- **No card is ever drawn in a seat's colour.** A card belongs to a kind, never to a player,
  and putting one in a seat's palette would say the opposite — as well as confusing the
  greyscale harness about who owns what.
- **Sets cleared are pips** on the owner's own edge of the board: discs for seat one, squares
  for seat two, the same pairing as the slots.
- **How deep a pile still runs is a count of card edges** behind the face-up card, capped at
  six. The cap is the point: a full pile and a nearly full one look the same, and the number
  only becomes readable over the last few cards, which is when it is worth anything.
- **The eighth card a rack cannot hold is drawn**, in its own slot off the end of the rack, so
  the reason the match ended is on the table rather than in a banner.
- An empty slot is the same shape in the seat's `soft` wash, so a rack's *shape* — how full it
  is, and what it is holding twice — is readable at a glance from across the table, which is
  what makes denial a thing a person can play rather than a thing a bot can compute.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the seat flip, the palette and the drawing, and reads the simulation without
adding to it — a test renders at five different alphas and asserts the table is byte-identical
afterwards.

The board geometry is exported from `game.ts` rather than duplicated, because working out
which pile a tap landed on is not a rendering question. A test bounds **every primitive's own
box** rather than the magnitude of every argument it is passed, and that distinction is not
pedantry: the loose version passed happily while a spilled rack's eighth card was being drawn
fifty units off the right-hand edge of the board, because 950 is smaller than 1000.

`update` allocates nothing at all on either a human's turn or a bot's: the rack is a fixed
array written in place, the bot's view is allocated once in `createBotState` and refilled
there, and the `eliminated` list the SDK's `resolve` wants is a field on the game rather than
a fresh array. The only objects a match builds after `init` are the two small tallies handed
to `resolve` on the single step that ends it.

**One rule-5 breach that every other game in the catalogue has, and this one does not.**
`seatView` returns a fresh `{ seat, rotated }` object, and its own doc comment says it is
"called on presentation changes, not per frame". Every game that uses it — Memory Match, Cup
Pong, and the rest — calls it once a frame from its `#shouldRotate`, which is sixty small
objects a second in `update` in each of them. Re-deriving the expression instead is worse and
the engine says so: three games had done that, which is three chances to disagree the day
single-seat play gains a wrinkle. So this game keeps the one definition and asks it **once a
turn**, caching the answer against the active seat. `presentation` and `localSeat` are fixed
at `init`, so nothing else the answer depends on can change in between. It is a small thing
here and a shared one across the catalogue; it probably wants an issue against `seat.ts`
rather than eighty copies of this paragraph.

## What the shell owns, and this package does not

Countdown, HUD, score display, pause, result, rematch, seat rotation, difficulty selection,
turn indicator and tournament reporting. `getScore()` reports sets cleared and the winner;
`getActiveSeat()` reports whose turn it is, which is how the shell knows the game is turn-based
at all. There is no clock of any kind in this package, so there is nothing here for the shell's
furniture to duplicate.
