# Money Grabber — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 900 ·
**Zone split:** horizontal · **Round length:** 35 s advertised ·
**Cross-device: fair, not same-input-class-only**

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and every
> number below was measured by driving `dist/rules.js` headless — sweeping one constant at a
> time against a patched copy of it — rather than estimated.

One table seen from above, with a safe let into each end. Thirty-three banknotes drift about on
the felt, worth one, two or three each. Each player drives a hand; a hand grips every note under
its palm at once and carries them home to its own safe. A full hand moves at less than half the
speed of an empty one, and the middle half of the table can be reached from both ends — so the
whole game is the bet you make about how much to pick up before you turn for home, and whether
you can still win the race to the middle when you do.

## Observed rules

From the catalogue row: _"Drag the money to your safe box using all the fingers of your hand!"_

Three things in that sentence are built as written: the money, the safe box at each end, and the
palm that takes several notes at once. **The fourth — "all the fingers" as ten separate pointers
— is not, and could not be.** That is the whole of the next section, and it is the most
important decision in this package.

Everything else is ours: the finite pile, the drift, the face values, the carry penalty, the
grip dwell, the contested band, the note in the exact middle, and the clock.

## The multi-touch problem, and what was done about it **[ours]**

The brief for this game offered three honest routes. The one that got built is the second, and
the reason is not the one that was expected.

### Route 1 — build the multi-touch game and declare `sameInputClassOnly: true`

**This route is not available at the game layer.** It is not a fairness trade that was refused;
it is a capability the platform does not expose, and it took reading the engine rather than the
issue to find that out.

`InputManager` genuinely does track ten concurrent pointers, and it genuinely does keep each one
with the seat whose half of the device it went down in — `input.test.ts:385` asserts exactly
that, and it is why five fingers on one half keep that seat "active" until the last one lifts.
But that bookkeeping never reaches a game. What a game reads is `SeatInputView`
(`packages/engine/src/input-view.ts`):

```ts
readonly move: Readonly<Vec2>;
readonly pointer: Readonly<Vec2> | null;   // one pointer. Not a list.
```

`SeatSources.pointerCount` is private to `input.ts` and is collapsed into a single boolean
(`pointerActive`) before `InputView.sync` ever sees it; the seat's *position* is simply whichever
pointer moved most recently. `docs/input-idiom.md` says the same thing in its own words — "a game
reads six values per seat … and nothing else".

So a game cannot address a second finger, cannot count fingers, and cannot tell one finger from
five. Declaring `sameInputClassOnly: true` would not have bought the multi-touch game. It would
have shipped a **one-finger** game with a flag on it telling every keyboard player not to bother
— which is strictly worse than either honest route, because it advertises a restriction that
buys the player nothing.

`game.test.ts` asserts this rather than leaving it as prose: ten pointers are pushed through a
real `InputManager`, and the game is shown to receive one position per seat. If the engine ever
grows a per-finger view, that test is where somebody will find out that this game could have been
built the other way.

### Route 2 — reduce it to something both input families express, and say what was traded

Built. The reduction has two halves.

**"All the fingers" became a radius, not a count.** The palm has a grab radius of 52 units, and
*every* loose note inside it grips at the same time and lifts together. Four notes in one sweep
is an ordinary play, and `rules.test.ts` asserts it directly. That is the part of the catalogue
row that mattered — grabbing a fistful at once — and it survives intact with one pointer.

**Steering became the whole interaction.** There is no press, no drag origin, no release and no
tap anywhere in this game. Nothing in `rules.ts` or `game.ts` reads `actionPressed`, `actionHeld`,
`actionReleased`, `holdSeconds` or `holdSecondsAtRelease`. A hand chases a place at a rate; it
grips what it is over; it empties itself when it enters its own safe.

**What was traded away, precisely:** parallel grabbing at *different places on the table*. In the
reference idea, ten fingers can be pinning ten notes in ten spots. Here one palm can hold six
notes, and they must all be within 52 units of one point. The skill that replaces it is routing —
finding the line through the table that puts the most value under one palm — and the tension that
replaces it is the carry penalty. A player who wanted the ten-finger game does not get it.

