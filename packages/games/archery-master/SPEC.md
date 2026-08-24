# Archery Master — specification

**Archetype:** `turn-aim` · **Category:** Shooter · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks decisions with no
> basis in the observed rules. Every constant below was read out of `src/rules.ts`,
> `src/game.ts` and `src/manifest.ts` rather than remembered; every measurement was taken
> by driving the compiled `dist/` — whole matches through `dist/index.js` with both seats
> botted and an idle input, and per-arrow figures through `dist/rules.js` directly, which
> is what lets a knob be swept without touching the frozen profiles. Where a number here
> disagreed with a comment in the source, the comment was corrected; see **Corrections**
> at the foot.

A gallery of twenty drifting targets at the far end of a field and a bow on the shooting
line at the near edge. Take turns: swing the bow, set the draw, let go. One arrow can
skewer several targets if you find the line, and the first archer to seventy takes the
match.

## Observed rules

> Load your bow and hit 70 targets before your opponent!

One sentence, and it decides two things: the score is a count of **targets hit**, not of
points or rings, and the match is a **race to seventy** rather than a fixed number of
arrows settled on totals. Everything else — how many targets stand at once, whether they
move, how an arrow flies, how many arrows a turn, what bounds the match, and what happens
if both archers cross seventy in the same round — is open, and every one of those is
**[ours]**.

The one sentence does rule something out, and it is worth saying: seventy is a large
number for a turn game. At one target an arrow this would be a seventy-round match a side.
So an arrow has to be able to take **several** targets, which is where the whole shape of
the game comes from — a rack rather than a single boss, an arc rather than a line, and a
gallery wide enough that a flat arrow has something to walk into.

## The field

Everything in this table is **[ours]** except the race to seventy.

| | Value | Why |
|---|---|---|
| Field | 700 × 1000, portrait | `manifest.logical`, and `rules.ts` simulates in exactly it |
| Shooting line | y = 700 | Everything above is gallery, everything below is the aiming pad |
| Bow | (350, 700) | On the centre line, so the field is its own mirror — see seat symmetry |
| Rows | y = 150, 290, 430, 560 | Four, at 550 / 410 / 270 / 140 above the bow |
| Row spacing | 140 | Against the 58 two targets need to touch, so rows never interfere |
| Columns | 5 | So a flat arrow along a row has something to walk into |
| Rack | 20 targets | 4 × 5, and it must fit a 32-bit bitmask — `(1 << 20) - 1` |
| Column slots | 70 to 630, step 140 | Evenly across the usable width |
| Column jitter | ±6 (`COLUMN_JITTER` 12) | So a rack is never a lattice |
| Drift | amplitude 18–34, rate 0.85–1.95 rad/s | Periods of 3.2–7.4 s, peak speeds 15–66 units/s |
| Target radius | 29 | |
| Arrow radius | 6 | |
| Hit radius | 35 | An arrow skewers a target when the two discs touch |
| Gravity | 4200 units/s² | Picked so the tallest arc lasts about a second |
| Launch speed | 860 at no draw, 2400 at full | Linear in the draw, so the gauge means what it looks like |
| Aim limit | ±0.85 rad (48.7°) | Beyond every useful shot, so the limit is never a wall |
| Flight ceiling | 1.15 s | Never binding — the true maximum is 1.1429 s — but the bound is built on it |
| Resolve rate | 600 Hz | The resolver's own sampling, not the caller's |
| Plan rate | 200 Hz | What a bot judges a candidate at |
| Aiming pad | (40, 735) 620 × 240 | Entirely below the shooting line; never covers a target |
| Key aim rate | 1.25 rad/s | Whole aim crossed in 1.36 s |
| Key draw rate | 0.85 draw/s | Slack to full draw in 1.18 s |
| Shot clock | 3.5 s | 210 steps at 60 Hz — half the termination guarantee |
| Settle | 0.2 s | 12 steps, after the arrow lands |
| Bot think | 0.2 s | Before it settles |
| Bot dwell cap | 2.4 s, floor 1/30 s | Think plus dwell can reach 2.6 s against a 3.5 s clock |
| Race | 70 targets | The observed rule |
| Round cap | 36 rounds | The other half of the termination guarantee |
| Shots a round | 2, one each | So neither seat ever shoots more arrows than the other |
| Tie-break | 3 best arrows | See scoring |

**Two targets in a row can never touch, and it is close.** The nearest two centres ever
come is `COLUMN_STEP − COLUMN_JITTER − 2 × DRIFT_MAX` = 140 − 12 − 68 = **60**, against the
58 two targets would need to overlap. Two units of clearance is thin enough that a test
walks ten thousand racks across a full drift cycle and asserts it rather than trusting the
arithmetic. At the extremes of jitter and drift the rack spans x = 1 to x = 699, so no
target is ever clipped by the edge of the field either.

