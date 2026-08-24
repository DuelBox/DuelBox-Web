# Taxi Race — specification

**Archetype:** `rt-race` · **Category:** Racing · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~40 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

The fourth `rt-race` game in the catalogue and the first with a **second verb**. Racing Cars
asks one question — where across the road to be — and Road Dodge asks it discretely. This
one asks that question and adds a second: *now*. Some traffic can be driven round and some
cannot, and the difference between the two is the whole game.

## Observed rules

> "Drive your taxi past the other cars or jump over them. Swipe your finger to the left,
> right or up."

Two sentences, and between them they fix four things: there are other cars; you may go
*past* them; you may go *over* them; and the instrument is a finger with three directions.
Everything else below is **[ours]** — how many lanes, how fast, how long a jump lasts, what
a jump costs, and what makes some traffic un-passable so that "or jump over them" is a real
sentence rather than a decoration.

## The road

Read out of `src/rules.ts` rather than from memory.

| | Value | Why |
|---|---|---|
| Road | 480 units wide (`ROAD_HALF_WIDTH` 240 either side of the centre line) | Four lanes that a taxi can cross in three quarters of a second |
| Lanes | 4, `LANE_PITCH` 120 apart (−180, −60, +60, +180) | Four is the smallest count where "one lane left open" and "all four blocked" are both common |
| Taxi | half-width 32, half-length 60 | The half-width decides whether a lane fits it; the half-length only sets when contact registers |
| Traffic car | half-width 36, half-length 50 | |
| `CLEARANCE` | 68 = 32 + 36 | **Larger than half a lane pitch (60)**, so a taxi cannot thread between two blocked lanes. This is what makes "past *or* over" the only two options |
| Free-lane slack | 52 units either side of a lane centre | Arriving is a band, not a knife edge — and wider than `STEER_SNAP` |
| `HIT_ALONG` | 110 | Under half a cell (150), so a whole collision lives inside the traffic's own cell |
| Cell | 300 units, traffic in the middle of it | |
| Route | 62 cells = 18 600 units | Median 36–44 s; see *Measurements* |
| Calm start | 3 cells | Nobody meets traffic before they have looked at the road |
| Visible road ahead | 720 units | Both windows are this deep — rule 9 |
| Speed | 300 → 580 units/s, wind-up 7 s | |
| Spin after a crash | 0.9 s crawling at 120 units/s | Never zero: a taxi that stops is a race that never ends |
| Steering | 640 units/s, easing inside the last 22 | One rate for every instrument, and it is also a *proof* — see below |
| Hop | 420 units of road, `SETTLE_SECONDS` 0.18 after landing | A length, not a hang time |
| Landing | wind-up × 0.55 | The price of the safe way past |
| Round clock | 105 s | The fallback, not the mechanism |

### One road, read by both seats

`fillTraffic` writes a single `Int8Array` and both taxis index it at their own distance.
There is **no second sequence that could diverge** — the two drivers are not facing similar
traffic, they are facing the same cars in the same order. A cell's value *is* the bitmask of
its blocked lanes, so `CLEAR` is 0 and `JAM` is 15; there is no packing and no unpacking.

Four draws per queue, always, whether or not the last two change anything. Drawing the
shape only once the ramp has opened it works — the stream is deterministic either way — but
it couples the sequence of lanes to the sequence of shapes, so a tuning change to
`maxBlockAt` would silently rearrange every route in the game. `rules.test.ts` counts them.

### The three ramps

All functions of the cell index alone, so they are the same for both seats at every moment.

| cells | `reachAt` (lanes the open one may move) | `spacingAt` (clear cells after a queue) | `maxBlockAt` | jam chance |
|---|---|---|---|---|
| 0–15 | 1 | 3 | 1 | 16 → 21 % |
| 16–35 | 2 | 2 | 2 | 21 → 26 % |
| 36–61 | 2 | 1 | 3 | 26 → 34 % |

A jam always takes the widest spacing (`JAM_SPACING` 3), whatever the ramp says, and that
is a **correctness** rule rather than a difficulty one: a taxi in the air cannot steer, so
it comes down wherever it left the ground.

