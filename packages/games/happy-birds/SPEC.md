# Happy Birds — specification

**Archetype:** `rt-split` · **Category:** Platform · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 60 s advertised, 9 flights (≤ 244 s) hard bound

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A strip of sky each. Your bird holds its place while walls of spikes come across; tap to
beat a wing and rise, let go and fall, hold the button and tuck into a dive. The gap is the
only way through and a tooth ends your flight. Outlast the other seat and the flight is
yours. Three flights take the match.

## Observed rules

From the reference genre: _"Tap to fly. Avoid the spikes! Survive 3 times to win."_

Four facts: one button, flight, spikes that end you rather than cost you, and a match of
three survivals. Everything below is how those four became a simulation. In particular the
observed rule says nothing about what a "survival" is measured against, what the spikes
look like, or what happens when both players die at once — all of that is **[ours]**.

## The field

Read out of `src/rules.ts` rather than from memory.

| | Value | Why |
|---|---|---|
| Field | 600 × 1000 | Portrait: two people either side of an upright phone |
| Sky | 470 tall, ×2, with a 60-unit horizon | Symmetric under a half turn |
| Bird | radius 14, fixed at sky-x 140 | The world comes to it; it never moves sideways |
| Flying band | centre held in 14 … 456 | Bounded by its edge, so it sits on the ground rather than in it |
| Gravity | 1250 u/s² | One beat = 74 units of climb, 0.34 s to the top of the arc |
| Wing-beat | sets climb to 430 u/s, recharges in 0.19 s | Sets, never adds — beats do not stack |
| Free fall | terminal 560 u/s | A drop from the ceiling takes about a second |
| Tuck | pull 2600 u/s², terminal 900 u/s | The second control, from the same button |
| Walls | 250 u/s + 7 a wall, capped 420; 330 apart | 1.32 s between walls at first, 0.79 s at the cap |
| Gap | 190 at nil, −7 a wall, floor 108 | Clean window 162 → 80; tightest after 12 walls |
| Gap centre | 115 … 355, ≤ 130 from the last | A path rather than noise, and never sealed on a side |
| Wall thickness | 26, teeth 16 long | Danger lasts the whole passage, not one plane |
| Spawn / retire | lead 520 / −200 | Enters and leaves off the edges, 2.08 s of warning |
| Wall pool | 4 slots, at most 3 live | Travel span ÷ spacing < 3 |
| Flight | 1.2 s hover, 0.9 s settle, 25 s limit | |
| Match | first to 3 flights, 9 flights maximum, 300 s outer bound | |

## One sky, read from both ends **[ours]**

There is no ball to contest, no board to share, no turn order and no first mover. Each seat
has its own bird and its own ground. **The walls are a single array**: one draw from the
seeded stream produces one wall, and both birds are tested against that same object on the
same step, at the one gap width the flight has reached. The gap and the pace depend on
`match.cleared` — walls this *flight* has cleared — which is a property of the flight and
not of a player, so there is nothing per-seat for a bug to live in.

This is the one structural difference from Flappy Jump, which keeps a hoop pool per lane so
that each lane's gap can narrow with that lane's own score. Here nothing accumulates per
seat during a flight, so the sky can be shared outright.

The simulation is written in **sky-local** coordinates: `height` above your own ground,
`lead` ahead of your own bird. Both seats therefore read literally the same numbers, and
the half turn that separates them lives in `worldXOf` / `worldYOf`, which only the renderer
calls.

### How the fairness was verified

Not statistically. `rules.test.ts` plays the **identical run of intents into both seats**
and asserts `p1.height === p2.height` on every step — and that such a match ends 0–0,
because two identical birds always go down together. A second test plays two different
scripts into the two seats, then swaps them over, and asserts the match comes out the other
way round with the same margin and the same clearance. A third asserts the world mapping is
an exact point reflection about the centre of the field.

The one asymmetry that can exist is that the two bots draw from the shared generator in a
fixed order. That is measured rather than reasoned about: see the table below, where equal
tiers land at 46–53% over 200 matches each.

## The controls: one button says two things **[ours]**

| | Seat one (near) | Seat two (far) |
|---|---|---|
| Keyboard | `Space`, or `W` | `Enter`, or `↑` |
| Pointer | tap anywhere in the near half | tap anywhere in the far half |
| Dive | hold `Space` | hold `Enter` | 

A fresh press beats a wing. The action **still held** on a later step tucks the wings: pull
rises to 2600 u/s² and terminal speed to 900 u/s, so a dive is available at once rather
than after a second of falling. A dive applies while climbing too, so tucking at the top of
a beat throws the beat away — that is what makes it a commitment.

