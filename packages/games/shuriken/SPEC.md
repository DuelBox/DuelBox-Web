# Shuriken — specification

**Archetype:** `turn-aim` · **Category:** Shooter · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions rather
> than the observed rule. Every number below was read out of `src/rules.ts` and
> `src/game.ts`, or measured against the compiled `dist/` with throwaway harnesses — the
> measurements say how many seeds and what was driven, so any of them can be re-run.

A grove of bamboo stands between two players, six canes each, mirror-symmetric about the
centre line. On your turn you take a shuriken from the hand at the near edge, point it, put
spin on it and let go. It flies a curve at constant speed, cuts every cane it passes
through — including your own — and stops dead against a stone. Cut all six of your
opponent's canes and the match is yours, but only once you have both thrown the same number
of times.

## Observed rules

From the reference genre, verbatim from `docs/observed-rules.md`:

> _"Cut the bamboo canes of your opponent! Grab the shuriken and throw it! Move your finger
> to add spin to your shot."_

That fixes four things and leaves everything else open: the target is the opponent's canes,
the object is grabbed and thrown, the finger's movement is the spin, and spin is a control
of its own rather than a consequence of the throw. It says nothing about how many canes,
what the blade does to a cane it meets, what stops a throw, what stands in the way, whose
canes may be cut, or how a match ends. All of those are **[ours]**.

## The throw is two numbers, and the second one is spin **[ours]**

A throw is an **aim** in radians from straight up the board, and a **spin** in radians a
second of turn applied to the flight path. Speed is constant and cannot be chosen; there is
no power meter. Two numbers, because the observed rule names exactly two things a player
does — point it, and move the finger for spin — and because two is what the geometry needs:
a straight throw is a ray and cannot reach behind a stone, and a curve with one parameter
can.

Constant speed plus a constant turn rate makes the path a **circle** of radius
`SHURIKEN_SPEED / spin`, and `advanceArc` writes out the closed form of that integral rather
than integrating a step at a time:

```
end     = heading + spin · t
radius  = speed / spin
x      += radius · (cos heading − cos end)
y      += radius · (sin heading − sin end)
```

This is not fussiness. Euler integration lands a curved throw somewhere else at 120 Hz than
at 60 Hz, and CLAUDE.md rule 8 says a phone and a laptop step the identical match. Splitting
a step in two and taking both halves gives the same answer to the last bit as taking it
whole, which is what the `lands in the same place whether the step is whole or halved` test
asserts. It also makes mirroring exact: negating both heading and spin negates `dx` and
leaves `dy` alone, so p2's throw is p1's throw reflected — asserted to nine decimal places.

**Cutting is a sweep, not a landing.** The blade does not stop at bamboo; one throw can take
several canes, and can take one of yours on the way through. That is the whole risk of a
heavy spin, and it is what makes the far stone worth going round rather than merely
possible to go round.

**A stone stops the blade dead** where it stands. Nothing behind a stone is cut by a throw
that hits it, which is what makes the stones an obstacle course instead of decoration.

## The grove

| | Value | Why |
|---|---|---|
| Board | 700 × 1000, portrait | |
| Hand | (350, 892) | On the mirror line, so neither seat throws from a better place |
| Blade | radius 10, 820 units/s, constant | Crosses the board end to end in 1.2 s |
| Aim cone | ±0.95 rad | Wide enough to reach either edge, not enough to throw sideways |
| Spin | ±1.9 rad/s | Turn radius 432 units, a little under half the board |
| Flight limit | 2 s | 1640 units: longer than any path across the board |
| Out of bounds | 40 units past the edge | |
| Cane | radius 21, six a seat | Capture reach 31 with the blade |
| Cane slots | dx 92/176/258/100/182/262, y 300/246/330/432/512/424 | Half a grove; the other half is this one mirrored |
| Slot jitter | ±22 in x, ±26 in y | The same nudge applied to both seats' canes |
| Stones | (350, 470) r46, (182, 636) r44, (518, 636) r44 | One on the mirror line, two a mirrored pair |
| Settle | 0.55 s | The grove is held after a throw before the board turns |
| Throw cap | 44, both seats together | The structural end — see Termination |
| Flight substeps | 4 per fixed step | 3.4 units a sample against a 31-unit capture |
| Blade spin | 21 rad/s | Cosmetic, but stepped, so a replay is exact |

**Only half a grove is written down.** `HALF_SLOTS` holds six offsets from the centre line
and `dressGrove` plants each one at `CENTRE_X ± dx` with **the same jitter draw applied to
both seats**. A grove jittered independently would hand one player an easier six than the
other, which over a match is exactly the sort of bias nobody notices and everybody feels.

