# Tennis — specification

**Archetype:** `rt-split` · **Category:** Sports · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~40 s

> **This spec was written from the implementation, not before it.** Every number below was
> read out of `src/rules.ts` and `src/manifest.ts` rather than remembered, and every rate was
> measured by running the compiled code. Where a decision has no source in the observed rules
> it is marked **[ours]**.

## Observed rules

> Click to jump with the player and hit the ball. If you hit it with the center of the tennis
> racket, the ball will go really fast.

That is the whole of it, recorded by playing the reference genre (`docs/observed-rules.md`).
It fixes three things and leaves everything else open:

1. **there is a jump, and it is a button** — not automatic, not a gesture, a press;
2. **the racket has a middle**, and where on it the ball lands matters;
3. **a middle contact makes the ball fast** — the reward, not the punishment.

Everything else — what a court is, what ends a rally, how a point is scored, what a player
actually controls between presses — is ours. The two halves of the sentence are one mechanic
rather than two, and that is the load-bearing reading: **jumping does not extend your reach,
it moves it**, so the button is how you get the middle of the strings onto a ball that would
otherwise catch the frame.

## The court

Seen from above, a net across the middle, one player each side. The ball has a **height**,
`z`, and gravity acts on `z` alone. **[ours]** That is the decision the whole game hangs on: a
`horizontal` split puts the two seats at the top and the bottom of the device, so a side-on
game with gravity down the screen would pull the ball toward one of them and the bottom seat
would be playing a different game from the top one. On a third axis that belongs to neither
seat, the court is point-symmetric about the net.

| | Value | Why |
|---|---|---|
| Court | 600 × 1000 units | Portrait: two people share one upright phone, a half each |
| Scale | 500 units ≈ 11.9 m | Half a real 23.77 m court, so every length below can be sanity-checked against the real game |
| Net | at y = 500, **44** high | A true-to-scale net is 38; 44 is that with a little added, because this net is also a *drawn* band seen from above and has to read as an obstacle **[ours]** |
| Net bounce | 0.28 | A clipped ball drops back on the side it came from with most of its pace gone |
| Ball radius | 14 | |
| Player radius | 34 | Drawing, and the margin that keeps a player inside their own half |
| Racket centre | 76 above the court | A 1.8 m player at the scale above; a racket held at the ready sits about there |
| Racket radius | 38, so **reach = 52** | Racket plus ball. Small on purpose — see below |
| Ball gravity | 1300 units/s² | Re-derived, **not** Beach Ball's 700 |
| Jump | 430 units/s against 1200 units/s² | **77.0** units of lift, **0.717 s** in the air |
| Landing cooldown | 0.14 s | So pressing the button repeatedly is not a way to spend a whole point airborne |
| Player speed | 320 units/s | Identical for both seats, both input families, on the ground and in the air |
| Half bounds | x ∈ [34, 566], y ∈ [534, 966] for p1 | p2's is the exact reflection; neither seat has a step more room |
| Ready spot | 260 behind the net | The middle of the band shots land in (120–400) |
| Serve spot | 400 behind the net, ±130 across, ±80 deep | Seeded nudge, so points do not all open identically |

p1 defends the bottom (y ≥ 500), p2 the top, matching the `horizontal` zone split the manifest
declares and the engine's `bottomSeat: 'p1'`.

**Nothing here is in pixels.** The renderer is the only thing that knows a device exists, and
`cross-viewport.test.ts` plays the identical match at every viewport size to prove it.

### Two constants that were re-derived rather than inherited, and why

- **Ball gravity, 1300.** Beach Ball uses 700 because a beach ball floats. Copying it here was
  measurably wrong twice over: it decides how fast the ball falls through the band the strings
  cover, *and* it sits in the denominator of the net-clearance solve, so it also decides how
  much pace a shot can carry and still go over. Swept from 620 to 1300 against measured rally
  length: below about 1100 the ball hangs long enough that a well-placed bot is always under
  it, `hard` against `hard` never missed, and **68% of points ran into the 16-touch cap**. At
  1300 that is **0.3%**.