The up key is a third way to *beat*, on its own rising edge, because W and ↑ are what a
player tries first in a game about flying. Holding it does not dive, which would be a
strange thing for a key called "up" to do, and the manifest string says so rather than
claiming "hold your key".

The two sources combine by addition and there is no mode to switch between them: the engine
has already folded this seat's action key and a pointer down in this seat's zone into one
action before the game sees it. Both instruments can complete a match alone.

### Why a thumb and a keyboard are worth the same

A one-button game with no cadence limit is decided by how fast you can press, and a key
repeats faster than a screen can be tapped. Without the recharge a masher pressing on every
step holds 430 u/s outright while a six-a-second tapper averages 326 — a quarter more climb
for nothing but the peripheral in your hand. `FLAP_RECHARGE` caps everybody at 5.3 beats a
second and 311 u/s, a rate a thumb reaches comfortably.

A press arriving *during* the recharge is **held, not dropped**. Dropping it puts an
aliasing beat between the player's rhythm and the wing's, so a tapper whose rhythm falls
badly climbs slower than one with no cap at all. `game.test.ts` drives a masher (key down
and up on every step) and a thumb (six taps a second, deliberately not a multiple of the
recharge) through the real input stack and asserts they climb the identical distance.

## Scoring and the win condition

Flights, resolved by the shared helper: `resolve({ kind: 'first-to', target: 3 }, …)` — see
`FLIGHT_CONDITION`. Nothing here writes a comparison by hand.

A flight ends the instant either bird touches a tooth, and goes to the seat still up. Both
birds can go down inside one step — they fly the same walls, so it is not even unlikely —
and that flight goes to nobody while still costing a flight from the budget. After
`SETTLE_SECONDS` (0.9 s) the downed bird is cleared and a fresh sky is dealt: birds back to
mid-sky, wall counter back to zero, gap back to 190. Flights won and clearance banked
survive; nothing else does.

### The tie-break **[ours]**

`MAX_FLIGHTS` flights can pass with the seats level — every flight of a match can be drawn
— so "level on flights" has to mean something. It cannot mean "who survived longer": a
flight ends the instant either bird goes down, so both have always flown exactly as long,
and total survival time is identically equal by construction. Total walls threaded is equal
for the same reason.

What is banked instead is **clearance**: every wall a bird threads adds however much clean
window it had to spare at the moment the wall's middle went by. It is resolved by the same
helper on a different tally — `resolve({ kind: 'highest-when-time-expires' }, …)` — and it
says something true: two players level on flights are not equal if one of them was scraping
every tooth. Being continuous, it essentially never ties again; when it does, the match is
an honest draw.

## Edge cases

- **Simultaneous input.** The two seats never touch the same object, so there is nothing to
  order. Both birds are flown in the same step, both are tested against the same walls, and
  neither can read the other.
- **No input at all.** The bird falls, rests on the ground, and is taken by the first wall —
  the centre band guarantees no gap ever reaches the ground, so sitting still is never safe.
  Two absent players go down on the same step of every flight, so the match is nine drawn
  flights and a 0–0 draw in 30 s. `game.test.ts` asserts exactly that.
- **Input in the other seat's zone.** It belongs to the seat it started in, and keeps that
  ownership across the midline. That lives in the engine; the game reads `input.seat(seat)`
  and never asks where a finger is.
- **Both birds down in one step.** The flight goes to nobody and still costs a flight.
- **Ground and ceiling.** Neither is lethal and neither gives anything back: the bird stops
  dead, bounded by its edge so no part of it leaves the device. Being pinned against either
  is a position to get out of, not a safe place — the banks reach both surfaces.
- **A flight nobody can lose.** `FLIGHT_LIMIT` (25 s) calls it level. Nothing reaches it:
  the gap is at its floor after 12 walls and the pace at its cap after 25, so a flight is a
  race against a progression that always wins. The limit is a backstop under the mechanism,
  not the mechanism.
- **A match nobody can win.** `MAX_FLIGHTS` (9) bounds it, and `MATCH_SECONDS` (300) bounds
  that. 9 × (1.2 + 25 + 0.9) = 244 s, comfortably inside the ten simulated minutes
  `termination.test.ts` allows.
- **Wall passage.** Danger is the whole overlap of bird and wall, 54 units of it. At the
  fastest pace a wall covers 7 units in a step, so every passage is sampled at least seven
  times and there is nothing to tunnel through.

## Determinism

- **All randomness is seeded**, and it is consumed by the *sky* rather than by a bird:
  `nextCentre` is the only call `step` makes, so what the players do cannot change which
  walls they are given. `rules.test.ts` asserts two matches played completely differently
  see the identical run of gap centres. The bots draw from the same generator, which is why
  a bot match and a human match diverge — as they should.
