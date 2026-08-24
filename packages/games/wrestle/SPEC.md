# Wrestle — specification

**Archetype:** `rt-arena` · **Category:** Arena · **Logical box:** 900 × 520 ·
**Zone split:** shared-board · **Round length:** ~40 s

> **Written from the implementation, not before it.** Every number below was read out of
> `src/rules.ts`, `src/game.ts` and `src/manifest.ts` rather than remembered, and every
> win rate was measured rather than estimated. **[ours]** marks a decision that has no
> source in the observed rules.

Two stiff-bodied wrestlers stand on one mat in a crosswind. A leap is aimed and a shove is
answered, and the round is lost by whoever puts their head on the floor first.

## Observed rules

> Jump and try not to fall on your head. Try to push your opponent to the ground instead.
> Watch the wind!

Three sentences, and they settle three things: falling on your head is how you lose,
shoving is how you make it happen, and the wind is a hazard the player is expected to read
rather than a decoration. Everything else — the body, the round, the match, the tie-break —
is **[ours]**.

## The mat

`x` is measured **from the middle of the mat**, positive towards p2's corner; `y` is the
height of the foot above the mat, positive upwards. Both are logical units. The only place
simulation `x` meets screen `x` is `ARENA_HALF`, inside the renderer.

| | Value | Why |
|---|---|---|
| Mat | 900 × 520 logical units | Landscape: a side-on mat needs width to have anywhere to leap to |
| Mat surface | screen y 430 | Simulation height zero, and the line the fall predicate tests |
| Ropes | ±354 from the middle | A foot never passes them |
| Start | ±150 | Exact mirrors, so no seat starts nearer the middle |
| Body length | 130 | Foot to head, one rigid rod |
| Body radius | 34 | Each of the three collision discs strung along a body |
| Gravity | 1500 units/s² | |
| Leap | 560 units/s up, ±210 sideways, ±0.4 rad/s spin | The lean aims the leap; the height is fixed |
| Leap cooldown | 0.3 s | A held key is one leap, not sixty |
| Balance spring | 7, damping 2.3 | A damped spring about upright — the wrestler's own effort, not a law |
| Lean torque | 3.5 | Settles at `3.5 / 7 = 0.5` rad |
| Lean push | 260 units/s² | Sideways drive while a foot is planted |
| Mat friction | 3.4 /s | A decay **rate**, with the matching analytic integral |
| Air torque / damp | 2.4, 1.2 /s | Turning in the air — the skill the whole game rests on |
| Strongest gust | 380 units/s² | |
| Wind on a planted foot | ×0.3 | The wind is a *jumping* hazard; a wrestler in the air takes all of it |
| Wind torque | 0.0046 per unit | At the strongest gust it leans you 0.25 rad |
| Tipping point | 1.0 rad | Past this the wrestler has lost their feet |
| Landing angle | 0.9 rad | Steeper than this and a landing sticks toppling instead of standing |
| Topple torque | 11 | Constant, and what guarantees a round can end |
| Restitution | 0.85 | A wrestler-on-wrestler shove |
| Rope bounce | 0.35 | How much of a horizontal speed the ropes give back |
| Landing slide / spin | 0.55, 0.6 | What survives a landing |
| Lift speed | 90 units/s | Upward speed a shove needs before it counts as taking a wrestler off its feet |
| Speed / spin ceiling | 1400 units/s, 14 rad/s | One step moves a body less than the pair's contact distance |
| Round clock | 40 s (2400 steps at 60 Hz) | |
| Between rounds | 72 steps | The fallen pose is held: a round is lost in a third of a second |

**A wrestler is a rod, not a ragdoll.** The foot carries the position, `angle` carries the
tilt, and the head is the far end. A ragdoll settles into poses that are neither standing
nor fallen, which is exactly the state a match must never reach.

**Signed coordinates are load-bearing.** Mirroring the world is then exactly `x -> -x`,
which IEEE arithmetic performs without losing a bit, so the seat-symmetry tests in
`rules.test.ts` are equalities rather than tolerances. Written as `width - x` they could
only ever have been tolerances — and a seat advantage is exactly the bug a tolerance hides.

## The fall predicate

```
headHeight(w) = w.y + cos(w.angle) * 130
hasFallen(w)  = headHeight(w) <= 0
```

One inequality on one continuous quantity, decidable in every pose without exception:
standing, mid-leap, mid-flip, or sliding on its back. There is no "neither up nor down"
pose to get stuck in, because the question is not *is it standing* — it is *is the head on
the floor*, and a head is always somewhere.

