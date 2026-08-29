# Golf Football — specification

**Archetype:** `turn-aim` · **Category:** Sports · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 60 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions and
> distinguishes them from what the observed rule dictates. Every number below was measured
> against the compiled `dist/rules.js` with the harness in
> `/tmp/…/scratchpad/{gf,record,probe*}.mjs`; none of it is remembered or hoped for.

A patch of turf with a cup at the middle of it and two posts standing either side, so the cup
sits in a goal mouth. Each seat owns a ball. On your turn you kick **your own ball** from
wherever it lies: a needle sweeps across the line to the cup and your press keeps it, then a
gauge fills while you hold and your release kicks. Put it in the cup and you score — three
from range, two from the middle distance, one from a tap-in. Nine kicks each; the higher
score takes the match.

## Observed rules

> Score points by shooting the ball into the hole. Find the right angle and the right power.
> The longer you press, the stronger the shot.

Three sentences, and all three decide something: the scoring is holing out, the two dials are
an angle and a power, and — unusually for this catalogue — **the power is already named as a
press length rather than a drag**. All of that is built.

What the row leaves open is everything else: how many holes, whether there is one ball or two,
whether the two players interact at all, what "the angle" is a dial *of*, and what happens
when nobody is holing out. Those are the decisions below.

## The one thing built beyond the row: both balls are on the pitch **[ours]**

The row describes a solitaire. Two people taking turns at a solitaire is two solitaires, so
one thing was added and it is the only mechanical addition: **the two balls collide, and a
ball in the cup is a point for the player it belongs to, whoever put it there.**

That single sentence is what makes it a duel. Shoving the other ball out of the goal mouth is
the obvious move and it has a price — shove it *in* and you have handed them the goal. It is
also what makes the near miss cost something, because a ball left sitting in the mouth is
both a cheap goal for you next turn and a thing your opponent can take away.

Mini Golf, the closest game in the catalogue, deliberately does the opposite: its two balls
never touch, "exactly as they do not on a real green". This is the other choice, made
deliberately, and it is what stops the two games being one game twice.

## Both dials are moments **[ours]**

`docs/input-parity.md` rules `turn-aim` fair cross-device *given* the precision envelope, and
`docs/input-idiom.md` splits the archetype in two: the drag-and-release games that ask
*where*, and the tap-a-meter games that ask *when*. This is the second kind, and it is that
kind all the way through.

**The power is a press length, and the row already says so.** A press length is counted in
simulation steps — `docs/input-parity.md`'s own rule for hold timing — so a device at 30 fps
and one at 144 fps agree on how long a hold lasted. It is the same quantity on a phone, a
trackpad and a keyboard.

**The angle is a moment too, and that is ours.** The row says "find the right angle", and the
obvious reading is a pointer angle. That would hand a mouse an aim a thumb cannot match: an
absolute pointer angle is exactly the sub-pixel advantage the envelope exists to level, and
levelling it to the coarsest family would make the aim coarse for everybody. Cup Pong's answer
was a sweeping needle stopped by a press, and it is the right answer here for the same reason.
So: **a needle sweeps across the arc, and the press-down keeps it.**

The result is one gesture with two moments — press to keep the line, hold to build the weight,
release to kick — and **the pointer's position is never read anywhere in this game**. There is
no `toWorld`, no drag origin, no deadzone, no tap radius. `game.ts` reads `actionPressed` and
`actionReleased` and nothing else, and a test drives the identical kick through a key and
through a finger and requires the same velocity to the bit.

Three consequences worth stating:

- **The precision envelope has nothing to level here.** It quantises pointer positions, and
  this game has none.
- **It is not the same game as Cup Pong.** There, two discrete presses set two spatial
  needles. Here one press sets a spatial needle and the *duration after it* sets the weight,
  which is the row's own idiom and reads as winding up a kick rather than as reading a second
  gauge.
- **The `turn-aim`/timing constraint is satisfied with room.** `docs/input-idiom.md` allows a
  timing game at most one committing press per turn and requires a meter period of at least
  1.2 s so that 30 ms of device latency is under 3% of the window. One gesture per turn; the
  needle takes **1.22 s** to cross and **2.44 s** for a full period, putting 30 ms at 2.5%.