- **Every delay is counted in simulated seconds off the fixed step**, never in wall-clock
  time: `readyDelay`, `settleDelay`, `recharge`, `flightSeconds`, `elapsed`, and the bot's
  `look` and `frozen`.
- **Nothing decays per step.** Gravity, the tuck and the wall pace are constant rates
  integrated once per fixed step, so there is no per-step multiplier whose value would
  depend on the rate the loop happens to run at. Velocity integration is semi-implicit
  Euler on the fixed delta, which is exact arithmetic and identical on every device.
- **Nothing is expressed in pixels.** Every number above is a logical unit; the renderer is
  the only code that knows what a device is. `cross-viewport.test.ts` plays the identical
  trace at 320 × 568 through 4K and compares raw floats.

## The bot

It reads the height of its own bird, whether its own wing has recharged, and the lead and
centre of the next wall — the same three things on the screen in front of a player, and
`rules.test.ts` asserts it never touches the other seat's bird at all. It gets no stronger
wing, no faster recharge, no wider gap and no earlier sight of the wall after next.

The policy is one line for every tier: **hold the height of the next gap** — beat when you
sag half a wing-beat below it, tuck when you float half a wing-beat above it, coast in
between. The band is `FLAP_RISE / 2` and **symmetric about the aim** deliberately: a beat
*sets* the climb rate, so it is worth 74 units to whoever makes it, and a bot that beats
whenever it drops below its aim flies a sawtooth 74 units deep sitting entirely above the
target. Looking more often does not shrink that sawtooth, so a sharper tier would be no
more accurate than a slow one, merely more consistently too high. Centring the band leaves
reaction delay — how far past the band it drifts before it notices — as the only thing
separating the tiers.

The three tiers differ only in reaction, aim error and blunder rate:

| | reaction | aim error | blunders/s |
|---|---|---|---|
| `easy` | 0.26 s | ± 48 | 0.42 |
| `normal` | 0.12 s | ± 22 | 0.26 |
| `hard` | 0.07 s | ± 9 | 0.16 |

A blunder freezes it for 0.34 s, which drops it 72 units out of a hover — nearly the whole
80-unit window the tightest wall leaves open, so a blunder is reliably a wall. It is a
duration rather than a coin flip per step, because a bot that re-decides fourteen times a
second and freezes for one of those has jittered rather than blundered. The rate is per
second rather than per look, so the sharp tier does not inherit five times the blunders of
the slow one for the same number.

### Measured win rates

200 seeded matches per pairing, driven through `HappyBirdsGame` itself. Cell is the **row
seat's** (p1's) win share; no pairing produced a draw or failed to finish.

| p1 \ p2 | `easy` | `normal` | `hard` |
|---|---|---|---|
| `easy` | 53% | 2.5% | 0% |
| `normal` | 97.5% | 46% | 13% |
| `hard` | 100% | 90.5% | 48.5% |

Mean match length ran from 14.3 s (`hard` v `easy`) to 34.9 s (`hard` v `hard`), over 3.3
to 5.0 flights. Equal tiers land at 46–53%, which is the seat-fairness number: the residual
is the fixed order in which the two bots draw from the shared generator, and at 200 samples
one standard error is 3.5 points. `rules.test.ts` holds the ladder to a shorter run of the
same measurement on every commit.

## Presentations

See `docs/presentation.md`; nothing here re-decides it.

- **Shared-screen** — the two skies stack, p1's ground along the bottom edge and p2's along
  the top. The layout is a point reflection about the centre of the field, so both players
  read their own sky upright with their own ground nearest them and neither sees more of
  anything than the other. Nothing rotates: there are no turns, so there is nothing to flip.
- **Single-seat** — the local seat owns the viewport. The simulation is byte-identical;
  only placement changes. `game.test.ts` asserts a `single-seat` match on seat two traces
  identically to a `shared-screen` match on seat one from the same seed.

Colour is never the only signal (rule 7): p1's bird carries a centre spot and p2's is banded
across; p1's flight pips are round and p2's square; p1's grass tufts are upright and p2's
raked; p2's spike banks are barred across and p1's are plain. The banks also redden as the
gap closes, so how deep into a flight you are is a second signal for the width itself.

## What is not specified here

- Sound. No game in the collection has it yet.
- Reduced motion: the bird's velocity streak and the settle pause are the only motion this
  game adds beyond the simulation itself, and neither is currently gated on the preference.
- The `roundSeconds: 60` on the manifest is a catalogue label and ends nothing. The two real
  bounds are `MAX_FLIGHTS` and `MATCH_SECONDS`, both in `rules.ts`.
