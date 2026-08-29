# Explosive Festival — specification

**Archetype:** `rt-arena` · **Category:** Arena · **Logical box:** 800 × 800 ·
**Zone split:** horizontal · **Round length:** 30 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured with `/tmp/ef-*.mjs` against `dist/rules.js`.

One festival ground with a row of paper lanterns in each half of it. Each seat has a firework
cart that rolls along its own edge and a rocket whose fuse is already lit. Press and the cart
stops, keeping the **column** the rocket goes up; a sight then runs out from the cart along
that column, and letting go keeps the **distance** and fires. A rocket bursts where it comes
down and puts out any lantern inside the blast — including one of your own. Fourteen rockets
each, and the most of the other side's nine lanterns wins.

## Observed rules

From the catalogue row: _"Hit your opponent's side of the screen! Press to fire your rocket!"_

Everything in that sentence is built. The press **is** the whole control — there is no drag,
no steering and nothing to point at — and hitting the opponent's side is the whole score.
What the row does not say is what makes hitting their side hard, and that is the part we had
to design: a field of lanterns to hit rather than a half-screen to hit.

What we did **not** build from the row: nothing. The row names no scoring detail, no round
length and no control beyond the press, so there is no observed rule left on the floor.

## The control is a press with no position at all **[ours]**

Not a point, not a drag. Press, then let go.

**Absolute pointing is broken in this archetype and we did not want to ship the fifth
instance of it.** `GameHost` gives every `rt-*` game two pointer zones, so a thumb only ever
*starts* in its own half of the device — and four shipped games in this archetype (`sumo`,
`spin-war`, `dung-battle`, `king-of-the-yard`) steer by pointing at a spot in a shared arena,
which leaves the far half of that arena unreachable for one of the two seats. Two of those
four describe a relative gesture in their manifest that their code does not implement.

A press has no coordinates for a zone to withhold. Every column on the ground, every distance
on the gauge, is expressed from anywhere inside a seat's own half — a test asserts that a
touch in the far corner of seat one's zone produces the byte-identical rocket to a touch in
the near corner. A relative drag would also have been reachable; a press is reachable *and*
identical on a key, a trackpad and a thumb, which a drag is not.

That is the second reason. A drag hands a thumb a continuous quantity a key cannot match, and
rule 10 says one build serves every device. A press and a release are two binary events with
timestamps, and no instrument can place them more finely than another. `setHold` takes one
boolean per seat per step and there is nothing else to read; the parity test in `game.test.ts`
is an *equality* rather than a tolerance because there is no gesture either instrument can
make that the other cannot.

**A tap that begins and ends inside one frame is still a shot.** The engine reports it as
`actionPressed` and `actionReleased` with `actionHeld` never true — which is most taps on a
touchscreen. Folding `actionPressed` in beside `actionHeld` turns it into a press and a
release one step apart, which is a rocket dropped at your own feet. That is a rule somebody
can learn; "the game ignored me" is not.

## The two dials are drawn as the shot, not as gauges

The first press stops the cart, so the **cart itself** is the column dial — there is no gauge
to read. The second dial is a ring running out along that column at the real blast radius, so
what the release is choosing is literally the circle that will be cleared. Nothing anywhere
on the ground has to be translated into a position, and there is no text in the game at all.

One sweep rate for both, `SWEEP_RATE = 660`, and that is deliberate rather than tidy: it makes
the error a **circle**. A press late by `t` seconds misses the column by `660t` and a release
late by `t` misses the distance by exactly the same, so the two halves of a shot cost the same
and neither is the one worth practising.

## A short rocket lands on your own lanterns **[ours]**

The distance gauge runs from 280 to 680 units out from your own rail, and the bottom of it is
in your own half:

| landing row | distance window that reaches it |
|---|---|
| **your own front row** (y 450 from seat one) | **265 – 355** |
| their near row (y 350) | 365 – 455 |
| their middle row (y 250) | 465 – 555 |
| their far row (y 150) | 565 – 655 |

Ten units of gauge — 0.015 seconds — separate the top of your own front rank from the bottom
of their nearest. Undershoot their front row and you put out your own, and a lantern that goes
out scores for whoever does *not* own it, whoever fired the rocket. The gauge starts at 280
each time, so a rocket nobody aims at all comes down at your own feet.

It is a live rule and not scenery, and the measurement that shows it is the bot's target
choice, below.