**Cross-device: fair.** Nothing in this game binds to pointer velocity, pointer position, or
drag length, which are the three things `docs/input-parity.md` and `docs/input-idiom.md`
identify as unlevel. `sameInputClassOnly` is false and does not need to be true.

## The ready pause is in the rules, not in the shell **[ours]**

The shell turns the pitch to face whoever is kicking and refuses a person's input for the
0.36 s that takes. **A bot does not go through the shell**, so without a freeze it would get
that third of a second of free needle. It is worth a lot here: the needle starts parked at one
end of its sweep and covers 0.9 rad a second, so 0.36 s is 0.324 rad — **29% of the whole
gauge**, and every line from the left limit to nearly the middle. A person who had to wait the
flip out would find all of that gone on the first pass and would wait 1.2 s more for the
needle to come back.

`READY_SECONDS = 0.5` freezes both dials for both of them, in the simulation. The margin is
real rather than nominal: the flip starts one step after the hand-over that starts the freeze,
so the freeze outlasts it by about seven frames, and a test measures the frozen steps rather
than trusting the arithmetic.

It cannot live in `game.ts` instead. `seatView` reports **no rotation at all** in single-seat
play, so a freeze keyed off the flip would step one match on a shared phone and a different
one on two phones playing remotely.

**It buys a stronger parity property than it was put in for.** Because every press the flip
would have swallowed lands in the freeze and is refused by the rules in *both* presentations,
the two arms agree under a **raw ungated storm on both keyboard halves** — no settle gate, no
waiting for the pitch. `game.test.ts` asserts exactly that, comparing score, winner, active
seat, kick count and RNG draw count on every step of a 200-second storm.

## The turf is a constant deceleration, and the step is its exact integral

Issue #2465 and commit b4af006: a game that steps `x += v·dt` and then decays `v`, while its
bot computes the stopping distance from the analytic integral, is a bot permanently aiming at
a different world from the one it plays in. Five games carried it.

This game takes Mini Golf's model — **constant deceleration, `d = v² / 2a` exactly** — and the
per-step travel is written as `(v − ½a·dt)·dt`, with the final partial step covering exactly
the `v² / 2a` the ball has left. Three things follow, and they are the reason the choice
matters rather than being a matter of taste:

- **`reachOf` and `powerForReach` are exact inverses through the same constant.** A kick asked
  to roll 590 units rolls 590.0000000000 — measured error 1.1 × 10⁻¹³ across six distances.
- **`CAPTURE_OVERRUN` is that law read backwards.** A ball drops if and only if it is over the
  cup and moving no faster than `CAPTURE_SPEED`, and under a constant deceleration that is
  exactly "has at most 47.6 units of turf left in it". So "how far past the cup may I aim" has
  an exact answer, the same one for a player and for the bot.
- **The settle has a bound that can be written down.** Nothing on the pitch adds energy — a
  board keeps 0.62 of one component, a post 0.5, and an equal-mass contact with restitution
  0.9 can only lose — so no ball exceeds `KICK_MAX_SPEED`, and every ball loses
  `TURF_FRICTION` of speed a second: `859.77 / 420 = 2.047 s`. Measured worst over a full
  ladder of matches: **1.883 s**. The belt-and-braces `MAX_ROLL_SECONDS = 4` therefore never
  fires.

### Step-size invariance, measured

The same kick stepped at 60, 90, 120 and 240 Hz, on four clean rolls with no board, post or
ball in the way. The figure is the displacement from the 60 Hz answer, in logical units:

| kick | 90 Hz | 120 Hz | 240 Hz |
|---|---|---|---|
| 300 units due east | 6.8 × 10⁻¹³ | 5.7 × 10⁻¹⁴ | 2.8 × 10⁻¹³ |
| 520 units due north | 8.5 × 10⁻¹³ | 2.3 × 10⁻¹³ | 6.8 × 10⁻¹³ |
| 440 units at 0.62 rad | 1.8 × 10⁻¹³ | 1.3 × 10⁻¹³ | 3.1 × 10⁻¹³ |
| 560 units at −2.4 rad | 1.2 × 10⁻¹² | 2.6 × 10⁻¹³ | 5.4 × 10⁻¹³ |