**Four substeps, and the reason is arithmetic.** At 820 units a second a 60 Hz step covers
13.7 units, and a cane plus a blade is 31 across — a whole-step test is already marginal and
a slower step would tunnel straight through the bamboo. Four slices put every sample 3.4
units apart. The substep count is a constant, not a function of the frame, so the sampling
grid is the same on every device.

### Spin is compulsory, and the amount is measured

Swept over **200 seeded groves** at a 400 × 200 grid of aims and spins, with each cane
isolated so only that cane could be cut, the minimum `|spin|` needed to cut it:

| slot | dx | min | median | max | share needing more than 0.3 |
|---|---|---|---|---|---|
| 0 | 92 | 0 | 0 | 0 | 0% |
| 1 | 176 | 0 | 0 | 0 | 0% |
| 2 | 258 | 0 | 0 | 0.133 | 0% |
| 3 | 100 | 0 | 0 | 0 | 0% |
| 4 | 182 | 0 | 0 | 0.532 | 5% |
| 5 | 262 | **0.038** | **0.342** | **0.760** | 61% |

Slot 5 sits in the far stone's shadow in **every one of the 200 groves** and can never be
cut by a straight throw; slots 2 and 4 need a touch of spin on 18% and 20% of groves; the
other three never do. So **no grove can be cleared without at least one spun throw**, and
**no grove is ever unwinnable**: every cane was reachable in every grove, and the hardest
cane in the hardest grove measured wants 0.76 rad/s of the 1.9 available.

An earlier draft of the comment on `ROCKS` claimed three canes a seat were unreachable
straight. That was wrong, and it is the reason this table exists rather than a sentence.

## Scoring and the win condition

The score **is** canes still standing — the tally, the health bar and the thing drawn on the
board, all one number. Resolved by the shared `reduce-to-zero` helper over
`{ p1: standingFor('p1'), p2: standingFor('p2') }`, never by a comparison written here, with
`timeExpired` set once `throws >= MAX_THROWS`. Two seats cleared together are a draw, which
`reduce-to-zero` decides once, the same way, for every game that uses it.

After a throw the grove is held for `SETTLE_SECONDS` and then passes to the other seat, whose
aim and spin both start from zero. Carrying an aim over would mean the second thrower
inherits a sight the first one set.

**A match ends only on a completed round.** `handOver` refuses to look at the win condition
unless `p1Throws === p2Throws`. p1 throws first, so ending the instant a seat is cleared
would hand p1 every match that was going to be close; the reply throw is what turns the
first throw into an advantage of tempo rather than of a whole turn. The measured effect is
in the seat-balance table below: p1's share of decided matches is 50.6% / 47.6% / 48.3%.

Cutting your own last cane loses you the match **[ours]** — at the end of that round, like
any other clearance, so the opponent's reply throw can still clear their own six and draw.
It has to work that way: the blade does not know whose bamboo it is, so anything else would
be a special case in the middle of the flight.

## Termination

Structural, and it has to be — nothing in the shell ends a match. `roundSeconds` is
advertised on the catalogue card and ends nothing.

Two seats who never hit anything would otherwise throw for ever, and no amount of waiting
would change that: the grove does not decay, the blade always comes to rest — a stone,
the edge, or the 2 s flight limit, which is checked unconditionally on every substep and so
cannot be outlasted by any curve — and the turn always passes. So the cap is on **throws**: 44 between the two seats, 22 each, after which
`timeExpired` is set and the match settles on canes left standing. The `runs out of throws
even when nobody ever hits anything` test drives exactly that.

Twenty-two each is a little over twice what a `normal` bot needs, so the cap decides only
matches that deserve to be decided that way. Measured over 300 seeded matches a pairing:

| | reached the throw cap | longest match |
|---|---|---|
| easy v easy | 123/300 | 44 throws, 107 s |
| normal v normal | 0/300 | 28 throws, 65 s |
| hard v hard | 0/300 | 18 throws, 41 s |
| any cross-tier pairing | 0–3/300 | 44 throws, 101 s |

`easy` v `easy` reaching the cap 41% of the time is the cap doing its job, not a defect:
two bots cutting a quarter of a cane a throw genuinely are not going to clear six.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `A`/`D` aim, `W`/`S` spin, `Space` throws | `←`/`→` aim, `↑`/`↓` spin, `Enter` throws |
| Pointer | press, drag to point, sweep sideways for spin, lift to throw | the same, read through the half-turn |