## Both carts always empty, and nothing is decided in mid-air **[ours]**

Every match is fourteen rockets each. Clearing the other side's field does not end it on the
spot — it only means your score cannot go higher — and the match is decided when both stocks
are spent *and* the sky is clear.

Being exact about what that rule does, because it is nearly nothing at the shipped size. Built
the other way — `first-to` on the lantern count, ending the instant a field is cleared — the
two endings agree to a tenth of a point on every tier and to one match on the draw counts over
1500 seeds a pairing. At nine lanterns a field is cleared in 18% of `hard` matches and almost
always on the last rocket or two.

What it buys is a property rather than a number. Under `first-to` the two seats can stop with
**unequal stocks**, and the seat that aimed faster is simply handed more shots:

| lanterns | easy | normal | hard |
|---|---|---|---|
| 7 | 0.08 unfired, 4% of matches uneven | 0.38, 16% | **2.02 unfired, 51% uneven, 6 at worst** |
| 8 | 0.02, 0% | 0.12, 5% | 0.70, 28% |
| **9 (shipped)** | 0.00, 0% | 0.02, 1% | 0.14, 8% |

700 matches a cell. Nearly inert at nine and severe at seven, which is the shape of every
guard worth keeping: it costs one branch, it is what keeps the property true if the field is
ever made smaller, and it turns "both seats fire exactly fourteen rockets" into something a
test asserts — which is also what makes the termination argument exact rather than bounded.

The second half of the rule, that nothing is decided while a rocket is in the air, is the
real-time form of Cup Pong's completed round: a seat is owed every landing it has coming, so
the match cannot end on the step an opponent's rocket happens to land first. A test walks
every step of a `hard` match and asserts a winner and a rocket in flight never coexist.

## Termination — the fuse

**The match ends because rockets are finite and the fuse spends them whether or not anybody
plays.** A rocket leaves the tube when you let go *or* when its fuse burns out, so a seat that
is never touched still spends one every `RELOAD + FUSE` = 3.95 seconds. `ROCKETS = 14` only
ever decreases, and nothing about how the match is played can add one.

The bound is arithmetic and it was measured from both ends:

| | seconds |
|---|---|
| nobody ever presses | **56.20** |
| both hold their control down from the first frame and never let go | **56.20** |
| longest of 1200 bot matches | 31.83 |
| mean bot match, all nine pairings | 24.0 |

`rules.test.ts` plays both of the first two with **no step ceiling at all**, so a match that
could not finish would hang the suite rather than pass quietly, and it asserts the 56.20 s
figure against `OPENING + ROCKETS * (FUSE + RELOAD) + MIN_RANGE / ROCKET_SPEED` rather than
against a magic number. The platform's own guard allows ten minutes.

**The fuse is not a balance knob, and the measurement says so plainly.** Swept alone at 2.2,
2.8, 3.5, 5 and 8 seconds, `hard` cooks off **0.0% of its rockets at every one of them** and
the ladder does not move by a tenth of a point — a bot's decision is instantaneous and its
longest possible wait is a cart round trip plus a sight crossing, 2.4 s. Only at 1.6 s does it
bite, and then it bites everything: 40.8% cooked off and `hard` over `normal` collapsing from
89.0% to 70.0%. So it is set for the person rather than for the bot: 3.5 s is one full cart
round trip (1.88 s), one sight crossing (0.61 s) and about a second left to decide with.

## The ground

| | Value | Why |
|---|---|---|
| Ground | 800 × 800 | Square, so `orientation: any` is honest |
| Rails | y = 760 and y = 40, x from 90 to 710 | Symmetric under the half-turn |
| Lattice | 7 columns × 3 rows a half, 100 apart | Integer mirroring: cell → `(800 − x, 800 − y)` |
| Lanterns | 9 a seat, dealt from 21 cells | See below |
| Sweep rate | 660 units/s, cart and sight alike | Rail 0.94 s a crossing, gauge 0.61 s |
| Distance gauge | 280 – 680 | Bottom fifth is your own front rank |
| **Blast** | **45** | Under half the lattice spacing: one lantern a rocket |
| Clean burst | within 26 — the lantern's own radius | The score's fine resolution |
| Rockets | 14 a seat | With the fuse, the whole termination argument |
| Fuse / reload | 3.5 s / 0.45 s | 3.95 s a rocket, at worst |
| Opening freeze | 0.6 s | Long enough to read a fresh deal |

### The blast is where the difficulty ladder lives

