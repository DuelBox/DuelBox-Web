# Pinball Duel — specification

**Archetype:** `rt-arena` · **Category:** Arcade · **Logical box:** 600 × 960 ·
**Zone split:** horizontal · **Round length:** ~55 s

> **This spec was written from the implementation, not before it.** The game was built first
> and this records what it actually does. Every number in *The table* was read out of
> `src/rules.ts` and `src/game.ts` rather than remembered, and every number in *The bot* and
> *Measured pace* came out of the harness described there. Where a decision has no source in
> the observed rules it is marked **[ours]**.

## Observed rules

> Tap left and right to fire the ball right in your opponent goal!

That is the whole of what the reference genre states, recorded by playing it
(`docs/observed-rules.md`). It fixes four things and no more: **two** controls per player and
that they are *left* and *right*; that **tapping** is the gesture; that there is **one ball**
and it is *fired* rather than carried; and that each player has a **goal** that the other is
aiming at. It says nothing about what the two controls move, about what else is on the table,
about how the ball gets going, or about when a match ends. All of that is ours.

The one thing the rule does settle, and settles hard, is that this is a game of two buttons.
Everything below is built so that the whole of a player's skill fits through them.

## The table

| | Value | Why |
|---|---|---|
| Table | 600 × 960 logical units | Portrait: two people share one phone held upright, one end each. 600 is set against the mouth rather than chosen — see the next two rows |
| Ball radius | 14 | |
| Goal mouth | 380 units, the span between the two posts | 63% of the width. Deliberately most of the end: a ball arriving anywhere in it meets a flipper or drains, so nearly every arrival is a decision rather than a bounce off a dead wall |
| Alcove | 110 units of baseline outside each post | The only part of an end nothing guards, and the only place to bank a ball. Sealed on all four sides |
| Shoulder | Rail to pivot: 110 across, 222 down (63.6°) | **The number that decides whether the game works.** See below |
| Flipper pivots | (110, 797) and (490, 797) for p1; the half-turn images for p2 | On the goal posts |
| Flipper | 172 long, 9 radius | Set by one requirement: a **raised** flipper must reach past the middle of the mouth. The raised tip lands at x = 281.8 and a ball needs 23 units of clearance, so it covers every arrival up to 304.8 — 4.8 past the centre line |
| Rest angle | 1.1 rad (63°) below the inward horizontal | Puts the resting tip 9.7 units above the baseline, less than the 23 a ball needs, so **a resting flipper seals against its own baseline** |
| Swing | 1.05 rad, leaving a raised flipper at 0.05 rad | All but flat, so almost the whole of its length is reaching across the mouth rather than down it |
| Resting drain | 178 units of clear ball travel between the two tips | 47% of the mouth, 30% of the table. The target both players are aiming at and the hole both are covering |
| Rise / fall | 0.075 s up, 0.11 s down | Thrown up, falls back. One rate for a thumb, a key and every bot tier |
| Flipper restitution | 0.5 against a flipper that is not moving | A flipper you left up is a wall that kills the ball. A flipper caught mid-swing carries up to 2408 units/s of surface velocity at the tip instead |
| Bumpers | 5: one at the centre (r 42) and two half-turn pairs (r 32) | An odd count needs one at the exact centre, which is why the serve spots are offset from it |
| Bumper gain | ×1.12 on the ball's speed | The only thing on this table that adds energy |
| Ball speed | 300 to 900 units/s | The ceiling is set by the substep, not by taste: 900/240 is 3.75 units a substep against a 23-unit contact distance. The floor keeps a ball killed by two resting flippers moving |
| Substeps | 4 per fixed step | A flipper tip and a ball head-on close 13.78 units a substep against 23 of contact. At one pass a fired flipper would pass through a ball |
| Vertical floor | 0.22 of the ball's speed, after a bumper | The anti-stalemate rule; see *Edge cases* |
| Serve | 520 units/s, ±0.5 rad, from (240, 420) or (360, 540) | The two spots are each other's half-turn image |
| Serve delay | 45 steps | |
| Walls | 14 segments: 2 rails, 4 baseline stretches, 4 shoulders, 4 posts | Three half-turn pairs and one pair of rails |