- **Racket radius, 38.** With a 50-unit head — the obvious number, and the one a volley game
  would use — the strings covered so much of the `z` axis that no ball ever arrived at a height
  a standing player could not deal with. The jump bought nothing, nobody missed, and `hard`
  against `hard` reached the cap on two thirds of its points. At 38 the strings span 104 units
  of height, a ball dropping out of a rally regularly arrives above them, and **the button in
  the observed rule is the answer**.

## The rally model

### The middle of the strings

The strings are a **ball of radius 52 centred on `(x, y, z + 76)`**. `contactSweetness` is
`1 − distance / 52`, clamped: 1 dead centre, 0 on the frame, nothing outside.

**The first version of the contact test deleted the headline rule, and it is worth recording
exactly how.** Asking "is the ball inside the strings?" once a step strikes the ball on the
step it *arrives*, which is the step it is at the very edge of them. Across 40 measured
matches, **not one contact in 4769 was anywhere near the middle** — every single one graded as
a frame shot — and "hit it in the centre and it goes really fast" described something that
could not happen. All nine global guards passed the whole time, because a match still ended
and still reported a winner.

A racket does not work like that. The ball crosses the strings, and how well it was struck is
how close to the middle it *passed* — a property of the path, not of any one sample of it. So
`step` advances both the ball and the racket, takes the ball's position relative to the strings
before and after, and finds the closest point on the segment between them (`closestApproach`).
Sampling noise goes with it: a ball crossing at 50 units a step used to be judged wherever the
sixtieth of a second happened to fall.

`when === 1` means the ball is still closing and the swing has not happened yet, so the caller
waits a step. That is what lets a player line the middle of the strings up on a ball that is
still coming — and it is the difference between a game about the racket and a game about the
frame.

### Pace, and why it is pace rather than flight time

A struck ball is **aimed** at a spot on the far court and given a **pace**:

```
pace = 620 · (1 + 0.95 · sweetness) · (1 + min(0.06 · touches, 0.5))
flight = distance / pace,  floored at 0.20 s and capped at 1.60 s
```

The first version chose the *flight time* instead and let the speed fall out of it. The trouble
is that a shot placed wide has further to travel: a limp ball into the corner and a fierce one
down the middle came out at the same units a second. Measured over 40 seeded matches at every
tier, a dead-centre contact left the strings at **757** and a frame contact at **730** — a **4%
difference for the mechanic the whole game is named after**. Choosing the pace and deriving the
flight makes "really fast" a fact about the ball rather than about the target.

### Placement

Which *way* from the middle the ball was met decides where it goes — met on your left it goes
left, met in front of you it goes deep, behind you it drops short — and your own run adds to
both at `MOVE_TRANSFER` 0.3 (0.28). Shots land 120–400 from the net and up to 215 either side
of the centre line.

`AIM_SPAN` = 0.7 is the one number that keeps placement and pace from being the same
measurement. At 1 the coupling is total: the only way to hit into the corner is to catch the
ball on the frame, which is by construction the slowest shot there is, so two even players trade
balls that are either fast and central or wide and limp — and every one of them is reachable.
Measured, at 1 `hard` against `hard` averaged **7.2 strokes a point and ran into the 16-touch
cap on 21% of them**; at 0.7 the same pairing averages **3.0** and reaches the cap on **0.3%**.

### The net, and the correction that made the difficulty ladder point the right way up

With `z(t) = z + v·t − G·t²/2` solved so the ball lands at `t = flight`, the height at the net
is closed-form:

```
φ = distance to the net / distance to the target
height at the net = (1 − φ) · (z + G · flight² · φ / 2)
```

Two terms, traded against each other on every shot: **how high you met the ball** and **how
long you gave it**. A fiercer contact shortens the flight, so the second term shrinks and the
first has to carry it.

