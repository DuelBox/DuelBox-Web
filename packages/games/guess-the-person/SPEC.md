# Guess Who — specification

**Archetype:** `turn-board` · **Category:** Deduction · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 60 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against this package's own `dist/rules.js`, at the sample
> size stated.

Thirty characters laid out in three rows of ten, each built from an outline, a core and one
or two feet. Ten question chips along the foot of the board, one per attribute value. Each
seat is hunting one of the thirty — not the same one — and on your turn you either tap a
question, which is answered yes or no and strikes out everything that disagrees, or tap a
character to name it. Name yours before the other seat names theirs. Best of three deals.

## Observed rules

From the catalogue row: _"Ask yes/no questions to narrow down which character the other
player chose and guess it before they do."_

Everything below that row is **[ours]**, and the biggest of those decisions is the first
one, because the row contains a phrase that cannot be built on a shared screen: *the other
player chose*.

---

## Hidden information on one screen, and why there turns out to be none **[ours]**

The reference genre has each player pick a character in secret. Two people on one device
cannot do that. Whatever the interface — a tap, a scroll, a hand cupped over a corner — the
person sitting opposite is looking at the same glass, and #134's pass-and-play blackout does
not exist in this shell.

Three ways out were considered.

| | what it costs |
|---|---|
| draw each secret **seeded**, so neither player enters one | nobody knows their *own* character either, so somebody has to answer the questions |
| show a secret **only in the rotated half**, so it faces one seat | a shared phone is 15 cm across; the other player is not blindfolded |
| **give the secret nothing to hide behind** — build a structure where it is never drawn | needs the rest of the game to leak nothing either |

**The third one, and the first one is what makes it work.** Both targets are drawn from the
match generator at the start of every deal and live in two integers that are never rendered,
never entered, and never handed to a bot. The simulation answers every question from them,
truthfully, so **the thing a physical set needs a person for — answering honestly — is the
one job a computer does not have to be trusted with**. Nobody looks away, nobody passes the
device, and nobody can misremember their own card halfway through.

That solves half of it. The other half is the part that is easy to get wrong: it is no use
hiding the targets if the boards leak them.

**They cannot, and it is worth being exact about why.** Seat one's board is the set of
characters still consistent with the answers seat one has been given — that is, everything
seat one knows about **the character seat one is hunting**. Seat two's board is everything
seat two knows about the character *seat two* is hunting. The two boards are about two
different characters. Seat two reading seat one's board learns only about a character seat
two is not looking for; seat one reading seat two's learns only about a character seat one is
not looking for. **The information is orthogonal by construction, in both directions.**

So the game has no hidden information on the screen at all. Every board, every question,
every answer is public and all of it fits on one grid — which is why each tile carries **two
pips**, seat one's verdict in the left corner and seat two's in the right, rather than the
game needing two boards or a curtain between them. What a player watches on the other seat's
pips is tempo: how close the other one is getting, which is exactly the tension a physical
set gives you when you can see their tiles going down.

### What the row asked for and did not get

**The player does not choose their own character.** The deal does. There is no other honest
option on a shared screen, and the game loses nothing by it: in the reference genre your own
card is a thing you look at once and then never think about again, because every question in
the game is about the other one.

---

## The cast: thirty characters, three attributes, ten questions **[ours]**

Original by construction: the cast is generated from orthogonal attributes rather than drawn,
so there is no art here to have copied from anywhere. Every character is three digits in
mixed radix, and the whole set is every combination exactly once.

| attribute | values | drawn as |
|---|---|---|
| outline | **5** | circle, square, diamond, triangle up, triangle down |
| core | **3** | a filled disc, a bar across, a bar upright |
| feet | **2** | one stroke below, two strokes below |

5 × 3 × 2 = **30 characters**, and 5 + 3 + 2 = **10 questions** — "is your character's
outline a diamond?", one chip per value.

Two properties fall out of that and both are load-bearing.

