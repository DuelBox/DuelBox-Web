# Water Game — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 165 s advertised, and 165 s real

> **Written from the implementation, not before it.** **[ours]** marks our decisions. Every
> number below was measured against `dist/rules.js` with the harness in
> `/tmp/.../scratchpad/{wg,sweep,guards}.mjs`; nothing here is an estimate.

One tall tank of water seen from above, with a basket at each end. Each player owns a ball
floating in it, and a pointer on that ball turns steadily and never stops. Press, and your
ball gets a shove in whatever direction the pointer happens to be facing at that instant. The
water bleeds the speed off again. Send your ball out through the basket at your end and you
have a point. First to fifteen.

## Observed rules

The catalogue row, in full:

> The balls swim in water. Give the balls speed by pressing the buttons. Let the ball fly
> through the basket. First to 15 wins.

Everything in it is built: the balls swim, they are given speed by pressing, they fly through
a basket, and fifteen wins. Two things the row does not settle, and which are therefore
**[ours]**: what decides the *direction* of a shove — the row says only "pressing the
buttons", so the direction had to come from somewhere, and it comes from a pointer that turns
on its own — and whether the two balls share one body of water. They do, and it is the reason
this is a duel rather than two solitaires with a shared clock. See "The two balls are in the
same water".

Nothing in the row was dropped.

## The control is a bare press, and it stays one **[ours]**

A press is one binary event with a timestamp, produced identically by a thumb, a trackpad and
a keyboard. It is the instrument-neutral form this project keeps arriving at from different
directions — Explosive Festival argues for a press with no position at all, The Last Sashimi
for bare timestamped presses, and Cup Pong swapped the reference's swipe for two presses on
exactly this reasoning — and here we did not have to choose it, because the reference rule
already *is* one. So it is kept, unaltered, and it is worth saying why that is a decision and
not an accident:

- **No position.** `game.ts` reads `input.seat(seat).actionPressed` and nothing else. Where a
  finger lands is never consulted, so a thumb cannot express anything a key cannot. A test
  drives seat one with `Space` and with a finger placed at a fresh random point in its own
  half on the same schedule, and asserts the two produce the identical match, score for score,
  over 5 400 steps and three seeds.
- **No magnitude.** Every shove is the same `THRUST_SPEED`. There is no hold, no charge
  and no release, so nothing rewards a device that reports pressure or a finger that can be
  held more steadily than a key.
- **No rate advantage.** `THRUST_COOLDOWN` is 0.26 s. Nobody needs to press faster than about
  four times a second, and pressing that fast is actively bad — see below.
- **Therefore not `sameInputClassOnly`.** There is no quantity in this game that one input
  family can express more finely than another, so a phone and a laptop can play each other.

### Mashing is self-defeating, by arithmetic rather than by refusal

The pointer turns at 2.6 rad/s and the cooldown is 0.26 s, so **two consecutive presses are
0.68 rad apart**. A player holding the button down as fast as the game will take it therefore
spreads their shoves evenly around the circle, and the sum of a circle of equal shoves is
nothing. Measured, 30 simulated seconds each: a ball pressed on **every step** scores **0**;
the identical ball pressed only when the pointer is within 10° of the basket scores **3**. The
test is in `rules.test.ts` and it is the reason no input-rate limiter was needed.

This also shows up where nobody would look for it — in the bot ladder. See `LOOK_SECONDS`.

## The tank is centred on the origin, and that is load-bearing **[ours]**

`rules.ts` simulates in a box centred on `(0, 0)`, spanning ±276 by ±476 logical units.
`game.ts` adds 300 and 500 back on at draw time and nowhere else.

The half-turn that carries one seat's view into the other's is then `(x, y) ↦ (−x, −y)`, and
**negating a float is exact**. Written in the manifest's 0…600 by 0…1000 box the same map is
`(x, y) ↦ (600 − x, 1000 − y)`, and that is *not* exact — `600 − (600 − x)` differs from `x`
in the last bits for almost every `x`. Both defects the brief warns about are that error in
different clothes: Snowball Throw's tie-break written in board coordinates, and Frozen Beaks'
two seats accumulating `y` from opposite ends and straddling a threshold in the last bits.

On top of that, **each ball is stored in its own seat's frame**. A seat's frame puts its own
basket at `y = −380` and its home at `y = +300`; the tank is symmetric, the two baskets are
half-turn images, and the four posts sit at `(±149, ±380)` — a set unchanged by negation. So
the world is *identical* in both frames, and the two seats run byte-for-byte the same
arithmetic on byte-for-byte the same constants. There is no seat-dependent branch anywhere in
the simulation, which means there is none to get the wrong way round.