The quantity that decides everything is **how many seconds of press error the blast is
worth**: `BLAST / SWEEP_RATE`. At 45 over 660 that is 0.068 s — deliberately the figure Cup
Pong arrived at for its mouth, which put its tiers at 0.11 to 0.20 seconds of human error.

Swept alone, everything else as shipped:

| blast | `easy` hits | `hard` hits | `hard` over `normal` | `hard` v `hard` drawn |
|---|---|---|---|---|
| 25 | 14.0% | 36.3% | 86.3% | 11.2% |
| 35 | 22.7% | 53.0% | 87.9% | 5.8% |
| **45 (shipped)** | **33.8%** | **73.0%** | **89.0%** | **5.6%** |
| 55 | 46.8% | 88.1% | 87.6% | 9.6% |
| 70 | 61.5% | 97.2% | 80.4% | 15.6% |
| 90 | 76.1% | 99.1% | 78.1% | 21.6% |

The draw rate is the column to read: worst at both ends, flat between 35 and 45. Too small and
everybody misses everything; too large and everybody hits everything; either way two players
of the same standard finish level.

**It is under half the lattice spacing on purpose**, so no point on the ground is within the
blast of two lanterns: a rocket takes at most one and the score is exact arithmetic rather
than a chain reaction. Raising it past 50 makes a double geometrically possible and still
unhittable — catching two lanterns 100 apart with a 55-unit blast needs the burst inside a
lens 46 units wide, 0.07 s of timing on *both* presses at once — and the sweep above says the
same thing from the balance side: everything at and above 55 is worse.

### Nine lanterns against fourteen rockets

Both seats fire every rocket, so a tier's score is close to its in-match hit rate times
fourteen. `hard` hits 52.1%, which is seven. If the field is smaller than that the score
saturates and two good players end level. 700 seeds a cell, `hard` against itself:

| lanterns \ rockets | 12 | 14 | 16 |
|---|---|---|---|
| 8 | 6.30 of 8, 9.4% drawn | 7.05 of 8, 8.6% | 7.60 of 8, 10.3% |
| **9** | 6.45 of 9, 8.1% | **7.26 of 9, 6.1% drawn** | 8.04 of 9, 7.9% |
| 10 | 6.61 of 10, 7.9% | 7.44 of 10, 6.9% | 8.28 of 10, 7.6% |
| 11 | 6.78 of 11, 6.7% | 7.61 of 11, 6.3% | 8.45 of 11, 5.9% |

At eight, `hard` empties the field in 56% of matches and draws nearly one in ten. Past ten the
draw rate stops improving and emptying the field — the thing the game is nominally about —
stops happening at all. Nine leaves it at 18% of `hard` pairs and 2% of `normal` ones.

## Scoring, and why a clean burst counts for something

Winner is **more of the other side's lanterns out**; level on lanterns, **more clean bursts**;
level on both, a draw. A clean burst is one whose centre came down on the paper — inside the
lantern's own 26-unit radius — rather than merely within the 45-unit blast.

The tiebreak is not decoration, it is the score's resolution. Lanterns out is a number between
nought and nine, and two players of the same standard land on the same one of those ten values
constantly:

| | draws on lanterns alone | draws with the clean-burst tiebreak |
|---|---|---|
| easy v easy | 17.9% | **5.1%** |
| normal v normal | 19.9% | **4.4%** |
| hard v hard | 32.4% | **6.5%** |

2000 seeds a tier. Of the matches that finish level on lanterns, the tiebreak decides 255 of
357 at `easy`, 310 of 398 at `normal` and 517 of 647 at `hard` — it splits about three in four
of them, and a tiebreak that almost never separates anybody is not one. Between 43% and 53% of
everything that hits goes in clean, which is where `CORE = 26` was set.

**The first version of this tiebreak was the observed rule read literally** — count the rockets
that land on the opponent's half at all — and it measured **96.5%, 98.2% and 99.8%** of every
shot fired at the three tiers. Half the ground is theirs; landing on it is not a skill. A
tiebreak everybody saturates separates nobody, and it went.

Both failure modes named in the brief were live at some point here. **Pinning**: at seven
lanterns `hard` cleared the field in four matches out of five and both scores sat on the
ceiling. **Too few distinct values**: the table above is what nine values without a tiebreak
looks like.

## Fairness

