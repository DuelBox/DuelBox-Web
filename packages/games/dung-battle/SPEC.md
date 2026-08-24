# Dung Battle — specification

**Archetype:** `rt-arena` · **Category:** Arena · **Logical box:** 800 × 800 ·
**Zone split:** shared-board · **Round length:** 60 s, which is the clock the match ends on

> **Written from the implementation, not before it.** **[ours]** marks our decisions rather
> than observations. Every number below was read out of `rules.ts` while writing this, and
> every measurement was taken with the code as it stands — the tables at the bottom say how
> many matches each one is made of.

## Observed rules

> Move your beetle and bring the precious brown ball to your base! Don't get too close to
> ladybugs!

That fixes four things: you drive one beetle, there is one ball, your base is somewhere you
take the ball *to*, and ladybugs are dangerous at close range. It says nothing about how the
ball moves, what "too close" costs, what stops a round neither player wins, or what a player
holding a keyboard does. Everything else here is **[ours]**.

The one thing worth drawing out of that sentence: both players want the ball in **their own**
base, and the two bases are at opposite ends. So the two seats want the same object moved in
opposite directions and there is nothing to guard but the ball itself — no goalmouth to camp
in, because sitting in your own base does not stop the other player taking the ball to
*theirs*. Every second of the match is a contest over one object.

## The pit

Simulation coordinates are centred: `[-400, 400]` in both axes, with the middle of the pit at
`(0, 0)`. Only the render layer knows the box's corner, and it adds 400 to each axis.

| | Value | Why |
|---|---|---|
| `ARENA_HALF` | 400 | The 800 × 800 box the manifest declares. Square, so it reads the same in either orientation |
| `BEETLE_RADIUS` | 34 | The smallest of the three bodies: it has to cross a ring of ladybugs |
| `BALL_RADIUS` | 40 | Bigger than a beetle, so the thing both players are watching is the biggest thing in the pit |
| `LADYBUG_RADIUS` | 22 | Flip distance is therefore 56 — drawn, at exactly that radius |
| `BASE_RADIUS` | 150 | Delivery window at the wall is `2·√(150² − 40²)` = **289 units**, 36% of that wall |
| `BEETLE_SPEED` | 300 u/s | Crosses the pit in 2.7 s; covers the 250 units from the middle to a base lip in 0.83 s |
| `BALL_DRAG` | 1.6 /s | A decay **rate**. A ball leaving a shove at 345 rolls 216 units and stops |
| `PUSH_RATIO` | 1.15 | The ball leaves at 345 against the beetle's 300, so it draws ahead and has to be chased |
| `GRIP` | 0.55 | How much of a beetle's *sideways* motion the ball takes on. The deadlock-breaker |
| `MAX_BALL_SPEED` | 700 u/s | 11.7 units in a 60 Hz step against a contact distance of 74: no tunnelling |
| `WALL_BOUNCE` | 0.45 | A pit floor, not a billiard cushion |
| `BALL_SHARE` | 0.62 | Share of an overlap the ball gives up; the rest pushes the beetle back |
| `LADYBUG_COUNT` | 4 | Two mirror pairs. A **weak** lever — see the measurement below |
| `LADYBUG_SPEED` | 165 u/s | 55% of a beetle, so being chased is never hopeless |
| `LADYBUG_TURN` | 1.15 rad/s | Turning circle 143 units, so a bug cannot hold the ring exactly and drifts across it |
| `SHY_RADIUS` | 175 | The ring the bugs hold around the ball. Pocket inside it: 119 units, against 74 for a beetle on the ball |
| `STUN_SECONDS` | 1.2 | 360 units of running — further than the ball travels from the middle to a base |
| `KNOCKBACK_SPEED` / `_DRAG` | 260 / 5 | 52 units of skid, from the 56 it was caught at to about 108 |
| `START_OFFSET` | 250 | Outside the ring (175 + 56 = 231), so a round does not open in danger |
| `TARGET_DELIVERIES` | 3 | With 3.3–4.1 deliveries a match, most matches are decided on the target rather than the clock |
| `MATCH_SECONDS` | 60 | The termination guarantee. Nothing pauses it |