**Every character is distinct**, because the cast is the full product. Two characters
answering every question the same way could never be told apart and a deal holding both would
be unwinnable. A test asserts it.

**The board is a rectangle with no holes in it**: thirty is three rows of ten and ten
questions is a fourth row of ten. That is why the whole game is one `GridCursor` over a 10 × 4
lattice, why a keyboard player never walks through a dead cell, and why one press on one slot
is the entire control scheme. A cast of twenty-four, as a physical set carries, does not
divide into any row length that its question count also fills.

### The arities are unequal on purpose, and that is the finding

The first version used **three attributes of three values** — twenty-seven characters, nine
questions, also a perfect rectangle. It is a hypercube, and on a hypercube **every legal
question is exactly as good as every other one**: from the whole cast each splits it 9 against
18, and from any set reached by answering one, each remaining question splits it 3 against 6.

So question choice was not a skill, it was a formality, and the bot's question knob measured
dead flat:

| bot's question quality | 3×3×3 cast, one deal | shipped 5/3/2 cast, best of three |
|---|---|---|
| always the best split | 51.6% | 50.7% |
| half the time at random | 50.9% | 44.5% |
| always at random | **50.0%** | **42.3%** |
| **range** | **1.6 points** | **8.4 points** |

Each column is against its own contemporaneous reference — the hypercube was measured before
the match was three deals — so only the *range* down a column is comparable, and the range is
the whole point. On the hypercube the knob is worth **nothing**: 1.6 points is inside the
sampling noise of that run, and going from perfect question choice to random question choice
cost nothing measurable. On 5/3/2 it is worth 8.4 points.

The unequal arities are what make the first question a decision — the feet question halves the
cast, the core question takes 10 against 20, the outline question 6 against 24 — and they are
what a person recognises from the reference genre as *"nearly all of them have hats, so that is
a poor question to ask"*.

---

## Termination is a potential function, and there is no clock anywhere

`liveCount` — the number of characters a seat has not struck out — is the potential.

| a seat's turn | what happens to its live count |
|---|---|
| ask a question | **strictly falls**: a question is legal only if it splits the live set |
| name the wrong character | **falls by one**: it is struck out |
| name the right character | unchanged, and that seat's search is over |

The legality rule is the whole of it. A question every live candidate answers the same way
teaches nothing and costs a turn, and two seats could ask it at each other for ever; it is
**refused**, not counted, which also means the interface cannot be used to throw a turn away by
fumbling. The same goes for naming a character already struck out.

Two consequences, both asserted:

- The target is never struck out, because every answer is truthful. So a seat at
  `liveCount === 1` is **holding the target**, every question is illegal, and its only legal
  move is to name — and it cannot be wrong. There is no stuck position.
- Thirty down to one is at most twenty-nine actions plus the naming turn, so **no seat can
  take more than thirty turns and no deal can run past thirty rounds**, whatever anybody does.
  A match is three deals, so 180 turns is the arithmetic ceiling.

A test plays a whole best-of-three between two `easy` bots **with no frame cap at all** — a
match that could not end would hang the suite rather than pass quietly — and asserts the
result. `apps/web/src/data/termination.test.ts` allows ten simulated minutes; two `easy` bots
take **49.8 simulated seconds**, and the worst of 120 seeded matches at rules level is well
inside the ceiling. `roundSeconds` ends nothing here and is not asked to.

---

## The opening seat is worth nothing, and that is structural **[ours]**

Guessing first is a real advantage in this genre. Under perfect play a race to narrow the same
board is won by whoever starts, and the measurement says so: if a deal stopped the instant
somebody named correctly, the opener would take **61.5 / 60.9 / 58.0%** of decided deals across
the three tiers, because 16–23% of deals are races both seats would have finished in the same
round and the opener takes every one of them.

So **a deal ends only on a completed round**. Naming correctly does not stop the deal where it
stands: the other seat still gets the turn it is owed, and may name correctly too. Neither seat
can ever take a turn the other does not.