p1 defends the bottom mouth (y = 960) and p2 the top (y = 0), matching the horizontal zone
split the manifest declares — which is also the split `GameHost` gives an `rt-*` game whatever
the manifest says, so declaring anything else would be a lie the shell then contradicts.

### There is no gravity, and that is a decision **[ours]**

A pinball table is tilted. A table with a player at each end cannot be, because tilting it
hands one seat the harder half for the whole match. So the ball travels at a constant velocity
between contacts and the two ends are exactly equivalent. What replaces gravity as the thing
that keeps the ball lively is the bumper field and the flippers themselves.

The consequence took a rebuild to notice. **A funnel needs gravity behind it.** The first
version shaped each end like a real table, with shoulder walls sloping in from the rails at
34°, and a wall leaning in at more than 45° reflects a ball travelling straight down the table
straight back up it: the funnels were repelling the ball from the very end they were meant to
guide it into. Steepening them to 63.6° took goals a match from 6.2, 5.5 and 2.7 at the three
tiers to 7.4, 6.9 and 3.8, and stalemate re-serves from 1.7, 2.2 and 3.1 a match down to 0.7,
1.2 and 2.6. `rules.test.ts` asserts the sign of the deflection rather than the angle, because
the angle is a consequence and the deflection is the requirement.

### The table is its own picture upside down

Every wall has a partner at (600 − x, 960 − y), the two bumper pairs are each other's image,
the centre bumper is its own, and the two serve spots are each other's image with exactly
negated velocities. Neither seat is ever handed the easier end. `rules.test.ts` asserts each
of those separately rather than trusting the arithmetic.

Mirroring is about the **centre of the table** rather than about zero, so `600 − (a + b)` and
`(600 − a) − b` are not the same double. Decisions therefore mirror **to the bit** — which
flipper the bot picks, which seat scores, whether a contact happened — and measurements mirror
to a stated **1e-8**, which is what the mirror tests assert.

## Scoring and the win condition

**First to 5 goals** — `{ kind: 'first-to', target: 5 }`, resolved by the SDK's `resolve()`
rather than by a comparison written here, so a double event in one step is a draw rather than a
win for whichever seat the code happened to check first. **[ours]** — the observed rule gives
no target; five puts a bot match between 45 and 71 seconds, mean 56.

A goal is scored when the ball passes a baseline **entirely** — centre plus radius past the
line, not merely touching it. `goalScored` names the seat that **scored**, never the one whose
mouth was crossed, because every caller wants the scorer and the alternative is an inversion
bug waiting to happen.

After a goal the ball is re-served after 45 steps, **aimed at the other end from the last
serve**, whoever scored. Alternating rather than "the conceding seat serves": the ball is a
turn at attacking as much as a thing to defend, so alternation is the only division of it that
cannot accumulate in one seat's favour. Which end the *first* serve goes to is the one thing
about a serve the mirror does not fix, so it is a coin flip from the seeded stream.

### And a backstop clock, at 100 seconds

First to five is the rule; the clock is what guarantees the match ends. `roundSeconds` ends
nothing — it is validated by the manifest schema and read only by the catalogue card — so every
game must guarantee its own termination, and this is how this one does. At the whistle the
higher score takes it and a level match is a draw, both through the same `resolve()` call with
`timeExpired`.

**The arithmetic, multiplied out.** The clock is decremented on *every* step, serve countdowns
included, and nothing extends it, so the longest possible match is exactly 100 s = 6000 steps
at 60 Hz against the termination guard's ceiling of 36 000. A margin of six. Measured over 1080
bot matches the worst match actually seen was **6001 steps**, which is that bound and not an
estimate of it.

Two bars, one down each rail, fill from the halfway line outwards as the clock runs down. **Two
of them, because one bar down one edge is nearer to one player than the other**, and a rule one
seat reads more easily than the other is not the same rule for both. The idea is Brick Blast's;
the reason is the same one.

## Controls

| | Touch / pointer | Keyboard |
|---|---|---|
| **p1** (near seat) | Touch the bottom half: left of the centre line raises the screen-left flipper, right of it the screen-right one. Hold to keep it up | `A` / `D` |
| **p2** (far seat) | The same in the top half | `←` / `→` |

Both sources are **OR-ed into the same two booleans** — a flipper is up if either raises it — so
there is no mode to switch between them and a player may use both at once. A key names a
direction and a finger names a place, and both name the same flipper.