**The field is not symmetric under the half-turn, and does not need to be.** The gallery is
at the far end and the bow at the near edge; a half-turn puts each exactly where the *other*
archer needs it. But it *is* symmetric about the vertical centre line, which is a different
and load-bearing property: the bow stands at x = 350, so mirroring every target about that
line and negating the angle skewers exactly the same targets. `rules.test.ts` asserts it
three ways — mirroring the base positions, mirroring by negating the amplitude, and
mirroring by half-turning the phase — because that symmetry is the one-line argument that
the two seats never play different fields.

## The bow, and why the draw is the decision

An arrow leaves at `SPEED_MIN + power × (SPEED_MAX − SPEED_MIN)` along the angle the bow
points, and then it is a **parabola** — `arrowXAt` and `arrowYAt` are closed forms of the
time since release, and nothing anywhere integrates. The whole point of the draw is which
row it can reach, and reaching height *h* straight up needs `sqrt(2 g h)`:

| Row | Height above the bow | Speed needed | Draw needed |
|---|---|---|---|
| 4 — nearest | 140 | 1084 | **0.146** |
| 3 | 270 | 1506 | **0.419** |
| 2 | 410 | 1856 | **0.647** |
| 1 — highest | 550 | 2149 | **0.837** |

So the near row is a light pull and the top row asks for very nearly everything, and both
ends of the gauge are live. A test reaches each row at exactly the draw this table claims.

**An undrawn bow reaches nothing, and that is the point of the speed floor.** At `power = 0`
the arrow tops out 88 units above the string, against the nearest row's 140 less the 35 an
arrow and a target need to touch — 105. It misses. At an earlier `SPEED_MIN` of 980 the
apex was 114 against that same 105, so two players who never touched the screen at all
scored 27 targets each off the shot clock; the same match now ends 0–0. At full draw
straight up the apex is 685.7, putting the arrow at y = 14.3 — inside the field, so no
arrow ever leaves over the top and the flight bound below is exact rather than hopeful.

`flightSeconds` is closed form in every branch: back to the shooting line at `2 v_up / g`,
cut short by the left or right edge of the field, cut short by the top (unreachable with
the shipped speeds, and asserted to be, but kept so the bound survives a speed rise), and
finally floored against `MAX_FLIGHT_SECONDS`. A test asserts every legal aim lands on the
shooting line or on an edge and never in mid-air, and that no legal aim reaches the
ceiling.

### The hit test is the resolver's own business

`resolveShot` walks the flight at **600 Hz, which belongs to the resolver and not to the
caller's simulation**. This is the whole reason a shot is rate-independent: the answer is a
pure function of the rack, the aim and the instant the arrow left, so a phone at 90 Hz and a
laptop at 60 resolve the identical arrow.

Within one sample both the arrow and the target move linearly, so the gap between them is
linear too and its minimum is solved exactly rather than sampled — which is what stops a
fast arrow stepping straight over a small target between two samples. A test constructs
exactly that case and asserts it does not.

At 600 Hz the arc departs from the straight segment each sample is tested as by **0.0015
units**, and a target slides at most **0.11**. A test asserts doubling the sampling rate
does not change an answer.

A target is counted **once** however many times the arc crosses it — the arrow goes up
through a row and comes back down through it — and the standing targets are tracked in a
20-bit mask that the loop exits on as soon as it is empty.

## Scoring and the win condition

**A race to seventy targets, decided only at the end of a round, with the three best
arrows breaking a level card and a real draw behind that.** The race is the observed rule;
the round boundary, the tie-break and the draw are **[ours]**.

Both comparisons go through the SDK's `resolve` rather than being written out by hand:

```
first-to 70   on targets
  → if that is a draw, highest-when-time-expires on the sum of the three best arrows
```

so "first to seventy" means here exactly what it means everywhere else in the catalogue,
and a draw is a defined outcome rather than an oversight.

**Nothing is ever clamped to the goal.** A seat that finishes a round on 72 beats one on
70, because 72 and 70 are what they actually shot. `resolve`'s `first-to` branch handles
both seats crossing in the same round by comparing the raw tallies and only calling it a
draw if they are genuinely equal; pinning both to 70 first would manufacture a dead heat
out of a decided race. A test asserts the un-pinned comparison directly.

**The race is never decided in the middle of a round.** `winnerOf` refuses to answer unless
`roundComplete`, and `#advanceTurn` only asks it after the round's second arrow. Both seats
shoot every round, so a seat that crosses seventy is always answered before anything is
awarded. That is the whole reason shooting first is not an advantage here — and the reason
the lead can alternate for a different purpose (below) without that being a fairness patch.

**Why three arrows and not one.** The single best arrow was the obvious tie-break and it is
not enough: a good arrow tops out around six or seven and both seats shoot dozens, so the
best arrow is level far too often to separate a level card. Three arrows have the resolution
to settle nearly all of them while still making the same claim — that the archer who put
the most on one string takes a dead heat. Measured draw rates *after* the tie-break, 2000
seeded matches a tier: **3.3% (easy), 2.4% (normal), 3.8% (hard)**. A card level on targets
*and* on the three best arrows really is a draw, and the shell knows what to do with one.

