# Solitaire — specification

**Archetype:** `turn-board` · **Category:** Solo · **Logical box:** 900 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and every
> number below was measured against this package's own `dist/rules.js`, at the sample size
> stated. The harness is `playMatch` in `src/rules.test.ts`, so the numbers can be reproduced
> from the repository rather than from a script in somebody's `/tmp`.

One deal, laid out the way every solitaire is: seven columns, a stock, a waste, four
foundations. Two people take turns on it. On your turn you make exactly one move, and every
move opens the board a little — a card goes up, a card turns over, or the stock turns. A card
you send up is worth its face value **to you**, and it is gone for the other seat. When nobody
can move, whoever has more points has won.

## Observed rules, and the problem with them

The catalogue row reads: _"This is a classic Solitaire game. Depending on the selected
difficulty, different numbers of cards are revealed."_ Solo, one deal, one player.

**The name means alone, and that is the whole difficulty.** It is worse than Sudoku's, because
sudoku at least has a countable thing to divide. Three ways of seating a second person at a
solitaire were considered before anything was written, against three tests: does either
player's choice reach the other, can two `easy` bots always finish it, and can two good
players be separated.

|                                                                 | reaches the other player | terminates          | separates two good players |
| --------------------------------------------------------------- | ------------------------ | ------------------- | -------------------------- |
| **Two deals from one seed, raced**                              | **no**                   | no                  | yes                        |
| **One deal, alternating turns, score what you place (shipped)** | yes                      | **by construction** | yes                        |
| **One deal, a foundation each**                                 | yes                      | by construction     | yes, but on the deal       |

**A race is the weak answer and it fails on three counts.** Nothing either player does is
visible to the other, so there is no position to read and no reason to look up; it needs two
tableaux, which under rule 9 means each player sees half the screen — a seven-column solitaire
at a quarter of the area on a 320px phone; and it is a real-time archetype, not the
`turn-board` the row names. It also does not terminate: a solitaire's ordinary ending is a
deadlock, and a race between two stuck players never ends at all.

**A foundation each** — you own hearts and spades, I own clubs and diamonds — makes denial
real and is genuinely two-player. It was rejected because it puts the match on the deal: if
the two suits you own are buried at the bottom of the two longest columns, you lose to the
shuffle rather than to the other player, and nothing about how you play changes it. The
shipped design keeps the foundations shared, so the fifty-two cards are one pool and every one
of them is available to whoever gets there first.

Everything below the observed row is therefore **[ours]**. What we did **not** build from the
row is at the end.

## What makes it two-player **[ours]**

**Two seats take turns on one deal, and a card you send up scores its face value to you.**

That one rule does most of the conversion, and it does it the way Sudoku's did: it turns a
puzzle being finished into a pool being divided. Whether the deal comes out is not the
question — a competent pair clears most of it either way, and _a duel scored on the thing that
saturates is a duel nobody can lose_. The question is **which of the fifty-two are yours**,
and that does not saturate, because every card goes to exactly one of you.

The tension that makes it a game needed nothing bolted on. It is already in solitaire:

> **A foundation is built in order, so the card you send up is the card that unlocks the next
> one for the other seat.** Take the five of hearts for five points and you have handed them
> the six for six.

Every bank is a gift wrapped round a point. Every card you turn over is a card you dug out for
somebody else. That is the whole duel, and it is what a person actually feels playing it.

Two more rules finish the game, and each was bought with a measurement rather than chosen.

### 1. Every move must open the board

**You must move, and there is no move that merely rearranges the tableau.** Every legal move
sends a card up, turns a face-down card over, or turns the stock. Specifically:

- send the waste's card, or a column's top card, up to its foundation;
- lay the waste's card on a column (down one rank, opposite colour, or into a gap);
- move a column's **whole face-up run** onto another column — **and only when doing so turns a
  face-down card over**;
- turn the stock.

The third bullet is the unusual one and it is doing two jobs. It is why the match cannot run
for ever (below), and it is why _you cannot wait_: there is no move that hands your opponent
nothing, so a turn is a choice about which thing to give away, never about whether to.

There is no pass in the move set. A turn is only ever let go by the clock running out.

### 2. You may not turn the stock over a card that is ready to go up

