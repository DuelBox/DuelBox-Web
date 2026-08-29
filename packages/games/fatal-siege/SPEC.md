# Fatal Siege — specification

**Archetype:** `rt-arena` · **Category:** Arena · **Logical box:** 800 × 800 ·
**Zone split:** horizontal · **Round length:** 34 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and every
> number below was measured against `dist/rules.js` with scripts in the session scratchpad. Where
> a figure is an estimate rather than a measurement it says so.

Two walls, back to back, and the same army marching on both of them. Soldiers come up five roads
towards your wall and never stop. A gun traverses along the wall: **press** and it stops, keeping
the road; **keep holding** and the shot charges further out; **let go** and it fires. A soldier
caught by the blast is smashed, and what it is worth is how far out it was — three deep, two in
the middle, one close in. Anything that gets inside the last ninety units is out of reach and
walks through the gate for nothing. Fourteen soldiers, and the most ground held wins.

## Observed rules

From the catalogue row: _"Don't let the enemy soldiers get close, smash them first! Press at the
right moment and hold to shoot farther!"_

Every clause is built, and the row is unusually specific for this catalogue — it names **two
moments**, not one. "Press at the right moment" is the road; "hold to shoot farther" is the
distance. That is already a complete, instrument-neutral control scheme, and it is the scheme
that shipped.

"Don't let the enemy soldiers get close" is built as the *scoring* rule rather than as a loss
condition: a soldier that gets close is not fatal, it is merely worth one point instead of three,
and inside ninety units it is worth nothing at all because it cannot be reached.

What we did **not** build from the row:

- **No loss on a breach.** The row could be read as "the soldiers reaching your wall ends it".
  It is not built that way, for the reason in *Termination* below — a losing condition either
  player can reach at a different time makes the match length depend on how it is played, and
  the whole termination argument here is that it does not. A breach costs a seat the points it
  did not take and shows as a notch in its wall, and it is the tie-break.
- **No wall health, no upgrades, no waves.** The row names none of them, and each would be a
  second currency competing with ground held.

## The control is two presses with no position at all **[ours]**

Not a point, not a drag. Press, hold, let go.

**Absolute pointing is broken in this archetype and we did not want to ship the fifth instance
of it.** `GameHost` gives every `rt-*` game two pointer zones, so a thumb only ever *starts* in
its own half of the device — and four shipped games in this archetype (`sumo`, `spin-war`,
`dung-battle`, `king-of-the-yard`) steer by pointing at a spot in a shared arena, which leaves
the far half of that arena unreachable for one of the two seats. Explosive Festival argued this
first and this game follows it deliberately rather than inventing a second answer.

A press has no coordinates for a zone to withhold. Every road on the field and every distance in
the charge is expressible from anywhere inside a seat's own half — `game.test.ts` asserts that a
touch in the far corner of seat one's zone produces the byte-identical shot to a touch in the
near corner. A relative drag would also have been reachable; a press is reachable *and* identical
on a key, a trackpad and a thumb, which a drag is not.

**A tap that begins and ends inside one frame is still a shot.** The engine reports it as
`actionPressed` and `actionReleased` with `actionHeld` never true — which is most taps on a
touchscreen. Folding `actionPressed` in beside `actionHeld` turns it into a press and a release
one step apart, which is a shot dropped at the foot of your own wall, ninety units out. That is a
rule somebody can learn; "the game ignored me" is not.

**The precision floor is the step, and it is the same floor for every instrument.** A press can
only land on a fixed step, so the best anybody can do is stop the gun within `TRAVERSE_RATE ·
dt / 2` = **3.75 units** of a road at 60 Hz, against a 40-unit blast. Asserted in
`rules.test.ts`, and it is the honest form of the fairness claim: no instrument aims finer than
another because none of them can aim finer than a frame.

## The two dials are drawn as the shot, not as gauges

The first press stops the gun, so the **gun itself** is the road dial — there is no gauge to
read. The second dial is a ring running out along that road **at the real blast radius**, so what
the release is choosing is literally the circle that will be cleared. A player runs the ring out
until it sits on a soldier and lets go. There is no text in the game at all.

