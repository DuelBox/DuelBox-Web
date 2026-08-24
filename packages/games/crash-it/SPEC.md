# Crash It — specification

**Archetype:** `rt-race` · **Category:** Racing · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~20 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

The fifth `rt-race` game in the catalogue and the first that is not a race. Racing Cars,
Road Dodge and Taxi Race each give a seat its own window on a shared track and ask *where
across the road to be*. This one puts both seats in **one pit** and asks a different
question — *how do I get above you* — because the only thing in the game that scores is
touching the other driver's head, and a head sits on a roof.

## Observed rules

> "Drive, jump and flip your car by tapping the buttons. Hit your opponent on the head with
> your car to score points and watch your own head so that nothing touches it!"

Six things are fixed by that and no more: there are cars; they drive; they jump; they flip;
a point is scored by touching the opponent's head *with your car*; and anything at all
touching your own head is bad for you. Everything below is **[ours]** — how big the pit is,
what the ground looks like, how high a jump goes, how many points win, and the one piece of
geometry that decides whether "hit your opponent on the head" is a thing a player can
actually do.

## The pit

One pit, drawn twice. Read out of `src/rules.ts` rather than from memory.

| | Value | Why |
|---|---|---|
| Pit | 600 × 430 units, **numbered −300…300** | Centred on zero so that reflecting a car is a negation, which is exact in floating point. See *Determinism* — this was not a preference |
| Ground | polyline `(±300, 300) (±190, 400) (±60, 400) (±6, 376)` | Flat floor, a low hump to launch off, both ends curling into the walls |
| Hump | 24 units high, **12 units flat on top** | A peak is one point shared by two faces, and a point has to be given to one of them; a flat top is its own mirror image |
| Wall ramps | 42.3° | Gravity pulls 1009 units/s² down them against 851 of drive, so a car driven into a corner comes back rather than parking in it |
| Hump faces | 24.0° | 609 against 1051 — climbable at full throttle, which is what makes it a launch pad rather than a wall |
| Car body | half-length 34, half-height 16 | |
| Wheels | at (±22, +14), radius 13 | The outermost points of the car in every direction but up, so they are what meets the ground and what meets the other car |
| Head | radius 12 at (0, **−28**) | `−(BODY_HALF_HEIGHT + HEAD_RADIUS)`: it sits *on* the roof rather than in it. This is the whole game — see below |
| Resting height | 27 above the ground | `WHEEL_OFFSET_Y + WHEEL_RADIUS` |
| Car height | 67 | Ground to the top of the head |
| Gravity | 1500 units/s² | |
| Drive | 1150 units/s², top speed 330 | Crosses the pit in 1.8 s |
| Jump | launch 560, apex **104.5**, flight **0.747 s** | Clears a whole car by 37.5 units |
| Lunge | 150 added to `vx` | 112 units of travel in one flight, against the 68 two touching cars are apart |
| Jump cooldown | 0.85 s | Longer than a flight, so a jump is a commitment rather than a hop key |
| Air torque | 16 rad/s², capped at 7 rad/s | Three quarters of a turn in one flight: enough to right yourself, enough to turn yourself over |
| Wheel grip | 0.10 | A wheel *rolls*. See below |
| Body grip | 0.90 | A corner scraping does not |
| Restitution | 0.12 ground, 0.35 car | |
| Points | first to 5 | |
| Round clock | 15 s | The 99th percentile round is 9.9 s; see *Measurements* |
| Match clock | 100 s | The worst match measured is 63.6 s |
| Settle | 0.9 s | |
| Start | ±150, at rest, upright | Mirrored, on the flat |

### The head is on the roof, and that is the game

`HEAD_OFFSET_Y` is not a taste. Put the head *inside* the body and a flat-out ram scores,
the jump becomes decoration, and the middle verb of the observed rule never happens. Put it
on the roof — tangent to it, exactly — and two cars meeting on the level touch roof to roof
and **nothing happens**: swept in `rules.test.ts` at every separation from 68 units (two
half-lengths, which is as close as two level cars can be) out to 240, no head is ever
touched. The head is only reachable from within 46 units horizontally
(`BODY_HALF_LENGTH + HEAD_RADIUS`), and at that distance the two bodies are inside each
other unless one of them is above the other.

So the only way to a head is over the top of one, and the only way over the top of one is a
jump: 104.5 units of apex against 67 of car.

### Why a jump lunges