### Three constants that are not copied from a sibling

`BEETLE_SPEED` is not King of the Yard's 320 and `BALL_DRAG` is not Mini Soccer's 0.42 — that
one is not even the same *kind* of number (Mini Soccer's is a per-second retention, this is a
decay rate in an analytic integral). Each was derived here from the pit's own geometry: a
delivery run is 250 units, a shove is worth 216 units of roll, and those two numbers are what
make a breakaway worth about one and a half shoves.

## The three rules the game is made of

**1. A beetle shoves the ball directly away from itself.** So *where you stand when you
arrive* decides where the ball goes, and the whole skill of the game is getting to the far
side of the ball from your own base before the other beetle gets to the far side from theirs.
The shove is a velocity **target**, not a repeated impulse: it stops applying the moment the
ball is already leaving that fast, which is what keeps it the same shove at any step rate.

**2. The shell has grip.** A beetle walking *across* the ball rolls it sideways at
`GRIP` × its own sideways speed. This is the answer to the position both players are
constantly in: two beetles pressing the ball from opposite sides cancel exactly — equal and
opposite targets, ball dead still — and nobody wins that by pressing harder. You win it by
walking across the ball and rolling it out of the squeeze. Without grip, that position was
stable, and it showed: bot matches piled up in the middle of the pit and a quarter of them
expired on the clock at level scores.

**3. The ladybugs ring the ball.** Every bug steers at the nearest point of a circle of radius
175 around the ball, at a capped turn rate. The ring travels with the ball, so wherever play
settles is ringed within a second or two, and a ball shoved hard leaves its escort behind
while it rolls. The pocket inside the ring is clear to 119 units and a beetle touching the
ball stands 74 out, so **possession is safe and getting there is not** — which is the shape
the observed rule describes.

## Scoring and the win condition

`resolve({ kind: 'first-to', target: 3 }, score, { timeExpired: clock <= 0 })`, called every
step. No comparison is written by hand anywhere in this game, so "first to three" and the
level-at-the-whistle draw mean here exactly what they mean everywhere else.

A delivery is the **ball's centre** inside a base disc, tested on squared distances — exact
arithmetic, no epsilon, and a ball exactly on the ring is in. The rule says nothing about who
pushed it there: shoving the ball past your own beetle and into the far base pays the other
seat, which is a real way to lose a point and a real reason to be careful with a loose shove
near the wrong end. `rules.test.ts` asserts it.

After a delivery the ball is **left where it landed** for `CELEBRATE_SECONDS` = 0.65 s, then
everything returns to its mark for a `HOLD_SECONDS` = 0.35 s kick-off. Leaving it there is not
decoration: a ball snatched back to the middle on the scoring step is a point that appears on
the HUD with nothing visible having happened, and it is also unobservable from outside — the
only evidence would be the counter that claims it. All the delivery counts below are
reconstructed by watching the ball cross into a base, which is only possible because it sits
there.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Seat one (near) | Start a drag in your own half; the beetle runs at your finger | `W` `A` `S` `D` |
| Seat two (far) | Start a drag in your own half; the beetle runs at your finger | `↑` `↓` `←` `→` |

The two are the same instrument. A key gives a direction; a finger gives a point, and the
direction is the way from the beetle to that point — so a finger held straight out to the
right of a beetle and the right-hand key produce the identical drive, asserted by driving both
through the real `InputManager` in `game.test.ts` and comparing where the beetle ends up.
Neither can move a beetle faster than `BEETLE_SPEED`, because both end up in the same
`driveBeetle`. A finger within `POINTER_DEADZONE` = 10 units of the beetle's own centre is a
finger resting on it and drives nothing.