## The charge is an accelerating integrator, and that is the whole difficulty curve **[ours]**

`range += v·dt + ½a·dt²`, **then** `v += a·dt`. In that order, for a constant `a`, that is the
exact integral rather than an approximation of one — issue #2465, and cannon-duel's flight
carries the same term for the same reason.

The charge leaves the wall at 90 units/s and gains 360 units/s². So a tenth of a second of slop
is worth **9 units at the near edge and 45 at the far one**: the shot that scores most is the
shot that is hardest to place, and that is arithmetic rather than a tuned table.

Three constants that are not independent, and the file does not pretend they are:

- the charge covers `RANGE_MAX − RANGE_MIN` = 270 units in `v₀t + ½at² = 270` at **t = 1.000 s
  exactly**, which is the whole length of a hold;
- its rate at that moment is `v₀ + a·t` = **450**, which is `TRAVERSE_RATE` exactly.

The second one is why the error is a **circle at maximum range and only there**. A press late by
`t` misses the road by `450t`; a release late by `t` misses the distance by the charge's rate,
which runs from 90 to 450. So the two halves of a shot cost the same at the deepest band, and
every shallower shot is up to five times more forgiving in range than in road. A player who
cannot yet hold the far band still has somewhere to stand.

### Step-size invariance, measured

The claim is that the closed form the bot plans with and the numbers the simulation integrates
agree exactly. Three measurements, all at 60, 90, 120 and 240 Hz.

**1. The charge against its own closed form**, `|range − rangeAfter(n·dt)|` in logical units:

| hold | 60 Hz | 90 Hz | 120 Hz | 240 Hz |
|---|---|---|---|---|
| 0.10 s | 0 | 0 | 0 | 0 |
| 0.25 s | 0 | 4.3 × 10⁻¹⁴ | 0 | 0 |
| 0.50 s | 2.8 × 10⁻¹⁴ | 0 | 2.8 × 10⁻¹⁴ | 0 |
| 0.75 s | 0 | 5.7 × 10⁻¹⁴ | 0 | 0 |
| 1.00 s | 0 | 0 | 0 | 0 |

Ten of the twenty cases are bit-exact and the worst is 5.7 × 10⁻¹⁴.

**2. `holdToSmash` as the exact inverse.** For each rate and each whole number of steps, the
distance a soldier must be at is solved forwards and the hold read back: worst error over twenty
cases **1.1 × 10⁻¹⁶ seconds**.

**3. End to end.** The same shot is then actually fired — the charge integrated, the soldier
marched, the shot flown — and the burst's distance from the soldier measured:

| hold | 60 Hz | 90 Hz | 120 Hz | 240 Hz |
|---|---|---|---|---|
| 0.10 s | 7.1 × 10⁻¹⁴ | 2.8 × 10⁻¹⁴ | 1.4 × 10⁻¹³ | 2.8 × 10⁻¹³ |
| 0.30 s | 2.8 × 10⁻¹³ | 6.0 × 10⁻¹³ | 5.1 × 10⁻¹³ | 1.1 × 10⁻¹² |
| 0.50 s | 4.0 × 10⁻¹³ | 8.8 × 10⁻¹³ | 8.2 × 10⁻¹³ | 1.7 × 10⁻¹² |
| 0.70 s | 6.3 × 10⁻¹³ | 1.3 × 10⁻¹² | 1.4 × 10⁻¹² | 2.6 × 10⁻¹² |

Worst **2.6 × 10⁻¹² units** against a 40-unit blast — thirteen orders of magnitude inside it, and
in line with golf-football's 1.2 × 10⁻¹². `rules.test.ts` runs all of this and asserts under
1 × 10⁻⁹.

**What is *not* rate-invariant, said plainly.** Two things are quantised to the step and always
will be: *when* a press is taken, and *when* a soldier is released (`elapsed` accumulates `dt`, so
a release can land one step either side at a different rate). Both are event timing rather than
physics. The measured effect on a whole untouched match is 33.800 s at 120 Hz against 33.817 s at
60 Hz — one step. The law is rate-independent; the clock ticks are not, and cannot be.

