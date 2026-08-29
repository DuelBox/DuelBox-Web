# Pizza Memory — specification

**Archetype:** `rt-split` · **Category:** Memory · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 75 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against `dist/` with `/tmp/pm-*.mjs` — the harness, the
> sweep, the mirror check and the solo run. Nothing here is a hope.

Two counters, one above the other, each the exact half-turn image of the other. An order is
dealt onto your pizza a topping at a time, held for a moment, and taken away. You rebuild it
from the ingredient rail in front of you and ring the bell to send it out. Right, and the
order is served. Wrong — or unfinished when you ring — and it is spoiled. Most orders served
when the whistle goes, or first to eight, takes the match.

## Observed rules

The catalogue row: _"Watch the order and recompose the pizza exactly as you saw it. When
you're done, remember to ring the bell!"_

Everything in that sentence is built. Three things it does not say, and that we decided:
**both cooks work at the same time on the same orders** (it could have been turn-based),
**the orders get longer as you go**, and **ringing early is a real move rather than an
error the game refuses** — see "The bell is a decision" below.

## The two counters never touch **[ours]**

There is no shared object in `rules.ts`. No contested ingredient, no shared board, no race
for the same bell. Everything a seat owns lives in its own `Counter`, and `step` is two
independent counters plus a clock.

That is a design decision and not an accident of the genre, and it is what pays for the seat
balance below. The catalogue's seat-band failures come from shared state whose rules are not
covariant under the half-turn — a tie-break in board coordinates, a rim a piece lands on
exactly. A game with nothing shared cannot have any of them.

What is shared is the **ticket book**, and it is shared in the one way that cannot couple the
seats: it is *addressed*, not *consumed*.

```ts
ticketTopping(book, ticket, slot) // splitmix32's finaliser over the three
```

Both seats read ticket 5 and get the same pizza, whether one of them got there in twenty
seconds and the other in fifty. A shared `Rng` would have dealt each seat whatever was next
when it happened to ask, so a fast opponent would change what *you* were asked for — and the
seat band would have found it. A test plays seat one against all three tiers and asserts the
book it read was bit-identical each time.

## Placing is a release, never a tap **[ours]**

The hand walks the rail at `HAND_SPEED = 5` stations a second and **commits on the release** —
a key let go, a finger lifted. Both instruments express exactly one binary event with a
timestamp, and neither can express it more finely than the other.

The rate limit is the whole of the fairness argument, and it is the same one Happy Hippos
makes about its bank: a thumb that lands on the bell and a key held toward it move the hand
at the identical speed, so a pointer cannot reach an ingredient a keyboard cannot. A test
drives the two instruments side by side for a full crossing and asserts they agree to nine
decimal places, and another builds the same order twice, once with keys and once with a
finger, and requires the same pizza out of both.

A full crossing of the rail costs a whole second, which is deliberate: it is what makes
*where you leave the hand during the reveal* a real decision, and it falls on both input
families and both seats alike. This game is **not** same-input-class-only, and does not
declare itself so: there is no continuous quantity anywhere in it.

The rail is six stations — five ingredients and the bell — so one axis and one button drive
the whole game, which is also what makes it playable on half a keyboard.

## The bell is a decision **[ours]**

A full pizza takes no more toppings, and the only way to close a ticket is the bell. So
ringing it is an act, exactly as the catalogue row says. Ringing early sends out whatever is
on the pizza and spoils it — which matters at the end of a match, where a cook who is not
sure of the pizza in front of them is better off leaving it on the bench than ringing it, and
the third tie-break rewards them for having got as far as they did.

There is **no undo**. It was considered and left out: a rail with a "take the last one back"
station is a second binary channel that only helps the player who noticed their mistake, and
noticing your own mistake is not a thing this game can ask a bot to model honestly.

## The counter