**Cross-device: unrestricted.** The only quantity crossing from a person into the simulation
is one boolean a step, and its timing is the whole game. A key press and a thumb-down carry
the same timestamp on every device, the precision envelope has nothing to quantise because no
coordinate is read, and the logical box is the same 800 × 800 everywhere. `sameInputClassOnly`
is false and does not need to be true.

**Rule 9, the camera:** there is no camera. The whole ground is on screen for both seats at
every moment, and it is point-symmetric — rails, lantern deal, cart starting ends and both
distance gauges are one shape half-turned — so neither seat ever sees more of the play area
than the other, and neither has the easier half. A test drives forty deals and asserts every
lantern of seat one's is the exact mirror of one of seat two's, and another asserts the two
carts stay mirror images for twenty seconds of untouched play.

**Both presentations:** `game.ts` never reads `context.presentation` and never pushes a
rotation. The ground reads the same from either side of the device and there is no text to
read upside down, so shared-screen and single-seat are the identical simulation by
construction rather than by care. A test drives the same seed through both and compares.

**Seat symmetry, measured.** Swapping which seat's bot generator is drawn from the match seed
first flips the result exactly: 49.6 / 49.5 / 49.2% to seat one becomes 50.4 / 50.5 / 50.8%
over the same 2000 seeds a tier. That is not a balance measurement, it is a proof that the two
seats are the same code.

### The opening seat

A real-time game has no opener and the contract lets one ignore `context.openingSeat`. This
game reads it anyway: **the opening seat's cart takes the low end of the rail and rolls up it;
the other takes the high end and rolls down.** The two arrangements are exact mirror images, so
which seat gets which provably cannot favour either — every column is reached by one cart
exactly as often as by the other.

That is what makes it the safe thing to hang the opener on, and it is worth hanging something
on: a balance harness that plays each seed from both openers gets the identical match twice
from a game that ignores the value, and cannot separate a seat effect from a seed effect.
Measured over 2000 seed pairs a tier, the two halves of a pair end differently in 15 / 12 / 11
per cent of pairs, and seat one takes 50.0 / 49.9 / 49.0 per cent across both openers.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `Space` | `Enter` |
| Pointer | press anywhere in your own half | press anywhere in your own half |

Press to stop your cart and start the sight; let go to fire. A rocket left on its fuse fires
by itself, at the bottom of the gauge.

## The bot

Three tiers, expressed only as how accurately a tier hits the moment it meant to — which is
the whole of the skill this game asks for. There is nothing to steer, nothing to dodge and
nothing to point at.

| Tier | Press error | Fumbles |
|---|---|---|
| easy | ±0.22 s | 16% |
| normal | ±0.15 s | 8% |
| hard | ±0.10 s | 2% |

Every value is several frames wide, so rule 6 holds by construction: no tier can stop a cart
or a sight more finely than a person can. A tier is two numbers, both of them seconds of human
error, and a test asserts the profile has no third field — nothing in it is a speed, a reach
or a fact about the ground that a player cannot see.

### It counts down to a moment; it does not watch for a position

Watching for a position is the obvious way to write this and it hangs. The error is added in
whichever direction the cart is currently rolling, so an error larger than the rail is out of
reach *both* ways — the cart turns round at the end and the wanted value turns round with it.
`timeToColumn` is closed form and a countdown cannot fail to expire. A test walks every
position and direction on the rail against every target column and asserts the answer is
finite and no longer than one round trip.

The two countdowns are separate fields with a `stage` between them, and each is cleared the
moment it is used. A single `want` shared between press and release is exactly how a sight ends
up stopped at a column's number — 400 units of ground read as 400 units of distance.

### Its press error is triangular, not flat

Two draws a moment, summed. Measured at 3000 shots a point, per cent of rockets landing on a
lantern:

| press error | 0.05 | 0.08 | 0.11 | 0.15 | 0.22 | 0.40 |
|---|---|---|---|---|---|---|
| triangular (**shipped**) | 99.9 | 88.2 | 68.4 | 51.8 | 36.7 | 24.2 |
| flat | 97.7 | 60.8 | 39.6 | 30.1 | 24.1 | 15.7 |

The three shipped tiers sit at 0.10, 0.15 and 0.22 with room either side on the triangular
curve; on the flat one they would be crammed into the twenty points between 45 and 24 per
cent, with a tail that stops moving. It is also the better picture of a person — mostly close,
occasionally nowhere near.

### It takes the nearest enemy lantern, and that measured backwards