Two cars pressed nose to nose are 68 units apart and each is held there by its own body. A
jump that only went *up* would come down exactly where it left, and neither driver could
ever reach the other — the headline verb would be unreachable from the commonest position
in the game. That is Spin War's failure exactly: a game whose core rule cannot happen while
every global guard passes. `JUMP_LUNGE` × `AIRBORNE_SECONDS` = **112 units**, so a jump
taken while leaning on the other car lands on top of it.

### Why a wheel has almost no grip

The first draft gave every contact point the same friction, 0.85, and **the cars could not
drive**: measured, a car at full throttle crept forward at ten units a second, because the
friction impulses at its two wheel patches cancelled the drive force every step. A wheel
rolls; that is what a wheel is for. `WHEEL_FRICTION` is 0.10 and a body corner keeps 0.90,
so a car sliding on its roof stops rather than skating. The bug is invisible from the
scoreboard — matches still ended, still scored, still reported a winner — and visible in
one line of a state trace.

## Scoring and the win condition

**A point is scored by the seat whose car touched the other head**, and the same point is
scored against a driver whose head touches anything at all. Resolved by the SDK's
`resolve()` with `{ kind: 'first-to', target: 5 }` over the two seats' points, with
`timeExpired` set once the match clock is out — so "first to five" and "level when the clock
runs out is a draw" mean here what they mean everywhere else.

Nothing is ever clamped and then compared: the tallies are counted integers and the winner
is read off them by the helper. A step in which **both** heads are struck adds a point to
both, which is the genuine simultaneous outcome, and if that takes both to five `resolve()`
calls it the draw it is.

After a point the result is held for `SETTLE_SECONDS` with both cars frozen where they
stopped and the struck head ringed, then both are put back at ±150 and the next round
starts. A round in which nobody has scored inside `ROUND_SECONDS` is restarted with no
points to anybody.

### How the match is guaranteed to end

`roundSeconds` in the manifest ends nothing — it prints a number on a catalogue card — so
the guarantee lives in `MATCH_SECONDS`, which is checked **on every step in every phase**,
including mid-round and mid-settle. The bound is therefore the clock plus the step it is
noticed on: **100.02 s**, a sixth of the ten-minute ceiling
`apps/web/src/data/termination.test.ts` allows.

The round clock is a second net rather than the mechanism: at worst a match holds
`ceil(100 / (15 + 0.9))` = **7 stalled rounds**. `rules.test.ts` drives the true worst case
— two cars that never move, so no round can ever be won — and it ends in a draw on step
6000 of a 6001-step cap.

## Controls

| seat | keyboard | pointer |
|---|---|---|
| p1 | `A` / `D` drive and, in the air, turn; `W` **or** `Space` jumps | finger anywhere in the bottom half: its **x** names the place in the pit to drive to, a flick of ≥ 90 units towards the divider jumps |
| p2 | `←` / `→` drive and turn; `↑` **or** `Enter` jumps | finger anywhere in the top half, read through the same half turn the picture goes out by |

`S`, `↓`, `Tab` and `Escape` do nothing, and `game.test.ts` asserts each of them moves
nothing — driven through a real `InputManager`, not a hand-rolled input object.

**How they combine: there is no mode.** While a finger is down it has the last word on where
to drive, because it names a *place* and a key only names a sign. The jump fires on a flick,
**or** on the up key's rising edge, **or** on the action key's rising edge — whichever
arrives.

**The action key only counts while no finger is on the glass.** The engine reports a finger
down as the action held, so without that condition every touch meant for steering would also
be a jump, and the pointer idiom would be unusable. Asserted directly in `game.test.ts`.

**Keys need no mirror**, and here that is a fact about the *picture* rather than about the
code. Both seats are shown the same pit the same way up (see *Presentations*), so the
right-hand end of the pit is the right-hand end for both of them, and `D` and `→` are one
line of code. The finger does need the mirror, and gets exactly the one the renderer used:
`pointerPitX` maps a device x back through the same half turn.

**The flick is a ratchet, not a threshold.** The base follows the finger back down the half
and only moves up when a jump has been taken, so a slow slide the length of the half costs a
handful of jumps rather than three hundred. Measured in `game.test.ts`: 400 units of slide in
40 steps yields between 1 and 5 jumps.

**The sign is taken, not the component.** The engine normalises two keys held at once to
0.707, so a player resting a thumb on a second key would otherwise drive three quarters as
hard as one who was not.

### Input parity

The manifest does not declare `sameInputClassOnly`. What a driver asks for is a *place* —
a finger names it and a key walks towards it, and both arrive through the identical
throttle, so `game.test.ts` drives the same intent through both instruments and gets the
same position to nine decimal places. The one discrete act is the jump, and what limits it
is the 0.85 s cooldown rather than how fast an instrument can ask.

