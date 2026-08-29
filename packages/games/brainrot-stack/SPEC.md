# Wobble Stack — specification

**Package:** `brainrot-stack` (legacy id; the catalogue renamed it) · **Archetype:** `rt-split` ·
**Category:** Party · **Logical box:** 600 × 1000 · **Zone split:** horizontal ·
**Round length:** ~45 s advertised, 22 brainrots (≤ 55.2 s) hard bound

> **Written from the implementation, not before it.** **[ours]** marks our decisions, as
> distinct from what the observed reference row dictates. Every number below was measured.

A plinth each. A brainrot hangs over your plinth from a rail of fifteen notches; you shunt it
left and right a notch at a time and tap to let it go. It falls onto whatever is already
there, and the tower **leans**. If a brainrot ever leaves your plinth — because it missed the
tower on the way down, or because the tower it landed on went over — you have lost.

## Observed rules

The catalogue row: _"Take turns dropping brainrots. First player to drop a brainrot off the
platform loses, so take care to drag left & right, and tap to drop."_

Four facts, and only four: brainrots are dropped onto a platform; dropping one off the platform
**loses** rather than scores; you position it by dragging sideways; and a tap drops it.
Everything else below is **[ours]**.

### What is deliberately not built

- **Anything the row does not name.** `data/catalog.yaml`'s older wording for the same row
  says "tap to rotate before you drop". Nothing here rotates, and no brainrot is asymmetric,
  so there is nothing a rotation could do. That is a design choice and it is the one that
  makes room for the game's actual second verb, which is **when** you let go. A rotate gesture
  would also be a third meaning for the same press, and `docs/input-idiom.md` allows a
  `rt-split` game a drag and a tap and no more.
- **A turn model.** See below.
- **A continuous drop position.** See "Aiming is a notch and a moment".

## The one place this departs from the row: "take turns" **[ours]**

The row says take turns; this does not, and the archetype is why. `rt-*` games must not model
turns: `GameHost` decides a game is turn-based from `getActiveSeat()` returning a seat, and for
a game that answers it the shell hands the **whole** pointer surface to whoever is to move —
which would take one seat's half of the glass away for half of every match.
`apps/web/src/data/turn-seat.test.ts` enforces exactly that, in both directions.

So **this game does not implement `getActiveSeat` at all**, and does not read
`GameContext.openingSeat`: there is no opener to alternate. Instead each seat gets its own
plinth, its own rail and its own budget, and both play at once.

What "taking turns at one tower" was buying is that the two players face the same problems. So
the brainrots come out of one seeded stream and are handed out **by index**: the nth brainrot
of the match is the same kind, delivered on the same notch, for both seats. Two people are set
the identical run of problems at their own pace, rather than merely balanced on average.

That is the same resolution Animal Stack reached for the same tension, and it is worth saying
so rather than presenting it as new — it is the only reading of "first player to drop one off
the platform loses" that survives the archetype. Everything below this line is not shared with
that game: the notch rail, the two oscillators, the settle, the bot's prediction, the scoring
and the tie-break are all different.

## Aiming is a notch and a moment, never a drag **[ours]**

The row says "drag left & right", and a drag is a continuous quantity: bind the drop position
to it directly and a thumb can name a placement no keyboard can express. Cup Pong replaced the
reference's swipe with two presses for that reason; Snowball Throw reduced a throw to three
sizes and three leans; Frozen Beaks kept only the sign of the gap on each axis. This game
splits the difference along a different seam, and gets a better game out of it:

- **Position is an integer.** The carrier sits on one of fifteen notches, 22 units apart, and
  never between two. A finger names the notch nearest it; a key names the next notch along.
  Both go through one cooldown at one rate — `SLOT_SECONDS`, 0.085 s a notch — so the set of
  placements the two instruments can produce is *the same fifteen integers*, and neither can
  reach one faster than the other. `game.test.ts` drives a finger held on the far notch and a
  held `D` through the real `InputManager` and asserts the carrier walks the identical trace
  for sixty steps, to nine decimal places.
- **The other half of the aim is the moment you tap**, and a press is one binary event with a
  timestamp. A thumb, a trackpad, a mouse and a keyboard all express that identically; the
  engine already counts hold timing in simulation steps rather than milliseconds
  (`docs/input-parity.md`). Nothing in this game reads pointer velocity, sweep speed or drag
  length, so nothing here is outside the precision envelope.