Every band edge is deliberately **off the step lattice**, so no soldier is ever judged sitting on
one. A soldier's distance after `n` marches is `DEPTH − MARCH_SPEED · n · dt`, so it lands on an
edge exactly when `R · (DEPTH − BAND) / 50` is a whole number; `DEPTH − BAND` is 186 and 96, and
`gcd` with 50 leaves a factor of 25 to find, so it takes a rate that is a multiple of **25 Hz**.
The round-looking 175 and 265 this game first carried both failed that — 185 and 95 are multiples
of 5, and a soldier reached them dead on step 222 and step 114 of every 60 Hz match. Walked at
all four rates over whole matches: 0 of 6 048, 9 072, 12 082 and 24 192 soldier-steps on an edge.

## Termination — the army is the clock **[ours]**

**The match ends because the army is finite and it walks whether or not anybody plays.**
`SOLDIERS = 14` are released on a fixed cadence and march at a fixed speed, and a soldier leaves
the field either smashed or through the gate. Nothing anybody does can add one, delay one, or
hold one on the field.

    OPENING + (SOLDIERS − 1) · SPAWN_INTERVAL + DEPTH / MARCH_SPEED
    = 0.6 + 26 + 7.2 = 33.800 seconds

That is not a bound, it is the **exact** length of a match nobody plays. Measured:

| | seconds |
|---|---|
| nobody ever touches the device | **33.817** |
| both hold their control down from the first frame and never let go | **33.817** |
| both mash it every other step | 32.250 |
| one seat holds, the other never presses | 33.817 |
| longest of 1 800 bot matches, all nine pairings | 33.82 |
| mean bot match, all nine pairings | 31.50 |
| shortest of 1 800 bot matches | 28.12 |

The 0.017 s over the arithmetic is one 60 Hz step of floating-point accumulation in `elapsed`;
at 90, 120 and 240 Hz the untouched match measures 33.811, 33.800 and 33.808.

This is Explosive Festival's guarantee with the finite quantity moved from the player's side of
the field to the world's. There it was a stock of rockets spent by a fuse whether or not anybody
pressed; here it is a stock of soldiers spent by their own legs, which is stronger in one specific
way: **the fuse bound still depended on how a player fired, and this one does not depend on the
players at all.** Every pairing of tiers, every script, every rate finishes within a fifth of a
second of the same number.

`rules.test.ts` plays the untouched and the fully-held matches with **no step ceiling at all**, so
a match that could not finish would hang the suite rather than pass quietly. `roundSeconds` ends
nothing and is not read anywhere in this package.

A charge cannot be held indefinitely either: it fires by itself when it reaches the far edge of
the field, so a gun cannot be kept loaded past one second. That is a second, independent reason
nothing about how the game is played can lengthen a match.

## The field

| | Value | Why |
|---|---|---|
| Board | 800 × 800 | Square, so `orientation: any` is honest |
| Walls | y = 760 and y = 40 | `WALL_INSET + DEPTH = CENTRE`, so the two fields meet and never overlap |
| Field depth | 360 | 7.2 s of marching |
| Roads | 5, 100 apart, on a 480 rail | Symmetric about the middle of the rail, so the set maps onto itself |
| Traverse | 450 units/s | 1.07 s a crossing; exactly the charge's terminal rate |
| Charge | 90 → 360, `v₀ = 90`, `a = 360` | 1.000 s exactly, top to bottom |
| **Blast** | **40** | Under half the lattice spacing in both directions: one soldier a shot |
| Shot speed | 700 | Longest flight 0.514 s, so a deep shot must be led by 25.7 units |
| March / release | 50 units/s, every 2 s | `50 × 2 = 100` = road spacing: a lattice both ways |
| Army | 14 soldiers | The whole termination argument, and 43 distinct scores |
| Bands | 264 and 174 | 3 / 2 / 1 points; both off the step lattice |
| Minimum range | 90 | Inside it a soldier cannot be reached at all |
| Reload | 0.45 s | Long enough that a tap is a real choice and not a stutter |
| Opening freeze | 0.6 s | Long enough to read the first road |