Left alone, that makes striking the ball *well* a mistake. Measured over 40 matches, `hard` put
**21%** of its shots into the net against `normal`'s **11%**, and **lost the series 31–69**
while out-striking its opponent on every other number. A game whose headline verb is punished
is the same failure as one whose headline verb never happens.

So `clearingFlight` inverts the formula for the flight time and a shot is given **the pace the
strings earned it, or the slowest arc that clears, whichever is slower**:

```
f² = 2 · ((clearance / (1 − φ)) − z) / (G · φ)
```

The pace a player can actually use is therefore set by *where and how high they met the ball*,
which is the observed rule's second clause as arithmetic: from the back of the court a standing
contact is throttled and the same contact at the top of a jump is not. Measured over 2410 bot
strikes, the floor binds on **6% of `easy` contacts, 10% of `normal` and 19% of `hard`**, and
takes about a **tenth** off the pace when it does. The better you are hitting it, the more often
the net is the thing telling you to get higher or come forward first.

What is left over — a ball met below the top of the net and a stride from it — genuinely cannot
be lifted over, and that is the one way a struck shot still finds the net.

### One bounce a side

The ball bounces: `vz` keeps 0.85 of its downward speed, `vx`/`vy` keep 0.55, and the rebound is
capped at 420 units/s. **[ours]** A second bounce on the same court without a racket on it ends
the point. A ball may be volleyed out of the air or taken after the bounce; the counter resets
when a player strikes it.

Every bounce is resolved at **the exact instant it happens** — `z + v·τ − G·τ²/2 = 0` — rather
than snapped to the step boundary. Snapping loses a fraction of a step of rise, and a *different*
fraction at 120 Hz than at 60, so the same rally would play out differently on two devices,
which rule 8 forbids.

### Why a rally ends

Measured over 3244 points of bot play, in order of frequency: **the receiver could not get
there** (the ball bounces twice, or bounces once and leaves the court) — about 96% of points;
**a ball into the net** — the rest; **the 16-touch cap** — twice, 0.06%.

Three separate guarantees, and only the first is tuning:

1. **Pace escalates through a rally** (`RALLY_PACE`, half again by the eighth touch), so a rally
   of frame shots that neither player can miss still runs out.
2. **One touch a side.** `eligibleSeat` refuses the seat that struck last, which is also why the
   classic racket-game hang is impossible: a ball with no pace left cannot rest against a player
   and be struck again every step, because that player may not touch it.
3. **A hard cap at 16 touches**, past which the ball is dead and nobody may play it, so it
   lands, bounces twice and the point resolves.

## Scoring and the win condition

**First to 4** — `{ kind: 'first-to', target: 4 }`, resolved by the SDK's `resolve` helper with
`timeExpired` from the clock below. No comparison is written by hand anywhere in this package.

Whoever's court the ball died on concedes, which covers both ways that happens: a ball nobody
reached, and a ball somebody put into their own half of the net. **The seat that lost the point
serves next** **[ours]**, which keeps a one-sided match from running away from the player who is
already behind.

After a point: a 0.8 s pause, then the serve. The serve is a 0.9 s toss above the server at
z = 130, struck at a fixed quality of contact (0.55) and aimed like any other shot, so it always
crosses and always lands in — a serve that could fault would hand the receiver free points, and
one that could not vary would open every point identically. There are no service boxes, no
faults and no lets. **[ours]**

### The termination argument

1. **Nothing waits for input.** The serve is on a timer, not a trigger. Two seats that never
   touch a control still play the match out: **300 measured, every one decided, 23.9 s at
   worst.** The seat that served first took 65% of them — a serve advantage, not a seat one:
   p1 took exactly 50%. It is not "whoever serves first wins", because the serve is aimed into
   the band the receiver's ready spot sits in and a player standing perfectly still returns some
   of them.