**This is the line the measurement bought, and without it the game is a bonfire.**

The first version let the stock be turned whenever it had cards. A bot deep enough to see one
reply then discovers something a person would discover too: turning the stock over a live card
destroys it for _both_ seats. It scores nothing instead of handing the opponent something, and
nothing beats a negative. The equilibrium is mutual destruction, and the measurement is
brutal — two two-ply bots, no slip, 150 seeds in each opening order:

|                                                       | turns | cards sent up  | final score   |
| ----------------------------------------------------- | ----- | -------------- | ------------- |
| the stock may bury a live card                        | 43.4  | **8.1 of 52**  | 9.6 – 9.6     |
| the stock is shut while a card is ready (**shipped**) | 86.3  | **51.2 of 52** | 178.1 – 178.1 |

Eight cards of fifty-two, and a mean final score of nine points each out of a pool of 364. That is the
same failure Sudoku names, arrived at from the other end: instead of saturating at everything,
it saturated at nothing.

With the shipped tiers rather than a bare two-ply bot the collapse is less total, but the rule
is still worth about ten cards a match at the top — 200 seeds in each opening order:

|                              | easy     | normal   | hard     |
| ---------------------------- | -------- | -------- | -------- |
| cards up, the stock may bury | 41.8     | 41.7     | 35.7     |
| cards up, **shipped**        | **50.9** | **49.1** | **45.6** |

Burying is not gone, only made honest. A card that is not _yet_ wanted can still be turned
under, and choosing to do that is real play: it costs foresight, where the old version cost
nothing at all.

### 3. A gap takes any card, not only a king **[ours]**

Klondike reserves an empty column for a king. This does not. With every tableau move already
required to turn a card over, this tableau is far tighter than Klondike's, and a gap is one of
the few outlets left. The honest measurement is that it is a small effect rather than the
freeze first guessed at — 200 seeds in each opening order:

|                       | easy     | normal   | hard     |
| --------------------- | -------- | -------- | -------- |
| cards up, kings only  | 50.0     | 48.2     | 44.1     |
| turns, kings only     | 84.2     | 83.7     | 81.1     |
| cards up, **shipped** | **50.9** | **49.1** | **45.6** |
| turns, **shipped**    | **88.8** | **87.4** | **84.8** |

About one card and four turns a match. It is kept because the game is slightly more open with
it and because a gap that any card can use is a resource both players are always fighting over,
where a kings-only gap is usually nobody's.

## Termination

**Structural, and it is arithmetic rather than a clock.** There is no turn cap, no
`roundSeconds`, and nothing to tune.

Define a **potential** on the position:

```
Φ  =  2 × (cards on the foundations)
   +  (21 − face-down cards in the tableau)
   +  2 × (24 − cards left in the stock)
   +  (24 − cards in the waste)
```

Every legal move raises it by at least one, and nothing can lower it:

| move                             | what changes                           | Φ            |
| -------------------------------- | -------------------------------------- | ------------ |
| turn the stock                   | stock −1, waste +1                     | **+1**       |
| send the waste's card up         | banked +1, waste −1                    | **+3**       |
| send a column's card up          | banked +1, sometimes a card turns over | **+2 or +3** |
| lay the waste's card on a column | waste −1                               | **+1**       |
| move a column's run onto another | a card turns over                      | **+1**       |

Φ starts at 24 and cannot pass 197, so **no match can run past 173 moves whatever anybody
does**. That last table row is also _why_ rule 1 forbids a tableau move that turns nothing
over: such a move would leave Φ where it was, and a move that changes nothing is a move two
players can make at each other for ever. That position is not hypothetical — it is the one
classic solitaire is built to reach.

The match ends the moment the seat to move has no move. Both seats face the same board, so
that is also the moment the deal is finished for everybody.

`rules.test.ts` checks the argument rather than restating it: 120 matches played with a
**uniformly random legal move every turn** — not a bot's move, because the bound must hold for
the worst play anybody could produce — asserting Φ strictly rises on every single move and that
no match exceeds the bound. A second test plays 60 `easy`-versus-`easy` matches with no ceiling
on the loop at all beyond a throw at a thousand turns, which is five times the structural bound:
a regression that stalled hangs the suite rather than passing quietly.