| | Value | Why |
|---|---|---|
| Board | 600 × 1000 | Two counters, one each way up |
| Pizza | centre (300, 690), radius 140 | Seat two's is the half-turn image |
| Slots | on a ring at radius 82, from a drawn seam | A ring has no beginning, so the seam is drawn |
| Rail | 6 stations, x = 60 to 540, pitch 96 | Exact in binary; the pointer lattice is 3 units |
| Hand | 5 stations a second | 1.0 s end to end, for a thumb and a key alike |
| Reveal | 0.42 s a topping, then 0.55 s holding the lot | A 3-order shows for 1.81 s, a 6-order for 3.07 |
| Verdict | 0.7 s | |
| Order length | 3, growing by one every 2 tickets, capped at 6 | |
| Match | first to 8 served, or 75 s | |

### The ramp is what stops the contest saturating

A three-topping order is one a good memory gets right three times in four, and a match made
only of those is decided by tempo and luck rather than by memory — the Sudoku failure the
brief names. Each counter's pizza therefore grows on **its own** ticket count:

| ticket success | L3 | L4 | L5 | L6 |
|---|---|---|---|---|
| easy | 39.6% | 28.2% | 19.5% | 14.2% |
| normal | 57.3% | 43.8% | 40.5% | 31.0% |
| hard | **75.8%** | 64.6% | 61.1% | **53.5%** |

400 solo matches a tier, every ticket counted. **`hard` gets barely half of a six-topping
order right**, which is the number this design is built around: at no length and no tier does
the score run out of room, and the tiers separate at every length.

Ramping on each counter's *own* count also makes the race self-tightening — the cook who is
ahead is the one being asked the harder questions. That is deliberate, and it is why the
cross-tier table below is steep but not total.

### Scoring, and the two tie-breaks

Winner is **most orders served**; level, **fewest spoiled**; level on both, **further through
the pizza on the bench**. Orders served is a number between nought and eight, so two cooks of
the same standard land on the same one of them often, and the tie-breaks are the score's
resolution rather than decoration:

| | level on served | after spoiled | after the bench |
|---|---|---|---|
| easy v easy | 20.1% | 13.3% | **6.3%** |
| normal v normal | 17.4% | 12.6% | **3.9%** |
| hard v hard | 9.3% | 7.9% | **3.9%** |

1500 seeds a tier. Both keys are quantities a seat owns outright, so unlike a rule written in
board coordinates they still separate a *mirrored* position — the mirror image of "seat one
spoiled fewer" is "seat two spoiled fewer", which is an answer (lesson 11).

## Termination

Two guarantees, and the weaker one is the interesting one.

**Structural:** every bot rings the bell. `botDecide` returns the bell station the moment the
pizza is full, whatever nonsense it put on it, so no seat can sit on a ticket. A test plays
sixty `easy`-versus-`easy` matches from both openings and asserts every one finishes.

**The backstop:** `MATCH_SECONDS = 75` in `rules.ts`, resolved through `resolve`'s
`timeExpired`. `manifest.roundSeconds` ends nothing anywhere in this repository and is not
consulted. A test plays a match in which *nobody ever rings at all* — no bots, no input — and
asserts it ends in a draw at 75 s.

Measured: 65.4 s at `hard` (most matches reach the target), 74.4 s at `normal` and 75.0 s at
`easy` (almost all go to the clock). No configuration has ever come near the ten simulated
minutes `termination.test.ts` allows.

## What the bot can and cannot see

This is the part of the game that was easiest to get wrong, so it is the part with the most
tests behind it.

**It can see the order only while the order is on the pizza.** `botWatch` is the only function
that reads `Counter.order`, and it is only called during `PHASE_WATCH` — the reveal, when a
person is looking at the same thing. It encodes each topping once, as it appears.

**After that it has `BotState.recall` and nothing else.** Five bytes. `botDecide` reads
`recall` and the count of what it has already placed, and never touches `order`.