2. **Every rally is bounded**, three ways over (above).
3. **Every point is bounded.** Toss, flight, bounce, pause — all finite, all on the clock.
4. **The match has a backstop at 150 s.** `MATCH_SECONDS`, drawn as the bar down the left edge,
   because a rule nobody can see is a rule nobody can play to. Level at the whistle is a draw,
   which the helper defines rather than this package.

**The arithmetic, multiplied out** — `rules.test.ts` asserts every line of this:

| | |
|---|---|
| Longest bounce hang | `2 × 420 / 1300` = **0.646 s** |
| Longest gap between two touches | `MAX_FLIGHT + 0.646` = `1.6 + 0.646` = **2.246 s** |
| Longest rally | `16 × 2.246` = **35.9 s** |
| Longest point | `0.9 + 35.9 + 0.8` = **37.6 s** |
| Longest match, first to 4 | `7 × 37.6` = **263 s** |
| Against the guard's ceiling | 263 s < **600 s** ✅ |
| And the clock cuts it anyway | 150 s + one step |

Measured, 200 matches a pairing: easy against easy — the pairing the termination guard uses,
because the weakest play is the most likely to reach a position nothing resolves — finishes in
**34.4 s at worst** and 20.0 s on average; hard against hard in **34.5 s** and 20.1 s. Neither
the 150 s clock nor the 16-touch cap was reached in any of the 600.

## The headline verb, measured

Spin War shipped with its own headline verb — pushing a top out of the bowl — **impossible**,
across four hundred bot matches, with every global guard green the whole time. So this is
measured rather than assumed, and measured **without reading the game's own counters**:
`rules.test.ts`'s `playMatch` drives whole seeded matches through the public functions and
recomputes sweetness from the sampled ball and player, never from `match.lastSweet` or
`StepResult.sweetness`.

Over **200 matches a tier**, all decided:

| Tier | Points | p1 / p2 | Mean rally | Longest | Cap reached | Strikes | Jumps | Struck airborne |
|---|---|---|---|---|---|---|---|---|
| easy | 1108 | 544 / 564 | 1.94 | 13 | 0 | 2149 | 694 | 609 |
| normal | 1087 | 558 / 529 | 2.23 | 15 | 2 | 2420 | 832 | 828 |
| hard | 1049 | 501 / 548 | 2.99 | 14 | 0 | 3137 | 682 | 682 |

**Both seats score at every tier.** Rallies happen and are not decided by the cap. Players leave
the ground and strike the ball while they are up there — the other half of the observed rule,
and a tier that never jumped would still rally, still score, and still pass every guard in the
repository.

And the rule itself — **pace off the ball's own velocity, one step after contact, bucketed by
reconstructed sweetness**:

| Tier | Centre (≥ 0.66) | Middle | Frame (≤ 0.33) | **Centre ÷ frame** |
|---|---|---|---|---|
| easy | 282 strikes @ **1187** | 834 @ 997 | 1033 @ **810** | **1.47×** |
| normal | 464 @ **1179** | 1082 @ 1001 | 874 @ **841** | **1.40×** |
| hard | 510 @ **1172** | 1686 @ 1021 | 941 @ **872** | **1.34×** |

`PACE_GAIN` promises 1.95× before the net takes its cut; 1.34× to 1.47× is what actually
reaches the ball, and that is the honest figure. `rules.test.ts` asserts the ratio is above
1.25 at every tier, and that centred contacts and frame contacts both actually happen.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| **p1** (near, bottom half) | Touch your own half; your player runs to your finger. Every fresh press is a jump | `W` `A` `S` `D` to run, **`Space` to jump** |
| **p2** (far, top half) | The same, in the top half | Arrow keys to run, **`Enter` to jump** |

