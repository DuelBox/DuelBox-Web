# Wheelie — specification

**Archetype:** `rt-race` · **Category:** Racing · **Logical box:** 640 × 1000 ·
**Zone split:** horizontal · **Round length:** 75 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Lean back and the front wheel comes up. The higher it rides the faster the bike goes. Lean
too far and you go over backwards and lose the best part of two seconds; let the nose drop
and you are slow again. Eighteen bumps down the lane kick the nose up whether you wanted it
or not, and they kick harder the faster you hit them. First to the end of the course.

## Observed rules

From the catalogue: _"Accelerate your bike to pull up a wheelie. Earn more points the longer
you maintain a wheelie."_ Here "points for holding it" is expressed as **speed**: the pitch
angle *is* the throttle, so the time you hold a wheelie is the distance you cover, and the
scoreboard counts the marker posts that distance takes you past.

## The lane is one number long **[ours]**

A bike that cannot steer has a distance and a speed, and a pitch that is the whole game. So
the simulation is four numbers a rider — where it is, how fast it is going, how far back it
is leaning, and how fast that angle is moving — plus a list of bumps read off by distance.
The side view exists only in the renderer. Three things fall out, exactly as they did for
Slot Cars:

- **It is exactly fair.** One array of bumps, read by both riders from the identical start.
  There is only one course to be unlucky on, so "was one lane kinder?" has an answer before
  anybody moves and the answer is no.
- **It is trivially deterministic.** There is nothing to integrate but a pitch, a rate, a
  speed and a distance, and no collision to resolve at all.
- **The skill is legible.** The lean that holds any angle is a number, so the gauge can draw
  it and "you are leaning too hard for this angle" is a fact rather than a feeling.

## The pendulum, which is the whole design **[ours]**

Gravity's pull on the nose is `GRAVITY_TORQUE · cos(pitch)`. That is at its strongest with
the wheel on the ground and **nothing at all** at the balance point, where the rider is over
the rear axle. Two consequences, and they are the game:

- The lean that holds a given angle is `(GRAVITY_TORQUE / LEAN_TORQUE) · cos(pitch)` — 0.80
  flat on the ground, 0.14 at 80°. So you yank it up and then feather it, which is what
  riding a wheelie actually is.
- `LEAN_TORQUE` must exceed `GRAVITY_TORQUE`, or the front wheel can never leave the ground
  and the only control in the game does nothing. The same inequality means **full lean has
  no equilibrium anywhere**: pinning the control flips you every time, which is asserted.

The wheelie ends at 1.55 rad, just short of a right angle. Past the balance point gravity
stops helping and starts pushing you over, so nothing can save you there and it would be a
lie to draw a recovery.

## The decision **[ours]**

Two things point in opposite directions and a bump is where they meet.

- **Speed is linear in pitch**: 189 units a second with the nose down, 422 at the flip
  angle. So greed pays.
- **A bump's kick is proportional to the speed it is taken at.** So greed is exactly what
  makes the next bump able to throw you.

Approaching a bump you have three answers and each costs something different:

| | what it costs |
|---|---|
| ride it high | nothing, unless the kick puts you past the balance point — then 1.6 s |
| duck to just above the wheel-down line | a second or so at the slow end of the speed range |
| take it flat | 55 units a second of speed, and you have to build the wheelie again |

Bumps are drawn as high as they kick hard, and the lane shows exactly a thousand units of
course ahead of the bike — so how much to duck, and when to start, is read off the picture.

**The kick scaling is the single change that turned this from a shape into a game.** With a
flat kick it read two ways and neither had a bot knob in it: small enough to survive at any
speed and every tier rode its angle to the line without one fall, so only the ride height
moved the result; large enough to matter and every tier flipped a dozen times a race and
their times came out within a second and a half of each other. Scaling by speed also drained
a flip loop the flat version had, where a rider picked the bike up slow, met the next bump at
the same strength, and never got going again.

## Termination has no clock in it **[ours]**

The course is a fixed 7,200 units and the motor holds a thrust even with the rider flat on
the tank, so **a bike with nobody on the controls still finishes**, in about 47 seconds. Two
absent players draw. Two players holding the control wide open flip at every bump and still
finish, because a fall is a cost and never a stop: the bike is picked back up at 90 units a
second. Both are tested over 40 and 60 seeds respectively with **no frame cap** — the test
helper throws rather than returning if one is ever needed.