### Who shoots when

`leaderFor(round)` alternates: p1 leads the even rounds, p2 the odd ones. Shooting *second*
is a small advantage and a real one — you have just watched an arrow fly through the rack
you are about to shoot into, and you know what you have to beat — so over an even number of
rounds each seat leads exactly half. This is insurance for human play rather than a bot
balance knob; the round-boundary rule above is what actually makes the race fair.

### One rack per round, shared

This is the fairness decision the whole game turns on. All 36 racks are rolled **in
`init`, up front, before the seeded stream is touched by anything else**, four floats a
target in a fixed order. So the gallery of a match is a function of the seed alone and of
nothing that happens inside the match.

Both seats shoot round seven into exactly the same twenty targets, drifting from exactly
the same phase, because a turn's clock (`#turnSteps`) starts at zero for each of them. A
rack rolled per *shot* would hand one archer a row standing in a line and the other a
scattered one, and the race would be decided by the draw rather than by either of them.

### After a shot

The score moves as the arrow **reaches** each target rather than all at once when it stops:
`resolveShot` records the flight time of every hit up front, and `#burstReached` bursts
each one as the arrow gets there, so a player watches an arrow take three rather than
reading a number after it has gone. The arrow itself is recorded once, on `#land`, which
also sweeps up any hit whose recorded time fell inside the last step's rounding — so the
card always matches the arrow. 0.2 s later the turn passes.

## Termination

**Two independent bounds, and the match is over when either bites.** There is no
platform-level safety net: `roundSeconds: 90` is printed on the catalogue card and ends
nothing.

**The shot clock** bounds one turn. `#clockSteps` is set from `SHOT_CLOCK_SECONDS` on the
turn's first accepted step and decremented once per accepted step; at zero the arrow is
loosed **as it stands**, drawn or not. It runs *while* the bow is drawn, not only while it
is idle, so one player cannot stand at full draw for ever while the other waits.

**The round cap** bounds the match. `ROUND_CAP` is 36, and `#advanceTurn` passes
`nextRound >= ROUND_CAP` to `winnerOf` as `timeExpired`, at which point the highest count
settles it and a level count falls through to the tie-break. A test asserts `winnerOf`
*always* answers once the cap is reached, so a match can never fail to end.

### The worst case, multiplied out

`termination.test.ts` allows `60 × 600 = 36000` steps — ten minutes of simulated play at
60 Hz. Every delay in this game is converted to whole steps by `#stepsFor` before it is
counted, so the worst case is exact arithmetic rather than an estimate.

One turn, at its very worst:

| | Seconds | Steps at 60 Hz |
|---|---|---|
| Shot clock, never touched | 3.5 | `round(210)` = **210** |
| Flight, the longest arc there is (full draw, straight up) | 1.1429 | `round(68.57)` = **69** |
| Settle | 0.2 | `round(12)` = **12** |
| | | **291** |

A match is `ROUND_CAP × SHOTS_PER_ROUND` = 36 × 2 = **72** turns, and in shared-screen the
board's half-turn refuses input for **21** steps each time the active seat changes. The
seat order is p1 p2 · p2 p1 · p1 p2 …, so the seat changes on **36** of the 71 hand-overs
rather than on every one of them:

```
72 × 291  =  20952 steps
36 ×  21  =    756 steps
            ───────────
            21708 steps  =  361.8 s  =  60.3% of the guard's 36000
```

`rules.test.ts`'s `closes the termination arithmetic against the guard ceiling` multiplies
out a deliberately looser version of the same sum — it charges the flight at
`MAX_FLIGHT_SECONDS` (1.15, which no aim reaches) and a flip to **every** turn rather than
to every second one:

```
72 × (3.5 + 1.15 + 0.2)  +  72 × 0.36  =  349.2 + 25.92  =  375.12 s
```

which is 22507 steps, **62.5%** of the ceiling, and the assertion is `< 600`. Both numbers
clear it; the looser one is the one the test pins, because a bound that stays true when the
constants move is worth more than one that happens to be tight today.

### Measured, rather than argued

| | Steps | Seconds | Of the 36000 ceiling |
|---|---|---|---|
| Two idle humans, single-seat | **17784** | 296.4 | 49.4% |
| Two idle humans, shared-screen | **18540** | 309.0 | 51.5% |
| Worst bot match seen, ~19 000 matches | **6992** | 116.5 | 19.4% |
| The guard's own case (`easy` v `easy`, seed 20260820, shared-screen) | **6084** | 101.4 | **16.9%** |

The idle-human figure is not approximately the arithmetic, it **is** the arithmetic: an
undrawn arrow flies 0.4095 s = 25 steps, so a turn is 210 + 25 + 12 = 247 steps, and
72 × 247 = 17784 exactly. Shared-screen adds 36 × 21 = 756 for the flips. That match ends
0–0 as a draw, because an undrawn arrow reaches nothing, and `game.test.ts` asserts every
part of it — both cards zero, both seats on 36 arrows, and under 24000 steps.