### Route 3 — a hybrid

Considered and rejected. The hybrid on offer was to build the multi-touch game and *also* offer a
reduced keyboard scheme, declaring same-class-only so the two never meet. It fails on route 1's
finding (there is no multi-touch to build) and, even if there were, it fails rule 10: two schemes
is two games, and `docs/input-idiom.md`'s promoted ruling makes rapid repeated discrete input the
thing that is unfair, which N parallel grabs is by definition.

### The verdict, and why it is `false`

`sameInputClassOnly: false`. **A phone, a laptop, a trackpad and a keyboard can all play this
against each other.**

- **Nothing is ever aimed, pressed or timed.** `docs/input-idiom.md` promotes exactly this
  ruling out of three manifest comments: _"The unfair interaction is rapid repeated discrete
  input… Holding, steering towards a place, and choosing a lane by position are all fair."_ This
  game is steering towards a place and nothing else.
- **The steer is a rate on both instruments.** `driveHand` moves along the straight line to the
  target at `speedOf(carry)` and no faster. A finger slammed into the far corner and a key held
  down move the hand the same distance in the same step, asserted to nine decimal places
  (`rules.test.ts`, "moves at the same speed for a slammed finger and a held key"). Pointing past
  the seat's reach parks the hand on its limit rather than teleporting it.
- **Nothing binds to pointer velocity.** `docs/input-idiom.md` names that as the one rule outside
  the precision envelope. There is no "sweep faster for more" anywhere here.
- **The pointer is absolute, unmirrored, and inside each seat's own reach.** The table is one
  shared board drawn one way up, so a finger is already over the felt it means. Only the *keys*
  mirror for the seat reading upside down, which is control mapping and is allowed to differ
  between presentations.
- **The tap-versus-slide trap does not exist here.** The engine reports a finger going down as
  the action, and Happy Hippos measured a **four-fold** scoring difference between a player who
  slides and one who taps because of it. This game reads no action at all, so the two styles are
  bit-identical — asserted by driving one match with the action permanently held and another with
  it never held and comparing the whole simulation.
- **Rule 9.** Both players see the whole table. There is nothing to see more of.

The one residual difference is the one `docs/input-parity.md` already rules on for `rt-split`:
touch positions absolutely and a mouse aims finely, and the engine's precision envelope narrows
the second. Nothing in this game asks anyone to aim finer than a 52-unit palm.

## Rule 7 is a rule about the safes first

The two things a player must tell apart before anything else means anything are **whose safe is
whose** and **whose hand is whose**. So the shape split was designed before a line was written:

**Seat one is round. Seat two is square. Everywhere, without exception.**

| | Seat one | Seat two |
|---|---|---|
| Safe | a round vault door, two concentric rings | a square vault door, two concentric boxes |
| Hand | a disc | a square of equal area |
| Knuckles | three discs | three squares |
| Grab radius | a ring around the palm | a box around the palm |
| Money in the hand | round tokens with a ring inside | square tokens with a box inside |
| Steering marker | a ring on the felt | a box on the felt |

Both safes are entered by the **identical circular test** at `SAFE_RADIUS = 76`; only the drawing
differs, and the square is drawn at `radius × sqrt(pi) / 2` so the two cover the same area.
Neither seat has a bigger target or an easier one to find. The same `sqrt(pi)/2` runs through the
hand, the knuckles and the tokens.

The safes sit at y 824 and 76 rather than hard against the ends, and that number was chosen by a
test failing. At 840 with a radius of 92 the circle ran 32 units past the bottom of the board and
the square 21 units past the top — so the two were clipped by *different fractions*, and the
equal-area claim above stopped being true on screen. `game.test.ts` now measures the extent of
every shape the game draws, over 900 frames of a real match, and fails if anything overhangs an
edge at all.

**Money still on the table belongs to nobody**, so it is drawn in nobody's colour: a plain
banknote with its face value written on it as a numeral. Value is the one thing a player has to
read to play well, and it is a digit rather than a hue. A note being gripped grows a bar under it;
a note two palms are on gets a double clash ring in a colour neither seat owns.