Measured over 400 seeded routes: **19.2 queues a route, of which 4.85 are jams.**

### Why the route is always drivable — the one piece of arithmetic that had to close

`STEER_SPEED` is not a taste. Two derived constants bound the worst case:

- `MAX_SIDESTEP` = `ACROSS_LIMIT` + `LANE_PITCH`/2 + `CLEARANCE` = **336 units**. The widest
  move two consecutive queues can ever ask for: from one kerb to the near edge of the safe
  span around the outermost lane on the far side. `rules.test.ts` checks this against *every
  one of the fifteen masks* rather than sampling.
- `MIN_QUEUE_GAP` = 2 × `CELL_LENGTH` − 2 × `HIT_ALONG` = **380 units**. Queues stand at
  least two cells apart, the taxi may not leave the first until `HIT_ALONG` past its centre,
  and must be in place `HIT_ALONG` before the second.

336 / 640 = **0.525 s** against 380 / 580 = **0.655 s** — a fifth of the time to spare.

**The first draft was `STEER_SPEED` 500 and it did not close.** A walk over four thousand
seeded routes, carrying the *set* of positions a driver may legally be in rather than the
line the generator threaded, found a route that asked 336 units of a driver who had 328
units' worth of time — so a taxi at the kerb at full speed was clipped by traffic it could
not avoid, about once in four thousand routes. That distinction matters: a check that only
follows the generator's own intended line proves the route is drivable *by the generator*,
which is not the claim. The walk is now `rules.test.ts`'s "holds on every generated route,
from every legal resting place", and the worst ratio it finds is **0.80**.

### Why a hop is a length and not a hang time

A fixed hang time covers `speed × seconds` of road, so a taxi at a standing start would come
down inside a jam that the same taxi at full speed sails over — the same input producing
opposite outcomes for a reason the player cannot see. `HOP_LENGTH` is spent against the
distance travelled instead.

To clear a jam the taxi must leave the ground before the danger span begins and land after
it ends, so the launch point must lie in `[centre − (HOP_LENGTH − HIT_ALONG), centre −
HIT_ALONG]`. Both of the numbers the game uses fall out of that rather than being chosen:

- `HOP_AIM` = `HOP_LENGTH` / 2 = **210** units before the traffic — the middle of the window.
- `HOP_WINDOW` = `HOP_LENGTH` / 2 − `HIT_ALONG` = **±100** units of room around it.

Swept in `rules.test.ts` at five-unit intervals: the cleared launch points run from
**−315 to −115** relative to the jam's centre at *both* a standing start and full speed —
the predicted [−310, −110] shifted by the single step the taxi overshoots its trigger by.
That the two speeds give the same window is the whole point of the rule.

## Scoring and the win condition

**Score is city blocks driven; the winner is the first taxi to `RACE_DISTANCE`.** Resolved
by the SDK's `resolve()` with `{ kind: 'first-to', target: RACE_DISTANCE }` over the two
taxis' *distances*, with `timeExpired` set once the round clock is out — so "first past the
post" and "level when the clock runs out is a draw" mean exactly what they mean in every
other game.

Resolved on **distance**, not on the block count the scoreboard prints. The count is the
distance rounded down, so deciding on it would turn a race that reached the clock a taxi's
length apart into a dead heat.

### The photo finish

There is one place a distance cannot separate two taxis, and it is the finish itself: both
are pinned to `RACE_DISTANCE` the moment they cross, so a step in which both crossed holds
two identical distances however far apart they actually were. At full speed one step of road
is 9.7 units, so *any* two taxis within nine units of each other at the line arrived on the
same step — and judging on distance alone called every one of those a dead heat. Measured
over four hundred seeded matches of two `hard` bots that was **18.5 %** of them, and seven
in eight had a taxi that had genuinely crossed first, one of them by 3.7 units and 7.4
milliseconds.

The line is not crossed on a step boundary, though; it is crossed at a knowable instant
*inside* the step. `stepTaxi` works that instant out from the distance left over past the
line — the overshoot is the fraction of the step that happened *after* the crossing — and
records it as `Taxi.finishOffset`. Because the match ends the instant the *first* taxi is
home, a step with both taxis home is always the same step, so that one case is settled on
the two instants, put to the SDK's own `resolveSimultaneous()` rather than to a comparison
written again here.