Movement is a **direction**, never a distance: the pointer contributes the unit vector from the
player to the finger, the keys contribute the unit vector they are holding, and both go through
`movePlayer` under the same 320 units/s cap. Nothing rewards a mouse over a thumb, which is why
`sameInputClassOnly` is `false`. There is no mode to switch between them: a pointer that is down
wins for that seat this step, and the keys drive when it is not.

**The jump is `actionPressed`**, which the engine raises for exactly one step on the press edge
of *either* the action key or a pointer going down. That is what makes both strings true at
once, and it is why a fresh touch is honestly advertised as a jump rather than quietly being
one: on a touchscreen the finger *is* the action, and a control string that said "drag to run"
and nothing else would be hiding half of what a tap does. Holding either does nothing extra —
one press, one jump, in the engine and here both.

Both strings in `manifest.ts` were driven clause by clause through the real `InputManager` in
`game.test.ts`, not read and nodded at: W A S D moves the near player and the arrows the far
one; neither seat's keys move the other's player; Space and Enter each lift their own seat; a
held key gives one jump and not one a frame; a finger in the bottom half runs p1 and jumps; a
finger in the top half runs p2; and a drag that crosses the midline keeps the seat it started
in.

## Edge cases

- **Simultaneous input.** Both seats act every step and each owns its own half. There is one
  contested object, the ball, and `eligibleSeat` cannot hand it to both: only one seat's half
  contains it, and the seat that struck it last is refused outright.
- **Input in the other seat's zone.** A touch belongs to the seat it *started* in and keeps it
  across the midline — that is the engine's `seatForPoint` and `PointerOwnership`, used here
  through `input.seat(...)` and not reimplemented. Pointing across the net simply runs your
  player up to their own line, because `movePlayer` confines them. There is deliberately no
  second copy of that rule in `game.ts`.
- **No input at all.** The match still finishes; see the termination argument.
- **A ball exactly on the net line at a step boundary.** This one was a real bug and a test
  found it. The crossing test used to be a sign product, `(prevY − 500)·(y − 500) < 0`, which
  answers *no* whenever either endpoint is exactly on the line — so a ball that landed on
  `y = 500` at a step boundary walked straight through the net on the following step however low
  it was. It is now asked as "did the ball change sides?", using the same half-open convention
  `sideOf` uses. Measure-zero, and it turned up on the third seed a test tried.
- **A ball clipping the net.** Tested on the *crossing*, not at the step boundary — a struck
  ball can cover fifty units in a step and the net is thinner than that — and the height at the
  crossing is solved on the parabola the ball is actually flying rather than on a chord between
  the endpoints. A chord always sits *below* a concave arc, so a chord test fails balls that in
  fact cleared. The clipped ball comes back on the side it came from, the player who put it
  there may not touch it again, and it dies on their own court.
- **A ball at your feet.** The strings reach down to `76 − 52 = 24` and no lower, so a ball on
  the surface is not playable. You take it on the rise or you were too late.
- **Pause with a key held.** `onPause`/`onResume` zero both players' velocities, because a shot
  takes some of the runner's motion and a key still down across a pause must not read as a
  sprint into the ball on the first step back.
- **Stalemate.** There is none to have. Every rally is capped, every phase is timed, and the
  match has a clock.

## Determinism

- **Fixed timestep everywhere.** Every duration is in seconds and integrated against
  `fixedDeltaSeconds`; nothing counts frames.
- **Both heights use the analytic integral**, `z += v·dt − G·dt²/2` with `v -= G·dt`, not one
  Euler step of it. A half-step of `vz` accumulates, and only the analytic form puts the ball in
  the same place at 60, 90 and 120 Hz — asserted.
- **Both ground contacts are solved to the instant, not the step boundary.** The ball's bounce
  and the player's landing both solve `z + v·τ − G·τ²/2 = 0`, so the rebound and the 0.14 s
  cooldown are identical at any rate. Both are asserted at 60, 90 and 120 Hz.
- **All randomness is seeded.** The opening coin flip and every serve nudge come from the
  injected `Rng`. No `Math.random` anywhere, which lint enforces.