Clearing from the back looks correct: overshooting the far row lands on bare ground, while
undershooting the near row lands on your own front rank, so the deep target is the one whose
misses are cheapest. Both rules were built and played head to head at the same tier, 800 seeds
in each seat order, everything else identical:

| | nearest-first's share of decided |
|---|---|
| easy | **45.9%** |
| normal | 61.5% |
| hard | 75.0% |

**A sign change across the ladder**, which is the most interesting number in this file. The two
effects it trades are both on the ground. Aiming at the near lantern puts the *rest of the
enemy field on the far side of the error*, so a shot that goes long often finds something
anyway — played against each other at `hard`, nearest-first wastes 48.0% of its rockets and
deepest-first 54.7%. Aiming short of it puts the shot on your own front rank, and that is the price:
4.5% of `easy` shots against 0.6%, seven times as many. An accurate player rarely pays it and a
poor one pays it constantly.

Nearest-first ships at every tier, because a bot should play the better of two rules rather
than a worse one for tidiness. It is also the clearest evidence available that the danger band
at the bottom of the gauge is a real decision rather than scenery: it is the thing the two
rules are trading, and the trade comes out differently at different standards of play.

**Both terms are ranked in the firing seat's own frame**, and that is not tidiness. Ranking by
board `y` and breaking ties on board `x` sorts the two seats' mirrored lanterns into different
orders, because the ground is point-symmetric between them — and the two ends of a row are the
same shot mirrored but not the same shot from the cart's point of view: one is reached a third
of the way along the rail and the other two thirds. A test drives both seats from a fixed
generator and asserts they choose mirrored columns and identical distances.

### Randomness

**Three streams, all derived from the match seed in a fixed order:** one for the world and one
for each seat.

The world's stream deals the lanterns and nothing else, in exactly `CELLS − 1` = 20 draws
before anything else touches it — so what a pair is dealt is a function of the seed and of
nothing that happens afterwards. On a stream shared with the bots it would not be: a bot draws
six values per rocket, so a different pairing would deal a different festival and a human
against a bot would play in one none of the balance figures were measured in.

Each seat's stream is its own, and each rocket costs **exactly six values, drawn before
anything branches** — the fumble costs the same one roll whether it happens or not. Together
those make the poll order unobservable: `rules.test.ts` plays 25 seeds at each tier with the
two seats polled in both orders and compares the whole `Ground` object bit for bit, and
another test asserts seat two takes the identical fourteen shots against an `easy` opponent
and against a `hard` one.

### Every knob, swept alone

Win rate is against an untouched `normal` over 800 seeds in **each** seat order, averaged; hit
rate is the solo measure at a field that never depletes.

| `hard` press error | win vs `normal` | hits | own lanterns |
|---|---|---|---|
| 0.05 s | 99.9% | 98.6% | 0.23% |
| 0.07 s | 99.1% | 93.4% | 0.23% |
| **0.10 s (shipped)** | **88.7%** | **73.1%** | **0.60%** |
| 0.13 s | 66.8% | 58.1% | 1.97% |
| 0.17 s | 43.7% | 45.7% | 4.23% |
| 0.22 s | 25.5% | 36.4% | 6.77% |
| 0.30 s | 12.0% | 28.6% | 8.97% |
| 0.45 s | 5.8% | 22.2% | 11.33% |

| `hard` fumble rate | win vs `normal` | hits |
|---|---|---|
| 0 | 89.8% | 74.3% |
| **0.02 (shipped)** | **88.7%** | **73.1%** |
| 0.06 | 87.8% | 71.6% |
| 0.12 | 85.6% | 68.5% |
| 0.25 | 78.3% | 61.9% |
| 0.45 | 62.5% | 52.2% |
| 0.80 | 28.8% | 35.3% |

Both are strictly monotone across their whole range. With the other knob flattened to
`normal`'s value for all three tiers, so the tiers differ in one number and nothing else:

| | normal over easy | hard over normal |
|---|---|---|
| both (shipped) | 78.1% | 88.7% |
| timing alone | 76.1% | 86.9% |
| **blunder alone** | **54.7%** | **53.6%** |

**The timing is very nearly the whole ladder, and that is said plainly rather than dressed
up.** The shipped fumble spread of 0.16 against 0.02 is worth about four points of it. Widening
it to 0.30 against 0 makes it a real axis — 61.6% and 55.8% alone — at the cost of a steeper
overall ladder and an `easy` seat that visibly throws rockets away, so it was left where it
is. It is kept at that size for one reason: without it every tier misses in exactly the same
shape and only by different amounts, and a weak player who never does anything *wild* is not a
weak player anybody recognises.