**A slot it never fixed is guessed once, and the guess is written back**, so asking twice
gives the same answer. A bot that re-rolled an unknown slot would converge on the truth by
repetition, which is the subtle version of cheating.

**It cannot see the other counter.** `botStep` is handed one `Counter`, and a test scrambles
the other seat's counter between two identical questions and requires the same answer.

**It cannot see the book, the seed, or the next ticket.**

### The scramble test

Sudoku's habit, in this game's terms. After the reveal has ended the ticket is hidden from a
person, so it must be hidden from the bot: the true order is **replaced with a completely
different one** between two identical questions, and the answer may not move. Then the
stronger version — the whole build phase is played out twice, once against an honest ticket
and once against a scrambled one, and the *sequence of stations committed* must be identical.
120 seeds and 60 seeds a tier respectively, all three tiers.

### The four knobs, and what each is

| | what it is | easy | normal | hard |
|---|---|---|---|---|
| `graspChance` | chance of fixing a topping in mind at all | 0.84 | 0.90 | 0.94 |
| `slipChance` | chance a fixed topping is fixed as the wrong one | 0.11 | 0.07 | 0.035 |
| `swapChance` | chance it is remembered in the wrong place | 0.10 | 0.06 | 0.03 |
| `reactSeconds` | hesitation at a station before committing | 0.24 | 0.17 | 0.12 |

The first three are the brief's "how much it remembers and how accurately", modelled
explicitly and separately. They are not three spellings of one thing:

- a topping it **never grasped** is blank, and a blank is guessed at one in five — so it comes
  good 20% of the time;
- a topping it **slipped** is a confident wrong answer, which never comes good. Strictly worse
  for the bot than not remembering at all, which is the right way round: over-confidence is a
  worse failure than a gap.
- a **swap** keeps both toppings and loses the order, which is the mistake this game is
  actually about — "recompose it exactly as you saw it" is a question about sequence.

Even at `hard`, recall is 94% × 96.5% per topping with a 3% chance of a transposition. **No
tier has perfect recall**, and a test asserts the top tier's per-slot fidelity stays under
98% on a six-topping order.

### Every knob, swept alone

`hard`'s knob moved, everything else as shipped, against an untouched `normal`. 400 seeds ×
both seat orders = 800 matches a row.

| `graspChance` | win | served |
|---|---|---|
| 0.55 | 3.8% | 1.21 |
| 0.70 | 16.6% | 2.56 |
| 0.82 | 46.7% | 4.37 |
| 0.88 | 64.7% | 5.46 |
| **0.94 (shipped)** | **86.2%** | **6.85** |
| 0.97 | 94.4% | 7.40 |
| 1.00 | 98.8% | 7.81 |

| `slipChance` | win | served |
|---|---|---|
| 0 | 95.8% | 7.58 |
| 0.02 | 90.8% | 7.18 |
| **0.035 (shipped)** | **86.2%** | **6.85** |
| 0.08 | 67.3% | 5.63 |
| 0.16 | 34.4% | 3.78 |
| 0.30 | 5.9% | 1.70 |
| 0.50 | 0.8% | 0.43 |

| `swapChance` | win | served |
|---|---|---|
| 0 | 91.8% | 7.29 |
| **0.03 (shipped)** | **86.2%** | **6.85** |
| 0.08 | 74.0% | 6.00 |
| 0.16 | 51.7% | 4.66 |
| 0.30 | 18.5% | 2.86 |
| 0.50 | 3.7% | 1.27 |

| `reactSeconds` | win | served |
|---|---|---|
| 0.02 | 88.0% | 7.19 |
| 0.06 | 86.9% | 7.10 |
| **0.12 (shipped)** | **86.2%** | **6.85** |
| 0.20 | 83.0% | 6.52 |
| 0.35 | 83.1% | 6.06 |
| 0.60 | 74.3% | 5.29 |
| 1.00 | 62.4% | 4.50 |