**No measured match has ever reached the round cap.** Across every measurement in this
document — some 19 000 bot-versus-bot matches — the cap was reached zero times, and the
longest ran **30** of the 36 rounds available, at `easy` v `easy`. It is a backstop against a pair of
players who never score, not a normal way for a match to end — and the pair who never score
is exactly the idle-human case above, which does reach it and does terminate.

## Controls

| | Seat one | Seat two |
|---|---|---|
| **Keyboard** | `A` / `D` swing the bow, `W` / `S` set the draw, hold `Space` and let go to shoot | `←` / `→`, `↑` / `↓`, hold `Enter` and let go |
| **Pointer** | Slide a finger across the pad: across is where the bow points, further down is a deeper draw; lift to shoot | the same, read through the half-turn |

Both instruments, always, with **no mode to switch between them** **[ours]**, and only on
your own turn. `update` reads `input.seat(this.#active)` and nothing else, so the other
half of the keyboard does nothing at all until the board comes round.

**That is why the manifest names the two halves one player at a time.** A turn game hands
the whole *pointer* surface to whoever is to move — that is what `getActiveSeat` is for, and
without it the shell keeps a real-time game's two zones and the far half of the board goes
dead to a finger. It does **not** remap the keyboard, and nothing anywhere does. "W A S D
or the arrows" would be false here in the quiet way: the other half is simply inert.
`game.test.ts` asserts both directions of that — seat two's keys inert on seat one's turn,
and seat one's inert on seat two's.

**How the two sources combine.** They write the same stored aim. The pointer sets it
**absolutely** — `angle = clamp((x − 350) / 310, −1, 1) × 0.85` and
`power = clamp((y − 735) / 240, 0, 1)` — because a finger held still has no drag to read
and a relative scheme would go dead. The keys nudge that same stored value at a rate from
wherever it currently is. A player can start a shot with a finger and finish it with the
keys and nothing switches; a test does exactly that inside one shot.

**Hold to draw, let go to loose, on both instruments.** A finger on the glass and a held
key are the same intent as far as the engine is concerned (`actionHeld`), so the gesture is
spelled identically on a phone and on a laptop. Because the aim is *stored* rather than read
from the pointer at the instant of commit, the darts bug cannot happen here: on the step a
finger lifts there is no pointer, and a game that asked for one on that step would never
loose the arrow. This game reads `actionReleased` and the aim it already has.

**Parity is arithmetic, not assertion** — `docs/input-parity.md` raises this for exactly
this archetype. Crossing the whole 1.7 rad of aim takes `2 × 0.85 / 1.25` = **1.36 s** and
going from slack to full draw `1 / 0.85` = **1.18 s**; doing both takes 2.54 s against a
3.5 s clock, so a keyboard reaches every shot a thumb can with time to spare. A test asserts
those three numbers, and another drives the real `InputManager` with the literal key codes
`KeyA`/`KeyD`/`KeyW`/`KeyS`/`Space` and the four arrows and `Enter`, checking each does what
the manifest string says. `control-parity.test.ts` re-checks the same property for the
catalogue.

## Edge cases

- **A press that never drew the bow.** Ignored: `actionReleased` only looses if
  `#drawSteps > 0`, and `#drawSteps` only advances on a step where the action was *held*.
  A tap whose press and release land inside one frame is a fumbled nock, so a stray touch
  never costs an arrow.
- **No input at all.** The shot clock looses the arrow undrawn; it tops out 88 above the
  string and reaches nothing. A seat that never plays scores nothing and the match still
  ends, 0–0, a draw, after 36 rounds.
- **A finger past the edge of the pad.** Clamped to the edge of the aim rather than
  ignored. A finger *above* the pad — on the gallery, in the sky — clamps to no draw at
  all rather than being dropped, so **no part of the board is dead to a thumb**.
- **Input in the other seat's zone.** There is no other zone. On a turn the whole pointer
  surface belongs to the active seat, and only that seat's input record is read, so
  simultaneous input from both seats resolves to whoever's turn it is.
- **An arrow in the air.** Nothing is accepted until it lands, so a fast tapper cannot put
  three arrows through the rack before the first one is scored.
- **Input while the board is turning.** Refused, for a person and for a bot alike — a bot
  may not act on a step a person is not allowed to act on. The shot clock is stopped and
  the turn clock is held at zero, so the gallery is frozen too and the flip changes how
  long a match takes on the wall clock and nothing about what happens in it. Three tests
  assert those three things separately.
- **A pause mid-draw.** The nock is let down. A pause drops every key and pointer without
  an accompanying release, so a bow that was drawn when the menu opened would otherwise
  come back still drawn and loose a shot the player never took.
- **A garbled aim.** `#loose` applies `finite()` *before* `clamp`, because a comparison
  against `NaN` is false in both directions and a clamp would hand it straight back — one
  bad number would then put the arrow at `NaN` and every hit test after it would silently
  answer no. A `NaN` finger and an infinite finger each get a test, and each still shoots
  a real arrow and scores a real card.