The only thing that has to leave a seat's own frame is the contact between the two balls, and
because the frames are exact opposites the correction turns out to be **the same expression
applied to both balls**: an impulse of `−j·n` for seat one is `+j·n` on the board for seat
two, which is `−j·n` again once written back into seat two's frame. `collideBalls` has no
per-seat branch either.

### The mirror test, and what it is asserting

Written first, as the brief asks. Mirroring a board here is simply **swapping the two balls'
own-frame states** — no arithmetic at all — so the test is sharp:

| | result |
|---|---|
| random boards stepped, mirrored, compared bit for bit | **0 divergences of 1 200** |
| of those, boards with the two balls actually in contact | 163 |
| `shotValue` read for either seat on the same ball, four delays | identical, 1 200 comparisons |
| whole matches: seed played from both opening seats | **0 non-mirrored pairs of 750** |

`Object.is`, not `toBeCloseTo`. A third of the random boards deliberately drop both balls
inside 40 units of the centre so that the contact path — the one place the frames meet — is
exercised heavily rather than by luck.

### Seat one takes exactly 50.0%, by construction

This game has no opener: both balls are live from step zero, and the contract says a
real-time game may ignore `GameContext.openingSeat`. It is read anyway, for one line's worth
of code and a great deal of certainty. **The two bot streams are handed out by opening seat,
not by seat.** Since the tank, the baskets and both starting positions are exact half-turn
images, and the *only* thing distinguishing the two seats in a bot match is which stream
drives which bot, swapping the streams produces the exact mirror of the same match — the same
rally, played from the other chair.

`balance-aggregate.test.ts` plays every seed once from each opening seat. So:

| | seat one's share of decided matches |
|---|---|
| 250 seeds × 3 tiers × both openings, 1 500 matches | **50.00% (750 / 1500)** |

Not 49.7% by sampling. Fifty by construction, asserted seed by seed in both `rules.test.ts`
and `game.test.ts` rather than in aggregate. With the opening pinned to seat one instead —
which is *not* how the shell drives it — the same 250 seeds give 51.2% / 43.2% / 52.0% across
the three tiers, which is the sampling noise the construction removes.

## The water is a drag integrator, which is issue #2465

Speed decays as `v(t) = v₀ · WATER_DRAG^t` with `WATER_DRAG = 0.55` per **second** — a
per-second power, not a per-step multiplier. A ball therefore covers
`(v_before − v_after) / DRAG_RATE` in a step, and those terms **telescope**: a free swim
totals `(v₀ − STOP_SPEED) / DRAG_RATE` however finely it is sliced. The step that crosses the
stop line coasts the exact remainder and stops dead, so where a ball finishes does not depend
on which step happened to cross it.

Forward Euler on the same model overshoots by `dt · DRAG_RATE / 2` — **0.498% at 60 Hz** and
0.125% at 240 Hz. On a 680-unit shot that is 3.4 units of difference between a 60 Hz laptop
and a 240 Hz phone, and it would leave the bot's own distance arithmetic permanently 0.5%
out. Soccer Pool's `rules.ts` reached this first; this is the same telescoping form applied
to the model this game already had.

### Step-size invariance, measured

One ball swum down a clear lane at eleven speeds, at four step rates. `y` after 1.2 s:

| speed | 60 Hz | 90 Hz | 120 Hz | 240 Hz |
|---|---|---|---|---|
| 640 | 98.090734940969 | 98.090734940972 | 98.090734940974 | 98.090734940970 |
| 400 | −107.443290661895 | −107.443290661893 | −107.443290661892 | −107.443290661894 |
| 200 | −278.721645330947 | −278.721645330946 | −278.721645330946 | −278.721645330947 |
| 60 | −398.616493599284 | −398.616493599284 | −398.616493599284 | −398.616493599284 |

**Worst spread across the four rates: 5.29 × 10⁻¹² in position and 3.18 × 10⁻¹² in speed** —
eleven speeds, four rates. The test asserts nine decimal places, which is three orders of
margin.

And the total swim against the closed form the bot uses:

| | worst \|measured − `reachOf(v)`\| |
|---|---|
| eleven speeds × four step rates, swum to rest | **8.53 × 10⁻¹³** |