Worst 1.2 × 10⁻¹² units, which is eleven orders of magnitude inside the nine decimal places
the suite asserts. `rules.test.ts` runs all four cases at all four rates.

The invariance is exact only for a **clean** roll, and that is a real limitation rather than a
test artefact: a bounce happens on whichever step the ball crosses the board, and that step
moves with the rate. A full-power kick that banks off a cushion lands 0.8 units apart at 60 Hz
and 240 Hz. Nothing in the game depends on it — the fixed timestep is 60 Hz everywhere and the
bot never plans a bank — but the honest statement is "the distance law is rate-independent",
not "the whole simulation is".

## The pitch

| | Value | Why |
|---|---|---|
| Board | 700 × 1000 | |
| Pitch | x 40–660, y 130–870 | Centred on (350, 500), which is what `pushRotation` turns about |
| Cup | (350, 500), radius **20** | The board centre, so the half-turn maps it to itself |
| Posts | (292, 500) and (408, 500), radius 16 | A rotationally symmetric pair |
| Ball | radius 13 | |
| Gate | half-width **29** clear of both posts | Cup radius 20, so 9 units either side thread it and miss |
| Kick-off spots | (200, 780) and (500, 220) | Exact half-turns of each other; 317.65 from the cup |
| Turf | 420 units/s² **constant** | `d = v² / 2a`, exactly |
| Weight gauge | 55 to 880 units, filling in 1.6 s | Linear in **distance**, not in speed |
| Fastest kick | 859.77 units/s | Exactly the speed that rolls 880 |
| Capture speed | 200 units/s = **47.6 units of overrun** | Batter it and it rides the lip |
| Board bounce | 0.62 | Enough to bank, little enough to punish |
| Post bounce | 0.5 | A post is dead wood |
| Ball bounce | 0.9 | Nearly elastic, so a clearance carries |
| Aim needle | ±0.55 rad at 0.9 rad/s | 1.22 s a crossing, 2.44 s a period |
| Ready freeze | 0.5 s | Longer than the shell's 0.36 s flip |
| Aim deadline | 3.2 s | A sweep and a half, then the line is taken |
| Wind deadline | 1.95 s | The fill plus a beat at the top |
| Settle | 0.45 s | |
| Match | **9 kicks each**, alternating from `openingSeat` | |
| Apron / range rings | 110 and 260 | The three goal values |

### The weight gauge is linear in distance, not in speed

A gauge linear in speed puts three quarters of its travel in the last quarter of the pitch,
because distance goes as the square of speed. A tenth of a second of press error near the
bottom would then be worth almost nothing and near the top a hundred units, and a difficulty
ladder built on press error would have no single place to stand. Linear in distance it is 516
units of turf a second wherever on the gauge the press lands.

### Where the ladder lives, and the lattice under it

The quantity that decides everything is **how many seconds of press error the target is
worth**, on each dial, at the 317.65 units from a kick-off spot to the cup:

| dial | tolerance | in seconds | lattice | steps across it |
|---|---|---|---|---|
| the needle | cup radius 20 | **0.070 s** | 4.76 units a frame | 8.4 |
| the gauge | window [−20, +47.6] | **0.066 s** either side | 8.59 units a frame | 7.9 |

The two are within 6% of each other on purpose: neither press is the one that decides
everything. And both lattices are finer than their target, which is the failure Cup Pong
documented — a needle can only be stopped on a whole frame, so if the grid were coarser than
the cup then whether a kick went in would be decided by where the lattice happened to fall
rather than by the press. Eight steps is where Cup Pong found that stops mattering.

**The first geometry was three times too generous and `hard` saturated.** With a 26-unit cup
and a 300 units/s capture speed the needle tolerance was 0.091 s against a `hard` tier of
0.095 s — a ratio of 1.05, where a triangular error is inside the mouth 99.8% of the time.
Measured, `hard` scored **17.5 points of a possible 18** and holed out on 8.7 of its 9 kicks,
and 76.5% of `hard`-versus-`hard` matches were draws. That is the Sudoku failure the brief
names: a duel nobody can lose. The cup went from 26 to 20 and the capture speed from 300 to
200, which moved the ratio to 1.8 and the score to 14.9 of 27.

## Scoring, and the tiebreak that had to be continuous