**There is no action key**, and the manifest promises none: a match played with Space and
Enter held down is byte-identical to one played without them, which `game.test.ts` asserts.

**The two keyboard halves are two people, permanently.** `W A S D` is seat one and the arrows
are seat two, at the same time, for the whole match — asserted by driving seat two's keys and
checking seat one did not move.

The pointer surface is split **horizontally** for this archetype. That is not the manifest's
`shared-board` talking: `GameHost` gives the whole surface to one seat only when a game
reports an active seat, and this one reports `null` for ever, so the split stays the zoned one
and `shared-board` is not `vertical`. So a touch has to *start* on your own side of the
device — after that it belongs to you wherever you drag it, including across the middle, which
is engine behaviour this game does not reimplement. The manifest's pointer line is worded to
match ("start a drag on your own side … wherever you take it"), and `game.test.ts` drives a
finger from one half to the other and checks the near beetle followed it while the far beetle
never moved.

## Edge cases

- **Simultaneous input.** Both seats' drives are read before either beetle moves, so neither
  can act on the other's post-step position. There are no turns and nothing is queued.
- **No input at all.** The ball never moves, the bugs ring it, and both beetles are flipped
  about twelve times each by bugs drifting outward. The clock ends it: **0–0, a draw, in 3601
  steps.** A game nobody plays is a game nobody wins.
- **A finger in the other seat's zone.** It belongs to the seat it started in. Engine.
- **A ball exactly on a base ring.** Delivered. One rule, no epsilon.
- **A ball squeezed exactly between two beetles.** It stays exactly where it is — the two
  targets cancel and the two separations cancel, both computed from one pre-contact state so
  that the answer cannot depend on which seat is looked at first. Somebody has to move
  sideways.
- **A beetle flipped while a bug sits on it.** It cannot be flipped again until it is back on
  its feet, or a bug parked on top would hold it down for ever. The skid is what carries it
  out of reach so the next flip has to be earned.
- **A beetle pinned against a wall.** Its realised velocity is zero, so it shoves nothing: the
  shove reads the displacement the step actually produced, not the one it asked for.
- **Both bases at once.** Impossible: they are 800 apart and 300 across.
- **Stalemate.** Not possible to sustain — see termination — and not stable either, because
  the ring closes on wherever the ball has stopped.

## Determinism

- **Every decay is analytic.** The ball's drag and the skid are `v·e^(−k·dt)` with the
  matching position integral, so two steps of `h` and one step of `2h` land on the same
  numbers (asserted to nine places) and a 144 Hz laptop plays the same match as a 60 Hz phone.
  A forward-Euler `x += v·dt` after a decay overshoots that integral — and it is not only a
  cross-rate problem, it is a bot problem: see `lead` below, where the Euler version of one
  bot knob cost the top tier the entire ladder.
- **Contacts are targets, not repeated shoves.** Nothing in a contact scales with the step
  rate; sixty steps of contact leave the ball at the target speed, not at sixty times it.
- **Delays are counted in steps**, and the step count is derived from the seconds the design
  wants and the step size in hand, so a pause is the same fraction of a second at any rate
  rather than half as long at twice the rate. A pause requested before any step has run
  records its seconds and is sized by the first step that runs it, because `init` is handed no
  step size at all.
- **All randomness is seeded.** Three streams from the match seed: the pit's own (which deals
  the ladybugs) and one per bot seat. The pit's is separate so that what is dealt cannot
  depend on how many decisions the tiers in the seats happen to make — `game.test.ts` asserts
  that two `easy` bots and two `hard` bots are dealt the identical pit from the same seed.
  Each bot has its own stream so that the order the two seats are polled in is not observable;
  a shared stream hands the earlier value to whichever seat is asked first, every time.
- **The bot draws exactly two values per decision on every path**, before any branch on what
  it can see.
- What is *not* rate-independent: the ladybugs' capped turn and the bots' decisions are
  control laws sampled once a step, not integrators, so a different step rate gives a slightly
  different curve. That is true of every bot in this repository and is why the physics, which
  is not, is written analytically.