Both, always, with no mode to switch between them, and only on your own turn: `#takeThrow`
reads `input.seat(state.active)` and nothing else, so the other half of the keyboard does
nothing at all until the board comes round. The manifest string says so, and a test asserts
the string says so.

The two instruments meet in the middle rather than one being finer than the other. A finger
names an angle directly, through `aimTowards`; the keys **walk** to it at
`AIM_KEY_RATE = 1.15 rad/s`, so the centre of the cone to either
±0.95 limit is 0.83 s of holding a key, and nothing to full spin is 0.73 s at
`SPIN_KEY_RATE = 2.6 rad/s²`. A test drives both to the same
throw and asserts they agree; `control-parity` asserts the same thing for the catalogue.

**A finger commits on release and a key commits on press**, and which applies is decided by
how the throw was *aimed*, not by what is present on the step it is committed. On the step a
finger lifts the pointer is already gone, so asking "is there a pointer now" takes the
keyboard branch and the throw silently never happens. Darts shipped that bug past its unit
tests; `#pointerAiming` is the same fix, and it is cleared on every hand-over because a
fresh turn is a fresh instrument.

Spin from a sweep is `0.006` per logical unit of sideways travel, so a full hook wants about
317 units of drag — a bit under half the board width. A deliberate sweep spins the blade
fully and a small correction of the aim barely touches it. **The first step of a touch adds
none**, because a finger that has just arrived has not travelled yet.

## Edge cases

**Simultaneous input.** Only the active seat is read. The other seat's keys, pointer and
action are not polled at all, so two people pressing at once is the same as one.

**Input in the other seat's zone.** The engine owns this: a touch belongs to the seat it
started in, and in a turn game `GameHost` calls `setBoardSeat` so the whole surface belongs
to whoever is to throw. The game never reasons about zones.

**No input at all.** The match waits, for ever, and that is deliberate. A silent human
throws nothing and the turn never passes — the `leaves a seat with no bot alone` test pins
it down, and the platform's own `termination` guard says the same thing from the other side:
*"a human trace that stops pressing keys proves nothing about a game that needs input to
progress"*. A bot in one seat never plays the other's turn. The corollary caught a bad test
in this package: a bot in seat two cannot be shown to throw by stepping an idle input,
because it is never given a turn to throw on.

**Input during the half-turn.** Refused for a human, for the 0.36 s the flip takes: the
grove a player is reading is moving under them, and a tap would name a direction they did
not mean. **The bot does not consult the flip** — it is a presentation detail, and a bot
whose timing depended on it would play a different match on a shared screen than on two
phones. It costs nothing here, because there is no clock on a turn: the human loses 0.36 s
of aiming time out of an unlimited allowance, and every tier's think time (0.6 s at the
shortest) outlasts the flip anyway, so the board is always settled before a bot lets go.

**Boundaries.** Aim is clamped to ±0.95 and spin to ±1.9, however long a key is held or
however far off the board a finger goes; a finger exactly on the hand leaves the sight where
it was rather than snapping it; a finger behind the hand still cannot aim backwards, because
the clamp is applied to the angle rather than to the finger. Anything not finite is ignored
before it can reach the state.

**Stalemate.** The throw cap, above. There is no position from which a throw is impossible —
the hand is never blocked and the cone always contains legal throws — so the cap is about
two players who keep missing, not about a stuck board.

## Determinism

Trivially deterministic in the parts that usually need care, and deliberately so in the
parts that do not.

- **All randomness is seeded.** `context.rng` only, drawn in `resetState` (twelve values,
  two a slot) and in `planShot` (three a turn). No `Math.random()` anywhere; lint enforces
  it.
- **The bot draws exactly three values a turn whatever it decides**, before anything
  branches on them. A plan that drew a different number when it blundered would put two
  devices out of step on the first unlucky throw and every throw after it. A test compares
  the generator's saved state against a counted one.
- **No delay is counted in seconds of wall time.** Settle, think and flight are all
  counted down by the fixed delta.
- **The flight integral is analytic**, so it gives the same answer at any step size — see
  the throw model above. This is the one thing here that needed care.
- **The blade's cosmetic rotation is kept inside one turn** rather than accumulating, so a
  long match cannot drift into the range where a float can no longer tell two nearby angles
  apart.
- **Nothing allocates in `update`.** The step result, the bot's imagined arc, its candidate
  outcome, the pointer's world position and the sight's walking point are all preallocated.
  The bot's cut list is a 12-bit mask, which is also why the grove is capped at twelve canes.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and a game that
