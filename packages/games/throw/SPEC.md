# Snowball Throw — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 90 s advertised and enforced

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against the shipped `rules.ts` — the harness is described
> under "How the numbers were taken".

A snowfield seen from above, with a player at each end. A snowball packs itself in your
hands and grows through three sizes; let go and you throw the one you have. Whichever way
you were walking as you let go hooks it. Two ice walls stand across the middle and take the
throws that miss, and break as they take them. First to knock the other's health to nothing
wins.

## Observed rules

From the catalogue row: _"Snowball fight! Pull back to aim. Release to throw. Hit your
opponent. First to reduce their opponent's health to zero wins!"_

Everything in that row is built. What is **not** built is the row's implied gesture: "pull
back to aim" is a drag, and this game does not have one. See the next section — it is the
decision the whole design turns on.

The win condition goes through the SDK's `reduce-to-zero`, which is the shared spelling of
the observed rule and also the reason a double knockout is a draw rather than a win for
whichever seat happened to be read first.

## Fairness across input families **[ours]**

**Verdict: cross-device fair.** `sameInputClassOnly` is false, and the manifest says why in
a comment. The reasoning is below, and it is the reason the controls are what they are
rather than what the reference row describes.

### The problem the row hands you

A pull-back aim is a drag, and `docs/input-parity.md` is unambiguous about what a drag is:
a continuous quantity a thumb can name and a key cannot. Cup Pong met the same problem in a
turn game and replaced the drag with two timed presses. A real-time game has less room —
Cup Pong could spend a whole turn on two presses, and here both players are acting at once
and dodging while they aim.

Worse, the engine makes the obvious real-time answer unavailable. `actionHeld` is
`keys.action || pointerDown` (`packages/engine/src/input.ts:505`), so **a finger on the
glass is the action**. A pointer cannot steer without holding, and cannot signal a discrete
event without lifting — and while it is lifted it is steering nothing. There is no pointer
expression of "moving but not acting" at all; `docs/input-parity.md` records the same fact
from the other end, where a control-parity script that tapped the action key for one frame
while holding a direction had no pointer equivalent.

### What this game asks for instead

A throw carries **exactly two discrete values**:

| | Values | How a key names it | How a finger names it |
|---|---|---|---|
| **Size** | one of three | how long before letting go of Space | how long before lifting |
| **Lean** | −1, 0, +1 | whether A or D is down | which side of your thrower the finger is on |

Nine trajectories, from wherever you are standing. On top of that sits a position, and the
position is rate-limited by the simulation: a key says *which way* and a finger says
*where*, and both feed the same `MOVE_SPEED`. Neither instrument can walk a thrower faster
than the other, and neither can name a position more finely than the other, because the
only quantity either one produces is **the sign of a gap**.

Four claims, and each of them is a test:

1. **No continuous quantity anywhere.** No drag distance, no angle, no pointer velocity.
   The precision envelope is not even load-bearing here — quantising a position the game
   only takes the sign of changes nothing.
2. **No rapid repeated pressing.** `docs/input-idiom.md` promotes the real rule out of
   three manifest comments: a game is same-input-class-only when winning requires more than
   about **two committing presses a second**. The smallest snowball takes 0.6 s to pack, so
   the ceiling is 1.67 a second and nobody can reach it and win — measured, a bot throws
   **0.94 to 0.95 times a second** at every tier. `rules.test.ts` asserts the ceiling.
3. **The size dial is discrete, so input latency buys nothing.** A continuous power meter
   has its optimum at the top of the meter, so every player releases at a boundary and every
   millisecond of latency is a power difference. Three sizes with half-second plateaus give
   no reward at all for releasing near a boundary: you let go comfortably inside the size
   you want, and a 30 ms difference between a key and a thumb changes nothing.
4. **The pack clock runs from the last throw, not from the press.** This is the one that
   makes the engine's `actionHeld` fact harmless, and it is worth being exact about.

### The pack clock, and why it does not restart on a press