`FINISH_TOLERANCE` is **0**, and that is a claim rather than a shortcut. The SDK's default
allows eight milliseconds because it is written for two people on two devices, where the two
times are *measurements* and carry a measurement's noise. Nothing is measured here: both
taxis are stepped by one loop through the same arithmetic on the same road, so two identical
races produce two identical instants to the last bit and any difference at all is a real
difference in how the race was driven. With it, `hard` against `hard` draws **1.5 %** of the
time and none of those is separable by crossing time — they are races that really were
identical.

There is no restart after a score: one race, one result, and the shell's rematch starts a
fresh one.

### How the match is guaranteed to end

`roundSeconds` in the manifest ends nothing — it prints a number on a catalogue card — so
the guarantee lives in `ROUND_SECONDS` in the rules, and the number is the multiplied-out
worst case rather than a round figure.

A taxi always moves forward, so the slowest a race can go is a driver who hits every single
queue. `SPIN_SECONDS` of spinning covers 0.9 × 120 = **108 units**; the remaining
600 − 108 = **492 units** to the next queue take at least 492 / 300 = **1.64 s** at the
post-crash speed. That is 600 units per 2.54 s = **236 units a second**, and the route is
18 600 units: **78.8 s**. Hopping cannot be slower, because a hop never drops the taxi below
`SPEED_SLOW`; a driver who hops everything settles at **307 units/s** (measured; the
fixed point of `b → (b + 0.18/7) × 0.55` predicts 310).

`ROUND_SECONDS` is **105 s**, a third above that, and a sixth of the ten-minute ceiling
`apps/web/src/data/termination.test.ts` allows any game.

Measured rather than argued: a driver steering deliberately into every queue on 300 seeded
routes finished the worst of them in **66.9 s**.

## Controls

| seat | keyboard | pointer |
|---|---|---|
| p1 | `A` / `D` steer, `W` hops | finger anywhere in the bottom half: its **x** names the lane, a flick of ≥ 90 units towards the divider hops |
| p2 | `←` / `→` steer, `↑` hops | finger anywhere in the top half: its **x** names the lane *in seat two's own frame*, a flick of ≥ 90 units towards the divider hops |

`S`, `↓`, `Space` and `Enter` do nothing, and `game.test.ts` asserts each of them moves
nothing — driven through a real `InputManager`, not a hand-rolled input object.

**How the two combine: there is no mode.** While a finger is down it has the last word on
the lane, because it names a *place* and a key only names a sign; the hop fires on a flick
**or** on the up key's rising edge, whichever arrives. A player with a keyboard and a
touchscreen may use either at any moment.

**Keys need no mirror.** `D` is seat one's right and `→` is seat two's right whichever way
up either of them is sitting, and `across` already means "towards this driver's own right",
so the keyboard path is one line for both seats. The same is true of the flick:
`pointerAlong` measures from each driver's own edge of the device, so "up the road" is
+y in device coordinates for seat two and −y for seat one, and the gesture is one comparison.

**The sign is taken, not the component.** The engine normalises two keys at once to
(0.707, 0.707), so a player holding `D` and `W` would otherwise steer three-quarters as
hard as one holding `D` alone.

**The flick is a ratchet, not a threshold.** The base follows the finger *down* the half and
only moves up when a hop has been taken — so a slow slide the length of the half costs a
handful of hops rather than three hundred, a slide back down arms the next one, and a finger
resting anywhere at all asks for nothing. Measured in `game.test.ts`: 400 units of slide in
40 steps yields between 1 and 5 hops.

### Input parity

The manifest deliberately does **not** declare `sameInputClassOnly`, which the other
four-lane `rt-race` game (Road Dodge) does. Road Dodge's interaction *is* rapid discrete
input — a lane change per press — and no keyboard and thumb are equal at that. Here the
steering asks for a *place*: a finger names it, a key walks towards it, and both arrive at
exactly `STEER_SPEED`. The one discrete act is the hop, and what limits a hop is the
suspension (0.18 s of settle on top of a 420-unit flight), not how fast an instrument can
ask for one. `game.test.ts` drives one script through both instruments and gets the
**identical 13 hops** and distances within 20 % of each other.

