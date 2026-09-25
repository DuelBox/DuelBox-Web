# Ball Games

> Catalogue row: *"Shoot and score with every part of your body."* — `rt-split`, Sports,
> `friend` and `bot`, 600 × 1000 portrait, horizontal zone split.

One pitch, two goals that are half-turn images of each other, one player each, and a ball
that has a **height**. How high the ball is when you meet it decides which part of you meets
it, and the three parts do three different things. That is the row, read literally, and it
is the only mechanic in the game.

Everything below is measured from the implementation. Where a number came out of a sweep,
the sweep and its sample size are named.

---

## What the row does and does not decide

The row is one sentence and it decides two things: it is football, and the body has parts.
Everything else is ours and is argued here.

- `[ours]` **Height as the axis.** "Every part of your body" needs a variable that says
  which part. It could have been a facing angle, a button, or where on your body the ball
  struck. It is height, because height is the one quantity that both players can *create*
  as well as read — you loft it deliberately, and the loft is what makes the next contact
  a header rather than a shot. A facing angle would have been a second control to teach; a
  button would have made the choice free rather than earned.
- `[ours]` **Three surfaces and a fourth outcome.** Foot, chest, head — and *out of reach*,
  above head height, which is the reason the other three are a decision rather than a
  label. A ball you cannot touch is what makes lofting one over somebody worth doing.
- `[ours]` **The goal has a ceiling.** A shot only counts under the bar, and a header peaks
  at 83.3 units against a 74-unit ceiling. So a header from six yards goes into the roof of
  the net and a header from thirty yards drops under the bar. That gap is the whole tactical
  content of the header.
- `[ours]` **A closed frame, so there is no out of play.** A ball arriving above the bar
  rebounds off the netting instead of leaving the pitch. This is not realism, it is a
  deliberate simplification, and it buys a real invariant: **the ball is always inside the
  pitch**, which `rules.test.ts` asserts over 400 random launches at the speed cap. No
  throw-in, no goal kick, no restart to get wrong, and nothing that could stall a match.
- **Not built:** no teams, no goalkeeper, no offside, no fouls, no sliding tackle. One
  player a side keeps the read of the pitch honest at 320 px, and the row asks for a body,
  not a squad.
- **Not built:** no aiming control. Direction comes from where you meet the ball and how
  you were running, exactly as in Mini Soccer, and for the same reason — a separate aim
  would have made the approach worthless.

---

## The pitch

Every simulation value is a logical unit measured **from the centre spot**. The renderer
adds (300, 500) to put it in the manifest's box and nothing else ever does.

| | Value | Why |
|---|---|---|
| Logical box | 600 × 1000, portrait | Two seats, one at each end of the device |
| Pitch | x ±268, y ±452 | Centred on the origin, so the half-turn is exact negation |
| Ball | radius 13 | |
| Player | radius 33 | |
| Rails, for the ball's centre | x ±255, y ±439 | Pitch half minus the ball's radius |
| Goal mouth | ±100, on each end line | Posts at (±100, ±452), radius 7 |
| Goal ceiling | 74 | The highest a ball's centre may cross the line and count |
| Kick-off marks | (0, +170) and (0, −170) | Exact negations of each other |
| Player speed | 375 units/s | |
| Gravity | 1500 units/s² | |
| Air drag | keeps 0.70 of speed per second (rate 0.3567) | |
| Rolling drag | keeps 0.22 per second (rate 1.5141) | Turf eats a ground ball; air does not |
| Stop line | 10 units/s | A rolling ball stops dead here, exactly |
| Turf bounce | 0.50, planted below 70 units/s | |
| Rail and post bounce | 0.60 | |
| Speed cap | 1000 units/s | |
| Clock | 90 s, then 60 s of golden goal | Ends the match; `roundSeconds` ends nothing |
| Target | 5 goals | Whichever comes first |

### Why the origin is the centre spot

This is the seat-fairness mechanism, not a style choice.