While a foot is planted this reduces to `|angle| >= π/2`, which is the line a player can
see: the moment the body passes horizontal. In the air a head-first landing trips it before
the feet ever arrive, which is the punishment for a bad leap.

The renderer draws the mat line at exactly the height the predicate tests, and a test says
so, because **the losing line has to be the line the player sees**.

### Three stances and the one door between them

`grounded → toppling → fallen`, plus `airborne` either side of a leap. A landing steeper
than 0.9 rad arrives already toppling. A shove that puts more than 90 units/s of lift under
a planted wrestler makes it a projectile, and it lands as one — both halves of that test
are needed, or a pair leaning on each other would flicker in and out of the air and neither
could ever jump.

**No input reaches a toppling wrestler.** Past the tipping point you are going down. That
is not flavour; it is the bound in the termination argument below.

## Scoring and the win condition

**First to three rounds** — `{ kind: 'first-to', target: 3 }`, resolved by the shared
`resolve()` helper with `timeExpired` set once five rounds have been played. No comparison
is written by hand here, so "first to three" means what it means in every other game and a
level tally at the end is a draw rather than undefined.

A round is judged by `judgeRound(bout, timeUp)`:

| | Outcome |
|---|---|
| One head down | The other seat takes the round |
| **Both heads down in the same step** | **Both** seats score, exactly as a double ring-out does in Sumo Push |
| Clock expires | The **steadier** wrestler takes it — least radian-seconds of lean carried while on the mat |
| Clock expires, steadiness level to the last bit | Nobody scores |

A genuinely simultaneous fall must not be handed to whichever body the loop happened to
test first, and a dead-level pair must not be handed to a seat by an arbitrary tie-break.
Both are the kind of quiet unfairness the shared helpers exist to prevent.

**Steadiness is the tie-break because it is the only number both players watch all round.**
It fills a bar per seat, so a round settled on the clock is settled on something visible
rather than on a hidden statistic. Only time on the mat counts: a leap is meant to be
risky, not scored as a wobble.

After a round both wrestlers stand back up, exactly mirrored, and the next round opens
after 72 steps. A decided match leaves the losing wrestler where it fell, so the last frame
shows how the match ended rather than a tidied-up mat.

## The wind, and how it is seeded

Per round, `drawWindSchedule(out, phase, rng)` fills a preallocated array of **14 gusts**
of **3.2 s** each — 44.8 s, enough to outlast the longest round the clock allows — from the
match's seeded `Rng` and nothing else.

**Only the strengths are random.** Each is `rng.float() * 380`. The *direction* alternates
gust by gust from `phase`, and `phase` is the round number plus a coin the match drew once
at `init`:

```
towardsP2 = (((phase + i) % 2) + 2) % 2 === 0
phase     = roundIndex + windFlip        windFlip = rng.int(0, 2), once per match
```

So consecutive gusts blow opposite ways, consecutive rounds start opposite ways, and no
seat is the one the wind starts behind in every match ever played.

**This is not decoration.** Recorded above `drawWindSchedule`: with the wind blowing the
same way at the start of every round, two `hard` bots — identical code, mirrored start —
went **41% / 59%** to the seat the first gust blew towards over four hundred matches,
because most rounds end inside a gust or two and a good bot allows for the wind when it
aims. Alternating both ways took the same measurement to 50/50. A wind schedule is exactly
the sort of thing that looks fair and is not.

`readWind()` writes what the players can see into one `Wind` struct: the gust blowing now,
the next one, and how much of its warning is left. **`upcoming` is zero until the gust is
within one second**, which is the same instant the second row of chevrons is drawn. The
renderer and the bot read that one struct, so the arrow on screen and the bot's knowledge
cannot come apart (CLAUDE.md rule 6). The bot re-checks it anyway — `wind.warning > 0 ?
wind.upcoming : 0` — because rule 6 is too easy to lose to a future edit of the producer.

## The termination argument

A physics game with two players who can both simply stand still has to prove it ends.
Wrestle does, at three nested levels:

1. **A topple always reaches the mat.** Past the tipping point the body is driven
   monotonically towards head-down by a constant torque of 11 that no input touches, so it
   falls from 1.0 rad to π/2 within `sqrt(2 · (π/2 − 1) / 11) ≈ 0.32 s` — about 19 steps —
   however the two seats behave. Tested from every spin the state can be entered with,
   including one fighting the topple at 8 rad/s, and against the strongest gust holding it
   up. Bounded at 120 steps in the test; measured at well under that.
2. **A round always ends.** It ends on a fall, or on the round clock at 2400 steps, where
   the steadiness comparison always returns one of `p1`, `p2` or `nobody`. There is no
   branch on which a round stays live past its clock.