`game.test.ts` asserts the rule mechanically: over 1500 frames of a real match, every draw call
made in one of seat one's four palette colours is a `circle` or a `strokeCircle` and never a
rectangle, and every call in one of seat two's is a rectangle and never a circle — and both seats
have material on screen in the very first frame, which is what the repository's `greyscale.test.ts`
needs before it can judge a game at all.

## The table

| | Value | Why |
|---|---|---|
| Board | 600 × 900 | Portrait: a safe at each end and the felt between them. Also a whole number of precision-lattice cells on both axes — see below |
| Felt | x 30–570, y 150–750 | 540 × 600 |
| Note | radius 18, centre within x 48–552, y 168–732 | |
| Pile | **33: sixteen half-turn pairs and one note in the exact middle** | Fixed for the whole match |
| Face values | 1, 2, 3 by slot; **65 in total, odd** | See "the note in the middle" |
| Drift | 20–50 units/s, constant per note | Slow enough to read a value off a moving note |
| Safe | radius 76, centred (300, 824) and (300, 76) | Identical circular test for both seats; both fit whole on the board |
| Palm | radius 34, grips at 52 = palm + note | |
| Hand speed | **300 empty, −30 a note, 120 full** | The whole trade |
| Carry cap | 6 | A full palm grips nothing |
| Grip | **0.45 s of dwell**, lost at 3× when the palm leaves | |
| Reach past the middle | 96 | Gives a contested band 296 units deep |
| Match | the pile runs out; a 90 s clock behind it **[ours]** | |

**600 × 900 rather than 600 × 1000, and that is not cosmetic.** The engine quantises every pointer
onto a lattice of `min(w, h) / 200` before a game sees it, and
`presentation-parity.test.ts`'s `latticeSurvivesTurn` observes that a half-turn maps that lattice
onto itself only when the box is a whole number of cells across. 600 × 900 is (200 × 300 cells);
600 × 1000, which two `rt-split` games in this catalogue use, is not. It costs nothing to pick the
box that survives the rotation.

### The contested band, and why the reach is 96 rather than 0

Each hand can reach 96 units past the centre line, and its palm reaches 52 further. So of the
564-unit strip a note can sit in:

- **y 598–732** — seat one's alone, 134 units, 24%
- **y 302–598** — **both hands', 296 units, 52%**
- **y 168–302** — seat two's alone, 134 units, 24%

Half the table is common ground. That is the number the whole design turns on: with a smaller
reach the table would be two private halves and the two players would never actually meet, and
with a larger one each seat's own corner would stop being a refuge. The band is drawn as its own
shade of felt with a line at each edge, so a player can see where the fight is rather than
discovering it by being beaten to a note.

### Carrying costs speed, and that is what makes greed a decision **[ours]**

`speedOf(carry) = 300 − 30 × carry`. Empty, 300 units a second; full at six, 120. A hand carrying
four loses a straight race to the middle against an empty one by two to one.

**This is the one constant that was swept to prove it does what it is for.** Seat one was given a
different "turn for home" threshold from seat two — both `normal` bots, seat two on the shipped 4
— and the drag was varied under it. 200 seeds a cell, both stream orders:

| `CARRY_DRAG` | home at 2 | at 3 | at 4 | at 5 | at 6 |
|---|---|---|---|---|---|
| 0 | 9% | 31% | 50% | 60% | **70%** |
| 15 | 10% | 36% | 52% | 60% | **67%** |
| **30 (shipped)** | 18% | 40% | **53%** | **54%** | 45% |
| 45 | 56% | **66%** | 54% | 21% | 5% |

With no drag, greed is free and the answer is "carry everything" — the column is monotone and the
game has no decision in it. At 45 the answer flips to "bank constantly" and it has no decision in
it either. At 30 the optimum is a plateau in the middle of the range and both extremes are
punished, which is what a decision looks like. The player-facing consequence is that the number of
tokens fanned out beside your hand *is* your speed gauge.