## Edge cases

- **Simultaneous input.** Both cars are integrated, then both are put back on the ground,
  then both heads are tested — in that order and never interleaved. A step in which each car
  reaches the other's head scores for both rather than for whichever seat the loop reached
  first.
- **No input at all.** Both cars sit still, every round times out, and the match clock ends
  it as a draw. This is the worst case in the whole game and it is the one the termination
  test drives.
- **Input in the other seat's zone.** A pointer belongs to the seat it went *down* in and
  keeps that seat across the midline — the engine owns this and the game never reimplements
  it. `game.test.ts` drags a finger from y = 900 to y = 200 and asserts it is still seat
  one's steering and that seat two's car has not moved.
- **A car in the air.** Cannot drive and cannot jump again; the throttle turns it instead.
  That is the cost of committing, and it is what makes a mistimed jump expensive.
- **A car on its roof.** Not "grounded": a car resting on its bumper has no wheels on
  anything, so it can neither drive nor jump. It does not need a recovery rule, because a
  car on its roof is a head on the floor and the round is already over.
- **A car standing on the other car.** *Is* grounded, and may jump off it — read from the
  contact normal rather than by comparing the two heights, because two cars at exactly the
  same height would otherwise have to hand the advantage to one seat.
- **Both heads struck in one step.** Both score. It happens in 5.7 % to 13.0 % of rounds
  depending on tier, and it is the only way a match can be drawn other than the clock.
- **A head struck by the other car *and* the floor.** Credited to the car. The rule is
  named for the car and the floor was going to be there anyway.
- **Stalemate.** There is none available: the round clock restarts a round nobody can win
  and the match clock ends the match.

## Determinism

- **All randomness is seeded.** One `Rng`, handed in by the host, and the only thing that
  draws from it is the two bots' judgement — three floats a look, unconditionally, whatever
  the bot goes on to decide. A seat whose draw count depended on its decision would shift
  the *other* seat's stream.
- **The pit itself is fixed.** No spawn table, no jitter: both cars start at mirrored places
  at rest, and everything that happens afterwards is the two drivers.
- **Nothing allocates per step.** The contact list, the two scratch shapes, the step result
  and the win tally are module-scope objects rewritten in place. Measured: 200 000 steps of
  two `hard` bots grow the heap by 16.7 kB, which is 0.08 bytes a step — noise, not
  allocation.
- **Integration is analytic where it can be.** Free flight and driving both use
  `x += v dt + a dt²/2` with `v += a dt`, which is the exact closed form for a constant
  acceleration rather than a rectangle rule. Half a second of fall is 92.500000000 units at
  60, 90 and 144 Hz alike. Where a limit binds — the top speed, coasting to a stop, the
  driven spin cap — the acceleration is trimmed so the velocity lands *on* the limit rather
  than past it.
- **Contact resolution is a per-step event, and that is the one thing that is not
  rate-free.** Two seconds of driving agree to 0.02 units across 60/90/144 Hz; a whole match
  with collisions in it does not — measured, the same scripted match run at 60 Hz and at
  120 Hz has the cars 11 units apart after one second and 30 after two, and can differ by a
  point after four. **The shell steps every device at a fixed 60 Hz** (`FixedLoop`'s default,
  and `GameHost` passes no override), so no two devices ever run different rates and a
  cross-device match is exact; but a future host that changed the simulation rate would be
  changing this game, and that is worth writing down rather than discovering.

### The mirror between the seats, which is a theorem

Both cars are in one pit, so the fairness question — is the left-hand half as good as the
right? — cannot be answered by tuning. It is answered by construction: **the state of a
match, reflected, is a legal state of a match, and it steps to the reflection of what the
original steps to, to the last bit.** `rules.test.ts` drives a whole match with mirrored
controls and asserts every state variable of the two cars is exactly equal and opposite for
900 steps, and drives a lone car for 1500 steps against its own reflection with the same
assertion.

Getting there took five separate fixes, every one of them a real defect that a tolerance
would have hidden:

1. **The pit is numbered from its middle.** Negation is exact in binary floating point and
   subtraction from 600 is not. On the 0…600 version two mirrored cars parted company at
   step 231 and ended 614 units apart.
2. **A ground plane is written from its segment's midpoint**, not its left end: mirrored
   segments have mirrored midpoints but their left ends are each other's *right* ends, and
   the same plane written from two ends gives two answers. This one alone was worth 2.3e-8
   after 573 steps.