`reachOf` is therefore *exact*, not indicative, and `coastDistance` and `speedAfter` are the
closed forms of the same sum. **This is what makes the bot honest.** It predicts where its
ball will be in `delay` seconds and how fast, and that prediction is not an approximation of
the simulation — it *is* the simulation, evaluated in one go. The two agree to floating point
rather than to 0.5%.

No per-frame allocation anywhere in `step` or in the bot: no literals, no closures, no arrays.
The four posts are unrolled rather than indexed, `resolve`'s options object is hoisted and
rewritten in place, and `game.ts` keeps its interpolation in `Float64Array`s allocated once at
construction. Measured cost of the hardest tier: **worst step 0.030 ms, mean 0.0004 ms** over
4 739 steps, against `bot-cost.test.ts`'s 22 ms ceiling.

## The tank

| | Value | Why |
|---|---|---|
| Board | 600 × 1000 | Portrait: each player's own end is the one nearest them |
| Water | ±276 × ±476 from the centre | Symmetric under the half-turn by construction |
| Ball | radius 18 | |
| Basket mouth | at `y = ∓380`, half-width 108 | 216 wide against a 552-wide tank |
| Posts | at `(±149, ±380)`, radius 13 | See below |
| Home | `(0, ±300)` | Inside the opponent's half of the water, so the two balls meet head-on |
| Drag | 0.55 a second | `DRAG_RATE` 0.598 |
| Stop line | 12 units a second | Part of the distance law, not a fudge on it |
| Shove | 250, added; capped at 640 | |
| Cooldown | 0.26 s | 0.68 rad of pointer between two presses |
| Pointer | 2.6 rad/s, one way, never stops | 2.42 s a turn |
| Pause after a goal | 0.8 s | |
| Match | first to 15, or 165 s | |

### Ten units of clear water between the mouth and the post

A ball whose centre crosses the mouth line at the very edge scores, and its own rim then
reaches to `108 + 18 = 126`. The nearest post's rim reaches in to `149 − 13 = 136`.

That ten units is deliberate, and it is the brief's warning taken literally: **a threshold a
state variable lands on by construction rather than by coincidence.** Put the post exactly
where the widest scoring ball touches it and "this shot scored" and "this shot hit the post"
become one event, decided in the last bits of a float, reached by the two seats from opposite
ends of the tank. Frozen Beaks lost 24 of 60 mirrored matches to precisely that shape of bug —
a dunked bird's distance from a hole rim being *exactly* the hole radius by construction. It
is cheaper to design out than to detect, and `rules.test.ts` asserts the gap so it cannot be
tuned away by accident.

For the same reason a goal is judged on the **free-swim segment**, before the walls and posts
move anything, and the geometry keeps the two apart: a scoring ball is never touching a post,
and the mouth is 96 units clear of the end wall.

### The direction test on a goal is not decoration

A goal is `prevY > −380 && y ≤ −380` **and** the crossing `x` inside the mouth. The direction
matters because a ball can get behind the mouth by going round the *outside* of a post, and
would then score by drifting back in. Tested in both directions.

## The two balls are in the same water **[ours]**

Both balls travel the centre of the tank in opposite directions — seat one's home at board
`y = 300` shooting to the basket at `y = 120`, seat two's the half-turn image — so their paths
overlap across the whole middle of the tank and they meet head-on. They collide elastically at
0.9 restitution.

This is the difference between a duel and two solitaires sharing a clock. It is also the one
thing in the file that could have carried a seat bias, which is why the mirror test loads a
third of its boards with the two balls on top of one another.

A ball that has just scored is off the board for that step and does not collide; it comes back
on its own spot at rest, facing its basket, with a 0.8 s pause.

## Termination

Three things, in order of how much work they do.

1. **Two `easy` bots reach fifteen on their own.** 400 matches: median 113.4 s, 90th
   percentile 133.7 s, 99th 156.3 s. **2 of 400 hit the clock**, and none of those was a draw.
   The `termination.test.ts` harness — two `easy` bots, `openingSeat: 'p1'`, seed 20260820 —
   decides at **step 7 060, 117.7 s**, at 12–15. Ten minutes is not close.
2. **The clock is in the rules, at 165 s.** `manifest.roundSeconds` ends nothing anywhere in
   this repository; `MATCH_SECONDS` is what ends this. When it expires the higher score wins
   and a level one is a draw, which is what `resolve` does with `timeExpired` on a `first-to`.
   A test plays a match in which **neither seat ever presses** and asserts it still ends, as a
   draw, within one step of the clock. The manifest advertises the same 165, asserted.
