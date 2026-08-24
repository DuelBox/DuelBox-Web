# Racing Cars — specification

**Archetype:** `rt-race` · **Category:** Racing · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~45 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

The second `rt-race` game in the catalogue, and the first that is a *race* rather than a
survival contest: there is a finish line, both cars always reach it, and the winner is
whoever gets there first.

## Observed rules

> "Compete against your opponent and finish first! Move your finger to drive the car."

Two sentences, and between them they fix exactly three things: it is a race, it is decided
by arriving first, and the instrument is a finger that *steers* rather than taps. Everything
below is **[ours]**.

## The field

| | Value | Why |
|---|---|---|
| Road | 520 units wide (`ROAD_HALF_WIDTH` 260 either side of the centre line) | Wide enough that a gate is a choice; narrow enough to cross in a second |
| Car | half-width 30, half-length 80 | The half-width is what has to fit a gap; the half-length only sets when contact registers |
| Gate slots | 5, `SLOT_PITCH` 82 apart (−164 … +164) | A gap that can be *anywhere* is one you have to measure; the game asks which way and how soon, not how precisely |
| Gate width | wide half 96, narrow half 62 | 164 + 96 = 260 exactly, so the outermost gate is fully on the road |
| Cell | 300 units; barrier half-length 60 | `HIT_ALONG` (140) < half a cell (150), so a whole collision lives in one cell and the test looks at one cell |
| Race | 64 cells = 19 200 units | ~35 s flat out, ~51 s for two weak drivers |
| Calm start | 2 cells | Nobody meets a barrier before they have looked at the road |
| Visible road ahead | 900 units | Both windows are this deep — rule 9 |
| Speed | 320 → 640 units/s, wind-up 9 s | |
| Spin | 0.85 s, crawling at 130 units/s | Never zero: a car that stops is a race that never ends |
| Steering | 460 units/s, easing inside the last 24 | One rate for every instrument — see *Input parity* |
| Round clock | 110 s | The fallback, not the mechanism |

**One track, read by both seats.** `fillTrack` writes a single `Int8Array` and both cars
index it at their own distance. Two independently generated roads would be fair only *on
average*, and a race is run once: a driver who drew four gates across the road while their
opponent drew a straight has lost to the seed rather than to the other player. There is no
second sequence that could differ from the first.

### The two ramps

The track gets harder in two unrelated ways at once, and both are functions of the cell
index alone — the same for both seats at every moment:

| cells | `reachAt` (slots a gate may move) | `spacingAt` (clear cells after a barrier) | narrow-gate chance |
|---|---|---|---|
| 0–15 | 1 | 3 | 0 → 14 % |
| 16–33 | 2 | 2 | 14 → 29 % |
| 34–63 | 3 | 1 | 29 → 55 % |

The reach grows while the room to use it shrinks. A gate goes from something to react to
into something to commit to: at the top of the ramp the widest change is 246 units of road
and there are 600 units of track to make it in — 0.53 s of steering inside 0.94 s of
travel — so nothing becomes impossible and everything becomes early. `rules.test.ts`
asserts that inequality for every cell of the track rather than leaving it as a comment.

Two draws per barrier, always, whether or not the second changes anything. Drawing the
width only once the ramp has opened it works — the stream is deterministic either way — but
it would couple the sequence of slots to the sequence of widths, so a tuning change to the
narrow-gate ramp would silently rearrange every track in the game.

## Scoring and the win condition

**Score is cells cleared; the winner is the first car to `RACE_DISTANCE`.** Resolved by the
SDK's `resolve()` with `{ kind: 'first-to', target: RACE_DISTANCE }` over the two cars'
*distances*, with `timeExpired` set once the round clock is out — so "first past the post",
"both on the same step is a draw" and "level when the clock runs out is a draw" all mean
exactly what they mean in every other game.

Resolved on **distance**, not on the cell count the scoreboard prints. The count is the
distance rounded down, so deciding on it would turn a race that reached the clock a car's
length apart into a dead heat.

There is no restart after a score: one race, one result, and the shell's rematch starts a
fresh one.

### How the match is guaranteed to end

A race has two classic ways to run for ever — a car crashed into a permanent stop, and a
finish line a bad enough driver never reaches — and this game closes both:

1. **A spinning car keeps moving.** `SPEED_SPIN` is 130 units/s, not zero. There is no state
   in which a car's distance stops increasing before the line.