Written about the centre, the half-turn that swaps the two seats is `x ↦ −x, y ↦ −y`, and
negation is **exact** in IEEE-754 for every double there is. Written in box coordinates the
same half-turn is `x ↦ 600 − x`, which is not: two seats accumulating from opposite ends of
the board disagree in the last bits, straddle a threshold, and the game leans. That is
precisely the defect Snowball Throw shipped (a reaction threshold on a knife edge, seat one
at 64.3%) and the one Frozen Beaks shipped (a dunk distance that is exactly the hole radius
by construction).

With the origin at the centre the whole defect family is unrepresentable rather than merely
absent, and `rules.test.ts` asserts it board by board — see **Seat balance** below.

---

## Every part of your body

The surface is chosen by the height of the ball's centre at the moment of contact. A player
reaches 48 units horizontally (33 + 13) and 98 units up.

| Ball centre | Surface | What it does |
|---|---|---|
| ≤ 28 | **foot** | 760 units/s along the line between the centres, plus 0.55 of your run, lofted 150. The shot. |
| ≤ 64 | **chest** | 0.30 of the pace it arrived with, floored at 105, plus 0.30 of your run, and the height killed to **zero**. The trap. |
| ≤ 98 | **head** | 540 units/s plus 0.40 of your run, lofted **500**. The ball over the top. |
| above 98 | — | Nothing. It flies over you. |

Measured, from a standing contact on an empty pitch:

| | Travels | Takes | First lands after |
|---|---|---|---|
| Foot shot | 661 units | 3.10 s, 2 bounces | 150 units |
| Header | 838 units | 3.82 s, 1 bounce | **320 units** |
| Chest trap | 109 units | 2.05 s | — |
| Kick-off nudge | 73 units | 1.65 s | — |

The pitch is 904 units end to end, so a foot shot from your own half arrives; a header
carries further but takes longer and can be met in the air only by another header. Loft
peaks are 83.3 units for a header and 7.5 for a foot shot, against a 74-unit goal ceiling
and a 98-unit reach — which is what makes all four rows above a decision:

- **Trap, then shoot.** A chest trap leaves the ball 109 units away and on the floor, where
  your foot is. It is the rally of this game.
- **Head it over somebody.** A header clears 98 units within a stride and stays above it
  for 320, so a defender standing in the line of it cannot touch it.
- **But not from close in.** 83.3 > 74, so a header at the goal only scores from far enough
  out that it is already coming down. Headed from six yards it hits the roof of the net.

### The fifty-fifty

Two players whose swept times of impact are *exactly* equal both get a cooldown and neither
gets the ball; it runs on. This is not flavour, it is the only resolution that is covariant
under the half-turn. Any rule that named a seat — "seat one has the advantage", a seeded
coin, the lower index — answers the mirror position the same way and therefore hands the
ball to the same seat in both, which is a seat bias by construction. Maze Paint's finding,
generalised: *a tie-break written in board coordinates cannot settle a mirror position.*

---

## The integrator

`advanceBall` is an **event-driven closed-form integrator**, not a stepper. Between events
the motion has an exact solution — horizontal speed decays exponentially, height is a
parabola — and each event's time is *solved for* rather than discovered at a step boundary:

- **the stop line**, `t = ln(v / 10) / rate`, so a free roll covers exactly
  `(v − 10) / 1.5141` and then stops dead — a ball rolling at 760 covers exactly 495 units.
- **landing**, the positive root of `z + v_z t − ½g t² = 0`.
- **a rail**, by inverting the drag law. Both horizontal components decay by the same
  factor, so the path within an arc is a **straight line** and its whole geometry is carried
  by one scalar `f(t) = (1 − e^(−rate·t)) / rate`, with `x(t) = x₀ + v_x·f(t)`. The `f` at
  which the ball reaches a plane is a division; `t` is a logarithm.
- **a post**, by the engine's `sweptCircleCircle` — which answers "how far along this
  displacement", and the same drag law turns that back into an exact time.

Height carries its `½·a·t²` term and the position is written **before** the velocity, which
is Cannon Duel's lesson: the other order lands a whole `a·dt²` per step instead of half of
one, and the shortfall accumulates down the pitch.

### Step-size invariance, measured