**Measured, through `game.ts` rather than through the rules:** two `easy` bots take **85.2 s**
of simulated play, `normal` 85.8 s and `hard` 78.6 s, over 24 matches a tier from both opening
seats. The cross-game guard's budget is 600 s.

**Two idle people also end it.** A turn nobody plays is let go when the 20-second clock runs
out, and **two let go in a row end the deal**: the board did not change, so if neither seat
will touch it there is nothing left to play for. Without that, two people who put the phone
down would hold a tournament match open for ever.

## Solvability, and why the deck is never shuffled

Under this move set an ordinary shuffled deal is close to unplayable. 200 seeds in each opening
order, shipped tiers, the only change being that the tableau is dealt from a shuffled deck:

|                           | turns     | cards sent up       | draws    |
| ------------------------- | --------- | ------------------- | -------- |
| a plain shuffled deal     | 42.8      | **6.1 of 52**       | 3.5–5.0% |
| **the shipped generator** | 84.8–88.8 | **45.6–50.9 of 52** | 0.3–1.0% |

Six cards. Not a hard deal — a dead one, and there is no cheap way to tell in advance which
shuffles are which.

**So the deck is not shuffled into the tableau at all. The deal is generated by choosing how it
will be cleared and then laying it out to suit.**

1. Pick a uniformly random interleaving of the four ace-to-king runs. That sequence is the
   order this deal _can_ be sent up in.
2. Deal the fifty-two positions of that sequence uniformly at random across the twenty-eight
   tableau slots and the twenty-four stock slots.
3. Lay each column out so its earliest card in the sequence is on **top**, and lay the stock out
   so its cards come off in sequence order — with each turn's batch reversed, because the waste
   is a pile and the card showing is the last one turned.

The clear is then trivial to state and impossible to miss: walk the sequence, and the next card
is always the top of some column or the next thing the stock will show. Nothing has to be moved
about the tableau at all.

The test does not take that on trust. It replays exactly that walk against the shipped move
rules:

|                                                           |                                        |
| --------------------------------------------------------- | -------------------------------------- |
| Deals cleared to 52 of 52, over 400 seeds                 | **400**                                |
| Deals left short                                          | **0**                                  |
| Φ at the end of a cleared deal                            | 197, the ceiling exactly               |
| Moves the walk takes                                      | 76                                     |
| Also clears at reveal 2, 3, 4 and 6                       | yes, 40 seeds each                     |
| A deal with two cards of one column swapped               | **stops short** — so the test can fail |
| The sequence respects ace-to-king in every suit, 60 seeds | yes                                    |

**What this does not promise is that the clear survives two players**, and it should not. Turn
the stock while the waste still holds an unplayed card and it is buried; a buried card comes
back only when whatever covers it is played. That is the game. What the generator guarantees is
that a deal is never _already_ lost when it is dealt, which is the difference between a duel and
a lottery.

The generator is seat-blind — it does not take a seat, and the opening seat does not change a
single card of it, which a test asserts.

## Scoring, and why face value

**A card is worth its rank: ace 1, ten 10, king 13.** A pool of 364 points. Most points wins;
level on points, more cards; level on both, a draw.

The obvious alternative is one point a card, and it fails in the way Sudoku warns about. 200
seeds in each opening order, shipped tiers:

|                                      | draw rate        | cards up    | does looking further ahead change anything? |
| ------------------------------------ | ---------------- | ----------- | ------------------------------------------- |
| **one point a card**                 | **10.5 – 12.5%** | 50.8 – 51.2 | **no**                                      |
| four value bands instead of thirteen | 0.0 – 1.5%       | 50.4 – 50.8 | yes                                         |
| **face value (shipped)**             | **0.3 – 1.0%**   | 45.6 – 50.9 | yes                                         |

The middle column is the ordinary complaint — a duel that draws one match in nine is a duel
with no resolution. The right-hand column is the fatal one. With one point a card, a search at
one, two, three, four and five plies plays **bit-identical matches**: 86.0 turns, 51.3 of 52 up,
25.6 – 25.6 every time. Taking a card pays one and unlocks a card worth one, so every move
evaluates the same and the tier is reduced to picking whichever move the generator listed first.
There is no ladder to build, because there is nothing to be better at.