`ready` accumulates every step and is reset **only when a snowball actually leaves**. A lift
that throws nothing costs nothing but the walk.

If the clock restarted on the press, a pointer player would pay for something a keyboard
player gets free. A finger has to leave the glass to signal anything, and while it is off
the glass it is steering nothing; a keyboard player releases Space and keeps holding D. Over
a match of thirty-odd throws that is thirty small handicaps that only one instrument pays.
With the clock free-running, the two instruments have the identical set of decisions: hold,
walk, let go when you like. A keyboard player's extra freedom — moving without holding
Space — is worth exactly nothing, because the snowball packs either way.

`game.test.ts` drives the same intent through both instruments and asserts **the snowball
that leaves is the same object**: same size, same launch point, same hook.

### The lean is the direction walked on the step *before* the release

`docs/input-idiom.md` lists this as fact 2 of three that every game has had to rediscover:
**the pointer is already null on the step that reports `actionReleased`**. A lean read on
the release step is therefore zero for a finger and non-zero for a key — the same gesture,
two different throws. Three games carry a private `#pointerAiming` flag for this.

`Thrower.lean` carries the previous step's direction instead, which needs no flag and is
identical for both instruments by construction. A test drives a keyboard release with D
still held and a pointer lift from the right and asserts the two snowballs are equal.

### What is not fair, and is not fixable here

A trackpad re-clutch is a `pointerup`, and a `pointerup` throws. The engine cannot tell a
cancelled gesture from a deliberate lift — `docs/input-idiom.md` names `pointerCancelled` as
missing primitive 1 — so a re-clutch mid-walk throws a snowball early.

Being straight about the size of it: the binding is absolute over a 504-unit lane in a
600-unit box, which is **wider than the third of the short side** `docs/input-idiom.md` says
a gesture may ask for without a lift, so a trackpad player crossing the whole lane in one
motion will sometimes have to re-clutch. What it costs them is one early throw and the
fraction of a second their thrower stands still — not progress toward the next snowball,
because the pack clock does not restart on the re-press. It is the same cost every
drag-and-release game in the catalogue pays and it is smaller here than in most of them,
but it is a real cost and it falls on one input family. It is the first thing to re-measure
when #1862's cross-device harness exists, and the first thing `pointerCancelled` would fix.

The shell's pause is the same event and **is** handled: `onPause`/`onResume` swallow exactly
one release, so opening the pause menu mid-walk does not throw on the way back. A test
covers both directions.

## The field

| | Value | Why |
|---|---|---|
| Board | 600 × 1000, portrait | Each seat's line is a full-width band, so an absolute pointer binding reaches everything it may want |
| Baselines | y = 820 and y = 180 | Symmetric about the centre line, so the board is its own half-turn |
| Thrower | radius 40 | The number the game exists on — see below |
| Lane | x ∈ [48, 552] | 504 units, 2.1 s to cross, three times the longest flight |
| Walk | 240 units a second | Identical for a key and a finger |
| Deadzone | 12 units = 4 precision envelopes | `docs/input-idiom.md` rule 2, rather than a twenty-third hand-picked constant |
| Ice | two walls on y = 500, x ∈ [100, 240] and [360, 500] | Three lanes of 100, 120 and 100 |
| Ice health | 7 chips, damage-weighted | About four jabs, or two boulders |
| Health | 20 each | Eight to twenty landed throws |
| Clock | 90 s | The termination guarantee, and the same 90 the manifest advertises |

### The thrower is wide because otherwise there is no game **[ours]**

The quantity that decides whether this game exists is **how long stepping clear takes,
against how long there is to do it**: `(THROWER_RADIUS + ball radius) / MOVE_SPEED` against
the ball's time of flight.

The first geometry had a 26-unit thrower and a 760-unit field, which put those at 0.16 s
against 0.78 s. Every throw was dodgeable on reaction, by anybody, and two competent players
never hit each other. Measured over 200 matches a tier: `normal` landed **1.6%** of its
throws and `hard` landed **none at all** — 192 of 200 matches drawn nil-all at the whistle.