The moment matters because the brainrot is **swinging** and the tower is **leaning** — both
described below. So the continuous skill in this game is timing, which is the one continuous
quantity every input family owns equally, and the discrete skill is choosing a notch, which is
the one positional quantity a keyboard can name exactly.

`sameInputClassOnly` is therefore `false`, and that is a claim rather than a hope:

| | asserted in |
|---|---|
| A finger and a key walk the carrier along the identical trace, to 1e-9 | `game.test.ts` |
| A press of either kind drops on the same step, with the same fall clock | `game.test.ts` |
| A press whose pointer stays inside two precision envelopes is a tap | `game.test.ts` |
| Nothing else on the keyboard does anything at all | `game.test.ts` |

**One residual difference, named rather than hidden.** A keyboard can hold `D` and tap `Space`
in the same step; a thumb has to come off the glass to tap, and the step it is off the glass is
a step the carrier does not hop — 0.085 s, against a hover clock with between 2.13 s and 0.25 s
of slack in it. **The bot is held to the thumb's version**: it only ever taps from the notch it
has already reached, so the stronger of the two gestures is the one a person has and not the
one the bot has.

### The gesture, per instrument

| | Seat one (near) | Seat two (far) |
|---|---|---|
| Keyboard | `A` / `D` shunt a notch, `Space` drops | `←` / `→` shunt, `Enter` drops |
| Pointer | drag in the near half to the notch under your finger; tap to drop | drag in the far half; tap to drop |

A **tap** is a press whose pointer never left two precision envelopes (6 units in this box) of
where it went down. A keyboard satisfies that trivially, because a key has no pointer to move.
**There is no hold-duration threshold anywhere in this game, deliberately** — a duration
threshold is a number the two seats reach by accumulating steps from opposite ends of a match,
and that family of bug has already cost this repository two games (see "Mirror symmetry").

## The board

Read out of `src/rules.ts` rather than from memory.

| | Value | Why |
|---|---|---|
| Field | 600 × 1000 | Portrait: two people either side of an upright phone |
| Yard | 470 tall, ×2, 60-unit gutter between | Symmetric under a half turn |
| Plinth top | 70 above each seat's own edge | Deep enough to draw a plinth with a drop either side |
| Plinth | ±78 | What the tower's weight has to stay over |
| Notch pitch | 22 | Below |
| Notches | ±7, so fifteen | Notch 4 already overhangs the plinth |
| Notch rate | 0.085 s a notch | One rate for a thumb and a key |
| Carry gap | 96 above the tower | Also how far a brainrot falls |
| Minimum contact | 6 | A corner on the edge is not a footing |
| Fall / reload / opening | 0.26 / 0.22 / 0.80 s | |
| Hover clock | 2.30 s falling 0.07 s a brainrot, floor 0.85 s | Below |
| Delivery | ±2 notches growing to ±7 | A brainrot nobody touches is dropped off the plinth |
| Budget | 22 brainrots a seat | What bounds the match |
| Backstop | 90 s, which nothing reaches | `roundSeconds` ends nothing, so the rules must |

**The notch pitch is bounded from above by the brainrots.** A legal landing must always exist,
so `2 × (half + supportHalf − MIN_CONTACT)` must be at least one pitch for every pair. The
tightest is a tooth on a tooth at 28 against 22, asserted for all 36 pairs in `rules.test.ts`.
If it were ever violated a placement would be *impossible* rather than hard, and the game would
be deciding matches by arithmetic nobody could see.

### The brainrots **[ours]**

| | half-width | height | mass |
|---|---|---|---|
| blob | 33 | 26 | 1.0 |
| pillow | 27 | 32 | 1.3 |
| cog | 22 | 28 | 1.7 |
| noodle | 17 | 42 | 1.0 |
| wafer | 13 | 20 | 2.1 |
| tooth | 10 | 46 | 1.5 |

Two properties do the work, and both are visible on the screen. **They get narrower**, and the
deal walks down the list as the tower grows, so a match opens with blobs and ends with teeth.
**They get heavier for their width** — a wafer is 13 across and twice a blob's mass — so a late
brainrot put down off centre moves the tower's weight much further than an early one does.

The window a brainrot may land in, either side of its support, doubled — so this is how wide a
target you have, against a 22-unit notch pitch:

| standing on → | blob | pillow | cog | noodle | wafer | tooth |
|---|---|---|---|---|---|---|
| blob | 120 | 108 | 98 | 88 | 80 | 74 |
| pillow | 108 | 96 | 86 | 76 | 68 | 62 |
| cog | 98 | 86 | 76 | 66 | 58 | 52 |
| noodle | 88 | 76 | 66 | 56 | 48 | 42 |
| wafer | 80 | 68 | 58 | 48 | 40 | 34 |
| tooth | 74 | 62 | 52 | 42 | 34 | 28 |

A tooth on a tooth gives you 28 units on a 22-unit lattice: one notch is legal, sometimes two,
and the brainrot has to be hanging almost dead still when you let go. That is the end of a
match, and it is where most of them end — 660 of the 758 seats that lost in a 900-match sweep
lost by missing, not by toppling.

### What the hover clock is doing to you

| brainrot | kinds drawn from | hover | delivered at most | time to walk in | slack |
|---|---|---|---|---|---|
| 0 | blob, pillow | 2.30 s | ±2 | 0.17 s | 2.13 s |
| 4 | blob … cog | 2.02 s | ±3 | 0.26 s | 1.76 s |
| 8 | pillow … noodle | 1.74 s | ±4 | 0.34 s | 1.40 s |
| 12 | cog … wafer | 1.46 s | ±5 | 0.43 s | 1.03 s |
| 16 | noodle … tooth | 1.18 s | ±6 | 0.51 s | 0.67 s |
| 21 | noodle … tooth | 0.85 s | ±7 | 0.60 s | 0.25 s |

The last column is the constraint, and it is asserted: **the hover clock always covers the walk
in from wherever the carrier was delivered.** The slack narrowing from 2.13 s to 0.25 s is the
difficulty ramp expressed as time, and it is what the swing has to be paid off out of.

## The two things that wobble

### The brainrot swings, because you shunted it

Every hop of the carrier drags the thing hanging off it: `swing.rate -= SHOVE × direction`,
with `SHOVE` 26 units a second. One hop leaves it swinging about four units either way, which
is nothing; seven hops inside two thirds of a swing period mostly add, which is about nine and
is most of a notch — measured at **9.00 units** for a crossing of the whole rail, asserted in
`rules.test.ts`. The swing has a 0.90 s period and loses 57% of its amplitude a second.

**A brainrot nobody touches hangs dead still** (asserted: exactly zero), so the swing is
entirely player-caused. That is the whole cost of moving: crossing the rail is free in time and
expensive in swing, and the swing has to be waited out before you let go — against a clock.

Where a brainrot leaves the rail is `notch × 22 + swing`. Once released it is in free fall and
stops swinging.

### The tower leans, because of where its weight is

A stack of brainrots is modelled as **one elastic column**, not a pile of rigid bricks. It has
a rest lean set by where its weight falls, it rings about that rest lean when something lands
on it, and its top is carried sideways in proportion to how high it is:

```
rest lean       tilt* = com / swayScaleAt(comHeight)
sway scale      swayScaleAt(h) = 45 / (1 + h / 120)
weight sits at  com + comHeight × tilt
stands while    |com + comHeight × tilt| <= 78
drift at h      tilt × h
```

A genuine inverted pendulum was the first draft and was thrown away: gravity on a leaning
column is destabilising, so a rigid tower has no equilibrium to wobble about at all — it stands
exactly upright or it accelerates over, and there is no lean to read or to time a drop against.
Folding the destabilising term into `swayScaleAt` is the linearisation of the same physics
about a column with a spring in it, and it is what makes the tower a thing you can watch.

**That one function is the whole difficulty ramp, and it is arithmetic rather than a table.**
Because the sway scale itself shrinks with height, the amplification of a given imbalance grows
quadratically:

| tower | `comHeight` | 5 units of offset put the weight at | topples past |
|---|---|---|---|
| 2 brainrots | 30 | 9.4 | ±41 |
| 6 brainrots | 100 | 22.4 | ±17 |
| 12 brainrots | 200 | 50.6 | ±7.7 |
| 22 brainrots | 350 | 118.6 | ±3.3 |