A goal is worth **3** from outside 260 units, **2** from outside 110, and **1** from inside
the apron — valued by where the ball stood when the kick was taken, so a ball knocked in by
the other player is valued from *its* lie and not from theirs. Holing out puts the ball back
on its own spot, 317.65 units out, so consecutive goals are worth three each and a tap-in
cannot be farmed: kicking away to manufacture a dearer goal costs the extra kick it earns.

Level on points, the tiebreak is **more goals from range**, then **the summed distance those
goals were holed from**, then a draw. Every level of it says the same thing in finer terms —
the same score off longer goals wins — and every level is **time-symmetric**, which is what
ruled out the tiebreak this game wanted to have.

### The tiebreak this game wanted, and why it is not here

"Level on points, whose ball finished nearer the cup" is a real golf idea, it almost never
ties, and it is a legible thing to draw. It is also **not time-symmetric**: the seats kick
strictly alternately, so one of them always kicks last, and the last kick would decide every
level match. That is a first-mover effect built into the scoring rather than into the
structure, and `openingSeat` alternation would not wash it out within a match.

### What the tiebreaks actually resolve, measured

1000 matches a tier, both opening seats, equal skill:

| | level on points | still level after the range-goal count | still level after the summed range |
|---|---|---|---|
| easy | 9.9% | 8.1% | **0.10%** |
| normal | 8.7% | 7.3% | **0.00%** |
| hard | 15.5% | 15.3% | **0.00%** |

**The middle column is the finding.** The counted tiebreak is very nearly the score again:
with `p = 3a + 2b + c` fixed, `a` is pinned by the same arithmetic that pins `p` far more
often than it looks as though it should be, so at `hard` it resolves 15.5% to 15.3% — two
matches in a thousand. An earlier two-tier score with a two-tier tiebreak was worse still, at
14.8% to 14.6%. The summed range is the continuous form of the same idea and it is what does
the work. The count is kept above it because it is the level a player can read off the
scoreboard and play for.

## Termination

Structural. **Nine kicks each**, alternating strictly from `openingSeat`, and nothing about
how the match is played can add or remove one — no lead-by, no first-to, no clock.
`roundSeconds` ends nothing; it prints "about 1 min" on a catalogue card.

Three things underneath it, each with its own test:

- A kick settles in at most 2.047 s, proven from the friction model and measured at 1.883 s.
- Neither press is required. If nobody ever presses, the aim deadline takes the line where the
  needle happens to be and the wind deadline kicks at whatever the gauge has reached, so a
  match with **no input and no bots at all** runs to a decision. That is what
  `input-fuzz.test.ts` needs, and a test plays exactly that match.
- `easy` versus `easy` — the weakest pairing, the one that finds positions nothing resolves —
  finishes in a mean of **52.4 s** and a worst of **60.7 s** over 2000 matches, against the
  ten simulated minutes `termination.test.ts` allows.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `Space` | `Enter` |
| Pointer | press anywhere | press anywhere |

Press to keep the line, keep holding to build the kick, release to shoot. Only on your own
turn, and never during the ready freeze or while the pitch is part-way through its half-turn.
A press and a release on the same step — an ordinary tap on most devices — is a legal kick,
the feeblest there is at 55 units of turf. Refusing it would make a tap mean nothing on the
one input the whole game is built out of.

## The bot

| Tier | Press error | Overshoot | Fumbles |
|---|---|---|---|
| easy | ±0.26 s | 66 units | 20% |
| normal | ±0.18 s | 44 units | 9% |
| hard | ±0.126 s | 28 units | 3% |

It reads the ball, the cup, the two posts and the other ball — all of it drawn on the screen
in front of a person, per rule 6 — and does what a player does with the same picture: it looks
along every line the needle can stop on, discards the ones that run into a post or into the
other ball before they reach the cup, and takes the one that passes nearest the middle. The
weight is the distance along that line to the cup plus the tier's overshoot, converted through
`powerForReach`, which is the exact inverse of the law `step` integrates.

Five things about it are load-bearing.