**Sides are screen sides, not seat sides.** The table does not rotate for a real-time game, so
the far seat reads it upside down and their screen-left flipper is on their right hand. Air
Hockey, Ping Pong and Brick Blast all put the keyboard axis in screen space for both seats;
this follows them, because it is the only convention under which a finger and a key name the
same flipper. The half-turn mirror therefore swaps the side as well as the seat, and the mirror
tests are written that way.

**A seat can raise one flipper at a time, and that limit is identical on both instruments.**
The engine sums the two direction keys into one axis, so `A` and `D` together read as neither;
and a seat reports one pointer position however many fingers are on the glass, so a thumb
cannot raise two either. Being an equal limit on both is what keeps it fair rather than a
defect in one of them, and `game.test.ts` drives every clause of the table above through a real
`InputManager` and asserts the behaviour rather than reading the string and nodding.

The skill both instruments express identically is **when**. A flipper that is not moving takes
half the ball's speed away; a flipper caught mid-swing adds up to 2408 units/s at the tip, and
where along the flipper the ball lands sets both how hard it leaves and which way. Tapping at
the right moment is the whole game, and tapping is exactly what a thumb and a key both do.

Measured over the registry's own control-parity idea — one seeded flail expressed as keys and
as a finger, 60 seeds against a `normal` bot — the keyboard won 20 of 58 decided matches and
the pointer 28 of 60, with 456 and 445 score movements respectively. A flailing script is not a
player; what matters is that both instruments reached the game equally often and that the
12-point gap is 1.3 standard deviations, well inside noise.

`W`, `S`, `↑`, `↓`, `Space` and `Enter` do nothing: a flipper pivots, it does not travel, and
this game has no second action to bind.

## Edge cases

- **Simultaneous input.** Both seats act every step and each owns its own end. There is no
  contested resource, so there is nothing to tie-break.
- **A touch in the other seat's half.** It belongs to the seat it went *down* in and keeps that
  ownership across the midline — the engine's `PointerOwnership` owns this, and the game never
  asks where a pointer is, only which seat's input it arrived on.
- **A finger lifted mid-rally.** The flipper falls back over 0.11 s. There is no latch: a
  flipper you are not holding is down.
- **Flipping too early.** A raised flipper that has stopped moving takes half the ball's speed
  and hands it back slowly, and a flipper on its way *down* is moving away from the ball and
  returns less than a third of what a rising one does. Getting the moment wrong is worse than
  leaving the flipper alone, which is why the weakest bot tier concedes more than a bot that
  never flipped at all would.
- **A ball in the seam between a flipper and a post.** Walls are resolved first and the flipper
  last, so the moving body has the last word; the next substep pushes the ball out along the
  post's normal, which points into open table.
- **A ball sent flat across the table by a bumper.** The one position this table could not
  resolve on its own: it would bounce between the two rails and reach neither mouth.
  `enforceVertical` puts a floor of 0.22 of the ball's speed on the vertical component after
  every bumper contact, which costs nothing anybody can feel: the shallowest face a flipper
  can present is a resting one, and its normal is already 0.45 vertical.
- **A ball meeting nothing at all.** The rails are parallel and so are the baselines, so a ball
  travelling exactly up and down at x = 60, outside every bumper and inside no mouth, would
  bounce for ever. **The stalemate rule is counted on contact rather than on goals**, and that
  is the whole of it: every real path here touches a bumper or a flipper within a second or
  two, and a rail-to-rail orbit touches neither, ever. Six seconds of touching nothing re-serves
  the ball with no score. The first version re-served after twenty seconds without a *goal* —
  a plausible-looking number and a wrong one, because two `hard` bots genuinely go forty
  seconds between goals, so it was firing two and a half times a match on the best rallies in
  the game. On contact it fires **15 times in 1080 matches**, about one match in seventy.
- **A ball off the table.** It cannot be: the walls seal every edge except the two mouths, and a
  ball through a mouth is a goal in the same step. `ballLost` is the backstop for the day that
  stops being true, and it re-serves rather than leaving a match nobody can finish.
  `rules.test.ts` walks a ball through 20 000 substeps of the wall set and asserts it never gets
  out any other way.