### The note in the middle, and why the pile is odd **[ours]**

Sixteen mirrored pairs of equal value total an even number, so two seats who split the table
evenly would tie **every time**. That is not a hypothetical: `paint-fight` is recorded in
`balance-aggregate.test.ts` as unbalanceable because every one of 2000 matches ended 245–245, and
the tie was hiding a total seat-one advantage rather than proving fairness.

So the pile has an odd note in it: one worth 3, at the exact centre of the table, stationary. The
total is **65**. Once the table is empty, `p1 + p2 = 65`, and an odd sum cannot be a level one —
so a completed match is never a draw. A draw is only reachable by the clock, which is where a
draw belongs. `rules.test.ts` asserts both halves.

It has to be stationary, and that is forced rather than chosen: the only velocity that maps to
itself under the half-turn is zero. Which makes it the one place in this game where a state
variable sits **exactly** on a threshold by construction — both hands are equidistant from it, at
every moment, from the opening frame. That is the failure family the mirror lessons name, and it
is why the next section exists.

## The dead heat, and why there is no tie-break

Each note carries a grip timer *per seat*. A palm over a note advances that seat's timer; a palm
that leaves loses it at three times the rate. Whichever timer reaches 0.45 s first takes the note,
so "whoever got there first" falls out of the arithmetic with no special case at all.

**When both complete on the same step, neither takes it and both timers reset.** The two hands
knock the note out of each other's grip and have to start again.

There is no tie-break, deliberately, and the two obvious ones are both wrong:

- **A rule in board coordinates** — "the hand nearer its own safe", "the hand further up the
  table" — is *covariant* under the half-turn, so on a mirrored board it returns the mirror answer
  and decides nothing. Maze Paint found this and it generalises.
- **A seeded coin** is worse, because it names a seat. `rng.bool() ? 'p1' : 'p2'` returns `p1` in
  the mirrored world too, so a mirrored match would not come back mirrored — the coin *is* the
  seat asymmetry, dressed up.

Both hands taking nothing is symmetric, needs no extra state, and terminates: the note is still
there and somebody will get it. It is drawn as a double clash ring so the reason nothing is moving
is on the board.

Measured, 300 matches a tier:

| | steps with a note under both palms | dead heats a match | notes lifted a match |
|---|---|---|---|
| easy v easy | 2.6% | 0.64 | 32.9 |
| normal v normal | 4.3% | 1.27 | 33.0 |
| hard v hard | **24.9%** | **13.5** | 32.7 |

Two `hard` bots spend a quarter of the match with a hand on the same note, and **74% of
their dead heats are on the centre note** — two identical greedy policies both price it at 3 and
both go for it. It is the reason `hard` matches run four seconds longer than `normal` ones and the
reason 2.7% of them end on the clock. Two people do not do this, because one of them gets bored;
it is a fact about a bot that never gets bored, and it is reported rather than tuned away.

## The win condition, and the clock behind it

`{ kind: 'highest-when-time-expires' }`, resolved by the SDK's `resolve` on every step with
`timeExpired = inPlay === 0 || clock >= MATCH_SECONDS`.

`first-to` was wrong twice over: with a finite pile of 65 there is no target a runaway win and a
33–32 finish can share, and any target above half the pile puts most matches on the clock anyway.
`highest-when-time-expires` says exactly what the game does — the table empties, and whoever has
more has won.

`resolve`'s options object is **hoisted to module scope and mutated** rather than written as a
literal, because the winner is judged every step and a fresh object sixty times a second is what
rule 5 forbids.

### Termination is structural first, and timed second **[ours]**

`manifest.roundSeconds` ends nothing anywhere in this repository — it is text on a catalogue card.
What ends a match is that **the pile is finite and nothing replaces a banked note**. Every note is
lifted exactly once and banked exactly once; measured over 900 bot matches, 32.6 to 32.9 of the 33
notes are lifted per match, and the table empties in **every** `easy` and `normal` match measured
(1200 of 1200) and in 97.3% of `hard` ones.