### The blast is where the difficulty ladder lives

The quantity that decides everything is **how many seconds of press error the blast is worth**.
On the road that is `BLAST / TRAVERSE_RATE` = **0.089 s**, flat. On the distance it runs from
0.089 s at the far edge to **0.444 s** at the near one, because the charge accelerates.

Cup Pong measured a person's timing error at 0.11 to 0.20 s and Explosive Festival shipped its
tiers at 0.10 to 0.22; this game's are 0.115 to 0.20. So the far band sits just *under* the window
a person plays in and the near band comfortably above it. That is the whole reason a deep shot is
worth three and a near one one: the payout follows the geometry rather than a table.

**The blast is under half the lattice spacing on purpose**, so no point on the field is within the
blast of two soldiers — across roads (100 apart) or along one (`MARCH_SPEED × SPAWN_INTERVAL` =
100 apart, and that separation never changes because both are fixed). A shot takes at most one
soldier and the score is exact arithmetic rather than a chain reaction. Measured over 40 whole
`hard` matches, the closest live pair on any field was **99.167 units** against the 80 needed.

### Shot slots

Four a seat, disjoint between the seats. Exactly two of a seat's own can overlap and a third
cannot: the earliest a third could leave the gun is 0.93 s after the first, and the first is gone
by 0.81 s. Fuzzed over 4 000 randomised hold patterns at fifty flip rates, the worst concurrent
load is **2 of 4**; under bot play it is 1, because no tier taps. Disjoint rather than a shared
pool so that which seat is stepped first cannot change which slot a shot lands in — a shared pool
would break the poll-order test for a reason nothing to do with the game.

## Scoring — ground held, not soldiers smashed **[ours]**

A smashed soldier is worth **3** beyond 264, **2** between 264 and 174, and **1** inside 174. One
that reaches the gate is worth nothing. Level on ground, the seat that let **fewer through the
gate** takes it; level on both, a draw.

**This is the answer to the failure Sudoku shipped and Blocks shipped again.** A count of soldiers
smashed saturates and a measure of ground held does not. At `hard` a seat smashes 12.5 of the 14 —
a count two good players land level on constantly — but takes only **27.3 of the 42** points of
ground available, because the deep shot it is choosing is the one it is least likely to place.

| | easy | normal | hard |
|---|---|---|---|
| ground held, of 42 | 13.8 | 20.5 | 27.3 |
| soldiers smashed, of 14 | 6.95 | 9.89 | 12.47 |
| soldiers through the gate | 7.05 | 4.11 | 1.53 |

**The tie-break is a different quantity, not a finer reading of the same one.** A seat can reach
fourteen points by smashing five deep or fourteen close in, and the second of those kept nine more
soldiers off its wall. It is also the one thing the catalogue row asks for that the band score
does not already count, and it is drawn: each wall carries fourteen notch slots, filled in as
soldiers walk through, so a player level on ground can see which way it will go.

Crucially it is **not a function of the board**. On a position that is its own mirror a covariant
tie-break returns a mirror answer and therefore decides nothing — Maze Paint and Sudoku both hit
that wall. Soldiers-through is counted in each seat's own frame from each seat's own field, so the
two seats can differ on it when every other number in the match is identical.

Over 2 000 matches a tier:

| | level on ground | of those, tie-break splits | genuine draws |
|---|---|---|---|
| easy v easy | 6.9% | 43.5% | 3.9% |
| normal v normal | 7.8% | 62.2% | 3.0% |
| hard v hard | 8.7% | 49.1% | 4.4% |

## Fairness

**Cross-device: unrestricted.** The only quantity crossing from a person into the simulation is
one boolean a step, and its timing is the whole game. A key press and a thumb-down carry the same
timestamp on every device, the precision envelope has nothing to quantise because no coordinate is
read, and the logical box is the same 800 × 800 everywhere. `sameInputClassOnly` is false and does
not need to be true.