No bot tuning reaches that, because the bots were playing correctly. A wide thrower and a
fast ball put the two times within a couple of frames of each other:

| Size | Flight | Step aside | Margin | Units a step |
|---|---|---|---|---|
| jab | 0.395 s | 0.233 s | **0.161 s** | 24.7 |
| packed | 0.502 s | 0.283 s | **0.218 s** | 19.0 |
| boulder | 0.618 s | 0.350 s | **0.268 s** | 15.0 |

The margin is how long you have to *start* moving. A jab gives you a sixth of a second,
which is inside a human reaction — so **a jab aimed where you are standing is not answerable
by reacting to it**. What answers it is having already moved, which is the contest a
snowball fight actually is. A boulder gives you a quarter of a second, which is not.

## The three sizes

| Size | Pack | Speed | Radius | Damage | Damage a second |
|---|---|---|---|---|---|
| jab | 0.60 s | 1480 | 16 | 1 | 1.67 |
| packed | 1.10 s | 1140 | 28 | 2 | 1.82 |
| boulder | 1.70 s | 900 | 44 | 3 | 1.76 |

Bigger is **slower and wider**. The damage per second of a perfect stream is flat within 9%,
so the choice is never throughput — it is the margin table above against the payoff. A jab
arrives before a step aside can finish and is worth one; a boulder can be stepped away from,
is worth three, and is 88 units across, which is nearly as wide as the narrowest lane
through the ice. The ice is a size filter as well as a shield, and `rules.test.ts` asserts
the lanes stay wider than the widest ball.

Releasing before the first size throws nothing at all. That is what caps the throw rate, and
it is also a real move: a feint costs you nothing but the walk.

## The hook is an acceleration, not a drift **[ours]**

A leaning throw carries a constant lateral acceleration of 600 units a second squared. That
makes the hook **late**:

| Size | Sideways by the ice | Sideways by the far line |
|---|---|---|
| jab | 9.5 | 46.7 |
| packed | 14.7 | 75.5 |
| boulder | 20.6 | 114.5 |

A snowball is nearly straight when it passes the gap between the walls and well bent by the
time it arrives, so **threading a gap and arriving on a target are two different problems**.
A sideways *velocity* would have made them one problem and the lean one decision instead of
two. A test asserts the sideways movement at the ice stays under a third of the movement at
the far line.

### The closed form and the integrator are the same parabola

`stepBalls` integrates `x += vx·dt + ½·ax·dt²` and *then* `vx += ax·dt`. `predictAtY` solves
`x₀ + ½·ax·t²` in closed form, and the bot aims by it.

Written the other way round the step lands a whole `a·dt²` rather than half of one, and the
bot would be aiming at a board the game is not playing — the systematic bias commit b4af006
found in five games, which cost Cannon Duel 7.6 units against a 52-unit target and which no
amount of tier tuning could reach. `rules.test.ts` fires every size, every lean and five
launch positions from both seats and asserts the two expressions **agree to within 10⁻⁹ of a
unit at every step of every flight**.

## Collision is swept, never sampled