`MATCH_SECONDS = 90` in `rules.ts` is the backstop, and it is a real one rather than decoration:
it is what catches two `hard` bots deadlocked on the centre note, and two people who put the phone
down. `rules.test.ts` plays sixty `easy`-against-`easy` matches **with no frame cap on the loop at
all** — a match that could not end would hang the suite rather than pass quietly — and a separate
test plays a match nobody ever touches and asserts it ends, as a draw, at 90 seconds.

**A lone hand can never clear the table**, and that is worth stating because it makes "time to
clear, solo" a meaningless measure for this game: a quarter of the felt is out of each seat's
reach for ever, and a note whose drift happens to be horizontal will sit in the far quarter until
the other player takes it. It is only ever both hands together that cover the whole table. In a
duel the two reaches union to the whole felt, so a duel always empties it.

## What the game asks of a player

**Reading the values.** A blind policy — go to the nearest note you can reach, never look at what
it is worth, turn for home at four — was played against each tier, 250 seeds:

| | blind player's win rate | blind's score | bot's score |
|---|---|---|---|
| v `easy` | **56.8%** | 33.0 | 32.0 |
| v `normal` | **36.4%** | 31.7 | 33.3 |
| v `hard` | **17.6%** | 30.5 | 34.5 |

That is the shape a party game wants. A child who just grabs whatever is closest is level with
`easy`, loses respectably to `normal`, and is never wiped out — the score band is 30 to 35 out of
65 whoever is playing, because the pile is finite and split. Nothing here saturates: `hard` does
not answer 100% of anything, it takes 34.5 of 65.

The floor is lower and worth knowing: a hand that wanders to random spots and never goes home at
all scores **0 in 300 matches**. Banking requires the one deliberate act in the game, which is
going back to your own end.

## The bot

Two knobs. Both are things a person has, both were swept alone, and both are strictly monotone
across their whole range.

| Tier | `thinkSeconds` | `misreadChance` |
|---|---|---|
| easy | 0.34 | 0.34 |
| normal | 0.20 | 0.16 |
| hard | 0.10 | 0.04 |

- **`thinkSeconds`** is how often it looks at the table. Everything it does between two looks it
  does on the older picture, so a note that drifted into reach a third of a second ago is
  invisible to `easy` until it looks again. That is this game's reaction time.
- **`misreadChance`** is the chance of reading one note's face value wrongly, drawn afresh at
  every look, per slot. A misread note reads as the next value up, wrapping 3 back to 1 — one draw
  per slot decides it rather than two, which keeps a look's window in the bot's own stream a fixed
  size. Reading the table is the skill the game asks for, so it is the skill the ladder is built
  from.

The policy itself is one line of arithmetic: **take the note with the best face value per second**,
where a second is the trip to it plus the 0.45 s dwell it takes to lift it; go home once the hand
holds four; go and stand over the nearest note if nothing is in reach. It sees note positions,
note values and which notes are loose — everything a person sees and nothing else. It is not given
note velocities, the other hand's target, or how far along the other palm's grip is.

### The bot cannot be wrong about its own trip

`botLook` costs a trip as `distance / speedOf(carry)`, and `driveHand` moves along the straight
line to the target at exactly that speed. Issue #2465 is about a bot reasoning analytically about a
quantity the simulation integrates differently; here the two are the same arithmetic, and
`rules.test.ts` asserts over forty random start-and-target pairs that the simulated arrival and the
predicted one agree to within a single step and never drift apart.

It also targets only places its own hand can stand, using the same two clamp functions `driveHand`
clamps with — asserted over eighty scattered boards.

### Both knobs, swept alone

Everything else as shipped. Win rate is the patched `hard` against an untouched `normal`, 200
seeds in each of the two stream orders. "solo" is one bot alone on the table for 45 seconds.