- **The two seats consume the stream at the same rate.** `game.ts` draws exactly two floats per
  bot seat per step whether or not they are used, so one bot's decisions cannot shift the other's
  and a bot match cannot be decided by draw ordering.
- **`update()` allocates nothing.** `step` rewrites one shared `StepResult` and one shared
  `Contact`, the prediction walks one shared `Ball`, the bot writes into one shared `Intent` and
  one shared `Interception`, and the win condition and its options object are held rather than
  rebuilt.

One honest caveat: the *contact* is sampled on the step boundary, as it is in every game here.
The swept closest-approach test removes almost all of that sensitivity — it measures the path
rather than the sample — but two devices running at genuinely different fixed rates would still
see slightly different contact points. The host runs one fixed rate, and everything the ball
does between contacts is rate-exact.

## The seat-symmetry result

Every `y` in `rules.ts` is paired with a `forwardOf`, and the two halves, ready spots and serve
spots are exact reflections. `rules.test.ts` plays a whole four-point match twice — once as
given, once reflected top to bottom with the seats swapped, both seats chasing *and jumping for*
the ball — and compares them every step, in two strengths:

- **Decisions match to the bit.** Who served, who struck, who scored, the score, the phase, the
  touch count, the bounce count, the result. Not one differed.
- **Measurements match to 1e-2 units.**

The tolerance is not slack, it is arithmetic. `COURT_HEIGHT − y` is **not an involution** in
double precision: the court is measured from a corner, so p2's half (0–500) is spaced twice as
finely as p1's (500–1000) and a point on one half can name a spot on the other that no double
lands on. Reflect 220.1 twice and it moves by 2.8e-14. Only putting the origin on the net would
make the two halves representationally equal, and that is a different coordinate system, not a
bug fix. What is left is the representation leaning half an ulp at a time, compounded through a
chaotic rally; a real asymmetry — a missing `forwardOf`, a bound short by a player radius — is
tens or hundreds of units and trips the same check on the first step.

Independently, and over **three unrelated seed families of 200 matches each**, bot against bot
at the same tier:

| Tier | family A | family B | family C |
|---|---|---|---|
| easy | 49.0% | 51.0% | 48.5% |
| normal | 49.0% | 48.0% | 48.0% |
| hard | 49.0% | 51.0% | 46.5% |

Nine readings, all between 46.5% and 51.0%. Three families rather than one deliberately: Chicken
Jump's first pass showed 57–58% at equal tiers, which looks exactly like a seat bias, and across
two further seed families it was 47.5–52.3% — the first family was correlated, not biased.

## The bot

It reads the ball's position, velocity and height, its own position, whose touch it is, and how
many bounces the ball has left — all of which the court draws for both people, including the
landing marker it predicts against. It runs no faster, reaches no further and jumps no higher
than a person (CLAUDE.md rule 6); the three tiers differ in four numbers and none of them is
physics.

| Tier | Reaction | Judgement error | Meet ceiling | Jumps early by |
|---|---|---|---|---|
| easy | 0.28 s | 36 units | 100 | 0.14 s |
| normal | 0.23 s | 29 units | 116 | 0.10 s |
| hard | 0.19 s | 23 units | 132 | 0.06 s |

- **Reaction** is seconds between looks. Even `hard` is only quick within human range (simple
  visual reaction is about 0.25 s), not past it.
- **Error** is how far off the interception it judges the ball, drawn **once per shot** and held
  through the SDK's `bot-judgement` module. A fresh error sixty times a second averages to zero,
  so the bot would stand on exactly the right spot however large its supposed inaccuracy and
  every tier would play the same. Three games in this repo shipped that bug.
- **Meet ceiling** is the highest the ball may be for that tier to go and take it. A high ceiling
  means taking it early, up near the top of its arc, nearer the net and high enough that a jump
  puts the middle of the strings on it — so the return is fast *and* is not throttled. A low one
  means letting it come down first, which means playing it from the back of the court off a
  contact the strings can only reach at their edge. It is not a physical advantage: every tier
  runs at 320 and reaches 52.