**Rule 9, the camera: there is no camera.** The whole board is on screen for both seats at every
moment, `WALL_INSET + DEPTH` is exactly the centre so the two fields meet and neither overlaps the
other, and `boardX` / `boardY` are exact half-turns of each other **in integers**:
`boardX('p2', u) === 800 − boardX('p1', u)` for every `u` on the rail, and the same for `y` over
the whole depth. `rules.test.ts` asserts both with `toBe`, not `toBeCloseTo` — a rounding here is a
knife edge the two seats can land on opposite sides of, which is exactly how Snowball Throw lost
its seat balance.

**Both presentations:** `game.ts` never reads `context.presentation` and never pushes a rotation.
The board reads the same from either side of the device and there is no text to read upside down,
so shared-screen and single-seat are the identical simulation by construction rather than by care.
A test drives the same seed through both and compares.

### The mirror test, written first

Four assertions, and one of them found a real defect on its first run.

1. **`step` is covariant.** 400 random positions — soldiers, guns, charges, shots, scores all
   scrambled — mirrored, with the holds mirrored, stepped, and the whole `Siege` compared as JSON.
   Because everything is in a seat's own frame, mirroring is an exact *swap* with no arithmetic in
   it; anything that read a board coordinate would need arithmetic here and would not survive in
   the last bits.
2. **Every bot decision is covariant.** 200 positions × 3 tiers: the target index, both timing
   offsets and the countdown must be bit-identical for the two seats.
3. **Whole matches mirror.** Swap the two seats' bot streams and the whole match reflects:
   **0 of 1 500 failed to flip and 0 scored differently**, over three tiers and both openers.
4. **The picture mirrors.** Every draw call in a frame is reduced to `(kind, centre, size)` and
   compared against its own half-turn, at four points of an untouched match.

**Assertion 4 failed on its first run and the cause was real.** `resetTurret` gave the opening
seat the low end of its rail and the other seat the high end, on the reasoning that the two
arrangements are mirror images of one another. They are — but mirroring a seat's position *within
its own rail* and then mapping to the board **composes to a translation rather than to the
half-turn**, and it put the two guns on the same column of the board, moving in the same
direction, for the whole match. Nothing about that was unfair. It simply was not the picture the
file claimed to draw, and no other test in the repository could have seen it.

The fix makes the symmetry structural: **both guns take the same end of their own rails, and the
opening seat picks which end.** In their own frames the two seats are then bit-identical, which
through the exact half-turn puts them at opposite ends of the board moving in opposite directions,
at the first step and every step after it.

### Seat balance, measured

Because the two seats hold bit-identical own-frame positions and face **one shared army**, seat
symmetry here is a *proof* (assertion 3 above) rather than a measurement. The sampled figures
below are the companion, from the harness the shell actually produces: each seed played from both
openers with the bot streams left alone.

Equal tiers, 1 000 seeds × 2 openers = 2 000 matches a tier:

| | p1 | p2 | draws | seat-one share | ground p1/p2 | shots | seconds |
|---|---|---|---|---|---|---|---|
| easy v easy | 926 | 996 | 78 (3.9%) | **48.2%** | 13.82 / 13.94 | 16.1 | 32.37 |
| normal v normal | 984 | 957 | 59 (3.0%) | **50.7%** | 20.51 / 20.38 | 15.6 | 31.37 |
| hard v hard | 954 | 958 | 88 (4.4%) | **49.9%** | 27.28 / 27.32 | 14.8 | 30.20 |

At 2 000 seeds × 2 openers = 4 000 matches a tier, with the seed sequence scrambled so the sample
is not an arithmetic progression: **50.49% / 49.56% / 50.54%**, each with a standard error of 0.80
points. The platform's own `balance-aggregate.test.ts` measures **50.0%** on its default sample.

Cross tier, both seat orders, 2 000 matches a cell:

| | p1 | p2 | draws | stronger tier's share of decided |
|---|---|---|---|---|
| normal as p1 v easy | 1 720 | 254 | 26 | 87.1% |
| easy as p1 v normal | 237 | 1 728 | 35 | 87.9% |
| hard as p1 v normal | 1 800 | 163 | 37 | 91.7% |
| normal as p1 v hard | 202 | 1 771 | 27 | 89.8% |
| hard as p1 v easy | 1 984 | 11 | 5 | 99.4% |
| easy as p1 v hard | 14 | 1 980 | 6 | 99.3% |