**It counts down to a moment; it does not watch for a position.** Watching for a position is
the obvious way to write this and it hangs: the error is added in whichever direction the
needle is currently travelling, so an error larger than the gauge is out of reach *both* ways —
the needle turns round at the end of its sweep and the wanted value turns round with it, and
the two never meet. Cup Pong went into exactly that on seed 2 of its very first harness run. A
countdown cannot fail to expire, and it is the more honest model: a person commits to a moment,
and pressing late enough that the needle has turned round is a real way to miss. A test drives
200 random pitches and requires a kick inside the deadlines every time.

**Its two wants are two fields.** `wantAim` is a needle offset in radians and `wantPower` is a
gauge fraction; one shared `want` between two presses is how Cup Pong's second dial came to be
stopped at the first one's number. Both are cleared on the press that consumes them, and a
`stage` is the other half of the guard.

**It ranks its lines in its own frame, and the samples are exactly antisymmetric.** The lines
are generated as `(i − 30) · step` rather than `−sweep + i · step`, so the sample at `30 − k`
is the **exact negation** of the one at `30 + k`. That is not pedantry. A ball on the centre
line has two identical ways past the posts, so a tie between `+φ` and `−φ` is an everyday
event rather than a measure-zero one — and a tie broken by a last-bit difference is precisely
the mirror-symmetry defect Snowball Throw shipped. Exact negation makes the tie exact, the
first index takes it, and both seats therefore choose mirrored lines.

**It plans no bank shots.** If nothing is clear it plays the straightest line anyway and takes
what the carom gives it, which is what a player does. A bot that could aim a rebound off a
board would be reading something a person has to guess at, which is rule 6.

**A generator per seat, and exactly six draws a kick**, taken unconditionally before anything
branches. In this game the two seats are genuinely coupled — a kick moves the other ball — so
this is not the insurance it is in Cup Pong: one shared stream would make a seat's randomness
a function of how many kicks the match had taken, and a `normal` bot would be a different
`normal` bot depending on who it was playing. A test asserts that seat one's opening kick is
bit-identical against an `easy` opponent and against a `hard` one, over forty seeds.

### The press error is triangular, and here is what that is worth

Two draws a dial, summed. Measured at `hard` with the shipped geometry, the share of kicks
holed:

| press error | flat | triangular (**shipped**) |
|---|---|---|
| 0.05 s | 97.4% | 97.5% |
| 0.08 s | 73.7% | 91.3% |
| **0.126 s** | 51.1% | **65.9%** |
| **0.18 s** | 40.5% | **54.2%** |
| **0.26 s** | 27.5% | **40.8%** |
| 0.40 s | 18.6% | 28.2% |

**Being honest about this, because the answer was smaller than expected.** Cup Pong reports a
flat error leaving its ladder nowhere to stand; on this pitch a flat error of the same
half-width still spreads 51.1% to 27.5% across the three shipped tiers, which is a workable
ladder. Triangular is kept because it is the truer model of a person — mostly close,
occasionally nowhere near — and because it puts the tiers on a flatter part of the curve, not
because the alternative was unusable.

### Every knob, swept alone

Each knob moved at `hard` with everything else left as shipped. Win rate is against an
untouched `normal` over 480 matches (120 seeds × two chairs × two opening seats); make rate is
the share of kicks holed at equal skill.

| `hard` press error | win vs `normal` | make rate |
|---|---|---|
| 0.06 s | 98.1% | 97.0% |
| 0.09 s | 95.8% | 84.8% |
| **0.126 s (shipped)** | **82.9%** | **66.5%** |
| 0.17 s | 62.9% | 55.7% |
| 0.24 s | 39.8% | 45.4% |
| 0.34 s | 20.6% | 33.5% |
| 0.50 s | 11.7% | 22.4% |

| `hard` fumble rate | win vs `normal` | make rate |
|---|---|---|
| 0 | 84.6% | 68.0% |
| **0.03 (shipped)** | **82.9%** | **66.5%** |
| 0.08 | 80.4% | 65.7% |
| 0.16 | 74.0% | 60.7% |
| 0.30 | 63.3% | 54.4% |
| 0.50 | 49.2% | 46.5% |
| 0.80 | 24.0% | 32.0% |

Both are strictly monotone across their whole range. The third is not, and it is the
interesting one:

| `hard` overshoot | win vs `normal` | make rate |
|---|---|---|
| 10 units | 74.8% | 70.4% |
| 20 units | 78.5% | 70.4% |
| **28 units (shipped)** | **82.9%** | **66.5%** |
| 36 units | 84.4% | 62.4% |
| 44 units | 77.9% | 59.6% |
| 56 units | 68.3% | 47.0% |
| 70 units | 46.5% | 36.1% |
| 110 units | 6.3% | 7.8% |

**`overshoot` has an interior optimum, and that is forced by the game rather than a defect.**
The make rate falls monotonically as the overshoot grows, but the win rate does not, because a
kick that dies *short* leaves the ball inside the apron where the recovery is worth one point
instead of three. Aiming to die a little past the cup is genuinely the best play, and the
optimum is a broad plateau: 20, 28 and 36 units are within one standard error of each other.

That makes it a knob whose tiers must all sit on **one** side of the peak, and they do —
28 / 44 / 66 is monotone, 82.9% → 77.9% → about 50%. `easy` at 66 is deliberately over the
47.6-unit line at which a ball still drops: it batters the ball at the goal and it runs
through, which is what a bad player does. `hard` sits at 28 rather than at the plateau's
measured maximum of 36 because 28 holes out more often (66.5% against 62.4%) at the same win
rate, and a strong bot that misses less is the more convincing strong bot.

**An earlier tuning had this knob backwards across the ladder** — 55 / 30 / 14, with `normal`
sitting on the peak and `hard` on the wrong side of it, so on this axis alone `hard` was worse
than `normal`. Nothing else in the measurement showed it; the sweep did.

**No knob was deleted.** All three are monotone across the shipped triple and each contributes:
press error is worth about 70 points of win rate over its range, overshoot about 78, fumbles
about 60.

### Solo, per tier

Kicks holed, at equal skill, over 2000 matches a tier (18 000 kicks a tier):

| Tier | kicks holed | kicks from range holed | range goals as a share of goals |
|---|---|---|---|
| easy | 29.8% | 20.4% | 27.7% |
| normal | 47.7% | 36.7% | 42.3% |
| hard | 67.4% | 60.3% | 64.2% |

Nothing saturates: `hard` scores 13.4 points of a possible 27 and holes out on two kicks in
three, so there is a great deal of room above it.

### Balance, 400 seeds a pairing (1600 matches)

Cross tier, both chairs and both opening seats:

| | stronger tier's share of decided | draws | points |
|---|---|---|---|
| hard v easy | **94.4%** (1511/89) | 0 | 13.53 / 4.84 |
| normal v easy | **78.6%** (1257/343) | 0 | 8.14 / 4.69 |
| hard v normal | **81.3%** (1301/299) | 0 | 13.44 / 8.44 |

Split by chair, so the tier number is a tier number and not a chair number:

| | as seat one | as seat two |
|---|---|---|
| hard v easy | 93.9% | 95.0% |
| normal v easy | 79.3% | 77.9% |
| hard v normal | 80.3% | 82.4% |

Every pairing agrees with itself within 2.1 points across the two chairs.

### Equal skill: the seat, 1000 seeds × 2 opening seats = 2000 matches a tier

| | seat one | seat two | draws | **seat one's share of decided** | opener p1 | opener p2 |
|---|---|---|---|---|---|---|
| easy v easy | 1026 | 972 | 2 | **51.4%** | 53.3% | 49.4% |
| normal v normal | 991 | 1009 | 0 | **49.5%** | 49.8% | 49.3% |
| hard v hard | 962 | 1038 | 0 | **48.1%** | 50.1% | 46.1% |

One standard error is 1.12 points, so every tier is inside 1.7σ of a coin toss and all three
are comfortably inside the 45–55 band `apps/web/src/data/balance-aggregate.test.ts` asserts.
The 2000 matches a tier produced 1944, 1950 and 1872 **distinct** outcomes, so the seed is
genuinely varying the match rather than replaying one.

**The shipped lean is the stream assignment, and it reverses exactly when the streams do.**
`createBotRngs` derives two generators from the match seed and hands the first to seat one.
Swapping which seat gets which:

| | shipped | streams swapped |
|---|---|---|
| easy | 51.4% (1026/972) | 48.6% (971/1027) |
| normal | 49.5% (991/1009) | 50.4% (1009/991) |
| hard | 48.1% (962/1038) | 51.9% (1038/962) |