- **Jumps early by** is the second half of the observed rule as a difficulty lever. A jump is a
  fixed parabola, so being at the right height when the ball arrives is a question of *when* you
  left the ground — `takeoffFor` solves it exactly, and a bot with zero here would put the middle
  of the strings on the ball every time. The tiers differ by how far ahead of that instant they
  go, which is the same thing a person gets wrong: leave too early and you are already coming
  down, and the ball catches the top of the frame.

**Measured over 200 matches a pairing, seats swapped every other match:**

| | wins |
|---|---|
| normal beats easy | **74.0%** of 200 |
| hard beats easy | **96.5%** of 200 |
| hard beats normal | **78.0%** of 200 |

All 600 decided; none drawn, none out of clock. Method: run `createMatch` / `botIntent` /
`movePlayer` / `jump` / `step` at 1/60 from a seeded `Rng`, alternate which tier sits in p1,
count wins. Re-measuring is a `node` script over `dist/rules.js` rather than anything ceremonial.

**`hard` against `easy` is close to saturated at 96.5%, and that is said rather than hidden.**
Three tiers over a four-point match cannot separate the ends of the ladder more gently without
collapsing the middle of it; the middle — 74% and 78% — is where the setting earns its keep. An
earlier, wider set measured 81 / 98.5 / 94, which is a wall rather than a difficulty setting.

Three things about this bot are worth carrying forward:

- **It predicts the earliest point on the flight it can get the strings to, not where the ball
  lands.** Aiming at the landing spot is the obvious thing and it makes a bot *worse the quicker
  it is*: a player waiting on the spot meets the ball off its ankles, and a ball met off the
  ankles goes back slowly.
- **It runs the real physics to predict** — literally `advanceBall` and the net, the same
  functions the simulation calls. That is not tidiness. The ball here bounces, and a
  straight-line prediction is not merely imprecise about a bounce, it is wrong about which side
  of the court the ball ends up on.
- **A new shot starts the reaction clock rather than invalidating the decision.** With an
  immediate re-look, reaction time does nothing at all: a ball in flight is ballistic and looking
  at it twice tells you no more than looking at it once.

## Presentations

Neither the presentation nor the local seat is read, and that is deliberate. The court is
point-symmetric about the net, so rotating it half a turn maps each seat's half onto the other's
exactly and both people already read their own end upright.

- **Shared-screen.** The court splits across the middle, a half each, nothing rotates. A
  `turn-board` game needs `seatView`; a split court does not, and the branch could only ever be
  wrong.
- **Single-seat.** The whole court upright. The opponent is drawn and unreachable.

Every shadow — the ball's and both players' — slants along **x**, the axis the two seats share.
Slanting along `y` would put a shadow nearer one seat and give that player a fractionally better
read on the height, which is exactly what rule 9 is about.

## Rule 7 — colour is never the only signal

p1 is a **disc with one ring**; p2 is a **square with two**. The ball is seamed rather than
plain so it is not a pale circle next to a pale line. The racket is drawn as its own ring with a
smaller ring inside it — the middle of the strings, the thing the whole game is about — offset
along x by the player's height exactly as the shadow is, so a jump is legible from directly
above: the body swells, the strings slide out from under it, and the sweet spot goes with them.
A clean strike flashes the ring at a radius that grows with how clean it was, so a player learns
what the middle of the strings feels like without being told. In greyscale the silhouette, the
ring count and the flash all survive.

## What is not specified here

Art, audio and haptics. Also unmodelled, and deliberately: spin, wind, doubles, service boxes,
faults, lets, tie-breaks, advantage scoring, and any collision between the two players (they
cannot reach each other). The serve cannot fault by construction, so there is nothing to model.