So the tower that was comfortable at five brainrots is on the edge at twenty with the same
offset — and because a landing is quantised onto a 22-unit lattice minus a swing you can only
partly control, the offset never quite goes to zero. That is why a `hard` pair still loses 31%
of its towers rather than stacking a perfect column for ever.

**A landing carries the lean and its rate straight through** — a column cannot change shape
instantly — but the *rest* lean jumps, because the weight moved, and that jump is what sets the
tower ringing. There is a second, smaller thump proportional to the landing brainrot's share of
the total mass, so an early brainrot rings the tower hard and a late one barely moves it.

## Why the physics is solved rather than stepped

Both oscillators are `u'' + 2ζω u' + ω² u = 0` in `u = value − rest`, and `advanceWobble`
**evaluates the closed form over a step** rather than integrating towards it. This is the
telescoping-form lesson from Soccer Pool and Mini Golf applied to an oscillator rather than to a
decay. One kick, one simulated second, four step rates:

| | value after 1 s | 60 Hz vs 240 Hz |
|---|---|---|
| this integrator | 0.108715929194676 at 60, 90 and 120 Hz; …677 at 240 | **3.6 × 10⁻¹⁶** |
| forward Euler | 0.128043368 at 60 Hz, 0.113108756 at 240 Hz | 1.5 × 10⁻² |

The rate agrees to 3.3 × 10⁻¹⁶ over the same second. Euler is out by four parts in a hundred
between the two rates, and in the direction that matters: Euler on an oscillator *gains* energy
in proportion to the step, so the same tower would ring visibly longer on a 60 Hz phone than on
a 240 Hz one, and the bot's own arithmetic about where a brainrot lands would be permanently out
by the same amount. `rules.test.ts` runs both and asserts the ratio is over 10⁹; it is 4 × 10¹³.

### The topple test reads inside the step, not at its end

A ring can cross the plinth edge and come back **between two 60 Hz samples**. A game that
looked only at sample boundaries would decide a marginal tower differently on a faster device.
So `advanceWobble` also reports the lowest and highest value reached *inside* the step: the two
endpoints, plus the one interior stationary point if it falls in the step. There is at most one,
because stationary points are half a ring apart (0.61 s for the tower, 0.45 s for the swing) and
a step is at most 1/60 s.

| worst lean over one second, four step rates | spread |
|---|---|
| reading the extremes inside each step | **4.4 × 10⁻¹⁶** |
| reading only the value at each step boundary | 1.2 × 10⁻⁴ |

`rules.test.ts` also builds one tower poised so the first peak of its ring clears the plinth
edge by a third of a unit, runs it at 60, 90, 120 and 240 Hz, and requires all four to agree
that it went over.

The settle after the last brainrot uses the same exactness: a tower is finished when the
**envelope** of its ring — `sqrt(u² + ((v + σu)/ω_d)²)`, which bounds every lean it will ever
reach again — is small enough that neither `rest + R` nor `rest − R` leaves the plinth. That is
a statement about the whole future rather than a threshold somebody guessed, so 60 Hz and
240 Hz cannot disagree about whether a marginal tower survived.

## The bot does not reason analytically. It runs the simulation

Issue #2465 is a bot reasoning analytically about a quantity the simulation integrates
numerically. The temptation here is real: the lean has a closed form, so the bot could evaluate
it at `t + fall` directly, and would then be a few ulps away from the simulation for ever.

It does not. `predictSwing` and `predictLean` copy the yard's oscillator into one module-level
scratch record and run **the simulation's own `advanceWobble`**, at the simulation's own delta,
for exactly the number of steps the simulation will run:

- one advance for the swing, because a released brainrot is in free fall and stops swinging;
- `1 + fallStepsFor(delta)` for the lean — one for the step the drop is registered on, then the
  fall. The fall count is obtained by running the simulation's own countdown loop rather than by
  `ceil`, so the two cannot round the boundary differently.

`rules.test.ts` asserts, at 60, 90, 120 and 240 Hz and with `toBe` rather than `toBeCloseTo`,
that the yard's `dropX` is the predicted release point and that the landed brainrot's `x` is the
predicted landing point. Not close: identical.

This is also why **the bot only taps on a step it looks on** — the prediction and the tap have
to be the same step, or the prediction is stale. That constraint is structural, not a difficulty
setting, which the knob sweep below confirms.

## Scoring, the win condition and the tie-break