- **Both seats crossing seventy in the same round.** The higher count wins; genuinely equal
  counts fall to the three best arrows; equal there too is a draw.
- **Stalemate.** Cannot arise. Every turn ends in a bounded number of steps whatever
  anybody does, and the round cap ends the match whatever the cards say.

## Determinism

- **Every delay is counted in whole simulation steps.** The shot clock, the flight, the
  settle, the bot's think and its dwell all go through `#stepsFor`, which rounds and floors
  at one, before they are counted down.
- **Nothing integrates.** The arrow is a closed-form parabola of elapsed time and a target
  is a closed-form sine of the time since the turn began. There is no per-step accumulation
  anywhere in the flight model, so the step rate cannot move an arrow or a target.
- **The resolver samples at its own fixed rate**, 600 Hz, independent of the caller. That is
  what makes a shot a pure function of `(rack, aim, startSeconds)`; a test asserts the same
  three inputs give the identical `ShotResult` twice, and that a different instant gives a
  different one because the rack has drifted.
- **A bot's release is quantised to a thirtieth of a second.** This one needed care and is
  the subtlest thing in the game. The instant an arrow leaves the string decides where
  twenty drifting targets are, so a dwell quantised to the step of whichever rate the device
  happens to run at resolves a marginally different shot on each. `1/30` divides 60, 90 and
  120 alike. Before the rounding, 3 of 240 bot matches finished on a different card at the
  three rates, each by exactly one target. `game.test.ts` now plays eight seeds at all three
  rates and asserts the results are equal objects.
- **The dwell floor is not decoration either.** `#stepsFor` floors at one step, so a dwell
  that rounded down to nothing became *one step* — a sixtieth of a second on one device and
  a hundred-and-twentieth on another, which is a different instant. `BOT_DWELL_MIN = 1/30`
  is the smallest value that divides all three rates.
- **All randomness is seeded**, from `context.rng` and nowhere else: 36 racks × 20 targets ×
  4 floats up front, then a bot's Box-Muller dwell (2 floats) and its hand (4 floats) per
  bot turn. **The per-turn draw count is unconditional and identical for every tier**, so
  each seat's draws sit at fixed offsets in the one stream and a seat's play can never
  become a function of how its opponent is playing. The measurement below confirms it
  end-to-end: `hard` as p1 shoots the *same* 72.30 mean targets and 13.85 rounds against
  `easy` as it does against `normal`, to every digit.
- **The Box-Muller draw is nudged into `(0, 1]`.** `float()` can return zero and `log(0)`
  is `−Infinity`, which would give an aim of `NaN` and an arrow that missed everything for
  ever after. A test draws twenty thousand normals and asserts every one is finite.
- **The two presentations step the identical match.** A test drives twelve seeds at
  `normal` v `hard` through both and compares the score objects.
- **No simulation value is in pixels** (rule 8). `rules.ts` is entirely logical units and
  seconds and imports nothing from `game.ts`; the pad constants in `game.ts` are logical
  units too, and `cross-viewport.test.ts` confirms the match is identical at every viewport
  and that every drawn point stays inside the declared box.
- **No allocation in `update()`.** The racks, the shot record, the two aims, the bot's plan
  buffers and the burst mask are all pooled and rewritten in place; `resolveShot` allocates
  nothing and `planShot` reuses its own working arrays. Tests assert both.

## The bot

It plays the game a person plays. It reads the rack as it stands at the instant it means to
loose, sorts the targets by how near they are to the bow, tries a handful of flight times
through the first few of them, keeps whichever legal aim would skewer the most, and then
looses with a shaky hand. Everything it reads is on the screen: the twenty targets, their
drift, and its own bow. Nothing hands a tier information the tier below lacks.

| Tier | `scan` | `times` | `leadRead` | `angleSpread` | `powerSpread` | `dwell` |
|---|---|---|---|---|---|---|
| easy | 10 | 2 | 0.20 | 0.020 | 0.030 | 0.60 s |
| normal | 15 | 3 | 0.60 | 0.012 | 0.018 | 0.40 s |
| hard | 20 | 5 | 0.95 | 0.005 | 0.008 | 0.25 s |

Six knobs, all of them things a person does badly, all six monotone across the three tiers,
and a test asserts that ordering knob by knob.

- **`scan` withholds attention rather than granting knowledge.** A weak archer plinks at
  the target in front of them; a strong one reads the whole rack looking for the line that
  takes three at once. At its highest it sees exactly the rack a person sees and never more.
- **`times` is a finer search, not a better one.** `PLAN_TIMES` is ordered **best first** —
  `[0.36, 0.26, 0.47, 0.21, 0.56]` — so a tier that tries three tries the same three the
  tier above starts with. Spread evenly between a minimum and a maximum instead, `times`
  was not monotone at all: two tries meant only the two extremes.