| `hard` `thinkSeconds` | v normal | solo value |
|---|---|---|
| 0.03 | 85.6% | 63.1 |
| 0.06 | 83.6% | 63.0 |
| **0.10 (shipped)** | **75.9%** | **63.0** |
| 0.16 | 71.4% | 62.9 |
| 0.24 | 59.6% | 62.6 |
| 0.36 | 44.5% | 62.5 |
| 0.55 | 28.2% | 62.0 |

| `hard` `misreadChance` | v normal | solo value |
|---|---|---|
| 0 | 79.8% | 63.0 |
| 0.02 | 78.5% | 63.1 |
| **0.04 (shipped)** | **75.9%** | **63.0** |
| 0.10 | 69.4% | 62.7 |
| 0.20 | 58.0% | 62.7 |
| 0.35 | 43.0% | 62.7 |
| 0.50 | 36.1% | 62.8 |

Strictly monotone over a 57-point range and a 44-point range respectively, with no saturation at
either end and no sign change anywhere. The shipped values sit inside the useful range rather than
at its edge, so the tier below has somewhere to stand.

**The solo column is the finding worth reading.** It does not move: 62.0 to 63.1 across every
value of both knobs, out of a 65-point pile. Alone, a bot eventually takes everything it can reach
whatever it thinks and however badly it reads, so **solo saturates and is not a measure of
anything in this game**. Every difference between the tiers is made in the race, which is the
answer to lesson 12: the contest had to be moved onto something that does not saturate, and here
it already is — the split of a fixed pile, which cannot saturate for either seat because every
point one of them takes is a point the other does not.

### The knob that was written, swept, and made a constant

**`HOME_AT` — how full a hand gets before it turns for home — is not a difficulty axis.** It was
the first difficulty knob written, and measuring it is the only way that could have been found
out. Swept as an *asymmetric* advantage — seat one at the value below, seat two on the shipped 4,
both seats the same tier, 250 seeds and both stream orders:

| `HOME_AT` for seat one | easy | normal | hard |
|---|---|---|---|
| 1 | 2.6% | 1.4% | 1.4% |
| 2 | 20.4% | 16.4% | 14.6% |
| 3 | 42.4% | 38.0% | 40.0% |
| **4 (shipped)** | **51.6%** | **51.8%** | **52.6%** |
| 5 | 51.2% | 51.6% | 51.5% |
| 6 | 41.0% | 44.6% | 42.6% |

Strongly non-monotone with a plateau at 4–5 and a fall at 6, **and the optimum sits in the same
place for all three tiers**. A ladder built on it would have put `normal` on the optimum and
`hard` handicapped past it — which is precisely what happened to Happy Hippos' patience knob
before it was measured. Six is worse than five because a hand at the carry cap grips nothing at
all and wastes the walk home. So `HOME_AT = 4` for everybody, and greed is a fact about the table
rather than a tier.

### Randomness: three streams

`init` derives three generators from the one seed the shell gives us.

**The table has its own**, so the pile it deals is a function of the match seed and never of how
hard anybody was thinking — `hard` looks three times as often as `easy`, and on a shared stream
that alone would deal the two pairings different tables and make every number above a fiction.

**Each seat's bot has its own**, so the order the two are polled in is not observable at all: a
reversed poll order gives a bit-identical match, asserted over 900 steps at each tier and twelve
seeds.

**A look draws exactly one value per note slot**, unconditionally, before anything branches — so a
busy table and an empty one leave a seat in the same place in its own stream. Asserted directly by
comparing generator positions after a look at each.

## Mirror symmetry

Written first, as lesson 8 asks, and it is what the two structural decisions above were designed
around rather than patched for.

The map is the half-turn that takes one seat's view of the board to the other's: slot indices are
kept, positions and velocities are turned about the centre, and everything seat-labelled is
swapped — the two hands, the two grip timers on each note, the two scores, the winner.

**Two things are asserted, over hundreds of boards that have nothing symmetric about them:**

1. `step()` takes a mirrored board to the mirror of the stepped board. 200 scattered boards,
   forty steps each, discrete state (who holds what, what is banked, who won) compared **exactly**
   and positions to within 1e-9.