**Last one standing**, resolved by the shared helper:
`resolve({ kind: 'last-standing' }, tally, { timeExpired, eliminated })`. The observed rule is a
losing condition rather than a scoring one and this is the helper for that. Nothing here writes
a comparison by hand, so two towers that go in the same step are a draw because `resolve` says
so and not because this game picked a seat.

The tally is **brainrots standing on your plinth**, which is what the shell's HUD shows. It is
only consulted when nobody has been eliminated — both seats finishing their budget, or the 90 s
backstop.

### The tie-break **[ours]**

Both seats are dealt identical brainrots, so two players who both survive the budget finish on
22 apiece by construction. "Level on brainrots" therefore has to mean something, and what it
means here is **whose tower stood more honestly**: the margin at its worst moment — how much
plinth was left — higher wins.

That number is a **magnitude**, never a direction. A tie-break written in board coordinates
returns a mirror answer on a mirror board and so decides nothing; this one is the same number
seen from either side of the device. It is also the number the balance bar has been showing all
match, so it is something both players watched happen rather than a hidden second scoreboard.

Two towers that went in the same step are a genuine draw: neither has a margin left.

**Nothing is decided on a clamped value.** The balance needle is clamped to the plinth for
drawing, and nothing compares the clamped copy; the landing test is an intersection of two real
intervals rather than a clamp of the quantity being compared against it.

142 of 900 matches across all nine tier pairings were decided this way — the rest by somebody's
tower going. So the tie-break is a real part of the game rather than a formality, and the
contest does not saturate: `hard` against `hard` is 49.8% over 400 seeds with **no draws at
all**, because the worst-margin number separates two towers that both survived.

## Termination

Guaranteed three times over, and the arithmetic is multiplied out rather than felt.

1. **The hover clock.** A brainrot nobody drops is let go by the carrier and charged to the
   budget. A seat cannot stall.
2. **The budget.** 22 brainrots a seat, after which the plinth settles and is declared safe.
3. **The backstop.** 90 s in the rules, which nothing reaches.

```
0.80 (opening) + 34.45 (Σ hover) + 22 × (0.26 + 0.22) + 6.00 (settle cap)  =  51.81 s
plus at most three steps of slack per clock                                =  55.21 s
```

`ROUND_SECONDS` (90 s) sits above that as a looser second backstop, because a game whose only
guarantee lives in its pacing constants is one change away from running for ever.
`apps/web/src/data/termination.test.ts` allows 600 s, so the bound clears it by a factor of
eleven.

Measured, driven through `WobbleStackGame`:

| driver | matches | outcome |
|---|---|---|
| bot pairs, all nine tier pairings | 900 | all decided; mean **22.0 s**, longest **35.9 s** |
| nobody touching the device | 200 | all decided; **6.1–25.5 s**, mean 8.7 s, 2.0 brainrots down, 200 draws |
| both seats tapping every other step | 1 | decided in **1.6 s**, 1–1, draw |
| two `easy` bots | 400 | all decided; longest 26.9 s |

**Mashing is suicide here, and that is worth saying**, because in Animal Stack it was merely
mediocre. A tap every other step drops each brainrot on the notch it was delivered on, and the
deal alternates sides, so the second brainrot lands 88 units from the first and misses. A finger
parked on the glass is not a way to play this game.

The idle case is the one a stacking game has to earn: the carrier delivers at least two notches
out and lets go by itself, so a brainrot nobody touches eventually misses the tower. All 200
idle matches are draws because both seats are dealt identically and neither touches anything —
which is the deal working, not a defect.

## Determinism

- **All randomness is seeded**, and it is consumed by the *match* rather than by a yard:
  `ensureDealt` draws by brainrot **index**, so what either player does cannot change which
  brainrots either of them is given. A test plays one seat three times as fast as the other from
  one seed and gets the identical run of kinds.
- **Every clock is counted in simulated seconds off the fixed step**, never in wall time.
- **The carrier's position is an integer.** There is no accumulated float to drift, and no
  rounding to disagree about. `slotOfX` rounds on the magnitude and then signs it, rather than
  `Math.round(x / pitch)`, because `Math.round` breaks its ties upwards — see below.
- **Nothing allocates per step.** Both stacks are preallocated to the budget and written into by
  index; the deal arrays likewise; the step result, the tally and the eliminated list are single
  records rewritten in place; the bot's prediction runs on one module-scope oscillator. A test
  plays a whole match and checks the stack still holds the same twenty-two objects.