- **`leadRead` is the one thing a tier believes about the gallery**, and belief and aim come
  from the *same* number. An earlier version led the aim but judged every candidate against
  a frozen rack, so a leading shot was penalised in the choosing by exactly what it gained
  in the flying — 20 000 arrows at `leadRead` 0 and at 1 both scored 3.08, and the knob
  looked wired in while doing nothing. `rules.test.ts` now asserts the knob is worth points.
- **The two spreads are its hand**, applied to the chosen aim as a seeded normal and then
  clamped back inside the bow's limits. A test asserts every arrow it looses is legal.
- **`dwell` is how long it settles**, on the same clock everybody is on. Think 0.2 s plus a
  dwell capped at 2.4 s is 2.6 s against a 3.5 s clock, so a bot is never cut off by the
  clock and never needs handling as a special case — a test plays 90 s of `hard` v `hard`
  and asserts the clock never once ran out.

There is also a **fallback that is always legal** — straight up at a draw of 0.6, reaching
the middle of the gallery — so an arrow is always loosed and a turn always ends even if no
candidate is legal.

### Which knob actually carries the ladder — and it is not the one the game is about

Taking `easy` and lifting **one** knob to `hard`'s value, 20 000 arrows each, driven through
`dist/rules.js`:

| | Mean targets an arrow | Share of the 2.59 gap |
|---|---|---|
| `easy` as shipped | 2.62 | |
| with `hard`'s **`scan`** (20) | **3.95** | **1.33** |
| with `hard`'s `times` (5) | 2.85 | 0.22 |
| with `hard`'s `powerSpread` | 2.69 | 0.07 |
| with `hard`'s `angleSpread` | 2.67 | 0.05 |
| with `hard`'s `leadRead` (0.95) | 2.66 | 0.04 |
| with `hard`'s `dwell` | 2.62 | 0.00 |
| `hard` as shipped | 5.21 | |

**The ladder is made of attention, not of reading the drift.** That is the honest reading
and it is worth stating plainly rather than flattering the theme: a bot that looks at ten
targets instead of twenty is giving up the multi-target line, and that is worth four times
what leading the drift is worth. Lifting *both* of `easy`'s search knobs together — `scan`
and `times` — takes it from 2.62 to **4.48**; lifting both of its hand knobs together takes
it to **2.75**.

The knobs do interact, which is why `leadRead` looks worthless above and is not: swept alone
at `hard`'s hand and `hard`'s scan it is worth 0.36 an arrow, and at `easy`'s it is worth
0.04. Leading a target is only worth points to an archer steady enough and attentive enough
to use them.

Every knob swept alone, everything else as shipped at `hard`:

| `scan` | 1 | 3 | 5 | 10 | 15 | **20** |
|---|---|---|---|---|---|---|
| mean | 1.52 | 2.00 | 2.59 | 3.26 | 4.68 | **5.21** |

| `times` | 1 | 2 | 3 | 4 | **5** |
|---|---|---|---|---|---|
| mean | 4.31 | 4.36 | 4.73 | 5.12 | **5.21** |

| `leadRead` | 0 | 0.2 | 0.4 | 0.6 | 0.8 | **0.95** | 1 |
|---|---|---|---|---|---|---|---|
| mean | 4.86 | 4.94 | 5.02 | 5.10 | 5.17 | **5.21** | 5.22 |

| `angleSpread` | 0 | **0.005** | 0.012 | 0.02 | 0.05 | 0.1 |
|---|---|---|---|---|---|---|
| mean | 5.37 | **5.21** | 4.93 | 4.61 | 4.03 | 3.57 |
| blank arrows | 0.0% | 0.0% | 0.0% | 0.0% | 0.2% | 0.6% |

| `powerSpread` | 0 | **0.008** | 0.018 | 0.03 | 0.08 | 0.16 |
|---|---|---|---|---|---|---|
| mean | 5.22 | **5.21** | 5.16 | 5.08 | 4.68 | 4.29 |

`powerSpread` is the weakest knob of the six, and that is geometry rather than tuning: the
draw decides which *row* the arrow reaches, and the rows are 140 apart, so a small error in
the draw mostly leaves the arrow on the row it was aimed at. The angle is what decides
whether it walks along that row or past it.

### Solo pace, 600 seeded matches a tier

One tier racing to seventy on its own, with the other seat an absent human who lets every
shot clock run out:

| Tier | Arrows to 70 | sd | Range | Targets an arrow | Blank arrows | Best arrow | Top three |
|---|---|---|---|---|---|---|---|
| easy | **27.1** | 1.4 | 22–31 | 2.62 | 0.1% | 4.20 | 11.44 |
| normal | **19.0** | 0.9 | 16–22 | 3.77 | 0.0% | 5.30 | 14.42 |
| hard | **13.9** | 0.8 | 12–16 | 5.19 | 0.0% | 7.10 | 19.71 |

The slowest tier needs 27.1 of the 36 rounds available, so the round cap has 33% of headroom
over it and a match that runs to the cap is a real stalemate rather than an ordinary game
being cut off.