## Edge cases

- **Simultaneous input.** Both taxis are stepped every frame from both seats' instruments,
  and both are driven before either is judged — so a step in which both cross the line is
  the dead heat it actually is, rather than a win for whichever seat the loop ran first.
- **No input at all.** A taxi drives itself forward and holds its lane. It will meet traffic
  in the middle of the road and crash, and it still finishes: the guard drives exactly this
  case and the clock is above the worst case regardless.
- **Input in the other seat's zone.** A pointer belongs to the seat it went *down* in and
  keeps that seat across the midline — the engine owns this and the game never reimplements
  it. `game.test.ts` drags a finger from y = 900 to y = 200 and asserts it is still seat
  one's steering and that seat two's taxi has not moved.
- **A taxi in the air.** Cannot steer, cannot be touched by traffic, cannot hop again, and
  its wind-up neither climbs nor decays. All four are the cost of committing.
- **Landing in traffic.** A hop launched more than 100 units too early comes down *inside*
  the danger span and crashes on the landing step, exactly as if it had never jumped. This
  is avoidable by jumping earlier and is what makes the timing a skill.
- **Hopping after a crash.** Refused while the taxi is spinning. Once the spin ends the taxi
  is immune to the queue it hit, so a hop taken then is a wasted one — the counters record it
  as a hop with no queue cleared, which is what it is.
- **A queue is credited once.** At the moment the taxi is *fully clear* of the danger span,
  not at its middle — so a taxi that came down among the cars is not credited with having
  got over them.
- **Stalemate.** There is none available. Every branch of `stepTaxi` adds strictly positive
  travel, so both taxis approach the line monotonically and the clock is a second net.

## Determinism

- **All randomness is seeded.** One `Rng`, handed in by the host. The road is drawn from it
  before any bot has spent a draw, so two matches on one seed face the identical traffic
  whoever sits in either seat — asserted in `game.test.ts`.
- **Bot draws are a fixed count.** Four floats per look, unconditionally, whatever the bot
  goes on to decide. A seat whose draw count depends on its decision shifts the *other*
  seat's stream, which is a seat bias rather than a coincidence.
- **The wind-up is integrated analytically, not by a rectangle rule.** Speed is linear in
  time, so the midpoint of a step is its exact average and the sum of the steps *is* the
  integral. Five seconds from a standing start is 300 × 5 + 280 × 25 / 14 = **2000 units**,
  and 60, 90, 120 and 144 Hz all land on that number rather than near it. A rectangle rule
  would have put 60 Hz and 144 Hz several units apart, which is a different race on a
  different monitor.
- **A hop holds speed constant**, so the flight is exact arithmetic rather than an
  integration at all.
- **Delays that are events** — the spin, the settle, the hop trigger — land on step
  boundaries and are snapped rather than carried over, so a bar a renderer draws never runs
  past its own end. Like every fixed-step game, an *event* can therefore fall one step
  earlier or later at a different rate; a *trajectory* cannot.
- **Nothing allocates per step.** The step result and the win tally are module-scope objects
  rewritten in place; the road is one array allocated at construction; the bot's state and
  the seats' gesture latches are preallocated records.

## The bot

**What it reads:** the nearest queue within `BOT_LOOKAHEAD` = **620 units** of its own taxi,
and its own taxi's position. Nothing else.

`BOT_LOOKAHEAD` is bracketed from both sides by this game's own numbers rather than carried
over from the four-lane sibling, which declares the same 620 against a window **900** deep
where it is 69 % of what a person sees; here `VISIBLE_AHEAD` is **720** and the same number
is 86 % of it, so the sibling's margin does not transfer.