Face value and four bands are both live; face value is shipped because it is what solitaire has
always scored, because it gives the widest decided margin, and because it puts the stakes at the
top of a foundation, which is where the tension already is.

**A stronger pair clears less of the deal, and that is the design working.** Of the 364-point
pool, two `easy` bots collect 96.8%, two `normal` 93.9% and two `hard` 86.4%. Better players
refuse more gifts and more cards die on the table. A game where the best line is to take
everything on offer would have no decisions in it.

## The board

|                        | Value                                               | Why                                                      |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Logical box            | 900 × 1000                                          | Header, seven columns, ledger                            |
| Card                   | 112 × 156, columns 125 apart                        | Seven columns and 19 units of margin                     |
| Header                 | stock, waste over two slots, four foundations       | Seven slots, so the lattice has no dead cell             |
| Tableau                | seven columns, 1 to 7 cards, one face up on each    | The classic deal                                         |
| Stock                  | 24 cards, **turned one at a time, never redealt**   | See below                                                |
| Face down at the start | 21                                                  | The other twenty-one flips of the match                  |
| Fan                    | 15 units for a face-down card, 34 for a face-up one | Squeezed proportionally once a column outgrows the board |
| Ledger                 | four rows of thirteen, along the bottom             | The score, on the board                                  |
| Ready freeze           | 0.5 s                                               | Longer than the shell's 0.36 s seat flip                 |
| Turn clock             | 20 s                                                | A person's; a bot never sees it                          |
| Bot think              | 0.25 s · reveal 0.2 s · settle 1 s                  |                                                          |
| Match                  | 85.7 – 88.5 turns, **79 – 86 s** of simulated play  | Measured, 24 matches a tier                              |

### The reveal count is a property of the deal, not a difficulty **[ours]**

The catalogue row ties "how many cards are revealed" to the selected difficulty. **We did not
build it that way, and the reason is structural rather than aesthetic.**

In this product, difficulty is the **bot's** difficulty: the SDK owns three tiers, the shell
picks one, and `GameContext.botDifficulty(seat)` answers _per seat_. A deal parameter is not
that. It is shared by both players, it has to be the same for both or the match is unfair, and
in a `friend`-versus-`friend` match there is no bot difficulty at all — so a deck that changed
with it would be undefined exactly when two people are sitting at the device, which is the case
this whole product is built for.

So `REVEAL_COUNT` is a constant of the rules, swept and then fixed at **one**. 200 seeds in each
opening order:

| reveal          | easy: turns | easy: cards up | hard: turns | hard: cards up | draws      |
| --------------- | ----------- | -------------- | ----------- | -------------- | ---------- |
| **1 (shipped)** | **88.8**    | **50.9**       | **84.8**    | **45.6**       | 0.3 – 1.0% |
| 2               | 73.4        | 48.3           | 64.3        | 38.8           | 1.8 – 2.5% |
| 3               | 65.1        | 44.9           | 57.8        | 37.2           | 1.8 – 2.5% |
| 4               | 59.4        | 41.7           | 54.9        | 37.0           | 1.5 – 3.5% |

One is best on every axis at once: the longest match, the most of the deal in play, and the
fewest draws. It is also the only value at which turning the stock is a real decision rather
than a formality — at one, the single card it turns is the one it buries. The generator handles
any reveal count and the solvability test proves the clear at 2, 3, 4 and 6 as well, so the
constant is a choice rather than a limitation.

**There is no redeal.** One pass through the stock, and when it is empty it is empty. That is a
real solitaire variant and it is also what makes the stock a monotone quantity, which is a third
of the termination argument.

## Controls, and why one press on one of fourteen slots

|          | Seat one                           | Seat two                           |
| -------- | ---------------------------------- | ---------------------------------- |
| Keyboard | `W A S D`, then `Space`            | arrows, then `Enter`               |
| Pointer  | tap a pile, then tap where it goes | tap a pile, then tap where it goes |

**The board is one seven-column lattice with two rows.** The top row is the solitaire header in
the order every solitaire has it — the stock, the waste across two slots, then the four
foundations — and the bottom row is the seven tableau columns. One `GridCursor` covers all
fourteen slots, and a tap and a key press mean exactly the same thing: the slot under me.