3. **Contact impulses are simultaneous, not sequential.** A car's two wheels are visited
   left to right, which under the mirror is right to left, so the two cars were solved in
   opposite orders. Measured before the fix: over 60 seeded matches of two `hard` bots, seat
   one turned itself onto its own head **59 times to seat two's 16**.
4. **Contacts are gathered in mirror-image pairs, adjacently**, because a pair of opposite
   floats cancels exactly only when they are added one after the other; and body-against-body
   is done as corner points rather than `obbObb`, whose least-penetration axis ties exactly
   in a symmetric collision and then keeps the earlier one — worth 18 units a second of
   vertical speed out of nothing.
5. **The head test stopped borrowing the solver's scratch circle.** It left a radius of 12
   behind in the circle the solver used for a wheel of 13, so **seat two's wheels were a
   unit smaller than seat one's in every car-to-car collision in the game**. Nothing else
   would have found this: it is invisible in the score, invisible in the picture, and
   perfectly deterministic.

The one thing the theorem does not cover is that the two bots deliberately break the mirror
— they share one stream and draw from it in turn, so two equal tiers do not play the same
round for ever. That is Robot Arena's measured lesson taken rather than rediscovered.

## The bot

**What it reads:** where the two cars are, how fast they are going, whether the other one is
in the air, and its own jump cooldown. All four are on the screen, both seats see the whole
pit, and there is nothing else to see — no spawn table, no hidden timer, no lookahead
beyond the edge of the picture. Rule 6 is kept here by there being nothing to keep it from.

**A plan is made at a look and executed by the car's own odometer.** At a look the bot
decides whether to charge or to get out from under, and *at what gap it will launch* — then
it drives, and jumps when the gap it can see closing reaches that number. The reaction time
is on the deciding, which is the part a reaction time is about.

That distinction is the whole ladder. An earlier draft re-tested the jump condition every
step against live positions, so every tier fired at exactly the right instant and `reaction`
bought nothing: measured over 60 seeded matches, `hard` beat `normal` **32-28**, which is a
coin. With the plan held, a slow bot is still acting on a picture of the pit that has moved
on, and the same measurement is 91-95 %.

The tiers differ only in when they look, how well they judge, and how finely they steer —
never in speed, size, jump height or knowledge:

| | reaction (s) | aim error (units) | launch-gap error (units) | blunder | air skill |
|---|---|---|---|---|---|
| easy | 0.42 | ±95 | ±95 | 28 % | 0.35 |
| normal | 0.20 | ±45 | ±45 | 12 % | 0.70 |
| hard | 0.08 | ±14 | ±14 | 3 % | 1.00 |

A blunder is one whole judgement thrown away: it charges when it should be getting clear,
drives the wrong way, and takes no jump. Air skill is the fraction of the available steering
it uses to right itself in the air, which is why `easy` lands on its own head four times as
often as `hard` does. Errors are drawn once a look and **held** — a fresh error every step
averages to zero and makes every tier identical, which is the mistake this repository has
made three times and the reason `Judgement` is in the SDK.

## Measurements

All from seeded matches driven through the public `Game` API — `create()`, `init()`,
`update()` — or through `stepMatch` with the same bot code the shell runs.

**The headline verb, counted, and counted from the outside.** The numbers below are not
`lastCause` read back out of the simulation that maintains it. A second implementation of
the geometry in `rules.test.ts` — head circle against rotated box, against wheels, against
the other head — is run over sampled state every step, and rising edges are counted. 300
matches a tier, both seats:

| tier | car-on-head hits per match | own head on the floor | matches with **no** car hit |
|---|---|---|---|
| easy | 5.78 | 1.37 | 0 of 300 |
| normal | 6.19 | 1.18 | 0 of 300 |
| hard | 7.09 | 0.58 | 0 of 300 |

The verb happens about six times a match at every tier, and scoring off another car outruns
scoring off the floor by four to twelve times. Not one match in nine hundred failed to
produce one.

**How rounds end**, 60 matches a pairing, classified from the same reconstruction:

| | rounds | one head struck | both struck | timed out | of the KOs, self-inflicted |
|---|---|---|---|---|---|
| easy v easy | 437 | 84.2 % | 5.7 % | 10.1 % | 17.2 % |
| normal v normal | 422 | 83.4 % | 13.0 % | 3.6 % | 20.3 % |
| hard v hard | 422 | 90.0 % | 8.8 % | 1.2 % | 7.3 % |