## Termination

**The clock, and nothing else, and the arithmetic closes.**

`MATCH_SECONDS` = 60 and `game.clock -= dt` runs in **every** phase — live play, the
celebration after a delivery, and the kick-off pause. So the ceiling is
`60 × 60 = 3600` steps, plus the step the match ends on: **3601 steps, 60.02 seconds**, against
the guard's ceiling of 36 000. There is no branch anywhere that can extend it: no move adds
time, no phase pauses the clock, and a decided match stops being stepped.

Measured, over 3 600 bot matches across three seed families and every tier pairing: **longest
match 3601 steps, unfinished matches 0.** A match nobody plays is also 3601. `rules.test.ts`
runs the two adversarial idle scripts as well — both seats shoving the ball at the same wall,
and both seats hiding in opposite corners — and both end inside the ceiling.

## The bot

`botInput` reads the two beetles' positions and velocities, the ball's position, and the four
bugs' positions and headings. Every one of those is on the screen the player is looking at,
and everything moves in a straight line at a constant speed, so reading where a bug will be in
half a second is arithmetic anybody does by eye. The vector it returns is the same length a
held key produces and goes through the same `driveBeetle`, so no bot moves faster than a
person (CLAUDE.md rule 6).

It does two jobs, and knowing which one it is doing *is* the skill:

- **not behind the ball** — walk round to the shoulder, aiming at a point on the circle round
  the ball one swing-step ahead of where it stands;
- **behind the ball** — drive at a point 45 units *past* the ball towards its own base, so the
  shove carries on for as long as the stick is down.

| | `easy` | `normal` | `hard` |
|---|---|---|---|
| `reaction` — seconds between decisions | 0.30 | 0.15 | 0.05 |
| `wander` — radians of noise on the direction | 0.45 | 0.20 | 0.06 |
| `behind` — how completely it gets behind the ball | 0.75 | 0.88 | 1.00 |

Every knob was swept **alone**, against the shipped `normal`, both seat orders, 160 matches a
row — so one standard error is about four points. Share of decided matches:

| `behind` | 0 | 0.25 | 0.45 | 0.6 | 0.75 | 0.9 | 1.0 |
|---|---|---|---|---|---|---|---|
| | 0% | 0% | 1% | 1% | 15% | 55% | 68% |

| `reaction` (s) | 0 | 0.05 | 0.15 | 0.30 | 0.45 |
|---|---|---|---|---|---|
| | 41% | 38% | 50% | 30% | 15% |

| `wander` (rad) | 0 | 0.06 | 0.20 | 0.45 | 0.80 |
|---|---|---|---|---|---|
| | 48% | 57% | 50% | 38% | 18% |

`behind` is the axis. It is monotone across its whole range and it is a **cliff** between 0.75
and 0.9, which is why the three tiers sit inside that band rather than spread out for the look
of it: below 0.6 a bot barely wins a match at all.

`reaction` and `wander` are both real at their slow, wobbly ends and both **saturate** at the
sharp end — below about 0.15 s and 0.2 rad the sweep is flat inside its own noise, and the
readings at 0 and 0.05 s (41% and 38%) are if anything slightly *worse* than the tier value.
Said plainly: a bot that re-decides more than six or seven times a second gains nothing by
re-deciding more often, and neither would a person. That is a fact about the game — the ball
is a big slow target — not a fact about the bot, and the tiers are placed accordingly rather
than being pushed to values the measurement does not support.

### Two knobs that were deleted rather than shipped

Both read like difficulty and neither was. 200–300 matches a row, against the `normal` of the
day — necessarily, since a knob that has been removed cannot be swept against the profile that
shipped. The noise at that sample is about five points.