2. Every bot decision on a mirrored board is the mirror of the decision on the original, at every
   tier, handed the identical stream. 450 comparisons. A tie-break written in board coordinates
   would return the *same* answer rather than the mirrored one and fail here, which is the
   mechanical reason this game has none.

**Why positions are compared to a billionth and outcomes to the bit.** `600 - (x + v·dt)` and
`(600 - x) - v·dt` round differently in the last place; that is a property of doubles and no
amount of care removes it. What matters is that no *decision* in this game sits on a knife edge
that a last-bit difference could tip. The two that could have are both handled structurally: the
palm test is `dx² + dy² <= r²`, and negating both components is exact — a mirrored pair of hands
gets a bitwise identical distance, asserted on its own over 200 random pairs — and the one place a
variable does land on a threshold by construction, the centre note, is settled by both seats
taking nothing.

A third test drives that case directly: two hands pinned on the centre note for 200 steps, with
the assertion that neither ever lifts it, the two grips stay equal, and both scores stay at zero.

## What was measured

### Equal tiers — 6000 seeds a tier, six independent seed families

| | p1 | p2 | draws | unfinished | seat one's share of decided | a match |
|---|---|---|---|---|---|---|
| easy v easy | 3011 | 2989 | 0 | 0 | **50.2%** | 20.2 s |
| normal v normal | 3034 | 2966 | 0 | 0 | **50.6%** | 19.6 s |
| hard v hard | 2926 | 2942 | 132 | 0 | **49.9%** | 23.3 s |

Three standard errors at this sample is 1.9 points, so every tier is inside the flat 45–55% band
with room to spare, and none is more than 0.9 σ from level. The six families measured separately
run 47.8% to 52.2%, which is what six samples of a thousand look like. **Not one of the 18 000
matches failed to finish.**

**Be plain about the sample the repository's own guard uses.** `balance-aggregate.test.ts` runs 50
seeds by default on the family `1000003 + 7919 s`, and on that sample this game reads **54.0%** —
inside the band, but only just, and 50 seeds resolve ±21 points at three sigma, so that reading on
its own would be worth very little either way. The same family reads **54.0% at 250 seeds and
50.7% at 1000**, and the six-family sweep above is the number to believe.

### Is it 50% by construction, or by sampling? By sampling, and here is why

Lesson 9 asks which one a game has, so: **this one has 50% by sampling.** The deal *is* exactly
symmetric — slot 2k+1 is the half-turn image of slot 2k with the same value and the reversed
heading, asserted to the bit for a hundred seeds — but that symmetry is a **relabelling** of the
note array (2k ↔ 2k+1), not the identity. The bot's misread table is indexed by slot, so the
mirror of a match hands the two bots the same Bernoulli draws against *permuted* slots. The
distribution is identical and the individual match is not: swapping the two bots' streams
reproduces the mirrored match in **0 of 600 seeds** at `easy`, 1 of 600 at `normal` and 8 of 600 at
`hard`, where a deadlocked centre note makes some matches insensitive to the streams altogether.
Pooling both stream orders gives 50.6% / 50.8% / 53.9% across the three tiers on 600 seed pairs
each, which is the same answer the deeper sweep gives and a good deal noisier.

Making it structural would mean indexing the misread by *pair* rather than by slot, so that a
player who misreads a note also misreads its mirror twin. That is a worse model of a person for a
better-looking number, and it was not done.

### Cross tier — 300 seeds a cell, both stream orders

| | as seat one | as seat two | mean | a match |
|---|---|---|---|---|
| hard v normal | 78.8% | 72.2% | **75.5%** | 18.8 s |
| normal v easy | 73.3% | 68.5% | **70.9%** | 19.8 s |
| hard v easy | 86.7% | 86.3% | **86.5%** | 19.2 s |

Monotone, and every pairing agrees with itself within 6.6 points across the two orders. No pairing
produced a single draw in 1200 matches.

## Rendering

Everything is drawn through the `Renderer` interface and **interpolated with the loop's `alpha`**.
An empty hand crosses the table at 300 units a second, which is five units a step, and it is the
object a player is watching. Notes and hands both interpolate; a jump larger than 20 units is
drawn where it is rather than streaked, which is what a note being snatched onto a palm looks like.