### Measured win rates — 600 seeded matches per ordered pairing

Driven through the shipped `ArcheryMasterGame` with an idle input, both seats botted,
shared-screen, seeds 41000–41599. Every match finished; none came near the guard's ceiling.

| Pairing | p1 | p2 | draws | p1 share of decided | Avg rounds | Avg match | Longest |
|---|---|---|---|---|---|---|---|
| easy v easy | 292 | 297 | 11 | **49.6%** | 26.4 | 100.1 s | 116.5 s |
| easy v normal | 0 | 600 | 0 | 0.0% | 19.0 | 71.9 s | 82.8 s |
| easy v hard | 0 | 600 | 0 | 0.0% | 13.9 | 52.3 s | 63.1 s |
| normal v easy | 600 | 0 | 0 | 100.0% | 19.0 | 71.8 s | 81.1 s |
| normal v normal | 282 | 296 | 22 | **48.8%** | 18.6 | 70.3 s | 80.0 s |
| normal v hard | 0 | 600 | 0 | 0.0% | 13.9 | 52.2 s | 63.3 s |
| hard v easy | 600 | 0 | 0 | 100.0% | 13.9 | 52.1 s | 62.4 s |
| hard v normal | 600 | 0 | 0 | 100.0% | 13.9 | 52.1 s | 61.9 s |
| hard v hard | 296 | 277 | 27 | **51.7%** | 13.6 | 50.7 s | 61.5 s |

Each cross-tier pairing played from both seat orders, 1200 matches:

| | Stronger tier | Weaker tier | Draws |
|---|---|---|---|
| normal v easy | **100.0%** | 0.0% | 0.0% |
| hard v easy | **100.0%** | 0.0% | 0.0% |
| hard v normal | **100.0%** | 0.0% | 0.0% |

### The cross-tier ladder is completely saturated, and that is a finding rather than a result

Not one cross-tier match out of 3600 went the wrong way. Hunted harder — 2000 seeds per
order on the two narrowest gaps, seeds 80000–81999 — it does not budge:

| | Stronger tier | Reversals | Draws |
|---|---|---|---|
| normal v hard | 2000/2000 (100.00%) | **0** | 0 |
| hard v normal | 2000/2000 (100.00%) | **0** | 0 |
| easy v normal | 2000/2000 (100.00%) | **0** | 0 |
| normal v easy | 2000/2000 (100.00%) | **0** | 0 |

**8000 cross-tier matches, zero reversals.** This is a property of the format rather than of
the tuning, and the solo table above says why: a race to seventy is the sum of a dozen or
more independent arrows, so the law of large numbers does the deciding. `normal` needs 19.0
arrows with a standard deviation of 0.9 and `hard` needs 13.9 with 0.8; the gap is 5.1
against a combined spread of 1.2, which is **4.2 standard deviations**. `easy` against
`normal` is 8.1 against 1.7, which is **4.9**. At those separations a reversal is on the
order of one match in a hundred thousand, and 8000 is not enough matches to see one.

Reported plainly rather than tuned away, because the tiers are not there to play each other
— `modes` is `friend` and `bot`, so two bots only ever meet in this table. What a tier is
for is to be an opponent for a person, and **against a person the ladder is the right
shape**. A free search over every target and 255 flight times finds a best arrow worth
**6.98** targets on average (max 8 of the 20), so a player who found the perfect arrow every
time would reach seventy in about 10 arrows against `hard`'s 13.9 — `hard` is beatable by
good play and not by luck. `normal` at 3.77 an arrow asks a player to find the two-target
line at all, and `easy` at 2.62 is beaten by anyone who works out that the draw picks the
row. If the tiers ever do need to meet each other, the lever is the **format** — a shorter
race, or a per-round scoring rule — and not the profiles.

### Seat balance — 2000 seeded matches a tier

p1 leads the even rounds, so a bias here would be a real advantage:

| Tier | p1 | p2 | draws | p1 share of decided | Draw rate | Longest |
|---|---|---|---|---|---|---|
| easy | 1002 | 933 | 65 | **51.8%** | 3.3% | 116.5 s |
| normal | 973 | 980 | 47 | **49.8%** | 2.4% | 80.7 s |
| hard | 933 | 991 | 76 | **48.5%** | 3.8% | 60.1 s |

All three inside 47–53%, and the furthest from an even split sits about 1.6 standard errors
from it. That is what a field symmetric about the bow, shot at from a point on its mirror
line, with an alternating lead and a race that is only ever decided at a round boundary,
ought to give.

### Cost

The search happens on the single step a turn where the bot plans, never per step, and it is
bounded by construction: `scan × times` ≤ 20 × 5 = 100 candidates, each judged at 200 Hz
over a flight the bow caps at 1.15 s. Measured over 20 matches of `hard` v `hard`, 55 778
steps:
worst step **3.21 ms** on a machine calibrating at 25.0 ms against `bot-cost`'s 17.5 ms
reference — about 2.2 ms scaled to the reference machine, against a 22 ms calibrated
ceiling. Zero steps exceeded a 16.7 ms frame. `bot-cost.test.ts` re-measures it on every
run and passes.