- **`caution` — how wide a berth to give a ladybug.** 0 / 0.5 / 1.45 measured **52 / 50 / 53
  per cent**, and stayed flat through three different pit configurations, including one with
  the flip lasting half again as long and one with the bugs diving at the ball instead of
  ringing it. It buys exactly what it says — the most careful setting is flipped 5.1 times a
  match against the least careful one's 6.4 — and that is worth nothing, because the bugs
  escort the ball and the ball is where the game is. The bot still swerves, at one fixed berth
  for every tier; it just is not pretending that is a tier.
- **`lead` — how far ahead of a rolling ball to aim.** 0 / 0.4 / 1.0 measured **49 / 50 / 29
  per cent**: nothing at all until it was enough to be a handicap.

The `lead` story is worth the extra line, because the first version of it was not merely
useless. It aimed at `position + velocity · t`, which for a ball under drag is 45 per cent
past where the ball can actually reach, and the tier with the most of it aimed furthest at
nothing: **`hard` lost to `normal` 2 matches to 38.** Replacing `t` with the analytic
`(1 − e^(−k·t))/k` the simulation itself uses made the knob harmless. It never made it useful.

Two more corrections worth recording, because both were invisible until measured:

- **The swerve was a repulsion, and it pointed away from the game.** Pushing directly away
  from a bug does not steer round the hazard, it steers away from the ball — the bugs are on
  the ball. At a berth of 194 units the most careful tier could not approach the ball at all,
  and the ladder came out **inverted**: `easy` beat `hard` 30 matches to 9. It is a sideways
  swerve now, capped so a crowd of four deflects a run no further than one does.
- **The bot aimed at the point it wanted to stand on, so it stopped when it got there.** The
  better a tier was at reaching the shoulder of the ball, the more completely it parked on it.
  Swept, `behind` peaked at 0.5 — the one value where the "standoff" happened to land inside
  the ball, so the bot kept driving — and fell to 8 per cent at 1.0. Getting behind the ball
  and shoving through it are two different targets and a bot needs both.

## What was measured

`easy` / `normal` / `hard`, 200 matches a cell (100 seeds, both seat orders), across three
**independent** seed families — strides 101, 7919 and 65537 from three different bases,
because one family on its own is exactly how a correlated slice gets quoted as a result.

**The ladder** — the first-named tier's share of decided matches:

| | family A | family B | family C |
|---|---|---|---|
| `easy` v `normal` | 9% | 10% | 12% |
| `easy` v `hard` | 6% | 5% | 6% |
| `normal` v `hard` | 30% | 33% | 38% |

**Seat fairness**, equal tiers, a single seating (not seat-balanced — that would make it 50%
by construction), about 360 decided matches a cell:

| | family A | family B | family C | pooled |
|---|---|---|---|---|
| `easy` | 52.0% | 46.7% | 46.9% | 48.5% |
| `normal` | 49.2% | 48.0% | 50.3% | 49.2% |
| `hard` | 54.9% | 51.6% | 50.4% | 52.3% |

Nine cells between 46.7 and 54.9 per cent, pooling to 48.5 / 49.2 / 52.3 — three coin tosses.
No single family is worth quoting on its own: at about 360 decided matches a cell, one
standard error is 2.6 points, so a cell reading 54.9 and a cell reading 46.7 in the same tier
are the same result seen twice. An earlier build read 44.3 in one `normal` cell and 51.8 in
another, which is exactly the shape that gets mistaken for a seat bias. The pit is provably
symmetric (below), so the only thing left to differ is the seeds.

**The headline verb.** A delivery is the whole game, so it is counted by **watching the ball
cross into a base**, from sampled positions, rather than by reading the score. Over the same
3 600 matches:

| pairing | deliveries a match (family A / B / C) | matches with none |
|---|---|---|
| `easy` v `easy` | 3.72 / 3.64 / 3.85 | 2, 4, 0 of 200 |
| `easy` v `normal` | 3.39 / 3.42 / 3.34 | 2, 3, 9 of 200 |
| `easy` v `hard` | 3.31 / 3.35 / 3.42 | 3, 3, 2 of 200 |
| `normal` v `normal` | 3.86 / 3.82 / 3.76 | 6, 4, 0 of 200 |
| `normal` v `hard` | 3.75 / 3.94 / 3.77 | 5, 2, 6 of 200 |
| `hard` v `hard` | 3.84 / 4.09 / 3.83 | 4, 4, 4 of 200 |