The same launch stepped at 60, 90, 120 and 240 Hz for two seconds, and then advanced in a
**single** two-second call. The figure is the distance from the 60 Hz answer, in logical
units:

| launch | 90 Hz | 120 Hz | 240 Hz | one call |
|---|---|---|---|---|
| a foot drive up the pitch | 0 | 3.4 × 10⁻¹³ | 5.6 × 10⁻¹² | 1.5 × 10⁻¹² |
| a header across the pitch | 1.7 × 10⁻¹² | 4.9 × 10⁻¹³ | 1.4 × 10⁻¹¹ | 2.7 × 10⁻¹² |
| a ball rolling due east | 1.4 × 10⁻¹³ | 8.5 × 10⁻¹⁴ | 0 | 0 |
| a lofted diagonal | 8.8 × 10⁻¹³ | 1.3 × 10⁻¹² | 1.0 × 10⁻¹¹ | 2.3 × 10⁻¹² |

Worst **1.35 × 10⁻¹¹** units, two orders inside the nine decimal places `rules.test.ts`
asserts. Every one of those launches bounces off the turf, and two of them bank off a rail,
so this is not the invariance of a clean roll — it is the invariance of the whole flight.

**The honest limit.** Invariance holds for the *ball*, and not for a contact with a
**player**. A player is driven by input that only exists at step boundaries, so there is no
exact time at which one was anywhere, and the swept contact is resolved on the step's chord.
A match is therefore step-rate-invariant only as far as its first body contact. Nothing
depends on it — the fixed timestep is 60 Hz everywhere — and the reason to write the ball
exactly anyway is the next section.

### Issue #2465, and why it cannot happen here

#2465 is the shape where a bot reasons analytically about a quantity the simulation
integrates numerically: the two disagree, the bot aims at a game nobody is playing, and no
amount of tuning its error reaches the bias.

The bot here **has no arithmetic of its own**. It predicts by calling `advanceBall` on a
scratch ball, which is the same function the simulation steps with. And because that
function is exact for any duration, the prediction is *one call* with a big `dt` rather than
a loop of sixty — it is analytic in effect and identical in code. `rules.test.ts` asserts
one call and ninety agree to 1e-9 anyway, because "it is the same function" is a claim about
today's source and a test is a claim about for ever.

### The bug this found

Measuring the event loop's worst pass count over a ladder of matches showed it **binding at
its full guard of 24** — meaning a whole step of the ball's motion was being silently eaten.

A ball whose centre sits a last-bit *outside* the touching distance of a post is reported as
an impact at time zero by the swept test (the quadratic's constant term is a hair positive
and its first root is 10⁻¹⁸) and as *not touching* by an overlap test on the same two
circles. The loop resolved an event that its resolver then declined to resolve: nothing
moved, no time was consumed, and the guard ate the rest of the step. Resolving against the
post the detector named, rather than against "whichever one overlaps", fixes it. Worst pass
count after the fix, over 720 ladder matches and 20,000 random launches at the speed cap:
**7**. The state that found it is a regression test.

### Where the engine's collision module is and is not used

- `sweptCircleCircle` for **ball against player**, on the ball's motion *relative to the
  player's*, which is what makes it correct for two moving bodies. It also gives the time of
  impact inside the step, which is what makes the contact *height* — and therefore which
  part of the body meets the ball — right rather than approximately right.
- `sweptCircleCircle` for **ball against post**. A post is 7 units of radius against a ball
  that covers 17 in a step at the cap, and the mouth is open right beside it, so a post the
  simulation failed to see is not a cosmetic miss — it is a goal. `rules.test.ts` fires one
  dead at a post at the speed cap and requires it not to go in, with the control shot a
  stride inside the post that does.
- **Not** the segment forms, and that is a decision rather than an omission. The flat
  obstacles here — four rails and two goal lines — are axis-aligned planes whose crossing
  times the drag law inverts *exactly*. A swept test there would be an approximation
  replacing a closed form. The swept tests are used precisely where no closed form is
  available: against a moving body and against a round post.

---

## Fairness across input families and devices