A jab covers 24.7 units in a 60 Hz step and an ice wall is a line with no thickness at all,
so a static test at the two ends of a step would let a throw pass straight through one.
`sweptCircleSegment` solves the whole step, and `sweptCircleCircle` does the same against
the other player. There is no `sweptCircleAabb` yet (issue #111), which is why a wall is a
segment — treated as a capsule of the ball's radius, so a wall is as thick as whatever hits
it, which is also why a boulder is stopped further out than a jab.

**The target moves too**, so it is tested against the ball's displacement *relative* to the
thrower's. A stationary test would miss a ball and a thrower converging inside one step, and
would report a hit for two that pass through the same point at different times. Both cases
have a test; the tunnelling one also fires at 5000 units a second, which is three times
anything this game throws.

## Scoring and the end of a match

Health, from 20 down. A knockout wins; level on health at the whistle, **more throws landed**
wins; level on both, a draw.

The tiebreak is not decoration — it is the score's resolution. Health is one of twenty-one
values and two players of the same standard reach the whistle level on it more often than
the number suggests, because four jabs and two packed balls are the same four damage. Throws
landed separates them. In practice it almost never has to: **draws are 0.1–0.4% of matches**
across three thousand seeds a tier, because no bot pairing ever reaches the whistle at all.

The clock is the termination guarantee and it is the only one. `roundSeconds` ends nothing —
it is text on a catalogue card — and a test asserts the two numbers are the same 90. A second
test plays a match in which **neither player ever throws**, with **no step cap at all**, so a
match that could not finish would hang the suite rather than pass quietly; it ends drawn at
the whistle, on the step the clock says.

## The bot

Five knobs, and each is a different thing a person is better or worse at. Nothing in any of
them is information a player does not have: every snowball's position, size and hook are on
the board — the hook is drawn as a tick on its leading edge, precisely so that reading it is
a skill and not a privilege — and so is the ice's remaining blocks and which way the other
player is walking. What a weaker tier is denied is time, attention and patience, never sight.

| Knob | `easy` | `normal` | `hard` | What it is |
|---|---|---|---|---|
| `think` | 0.29 | 0.27 | 0.25 | Seconds between decisions |
| `notice` | 0.235 | 0.205 | 0.18 | Seconds a throw must be in the air before this tier reacts to it |
| `blunder` | 0.15 | 0.10 | 0.05 | Chance a decision sees nothing at all |
| `clearance` | 11 | 13 | 15 | Daylight it tries to leave when stepping aside |
| `patience` | 0.32 | 0.38 | 0.44 | Seconds past the size it wanted that it will hold out for a good shot |

**The spread is deliberately narrow.** Every one of these is a strong knob on its own, and
five strong knobs pulled apart by intuition compound into a ladder nobody can climb — the
first tuned set had `normal` beating `easy` 97 times in a hundred and `hard` beating `normal`
98. A few hundredths of a second each is what a 94/83/76 ladder actually costs.

### Every knob, swept alone

`hard`'s value varied with everything else left as shipped, against an untouched `normal`,
500 matches a row (250 seeds in both seat orders). The shipped row of each block reads 81.6%,
which is the same figure the full pairing table gives.

| `notice` | win | make | | `think` | win | make |
|---|---|---|---|---|---|---|
| 0.10 | 98.0% | 35.5% | | 0.12 | 100.0% | 38.2% |
| 0.14 | 94.2% | 38.9% | | 0.18 | 99.8% | 38.3% |
| **0.18** | **81.6%** | **41.9%** | | **0.25** | **81.6%** | **41.9%** |
| 0.22 | 56.7% | 45.9% | | 0.34 | 38.2% | 46.3% |
| 0.28 | 42.2% | 49.2% | | 0.50 | 8.2% | 47.9% |
| 0.40 | 17.4% | 53.4% | | | | |

| `blunder` | win | make | | `patience` | win | make |
|---|---|---|---|---|---|---|
| 0 | 86.4% | 41.0% | | 0 | 28.4% | 31.4% |
| **0.05** | **81.6%** | **41.9%** | | 0.2 | 62.7% | 37.5% |
| 0.12 | 77.5% | 42.9% | | **0.44** | **81.6%** | **41.9%** |
| 0.22 | 68.1% | 44.5% | | 0.8 | 92.2% | 45.0% |
| 0.35 | 54.7% | 46.6% | | 1.5 | 92.8% | 45.8% |
| 0.55 | 38.2% | 49.5% | | | | |

| `clearance` | 0 | 5 | **15** | 26 | 45 | 80 |
|---|---|---|---|---|---|---|
| win | 4.6% | 11.6% | **81.6%** | 81.9% | 76.8% | 74.0% |

`notice`, `think`, `blunder` and `patience` are monotone. `clearance` is not, and it is worth
being exact about: below about ten units it falls off a cliff, because a dodge that only just
clears the ball does not clear a ball that is being aimed at where you are going; above about
twenty-five it declines slowly, because over-stepping wastes position. The three tiers sit on
the plateau and the knob is carried for the cliff, not for the slope.

### A knob that was swept, found to be backwards, and deleted **[ours]**

The first bot had an **aim error in units**, added to the point it both walked to and threw
at — the honest model of a mistaken belief about where the other player is. Swept alone it
came out the wrong way round:

| aim error | 0 | 34 | 78 | 150 |
|---|---|---|---|---|
| win vs `normal` | 77.0% | 75.8% | 84.0% | 89.0% |

A large error is a large *standing offset*, and standing off the other player's line is worth
more on defence than it costs on offence, so the accuracy knob was paying for itself twice
over. It read in the source as the main skill and was in practice a defensive tactic. It went,
exactly as Cup Pong's `wander` did.

`blunder` replaced it and cannot do that, because it is not a direction. It is monotone by
construction and measures monotone. It also removed the last *signed* random quantity from
the whole game, which made the half-turn covariance test below exact rather than statistical.

### The standoff is a tactic, not a handicap

Every tier waits 70 units off the other player's line **while it has nothing ready to throw**,
and steps onto the line to throw. Both halves of that are load-bearing and both were measured
by getting them wrong:

- With no standoff at all, both bots walk onto each other's line and stand there trading
  throws they cannot miss: **86.6%** of throws landed between two `easy` seats, and a match
  over in fifteen seconds.
- With the standoff held whatever is in hand, `normal` and `hard` landed **4.8%** and **2.1%**
  of their throws and every match ran the full ninety seconds — a throw from 70 units off the
  line misses unless it is leaning, and a bot standing at its post is not walking.

### It counts down as well as watching

A real-time bot that only throws when a shot lines up can wait for an alignment that never
comes; Cup Pong's needle bot swept for ever on the second seed it was ever given. `patience`
past the size it wanted forces the throw whatever the board looks like, and a countdown cannot
fail to expire. A test parks a bot behind the ice with the other player in a far corner and
asserts it still throws.

### Randomness

**A generator per seat**, derived in `init` from `context.rng`, and **exactly three values
per decision** — the gap to the next decision, the blunder roll, and the size it is holding
out for — drawn unconditionally before anything branches on the board.

The simulation itself draws nothing at all. The field is fixed, there are no spawns, and two
humans play a match with no randomness in it anywhere.

Per-seat streams are not optional here even though the draw count is constant, because what
also varies is the **number of decisions**: `hard` looks 1.16 times as often as `easy`, so a
shared stream would make one seat's play a function of which tier was sitting opposite. Star
Catcher measured that shape at 1.4 points of win rate. A test drives 1800 steps of one bot
against two very different boards and asserts its generator ends in the identical state.

A reversed poll order gives a **bit-identical match** at every tier, asserted over 40 seeds.

## The half-turn, and the two bugs that hid in it

Neither seat may have a better game than the other, and in a shared-field game that is a
statement about the *code* as much as about the geometry: turning the board over and swapping
the seats must produce the mirror image of the same match. Two separate defects broke it, each
worth double figures of win rate to seat one, and neither showed up anywhere else — a game
that is wrong in exactly the same way for both seats is still self-consistent.

Both were found the same way: `hard` against `hard` gave seat one **64.3%** of decided
matches over a thousand seeds, and freezing both throwers removed the bias entirely, which
pointed at the steering rather than at the physics.

### 1. A tie-break in board coordinates

The dodge chose its side with `me.x <= landing ? step low : step high`. That is not covariant
under the half-turn: mirrored, an exact tie takes the same board direction rather than the
opposite one.

**And the tie is an everyday event, not a measure-zero one.** Both throwers move in exact
four-unit steps from the same starting x, so every position either can ever hold lies on one
127-point lattice; a throw with no lean has no sideways velocity at all, so it crosses the far
line at exactly the x it left from, which is on the same lattice. That is the same shape as
Cup Pong's needle lattice, where a gauge coarser than the target decided throws that looked
like aim.

The replacement is covariant at every branch: step away from the throw; if it is dead on, step
toward whichever half of the lane has more room; if that is level too, keep going the way you
were going; and if there is nothing left to go on, step to the **seat's** own left rather than
the board's. That last branch is not the corner case it looks like — two bots chasing each
other's position both settle on the centre line, and a throw with no lean from the centre line
lands on the centre line, so "dead level in every respect" is how a large share of matches
*open*.

### 2. A reaction threshold on a knife edge

A ball's age used to be recovered from its own position: `(y − launchY) / vy`, which is
algebraically exact and cost this game the rest of the bias.

The two seats' throws accumulate `y` by repeated addition from opposite ends of the board —
one counts up from 236 and the other down from 764 — and floating-point addition is not
symmetric under `y → 1000 − y`. Two mirror-image balls therefore differ in the last bit or two
of their age. That is harmless everywhere except at a threshold, and `ballAge < notice` is a
hard threshold: an age is a whole number of frames and `notice` is written in hundredths of a
second, so ages land on it, and when one does the two sides of the mirror take opposite
branches and one seat starts its dodge a frame before the other.

Seat one took 49.0%, 55.5% and 64.3% at `easy`, `normal` and `hard` — the bias rises with the
tier because a stronger tier decides twice as often and so meets the threshold twice as often.

**It was confirmed end to end rather than argued.** Every match was played against its own
mirror, seeded so that the mirrored run is a legitimate match of the same population, and the
two winners were compared. **11 of 200 mirrored matches flipped their winner before this
change and 299 of 300 after**, and the seat bias went with them. That test is what finally
separated "the game is asymmetric" from "the sample is small", after both the geometry and
the two bot decisions had been mirror-checked in isolation and passed.

Counting the age from zero gives every ball the identical sequence of additions, so two mirror
images have bit-identical ages and the comparison cannot straddle. A snowball's *position*
still accumulates asymmetrically and always will; what matters is that no decision threshold
sits on a knife edge, and the position ones do not — the value they are compared against is
either a messy float or, for a throw with no lean, exact.

### What guards it now

Three tests, and they are the most valuable in the package:

- `step()` is driven from 500 scrambled boards with mirrored commands, and the **whole state**
  is compared — positions, previous positions, directions, leans, pack clocks, health, hits,
  throws, flash timers, ice, clock, winner, and every ball in the air as an order-insensitive
  set. An earlier version of this test compared only part of the state and passed throughout.
- `chooseSpot` and `wantsRelease` are mirror-checked directly over 1200 boards a tier.
- Two mirror-image snowballs are asserted to have bit-identical ages, frame by frame.

## Balance

### Equal tiers, three independent samples of 1000 seeds each

Seat one's share of decided matches, from a fixed seat order:

| | sample 1 | sample 2 | sample 3 | pooled |
|---|---|---|---|---|
| easy v easy | 50.4% | 50.1% | 51.0% | **50.5%** |
| normal v normal | 48.5% | 50.3% | 50.2% | **49.7%** |
| hard v hard | 51.1% | 50.1% | 49.8% | **50.3%** |

And what those matches look like (sample 1):

| | length | throws a seat | throws landed | ice broken | reached the whistle | draws | health margin |
|---|---|---|---|---|---|---|---|
| easy | 26.6 s | 25.0 | 50.4% | 1.39 / 2 | 0.0% | 0.2% | 4.9 |
| normal | 30.4 s | 28.7 | 45.7% | 1.39 / 2 | 0.0% | 0.2% | 4.8 |
| hard | 37.6 s | 35.8 | 38.3% | 1.42 / 2 | 0.0% | 0.1% | 4.9 |

The make rate falling with tier is the whole game in one column: the better tier is better at
getting out of the way, not at throwing. A bot throws 0.94–0.95 times a second at every tier,
which is what the fairness argument above rests on.

### Cross tier, both seat orders, 1000 seeds each

| | p1 | p2 | draws | stronger tier's share of decided |
|---|---|---|---|---|
| hard as p1 v easy | 941 | 59 | 0 | 94.1% |
| easy as p1 v hard | 57 | 943 | 0 | 94.3% |
| normal as p1 v easy | 760 | 240 | 0 | 76.0% |
| easy as p1 v normal | 271 | 729 | 0 | 72.9% |
| hard as p1 v normal | 829 | 171 | 0 | 82.9% |
| normal as p1 v hard | 181 | 816 | 3 | 81.8% |

Every equal-tier share is inside 48–52%, every pairing is monotone, and every pairing agrees
with itself within 3.1 points across the two seat orders.

### Against the repository's own harness

`apps/web/src/data/balance-aggregate.test.ts` measures every game at `normal` over 50 seed
pairs. Replicated exactly against this game: **48.0% of 100 decided matches, no draws, none
unfinished, 32.4 s a match**, `openerSwung` 0 and `readsInput` false. Comfortably inside the
45–55% band.

`openerSwung` is 0 because a real-time game has no opener — the SDK contract says so outright
("Real-time games have no opener and may ignore this"). Both throwers start on the centre line
with an identical board, so there is nothing for `context.openingSeat` to name, and inventing
something for it would manufacture the first-mover advantage the field's symmetry exists to
remove.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called through a whole match, and a
second one asserts the shapes and the colours never cross over.

- **The near seat is round and the far seat is square, everywhere**: the thrower, the mark at
  the centre of every snowball it throws, and its row of health pips. A shared field with the
  two players' snowballs crossing in mid-air is the pair most likely to be confused.
- **A snowball's size is its size**, and it carries 0, 1 or 2 rings inside it as well, so the
  three read apart at a glance and in greyscale.
- **The hook is a tick on the leading edge**, drawn only on a ball that is actually curving.
  It is there because the bot reads the curve, and rule 6 says a bot may only read what a
  player can see.
- **What is in your hands is drawn in your hands**: the snowball at its real size, a bar for
  the progress to the next size, three pips for the sizes reached, and a chevron for the lean
  the next throw would carry. Both players can read both of those, so committing to a boulder
  is visible to the person who is about to be thrown at.
- **The ice is the blocks it has left.** Both walls erode from the middle of the field
  outwards, which keeps the picture symmetric under the half-turn.
- **The clock is a bar down the left edge that drains from both ends toward the middle** —
  one object, shared, and unchanged by the half-turn, so neither player is reading a clock the
  other cannot.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the input mapping, the palette and the drawing, and reads the simulation
without adding to it — a test renders forty frames at two different alphas and asserts nothing
moved. Another asserts every drawn coordinate stays inside 1.1 × the declared box through a
whole match, and a third asserts the same seed plays the identical match in both
presentations, since nothing here reads `presentation` at all.

Motion is interpolated by the render alpha from the previous fixed step, asserted at alpha 0,
0.5 and 1.

## How the numbers were taken

Every figure above comes from driving the shipped `rules.ts` directly — `botStep` against a
constructed profile for the sweeps, `botCommand` for the pairings — with a fresh generator per
seat derived from one match seed, exactly as `game.ts` derives them. Match lengths are
simulated seconds, not wall clock. The harness lived in the package while the game was being
tuned and was deleted; `rules.test.ts` carries a cheap version of the ladder and the seat
balance that fails if either ever inverts, and the numbers here are the ones a thousand seeds
gave.

## What is not verified

- **Anything on a trackpad, or across two real devices.** `docs/input-parity.md` and
  `docs/input-idiom.md` both record that gap; #1862's harness does not exist. The argument
  above is falsifiable and should be re-read when it does — particularly the claim that a
  re-clutch costs little, which is the one that is comfortable and might be wrong.
- **Anything against a human.** Every balance number here is bot against bot. The bots are
  much better at getting out of the way than a person will be, so a human match will run
  longer and land more throws than the tables above.