- **Below `VISIBLE_AHEAD`**, which is rule 6 made arithmetic.
- **Below 651**, which is what a jam actually costs to answer: the launch point is `HOP_AIM`
  = 210 units before the traffic and the slowest tier takes up to `reaction + waver` = 0.76 s
  to decide, which at `SPEED_FAST` is 441 units of road. A bot that could see 651 would
  always have time to think. At 620 the weakest tier is still deciding when it should already
  be in the air, while `hard` needs `0.15 s × 580 + 210` = 297 units and is never pressed —
  which is exactly the measured split of jams cleared, 49.7 % against 99.9 %.

**The depth is measured to the traffic, not to the cell it stands in.** Walking cells and
stopping at `cellOf(distance + lookahead)` sounds like the same thing and is not: a taxi 280
units into a cell reached three cells out, whose traffic stands **770** units up the road, on
a 620-unit look. A person's window keeps drawing a car until its tail leaves the band, which
is 788 units, so rule 6 was being kept by **eighteen units nobody had measured** while the
test asserted the inequality of two constants that were not the operative bound. Comparing
the traffic's own position costs one subtraction, holds the bot to 620 at every point on the
road, and puts the margin at 168 units. `rules.test.ts` sweeps every position in a cell and
measures the road the bot actually reaches; `game.test.ts` measures the furthest traffic the
*renderer* really puts on the glass and asserts the order between the two.

It never gets a faster taxi, quicker steering, a longer hop or a longer look. The tiers
differ only in *when* they notice and *how well* they aim:

| | reaction (s) | waver (s) | blunder | `hopSlip` (units) |
|---|---|---|---|---|
| easy | 0.46 | 0.30 | 28 % | ±190 |
| normal | 0.24 | 0.14 | 12 % | ±110 |
| hard | 0.10 | 0.05 | 2 % | ±40 |

A blunder is one lane wide of the open one, or — at a jam — not planning the hop at all.
`hopSlip` is the error in the launch point against a window that is only ±100 units wide, so
`easy` misses a jam roughly half the time and `hard` essentially never does. It is the tier
difference the game is named after.

The hop is *planned at a look* and *executed by the taxi's own odometer*, which is how a
person plays it: you see the jam, you decide where you are going to jump, and you jump
there. The reaction delay is on the deciding, which is the part a reaction time is about.

## Measurements

All from seeded bot-vs-bot matches driven through the public `Game` API — `create()`,
`init()`, `update()` — with the same code the shell runs.

**Match length** — 300 matches per tier, 900 in all:

| tier | median | fastest | slowest |
|---|---|---|---|
| easy | 44.4 s | 36.6 s | 52.6 s |
| normal | 39.3 s | 34.4 s | 45.5 s |
| hard | 36.1 s | 34.1 s | 42.0 s |

Nothing failed to finish. `roundSeconds` on the card is **45**, which is the honest middle
of that; it ends nothing, and `ROUND_SECONDS` = 105 s is what does.

**The headline verb, counted — and counted from the outside.** The numbers below are not
`Taxi.passed` and `Taxi.vaulted` read back out of the simulation that maintains them. They
are reconstructed from sampled kinematics alone: for every cell holding traffic, whether the
taxi was airborne for the whole of that queue's danger span, on the ground for the whole of
it, or caught by it. Per taxi, per match, 600 taxis a tier:

| tier | queues driven past | queues hopped over | hops taken | crashes |
|---|---|---|---|---|
| easy | 10.70 | 2.37 | 3.09 | 5.32 |
| normal | 11.87 | 4.19 | 4.29 | 2.24 |
| hard | 13.40 | 4.77 | 4.80 | 0.52 |

A route carries 19.3 queues of which 4.9 are jams, over 400 seeded routes; 1 route in 3000
holds no jam at all.

**Both halves of the rule happen, and the jam is the proof the second one is needed.** Swept
at half-unit intervals from kerb to kerb, *every* lateral position on the road is caught by a
jam — `CLEARANCE` 68 > `LANE_PITCH / 2` 60, so there is no gap to thread — so a jam is
passable only in the air. Of the jams the tiers actually met over 200 matches each:

| tier | jams met | cleared in the air | crashed into | came down among them |
|---|---|---|---|---|
| easy | 1914 | 49.7 % | 48.9 % | 1.5 % |
| normal | 1920 | 89.7 % | 9.6 % | 0.7 % |
| hard | 1955 | 99.9 % | 0.1 % | 0.0 % |

No match at any tier had a taxi that drove past no queue at all. Four `easy` matches in 300
(1.3 %) had neither taxi clear a queue in the air, and 47 single `easy` taxis in 600 (7.8 %)
hopped nothing — `easy` crashes into about half the jams it meets, which is what `easy`
is for. On `normal` and `hard` it is zero of 300 and zero of 600.

**The ladder**, both seat orders, over three independent seed families of 100 seeds each
(200 matches per cell):

| | family A | family B | family C |
|---|---|---|---|
| normal beats easy | 85.0 % | 93.0 % | 90.5 % |
| hard beats normal | 83.5 % | 82.5 % | 86.0 % |
| hard beats easy | 99.5 % | 99.5 % | 98.5 % |

`hard` against `easy` is **saturated** and is reported as such rather than quoted as a
tuning success.

**Seat bias**, same tier both seats, 200 seeds per family:

| | family A | family B | family C |
|---|---|---|---|
| easy, p1 wins | 47.0 % | 51.0 % | 57.0 % |
| normal, p1 wins | 53.5 % | 52.0 % | 52.5 % |
| hard, p1 wins | 50.5 % | 48.0 % | 49.5 % |

No consistent bias; the spread is what 200 matches resolves. Draws are now 0 % at every
pairing but `hard` against `hard`, where they are 1.5 % and every one is a race the two
bots drove identically — see the photo finish above for the 18.5 % they used to be, and for
why calling those a dead heat was wrong rather than deliberate.

## Presentations

**Shared-screen.** Two windows on the same road, one above the other, split at y = 500. Each
seat's taxi sits at the edge of the box nearest them and the road runs away from them. Every
shape is authored once in the near seat's frame and mapped through a point symmetry about
the centre of the box — not a mirror — so `across` means "towards my own right" for both
drivers and no shape has a handedness to get wrong. The play area never rotates: both taxis
are live at once, `getActiveSeat()` returns `null`, and the shell keeps a pointer zone per
seat.

`game.test.ts` asserts the property directly: apart from the cab itself, every shape one seat
is shown is a shape the other seat is shown, turned half a turn. Both windows are
`VISIBLE_AHEAD` deep, so neither driver ever sees further up the road than the other
(rule 9).

**Single-seat.** Identical simulation; the local seat owns the whole viewport upright.
Nothing in the game reads `presentation` — `game.test.ts` plays the same seed in both and
compares the whole match state.

### Rule 7 — colour is never the only signal

- Seat one's cab has **one narrow roof lamp and a solid stripe down its spine**; seat two's
  has a **wide roof lamp and a three-square chequered flank**. Different silhouettes, and
  `game.test.ts` asserts the two differ.
- A taxi in the air is **lifted up its own window, drawn larger, and leaves its shadow on the
  road** — three signals for the one state a driver most needs to read.
- A jam is not "four cars instead of two": its cars carry a **hatched roof** no ordinary
  traffic has, and a **striped ramp** is painted across the road at exactly `HOP_AIM` before
  it — the same point the bot aims at, so the picture tells a player precisely what the bot
  knows and nothing more.
- A spinning taxi is **struck through** and carries a recovery bar.
- The route strip along each seat's own edge carries a **solid** tab for its own taxi and an
  **open** one for its rival, and the hop pip is an upward chevron that fills when a hop is
  available — so it says *which way the gesture goes* as well as whether it is armed.

## What is not specified here

- The catalogue card advertises 75 s for this game while the manifest declares the measured
  45 s. The catalogue is generated data this package does not own.
- The shell's rematch always draws a fresh road from the host's generator. Whether a rematch
  should be able to replay the *same* road — a rematch on identical traffic is a purer test
  of two drivers — is not decided here.
- Nothing in the game reads the interpolation alpha. If the shell ever runs the simulation
  below the display rate, the cab and the traffic will step visibly; a render-time
  interpolation would be a separate change and is not attempted.