**Cross-device: yes, same-class not required.** A key gives a direction and a drag gives a
direction, and that is the whole of the control surface — neither instrument can ask for a
speed, an angle finer than a heading, or a timing window. There is no charge, no flick and
no release, so there is nothing for a thumb to do better than a trackpad or a keyboard.

A pointer names **the point to run at**, not the point to stand on, so the whole pitch is
reachable with a thumb: a finger goes down in its own half — pointer ownership is by origin,
and the engine keeps it across the midline — and drags to wherever you want your player to
head. A finger resting on the player itself is inside the 16-unit deadzone and does nothing.

The pitch is **not turned** for the far seat. Two people sitting either side of one device
are looking at the same table, and both steer in device directions, which is the convention
Air Hockey and Mini Soccer already use for a shared field. In single-seat presentation the
local seat owns the whole viewport and the simulation is byte-identical;
`presentation-parity.test.ts` checks that, and nothing in this package reads
`context.presentation` at all.

`rt-*`, so `getActiveSeat` is **not implemented** and `openingSeat` is ignored — the contract
says a real-time game has no opener, and a game that answered would switch the shell into
shared-board mode and take one seat's pointer zone away.

---

## The bot

It sees the ball, the posts, the pitch and its own position. It does not see the other
player at all. It has no physics the simulation does not have and none a person does not
have: everybody watching a ball predicts where it will come down, and the tiers differ in
how far ahead they manage it and how accurately they then run.

Each decision is:

1. **Solve the interception.** Four passes of "run the ball forward by the time it would
   take me to get to where it will be, then re-time it", capped by the tier's `horizon`.
2. **Stand behind it.** Aim for the spot `approach` units the near side of that point, on
   the line from the ball to the mouth being attacked, so that the contact sends the ball
   forward rather than back where it came from.
3. **Commit, wrongly.** Rotate that heading by an error drawn once per decision, and hold it
   until the next one.

### The look-ahead measured backwards, and is gone

The first version ran the ball forward by a flat `lookahead` and stood where it would then
be. Swept alone against a fixed `normal` opponent, 80 matches a cell:

| fixed look-ahead | 0 | 0.1 | 0.28 | 0.45 | 0.7 | 1.0 s |
|---|---|---|---|---|---|---|
| win share | 23.8% | 43.8% | **50.0%** | 13.8% | 11.3% | **3.8%** |

The tier that could see furthest ahead was the worst player in the game, because a flat
horizon stands where the ball will be *after it has already gone past*. The `hard` profile
built on it lost to `normal` 51–9. This is Crabby Volley's finding arriving from the other
direction, and the fix is not a smaller number — it is solving the interception, after which
looking further ahead is monotonically better rather than a way to run past the ball.

### The four levers, swept alone

Each against a fixed `normal` opponent, **240 matches a cell, both seat orders**. The
standard error of a cell is 3.2 points.

| `reaction` s | 0.08 | 0.12 | 0.22 | 0.32 | 0.45 |
|---|---|---|---|---|---|
| | 86.3% | 64.2% | 50.0% | 32.1% | 16.7% |

| `approach` units | 0 | 22 | 40 | 60 | 70 | 90 |
|---|---|---|---|---|---|---|
| | 10.0% | 32.1% | 50.0% | 62.1% | 62.5% | 60.0% |

| `horizon` s | 0 | 0.2 | 0.35 | 0.6 | 1.0 | 1.6 | 2.4 |
|---|---|---|---|---|---|---|---|
| | 15.8% | 34.2% | 47.9% | 50.0% | 52.1% | 50.8% | 52.5% |

| `wobble` rad | 0 | 0.1 | 0.3 | 0.55 | 0.8 |
|---|---|---|---|---|---|
| | 54.6% | 52.9% | 50.0% | 40.0% | 21.7% |

What that says, and it is not the same sentence four times:

- **`reaction` is the game.** 70 points across its range, monotone, and by a distance the
  widest of the four. How often you look up is what decides a football match between two
  players who can both run.