3. **A bot cannot stall.** `PRESS_BOUND_SECONDS` = `LOOK_SECONDS + AIM_PERIOD + pressError +
   REGROUP_SECONDS` = **3.557 s**. Worst gap actually observed between two of a bot's presses:
   **3.533 s over 122 530 presses**. See the next section for why that bound needed two goes.

## The bot

It looks at the water every `LOOK_SECONDS`, weighs up `aimSamples` moments spread over the
coming turn of the pointer, picks the best, and **counts down to it**. It does not watch for
the pointer to reach an angle — that is Cup Pong's lesson, where watching for a position swept
for ever on the second seed of the very first harness run.

What it evaluates: shove now-plus-`delay`, predict where the ball will be and how fast using
`coastDistance` and `speedAfter`, add the shove along the pointer's angle at that moment, and
ask whether the straight line that puts the ball on leaves through the mouth inside its
`reachOf`. If it does, the shot is worth 4000 less a recency penalty less how far off centre it
crosses. If it does not, the shot is worth minus the distance from where the ball would stop to
the basket.

What it deliberately does **not** model: the tank walls, the posts, and the other ball. A
person cannot integrate a rebound in their head either, and all three errors fall on the two
seats alike. It is handed one ball and a delay, and cannot read the other ball, the other
bot's plans or the clock, because none of them are in scope (rule 6).

### It counts down, and it does not change its mind afterwards

Two versions of this were wrong before the third was right, and both failures are the same
shape.

**Version one re-planned every look and re-set the countdown from the fresh plan.** A bot whose
timing error ran *late* therefore reset its own deadline before ever reaching it, and a safety
rail had to fire on **2.1% of `easy`'s presses** to unstick it. A rail firing one press in
forty-seven is not a rail, it is a mechanism.

**Version two planned once per press and never re-looked.** That terminates, and it made `hard`
the *worst* tier: solo seconds to fifteen came out 109.6 / 99.9 / **119.6** for easy / normal /
hard. A plan two seconds out has had a tank wall happen to it, and a precise bot executes a
stale plan precisely while an imprecise one blurs past it.

**Shipped:** the bot re-looks, *and* arming a press starts a **deadline** that only ever
decreases and that a re-look may not push out. A re-look can bring a press forward or move it
about inside the window; it cannot postpone it past the turn of the pointer it committed to.
That is both realistic and provable, and it needs no rail at all.

### Every knob, swept alone

Two knobs ship. A third was written, swept and deleted. A fourth constant turned out to
control the *sign* of one of the two, which is the finding worth reading.

#### 1. `pressError` — how accurately a tier hits the moment it meant to

Triangular on `[−e, +e]`, two draws summed. Foil is an untouched `normal`; 120 seeds in each
seat order; solo is seconds to put fifteen away with the other ball parked.

| press error | win vs `normal` | as p1 | as p2 | solo |
|---|---|---|---|---|
| 0 | 88.3% | 87.5% | 89.2% | 68.3 s |
| 0.03 | 86.3% | 84.2% | 88.3% | 69.8 s |
| **0.06 (shipped `hard`)** | **84.6%** | 85.8% | 83.3% | **72.9 s** |
| 0.09 | 78.8% | 85.0% | 72.5% | 78.8 s |
| **0.13 (shipped `normal`)** | **73.8%** | 70.8% | 76.7% | **79.0 s** |
| **0.20 (shipped `easy`)** | **39.6%** | 39.2% | 40.0% | **97.2 s** |
| 0.28 | 6.7% | 7.5% | 5.8% | 124.9 s |
| 0.40 | 0.4% | 0.0% | 0.8% | 148.9 s |
| 0.60 | 0.0% | 0.0% | 0.0% | 202.4 s |
| 0.90 | 0.0% | 0.0% | 0.0% | 261.8 s |

Strictly monotone on both measures across the whole range. Kept.

#### 2. `aimSamples` — how many moments a tier weighs up

| moments | win vs `normal` | as p1 | as p2 | solo |
|---|---|---|---|---|
| 2 | 0.0% | 0.0% | 0.0% | 320.0 s |
| 3 | 7.1% | 7.5% | 6.7% | 116.7 s |
| 4 | 11.2% | 14.2% | 8.3% | 133.9 s |
| **5 (shipped `easy`)** | **23.3%** | 25.8% | 20.8% | **106.1 s** |
| 6 | 31.3% | 30.8% | 31.7% | 102.1 s |
| **8 (shipped `normal`)** | **42.1%** | 42.5% | 41.7% | **93.2 s** |
| 11 | 81.3% | 84.2% | 78.3% | 76.9 s |
| **14 (shipped `hard`)** | **84.6%** | 85.8% | 83.3% | **72.7 s** |
| 20 | 88.8% | 86.7% | 90.8% | 70.9 s |
| 32 | 89.6% | 90.8% | 88.3% | 70.5 s |
| 48 | 91.7% | 95.0% | 88.3% | 69.5 s |