### Solo, per tier, at a field that never depletes

4000 shots a tier, with every lantern restored between shots so nothing can saturate.

| Tier | hits a lantern | on its own lanterns | clean | clean share of hits | cooked off |
|---|---|---|---|---|---|
| easy | 34.4% | 7.80% | 14.9% | 43.3% | 0.0% |
| normal | 49.6% | 3.45% | 22.1% | 44.5% | 0.0% |
| hard | 73.3% | 0.53% | 38.6% | 52.6% | 0.0% |

In a real match the field empties as it goes, so the same measure over 800 matches a tier
reads lower and the self-harm reads lower with it:

| Tier | hits | own lanterns | wasted |
|---|---|---|---|
| easy | 27.9% | 2.9% | 69.3% |
| normal | 39.0% | 0.9% | 60.1% |
| hard | 52.1% | 0.1% | 47.8% |

### Balance, 2000 seeds a pairing

Equal tiers:

| | p1 | p2 | draws | seat-one share of decided | lanterns p1/p2 | field cleared |
|---|---|---|---|---|---|---|
| easy v easy | 941 | 957 | 102 (5.1%) | **49.6%** | 4.32 / 4.28 | 0% |
| normal v normal | 947 | 965 | 88 (4.4%) | **49.5%** | 5.61 / 5.56 | 2% |
| hard v hard | 920 | 950 | 130 (6.5%) | **49.2%** | 7.30 / 7.32 | 18% |

Cross tier, both seat orders:

| | p1 | p2 | draws | stronger tier's share of decided |
|---|---|---|---|---|
| normal as p1 v easy | 1510 | 421 | 69 | 78.2% |
| easy as p1 v normal | 422 | 1503 | 75 | 78.1% |
| hard as p1 v normal | 1739 | 221 | 40 | 88.7% |
| normal as p1 v hard | 227 | 1713 | 60 | 88.3% |
| hard as p1 v easy | 1920 | 60 | 20 | 97.0% |
| easy as p1 v hard | 47 | 1939 | 14 | 97.6% |

Every equal-tier share is inside 45–55%; every pairing is monotone and agrees with itself
within 0.6 points across the two seat orders. A match takes 23.6 to 24.3 seconds of simulated
play, 24.0 across all nine pairings.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called through a whole match, and a
stand-in for `apps/web/src/data/greyscale.test.ts` reports **no glyph shared between the two
seats at all** over 450 frames: every mark seat one owns is a circle and every mark seat two
owns is a rectangle.

- **Seat one is round and seat two is square, everywhere.** Lanterns, carts, rockets in the
  air, the sight's landing mark and the tally pips.
- A lantern that has been put out leaves the same shape behind as a faint outline, so a player
  can see the shape of the row they have already broken.
- Each standing lantern carries a small flame, so a lit one and a dead one differ in what is
  *in* them as well as in how bright they are.
- The sight's ring is drawn **at the real blast radius**, so what a burst covers is something a
  player watches rather than something they are told about afterwards. The burst opens out to
  the same radius.
- The fuse is a mark behind the cart whose **length** is what is left of it. The one thing in
  this game that cannot be waited out is legible without colour and without a number.
- The tally is pips on each seat's own side edge, mirrored between them: **solid** for a
  lantern taken by a burst on the paper, **hollow** for one taken off a burst that was merely
  near enough, **faint** for one still standing. That is the tiebreak made visible — a player
  level on lanterns can see which way it will go.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in ground units and imports nothing from `game.ts`.
`game.ts` owns the drawing and reads the simulation without adding to it — a test renders forty
frames at forty different alphas and asserts the serialised `Ground` is unchanged to the byte.

`alpha` is ignored on purpose. The two things that move fastest are the cart and the sight, and
those are precisely the two things a player is timing a press against; drawing them a fraction
of a step ahead of the state a press would actually read would make the picture lie about the
only decision in the game.

## Budget and shape

`rules.ts` is 1133 lines to `game.ts`'s 384, with 1460 lines of tests beside them. The
bundled chunk is **4.4 KB gzipped** against a 12 KB budget, in line with Cup Pong (3.9 KB)
and Tanks (4.4 KB). No asset files, so nothing to licence.