## Presentations

Per `docs/presentation.md`, and the game decides nothing here.

**Shared-screen.** One board, shared, making a half-turn to face whoever is to shoot, driven
by the engine's `SeatFlip` from `seatView(active, presentation, localSeat)`. The turn puts
the gallery at the far end and the bow at the near edge for the seat that has the shot.
Input is refused, the shot clock stopped and the gallery frozen for the 0.36 s it takes.

**Single-seat.** `seatView` reports no rotation, so the local player always reads the field
upright with the whole board as their pointer surface. A test asserts the board never turns
at all in single-seat play.

A pointer is converted through `toWorld` with the flip's current orientation, so seat two's
finger arriving mirrored means the same thing as seat one's. A test puts the same finger
down for both seats, one of them upside down, and asserts the same aim comes out.

## Rule 7: colour is never the only signal

**Seat one is a disc and seat two a square, everywhere a seat owns something** — the hand on
the aiming pad, the arrow nocked on the string, the arrow in the air, and the two
scorecards. `#seatMark` is the single place that decision lives, so the two marks that
*move* — the nocked arrow and the arrow in flight — carry it too, which matters because the
arrow is exactly what a player is watching. A test drives a shot for each seat and asserts
p1's hand is a 15-radius disc at the right point and p2's is a 28-wide box at the right
point, and that p2's is *not* also drawn as a disc.

Everything else on the board reads in greyscale as well:

- **A standing target is a filled face with a rim and a cross through the middle; a burst
  one is an open ring with a diagonal slash and no cross.** The two read apart with no
  colour at all, which is what a player is counting. A test asserts exactly twenty filled
  faces are drawn and no more.
- **Each row stands on its own post line**, so the four rows read as four racks in a field
  rather than as targets floating in the air.
- **The two gauges stand at opposite edges of the field** — the shot clock down the left,
  the draw down the right — so which is which is a position rather than a hue. The draw
  gauge also prints the launch speed as a number.
- **The aiming pad writes its own axes**, `AIM` across the top and `DRAW` at the foot, with
  a line down its centre.
- **Each card prints its count as `n/70`, a filled bar, `BEST xN` and `ARROWS n`**, and the
  board prints `RACE TO 70` between them, so the race and the tie-break are both legible as
  text and not only as a colour-coded bar.
- **The reach line** — a dashed line across the gallery at the height this draw tops out —
  is the one readout that makes the draw legible, and it is honest: it is a function of the
  player's own bow and of nothing on the field, so it says how far the arrow can reach and
  never where it will land. It is labelled `REACH`.
- **Whose turn it is** is carried by the board's rotation, by the hand mark's shape, by the
  nocked arrow's shape and by the reach line's colour — four signals, and three of them are
  not colour.

## Corrections made while writing this

Only comments; no behaviour changed, and all 201 tests pass unmodified.

- **The round cap's own arithmetic was wrong.** Its doc comment multiplied out the worst
  case with a 0.3 s settle and got 382.3 s; `SETTLE_SECONDS` is 0.2 and the assertion in
  `rules.test.ts` pins 375.1. Corrected to agree with the code and with the test.
- **Two different stale figures for how fast a tier reaches seventy** — 26.6 / 17.3 rounds
  in `rules.ts` and 25.5 / 12.6 in `rules.test.ts`. Both replaced with the measured 27.1
  and 13.9, and the cap's headroom with the 33% that follows.
- **The rack is twenty targets, not twelve.** Five comments across `game.ts` and `rules.ts`
  still described a 3 × 4 rack, including the insertion sort's bound and the post lines'
  "three racks". The tests already said twenty.
- **The per-sample target drift is 0.11 units, not 0.22.** `DRIFT_MAX × RATE_MAX /
  RESOLVE_HZ` = 34 × 1.95 / 600. The assertion it supports (`< 0.25`) was never in danger.

## What is not specified here

- **#725** — original art and the audio events. Everything on screen is drawn from
  primitives and no sound is wired in.
- **#2013** — correctness from 320 px to 4K in both orientations.
- **#2014, #2015** — the single-seat and cross-device wiring beyond what the game already
  does through `seatView` and `toWorld`.
- **#2016** — the fairness audit across devices and input families. The precision envelope
  is the engine's and `control-parity.test.ts` guards key-versus-thumb parity, but neither
  is the audit.
- **Reduced motion.** The 0.36 s seat flip is the only motion the game adds beyond the
  simulation; how it answers `prefers-reduced-motion` is the shell's decision.
- **Whether `roundSeconds: 90` should track the measurement.** Bot matches run 50.7 s at
  `hard` to 100.1 s at `easy`, and two idle humans take 309 s; a deliberate pair of humans
  lands near the advertised figure. Whether the catalogue card should say so is a catalogue
  question rather than a game one.
