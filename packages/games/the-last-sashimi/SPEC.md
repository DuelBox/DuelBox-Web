# The Last Sashimi — specification

**Archetype:** `turn-aim` · **Category:** Party · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions and
> distinguishes them from what the observed rule dictates. Every number below was measured
> against the compiled `dist/rules.js` and `dist/index.js` with the harness in
> `/tmp/…/scratchpad/tls/`; none of it is remembered or hoped for.

A conveyor runs a loop past two counters, one at each end of the board. Plates ride it: a long
slice of sashimi worth one point, a compact rice ball worth three. One press closes your
chopsticks on whatever is passing. Catch a plate and it comes off the belt — and it is missing
when it reaches the other player. Close on bare belt and it costs you a point. Chewing takes a
moment and a rice ball takes most of your turn, so what a turn really spends is time. First to
fifteen.

## Observed rules

> Eat all before your opponent! First to 15 wins, sashimi is worth 1 point, onigiri is worth 3
> point and for every mistake you lose a point!

Four clauses and all four are built. The row names no control scheme at all, which is unusual
for this catalogue and meant nothing had to be traded away to make the game fair — see below.

## The control idiom: one bare press, and a turn is a run of them **[ours]**

Cup Pong aims with **two presses against two moving gauges** — a line and a distance along it.
Target Practice aims with **one distance and one moment**, and argued that a moment is the most
instrument-neutral quantity there is because it is read off the board rather than off a gauge.
A third game built from a gauge and a press would be the same game a third time.

So this one has **no gauge at all**. Every press is a bare timestamped event. There is nothing
to read, nothing to stop, nothing to keep. What varies between turns is not the *kind* of press
but the *number* of them: a turn is as many bites as you dare, and the decision each time is
whether this plate is worth a press and worth the chewing that follows.

Three things follow, and they are why it was worth doing rather than borrowing:

- **It is the strongest form rule 10 takes in this catalogue.** A thumb, a trackpad and a
  keyboard cannot express a difference in a bare press — there is no continuous quantity for a
  thumb to be finer at. Cup Pong had to *give up* the reference's swipe to reach a weaker version
  of this; here the observed rule named no control at all, so it cost nothing.
- **The count is a real decision.** Bots take 2.08–2.16 presses a turn across the three tiers,
  and both plate classes at every one of them (measured below). A turn is not "your shot"; it is
  a run you choose the length of.
- **The skill is one thing, so the ladder is one number.** Both exemplars' tiers differ only in
  seconds of press error, and so do these; but here that is the *whole* of the game rather than
  one of two dials, which is why the tiers are looser (0.16–0.30 s) than theirs.

## The belt is a clock, not a place **[ours]**

**Nothing in `rules.ts` is measured in board units.** A plate's position is
`wrapSlots(slotLead + beltAt(clock))` in *plates*, and every tolerance is stated in *seconds*,
because what a player is judging is a moment. The loop, the two runs, the curtained ends and the
plates themselves are drawn by `game.ts` from those two numbers and exist nowhere else. Rule 8
is not merely obeyed here, it is unexpressible: the simulation has no vocabulary for a pixel.

Two consequences, and the second is the one that matters:

- **Nothing is integrated.** `beltAt` is `beltPhase + clock / DISH_SECONDS`, evaluated fresh
  every time it is asked for, so a plate asked about a moment answers the same however much play
  happened in between. A test plays twenty seconds of match and re-asks about a moment in the
  past.