| | opener's share of decided deals | draws per deal |
|---|---|---|
| ends the instant somebody names right | 61.5 / 60.9 / 58.0% | 0% |
| **completed round (shipped)** | **49.7 / 49.8 / 49.5%** | 1.8 / 2.2 / 10.3% |

8 000 deals a tier, easy / normal / hard. The opener is inside half a point of a coin toss at
every tier, and at 4 000-seed matches it reads **50.1 / 50.9 / 49.5%**.

The game still reads `GameContext.openingSeat` and still alternates the opener between its own
deals, exactly as Cup Pong keeps its alternation after proving it inert. It costs one line, it
is what keeps the property true the moment anything shared is added to the board, and it is
what gives the first move of a match and the first move of the second deal to different people
— which somebody at the table notices even when the arithmetic is indifferent.

### And seat one's share is exactly a half, not approximately one

Every draw in `resetMatch` is keyed to a **role**, never to a seat: the arrangement of the cast
comes first and belongs to the table, then one target for whoever opens and one for whoever
answers; the two bots draw from a generator each, again by role. Swap `openingSeat` and the
identical seed produces **the identical match with the two seats exchanged**.

That is asserted board by board — every seed, four tier pairings, every field of the final
position mirrored — rather than measured. It is the mirror test this game can have: there is no
spatial mirror to take, since the board is a discrete lattice and the contest is a race, so the
symmetry that matters is exchange.

Because of it, playing each seed once from each opening seat gives seat one **exactly 50.00%**
of everything decided, at every tier, at every sample size. That is asserted too — as
`seatOne * 2 === decided`, not as a band.

---

## Scoring: best of three deals, and why not one **[ours]**

A deal is about five rounds long, and how many questions a seat needs is dominated by which
character it was dealt: a good player and a poor one are separated by roughly one question,
against a deal-to-deal spread of three or four. One deal is therefore mostly luck, and the
ladder measured that way.

| | hard v normal | hard v easy | draws, hard v hard | draws, easy v easy | turns |
|---|---|---|---|---|---|
| best of one | 56.9% | 67.6% | 10.1% | 1.8% | 11.5 |
| **best of three (shipped)** | **61.2%** | **76.7%** | **4.0%** | **0.0%** | **29.3** |
| best of five | 65.0% | 82.3% | 1.7% | 0.0% | 47.8 |
| best of seven | 68.0% | 86.0% | 0.6% | 0.1% | 67.9 |

1 500 seeds a row, both opening seats, both seat orders. Best of five is a better ladder and a
worse mini-game: 47.8 turns is about 84 seconds of bot play and fifty turns of human decisions,
which is a different kind of thing from what this collection is. Three deals is 29.3 turns,
**49.8 simulated seconds**, and it is where the draw rate stops mattering.

`getScore` reports **deals won**, 0 to 2. Characters struck off is the number moving on every
single turn, but it resets with each deal and saturates at twenty-nine, so it is a progress bar
rather than a score — and the pips on the grid already say it exactly, tile by tile.

### What settles a round both seats finished in

Because neither seat can take a turn the other does not, two seats who both name correctly
always do so in the **same round**. Rounds cannot separate them, so something else must.

The shipped answer is **effort**: the number of candidates a seat still had in front of it at
the start of each of its turns, added up. It falls when a question is chosen well and when a
gamble comes off, and it rises when a name misses. Two seats who finish together are separated
by which of them narrowed faster.

| what settles a level round | draws per deal, easy / normal / hard |
|---|---|
| nothing — a level round is a draw | 23.1% / 22.0% / 16.4% |
| **certainty**: fewer candidates left when you named | 23.1% / 10.9% / 10.3% |
| **effort (shipped)** | **1.8% / 2.2% / 10.3%** |

8 000 deals a tier. Certainty was the first attempt and it is the row worth reading: it settles
**nothing at all** on `easy`, because an `easy` bot never gambles, so both seats always name
from exactly one candidate and every level round stays a draw. Effort is the same idea measured
over the whole deal rather than at its last instant, and it separates 92% of level rounds at
`easy` and 90% at `normal`.