Monotone in win rate across the whole range, and flat above about 20 — which is where the
sample spacing (0.12 s) has gone below the sharpest tier's press error and finer search stops
buying anything. Kept, and the three tiers sit inside the steep part.

#### 3. `DELAY_PENALTY` — a constant that owned the *sign* of knob 2

The recency preference in `shotValue`: how much a shot is docked per second of waiting. It
started at 40 per second and was never going to be looked at again. Sweeping `aimSamples`
found this — solo seconds to fifteen, `hard`'s press error throughout:

| penalty | 2 moments | 4 | 8 | 14 | 24 |
|---|---|---|---|---|---|
| 40 | 133.7 | **74.8** | 78.7 | 84.8 | 89.8 |
| 120 | 121.3 | **73.7** | 78.1 | 85.8 | 86.3 |
| **400 (shipped)** | 320.0 | 133.9 | 97.3 | 72.9 | **71.2** |
| 1200 | 659.7 | 632.4 | 199.5 | 175.9 | 145.9 |

At 40 and at 120 the row **runs backwards**: more search makes the bot worse, and a ladder
built on `aimSamples` would have handed the strongest tier the weakest play. This is Explosive
Festival's sign change and Snowball Throw's backwards aim error in a third costume, and it is
only visible because the two were swept against each other rather than one at a time from the
shipped values.

The reason is worth stating, because it is a fact about this game: with a weak recency
preference the bot prefers a *perfect* moment two seconds out to a *good* one now, and its
prediction two seconds out is worth much less than its prediction now — it does not model the
walls, the posts or the other ball. A strong preference makes it take the first honest chance,
which is both better play and a more human way to play. Too strong (1200) and it presses at
whatever is in front of it, which is the mashing failure from the top of this document.

#### 4. `LOOK_SECONDS` — written, swept, and taken off the ladder

It began as a third tier knob and is now a constant at 0.14 s. Solo seconds to fifteen,
everything else at `hard`:

| look every | 0.02 | 0.06 | 0.10 | **0.14** | 0.20 | 0.30 | 0.45 | 0.70 | 1.00 | 1.50 |
|---|---|---|---|---|---|---|---|---|---|---|
| seconds to fifteen | 106.2 | 77.1 | 72.7 | **72.9** | 69.9 | 80.6 | 103.7 | 104.0 | 111.6 | 121.7 |

(Only the solo column is honest here: `LOOK_SECONDS` is one constant shared by both bots, so a
head-to-head sweep moves the foil too and measures nothing. Saying so is the point — a
measurement whose method is broken is worse than none.)

The right-hand half is a clean slope and would make a ladder. **The left-hand half runs
backwards**, and for a reason that belongs to the game rather than to the bot: a bot looking
every 0.02 s re-plans faster than the cooldown lets it press, so it presses at the first
opportunity every time — and that is exactly the masher from the first section, being punished
by exactly the geometry that was built to punish it. A ladder with a hump in it would put its
weakest tier on the far side of that hump, where "worse" means "mashes", so it is a constant,
set inside the plateau.

### The shipped ladder

```
easy    pressError 0.20   aimSamples  5
normal  pressError 0.13   aimSamples  8
hard    pressError 0.06   aimSamples 14
```

Solo, 60 seeds, other ball parked, seconds to put fifteen away:

| | easy | normal | hard |
|---|---|---|---|
| seconds to fifteen | 124.1 | 93.2 | 72.7 |

The **score** does not saturate — fifteen distinct goals, both seats finishing on 13.8 on
average at every tier, one draw in fifteen hundred matches — but it is worth being exact about
what `hard` is: a bot given **zero** press error and 48 moments to choose from takes 73.0 s,
against `hard`'s 72.7 s. **`hard` is at this bot's ceiling, not near it.**

That ceiling is the architecture's, not the game's. The bot never models the tank walls, the
posts or the other ball, so it cannot bank a shot off a wall, cannot leave its ball somewhere
awkward for the opponent, and cannot shove the other ball off its line on purpose — and all
three are things a person can see and do. Making `hard` stronger therefore means teaching it
one of those, which is a larger piece of work than a constant, and the honest thing is to say
where the wall is rather than to pretend the tier is tuned up against it. What matters for the
ladder is that `normal` and `easy` are well below it: 93.2 s and 124.1 s against 72.7 s.