2. **A barrier cannot catch the same car twice.** `Car.hitCell` records the cell that caught
   it. Without this a spinning car — still inside the barrier it hit for most of a second —
   is caught again on every one of the next fifty steps and never leaves it.
3. **The clock calls it on distance.** At `ROUND_SECONDS` = 110 s, `resolve` settles on the
   further-travelled car; exactly level is a draw. This is a *fallback*, not the mechanism:
   over 3 600 seeded bot races the longest was **59 s**, and a race where both drivers hold
   a kerb and clip nearly every gate on the track still comes home inside the clock.

`termination.test.ts` plays two `easy` bots and allows ten simulated minutes. The slowest
`easy`-versus-`easy` race measured is 59 s.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Player one | Slide a finger across the lower half; the car drives to it | `A` / `D` |
| Player two | Slide a finger across the upper half; the car drives to it | `←` / `→` |

Both express one thing — *where across the road to be* — and both end at the same
`STEER_SPEED`. A finger names the point directly; a key names a direction, which is the
same ask with the point at the end of the road. There is no mode to switch between them:
a finger down wins over a held key, because a finger names a place and a place is more
specific than a direction. With neither, the car holds its line.

**The keys need no mirror, and that is the part worth noticing.** `D` is player one's right
and `→` is player two's right whichever way up either of them is sitting, and `across`
already means "towards this driver's own right" — so the keyboard path is one line for both
seats and cannot get the mirror wrong. The *pointer* does need the mirror, and gets it from
the same point symmetry the drawing uses.

## Input parity — and why this game does **not** declare `sameInputClassOnly`

Road Dodge, the other `rt-race` game, declares it, and is right to: its interaction *is*
rapid discrete input — a lane change per press — and no thumb repeats as fast as a key.

This game asks for a **place**, not a press. Every instrument arrives at that place at
exactly `STEER_SPEED`; there is nothing to repeat, and therefore nothing to repeat faster.
A finger that is already where it wants to be is worth precisely what a held key is worth.
`control-parity.test.ts` drives seat one with one seeded script expressed twice, as keys and
as a finger, over fourteen seeds, and the two win at the same rate.

## Edge cases

- **Steering off the road.** Clamped at the kerb. A gate is never wholly outside the reachable
  band, so the clamp never traps a car outside a gap it needed.
- **A finger past the kerb, or off the board entirely.** Clamped to the edge of the road, so
  a thumb on the bezel is hard-over rather than nothing.
- **How far up or down its own half a finger is.** Never read. The one thing this game asks
  is how far *across* the road to be, so a thumb resting low and a thumb reaching high say
  exactly the same thing — which is also what stops the two halves' different comfortable
  reaches from meaning different things.
- **A finger whose position is not a number.** Reads as no steering. One `NaN` reaching
  `across` poisons every step after it, so the guard is at the one door every source of
  steering goes through (`clampSteer` in `stepCar`), not at each call site.
- **Two direction keys at once.** The engine normalises the movement vector, so a diagonal
  reads as part-lock. Two keys never out-run one.
- **A finger in the other seat's half.** Belongs to whoever put it down there — the engine's
  `PointerOwnership` decides that, and a drag that crosses the divider keeps feeding the seat
  it started in. The game never sorts pointers itself.
- **Input during a spin.** Ignored entirely. The car is not being driven; that is the penalty.
- **Both cars crossing the line on the same step.** A draw, decided after both have been
  stepped, so it is not settled by whichever seat the loop happened to run first.
- **No input at all.** Both cars drive themselves down the middle of the road, clip the same
  gates at the same moment and dead-heat. This is the shortest path to a finished match.
- **A key or finger held through a pause.** Nothing is latched, so nothing can go stale.
  `onPause` and `onResume` have nothing to do and say so.

## Determinism

- Every gate slot and width comes from the seeded RNG, drawn once at `init` before any bot
  has spent a draw, so the same seed is the same track whoever is sitting in either seat.
- Nothing reads a clock. `stepCar` takes `fixedDeltaSeconds` and the whole simulation is a
  function of (state, steering, delta).
- **The distance integral is step-size independent.** The wind-up is a straight line in
  time, so the step uses the *mean* speed over it — its midpoint — rather than the speed at
  either end. Five seconds of racing covers the same ground whether it arrived as 300 steps
  or 600, which `rules.test.ts` measures. A rectangle rule here would make the game a
  measurable fraction faster on one refresh rate than another.
- Collision sampling and the steering integrator are still per-step, as they are in every
  fixed-timestep game; the shell's `FixedLoop` is what makes that a constant.