The waste occupies two slots rather than one because a seven-slot header with six things in it
would have a dead cell for a keyboard player to walk through. It is drawn as a three-card fan
across those two slots, so the slot is doing real work rather than padding.

**Picking a pile up commits nothing, and the destination decides what moves.** A column put down
on a foundation sends its top card up; the same column put down on another column moves its whole
face-up run. Pressing the pile you are holding puts it back. The stock is the one slot that is a
move all by itself. There are no modes, no picker to be stuck in, and no rule about what a cancel
does to your turn.

**Every action in this game is one press on one of fourteen slots.** There is no drag, no charge
and no continuous quantity anywhere, so a thumb cannot place a press more finely than a key can
and the game is **not** same-input-class-only. That is the same argument Cup Pong makes for
choosing two presses over a swipe, reached from the other direction: this game never needed a
continuous quantity in the first place, so none was invented.

### What the board shows, and what it does not

With a pile picked up, every slot it could legally be put down on is ringed — including which
one of the four foundations, because a card only goes up on its own suit. This is the argument
Reversi makes for drawing a dot on every legal square: reading a descending alternating run off
the board by eye is bookkeeping rather than skill, and it is bookkeeping a thumb and a keyboard
are not equally quick at, so leaving it to the player quietly makes the game a test of the
peripheral. What is never shown is which of those moves is worth making, what is under the
tableau, or what is next in the stock.

The 20-second clock is what stops the remainder being free. A player can pick pile after pile up
to compare what each would open, and that costs the only thing a turn has.

## Rule 6: what the bot can and cannot see

**`chooseMove` takes a redacted position, a generator and a profile. There is no fourth
argument, and specifically neither the face-down cards nor the stock is one.**

`redact` copies the position and replaces every face-down card and every stock card with the
value `HIDDEN`, which no rule accepts: a hidden card cannot be sent up, cannot be laid on
anything, and nothing can be laid on it. A search run against that **cannot** use what is
underneath, whatever it does. Rule 6 is a property of the data the bot is given rather than a
claim about how it behaves — the same structural guarantee Sudoku makes about its solution
array, for the same reason: the information that decides everything is one array, and passing
the whole `MatchState` would have left it one property access away for ever.

The waste is deliberately **not** redacted. Its cards were turned face up in front of both
players and stay visible in the fan, so knowing what is buried in it is knowing what everybody
watched go by.

Behaviour is checked as well as shape. A test replaces every face-down card and the whole stock
with completely different cards, hands the bot the redacted view of _that_, and asserts it plays
the identical move — at all three tiers, over 40 seeds and the first twelve turns of each.

The pessimism this leaves the bot with is real and is not corrected: a card it has not seen is
worth nothing to it, so it under-rates turning the stock and over-rates a board it can already
read. That is what a person is working with too.

## The bot ladder

Two axes, both honest: **how far ahead it looks**, and how often it settles for a move it has
already judged is worse.

| Tier   | plies | slip | share of the pool a pair collects |
| ------ | ----- | ---- | --------------------------------- |
| easy   | 1     | 0.30 | 96.8%                             |
| normal | 3     | 0.10 | 93.9%                             |
| hard   | 5     | 0    | 86.4%                             |

Depth is the right axis because this game is exactly one step beyond greed: sending a card up
pays its face value and unlocks the next card of that suit for the other seat, so a tier that
cannot see a reply cannot see the cost of its own best move. `easy` genuinely cannot.

### The plies are always odd, and that is where the strength is

**Every line the search weighs ends on a move of its own.** An even line stops the instant the
opponent has answered, so it counts one of their takes for every one of yours — which values
every bank at roughly nothing and leaves the tier picking by move order. A round-robin of seven
profiles, 100 seeds in each of two opening orders per pairing, share of everything else:

| plies         | 1     | 2     | 3         | 4     | 5         | 6     | 7     |
| ------------- | ----- | ----- | --------- | ----- | --------- | ----- | ----- |
| overall share | 26.8% | 26.8% | **52.8%** | 52.8% | **63.2%** | 63.2% | 64.3% |