- **Nothing is expressed in pixels.** Every number above is a logical unit; the renderer is the
  only code that knows what a device is, and the scroll that keeps a tall tower inside its own
  yard lives there and nowhere else.
- `resetMatch` leaves a match indistinguishable from a fresh one, arrays included, so a rematch
  cannot start part-played — asserted with `toEqual` against `createMatch()`.

## Mirror symmetry, and the two things it caught

Written first, as the second-round lessons say to. Take a match, mirror the deal, mirror the
inputs, run both, and require the results to be mirror images — over 300 scripted matches, on
every step, on every field the simulation decides (**over 40,000 yard comparisons**, asserted), and again on
**more than 1,200 bot decisions** taken from real matches.

It found two things, and nothing else in the suite could have seen either.

**1. `Math.atan2` is not covariant, and it was inside the integrator.** The interior stationary
point of a step is where `tan(ω_d t) = v / fall`, and `v` and `fall` both negate under the half
turn. `Math.atan2(v, fall)` and `Math.atan2(−v, −fall)` differ by π, so after the `+= halfRing`
normalisation the two seats reached the same root by two different arithmetic routes and
disagreed **in the last two bits** of `swing.low`. That is precisely the family the lessons
name: a quantity two seats reach from opposite ends and get slightly different answers for. The
fix is to canonicalise the pair to the half-plane `fall ≥ 0` before `atan2` sees it, so both
seats evaluate the identical expression. After it: zero divergences.

**2. The mirror test's own blind spot, caught by its own control.** The bot half of the test
seeded each call with `new Rng(77)`. That generator's first draw is 0.005548, which is below
*every* tier's per-look blunder chance — so every call blundered, every answer was the middle
notch, the middle notch is its own mirror image, and the test passed while asking the bot
nothing at all. What caught it was the counter asserting that most answers must be somewhere
other than the middle notch. The seed is now 2024, whose first draw is 0.739.

A third, found by reasoning rather than by the test but asserted alongside it: **`Math.round`
breaks ties upwards**, sending 0.5 to 1 and −0.5 to −0, so a finger exactly between two notches
would have been read differently by the two seats. The engine quantises every pointer onto a
3-unit lattice and half a pitch is 11, a multiple of 3, so that tie is an everyday event here
rather than a measure-zero one.

## The bot

It reads **one yard and no match** — `botIntent` is handed the yard, so there is nothing in
scope for it to peek at, and a test runs 200 calls and asserts the other seat is byte-identical
afterwards. Within that yard it reads the tower, the notch rail, the strip the next brainrot
must land on, the swinging brainrot, the tower's lean and the balance bar.

**Every one of those is drawn** (CLAUDE.md rule 6). The renderer puts the support strip and the
landing footprint of the held brainrot at the same height, so where they overlap is visible; it
draws the tower leaning by exactly the lean the rules use; it draws the held brainrot at its
swung position, not at its notch; and the plinth carries a balance bar showing where the weight
falls, where the edges are, and where the worst moment of the match was.

What is **not** drawn is the verdict — whether a given notch would stand. That is arithmetic
over drawn quantities and it is deliberately left as arithmetic: a game that printed "this drop
misses" would have no decision left in it. The bot is faster at sums than a person, which is
what a bot is, and it is given no quantity a person cannot see.

The policy is one line: **predict where a brainrot let go now would land, weigh all fifteen
notches on how much plinth the tower would have left afterwards less a penalty for leaving the
next brainrot an off-centre tower, walk to the best one, and let go when the swing has brought
it close enough to square.**

### The three tiers, and the two knobs that were deleted

| | reaction | aim error | blunders/s | tolerance | centring |
|---|---|---|---|---|---|
| `easy` | 0.16 s | ± 15 | 0.45 | 26 | 0.45 |
| `normal` | 0.16 s | ± 7 | 0.24 | 9 | 0.45 |
| `hard` | 0.16 s | ± 3 | 0.09 | 3 | 0.45 |

Every knob was swept **alone** across its whole range against a fixed `normal` opponent, 160
matches a point. Seat one's share of decided matches:

| knob | sweep | verdict |
|---|---|---|
| `aimError` | 0: 55.0% · 3: 57.5% · 7: 50.6% · 11: 46.3% · 15: 36.3% · 22: 25.6% | monotone, kept |
| `tolerance` | 0: 63.1% · 3: 52.5% · 6: 53.1% · 9: 50.6% · 14: 46.9% · 20: 46.3% · 30: 40.6% | monotone, kept |
| `blunders` | 0: 56.9% · 0.09: 59.4% · 0.24: 50.6% · 0.45: 44.4% · 0.8: 42.8% | monotone, kept |
| `reaction` | 0.04: 55.0% · 0.08: 51.2% · 0.16: 50.6% · 0.24: 48.8% · 0.34: 50.6% · 0.5: 47.5% | **flat — not a difficulty knob** |
| `centring` | 0: 51.2% · 0.2: 48.8% · 0.45: 56.9% · 0.8: 50.6% · 1.5: 43.8% | **a peak, not a slope — not a difficulty knob** |

Both of the last two are now **the same in all three tiers**, and both are kept rather than
deleted because both are still doing structural work:

- `reaction` is what confines a tap to a step the bot has just looked on, which is what keeps
  its prediction of the landing exact. It is not what makes one tier better than another, and
  pretending otherwise would be a knob nobody had checked the sign of. Twelvefold range, five
  points of movement, inside the noise of 160 matches.
- `centring` peaks in the middle of its range, which means it is a fact about the game rather
  than about the player: keeping the tower's top near the middle is right for everybody.

An earlier draft had a fifth knob, `patience`, a floor on the score before the bot would let go.
It swept **0: 51.2% · 8: 52.5% · 16: 51.9% · 30: 47.5% · 45: 50.0% · 60: 52.5%** — completely
flat, because the score is dominated by a term that is comfortable until very late in a match,
so the floor never bound. It was replaced by `tolerance`, which is a threshold on the thing the
player actually watches (how far off square the brainrot is), and which is monotone over 22
points of win rate. A knob you have not swept is a knob you do not know the sign of.

`aimError` is drawn **once per brainrot and held** to the drop, never per step. A fresh error
sixty times a second averages to zero and every tier plays the same — the bug
`@duelbox/game-sdk`'s `misjudgement` exists to prevent. Asserted: 40 calls on one brainrot leave
the bias unchanged, and the next brainrot gets a fresh one. Blunders freeze the bot for 0.5 s,
a duration rather than a coin flip per step, because a bot that re-decides six times a second
and hesitates for one of those has jittered rather than blundered.

### What each tier does with a brainrot

300 seeded matches per tier, both seats on the same tier, driven through the rules.

| | brainrots a seat | seats that lost the tower | of which toppled / missed | budget survived | mean match |
|---|---|---|---|---|---|
| `easy` | 14.6 | 48.7% | 4.8% / 43.8% | 51.3% | 16.7 s |
| `normal` | 18.3 | 40.0% | 5.5% / 34.5% | 60.0% | 23.2 s |
| `hard` | 19.6 | 30.7% | 3.5% / 27.2% | 69.3% | 28.0 s |

A weak pair gets fifteen brainrots down and drops the sixteenth; a strong one gets twenty and
drops the twenty-first. Roughly a third of `hard` seats still lose their tower, which is what
keeps the budget a real bound rather than a decoration — and what keeps the tie-break honest for
the other two thirds.

### Measured win rates

400 seeded matches per pairing, seeds `3 + 977n`, driven through the rules. Cell is the **row
seat's** (p1's) share of *decided* matches. Two draws in 3600; none failed to finish.

| p1 \ p2 | `easy` | `normal` | `hard` |
|---|---|---|---|
| `easy` | 48.3% | 15.8% | 7.8% |
| `normal` | 81.0% | 50.2% | 32.0% |
| `hard` | 93.8% | 64.7% | 49.8% |

**The ladder reads the same from both seat orders**, which is the check that matters: `hard`
takes 93.8% against `easy` as p1 and 92.2% as p2 (100 − 7.8); `hard` against `normal` is 64.7%
and 68.0%; `normal` against `easy` is 81.0% and 84.2%. Mean match length ran from 16.6 s
(`easy` v `easy`) to 28.5 s (`hard` v `hard`), longest 35.9 s.

### Seat balance