- **`approach` is the second**, and it stops paying above about 70: standing *too* far
  behind the ball is arriving late. `hard` sits at 70, on the shoulder.
- **`horizon` earns its whole keep below 0.6 s** — 34 points from 0 to 0.6 — and is flat
  above it, with 1.0, 1.6 and 2.4 all inside one standard error of 0.6. So it is what
  separates `easy` from `normal` and it contributes **nothing** to the step from `normal` to
  `hard`. `hard` keeps 1.6 because it measures no worse and because a strong player really
  does look further ahead; the honest statement is that its strength comes from the other
  levers.
- **`wobble` is monotone but shallow at the sharp end**: 4.6 points across the whole bottom
  half of its range against 28 across the top half.

No lever was deleted; one was **replaced**, above. Nothing here is flat over its whole range
or runs backwards.

### The tiers

| | `reaction` | `horizon` | `approach` | `wobble` |
|---|---|---|---|---|
| easy | 0.32 s | 0.20 s | 22 | 0.55 rad |
| normal | 0.22 s | 0.60 s | 40 | 0.30 rad |
| hard | 0.12 s | 1.60 s | 70 | 0.10 rad |

No tier reacts faster than a person: simple visual reaction is about 0.25 s, and `hard`'s
0.12 s is a re-look interval on a decision it has already committed to, not a reflex.

### The ladder, measured

200 seeds a cell played from **both** seat orders, so 400 matches a cell.

| | as seat one | as seat two | average |
|---|---|---|---|
| `normal` over `easy` | 87.5% | 84.5% | **86.0%** |
| `hard` over `normal` | 81.5% | 79.5% | **80.5%** |
| `hard` over `easy` | 96.5% | 98.0% | **97.3%** |

Monotone, and the two steps are about the same size, which is what a ladder is for.

Goals per match at equal skill, and this is the check that the strong tier is an opponent
rather than a wall — Mini Soccer's `hard` had to be *backed off* because two of them
produced 0.3 goals a match:

| | goals, seat one | goals, seat two | draws |
|---|---|---|---|
| easy v easy | 3.85 | 3.69 | 0 of 200 |
| normal v normal | 3.65 | 3.90 | 0 of 200 |
| hard v hard | 2.23 | 2.18 | 12 of 200 |

Two `hard` bots still score four goals between them, and the losing tier is never shut out:
`easy` scores 1.51 goals a match against `hard`. Nothing saturates — the contest is on goals
and the best pair in the game concedes two of them.

---

## Seat balance

Two claims, and they are different claims.

**Structural, and exact.** `step()` and `botHeading()` are exactly covariant under the
half-turn. `rules.test.ts` takes 220 random positions, mirrors each one, hands the two bots
out **by role rather than by seat**, runs 200 steps of both, and requires every field of the
two states to be bit-identical after negation — 20,000+ steps checked, zero differences. A
second test does the same for the bot's heading alone, over 400 positions × 3 tiers.

The one thing that comparison has to forgive is `−0` against `0`: negating a mirrored
position turns one into the other for free, and no comparison anywhere in `rules.ts` can
tell them apart. Nothing else is forgiven.

Two decisions were made *because* of that test, before either could ship:

- **The wobble is a rotation, never an angle added to `atan2`.** `atan2(−dy, −dx)` is
  `atan2(dy, dx) ± π` in real arithmetic and not in floating point, so a heading built by
  adding an error to an arctangent differs between a position and its mirror in the last
  bits — and a bot whose heading differs in the last bits takes a different branch a few
  seconds later. Rotating the unit vector by the error instead is exactly
  negation-covariant, because every term is a product of the same two cosines with a negated
  component.
- **The fifty-fifty**, above.

**Sampled, and a coin.** With the dynamics exactly symmetric, the only asymmetry left in a
match is which seat gets which draws from the one generator the SDK hands over. 1600
matches a tier, played through `game.ts` exactly as the shell plays it:

| tier | matches | seat one |
|---|---|---|
| easy | 1600 | 52.5% |
| normal | 1600 | 51.6% |
| hard | 1600 | 50.3% |

All three inside the 45–55% band, against a standard error of 1.25 points. Pooled, 51.5%.