All four are monotone across their whole range (`reactSeconds` is flat between 0.20 and 0.35
and never runs backwards). `reactSeconds` is much the weakest — 88.0% down to 62.4% over a
fifty-fold range, against 3.8% to 98.8% for `graspChance` — and it is kept because it is
monotone over that whole range and because a tier that remembered better *and* worked at
exactly the same speed would not read as a better cook.

### A fifth knob was written, swept and deleted **[ours]**

`REACT_SPREAD` spread each hesitation triangularly about its tier's mean. It was written for a
real symptom: at an earlier tuning, two `hard` bots working the identical ticket book in
lockstep served their last order on the **same step** in 9.4% of matches, and `resolve` is
right to call that a draw.

Swept alone it did nothing at all to strength — 84.9, 85.3, 85.4, 85.3, 85.4% at spreads of
0, 0.2, 0.5, 0.8 and 1 — which is what a spread about a fixed mean *should* do, since it costs
as often as it pays. That was expected. What killed it is that by the shipped tuning it had
stopped doing the thing it was written for either: simultaneous crossings measure **0.1% with
it and 0.0% without**, and the equal-tier draw rate moves by half a point. The bench tie-break
and the longer ticket ramp had closed the hole underneath it. A knob that is flat on the axis
it was built for is a knob, so it went.

## Balance

### Seat one takes exactly 50.00%, and it is a proof rather than a measurement

The two counters are half-turn images with nothing shared, and `game.ts` hands the two bot
streams out **by role and not by seat**: the opening seat gets stream A, the other gets stream
B. So a seed's two openings are *one match and its exact mirror*, and seat one wins precisely
one of every such pair.

Asserted rather than sampled, at three levels:

- `rules.test.ts` mirrors 300 scrambled mid-match boards — mid-ticket, part-built, mid-walk —
  and requires `step` to take the mirror to the mirror of the step, field by field, for a
  hundred steps each.
- It replays 120 seeds a tier through `botStep` for seat one and for its mirror image on seat
  two and requires the identical decision on every step, and the identical `recall` after it.
- `game.test.ts` plays 40 seeds a tier through the real `Game` from both openings and asserts
  the two counters come out swapped **and** that seat one's share of decided matches is
  exactly `0.5`.

`apps/web/src/data/balance-aggregate.test.ts` measures **50.0%** for this game, with 48 of 50
seed pairs ending differently when only the opening seat changed and 47 distinct matches out
of 100 — so the opening seat is doing real work rather than the sample being degenerate.

### Equal tiers, 1500 seeds × both openings

| | p1 | p2 | draws | seat-one share of decided | served p1/p2 | tickets | spoiled | seconds |
|---|---|---|---|---|---|---|---|---|
| easy v easy | 1369 | 1369 | 262 (8.7%) | **50.00%** | 2.53 / 2.53 | 10.65 | 8.25 | 75.0 |
| normal v normal | 1425 | 1425 | 150 (5.0%) | **50.00%** | 4.44 / 4.44 | 11.09 | 6.78 | 74.4 |
| hard v hard | 1432 | 1432 | 136 (4.5%) | **50.00%** | 6.50 / 6.50 | 10.25 | 4.17 | 65.4 |

### Cross tier, 1500 seeds × both openings

| | stronger tier's share of decided | served |
|---|---|---|
| hard v easy | 97.4% | 6.83 / 2.41 |
| hard v normal | 86.3% | 6.82 / 4.23 |
| normal v easy | 81.5% | 4.46 / 2.52 |

Every pairing is monotone, and because the openings are exact mirrors the two seat orders give
the **identical** counts rather than merely agreeing within noise: `hard` as seat one beat
`easy` 2920–79, and as seat two, 2920–79.