Equal tiers, over **four independent seed families of 400 each** — bases and strides
`3+977n`, `11+4099n`, `97+7919n`, `1231+104729n`:

| | family 1 | 2 | 3 | 4 | overall (1600) | draws |
|---|---|---|---|---|---|---|
| `easy` | 48.3% | 53.3% | 55.8% | 47.2% | **51.1%** | 2 |
| `normal` | 50.2% | 49.3% | 52.1% | 51.5% | **50.8%** | 1 |
| `hard` | 49.8% | 51.2% | 50.0% | 51.5% | **50.6%** | 0 |

And in `balance-aggregate.test.ts`'s **own** seed family (`1000003 + 7919n`), because that is
the one the gate runs:

| seeds | `easy` | `normal` | `hard` |
|---|---|---|---|
| 50 (what a push runs) | 46.0% | **40.0%** | **62.0%** |
| 250 (what nightly runs) | 46.8% | 54.0% | 52.8% |
| 1000 (the audit) | 48.6% | 49.5% | 53.5% |

The fifty-seed row is why that file's allowance is 21.2 points wide: the same game reads 40.0%
and 62.0% at fifty seeds and 49.5% and 53.5% at a thousand. Anything under a few hundred seeds
in one family here is noise wearing a suit.

**Why the share is near 50 by construction rather than by luck.** Both seats are dealt the
identical brainrots by index; the two yards are exact half-turn images and are asserted to be,
board by board, in the mirror test; neither yard can read the other, asserted by playing one
seat flat out and the other not at all and comparing the untouched seat against a solo run. The
one residual asymmetry is the fixed order in which the two bots draw from the shared generator,
and that is what the 0.6–1.1 points above 50 are.

## Presentations

See `docs/presentation.md`; nothing here re-decides it.

- **Shared-screen** — the two yards stack, p1's plinth along the bottom edge and p2's along the
  top, with a gutter between that belongs to neither. The layout is a point reflection about the
  centre of the field, so both players read their own tower upright with their own plinth
  nearest them and neither sees more of anything than the other. Nothing rotates: there are no
  turns, so there is nothing to flip, and the shell keeps a pointer zone for each seat.
- **Single-seat** — the local seat owns the viewport. The simulation is byte-identical; only
  placement changes. `game.test.ts` asserts a `single-seat` match on seat two traces identically
  to a `shared-screen` match on seat one from the same seed, over 900 steps and both yards.
- **A tall tower scrolls**, by the same rule for both seats and derived from that seat's own
  tower alone, so neither player ever sees more of their own yard than the other sees of theirs
  (rule 9). The scroll lives in the renderer; the simulation has no idea a window exists. The
  plinth and its balance bar are **pinned** rather than scrolled, because the plinth edge is
  what the whole match is measured against and a player must be able to see it however tall
  their tower has got.

## Colour is never the only signal

Rule 7, and it is checked from draw calls rather than promised:

- **Seat one's brainrots carry a filled circle; seat two's carry a stroked frame.** Two
  different primitives, at fixed sizes, drawn in that seat's own `deep` ink so the harness
  attributes them without needing the ornament rule. `game.test.ts` plays a match, records every
  frame, and asserts that `circ` appears only in seat one's ink and `srect` only in seat two's —
  and that seat one's stud is one radius rather than a readout, because a size that tracks a
  quantity is not a glyph.
- **The plinth posts differ too**: seat one's are solid, seat two's are notched.
- **The two halves are two distinguishable shades** in a monochrome capture.
- **Kinds are told apart by silhouette** — a blob is wide and low, a tooth narrow and tall — and
  by width, which is the quantity that matters and is the quantity you can see.

## What is not specified here

- Sound. No game in the collection has it yet.
- Reduced motion: the fall arc and the landing flash are the only motion this game adds beyond
  the simulation, and neither is currently gated on the preference.
- The `roundSeconds: 45` on the manifest is a catalogue label and ends nothing. The real bounds
  are `PIECE_CAP` and `ROUND_SECONDS`, both in `rules.ts`.
- Whether a *human* pair reaches the budget more often than `hard` does. Every number above is a
  bot measurement. A person can plan two brainrots ahead and this bot cannot, so the budget may
  matter more in real play than 69% suggests.
- No assets ship, so there is no `assets.license.json`: everything is drawn with engine
  primitives, which is why asset licensing is cheap here.