Two is worth exactly nothing over one and four exactly nothing over three, because the
deepening runs an _exchange_ at a time — one of mine and one of theirs — so an even request
rounds down to the odd line below it and a line cut short by the node budget falls back to a
shorter odd line rather than to a useless even one. Seven is worth 1.1 points over five and
costs nodes that are not there to spend, so the ladder tops out at five.

Swept alone against the shipped `normal`, 250 seeds in each opening order:

| plies    | 1     | 3     | 5         | 7     |
| -------- | ----- | ----- | --------- | ----- |
| win rate | 38.6% | 59.3% | **68.7%** | 68.6% |

### Slip, swept alone

Against the shipped `normal`, 250 seeds in each opening order, everything else as shipped.
Strictly monotone across the whole range in both places it was measured:

| slip at 5 plies | 0     | 0.05  | 0.10  | 0.20  | 0.30  | 0.50  | 0.75 | 1    |
| --------------- | ----- | ----- | ----- | ----- | ----- | ----- | ---- | ---- |
| win rate        | 68.7% | 63.0% | 53.7% | 42.9% | 30.7% | 12.4% | 2.2% | 0.2% |

| slip at 1 ply | 0     | 0.15  | 0.30  | 0.50 | 1    |
| ------------- | ----- | ----- | ----- | ---- | ---- |
| win rate      | 38.6% | 30.9% | 19.8% | 9.1% | 0.2% |

### A third knob was written, swept and deleted

`tempo` added a fraction of the best card currently on offer to the leaf evaluation, signed by
whose turn it was — an attempt to say "a card left ready is a debt owed to whoever moves next".
Swept alone at one ply it is flat and then backwards (64.7%, 64.8%, 64.8%, 62.2%, 60.8% at 0,
0.25, 0.5, 1 and 2), which by itself is enough to delete it.

The reason it went is better than that. At two plies the sweep reads 62.2%, 63.3%, 61.9%,
**83.6%**, 84.8% — and that 83.6% is not merely close to a three-ply search, it is
**bit-identical** to one, across every pairing of the round-robin. Once the stock cannot be used
to bury a live card, the best move at a ply is always to take the best card on offer, so
`tempo = 1` _is_ one more ply, spelled differently and more slowly. A knob that is a second
spelling of a knob already in the profile is not a second axis. It went, and the leaf evaluation
is now the score difference and nothing else.

### The search, and its ceiling

Alpha-beta over the redacted position, iteratively deepened an exchange at a time under the
SDK's `SearchBudget` at the default 1,500 nodes.

**The budget is a ceiling on the worst positions rather than the thing that stops a typical
sweep**, and it is worth being exact about that because the obvious assumption is the other one.
A position offers **2.97 legal moves on average**, measured over 5,248 positions — the move set
is small by design, since every move has to open the board. Over 40 whole matches a tier:

|                 | mean nodes a turn | worst turn | turns that reached the ceiling |
| --------------- | ----------------- | ---------- | ------------------------------ |
| normal, 3 plies | 29.5              | 485        | **0 of 3,236**                 |
| hard, 5 plies   | 193.1             | 1,500      | **43 of 3,544 — 1.2%**         |

So `normal` never touches it and `hard` touches it on one turn in eighty. Those turns are the
ones that need it: the widest position measured offers fourteen moves, and fourteen moves at five
plies is over half a million nodes. That is exactly the shape a ceiling should have — invisible
almost always, and the difference between a considered move and a visible freeze the rest of the
time. A node count rather than a clock, because rule 8 says a phone and a laptop must step the
identical match, and a stopwatch would make the depth reached depend on the device.

Going deeper is not what the ceiling costs us either. A seven-ply profile plays the same move as
the shipped `hard` on **98.3%** of turns, and that is not because both run out of nodes — it is
because the extra exchange lands among cards the bot cannot see, so there is nothing new at the
leaf to change its mind. The horizon here is set by the face-down cards, not by the budget.

One scratch position and one move buffer per ply are allocated at module load; a search copies a
position into a pre-made one rather than unmaking a move by hand, because a position is four
small typed arrays and `set` is a memcpy. `update` allocates one `SearchBudget` on a bot's turn
and nothing else at all.

**Measured cost:** the worst single `update` at `hard`, over 24 whole matches, is **1.72 ms**
against a 16.7 ms frame — and 0.79 ms at `easy`, where the tier is shallower but the matches run
longer.