- **The bot's analytic arrival and the referee's reach test are the same arithmetic.**
  `nextArrival` inverts `offsetSecondsAt` in closed form; the referee judges a press against
  `offsetSecondsAt` at the frame the press lands on. There is no flight, no settle, no numeric
  integration between the two, so there is nothing for them to disagree about. Five games in this
  repo were wrong about exactly this (issue #2465, commit b4af006) and one had hidden the failure
  inside a 1% test tolerance. A test fires at exactly the solved clock for every plate from both
  seats and asserts the offset is zero: the worst case over 200 belts × 2 seats × 14 plates is
  **8.5 × 10⁻¹⁵ seconds**.

### Mirror symmetry is exact, and one line is why

The two counters sit exactly half a lap apart, and the menu is **mirrored about that half lap**:
slot `i` and slot `i + 7` always carry the same plate. So at every instant the two seats face the
bit-identical belt, and the only thing that can ever differ between them is what has already been
eaten — which is the game.

Getting that exact rather than approximate took one line. `slotLeadOf` reduces `index - grabSlot`
to a whole number in `[0, 14)` **before the clock is anywhere near it**. The obvious spelling does
not: seat two asking about slot 3 evaluates `(3 - 7) + belt` and seat one asking about its mirror
partner, slot 10, evaluates `(10 - 0) + belt`. Those differ by fourteen in exact arithmetic and
round differently in floating point, so the two seats' answers can straddle a comparison in their
last bits. Snowball Throw measured seat one at 64.3% and bisecting found two defects of precisely
this family — a tie-break written in board coordinates, and a threshold on a knife edge — neither
of which any ordinary unit test or win-rate ladder could see.

What is asserted, with `toBe` and never `toBeCloseTo`:

| check | samples | mismatches |
| --- | --- | --- |
| `offsetSeconds` agrees for every mirrored pair at every clock | 5600 | **0** |
| `nextArrival` agrees for every mirrored pair | 56 | **0** |
| `chooseQuarry` picks the mirrored plate at every tier | 1200 | **0** |
| `slotUnderChopsticks` resolves to the mirrored plate | 300 | **0** |
| a whole match played with the seats swapped is the mirror image | 120 | **0** |

The last row is the test the brief asks for and the one nothing else in the repo can do. Because
the belt is its own mirror by construction, *mirroring the board is exactly swapping the seats* —
so the check covers the whole simulation, not only the geometry.

## The ready pause is in the rules, not in the shell **[ours]**

The shell turns the board to face whoever is eating and refuses a person's input for the 0.36 s
that takes. **A bot does not go through the shell.** Cup Pong found this hole and fixed it with a
freeze in the simulation; Target Practice found it was worse in its game — a person would have had
fifteen milliseconds. **It is worse again here, and for a different reason.**

In the other two games the flip costs a player some of a gauge's travel. Here a bite is
**instantaneous**, so unearned belt converts straight into free plates. The belt is inside
somebody's reach **39.9%** of the time — 0.27 s of sashimi window and 0.164 s of rice-ball window
in every 0.6 s of belt — so 0.36 s of free belt is **0.144 s of free grabbing, every turn, for
ever**. A bot would take a plate for nothing in roughly a quarter of its turns and a person would
take none.

`READY_SECONDS = 0.5` freezes the chopsticks for both of them, in the simulation, where a person
and a bot are the same thing. A test asserts the inequality and the margin.

It cannot live in `game.ts` instead. `seatView` reports **no rotation at all** in single-seat play,
so a freeze keyed off the flip would step one match on a shared phone and a different one on two
phones playing remotely. A test drives the same seed through both presentations and compares.

The freeze also makes the shell's input gate free: `READY_SECONDS` outlasts the flip, so
`flip.acceptsInput` never refuses a press the simulation would have taken. That is why this game
is not on `presentation-parity.test.ts`'s known-divergence list, which three games are on for
exactly this interaction.

## The restaurant

| | Value | Why |
| --- | --- | --- |
| Board | 700 × 1000 | Not used by the simulation; `game.ts` owns every length |
| Plates on the belt | 14, mirrored about the 7th | Even and mirrored, so the two seats face one belt |
| Counters | plates 0 and 7 | Exactly half a lap apart |
| Plate period | 0.6 s | One plate passes your chopsticks every 0.6 s |
| Lap | 8.4 s | 14 plates |
| Menu | 2 rice balls and 5 slices per half, shuffled once a match | 4 and 10 on the belt |
| Sashimi | half-length 0.102 s, **1 point** | |
| Onigiri | half-length 0.049 s, **3 points** | The observed rule's triple |
| Chopstick reach | 0.033 s either side | So the window is `plate + reach` |
| **Sashimi window** | **±0.135 s** (16 frames) | |
| **Onigiri window** | **±0.082 s** (10 frames) | |
| Clean band | 0.55 of the window | The score's fine resolution |
| Chewing | slice 0.45 s, rice ball **1.25 s**, mistake 0.8 s | |
| Ready freeze | 0.5 s | Longer than the shell's 0.36 s flip |
| Turn | 2.2 s once the sticks are live | Three and two thirds plates |
| Settle | 0.4 s | |
| Turn period | 3.1 s | Deliberately not a divisor of the lap — see below |
| Refill | 0.75 of a lap after a plate is taken | Missing at the other counter, back at your own |
| Match | first to 15, capped at 34 rounds of one turn each | |
| Course | 2 rounds | A match ends only when both have led equally often |

### The two plate sizes, and the two arithmetics that set them

**The lattice.** A press only ever lands on a whole frame, so a bite's offset from dead centre
falls on a grid a sixtieth of a second apart. The sashimi window is 16 frames across and the rice
ball's is 10. Cup Pong's first geometry ran a needle whose grid was **coarser than its cup**, and
two neighbouring mouth radii gave the identical hit rate to three significant figures — that is
the symptom to watch for. A test asserts both windows are at least eight frames.

**Mashing has to lose.** This is the constraint that actually pinned the sizes, and it is
specific to a game whose only control is a press. The expected value of a *uniformly random*
press is `P(slice) + 3·P(rice ball) − P(nothing)`, and with the belt in reach 39.9% of the time
that comes to **−0.045 points**. Widen the plates by a fifth and it turns positive and the game
is a button-masher. Measured rather than argued:

| | mashing, against a `normal` bot | 600 matches, both seats |
| --- | --- | --- |
| points a turn | **−0.14** | |
| matches won | **6.5%** | |

A test drives a seat that presses on every frame and requires it to lose to a seat that waits,
from either side.

There is a real wrinkle, and it is worth writing down because it is the same phenomenon as the
resonance below. A masher's presses land at chewing intervals, so they are a *fixed cadence*, and
a fixed cadence can fall into step with the belt. Masher against masher is therefore bimodal:
over 400 matches the lucky one averages 0.88 points a turn and the unlucky one −1.38, and the
match usually decides rather than running to the cap. `FUMBLE_CHEW = 0.8` is four thirds of a
plate period, which means a locked masher only ever visits three phases of the belt and two of
them are usually misses — measured against 0.83 and 0.91, it is the value that suppresses the
lucky mode best (0.88 points a turn against 1.26 at 0.83). Against an opponent who is *playing*,
the coupling through the belt breaks the lock and the masher loses 93.5% of the time.

### The rice ball costs the turn, not just the precision **[ours]**

This is the axis the game owns, and the reason it is not Target Practice with a belt.

There, a high-scoring target costs precision at the moment you take it, and the radii were fitted
so the value curves for the two classes **cross** between two tiers. Here they do not cross at
all, and that is fine rather than a failure: three points against one is too big a gap for the
window difference to overturn at any tier we would ship. `expectedPointsOf` is greater for a rice
ball than for a slice at `easy`, `normal` and `hard` alike, and a test asserts it.

The trade is **time**. A rice ball chews for 1.25 s out of a 2.2 s turn — more than half of what
you had, and two plates go by while it lasts. So the question a player answers is not "can I hit
this?" but "is this worth the turn?", and the answer moves with how much turn is left and how far
away the next rice ball is. That is a decision a person makes by looking at the belt, and it is
the one the bot is built to make.

`chooseQuarry` therefore ranks plates by **points per second of turn spent** —
`expected / (wait + as much of the chew as the turn can still be charged for)` — rather than by
points. It is not decoration; swept alone it is worth this much:

| bot's value rule | `easy` slices/turn | `easy` points/turn | `hard` slices/turn | `hard` points/turn |
| --- | --- | --- | --- | --- |
| **points per second (shipped)** | **0.96** | **1.21** | **1.38** | **2.83** |
| points only, time ignored | 0.66 | 1.06 | 1.05 | 2.50 |

Ignoring the time cost makes the bot wait for rice balls it should have passed up, and it takes a
third fewer slices for a tenth fewer points. 400 matches a tier.

The mistake term in the same expression — `points × P − (1 − P)` rather than `points × P` — is
**measured as very nearly inert**: 1.21 points a turn against 1.23 at `easy`. It is kept, and the
honest reason is that it is the difference between a value and a score rather than that it moves
the number: it is what would make the bot pass a plate up at a press error of 0.46 s or worse, a
hand looser than any tier we ship but not looser than a person can have.

### Nothing may be in step with the belt

**This is the single most surprising thing measured in this game.** A turn takes
`READY_SECONDS + TURN_SECONDS + SETTLE_SECONDS` and the belt comes round in `LAP_SECONDS`. If the
second divides the first, the two seats meet the *same phases of the belt for ever* — and on a
shared belt a standing phase relationship is a standing advantage to whoever meets it first.

Swept alone at `hard`, 2000 matches from each opening seat, everything else as shipped:

| turn | turn period | lap / period | opener's share of decided |
| --- | --- | --- | --- |
| 1.5 | 2.40 | 3.500 | 50.5% |
| 1.7 | 2.60 | 3.231 | 51.8% |
| 1.8 | 2.70 | 3.111 | 53.5% |
| **1.9** | **2.80** | **3.000** | **54.9%** |
| 2.0 | 2.90 | 2.897 | 53.4% |
| 2.1 | 3.00 | 2.800 | 51.8% |
| **2.2 (shipped)** | **3.10** | **2.710** | **50.8%** |
| 2.3 | 3.20 | 2.625 | 50.3% |
| 2.5 | 3.40 | 2.471 | 50.1% |
| 2.6 | 3.50 | 2.400 | 50.4% |

A clean peak on the integer, five points high, falling away on both sides. Nothing else changes
across those rows. The tidy-up an author would reach for — a round 1.9 s turn — lands exactly on
it, so a test asserts the ratio stays clear of the integers and the half-integers.

The masher's phase lock above is the same phenomenon arriving through a different clock, which is
why both are recorded here rather than in two unrelated places.

## The shared belt, and what "eat all before your opponent" was built as **[ours]**

There is **one** supply. A plate you take comes off the belt, is missing when it reaches the other
counter half a lap later, and is back by the time it returns to you a lap after that. Taking
denies, and that is the whole of the row's first clause.

`EMPTY_LAPS = 0.75` is not a tuning number, it is the middle of a plateau. The only two things
that can happen to an empty slot are that it passes the opponent's counter (half a lap) and that
it returns to yours (one lap), so the behaviour is **piecewise constant** and there are exactly
three regimes. Measured at `hard`, 1200 matches each opening seat:

| refill delay | opponent misses it? | you miss it? | opener's share of decided |
| --- | --- | --- | --- |
| under 0.5 lap | no | no | 48.5% (no denial at all) |
| **0.5 – 1.0 lap (0.75 shipped)** | **yes** | **no** | **50.8%** |
| exactly 1.0 lap | yes | knife edge | 48.8% |
| over 1.0 lap | yes | yes | 46.6% |

The row at exactly one lap is the one to be careful about: it decides on the *sign of the press
error* — a plate taken a frame early refills a frame before it comes back to you and a plate taken
a frame late refills a frame after — which is a threshold on a knife edge, the second of the two
Snowball Throw defects. It measures best and it is not shippable. 0.75 is the midpoint of the
plateau either side of it, as far from both boundaries as the geometry allows.

### The course rule, and the opener

The lead alternates, so over an **even** number of rounds each seat has led exactly as often as
the other and over an odd number the opener has led once more. Cup Pong measured its two lead
orders as **bit-identical** because its two racks never touch. Here leading means picking from a
belt the other seat has not thinned since it last came round, so the extra lead is worth real
points and a match that can stop after an odd round hands it out at random.

So a match is judged only at the end of a **course of two rounds**. It costs one line and up to one
extra round:

| structure, at `hard` | opener's share of decided |
| --- | --- |
| 2.6 s turn, judged every round | 56.4% |
| 2.6 s turn, judged on a course | 51.8% |
| 2.2 s turn, judged every round | 52.1% |
| **2.2 s turn, judged on a course (shipped)** | **50.4%** |

1500 matches each opening seat. The two fixes — the turn period off the resonance, and the course
— are independent and both are kept.

## Scoring, the win condition and the tiebreak

**The win condition is the SDK's shared helper**, called once at the end of every completed course:

```ts
resolve({ kind: 'first-to', target: 15 }, { p1, p2 }, { timeExpired: round >= 34 });
```

**A match ends only on a completed round**, and only at the end of a course. Reaching fifteen does
not end it on the spot: the other seat still gets the turn it is owed and may reach fifteen too.
Ending on the point would hand the match to whoever happened to be leading that round — the trap
every first-to-N game in this repo has had to be dug out of.

**A score can go negative, and there is no floor.** The row says every mistake costs a point; a
floor at zero would make mistakes free once you were on nothing, which is a strategy rather than a
rule. The helper handles negative tallies without special-casing. **[ours]**

The **clean-take tiebreak** runs only on what the helper calls a draw. It is the score's fine
resolution and it is doing real work:

| 2000 matches a tier | level on points | drawn after the tiebreak |
| --- | --- | --- |
| easy v easy | 1.8% | **0.1%** |
| normal v normal | 3.3% | **0.3%** |
| hard v hard | 4.4% | **0.5%** |

`CLEAN_SHARE = 0.55` is set so that a bit over half of everything taken is taken clean — 63% at
`easy`, 66% at `normal`, 72% at `hard`. A tiebreak that almost never separates anybody is not one.

It is deliberately a tiebreak and not points: a player who reaches fifteen first has won whatever
the other one's chopsticks looked like, because that is what the observed rule says the game is.

## Termination

**The scoring in this row invites a stall that no other game in the catalogue has.** "First to
fifteen" and "every mistake costs a point" together mean two players who keep missing walk
*backwards*: the target recedes and no amount of play brings it closer. `roundSeconds` ends
nothing — it is text on a catalogue card. Three guarantees close it:

1. **`TURN_SECONDS` bounds a turn.** Nothing else forces a press.
2. **`MAX_BITES_PER_TURN` bounds the presses in one.** Insurance rather than a rule anybody
   meets — the chews already cap a turn at five presses — and it is what lets the bot's per-turn
   randomness be a fixed-size draw.
3. **`MAX_ROUNDS = 34` bounds the match**, fed to the helper as `timeExpired`, so the higher score
   takes it.

Together they cap a match at `34 × 2 × 3.1` = **211 seconds** of simulated play. Two tests exercise
this rather than waiting for it, both with **no frame cap at all** so a match that could not end
would hang the suite rather than pass quietly: one with nobody pressing anything, and one with
both seats starting on fourteen and pressing **only when the belt is bare**, which is the stall
exactly.

Thirty-four rather than eighteen because the cap has to clear the longest matches the *weakest*
pairing produces rather than the average one. 3000 matches a tier, both opening seats, with the
cap raised out of the way:

| | mean rounds | longest | past 18 rounds | hit the shipped cap |
| --- | --- | --- | --- | --- |
| easy v easy | 10.5 | 32 | 2.73% | 0 / 3000 |
| normal v normal | 7.0 | 16 | 0 | 0 / 3000 |
| hard v hard | 5.5 | 10 | 0 | 0 / 3000 |

It fires about once in six thousand `easy` matches and never at the other tiers.

## Controls

| | Seat one | Seat two |
| --- | --- | --- |
| Keyboard | `Space` | `Enter` |
| Pointer | tap anywhere | tap anywhere |

Only on your own turn, never during the ready freeze, never while the chopsticks are chewing, and
never while the board is part-way through its half-turn. There is nothing to point *at* — only a
moment to pick — which is what `zoneSplit: 'shared-board'` tells the shell.

**Fair across every input family and every device class, without a caveat.** A press is one binary
event with a timestamp on a phone, a trackpad and a keyboard alike; there is no continuous
quantity anywhere in the game for one instrument to be finer at than another, and no simulation
value is expressed in a length. `sameInputClassOnly` is false and a test asserts the manifest's
pointer line never says drag, swipe, flick or hold.

## The bot

Three tiers, expressed only as how accurately a tier hits the moment it meant to. A bite is a bare
press against a clock, so that is the whole of the skill the game asks for and the whole of what
the tiers differ in.

| Tier | Press error | Fumbles |
| --- | --- | --- |
| easy | ±0.30 s | 15% |
| normal | ±0.22 s | 8% |
| hard | ±0.16 s | 2% |

Looser than Cup Pong's 0.11–0.20 and Target Practice's 0.145–0.24 because the windows here are
tighter: a slice forgives 0.135 s either side and a rice ball 0.082, so 0.16 s is already missing
one slice in forty and one rice ball in four. A ladder is only a ladder relative to the tolerance
it is measured against. Every tier's error is at least nine frames wide, so rule 6 holds by
construction — none of them can pick a moment more finely than a person can.

Everything it reads is on the board: where the plates are, what is on them, which slots are bare,
and how long its own turn has left. Plus one thing about itself, which is how steady its hands
are. A person has both. A test freezes the opponent's score and the round number and asserts the
choice does not move. Nothing is searched — fourteen plates, O(1) each — and `bot-cost` measures
its worst step well inside a frame.

Four things are load-bearing.

**It counts down to a moment; it does not watch for a position.** Watching for a position is the
obvious way to write this and it never settles: a wanted offset the belt does not land exactly on
is a wait with no end. Cup Pong found this as an actual deadlock on seed 2 of its very first
harness run. A countdown cannot fail to expire, and it is the more honest model anyway — a person
commits to a moment, and pressing after the plate has gone past is a real way to miss.

**It re-plans only when its chopsticks come free**, never mid-countdown. A bot that revised a
committed press every step would be changing its mind faster than a person can.

**Its press error is triangular, not flat.** Two draws summed. Flat, a tier either fits inside the
window or it does not with almost nothing in between, and three tiers have nowhere to stand.

**Its randomness is drawn up front, all of it.** See below.

### Randomness

**A generator per seat**, derived in `init` from `context.rng` before anything else touches it,
and **exactly 24 values per turn** — four for each of the six presses a turn could hold — drawn
unconditionally at the first live step, before it knows whether there is anything on the belt
worth reaching for. Both are asserted, the second over a whole match: `draws === p1Turns × 24`,
whatever the turns did.

What that buys: seat two commits to the identical sequence of press errors whatever tier is
sitting opposite it. What it does **not** buy, and what nothing could: the belt is one belt, so an
opponent who eats differently hands you a different belt. Over 500 matches seat two took a
bit-identical set of presses against an `easy` opponent and against a `hard` one in **93 of them**
— the short matches, where the coupling has not had time to bite. Target Practice gets 0/500 for
the same structural reason and Cup Pong gets 500/500 because its two racks never touch.

That coupling is symmetric, it is visible on the board — a bare plate is drawn as a bare plate all
the way round — and the balance tables below are where it is measured rather than assumed.

A reversed poll order gives a **bit-identical** match at every tier: 120/120 over forty seeds a
tier in the suite.

### Every knob, swept alone

All monotone in points a turn with everything else left as shipped. Win rate is against an
untouched `normal` over 600 seeds in each seat order.

| `hard` press error | wins vs `normal` | points/turn | takes/turn | mistakes/turn | match |
| --- | --- | --- | --- | --- | --- |
| 0.08 s | 87.3% / 87.3% | 3.21 | 1.89 | 0.02 | 34 s |
| 0.11 s | 84.8% / 85.8% | 3.15 | 1.92 | 0.06 | 32 s |
| 0.13 s | 85.8% / 85.8% | 3.08 | 1.96 | 0.10 | 32 s |
| **0.16 s (shipped)** | **80.0% / 81.7%** | **2.90** | 1.95 | 0.19 | 34 s |
| 0.19 s | 70.5% / 69.3% | 2.59 | 1.86 | 0.31 | 37 s |
| 0.24 s | 49.0% / 49.3% | 2.04 | 1.66 | 0.51 | 45 s |
| 0.32 s | 23.2% / 20.7% | 1.36 | 1.37 | 0.75 | 64 s |

**Not saturating at the top.** At 0.08 s — half the shipped error — `hard` still takes only 1.89
plates a turn, because what bounds a turn is the belt and the chewing rather than the hand. That
is the property the brief's sixth lesson asks for: the contest does not have a ceiling a good
player sits on.

| `hard` fumble rate | wins vs `normal` | points/turn | takes/turn |
| --- | --- | --- | --- |
| 0 | 81.5% / 82.4% | 2.95 | 1.97 |
| **0.02 (shipped)** | **80.0% / 81.7%** | **2.90** | 1.95 |
| 0.06 | 75.5% / 76.6% | 2.78 | 1.91 |
| 0.14 | 66.8% / 65.9% | 2.56 | 1.82 |
| 0.30 | 48.0% / 45.3% | 2.10 | 1.64 |
| 0.60 | 17.0% / 13.5% | 1.21 | 1.29 |

| `normal` press error | beats `easy` | loses to `hard` | points/turn | match |
| --- | --- | --- | --- | --- |
| 0.17 s | 90.5% | 63.1% | 2.61 | 36 s |
| 0.19 s | 87.8% | 70.5% | 2.41 | 39 s |
| **0.22 s (shipped)** | **82.8%** | **81.7%** | **2.14** | 43 s |
| 0.25 s | 74.0% | 88.3% | 1.86 | 48 s |
| 0.28 s | 64.5% | 92.5% | 1.59 | 55 s |

0.22 s is where the middle rung is equidistant from both its neighbours, which is the only
property asked of it.

| `easy` press error | beats `normal` | points/turn | rounds | match | hit the cap |
| --- | --- | --- | --- | --- | --- |
| 0.26 s | 27.5% | 1.61 | 8.6 | 54 s | 0 / 400 |
| **0.30 s (shipped)** | **18.7%** | **1.33** | 10.3 | 65 s | 0 / 400 |
| 0.34 s | 11.7% | 1.08 | 12.5 | 79 s | 3 / 400 |
| 0.40 s | 3.8% | 0.76 | 17.0 | 107 s | 25 / 400 |
| 0.50 s | 0.5% | 0.31 | 26.7 | 168 s | 194 / 400 |

`easy` is bounded from below by the round cap, not by taste: every step of extra clumsiness is a
round and a half of extra match, and past 0.34 s the cap starts deciding matches.

**`BLUNDER_SCALE` was swept and kept at 6, but it is nearly flat and that is worth saying.** At
1, 3, 6, 10 and 16 the `hard` win rate against `normal` reads 75.0%, 76.7%, 77.8%, 77.6%, 77.8%
(800 seeds from one opening seat, so the level sits a little below the two-order table above).
It saturates above about 3 for a reason that is a fact about this game rather than a coincidence:
a slip wider than a plate's window is the same miss as a slip ten times wider, and at `hard` even
`timing × 3` is more than three windows. So the *rate* is the knob and the *size* is not; a test
asserts the product clears three windows at every tier, which is the property the constant is
actually for.

### Solo, per tier

2000 matches a tier, both opening seats.

| Tier | presses/turn | hit | slices/turn | rice balls/turn | mistakes/turn | clean share of takes | points/turn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| easy | 2.08 | 63.2% | 0.98 | 0.34 | 0.76 | 63% | 1.22 |
| normal | 2.16 | 77.0% | 1.23 | 0.43 | 0.50 | 66% | 2.03 |
| hard | 2.15 | 90.6% | 1.40 | 0.54 | 0.20 | 72% | 2.83 |

**Every tier takes both classes of plate**, so neither is scenery — the thing Target Practice had
to fit its radii to a crossing to achieve, this game gets from the chewing. A test asserts it.

### Balance, 3000 seeds a tier a seat

Equal tiers, each row a separate 3000-seed run with that opening seat:

| | opens | p1 | p2 | draws | **seat-one share of decided** | rounds | match | points/turn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| easy v easy | p1 | 1525 | 1472 | 3 | **50.9%** | 10.4 | 66 s | 1.33 |
| easy v easy | p2 | 1497 | 1499 | 4 | **50.0%** | 10.4 | 66 s | 1.33 |
| normal v normal | p1 | 1523 | 1472 | 5 | **50.9%** | 6.9 | 43 s | 2.12 |
| normal v normal | p2 | 1503 | 1493 | 4 | **50.2%** | 6.9 | 43 s | 2.12 |
| hard v hard | p1 | 1514 | 1474 | 12 | **50.7%** | 5.4 | 34 s | 2.88 |
| hard v hard | p2 | 1455 | 1531 | 14 | **48.7%** | 5.4 | 34 s | 2.88 |

Every share is inside **48.7 – 50.9%**, comfortably inside the 45–55 band, and the two opening
seats agree with each other within 2.0 points at every tier. The opener's own share, which is the
quantity the shared belt puts at risk, is **50.5% / 50.3% / 51.0%**.

Cross tier, 1500 seeds each, both seat orders:

| | p1 | p2 | draws | stronger tier's share of decided |
| --- | --- | --- | --- | --- |
| hard as p1 v easy | 1433 | 67 | 0 | 95.5% |
| easy as p1 v hard | 80 | 1420 | 0 | 94.7% |
| normal as p1 v easy | 1206 | 294 | 0 | 80.4% |
| easy as p1 v normal | 285 | 1213 | 2 | 81.0% |
| hard as p1 v normal | 1179 | 317 | 4 | 78.8% |
| normal as p1 v hard | 319 | 1179 | 2 | 78.7% |

Monotone, and each pairing agrees with itself within 0.8 points across the two seat orders.

### Through the shell, not just the rules

The tables above drive `dist/rules.js` directly. Repeating the repo's own
`balance-aggregate.test.ts` protocol against `dist/index.js` — the whole `Game` contract, both
opening seats paired on each seed, frozen idle input:

| tier | seeds × 2 | seat one | draws | unfinished | **opener swung** | distinct | mean match |
| --- | --- | --- | --- | --- | --- | --- | --- |
| easy | 1000 | 50.5% of 999 | 0.1% | 0 | 430 / 500 | 674 | 67.0 s |
| normal | 1000 | 48.8% of 1000 | 0.0% | 0 | 400 / 500 | 511 | 44.1 s |
| hard | 1000 | 51.3% of 996 | 0.4% | 0 | 389 / 500 | 349 | 34.4 s |

The **opener swung** column is the one to look at. That file's own doc comment records that 81 of
93 games ignore `context.openingSeat` entirely, so its alternation "reaches nothing". This game
reads it, and about four seed pairs in five end differently depending on which seat opened.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called through a whole match.

- **Seat one is round and seat two is square, everywhere.** Each counter carries its owner's mark
  and the score pips are circles for p1 and squares for p2. A test asserts a circle is never drawn
  in seat two's colour and a rect never in seat one's, and that **both seats have material on
  screen in every sampled frame** — a turn game whose board belongs wholly to whoever is to move
  cannot be judged for rule 7 at all, and `greyscale.test.ts` reports those as undecided. This one
  is judged: 450 shared frames, and the two signatures differ.
- **The two plates are told apart by outline before either is a colour.** A slice is a rectangle
  with a band down it; a rice ball is a triangle drawn from three lines with a strip of nori
  across its base. They are also different sizes, and the size is the real one — a plate is drawn
  exactly as long as the window it gives you, so what a player learns by watching is the rule.
- Each plate carries its **clean band** drawn at its real width, so what the tiebreak asks for is
  on the belt rather than explained afterwards.
- An **empty plate** is drawn as the plate outline with nothing on it, and it rides all the way
  round, so the denial is a thing you watch coming rather than a rule you are told.
- The **curtains** at both ends of the belt are drawn wide enough to hide a plate, so a plate
  leaving one run and returning on the other is a machine going round rather than something that
  teleported.
- An outcome is a **double ring** for a clean take, a **single ring** for one nicked off the edge,
  and a **cross** for a mistake: three outcomes told apart by shape, held on the board for exactly
  as long as the chopsticks are busy — so the price of a rice ball is visible as the thing it is.
- Points are fifteen pips, the number the match is played to, filled left to right, with a ring
  inside every pip a clean take paid for. That is the tiebreak made visible. A seat past fifteen
  wears a ring on the last pip; a seat below nothing wears a struck-through mark to the left of
  the row, which is the one case fifteen pips cannot hold.
- Rounds left is a bar on the halfway line: one object, shared by both players.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in plates and seconds and imports nothing from `game.ts`;
the only two lengths in it are the logical box, and neither is used. `game.ts` owns the loop, the
palette and the drawing, and reads the simulation without adding to it — a test renders forty
frames and asserts neither the clock nor the press count moved, and another renders the same frame
at two different alphas and asserts an identical stream of draw calls, because this game
interpolates nothing.

1025 lines of rules to 457 of game. The chunk gzips to **4.8 kB** against a 12 kB budget.

## What we did not build from the catalogue row

Every clause is in the game: plates are eaten for points, sashimi scores one and onigiri three,
every mistake costs a point, the first to fifteen wins, and the supply is one supply that both
players draw from.

Three clauses were *interpreted*, and all three are flagged in the code:

- **"Eat all before your opponent"** is a belt that can be *stripped*, not one that can be
  *emptied*. A plate you take is missing when it reaches the other counter and the chef has
  replaced it three quarters of a lap later. A literally exhaustible belt was considered and not
  built: it decays into two people grabbing at bare belt and losing a point each time, which is
  precisely the stall this row's scoring already invites, and it would have made the endgame the
  worst part of the match. **[ours]**
- **"For every mistake you lose a point"** — the row does not say what a mistake *is*. Ours is
  the chopsticks closing on bare belt, which is the only mistake a game whose sole control is a
  press can have. We did **not** put anything inedible on the belt: the row names no bad food, and
  a wasabi plate would have turned a timing game into a recognition game. **[ours]**
- **The score has no floor.** A floor at zero would make mistakes free once a player was on
  nothing, which is a strategy rather than a rule. **[ours]**

The row is silent on what happens if nobody reaches fifteen, and on a level score. Both are ours:
the 34-round cap resolved through the SDK helper's `timeExpired`, and the clean-take tiebreak.

Nothing was dropped for fairness. Unlike Cup Pong, which had to give up the reference's swipe,
this row named no control scheme at all, so the fair idiom cost nothing.

## For whoever picks this up

- **Done.** This game used to be listed in a `SCAFFOLDS` allowlist in
  `apps/web/src/data/balance-aggregate.test.ts`, so that harness skipped it. There is no such
  list any more — the skip is computed from measurement — and this game is swept like every
  other, landing where the table above says. `OPENER_BLIND` is now 0 over 45 turn games and
  keys on whether a game opens with the nominated seat rather than on whether its outcomes
  swing; this game reads `context.openingSeat`, opens with it, and swings on it as well.
- It is **not** on the skip lists in `greyscale.test.ts` or `presentation-parity.test.ts`, and it
  passes both as shipped.