Every equal-tier share is inside the flat 45–55% band, every pairing is monotone, and each agrees
with itself within 1.9 points across the two seat orders.

**The ladder is steeper than Explosive Festival's, and the reason is structural rather than a
tuning choice.** Sharing the wave removes the *seed* variance from a comparison between the two
seats: they are not being asked to beat different armies, so a gap of a few points of ground is
almost never reversed by luck. The same tier separation in a game where each seat draws its own
board would read several points shallower.

### The opening seat

A real-time game has no opener and the contract lets one ignore `context.openingSeat`. This game
reads it anyway: it decides which end of their own rails **both** guns start from. That changes
the match without changing who is favoured — the two seats stay exact half-turn images either way
— and it is worth changing: a balance harness that plays each seed from both openers gets the
identical match twice from a game that ignores the value, and cannot separate a seat effect from a
seed effect. Measured over 60 seed pairs, the two halves of a pair end differently in more than
half of them.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `Space` | `Enter` |
| Pointer | press anywhere in your own half | press anywhere in your own half |

Press to stop your gun on a road, keep holding to send the shot further out, let go to fire. A
charge left to run out fires by itself at maximum range.

## The bot

Three tiers, expressed only as how accurately a tier hits the moment it meant to — which is the
whole of the skill this game asks for. There is nothing to steer, nothing to dodge and nothing to
point at.

| Tier | Press error | Fumbles |
|---|---|---|
| easy | ±0.20 s | 16% |
| normal | ±0.15 s | 8% |
| hard | ±0.115 s | 2% |

Every value is several frames wide, so rule 6 holds by construction: no tier can stop a gun or let
a charge go more finely than a person can, and all three sit inside the 0.11–0.20 s window Cup
Pong measured for a person. A tier is two numbers, both seconds of human error, and a test asserts
the profile has **no third field** — nothing in it is a speed, a reach, or a fact about the field a
player cannot see.

### It plans one shot, then makes two decisions a second apart

The road is chosen at the plan and the distance at the press, not both at the plan. A person
presses, then looks at the field and decides when to let go, and the second decision is made with
a second of newer information than the first. Committing both at plan time would also make an
error on the press silently poison the release, which is a coupling nobody would design on
purpose. The two timing errors are still *drawn* together, so a shot costs exactly six values
however it turns out.

### It counts down to a moment; it does not watch for a position

Watching for a position is the obvious way to write this and it hangs: the error is added in
whichever direction the gun is currently travelling, so an error larger than the rail is out of
reach *both* ways — the gun turns round at the end and the wanted value turns round with it.
`timeToLane` is closed form and a countdown cannot fail to expire. A test walks every position and
direction on the rail against every road and asserts the answer is finite and no longer than one
round trip.

### Its closed form is the simulation's, exactly

`holdToSmash` solves one quadratic for a quantity three moving things determine at once — the
charge accelerates, the soldier walks in, and the shot takes time to fly. Let
`k = SHOT_SPEED / (SHOT_SPEED + MARCH_SPEED)`; a shot fired at range `r` lands on the soldier
exactly when `r = k · (distance at the moment of firing)`, and substituting the charge's own
closed form gives

    ½·a·t² + (v₀ + k·MARCH_SPEED)·t + (RANGE_MIN − k·(d − MARCH_SPEED·dt)) = 0

whose smaller non-negative root is the hold. `NaN` when there is no real root, which is a soldier
already inside the minimum range — not an edge case being swept up but the rule the catalogue row
is named after. The three measurements in *Step-size invariance* above are the evidence that this
and the simulation are the same law. Driven with its timing error set to zero, the bot smashes
**over 85% of the shots it takes** in a live match; the remainder are targets that walked out of
reach or were taken by an earlier shot between the plan and the press.

### It takes the deepest soldier it can reach, and the first version took the nearest

Nearest-first is the rule the catalogue row appears to ask for — *don't let them get close* — and
it is the rule Explosive Festival measured its way into. It was written first, then played head to
head against deepest-first at the same tier, 400 seeds in each seat order and each opener,
everything else identical:

| | deepest-first's share of decided |
|---|---|
| easy | 54.3% |
| normal | 58.5% |
| hard | 57.5% |

**Deepest-first wins at every tier, with no sign change across the ladder**, so it ships. The
reason is the whole economics of the game: **a deep shot is worth three points and a missed deep
shot is not a wasted one.** The soldier keeps walking, the gun comes round again, and it can be
taken later for two or for one. A near shot is worth one point and missing it costs the soldier
entirely. Explosive Festival came out the other way because *its* short shots landed on its own
lanterns, and these do not.

The shape of a match says the same thing from the other side: deepest-first smashes **fewer**
soldiers (12.5 against 13.7 at `hard`) and holds **more** ground (27.3 against 25.9), and at
`easy` it lets seven soldiers through the gate where nearest-first lets four. That is the visible
price it is paying for the points, and it is what makes the wall notches worth drawing.

**Both terms are ranked in the firing seat's own frame** — a road index and a distance. Ranking on
a board coordinate would sort the two seats' mirrored fields into different orders, which is the
defect Explosive Festival found in its own target rule and Maze Paint found in a tie-break.

### Every knob, swept alone

Win rate is against an untouched `normal` over 250 seeds in **each** seat order and **each**
opener, 1 000 matches a point.

| `timing` (blunder pinned at 0.08) | win vs `normal` | ground | smashed | through |
|---|---|---|---|---|
| 0.05 s | 98.9% | 30.89 | 13.48 | 0.52 |
| 0.07 s | 97.9% | 30.57 | 13.39 | 0.61 |
| 0.10 s | 94.5% | 28.54 | 12.82 | 1.18 |
| 0.13 s | 69.8% | 23.60 | 11.15 | 2.85 |
| **0.15 s** | **50.0%** | **20.47** | **9.91** | **4.09** |
| 0.18 s | 26.1% | 16.73 | 8.23 | 5.77 |
| 0.22 s | 11.3% | 13.32 | 6.62 | 7.38 |
| 0.30 s | 2.2% | 9.31 | 4.74 | 9.26 |
| 0.45 s | 0.3% | 5.79 | 3.00 | 11.00 |

| `blunder` (timing pinned at 0.15) | win vs `normal` | ground | smashed | through |
|---|---|---|---|---|
| 0 | 57.0% | 21.72 | 10.44 | 3.56 |
| 0.02 | 55.4% | 21.41 | 10.30 | 3.70 |
| 0.06 | 51.8% | 20.76 | 10.04 | 3.96 |
| **0.08** | **50.0%** | **20.47** | **9.91** | **4.09** |
| 0.12 | 45.4% | 19.73 | 9.59 | 4.41 |
| 0.16 | 40.6% | 19.08 | 9.29 | 4.71 |
| 0.25 | 31.2% | 17.61 | 8.60 | 5.40 |
| 0.45 | 13.7% | 14.23 | 7.06 | 6.94 |
| 0.80 | 1.4% | 8.29 | 4.24 | 9.76 |

Both are strictly monotone across their whole range, in every column. Neither was deleted. With
one knob flattened to `normal`'s value for all three tiers, so the tiers differ in one number and
nothing else:

| | normal over easy | hard over normal |
|---|---|---|
| both (shipped) | 87.8% | 91.4% |
| timing alone | 84.3% | 85.6% |
| **blunder alone** | **60.5%** | **56.2%** |

Timing is the larger axis, as it is in Explosive Festival — but the fumble is worth ten points of
ladder here against that game's four, because a fumbled press in this game usually means a soldier
walks through a gate rather than a rocket landing on bare ground, and that is a mistake you can
watch happen.

### Its press error is triangular, not flat

Two draws a moment, summed. Mostly close, occasionally nowhere near — both the better picture of a
person and the shape that leaves a ladder somewhere to stand. A flat error either fits inside the
blast or it does not, with very little in between.

### Randomness

**Three streams, all derived from the match seed in a fixed order:** one for the world and one for
each seat.