3. **A match always ends.** After `MAX_ROUNDS = 5` the resolver is handed `timeExpired` and
   settles on the tally, drawn if it is level. Nothing about the state of the mat can hold
   a sixth round open.

The hard ceiling is therefore `5 × (2400 + 72) = 12360` steps — 206 s of simulation.
**Measured: two motionless seats reach a draw in exactly 12360 steps**, and the longest bot
match across every measurement below — 4500 of them — was 4083 steps. The registry-wide
termination guard passes.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| **Near seat (p1)** | Touch your half: left or right of your wrestler leans that way | `A` / `D` to lean, `Space` or `Enter` to leap |
| **Far seat (p2)** | The same | `←` / `→` to lean, `Space` or `Enter` to leap |

Both families produce the same two things and nothing else: a **lean** in [-1, 1] and a
**jump edge**. A lean is a direction, never a speed, and a jump is the pressed edge only,
so a held key or a resting thumb is one leap rather than sixty.

They combine without a mode: **a finger overrides the keys while it is down, and the keys
take over the instant it lifts.** A pointer lean is `(pointer.x − ARENA_HALF − self.x) /
120`, clamped — how far the finger is to one side of *your own wrestler*, read from its `x`
alone. It is never read from which half of the glass the finger landed in, because the mat
is shared and a lean has no vertical meaning.

The game is completable with the keyboard alone and with the pointer alone.

## Edge cases

- **Simultaneous input.** Both seats are read before either moves, and the contact is
  resolved once for the pair, so neither seat ever acts on the other's post-step position
  and neither is shoved twice.
- **Both heads down in the same step.** Both score. See the table above.
- **No input from anybody.** Both wrestlers stand there and the wind blows on both alike,
  so their steadiness stays level to the last bit and no round is ever awarded — the match
  is a **draw** after five rounds. Verified: seed 99, 12360 steps, 0–0, `draw`.
- **A held lean, into the strongest gust there is.** Cannot tip you over. The rest angle is
  `(3.5 + 380 × 0.0046) / 7 = 0.75` rad and the underdamped overshoot reaches about 0.92,
  both below the 1.0 tipping point. A player can flirt with falling but cannot be killed by
  a key they are holding; everything past the tipping point comes from a collision or a bad
  landing. **[ours]**, and the reason `TIP_ANGLE` has the value it has.
- **A lean that keeps changing its mind.** Also cannot tip you over — tested, because the
  bound above is on the settled response and a player mashing the keys is not settled.
- **A foot at the ropes.** Held at ±354 and given back 0.35 of its horizontal speed. A
  wrestler cannot be pushed out of the world, only over.
- **Two bodies exactly on top of each other.** No normal exists, so they are parted
  sideways away from the middle — the only direction here that is not arbitrary.
- **A collision at maximum closing speed.** Bounded by the speed ceiling, so no pair can
  pass through each other between two discrete tests.
- **A shove on a wrestler that is already down.** Refused. A fallen wrestler is inert.
- **A zero `dt`.** Survived: the step-rate sizing is skipped and nothing advances.

## Determinism

- **Nothing is a per-step multiplier.** The tilt is the *closed-form* solution of
  `angle'' = −7·angle − 2.3·angle' + torque`, mat friction and air damping are decay rates
  with their matching analytic integrals, and free flight is exact under constant
  acceleration. Two steps of `h` and one of `2h` land on the same numbers, so a 144 Hz
  laptop plays the same match as a 60 Hz phone. Tested at 60 Hz against 120 Hz for sliding,
  flight and tilt.
- **The balance spring is deliberately linear.** `sin(angle)` would be the honest pendulum
  and would make the answer depend on the step size.
- **Every delay is counted in whole simulation steps** — the round clock, the gust length,
  the telegraph, the between-rounds countdown, the leap cooldown — sized once from the
  host's fixed delta.
- **All randomness is seeded.** Two draws per match from `context.rng`: the wind flip at
  `init`, and 14 gust strengths per round. The bot takes exactly one `rng.float()` per seat
  per step **on every path**, so a replay stays in step with the generator whichever branch
  the bot takes.
- **No wall clock, no `Math.random`, no device reads.** A paused match simply stops being
  stepped and resumes exactly as it stood; `onResume` only re-syncs the interpolation so
  the first frame back does not drag a wrestler across the mat.
- **No allocation in `update()`.** The gust schedule is sized once at construction and the
  collision scratch buffers live at module scope.