assumed seat one would leave that rotation reaching nothing (#2487). It is read in
`resetState`. Measured at 50 seeds x both opening seats on `normal`, equal tiers: seat one
takes **50.0%** of 86 decided matches, and 43 of the 50 seed pairs end differently when only
the opening seat changes.

## The bot

It reads cane positions, stone positions and the flight model. That is precisely what is
drawn on the screen in front of both players, and it is all it reads — no future, no
opponent's plan, no seed (CLAUDE.md rule 6). It uses the same `advanceArc`, the same slice
length and the same cane test the live flight uses, so what it pictures and what happens are
one calculation rather than two that drift; a test throws several hundred shots and asserts
the two agree exactly.

Once a turn it sweeps aims against spins, scores each imagined throw as
`enemy − own · caution − |spin| · 0.02`, keeps the best, then draws its error for the turn
and commits to throwing that, mistake and all.

**The sweep runs outward from the target side**, and that is fairness rather than detail.
Ties are everywhere here — most throws cut exactly one cane. Broken by candidate order, p1
would settle every tie towards one edge of its fan and p2 towards the other edge of *its
own*, which is not the same shot reflected. A test asserts p2's plan is p1's negated to nine
decimals, for every tier and ten groves.

**The error is drawn once a turn and then thrown with.** A fresh error every step averages to
zero sixty times a second and makes every tier identical — the mistake `bot-judgement` in the
SDK exists to document, made three times in this repository before it did. The error is
uniform and symmetric (`misjudgement`), and it is taken through the same mirror as the
sweep, so p2 with a given draw is the exact reflection of p1 with that draw.

| Tier | aims × spins | aim error | spin error | think | blunder | caution |
|---|---|---|---|---|---|---|
| easy | 9 × 5 = 45 | ±0.12 rad | ±0.55 rad/s | 1.05 s | 30% | 0.4 |
| normal | 13 × 7 = 91 | ±0.05 rad | ±0.24 rad/s | 0.80 s | 13% | 1.0 |
| hard | 19 × 9 = 171 | ±0.014 rad | ±0.06 rad/s | 0.60 s | 5% | 1.6 |

A blunder multiplies both errors by 3.5. `hard` blunders one throw in twenty and it has to:
given a grove it can solve exactly and an opponent solving it the same way, two `hard` bots
trade perfect throws and the match is decided by nothing at all.

**Where the ladder gets its room.** The quantity that decides everything is the aim error
against the **angular width of a cane seen from the hand**. Canes sit between about 400 and
700 units away (421–670 at the nominal slots, before jitter) with a 31-unit capture radius,
so a cane is 0.044–0.077 rad wide. The three tiers' aim errors
are 0.12, 0.05 and 0.014 — respectively about twice a cane, about one cane, and a fifth of
one. The ladder straddles the target rather than sitting inside it, which is why the tiers
separate at all; had the errors all been well under 0.044 the three tiers would have been
three spellings of "cannot miss", which is what happened to Cup Pong before its geometry
moved. Nothing here is quantised to the frame rate: aim and spin are continuous, and the
only lattice in the game is the 3.4-unit collision sample, an order of magnitude finer than
a cane.

### Measured: cut rate per throw

One tier playing both seats over 40 seeded groves, counted per throw rather than per match,
which is what the `cuts more of the other grove the harder the tier` test asserts the order
of:

| Tier | opponent's canes cut per throw | own canes cut per throw |
|---|---|---|
| easy | 0.256 | 0.017 |
| normal | 0.729 | 0.002 |
| hard | 1.272 | 0.000 |

`hard` averaging more than one cane a throw is the sweep paying off: it lines several canes
up on one arc, which is a throw a person can also find and mostly does not.

### Measured: win rates, 300 seeded matches per ordered pairing

Driven through the shipped `ShurikenGame` with an idle `InputManager`, both seats botted,
seeds 40000–40299, shared-screen. Every match finished; none hit the 600-second guard.

| pairing | p1 wins | p2 wins | draws | avg throws | avg match |
|---|---|---|---|---|---|
| easy v easy | 121 | 118 | 61 | 30.2 | 71 s |
| easy v normal | 24 | 271 | 5 | 15.6 | 37 s |
| easy v hard | 1 | 294 | 5 | 9.0 | 21 s |
| normal v easy | 273 | 20 | 7 | 16.0 | 37 s |
| normal v normal | 131 | 144 | 25 | 13.1 | 30 s |
| normal v hard | 18 | 253 | 29 | 8.9 | 20 s |
| hard v easy | 295 | 1 | 4 | 9.1 | 21 s |
| hard v normal | 249 | 18 | 33 | 9.0 | 20 s |
| hard v hard | 87 | 93 | 120 | 8.2 | 18 s |

Each pairing played in both seat orders, 600 matches:

| | stronger tier | weaker tier | draws |
|---|---|---|---|
| normal v easy | **90.7%** | 7.3% | 2.0% |
| hard v easy | **98.2%** | 0.3% | 1.5% |
| hard v normal | **83.7%** | 6.0% | 10.3% |

The ladder is strictly ordered and the gaps are wide, in win rate and in tempo alike: a tier
that cuts three times faster finishes in a third of the throws, so the three tiers differ in
how a match *feels* as well as in who wins it.

### Measured: seat balance

p1 throws first, so a bias here would be a real advantage:

| Tier | p1 | p2 | draws | p1 share of decided |
|---|---|---|---|---|
| easy | 121 | 118 | 61 | **50.6%** |
| normal | 131 | 144 | 25 | **47.6%** |
| hard | 87 | 93 | 120 | **48.3%** |

All three inside 47–53%, which is what a grove that is its own mirror, thrown at from a point
on the mirror line, by a search sweeping outward from each seat's own target side, ought to
give. The suite asserts the share stays between 25% and 75% over 30 matches a tier — a loose
bound deliberately, because 30 matches cannot support a tight one.

**Draws are a real result here, and they are two different results.** At `easy` they are the
throw cap expiring level: 123 of 300 matches reached it. At `hard` not one match reached the
cap, so all 120 draws are two bots clearing the same grove in the same round — the completed
round rule converting p1's tempo advantage into a shared result, which is precisely what it
is for. It is not a defect to fix, and it does not reach a player: `modes` is `friend` and
`bot`, so two bots only ever meet in this table.

### Measured: cost

The search happens on the one frame a turn when the think timer expires, never per step.
2.16 ms for `hard` on a development machine against a 16.7 ms frame; `bot-cost` re-measures
it against a calibrated ceiling and passes.

## Presentations

Per `docs/presentation.md`, and the game decides neither.

**Shared-screen.** One board, shared, rotating 180° to face whoever is to throw, driven by
`SeatFlip` from `seatView(active, presentation, localSeat)`. The grove is mirror-symmetric
and the hand is on the mirror line, so the half-turn puts everything exactly where the other
player needs it — that is what the whole layout is for.

**Single-seat.** No rotation at all: the local seat owns the viewport, always upright.

Rules and simulation are byte-identical across the two. A test drives the same seed through
both and compares the flight path to four decimals every step, because a divergence here is a
desynchronised remote match.

The shell owns the HUD, the countdown, the turn indicator and the result. The game draws no
text of its own — a second scoreboard disagreeing with the first is what that would be — and
a test renders a frame into a recording renderer and asserts its `text` method was never
called.

## Rule 7: colour is never the only signal

Every player-owned thing carries its seat in shape as well as colour, so the board reads in
greyscale:

- **p1 is round, p2 is square, everywhere.** A standing cane wears a round collar and round
  pip for p1, a square collar and square pip for p2. Two groves facing each other across a
  board that turns are the pair most likely to be confused.
- A **cut** cane is a dark stump with a slash through it whoever owned it — one slash for
  p1, a cross for p2 — so which six are yours is still legible after they have fallen.
- The **spin gauge** under the hand takes the active seat's own shape for its marker, so
  which way the blade will bend is never carried by colour.
- The **sight** is a line of dots along the first 0.34 s of the flight, growing along its
  length, and it **stops at stone**: a throw that cannot get out of the near lane says so
  before it is thrown rather than after. Enough to read the curve, not enough to aim for you.
- Throws left in the match are a bar across the foot, one object shared by both players.

## What is not specified here

- **Audio.** No sounds are specified or implemented. The SDK's audio layer is not wired in
  for this game.
- **Reduced motion.** The 0.36 s seat flip and the 0.4 s cut flash are the only motion the
  game adds beyond the simulation; how they respond to `prefers-reduced-motion` is the
  shell's decision and is not made here.
- **Tournament weighting.** `roundSeconds: 90` is what the catalogue advertises. Measured
  bot-versus-bot matches run 18 s at `hard` to 107 s in the longest `easy` match; a human
  taking their time is unbounded, since a turn has no clock. Whether the advertised figure
  should track the measurement is a catalogue question rather than a game one.
- **The far stone's shadow is one cane deep.** Spin is compulsory to win but is worth a
  single cane in most groves. Making it two or three would mean moving the outer stones or
  the outer slots, which would move the difficulty ladder with it and require re-measuring
  every table above. It was left alone because the ladder measures well as it stands.