**The reconstruction and the game's own counter agreed on every one of the 3 600 matches**
(0 mismatches), which is the check that the counter is not lying in the same direction as the
rule. Both are asserted per match in the suites. A match with no delivery at all is 0–3 per
cent of matches and is a clock draw, not a broken one.

Between 2 and 14 per cent of matches are draws, depending on the pairing; the average match is
1681–2400 steps, so **28 to 40 seconds**, against a 60-second ceiling.

**Two things that turned out not to be levers**, recorded so nobody re-tunes them hoping:

- **The number of ladybugs.** Two, four and six measured 3.4, 3.8 and 3.7 deliveries a match
  with ladders within a few points of each other. Four is two mirror pairs and reads as a ring
  rather than a crowd.
- **The pit size.** A 900 × 900 pit with a 160-unit base and an 800 × 800 pit with a 150-unit
  base measured within noise of each other on every cell of the ladder and on deliveries a
  match. The contest is over the ball, not over the ground.

## Seat symmetry, to the bit

The pit is a square centred on the origin, the two bases are `(0, ±400)`, both beetles start
on one vertical line at `(0, ±250)`, and the ladybugs are dealt in **mirror pairs**: two draws
a pair, and the second bug is the first reflected through the middle of the pit, heading
included. So the whole board at kick-off is invariant under a half-turn plus a seat swap, and
it stays equivariant for the rest of the match because reflection commutes with everything a
bug does.

And because the coordinates are centred on the pit rather than on the box's corner, that
reflection is a **sign flip**, which IEEE-754 does exactly. Mirroring about a corner —
`x → 800 − x` — is not exact, and both Beach Ball and Spin War found that out and settled for
a tolerance of six decimal places. Here `rules.test.ts` mirrors a whole match, drives the two
copies with mirrored inputs for 2 400 steps, and asserts equality **with `===`** on every
position, velocity and heading; a second case runs a mirrored match all the way to a decided
score and checks the winner reflects too. The one caveat is the sign of zero, which a mirror
does flip and which `===` correctly calls equal.

## Presentations

The pit never rotates. An arena seen from above reads correctly from either side, which is why
this archetype suits a shared board, and the game never reads `presentation` — shared-screen
and single-seat are the same picture drawn by the shell at different sizes. `game.test.ts`
asserts that no rotation is ever pushed. Neither seat can see more of the pit than the other:
there is one pit and it is entirely on screen.

## Colour is never the only signal

- **Beetles** differ by a **count of stripes** across the shell — one for seat one, two for
  seat two — as well as by the seat colour. `game.test.ts` counts them.
- A **flipped** beetle is a different silhouette, not a different shade: pale belly up, legs
  splayed further out, no head showing.
- **Bases** differ by pattern — concentric rings for seat one, spokes for seat two — and each
  carries its seat's own mark, a disc against a square, which is the same mark its score pips
  use.
- **Ladybugs** are the only spotted thing in the pit and the only one with a black head, and
  each wears a ring drawn at exactly the distance that flips a beetle. The rings are drawn
  after every bug body so no bug can cover another's, and the base rims are drawn at exactly
  the radius `deliveryIn` tests — the losing line and the scoring line are both the lines the
  player can see.
- Nothing anywhere is text, so there is nothing to translate.

## What is not specified here

Art, audio and the licensed-asset entries; cross-device play and the fairness audit against
the harness; the tournament reporting the SDK does for us. The catalogue metadata in
`apps/web/src/data/catalogue.generated.ts` still advertises this game as ~40 s, which is
generated data this package does not own — the manifest says 60, and 60 is what the clock
does.