The previous step's positions live in typed arrays allocated once at construction and written in
place at the top of `update`, so nothing in the step path allocates. Deposit labels and note face
values are looked up from frozen tables rather than built, so `render` allocates no strings. A test
renders 120 frames at four different alphas and asserts the simulation did not move, and another
asserts every `pushSeatRotation` is balanced.

Seat colours come from the engine's `SEAT_PALETTE`, which is the one definition of what a seat
looks like. The felt, the rails and the ink are local constants, as they are in every other game
here — scenery is not seat identity.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W` `A` `S` `D` move the hand | `↑` `←` `↓` `→` move the hand |
| Pointer | hold a finger on your own half and slide | the same, in your own half |

**There is no action key.** `Space` and `Enter` do nothing, and that is the fairness argument
rather than an omission — see the multi-touch section.

The seat sitting opposite reads the device upside down, so **its keys mirror in both axes** under
the shared-screen presentation and not under single-seat. That is control mapping, which
`docs/presentation.md` allows the two presentations to differ in; nothing in the simulation reads
the presentation, and a test drives two bot-versus-bot matches through both presentations and
asserts they are identical step for step.

The pointer does not mirror, because the table is one board drawn one way up and a finger is
already over the felt it means.

### One arm of `presentation-parity` cannot judge this game, and here is why

`apps/web/src/data/presentation-parity.test.ts` reports `money-grabber/far-hand` and
`money-grabber/storm` as arms whose driver never moved the game — it is one of thirteen games on
that list and one of fourteen on "scripted far hand changes nothing". The cause is specific and
worth writing down rather than leaving as a harness quirk.

That file's trace records score, winner, active seat and **the number of draws taken from
`context.rng`**. This game takes exactly three from it, in `init`, to seed the table's generator
and the two bots' — and **not one after that**. The table is dealt from its own stream, the pile
is finite so nothing is ever replaced, and each bot draws from its own generator rather than the
shell's. So the draw-count half of the trace is constant by construction. The
score half only moves when a hand completes a 0.45 s grip *and* walks the note home, which the
harness's generic gesture — a tap, a six-step drag and a held key — never does.

The arms that do move (both seats bot, and the local hand) compare and pass, and the property
those arms cannot reach is covered locally instead: `game.test.ts` drives the far seat's keys
under both presentations and asserts the mirror, and drives two bot matches through both
presentations and asserts they are identical in every field of the simulation.

## `context.openingSeat`

Deliberately **not** read, and the contract says a real-time game may ignore it. Happy Hippos reads
it because its ball colours are assigned by slot parity and several replacements can be drawn on
one step; this game has no equivalent — the table is dealt as half-turn pairs of *equal* value, so
there is no parity, no deal order and no draw order for an opener to decide. Rather than leave that
as a claim, `game.test.ts` plays three seeds under both openers and asserts the two matches are
identical in every field of the simulation.

## Not built, and not specified here

- **Ten fingers.** The catalogue row's phrase, taken literally. Not buildable at the game layer —
  argued at length above — and replaced by a palm radius that takes a fistful at once.
- **Stealing from the other hand.** Considered: a hand that touches a loaded hand takes some of
  what it holds. Every version of it needed a rule about *which* seat's hand initiates, which is a
  seat-labelled quantity, and every seat-labelled quantity breaks the mirror. The race to the note
  is the contest instead.
- **Notes that respawn.** The pile is finite, which is what makes termination structural rather
  than a clock's job. A spawner would have made the table endless and pushed every match onto the
  90-second backstop.
- **Notes colliding with each other.** Thirty-three independent drifters, no pairwise pass. It
  keeps the step O(n), keeps it allocation-free, and removes a family of numerical instability for
  a behaviour a player would read as noise.
- **No audio and no art assets.** Everything is drawn with engine primitives, so
  `assets.license.json` has nothing to declare.
- Cross-device netcode and the tournament wiring are the shell's.