Every row reverses to within two matches in two thousand. That is as strong a statement of
seat symmetry as this harness can make: **the game itself has no seat preference at all**, and
what the table above measures is which of two arbitrary seeds each chair was handed.

**The opening seat is worth about two points, and it washes out.** Reading the last two columns
as the opener's own share: 53.3% and 50.6% at `easy`, 49.8% and 50.7% at `normal`, 50.1% and
53.9% at `hard` — an opener edge of about 2 points at the outer tiers and none at `normal`,
against a 1.6-point standard error per cell. It is real and small, and it has an obvious
source: seat one kicks first from an untouched lie, and can spoil seat two's before seat two
has kicked at all. `GameContext.openingSeat` alternates across the rounds of a best-of, which
is exactly what it exists for, and this game reads it — `balance-aggregate.test.ts` confirms
golf-football is **not** among the 81 games whose matches are unchanged by it.

### Mirror symmetry

Two tests, and they are the ones that would have caught Snowball Throw:

- **The physics.** 400 random pitches — a third of them aimed at the cup with a plausible
  weight, a third with the other ball squarely on the line — turned half round with the seats
  swapped, kicked with the turned kick, and required to settle at the turned positions to nine
  decimals with the same goals scored. Guarded against vacuity: at least 20 of the 400 had to
  hole out and at least 20 had to move the other ball.
- **The decision.** 400 random pitches through `planKick` at all three tiers, requiring the
  turned seat to choose the **exactly equal** line offset and press moment. A bot that ranked
  its lines in board coordinates would pass the physics test and still hand one seat the
  easier way round a post.

The equal-mass contact is written so that swapping its two arguments gives the identical
result, and the half-turn maps the pitch, the cup, both posts and both spots onto themselves —
the spots exactly, in floating point, which is what the mirror argument rests on.

## Rule 7: never colour alone

- **Seat one's ball carries a ring and seat two's a cross.** The same mark appears on that
  seat's row of the scoreboard, so the row and the ball are the same player without reading a
  colour. A test collects every drawn glyph by seat over a whole match and requires each seat
  to have a shape the other lacks.
- **The turn is marked in ink, never in a seat colour.** The ball to be kicked wears a white
  halo. Drawn in the seat's own palette it would be a rule 7 signal present in only half the
  frames, which is not something a player can navigate by — and the turn indicator is the
  shell's job in any case. A test asserts each seat's count of seat-coloured marks is the same
  in every frame of a match: four for seat one, six for seat two.
- **The apron ring is drawn at its real radius**, so what the scoring asks for is on the pitch
  rather than explained afterwards.
- **The needle's zero is drawn.** A faint line runs from the ball to the cup while the dials
  are live, because the needle sweeps around the line to the cup and a gauge with an invisible
  zero is a gauge a player has to imagine.
- **The turn deadline is drawn.** Both deadlines are backstops rather than a shot clock — they
  exist so that a match moves with nobody touching the device, which `input-fuzz.test.ts`
  requires — but a deadline that fired invisibly would take a person's kick away without
  warning. A bar on the kicker's own edge runs down through the sweep and again through the
  fill. Nothing reads it back; it is presentation over simulation state.
- The mown stripes are drawn symmetrically about the centre, so the two seats read the same
  ground for the identical position.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation — including the turn state machine — in logical units
and imports nothing from `game.ts`. `game.ts` owns the seat flip, the palette and the drawing,
and adds nothing to the simulation: a test renders at two alphas and requires the identical
frame and an untouched state.

## What was not built from the row, and what is known to be missing

- **No pointer aiming.** The row's "find the right angle" is a sweeping needle rather than a
  pointer angle, for the reason argued above. This is the one departure from the row.
- **No course.** Mini Golf has nine holes on one green; this has one goal, played from two
  spots, for nine kicks each. A course would have made the two games the same game with
  different furniture.
- **No bank-shot planning in the bot.** Deliberate — see above.
- **Bounces are not step-size invariant.** The distance law is; a kick that hits a board is
  not. Nothing depends on it and it is stated above rather than hidden.
- **The 2-point opener edge is measured but not eliminated.** It is inside the noise of 1000
  matches a cell and it is the exact effect `openingSeat` alternation exists to wash out.