| | Value |
|---|---|
| Course | 7,200 units, 6 marker posts |
| Wheelie | 0 to 1.55 rad; the front wheel is down below 0.10 |
| Torques | lean 23.5, gravity 18.75, damping 4.1 |
| Lean rate | 3.5 a second (0.29 s from nothing to everything) |
| Speed | 189 flat, 422 at the flip angle; linear drag 0.9 |
| Bumps | 18, about 360 apart, rated 3.2 to 7.0 at 300 units a second |
| A fall | 1.6 s, rejoin at 90 |
| A bump taken flat | 55 units a second |
| Sight | 1,000 units, which is exactly what the lane draws |

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W` leans back, `S` puts the wheel down, `Space` also leans back | `↑` / `↓`, and `Enter` |
| Pointer | thumb high in your own half leans back, low puts the wheel down | the same |

**A level, never a repeat rate** (rule 10). The lean is a number between nothing and
everything that moves toward what is asked at a fixed rate, and **releasing the keys holds
it where it is** rather than snapping back — holding an angle is the entire game, so a
control that decayed on release would make the keyboard unplayable while the pointer was
fine, and one seat is on the keys whenever two people share a laptop.

That is also what closes the mashing trap. A mashed key asks for the same thing less often,
so it reaches only leans a held key already passed through, and reaches them later — asserted
frame by frame over whole races. The version of mashing that would actually be worth doing —
flicking up and down to *hold* an intermediate level — lands on exactly the value that simply
letting go lands on, to nine decimal places, so it buys nothing.

**What is deliberately not asserted is that a masher covers less ground.** Distance is not
monotone in lean — leaning harder past the balance point is how you lose — so that comparison
is not evidence either way, and when it was tried the masher came out **0.17 % ahead** over
eight seeds. That is where the flip cycle happened to land, not a rate advantage, and
reporting it as a pass would have been the wrong kind of green.

The pointer sets an absolute level and the keys give a direction. Both go through the same
rate limit, so neither instrument is quicker — a test measures a thumb and a key over the
same twelve frames and finds the identical lean. A position control is still a slightly
easier one to hold steady than a velocity control; that is the same trade Star Catcher
makes, and the rate limit is what keeps it from being a speed advantage.

## The three random streams, and why there are three

**The course has its own generator, and it is spent before anybody moves.** `resetGame`
deals all eighteen bumps and `step` takes no generator at all — so unlike Star Catcher,
which had to argue that its sky stream stayed separate, here there is no world stream left
to share. That matters because the number of *decisions* a tier makes depends on its
reaction: `hard` looks nearly five times as often as `easy`, so a course drawn during the
ride would be a different course for every pairing, and a human would ride a different course
from the one every figure below was measured on.

**Each seat has its own generator too.** A constant number of draws per decision is not
enough on its own — whichever seat is polled first still takes the earlier value from a
shared stream every single time. With a stream each the poll order is not observable at all:
900 matches replayed with the two calls reversed came back **bit-identical**, finish times
included. Both facts are asserted.

## The bot

It aims at a pitch, holds it with `holdingLean` plus a proportional-derivative correction —
the arithmetic form of what a rider does by feel — and ducks for the bumps it can see. It
writes a *lean*, which `driveLean` applies at the same rate a thumb gets, so no tier can
shift its weight faster than a person (rule 6, measured). It cannot see the far lane, and it
cannot see past the thousand units the lane draws; both are proved by rewriting those parts
of the world and checking its answer does not move.

| Tier | Reaction | Ride | Foresight | Read |
|---|---|---|---|---|
| easy | 0.26 s | 0.42 | 0.30 s | 0.46 |
| normal | 0.18 s | 0.55 | 0.42 s | 0.60 |
| hard | 0.055 s | 0.72 | 1.10 s | 0.85 |

**Every knob was swept alone at each tier's own settings**, in seconds to the line. Three of
them are difficulty axes. One is not, and saying so is the point.

- **`reaction` is the axis that works everywhere.** At `hard`'s settings: 0.42 s did not
  finish at all, then 38.6 / 27.3 / 25.0 / 24.3 at 0.30 / 0.18 / 0.055 / 0.02. Monotone at
  all three tiers over the whole range, flattening below about 0.1 — which is why `hard`
  sits at 0.055 rather than lower.
- **`foresight` is live downward and flat above each tier's knee.** At `hard`: 47.8 (192 of
  200 unfinished) / 42.4 / 32.2 / 24.8 / 24.7 at 0.12 / 0.26 / 0.4 / 0.7 / 1.1. The knee
  climbs with the ride height, because a rider further up has further to duck and must start
  sooner.
- **`read` — how much of a bump's kick it accounts for — is the same shape.** At `hard`: 47.1
  (187 unfinished) / 36.4 / 24.9 / 24.5 at 0.35 / 0.5 / 0.64 / 0.82.
- **`ride` is not a difficulty axis, and the table must not be read as claiming it is.**
  Swept alone it is worth **under a second to `hard` across its whole plateau** — 25.6 /
  25.0 / 24.7 / 25.5 at 0.42 / 0.58 / 0.72 / 0.85 — and it is ruinous to `easy`, which
  measured 30.4 s at 0.42 and failed to finish **195 times in 200** at 0.72. Each tier's
  value is that tier's own measured best, and the plateaus move up with tier because a rider
  who can catch it can afford to be up there. The near-neutrality at the top is the *game*
  working rather than the bot failing — the central decision is meant to have no dominant
  answer — but the ladder cannot lean on it and does not.

### Two knobs that were lies, and what happened to them

- **`jitter`, how far off its own decision a bot leaned, was a fourth axis for a while and
  it paid for itself over its whole useful range.** Swept alone from 0 to 0.22 it moved
  `normal` from 29.1 s to 28.1 s: *more slop measured better*, because shaking the bike
  about dropped its speed and a slower bike takes a gentler kick. Only past 0.35 did it
  start to cost anything. It is one tier-independent constant now — nobody holds a wheelie
  perfectly steady — and no tier is claimed to differ by it.
- **`DUCK_LEAD` was flat seconds-per-radian, and it inverted `foresight`.** Gravity's pull
  is a cosine, so the nose falls quickly near the ground and barely at all near the balance
  point; a flat rate had the bot starting its duck about three times too early for a shallow
  drop, and a tier that could see further merely started that over-long duck sooner.
  `normal` measured 25.7 s at a foresight of 0.6 and **27.6 s at 1.1** — more sight was
  worse, which is exactly the shape Star Catcher's `sight` had. Dividing by the cosine at
  the midpoint of the drop made foresight monotone at all three tiers.

### And one bug that was not in the bot at all

The front wheel's landing scrub was charged on every step the wheel was *already* down
rather than on the step it arrived, because gravity keeps a small negative pitch rate
pressing into the ground. That billed a stationary bike 165 units a second: **an idle rider
never finished the course**, and the whole termination argument failed on one missing edge
test. It is asserted now, from both directions.

## What was measured

**Solo, 300 seeds** — how long a tier takes to reach the line on its own. Time, not distance
or marker posts: every tier finishes the whole course, so both of those say all three are
identical.

| | to the line | finished | falls | bumps taken flat |
|---|---|---|---|---|
| easy | 30.19 s | 300/300 | 2.04 | 0.00 |
| normal | 26.39 s | 300/300 | 1.01 | 0.00 |
| hard | 24.63 s | 300/300 | 0.46 | 0.00 |

Note the last column, which is honest rather than flattering: a tuned bot essentially never
takes a bump flat. It ducks to just above the wheel-down line and takes the kick as a free
lift, which is the good line. `BUMP_JOLT` is live in the rules — a bot with a slack
derivative gain paid it eight times a race during tuning — but the three shipped tiers do not
pay it, so it is a cost the *player* meets and the bots mostly do not.

**Fairness, 2 × 1,200 matches per equal tier on two different seed strides**, seat one's
share of decided matches:

| | stride 7 | stride 11 | combined |
|---|---|---|---|
| easy v easy | 48.4 % | 51.6 % | 50.0 % |
| normal v normal | 50.5 % | 49.9 % | 50.2 % |
| hard v hard | 47.5 % | 49.5 % | 48.5 % |

Two strides because one is not a measurement. `hard` read 47.5 % on the first and 49.5 % on
the second, which is the sample moving and not the game: the two seats never touch, they ride
the identical course, and each draws from its own stream. Identical under a reversed poll
order, to the last bit. Draws run about 4 % at `hard` — two bikes on one course, both good,
crossing on the same step.

**The ladder, 300 matches a cell, both seat orders:**

| | as seat one | as seat two |
|---|---|---|
| hard v easy | 97 % | 96 % |
| normal v easy | 95 % | 89 % |
| hard v normal | 90 % | 88 % |

Monotone in both orders. Note how little solo time it takes: `hard` is 1.8 s faster than
`normal` over a 25-second course and wins nine times in ten, because a race on one shared
course is decided by a single fall.

**A note on sample size.** Four hundred matches is not enough here and said so: an early
`hard` pairing read 56 % over 400 seeds and 51 % over 2,400. A match costs under half a
millisecond, so the honest sample is free.

## Rule 7: never colour alone

- p1's wheels are solid discs and its rider a circle; p2's are rings and its rider a square.
- A bike on its back gets a cross through it, and its colour goes soft.
- The pitch gauge marks the balance point at the far end and the wheel-down line at the near
  one, and grows a **spike** as well as changing colour when the nose is coming up fast.
- Under it, a second short bar shows the lean, with the lean that would hold the current
  angle marked on it. Lining the two up is the whole craft, and it is drawn rather than
  written.
- Marker posts are pips on each seat's own edge: discs for p1, blocks for p2.
- Bumps are triangles and posts are bars, so the thing to duck for and the thing to count
  differ by shape.
- **No text anywhere**, asserted over 900 frames of a live match.