- **No input at all.** The bots play on; two absent humans concede alternately and the match
  still ends, at the target or at the whistle.

## Determinism

- **No randomness outside the seeded stream.** Three draws exist: the coin flip for the first
  serve's direction, the serve angle once per serve, and **two** noise samples per bot per step
  — drawn whether or not they are used, so the stream advances at one rate however the match
  goes. `rules.test.ts` asserts that a busy bot and an idle one leave the generator in the same
  state after fifty steps.
- **No decay and no gravity, so no rate to get wrong.** The ball travels at a constant velocity
  between contacts, so the position integral is exact however the step is chopped up: eight
  substeps of `h/8` and one of `h` land on the same numbers. There is deliberately no drag term
  — the friction-as-a-rate problem the other physics games solve carefully does not arise
  because there is no friction.
- **The flipper is integrated the same way and reads back the rate it actually travelled at.**
  `flipperPhaseRate` is derived from the displacement rather than from the nominal rate, so a
  flipper already at the top of its swing reports zero surface velocity. Nominal-rate surface
  velocity would have let a parked flipper launch a ball as hard as a swinging one.
- **Every delay is counted in whole simulation steps**, never in seconds: the serve countdown
  (45), the stalemate timer (360) and the bumper flash (12).
- **No wall clock, no device reads, no `Math.random`** — all three enforced by ESLint.
- The one thing that is *not* rate-independent is which step a contact is detected on, which is
  true of every discrete collision in the collection. The fixed loop makes it moot: every device
  steps at the same rate, and the repo's `cross-viewport` guard drives this game at five very
  different viewports and compares the traces with `toEqual` on raw floats.

## The bot

It reads the one ball's position and velocity, and nothing else — the same picture a player
has. It rewinds the ball by its reaction time, predicts a straight line folded off the side
rails, and raises the flipper on the side the ball is arriving on. It is **not** told which
bumper the ball is about to meet, so a deflection surprises it exactly as it surprises a person.

**Reaction time is spent, not compensated for.** The bot fires when its own reading says one
flipper rise is left, and that reading is `reactionSeconds` old, so every tier starts its swing
that many seconds after the moment it called for. The flipper band is 145 units deep, so a late
swing still meets the ball — lower down, and with less of the swing left to give it. That is
what being slow costs here, and it is the only thing reaction time does: because a ball travels
in a straight line between contacts, rewinding and re-extrapolating gives back exactly the same
prediction.

Difficulty is reaction delay, firing-time noise and arrival-place noise, and nothing else:

| Tier | Reaction | Firing noise | Arrival noise |
|---|---|---|---|
| easy | 0.28 s | ±0.105 s | ±130 units |
| normal | 0.17 s | ±0.060 s | ±74 units |
| hard | 0.12 s | ±0.040 s | ±48 units |

Both noise samples are drawn once per approach and **held**; resampling them every step would
average the error away and leave three tiers that all fired at the same instant.

There is one rise rate and one fall rate on this table and every driver of a flipper goes
through them, so no tier can move a flipper faster than a person, hold two at once, or reach a
position a person's key cannot (CLAUDE.md rule 6). The tier spacing was **re-derived for this
game** rather than copied: a response curve was measured first (goals conceded per mouth entry
against a single skill parameter) and it saturates above a reaction of about 0.24 s, so an
`easy` tier placed past the knee is indistinguishable from one at it. The first attempt put
`normal` and `easy` both past the knee and measured `normal` beating `easy` 58% of the time,
which is a flat ladder wearing three names.

### Measured win rates

Three independent seed families (×101, ×7717, ×20260824), 30 seeds each, **both seat orders** —
180 matches a row:

| Pairing | Stronger tier wins | Goals to the stronger tier | Draws |
|---|---|---|---|
| hard vs easy | 170 / 179 decided (**95.0%**) | 74% | 1 / 180 |
| normal vs easy | 128 / 180 decided (**71.1%**) | 58% | 0 / 180 |
| hard vs normal | 144 / 175 decided (**82.3%**) | 64% | 5 / 180 |

Ordered, and neither saturated nor flat. `normal` over `easy` is the weakest step of the three
and it is reported as it is rather than as the most flattering slice of it.

### Measured seat fairness

Mirror matches, ten independent seed families, 120 seeds each — **1200 matches a tier**:

| Tier | p1 wins | z against 50% | Draws |
|---|---|---|---|
| easy | 575 / 1198 (48.00%) | −1.39 | 2 / 1200 |
| normal | 615 / 1186 (51.85%) | +1.28 | 14 / 1200 |
| hard | 548 / 1130 (48.50%) | −1.01 | 70 / 1200 |

All three inside 1.4 standard deviations of level. **This needed the ten families to say.** A
first pass over a single seed family showed 55.1%, 58.6% and 57.6% for p1 at the three tiers,
which looks exactly like a seat bias and was a correlated seed family: four more families
brought the per-family spread to 36–58%, and the aggregate above is level. Quoting that first
family would have been quoting a flattering slice of a measurement that had not been taken.

## Measured pace, and the mechanic actually happening

The headline verb of this game is a **goal**, and the number below is reconstructed from
sampled ball positions rather than read off the score: the speed floor means a ball in play is
never slower than 300 units/s, so a velocity of exactly zero can only be a ball parked on a
serve spot, and where it was the step before says whether it had just gone out through a mouth
and whose. A counter can be wrong in the same way a rule is; two independent stories about the
same match cannot both be wrong the same way.

Over the same 1080 matches:

| Pairing | Goals a match | One goal per | Mouth entries a match | Converted | Mean match | Longest rally |
|---|---|---|---|---|---|---|
| hard vs easy | 6.64 | 7.6 s | 16.0 | 41% | 50.7 s | 55.7 s |
| normal vs easy | 7.32 | 6.6 s | 14.7 | 50% | 48.5 s | 51.5 s |
| hard vs normal | 7.11 | 8.9 s | 20.7 | 34% | 63.4 s | 67.3 s |
| easy vs easy | 7.53 | 6.0 s | 12.9 | 59% | 45.2 s | 41.5 s |
| normal vs normal | 7.51 | 8.0 s | 19.0 | 40% | 60.0 s | 43.0 s |
| hard vs hard | 7.16 | 9.9 s | 24.6 | 29% | 71.1 s | 59.7 s |

**Zero of the 1080 matches finished without a goal**, and the reconstruction disagreed with the
scoreboard **zero times** in 1080 matches. 1039 of 1080 ended at the fifth goal rather than at
the whistle; 39 of the 41 that ran out the clock involve `hard`, and 22 of those are `hard`
against `hard` — the pairing a human never plays. The ball's speed touched its 900 ceiling and never crossed it.

The conversion column is the clearest single picture of what the three tiers are: given a ball
arriving in its own mouth, `easy` concedes 59% of the time, `normal` 40% and `hard` 29%.

### One warning about measuring this

The first reconstruction reported **zero goals in every match** — and it was the detector, not
the game. It watched for the ball to be past a baseline, which is precisely the state the game
resolves and clears inside the same step, so the condition was never observable from outside.
The second reconstruction watched for a large jump in position instead and over-counted by two
a match, because a flipper sweeping into a ball moves it further in a step than the ball can
travel. Only the third — a ball at a dead stop, which nothing but a serve can produce —
agreed with the scoreboard. A reconstruction is worth having precisely because it can be wrong
differently from the thing it is checking; that also means it has to be checked itself.

## Presentations

- **Shared-screen.** The table splits horizontally, each seat owning its own end and its own
  half of the pointer surface. **Nothing rotates**: a table with a mouth at each end reads
  correctly from both ends already, which is why a portrait phone suits it.
- **Single-seat.** The whole table upright, the local seat at the bottom. The opponent's
  flippers are drawn but not reachable. Rules, scoring and simulation are byte-identical.

Both seats always see the whole table — there is nothing to letterbox differently and no
information either seat has that the other does not (rule 9).

Colour is never the only signal (rule 7): p1's mouth and both its flippers carry **one** pip,
p2's carry **two**, each flipper wears a dark cap at its tip and a deeper collar at its pivot,
and the bumpers are one shape nobody owns.

## What is not specified here

Art and audio (#830), cross-device play (#2043), and the input fairness audit (#2044). Each has
its own issue and none is done. Two things are decided but deliberately left open to change:
the bumper layout is a single fixed arrangement rather than anything drawn from the seed, and
the table has no multi-ball, which the observed rule neither asks for nor forbids.