**Match length**, 300 matches a tier:

| tier | median | fastest | slowest |
|---|---|---|---|
| easy | 18.8 s | 7.9 s | 32.4 s |
| normal | 16.7 s | 6.9 s | 34.9 s |
| hard | 30.0 s | 11.2 s | 63.6 s |

Nothing failed to finish. `roundSeconds` on the card is **20 s**, the honest middle of that;
it ends nothing, and `MATCH_SECONDS` = 100 s is what does — 1.6× the slowest match measured.

**Round length**, 6424 rounds sampled across all three tiers: median **1.77 s**, p90
**4.72 s**, p99 **9.92 s**. `ROUND_SECONDS` is 15 s, which is above the 99th percentile — it
can only fire on a round that has genuinely stalled.

**The ladder**, both seat orders, three independent seed families of 100 seeds each, so 200
matches a cell:

| | family A | family B | family C |
|---|---|---|---|
| normal beats easy | 91.0 % | 89.0 % | 90.0 % |
| hard beats normal | 91.0 % | 94.0 % | 94.9 % |
| hard beats easy | 99.5 % | 99.5 % | 98.5 % |

`hard` against `easy` is **saturated** and is reported as such rather than quoted as a
tuning success.

**Seat bias**, same tier in both seats, 200 matches a family, as seat one's share of the
decided matches:

| | family A | family B | family C |
|---|---|---|---|
| easy | 51.8 % | 43.5 % | 52.1 % |
| normal | 49.2 % | 55.8 % | 49.7 % |
| hard | 44.1 % | 48.5 % | 52.8 % |

No consistent direction — the spread is what 200 matches resolves, and the mirror above says
there is nothing there to find. Draws at equal tiers run **1.5 % to 4 %**, and every one of
them is a match in which both drivers reached five in the same step.

**Time in the air**: 48 % to 61 % of live steps at equal tiers, rising with the tier. This
is a game about jumping, and the measurement says the bots play it that way.

## Presentations

**Shared-screen.** One pit, drawn twice, one copy in each seat's half. The far half is the
near half turned half a turn about the centre of the box — which the renderer does itself,
so the pit is authored **once**, in one frame. The consequence is worth stating plainly:
**both players see the identical picture the identical way up.** Seat one's car is on the
left of the pit for both of them, gravity points down for both of them, and "the left-hand
wall" means the same wall to both. `game.test.ts` asserts this on the draw calls: the two
halves produce the same list of operations with the same arguments, apart from at most four
— the three lines of the chevron over each seat's own car, and the line of text that names
it. Rule 9 is not argued, it is compared.

The play area never rotates: both cars are live at once, `getActiveSeat()` returns `null`,
and the shell keeps a pointer zone per seat.

**Single-seat.** Identical simulation; the local seat owns the whole viewport upright.
Nothing in the game reads `presentation` — `game.test.ts` plays the same seed in both and
compares the whole match state.

### Rule 7 — colour is never the only signal

- Seat one drives a **wedge**: a pointed nose, a dark stripe down its spine, and hub-capped
  wheels. Seat two drives a **blunt** car with a rear wing, a three-square roof rack and
  cross-spoked wheels. Different silhouettes, both legible in greyscale.
- The two helmets differ in **marking**: a solid visor bar across one, a ring in the other.
- A car in the air is read from its **shadow**, which shrinks as it climbs.
- The struck head is **ringed in the colour of the seat that scored**, for the second the
  result is held — so the picture says *why* a point was given, not only that it was.
- Each seat's own car carries a **chevron** over it in its own half: closed when the jump is
  ready, filling back up while the suspension settles. It is the one thing the two halves do
  not share, and each seat gets exactly one.
- The pips along the divider are **solid** for seat one and **outlined with a dark centre**
  for seat two, so which row is whose survives grey as well as colour.

## What is not specified here

- The catalogue card advertises 75 s for this game while the manifest declares the measured
  20 s. The catalogue is generated data this package does not own.
- Nothing in the game reads the interpolation alpha. The simulation runs at the display's
  own 60 Hz in the shell, so there is nothing to interpolate; a host that ran the simulation
  below the display rate would want a render-time interpolation, and that is a separate
  change.
- Whether a rematch should ever start from the *previous* round's positions rather than from
  the start line is not decided here.
- The pit has one shape. Whether a second ground profile would be a mode, a random draw, or
  a different game is not decided; if it is ever drawn from the generator it must keep
  `groundY(x) === groundY(−x)`, which is the fairness argument the whole file rests on.