The world's stream deals the wave and nothing else, in exactly `SOLDIERS` = 14 draws before
anything else touches it — so which roads a pair is besieged on is a function of the seed and of
nothing that happens afterwards. On a stream shared with the bots it would not be: a bot draws six
values per shot, and the number of shots depends on its tier, so a different pairing would deal a
different wave and a human against a bot would play in one none of these figures were measured in.
A plain `float()` rather than `Rng.int`, whose rejection sampling draws a variable number of
values.

Each seat's stream is its own, and each shot costs **exactly six values, drawn before anything
branches** — the fumble costs the same one roll whether it happens or not. Together those make the
poll order unobservable: `rules.test.ts` plays 25 seeds at each tier with the two seats polled in
both orders and compares the whole `Siege` bit for bit, and another asserts a seat plays
identically against an `easy` opponent and a `hard` one.

### Solo, per tier

One bot against a wall nobody defends, 400 matches a tier:

| Tier | shots | smashed | hit rate | ground | through | ground a shot |
|---|---|---|---|---|---|---|
| easy | 16.1 | 6.87 of 14 | 42.6% | 13.88 of 42 | 7.13 | 0.86 |
| normal | 15.7 | 9.92 of 14 | 63.2% | 20.61 of 42 | 4.08 | 1.31 |
| hard | 14.8 | 12.44 of 14 | 84.2% | 27.46 of 42 | 1.56 | 1.86 |

The `ground a shot` column is the one to read: it is the tier's whole skill in one number, and it
nearly doubles across the ladder while the hit rate only doubles. A better player is not just
hitting more, it is hitting further out.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called through a whole match, and a second
one records **every primitive each seat is drawn with over 34 seconds of play** and asserts seat
one's set is exactly `{circle}` and seat two's exactly `{rect}`. There is no glyph the two seats
share at all. The platform's own `apps/web/src/data/greyscale.test.ts` returns the same verdict.

- **Seat one is round and seat two is square, everywhere.** Soldiers, guns, shots in the air,
  bursts, the charge ring and the notches a breach leaves in a wall.
- Each soldier carries a second mark of its own seat's shape inside it, so the shape that tells
  the seats apart survives being drawn small, and a soldier reads as a soldier rather than a disc.
- The gun's barrel is drawn in neutral metal rather than in the seat's colour — deliberately, and
  it is rule 7 rather than taste: a line is the one primitive both seats would otherwise share.
- The charge ring is drawn **at the real blast radius**, so what a shot will clear is something a
  player watches rather than something they are told about afterwards. The burst opens out to the
  same radius.
- The minimum range is the only line on the board drawn **broken**, so it does not read as another
  band. Inside it a soldier cannot be touched, and that is the single most important thing on the
  field to be able to see.
- Each wall carries fourteen notch slots, filled in as soldiers walk through. That is the
  tie-break made visible without a number, and it is the wall visibly failing.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in each seat's own frame — a road index and a distance — and
**no board coordinate appears in it at all**. `game.ts` turns those into board coordinates to draw
them and nowhere else. That is what makes the mirror property hold in the last bits rather than to
within a tolerance: a threshold or a tie-break written in board coordinates is not covariant under
the half-turn, and if there are no board coordinates there is nothing to write one in.

`alpha` is ignored on purpose. The two things that move fastest are the gun on its rail and the
charge running out from it, and those are precisely the two things a player is timing a press
against; drawing them a fraction of a step ahead of the state a press would actually read would
make the picture lie about the only decision in the game. A test renders forty frames at forty
different alphas and asserts the serialised `Siege` is unchanged to the byte.

## Budget and shape

`rules.ts` is 1 238 lines to `game.ts`'s 426, with 1 944 lines of tests beside them — 90 tests, all
passing. The bundled chunk is **≈4.5 KB gzipped** against a 12 KB budget. That figure is an
estimate rather than `pnpm size`'s own number, which could not be run alongside six other agents:
the same estimate gives Explosive Festival 4.5 KB against the 4.4 KB it measured and Cup Pong
4.0 KB against 3.9 KB, so it reads about 0.1 KB high. No asset files, so nothing to licence.