That the pooled figure sits about a point and a half above even is a property of the **draw
order**, not of the pitch, and it was measured rather than assumed: swapping which seat
draws first over the same 1600 seeds moves seat one's share by −2.2, −3.9 and −0.5 points at
the three tiers. Averaging the two orders gives 51.4%, 49.7% and 50.1%. There is nothing to
fix in the geometry, because the geometry is provably exact.

`balance-aggregate.test.ts`, which plays the game its own way, reads **50.0%** — inside the
flat 45–55% band, not merely inside the 29.0–71.0% its sample can actually enforce. This game
never reads `context.openingSeat`, so since #2494 the harness plays each seed once and spends
the budget on 88 seeds rather than 50 pairs: its average match there is 61.0 simulated
seconds, and 87 of the 88 seeds produce a distinct match, so the sample is a sample rather
than one match counted twice. The earlier reading of **48.0% over fifty seeds** was the same
number taken from half the seeds and twice the matches; the share was never wrong, but the
"100 decided" the harness printed beside it was 50 independent draws.

---

## Termination

`roundSeconds` ends nothing. The clock that does lives in `rules.ts`:

- 90 seconds of regulation. Ahead at the whistle wins.
- Level at the whistle: **60 seconds of golden goal**, once. Still level: an honest draw.
- Or first to 5 goals, whenever that happens.

Worst case is 150 seconds of play plus 2.4 seconds of restart for each of at most nine
goals — under 175 simulated seconds, against the ten minutes `termination.test.ts` allows.
Measured longest over 1600 matches a tier: 115.0 s at `easy`, 118.2 s at `normal`, **170.2 s**
at `hard`, where 6% of matches are still level after golden goal. Nothing came close to not finishing.

The weakest pairing is the one that finds the positions nothing resolves, so the test is
`easy` against `easy` — 40 seeds, all decided.

---

## Rule 7, in greyscale

The palette's own measurement puts the two seat colours at 1.03:1 under deuteranopia, so for
those players shape is not a garnish on colour, it is the whole signal.

- **Seat one is a disc** with an ink ring and **one** ink pip.
- **Seat two is a square** with an ink border and **two** ink bars.
- The ball is a smaller neutral disc with a **cross** through it, and it drags a shadow the
  players do not have.
- The goal frames — uprights, bar, posts — are neutral, so each seat's own signature is its
  player and its net and nothing else.

That gives the greyscale harness the strongest kind of evidence it looks for: a primitive
one seat draws in its own colour and the other never does. `game.test.ts` asserts it from
the recorded draw calls; `greyscale.test.ts` passes the game unlisted.

### The height cue

The ball is drawn shifted up-screen by 0.45 of its height, with a shadow left on the turf
that shrinks as it climbs, and each goal is drawn as a **frame** — two uprights and a bar at
the goal ceiling, lifted by the same 0.45. So "under the bar" is something a player can see
rather than a number in a spec, and a header that is going to sail over looks like it is
going to sail over. The lift is the same at both ends, which is the only choice that keeps
the two goals reading alike.

---

## What is known to be missing

- **A body contact is not step-rate invariant.** The ball is; a contact with a player is
  resolved on the step's chord because a player has no position between steps. Stated above
  rather than hidden.
- **The bot never plans a rebound.** It intercepts the ball's own flight, including its
  bounces off the turf and the rails, and it does not plan to *use* a rail or a post. A
  strong human will.
- **The bot never chooses a surface.** It runs at the interception point and takes whatever
  part of the body the ball's height gives it. Deliberately: choosing to duck under a ball
  so it arrives at your foot instead of your chest is the skill ceiling this game has, and
  handing it to the bot would put the bot above the tier a person can reach at `normal`.
- **`horizon` does nothing above 0.6 s**, so `hard` differs from `normal` on three levers
  rather than four. Measured, above.
- **The pooled seat share is 51.5%**, inside the band and traceable to the draw order rather
  than the pitch. It is the residue of a coin, not a lean, and the mirror test is the reason
  that sentence can be said with confidence.