## Balance, 400 seeds a pairing in each opening order

Equal tiers — 800 matches a row, each seed played once from each opening seat:

|                 | p1  | p2  | draws | seat-one share of decided | turns | cards up | points        |
| --------------- | --- | --- | ----- | ------------------------- | ----- | -------- | ------------- |
| easy v easy     | 388 | 410 | 2     | **48.6%**                 | 88.5  | 50.7     | 175.8 / 176.4 |
| normal v normal | 397 | 401 | 2     | **49.7%**                 | 87.8  | 49.6     | 171.0 / 170.8 |
| hard v hard     | 397 | 397 | 6     | **50.0%**                 | 85.7  | 46.7     | 157.2 / 157.2 |

Cross tier, both seat orders, 400 seeds each:

|                     | p1  | p2  | draws | stronger tier's share of decided |
| ------------------- | --- | --- | ----- | -------------------------------- |
| hard as p1 v easy   | 733 | 66  | 1     | 91.7%                            |
| easy as p1 v hard   | 78  | 720 | 2     | 90.2%                            |
| normal as p1 v easy | 651 | 147 | 2     | 81.6%                            |
| easy as p1 v normal | 156 | 642 | 2     | 80.5%                            |
| hard as p1 v normal | 547 | 251 | 2     | 68.5%                            |
| normal as p1 v hard | 250 | 550 | 0     | 68.7%                            |

Every equal-tier share is within 1.4 points of even. Every pairing is monotone and agrees with
itself within **1.5 points** across the two seat orders, which is what says the ladder is
measuring skill and not a chair.

**The opening seat is worth nothing measurable**, which is unusual enough to say plainly:

|                                                                      | easy  | normal | hard  |
| -------------------------------------------------------------------- | ----- | ------ | ----- |
| opener's share of decided                                            | 49.9% | 50.0%  | 50.9% |
| seed pairs that ended differently when only the opening seat changed | 40.8% | 49.3%  | 99.3% |

The second row is the one that matters. The opening seat changes the match — at `hard` it
changes the result on essentially every seed — it just does not favour anybody. `openingSeat` is
read rather than assumed all the same, because the shell alternates it across the rounds of a
best-of and a game that ignored it would be the thirty-fifth to be fixed under #2487.

Draws run 0.25%, 0.25% and 0.75%, and the winner wins by a mean margin of 38.2, 41.2 and 37.7
points out of a 364-point pool. The `cards` tiebreak in `winnerOf` exists for the level scoreline
and almost never fires.

### The two seats are the same seat, exactly

The strongest fairness statement this game can make, and it is a stronger one than a win rate:
**relabel the seats, swap the two generators and the opening seat, and every move, every score,
the ownership of all fifty-two cards and the result come back mirrored — bit for bit.** Asserted
over 120 matches, forty a tier, in `rules.test.ts`.

It holds because the board is genuinely shared: neither seat owns a column, a foundation, a
direction or a corner, so there is no board coordinate that could fail to be covariant under the
relabelling. That is exactly the class of defect Snowball Throw's 64.3% turned out to be — a
tie-break written in board coordinates, and a threshold on a knife edge — and it is the reason
this design keeps the foundations shared rather than dealing two of them to each seat.

## Rule 7: colour is never the only signal

There is text — this game is cards, and pretending otherwise would be worse than useless — but
nothing that matters is told by colour alone.

- **The four suits are four different constructions, not two colours.** A spade is one filled
  disc on a stem; a club is three discs on a stem; a heart is two discs over a block; a diamond
  is four lines and nothing filled at all. Red and black agree with the shape and carry nothing
  on their own. Every pip in the package is drawn from engine primitives — the catalogue ships
  zero image assets, and a card face is exactly the thing that would tempt somebody to change
  that.
- **Every rank is a label** in the top-left corner of its card, which is the corner a fanned pile
  leaves showing, so a column is readable all the way down without moving anything.
- **Seat one is a filled disc and seat two an open square**, everywhere. The **ledger** along the
  bottom is four rows of thirteen, one cell per card in the deck, filled in with the taker's
  shape as each card goes up and a faint dot for one still to come. That is the score drawn where
  the thing being scored is — the same argument Sudoku makes for its unit marks — and it is the
  one place both seats' material is on screen together for the whole match, so it is what the
  greyscale harness judges the game on. A player can see at a glance which suits are being shared
  out and which one they are losing, and each row's filled prefix is exactly how far that
  foundation has got.