- `cross-viewport.test.ts` steps the identical trace at five viewports from 320 px to 4K and
  compares raw floats.

## Seat fairness

The property this game is most exposed to, and the one most tested:

- **One track object**, indexed by both cars. Not two tracks that agree.
- **`rules.test.ts` — "gives two cars driven the same way bit-identical races"**: an
  identically driven pair is compared field by field on *every step* of a ninety-second race,
  not merely at the end.
- **"gives the mirrored race the mirrored result"**: two scripts, swapped between the seats,
  over four seeds. Every number swaps with them and the winner mirrors.
- **`game.test.ts` — "gives both seats the same road, shape for shape"**: the drawn frame is
  split into the two seats' shapes, the far seat's turned half a turn, and the two compared
  shape for shape. Only the patch the car itself occupies is cut out — because rule 7 requires
  the two cars to differ in silhouette — and the same patch is cut from both. A one-cell
  offset introduced into one seat's road markings fails it.
- **Measured**: 400 seeded races per tier, self-play — `easy` 193/207, `normal` 220/180,
  `hard` 170/176 with 54 draws.

## The bot

It reads its own road and nothing else: the nearest barrier within `BOT_LOOKAHEAD` = **620**
units, and the point across the road its gap opens at. With nothing in sight it heads for
the middle, which is never more than two slots from any gate. It cannot see a barrier the
generator has not placed, cannot see the other car, and steers through the identical
`steerFor` a finger does — so it has no way to cross the road sooner than a person, because
there is no such way.

620 is below the **900** a person's window shows (rule 6): the bot is the worse-informed of
the two drivers at every moment of the race.

| Tier | Reaction | Waver | Blunder | Crashes / race | Wins vs. the tier below |
|---|---|---|---|---|---|
| easy | 0.50 s | 0.30 | 30 % | 10.8 | — |
| normal | 0.26 s | 0.14 | 12 % | 6.0 | **92.5 %** vs easy |
| hard | 0.11 s | 0.05 | 1.5 % | 1.5 | **98.2 %** vs normal, **100 %** vs easy |

Measured over 400 seeded races per pairing, from **both** seats — an ordering that only
holds for whoever happens to be p1 is not an ordering, it is a seat advantage. Self-play
race length falls with skill too: `easy` 51.1 s, `normal` 43.5 s, `hard` 35.0 s.

Two things about the shape of this bot are worth carrying to the next one:

1. **A blunder is a slot's worth of misread, not a random line.** Aiming somewhere arbitrary
   is a different game; being one lane out is what a driver who glanced too late actually
   does, and it is reliably punished — a slot pitch is 82 and even a wide gate's window is
   only ±66.
2. **All three draws are taken on every look, used or not.** A seat whose draw count depends
   on what it decided shifts the other seat's stream, and that is a seat bias rather than a
   detail — Fruit Duel gave p1 thirty wins in forty from exactly that. `rules.test.ts` counts
   them.

## Presentations

- **Shared-screen** — two windows on the same track, one above the other, the far seat's
  turned half a turn about the centre of the box. Point symmetry rather than a mirror: each
  player's car sits at the edge nearest them, the road comes towards them, and "my right"
  means the same thing to both. Both windows are 900 units deep (rule 9).
- **Single-seat** — the identical picture. **Nothing in this game reads the presentation**,
  which is the point: rule 10 is kept by there being no branch to get wrong rather than by
  branching correctly. `game.test.ts` plays the same seed under both and compares outcomes.

## Rendering

The interpolation `alpha` is deliberately not read: distance and `across` are continuous
values the simulation already carries at full resolution, so a frame is the state as it
stands rather than a guess between two of them.

`VIEW_SCALE` maps track units onto the 400 logical units of window between the car and the
divider. It is a mapping between two sets of *logical* units — nothing in the simulation
knows it, and there is one of it, so neither seat can be given a deeper window than the
other.

Rule 7, three times over: player one drives a pointed wedge with a stripe down its spine,
player two a blunt car with a rear wing and a chequered roof; a spin is a white cross and a
draining bar, not a colour change; and each seat's own progress gauge is solid while their
rival's is hatched. Nothing on screen is a word, so neither seat has to read anything upside
down.

## What is not specified here

Art, audio and haptics. The renderer draws primitives and nothing is licensed yet. Remote
play uses the same simulation unchanged — there is no per-device state to negotiate beyond
the shared logical viewport the engine already provides.