`hard` against `easy` at 97.4% is the steepest pairing in the ladder and it is honest: this is
a memory game, and a cook who holds 94% of what they saw against one who holds 84% and
transposes three times as often will win nearly every race. `easy` is a beginner rather than a
handicapped expert — it gets four orders in ten right at three toppings and one in seven at
six.

## Rule 7: never colour alone, twice over

Pizza toppings are the classic colour-only set and this game asks you to *recompose the order
exactly*, so a greyscale player who cannot separate pepperoni from olive cannot begin. Nuts
and Bolts solved the same problem this week and this follows it.

**Five toppings, five silhouettes.** A disc (pepperoni), a ring (olive), a block (cheese), a
wedge (pepper) and a bar (sausage), drawn at the same size on the rail, on the pizza and in
the reveal, so what you memorise is a shape. `greyscale.test.ts` throws every colour away and
asserts the five rail stations still draw five different things — and that the bell is a sixth.

**Colour says it a second time.** The five are spaced in sRGB relative luminance — 0.020,
0.091, 0.169, 0.261, 0.648 — so they stay five distinguishable greys. Asserted, with a
minimum gap of 0.04 between neighbours.

**Seat one is round and seat two is square, everywhere.** The pizza, its crust, the slot
plates, the rail plates, the bell plate, the hand and the served ring. **Seat one never
strokes a rectangle and seat two never strokes a circle**, in the whole of `game.ts` — which
gives the two seats different *primitives* rather than two sizes of one, the strongest
evidence rule 7 names. The olive's hole is a second filled disc in the dough's shade rather
than a stroked circle, precisely to keep that true.

**No text at all, anywhere, ever.** Asserted over a whole match. Nothing on this counter has
to be read in any language.

**Every verdict is a shape.** A served order is a second ring outside the crust in the seat's
own outline; a spoiled one is a cross struck through the pizza. The slot the next topping goes
in is ringed, so nobody has to count round to find their place, and the bell lights when the
pizza is full.

`packages/games/pizza-memory/src/greyscale.test.ts` reproduces
`apps/web/src/data/greyscale.test.ts`'s algorithm constant for constant against this game
alone, so the shared harness's verdict was known before it landed. Both agree: the two seats
differ, on `scirc` present for seat one and absent for seat two and `srect` the other way
round.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`. The
rail is measured in **stations**, not in board units, and the pointer is converted to a station
at the edge — so the two seats run the *identical* arithmetic rather than mirror-image
arithmetic, and the half-way point between two stations is not a threshold the two seats fall
off in opposite directions. That is the defect family lesson 8 names, closed by construction
rather than by a tolerance.

`game.ts` owns the drawing and reads the simulation without adding to it: a test renders at
four alphas and asserts nothing moved, and another checks every drawn coordinate stays inside
the declared box over 900 steps.

## Rule 9: neither cook sees more than the other

Each seat's material is confined to its own half — asserted over 200 sampled frames, every
mark in a seat palette measured top and bottom — and on an identical ticket the two counters
cost the identical number of marks.

## Presentations, and the opening seat

The simulation reads neither. `game.ts` reads `presentation` in exactly one place: the sign of
a movement key for a seat that is reading the drawn board upside down, which is control
mapping and is what the two presentations are explicitly allowed to differ on. A test plays
the same seeded script through both and requires byte-identical counters.

`getActiveSeat` is **not implemented**. This is an `rt-split` game; both cooks work from step
zero and there is no turn. The contract says a real-time game may ignore `openingSeat` too,
and this one does not ignore it — it uses it for the one thing it can honestly buy here, which
is which bot stream sits in which chair, and that is the whole of the seat-balance proof above.

## What we did not build

- **`modes: ['solo']`** is not offered. The row says `friend,bot` and that is what ships.
- **An undo station** on the rail — argued above.
- **A shared kitchen.** Two cooks racing for one oven is the obvious way to make this
  interactive, and it is exactly the shared state that produces the seat-band failures this
  repository is still working through. The interaction here is the race, and the race is
  enough.