## Balance, 250 seeds a pairing

Equal tiers. The opening is pinned to seat one here so the numbers are a raw sample rather
than the construction; the shell alternates it, which makes the share exactly 50.0%.

| | seat one's share | draws | ended on the clock | match seconds | goals a seat |
|---|---|---|---|---|---|
| easy v easy | 51.2% | 0 | 2 of 500 | 115.8 | 13.57 |
| normal v normal | 43.2% | 0 | 0 of 500 | 93.3 | 13.66 |
| hard v hard | 52.0% | 0 | 0 of 500 | 78.3 | 13.81 |

Cross tier, 250 seeds **in each seat order**:

| | stronger tier as p1 | as p2 | average | goals | match seconds |
|---|---|---|---|---|---|
| hard v easy | 98.8% | 97.2% | **98.0%** | 14.97 / 9.31 | 83.6 |
| hard v normal | 84.8% | 82.4% | **83.6%** | 14.68 / 12.08 | 83.8 |
| normal v easy | 88.4% | 88.8% | **88.6%** | 14.79 / 11.20 | 97.2 |

Monotone, and each pairing agrees with itself to within 2.4 points across the two seat orders.
Draws are essentially absent — 1 in 1 500 matches — because fifteen distinct goals is a fine
enough score that two players of the same standard rarely land on the same one.

`hard v easy` at 98.0% is close to saturation and is left there deliberately: it is the widest
rung of a three-rung ladder, and the rungs either side of it (83.6% and 88.6%) are where a
player actually lives.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called through a whole match, at three
different points in it. There is no language in this game and nothing on the board has to be
read.

- **Seat one is round and seat two is square, everywhere.** Its ball, its two basket posts and
  the head on its pointer. A test asserts the two directions of the evidence
  `greyscale.test.ts` looks for: seat two never draws a `circle` or a `strokeCircle` in its own
  colour, and seat one never draws a `rect` or a `strokeRect` in its.
- **At equal area.** The square's half-side is `radius × √π / 2`, so the two silhouettes cover
  the same area and neither seat has the bigger ball or the easier target — the simulation sees
  the identical circle for both. Asserted to nine decimal places. Happy Hippos sets its square
  the same way and for the same reason.
- Each ball carries a hollow mark of its own silhouette in the middle, so the shape reads at a
  glance rather than only in outline.
- **The pointer is thick and solid when a press would land, and thin and faint while the
  cooldown still has it.** The one thing a player has to time is the one thing on screen that
  changes appearance.
- The basket's mouth is drawn at the width the rule actually uses, and thickens for half a
  second when a goal goes through it.
- The clock is a bar on each side margin growing from the middle — one object, shared,
  symmetric under the half-turn, so neither player is nearer to it than the other. The shell
  owns the score, the countdown, the pause and the result; none of them are drawn here.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`. It
does not know the manifest's box exists — it simulates in a box centred on the origin, and
`game.ts` is the only file that adds the half-extents back on. Nothing reads the presentation,
the local seat, the viewport or the device.

Verified against local copies of the cross-game guards, since seven other packages were
mid-build and the shared suites could not run:

| | |
|---|---|
| identical match at 320×568, 393×852 (notched), 768×1024, 1280×800 and 3840×2160 | **yes**, and the trace is not inert |
| worst \|coordinate\| drawn | 1000.0 against a 2000 limit |
| shared-screen vs single-seat, three tiers, 3 600 steps each | byte-identical traces |
| `localSeat: 'p1'` vs `'p2'` | byte-identical traces |
| keyboard vs thumb, seat one, three seeds | identical matches |
| chunk size, minified and gzipped | **4.1 KB** against a 12 KB budget (Happy Hippos 4.9, Snowball Throw 4.8) |

## What is not built

- **No wall or post is a scoring surface.** The reference row says "let the ball fly through
  the basket" and nothing about anything else being worth points, so nothing else is.
- **No second ball per seat.** The row says "the balls" plural, which we read as one each; two
  each would double the state a player has to time against and the press has no way to say
  which ball it means.
- **No current, no waves, no obstacles.** The row describes still water. Anything moving in it
  would be a second source of randomness in a game that currently has *none* outside the two
  bot streams, and the exact-mirror property is worth more than the texture.