- **Contact ties go to the pair that keeps the mirror.** Nine disc pairs are examined
  diagonals-first with strict improvement, because in a mirrored bout the distance from A's
  *i*-th disc to B's *j*-th equals the distance from A's *j*-th to B's *i*-th exactly, and
  an off-diagonal winner would be a coin flip between two tied pairs.
- **`wrapAngle` is a rounded subtraction, not a loop**, so the mirror of a wrapped angle is
  the wrap of the mirror.

## The bot

It reads its own body, the opponent's body, and the same `Wind` struct the arrows are drawn
from. There is no lookahead into the gust schedule and no access to the seed. It feels its
own balance directly, as a person does; what it is late about is the **opponent**, which is
the half of the picture a person actually has to watch.

| Tier | Reaction lag | Lean error |
|---|---|---|
| easy | 0.34 s | 0.85 rad |
| normal | 0.15 s | 0.32 rad |
| hard | 0.05 s | 0.06 rad |

**Two levers, and only two.** Every tier leans with the same torque, leaps with the same
speed, corrects a wobble with the same controller, breaks off at the same tilt, commits from
the same range, and reads the wind exactly the same way — reading the wind is the game's
whole subject, not a difficulty setting. A test asserts the profile has these two keys and
no others.

That is not tidiness. The first draft varied five more levers and the ladder came out
crooked and then inverted; the measurements are recorded above `BOT_PROFILES`. **A
difficulty lever must point at doing the same thing better.** A bot that breaks off an
attack earlier, or corrects harder, is a different opponent, not a stronger one.

The misjudgement is drawn on a 0.25 s cadence and **held** between decisions, through the
SDK's `Judgement` helper. Re-drawing it every step averages it to zero and makes every tier
play the same — the mistake this repository has now made in three separate games.

### Measured

1000 matches per pairing — 500 seeds, each played twice with the tiers in opposite seats,
so a seat bias cannot masquerade as a tier gap. Two idle humans, no input, `Rng` seeded
`1000 + 37i`.

| Pairing | Overall | as p1 | as p2 |
|---|---|---|---|
| **hard beats easy** | **82.3%** | 80.0% | 84.6% |
| **normal beats easy** | **70.8%** | 70.7% | 70.9% |
| **hard beats normal** | **53.8%** | 55.0% | 52.6% |

Draws: none in 2000 hard/easy and hard/normal matches, two in 1000 normal/easy.

**The top of the ladder is narrow, and that is worth writing down rather than rounding
up.** 0.15 s of lag is already short enough that an opponent barely moves inside it, so
almost all of what separates `normal` from `hard` is the lean error — and a wrestler who
leans slightly wrong still mostly ends up shoving the right person. The gap is real and
monotone, but a player who can beat `normal` will not find `hard` a different game. Closing
it would mean a fourth lever, and the note above `BOT_PROFILES` is the record of what
happened last time this game reached for one.

### Seat fairness

500 matches per tier against itself, seeded `500 + 101i`, share taken by p1:

| Tier | p1 |
|---|---|
| easy | 53.8% |
| normal | 50.6% |
| hard | 48.0% |

The physics is proved mirror-exact in `rules.test.ts` — bit for bit, not within a
tolerance. These numbers are the check that the match built around it (the wind schedule,
the round order, the order the two seats are read in) did not reintroduce a bias the
physics does not have.

## Presentations

- **Shared-screen.** One mat, both wrestlers on it, neither half owned by a seat. **It
  never rotates** — a mat seen side-on reads the same way up from either side of the
  device, which is why this archetype suits a shared board. A test asserts the renderer's
  rotation stack is never pushed.
- **Single-seat.** The same mat, upright, the whole viewport. Identical simulation; only
  the control mapping changes, and the SDK does that.

See `docs/presentation.md`. Nothing here re-decides any of it.

## Rule 7: colour is never the only signal

| | p1 | p2 |
|---|---|---|
| Head | **Disc** | **Square** |
| Stripes | One | Two |
| Numeral on the mat | `1` | `2` |
| Steadiness bar | Ruled **coarse** (every 55) | Ruled **fine** (every 27.5) |

Who is who is the only thing either player has to read at a glance, and in a scramble there
is no time to check a hue — so it is said three ways on the body and a fourth on the bar.

A wrestler past the tipping point is **ringed at the head** as well: nothing can save it,
and the players deserve to know that before the head lands rather than after. The whole
frame survives greyscale.

## What is not specified here

Art, audio and haptics. Cross-device play and the fairness audit. Also unmodelled: any
grapple or hold — the two bodies only ever collide, because a hold is a different and
slower game than the one the observed rules describe.