It still ties 10.3% of level rounds on `hard`, and honestly: that is two deterministic bots
playing the identical line on a symmetric problem, and no tie-break that is a function of the
position can separate them. Best of three takes it to **4.0% of matches**, which is where it is
left.

Both criteria are functions of a seat's **own private history** and of nothing on the board, so
they settle a mirrored position rather than mirroring with it — the failure Maze Paint and
Sudoku each hit with a tie-break written in board coordinates. A level match, on deals and on
total effort, is a draw.

Both are packed into one integer for the SDK's `resolve`: deals won as the high digits, effort
underneath. One comparison, and a level match resolves to `'draw'` in the SDK rather than in
this package.

---

## Controls, and why one press on one of forty slots

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W A S D`, then `Space` | arrows, then `Enter` |
| Pointer | tap a question, or tap a character | tap a question, or tap a character |

**One lattice, ten columns by four rows.** The top three rows are the thirty characters and the
fourth is the ten questions. A tap and a key press mean exactly the same thing — *the slot I am
on* — and what that does depends only on which slot it is: a question in the bottom row, a name
anywhere above it. There are no modes, no picker to be stuck in, and no second press to cancel.

**Every action in this game is one press on one of forty slots.** There is no drag, no charge
and no continuous quantity anywhere, so a thumb cannot place a press more finely than a key
can, and the game is **not** `sameInputClassOnly`. That is Cup Pong's argument reached from the
other direction: this game never needed a continuous quantity, so none was invented.

An illegal press does nothing at all rather than costing the turn — a question that no longer
divides your board, a character you have already struck out. Both are drawn as refused before
you press them: a spent question chip is greyed **and struck through**, a struck-out character
is drawn in outline on a dimmed plate.

### The reveal is longer than the seat flip, and that is not decoration

The answer stands for 1.0 s, and the board starts its half-turn to the next seat on the same
step. `SeatFlip`'s half-turn is 0.36 s, so by the time the reveal expires the board has settled
in shared-screen play and has never moved at all in single-seat play — **both presentations
accept the next press on exactly the same step**. Shorten the reveal below the flip and the two
start dropping different presses, which is the defect `presentation-parity.test.ts` names three
games for. A test drives the same seed through both presentations from both local seats and
requires the traces to be equal step for step, live sets included.

The only line in `update` that differs by presentation is the human input gate, and it sits
below everything else: timers, deal transitions and the bot all run before it.

---

## The bot

Two knobs. A third was written, swept and deleted.

| Tier | `blunder` — chance of asking a legal question at random | `gambleAt` — names once this many candidates or fewer remain |
|---|---|---|
| easy | 1.00 | 1 |
| normal | 0.45 | 3 |
| hard | 0.00 | 6 |

`hard` asks the question whose worse branch is smallest — ordinary minimax over ten questions
and at most thirty candidates, no search and no tree. `bot-cost.test.ts` has nothing to say
about this game; a hundred thousand `hard` decisions run inside two seconds.

### Rule 6: it is handed one board and nothing else

`chooseAction(out, board, rng, difficulty)`. `board` is that seat's own live set — exactly the
pips a person reads off the grid. Neither target is a parameter, and after `chase` was deleted
neither is the other seat's board. A test takes a fresh position, records the move, then
**scrambles both hidden targets thirty times over** and asserts the identical move on every
tier — the shape Sudoku uses, and it is here to fail the day somebody adds a parameter that
could carry the answer.

Behaviourally: `hard` misses **66.5%** of the characters it names — see the solo table below —
and a test asserts the hit rate over 200 matches sits well away from both ends. A bot reading
the target would name once and be right every time.

### Every knob, swept alone

Against a fixed reference of `{blunder 0, gambleAt 3}`, best of three, 8 000 matches a row,
both opening seats and both seat orders.

| `gambleAt` | win rate | mean turns |
|---|---|---|
| 1 | 41.4% | 28.8 |
| 2 | 46.6% | 28.6 |
| **3 (reference)** | 50.7% | 28.3 |
| 4 | 52.4% | 27.4 |
| 5 | 55.1% | 26.1 |
| **6 (shipped `hard`)** | **55.1%** | **26.1** |
| 8 | 55.1% | 26.1 |
| 10 | 41.6% | 25.7 |
| 15 | 18.4% | 25.5 |
| 30 | 7.0% | 25.2 |

**Its optimum is in the middle, not at an end**, which is the honest shape of the decision the
game is about: naming from four candidates and missing costs you a turn and a candidate, naming
from fifteen is throwing the deal away, and never naming until you are certain hands the race to
anybody prepared to take a chance. The plateau from 5 to 8 is the reachable live counts: the
sets go 30 → 15 → 5 → 1 far more often than they pass through 6, 7 or 8. The tiers sit at 1
(timid), 3 and 6 (the optimum).

| `blunder` | win rate | mean turns |
|---|---|---|
| **0 (shipped `hard`)** | **50.7%** | 28.3 |
| 0.15 | 46.5% | 27.9 |
| 0.30 | 44.5% | 27.6 |
| **0.45 (shipped `normal`)** | **44.5%** | 27.3 |
| 0.60 | 44.6% | 26.9 |
| 0.80 | 44.2% | 26.7 |
| **1.00 (shipped `easy`)** | **42.3%** | 26.6 |

Monotone across its whole range, and most of its travel is in the first third — the difference
between a player who always asks the best question and one who asks the best question half the
time is most of the difference between one who always does and one who never does.

### The knob that was deleted

`chase` bumped `gambleAt` by a fixed amount while the rival's board was no wider than this
seat's own: a player who can see they are behind and presses. It is a legal thing for a bot to
read — both boards are drawn pip by pip for everybody — and swept alone it looked like a third
axis, rising monotonically from 49.4% to 62.5%.

It is not an axis. What matters is only the threshold it implies:

| | win rate against `normal` |
|---|---|
| name at 5 when behind, 3 when ahead | 62.6% |
| name at 5 when behind, 2 when ahead | 62.5% |
| **name at 5 always** | **63.1%** |

**Conditioning the gamble on the other seat is worth nothing over the flat threshold it
implies.** It read in the source as reading your opponent and was in practice a second spelling
of `gambleAt`, exactly as Cup Pong's `wander` was a second spelling of press error. It went —
and with it the bot's last reason to look at the other seat at all, which is why the rule 6
story above is as short as it is.

Worth being clear about what that does and does not say. It says the *bot* gains nothing from
the other seat's board on this cast at this length. It does not say a person gains nothing:
watching the other seat's pips go down is what tells you whether you can afford another
question, and that is a real thing to watch even where the arithmetic is flat.

### Solo, per tier

4 000 deals a tier, one seat playing alone with nobody racing it.

| Tier | turns to name its character | effort | names that missed | rounds needed |
|---|---|---|---|---|
| easy | 6.48 | 71.5 | 0.0% | 4:6% 5:20% 6:20% 7:27% 8:27% |
| normal | 5.95 | 66.4 | 41.1% | 3:3% 4:9% 5:24% 6:31% 7:20% 8:13% |
| hard | 5.65 | 62.6 | 66.5% | 3:7% 4:20% 5:21% 6:20% 7:19% 8:13% |

The two distributions overlap heavily, and that is the honest ceiling on how far apart the tiers
can be pulled: thirty candidates is 4.9 bits, an optimal question is worth 1.0 of them and a
random legal one 0.84, so perfect play and random play are about **one question** apart against
a deal-to-deal spread of four. Best of three is what turns that one question into a 76% win
rate; nothing about the bot can turn it into a 95% one. A larger cast could, and would not fit
on a phone.

### Balance, 4 000 seeds a pairing, both opening seats

Equal tiers:

| | seat one's share of decided | opener's share | draws | deals played | turns | distinct matches of 8 000 |
|---|---|---|---|---|---|---|
| easy v easy | **50.00%** | 50.1% | 0.0% | 2.52 | 29.1 | 83 |
| normal v normal | **50.00%** | 50.9% | 0.1% | 2.52 | 26.5 | 89 |
| hard v hard | **50.00%** | 49.5% | 4.1% | 2.59 | 25.0 | 117 |

Seat one's share is 50.00% **by construction**, not by sampling: each seed is played once from
each opening seat and the two runs are exact mirrors, so it is exact at any sample size. The
opener's share is a genuine measurement and is inside a point of half at every tier.

Cross tier, both seat orders, 16 000 matches a row:

| | stronger tier's share of decided |
|---|---|
| hard opens v easy | 76.3% |
| easy opens v hard | 75.8% |
| hard opens v normal | 61.2% |
| normal opens v hard | 61.6% |
| normal opens v easy | 66.9% |
| easy opens v normal | 68.0% |

Every pairing agrees with itself within 1.1 points across the two seat orders, and the ladder is
strictly ordered: `hard` beats `easy` by more than it beats `normal`, and by more than `normal`
beats `easy`. The cross-game harness reports this game at **50.0% for seat one, 0.0% draws, 49.8
simulated seconds, 30 distinct matches of 100, and the opening seat changing the result on 50 of
50 seed pairs** — the last of which is the check that `openingSeat` is read at all.

---

## Rule 7: never colour alone, and no text anywhere

A test asserts the renderer's `text` method is **never called** through a whole match. Nothing
on this board needs reading, in any language.

- **Seat one is round and seat two is square, everywhere in this game.** Every mark either seat
  owns is a disc or a ring for seat one, a square or a frame for seat two, and a test walks
  every drawn mark of two hundred sampled frames and asserts it.
- **A candidate still standing is solid; one struck off is a wire outline.** Two axes, four
  marks, and colour agrees with the shape rather than carrying it. The two pips are drawn at
  equal *area* — the square's side is the disc's radius times √π — so neither seat's pip reads
  as the heavier one.
- **No attribute of a character is a colour.** Five outlines, three cores and one-or-two feet;
  the whole cast is drawn in one ink. A player in greyscale reads every character exactly as
  anybody else does, and the feet are a fixed multiplicity rather than a length, so they survive
  scaling too.
- A **question already spent** is greyed *and struck through*; the character on a struck-out
  tile is drawn in outline on a dimmed plate.
- An answer is a **ring for yes and a cross for no**, drawn large above the board next to the
  question that was asked or the character that was named — two outcomes told apart by shape,
  with colour confirming what the shape already said.
- The board frame takes the colour of whoever is to move. It covers 69% of the play area, so it
  is field rather than a player-owned element, and a test asserts that too: a game must not be
  able to pass rule 7 by recolouring its background.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation and imports nothing from `game.ts`; it does not contain a
coordinate. `game.ts` owns the lattice geometry, the seat flip, the palette and the drawing, and
reads the simulation without adding to it — a test renders forty frames at forty different
alphas and asserts the position is byte-identical afterwards, and another asserts every drawn
number stays inside the declared 900 × 900 box.

The one thing `rules.ts` does know about the board is `COLUMNS`, because the cast's shape and
the lattice's shape are the same fact and splitting them across two files is how they drift
apart. A test asserts `ARITY`'s product is the cast, its sum is the question row, and the two
fill the lattice exactly.

## Allocation

`update` allocates nothing. Both boards are 30-bit sets in two integers, every question is a
mask lookup, the bot's decision is a handful of local words, and the one `Action` object is
allocated in the field initialiser and written in place. The only allocation in the whole
package after `init` is the `Rng` pair, and that happens once per match.

## Size

**4,458 gzipped bytes** against the 12,288-byte game budget, measured by bundling `dist/index.js`
with the workspace packages external. 679 lines of rules to 564 of game.