- **A face-down card is a back with three rules across it**, so the tableau's shape reads without
  any colour: how much of each column is still to come is a count of backs.
- **The stock is drawn as depth** — a stack of edges plus the number of cards left — because the
  stock emptying is the closest thing this game has to a clock and it should be legible as a
  quantity.
- **The slots a held pile can go to are ringed**, so what is legal is a shape on the board rather
  than a tint, and the ring on the foundations names the one suit that will take the card.
- The turn clock is a bar with ticks in it, so it reads as a quantity and not only as a length of
  colour. It is drawn only when a person is to move.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the seat flip, the palette and the drawing, and reads the simulation without
adding to it — a test renders at four different alphas and asserts the state is byte-identical
afterwards. A column that outgrows the board is squeezed by a proportional `fanScale` rather than
by asking anything about the device; a test checks that the bottom of the longest possible column
is still inside the box for every length from one card to fifty-two.

The slot geometry is exported from `game.ts` rather than duplicated, because working out which
pile a tap landed in is not a rendering question and the tests and the control-parity harness need
the same mapping the game uses.

### The ready freeze is in the rules, not keyed off the flip

`READY_SECONDS = 0.5` freezes both seats at the start of every turn, counted in simulation steps.
It is longer than the shell's 0.36 s seat flip on purpose, so no tap can land on a board that is
part-way round.

It cannot be keyed off the flip instead, and this is the trap Cup Pong and Sudoku both documented
before us: **`seatRotated` reports no rotation at all in single-seat play**, so a freeze that asked
the flip whether it had finished would step one match on a shared phone and a different one on
two phones playing remotely. Here it would be worse than a different feel, because the turn clock
is a simulation quantity: it would run out on different frames in the two presentations and the
two devices would disagree about who owned a card. A test drives one seed through both
presentations and compares the whole trace.

### Randomness

Three draws from the match generator in `init`, in a fixed order: the deal, then a stream each.
Per-seat streams mean neither seat's play is a function of how its opponent is playing. A tier
draws **exactly two values per turn**, unconditionally and before anything branches, and a test
asserts the count by comparing two generators afterwards.

## What the shell owns, and this package does not

Countdown, HUD, score display, pause, result, rematch, seat rotation, difficulty selection, turn
indicator and tournament reporting. `getScore()` reports points — nought to 364, summing to at
most 364 at the end — and `getActiveSeat()` reports whose turn it is, which is how the shell
knows the game is turn-based at all. The only clock this package draws is the 20 s turn clock,
which is a rule of the game rather than a piece of match furniture.

## What we did not build from the catalogue row

- **The reveal count as a difficulty.** Argued above: difficulty in this product is the bot's
  difficulty, per seat, and a deal parameter is neither of those things. The reveal count is a
  rules constant, swept and fixed at one.
- **A solo mode with a highscore.** The manifest keeps `solo` so it and the row agree about what
  was observed, and adds `friend` and `bot`, which are ours: `PlaySurface` draws a start button
  only for those two, so a solo-only manifest would ship a game page with no way to begin. There
  is no personal best and no streak — a best score is a single-player idea, the shell owns result
  and tournament reporting, and a number that only ever went up would have had to live in this
  package as a bespoke scoreboard.
- **The redeal.** Classic Klondike lets you go round the stock again. One pass, and the stock is
  a monotone quantity that a third of the termination argument rests on.
- **Partial run moves.** Klondike lets you take any tail of a face-up run. Here a column moves as
  one whole run and only when doing so turns a card over, which is what makes the move set a
  directed acyclic graph rather than a place two players can circle in for ever.
- **Klondike's other scores** — time bonuses, move penalties, a bonus for finishing. They are
  solitaire's way of scoring a player against themselves, and this is a game with an opponent in
  it.

## Size

**5,902 gzipped bytes** against the 12,288-byte game budget, measured by bundling `dist/index.js`
with the workspace packages external. For comparison, Sudoku is 6,053 and Cup Pong 4,014.
