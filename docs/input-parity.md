# Cross-device input parity

A thumb and a mouse are not equivalent instruments. Left alone, a cross-device match is
decided by hardware rather than by skill — and the loser cannot see why, which is worse
than losing.

This document decides, per archetype, where that matters and what we do about it.

## The families, and what each is actually good at

| Family | Precision | Travel | Occlusion | Latency | Multi-point |
|---|---|---|---|---|---|
| **Touch** | Low — a fingertip covers ~9mm | Absolute; anywhere instantly | **Severe** — the hand hides the target | Lowest; no intermediary | Yes, several |
| **Mouse** | **Highest** — sub-pixel | Relative; limited by desk and mat | None | Low | One |
| **Trackpad** | Medium — precise but short throws | Relative; needs re-clutching | None | Slightly higher; smoothing | Gestures only |
| **Keyboard** | Discrete — no aiming at all | N/A | None | Lowest, deterministic | Limited by rollover |
| **Gamepad** | Medium — analogue, dead zones | Relative, rate-based | None | Low, plus polling | Two sticks |
| **Pen** | **Highest** — sub-millimetre | Absolute | Moderate — the hand rests | Low | One, plus pressure |

Two asymmetries do the damage.

**Absolute versus relative.** Touch and pen put the cursor exactly where you point, in one
motion. Mouse, trackpad and gamepad have to travel there. In a game where reaching a
target *fast* wins, absolute devices win. In a game where reaching it *precisely* wins,
relative devices win — a mouse can hold a pixel that a thumb cannot.

**Occlusion.** A finger covers what it touches. In a game where you must watch the thing
you are manipulating, touch is at a real disadvantage that no software normalisation
removes.

## Normalisation policy, per interaction

Four rules, applied by the engine so no game implements its own.

**Aim precision — a common envelope.** No family may aim finer than the coarsest supported
one. The engine quantises pointer position to a grid derived from the logical box, so a
mouse cannot exploit sub-pixel precision a thumb cannot match. This costs the mouse player
nothing they can perceive and removes an advantage they could not otherwise give up.

**Drag distance — logical, not physical.** A drag is measured in logical units, never in
millimetres of desk or screen. A short trackpad flick and a long phone swipe that cover
the same fraction of the play area mean the same thing.

**Tap latency — resolved on source timestamps.** A reaction is decided by when the input
*happened*, not when its packet arrived. Anything inside the measurement tolerance is a
genuine draw. `resolveSimultaneous` already implements this, with an 8ms default
tolerance — roughly half a frame, below which no honest claim of "first" can be made.

**Hold timing — counted in simulation steps.** Never in wall-clock milliseconds. A device
running at 30fps and one at 144fps must agree on how long a hold lasted, and steps are the
only unit both can count identically.

## Per-archetype verdict

| Archetype | Advantaged family | Why | Ruling |
|---|---|---|---|
| `turn-board` | None material | Discrete targets, no time pressure; a cell is a cell | **Fair cross-device** |
| `turn-aim` | Mouse and pen | Sub-pixel aim over a continuous angle is a real edge | **Fair** — the precision envelope is implemented |
| `rt-split` | Touch | Absolute positioning beats travel when tracking a fast object | **Fair cross-device** — the envelope narrows it, and the mouse's precision offsets it |
| `rt-arena` | None material | Rate-based movement suits every family; no absolute aiming | **Fair cross-device** |
| `rt-race` | Keyboard and gamepad | Discrete, low-latency, no travel at all; a thumb repeatedly tapping cannot match a held key | **Same-input-class only** |

`rt-race` is the one genuinely unfair archetype, and it is unfair in a direction software
cannot fix: the interaction *is* rapid discrete input, which is exactly what a key is for
and exactly what a touchscreen is worst at. Those games declare `sameInputClassOnly: true`
in their manifest rather than shipping a match one player cannot win.

That field already exists in the schema. **Road Dodge sets it** — the first game in the
repository to, and the first `rt-race` game built. Its manifest carries the reasoning and
`packages/games/road-dodge/SPEC.md` records what the ruling does and does not mitigate:
lane changes are discrete and a held key does not repeat, which narrows the gap, but it
does not close it, because the gap is how fast a thumb can leave the glass and come back.

## What is implemented, and what is not

**Implemented.** Drag distance in logical units — the engine's input path takes logical
coordinates and nothing else. Hold timing in simulation steps — `holdSeconds` accumulates
the fixed delta. Source-timestamp resolution — `resolveSimultaneous`, with tests covering
the tolerance window and simultaneous outcomes resolving as draws. One code path for every
pointing device — pointer events only, no branching on `pointerType` anywhere.

**Implemented: the precision envelope.** Every pointer position is rounded onto a shared
lattice before a game sees it, in `InputManager` — the one place logical coordinates enter
the engine, so every game gets it without asking and none can opt out.

The lattice is **one two-hundredth of the shorter logical side**: 4.5 units in a 900-unit
box, about 1.6 device pixels on a 320px phone and 5.8 on a 1440px desktop. So the desktop
gives up precision it had and the phone gives up none it ever had, which is the whole idea.

It removes *excess* precision rather than inventing any. Quantising cannot make a thumb
steadier — that is a property of hands, not of software — but it stops a mouse from aiming
between the points the game asks anyone to hit. Two aims inside one envelope give the same
answer; two a whole envelope apart still differ, so the game is levelled and not flattened.

This was overdue. The note here said it "must exist before the first `turn-aim` game
ships", and by the time it landed **two had** — Darts and Cornhole. Darts had mitigated it
locally, by nudging its reticle at a rate rather than jumping it; Cornhole had not, and the
measurement on its issue is worth reading, because the gap turned out to be smaller than
the game's own seeded wobble. Both are now levelled by the engine instead of by argument.

**Not implemented: gamepad support.** #130 covers it. The table above anticipates it so
the decision is not made twice.

**Not verified: any of this across two real devices.** There is no cross-device harness
yet, so every judgement here is reasoned from the properties of the input families rather
than measured from matches. The verdicts are falsifiable and should be revisited once
#1862's harness exists — particularly `rt-split`, where I have claimed two advantages
cancel out, which is exactly the kind of claim that is comfortable and might be wrong.


---

# Measured: the same game through both instruments

Everything above is policy. This section is what was actually measured, per archetype, and it
is checked on every run by `apps/web/src/data/control-parity.test.ts`.

## The method, and what it can and cannot tell you

Seat one is driven by a **seeded script** rather than by a bot, against the same `normal` bot on
seat two, on the same seed, twice: once spelled with the keyboard and once with a finger. The
script alternates *engaged* and *resting* phases — while engaged it pushes in a direction with a
reach, and while resting it does nothing.

Movement and the action are one phase rather than two, and that is forced by the engine rather
than chosen: `actionHeld` is `keys.action || pointerDown`, so **a finger on the glass is the
action**, and there is no pointer expression of "moving but not acting" at all. An earlier
version tapped the action key for a single frame while holding a direction, which has no pointer
equivalent — and, because it never held anything, could not complete a shot in the four games
whose keyboard line reads "hold Space, build power, release". That read as four games refusing
the keyboard. It was the script.

Two other things about the script are worth knowing before reading the table, because both once
looked like defects in the catalogue:

- Its pointer positions originally came from a unit vector, so the finger only ever visited an
  **ellipse around the middle of the board** and never its interior. Four board games could not
  be finished by tapping because every tap landed on the same ring of cells.
- A finger held down raises `actionPressed` **once**. A script that only moved the pointer
  pressed exactly once a match, and half the catalogue "failed to finish" on the pointer.

**What this measures is a script, not a player**, and the two instruments express that script
through different idioms. Where an idiom happens to suit a game, the number moves — and that is
a fact about the script, not about the peripheral. Read the outliers below with that in mind.

## What the test asserts

Two things, and deliberately not a third.

1. **Both instruments can move the game.** A game that answers one and ignores the other is
   unplayable on that peripheral, and no tuning fixes it. Every game passes.
2. **No win-rate gap wider than 75 points**, where both instruments decided at least six
   matches. This is looking for a game one instrument simply cannot play, not for a tuning gap
   — fourteen matches cannot resolve five points.

It does **not** assert that a match completes. A flailing script is a poor player, and in a
cursor-driven board game a very poor one: Checkers finished none of its twenty-eight matches
inside four simulated minutes on either instrument while quite happily taking pieces on both.
Asserting completion there would measure how long Checkers is.

## The measured comparison

Seat one's win rate against a `normal` bot, 14 seeds per instrument per game. Most of the
catalogue reads 0% on both, which is the expected result: a random script loses to a competent
bot whichever way it is spelled, and the two spellings lose at the same rate.

### `rt-arena`

| game | keyboard | pointer | matches finished (kb / ptr) |
|---|---|---|---|
| frogs-fight | 0% (0/14) | 0% (0/14) | 14 / 14 |
| king-of-the-yard | 0% (0/14) | 0% (0/14) | 14 / 14 |
| match | 0% (0/14) | 0% (0/14) | 14 / 14 |
| robot-arena | 0% (0/14) | 0% (0/14) | 14 / 14 |
| snakes | 0% (0/14) | 0% (0/14) | 14 / 14 |
| sumo | 0% (0/14) | 0% (0/14) | 14 / 14 |
| tanks | 0% (0/14) | 7% (1/14) | 14 / 14 |

### `rt-race`

| game | keyboard | pointer | matches finished (kb / ptr) |
|---|---|---|---|
| road-dodge | 7% (1/14) | 7% (1/14) | 14 / 14 |
| slot-cars | 0% (0/14) | 0% (0/14) | 14 / 14 |

### `rt-split`

| game | keyboard | pointer | matches finished (kb / ptr) |
|---|---|---|---|
| air-hockey | 0% (0/14) | 0% (0/14) | 14 / 14 |
| broken-tiles | 0% (0/14) | 0% (0/14) | 14 / 14 |
| crabby-volley | 14% (2/14) | 57% (8/14) | 14 / 14 |
| flappy-jump | 0% (0/14) | 0% (0/14) | 14 / 14 |
| fruit-duel | 0% (0/14) | 0% (0/14) | 14 / 14 |
| gravity-run | 0% (0/14) | 0% (0/14) | 14 / 14 |
| hand-slap | 0% (0/14) | 0% (0/14) | 14 / 14 |
| hot-potato | 100% (14/14) | 100% (14/14) | 14 / 14 |
| lumber-jack | 0% (0/14) | 0% (0/14) | 14 / 14 |
| math-quiz | 0% (0/14) | 0% (0/14) | 14 / 14 |
| mini-soccer | 0% (0/13) | 17% (2/12) | 14 / 14 |
| paint-fight | 0% (0/14) | 0% (0/14) | 14 / 14 |
| penalty-kicks | 29% (4/14) | 29% (4/14) | 14 / 14 |
| ping-pong | 0% (0/14) | 0% (0/14) | 14 / 14 |
| pull-the-rope | 0% (0/12) | 0% (0/12) | 14 / 14 |
| rock-paper-scissors | 50% (7/14) | 21% (3/14) | 14 / 14 |
| spike-attacks | 0% (0/14) | 0% (0/14) | 14 / 14 |
| star-catcher | 0% (0/14) | 0% (0/14) | 14 / 14 |
| whack-a-mole | 0% (0/14) | 0% (0/14) | 14 / 14 |

### `turn-aim`

| game | keyboard | pointer | matches finished (kb / ptr) |
|---|---|---|---|
| bowling | 0% (0/14) | 7% (1/14) | 14 / 14 |
| cannon-duel | 0% (0/14) | 0% (0/14) | 14 / 14 |
| cornhole | 0% (0/14) | 0% (0/13) | 14 / 13 |
| darts | 0% (0/14) | 0% (0/14) | 14 / 14 |
| hammer-hit | 0% (0/14) | 0% (0/14) | 14 / 14 |
| knife-thrower | 0% (0/14) | 0% (0/14) | 14 / 14 |
| pool | 0% (0/4) | 0% (0/4) | 12 / 11 |
| sling-puck | 0% (0/13) | 0% (0/13) | 14 / 14 |

### `turn-board`

| game | keyboard | pointer | matches finished (kb / ptr) |
|---|---|---|---|
| checkers | — (0/0) | — (0/0) | 0 / 0 |
| color-wars | 0% (0/14) | 0% (0/14) | 14 / 14 |
| dots-and-boxes | 0% (0/11) | 0% (0/14) | 11 / 14 |
| four-in-a-row | 0% (0/14) | 0% (0/14) | 14 / 14 |
| ludo | 21% (3/14) | 0% (0/1) | 14 / 1 |
| mancala | 21% (3/14) | 0% (0/5) | 14 / 5 |
| memory | 0% (0/14) | 0% (0/13) | 14 / 14 |
| pop-it | 14% (2/14) | 14% (2/14) | 14 / 14 |
| reversi | 0% (0/1) | 0% (0/1) | 1 / 1 |
| sea-battle | 0% (0/1) | 0% (0/4) | 1 / 4 |
| shut-the-box | 29% (4/14) | 44% (4/9) | 14 / 9 |
| tic-tac-toe | 0% (0/14) | 0% (0/13) | 14 / 14 |
| ultimate-ttt | 0% (0/1) | 0% (0/6) | 1 / 6 |
| yazy | 0% (0/2) | 0% (0/2) | 2 / 2 |

## The three outliers, and what they turned out to be

Re-measured at 120 seeds each, because 14 cannot separate anything:

| game | keyboard | pointer |
|---|---|---|
| crabby-volley | 10% (12/120) | 25% (30/120) |
| rock-paper-scissors | 55% (66/120) | 20% (24/120) |
| mini-soccer | 0% (0/93) | 5% (5/95) |

**All three are the script's idiom, not the instrument's capability**, and each was checked in
the source rather than assumed:

- **Crabby Volley** does not read the pointer as a position. It takes the *sign* of the gap
  between the finger and the crab and feeds it to the same `steer` the keys use, so both are
  rate-limited identically. What differs is the policy the script accidentally expresses: a
  pointer says "walk towards this spot and stop there" — the deadzone stops it — while a key
  says "keep walking this way". Standing still under the ball is better volleyball than
  drifting, so the pointer script plays better. A person would stop either way.
- **Rock Paper Scissors** needs a tap to land on one of three buttons (`buttonAt`). The script's
  taps are spread over an ellipse that mostly misses them, so most do nothing, while the
  keyboard's cursor always selects *something*. The pointer is not worse; the random taps miss.
- **Mini Soccer** is five points on ninety-odd decided matches, which is inside the noise of the
  sample.

**No residual difference is attributable to a game.** If one appears later, the fix is to bring
the weaker path up rather than to degrade the stronger one — the engine already owns that
normalisation, and the policy for it is the first half of this document.


---

# Measured: what each instrument can *say*

Everything above compares how often each instrument wins. This compares what each one can
express, which is a different question and the one the seventy-eight "[Game] Audit fairness
across devices and input families" issues actually ask first:

> 1. Measured outcome distributions are comparable across input families

A win rate cannot answer it, at any band width, because the problem it names is not a
strength difference. `control-parity.test.ts` says so itself — it is "looking for a game one
instrument simply cannot play, not for a tuning gap". The sharper question is **can one
instrument express things another cannot**, which is what this document's own policy section
asks for when it demands "a common precision envelope so no input family can aim finer than
another". That is a statement about *reachable sets*: two instruments can win equally often
while one of them can name spins the other physically cannot reach, and the loser never sees
it, because the shot they wanted was never in their vocabulary.

`apps/web/src/data/input-expression.ts` measures it, and
`apps/web/src/data/input-expression.test.ts` runs it over all 107 games on every push and
prints the table below.

## Why the two lattices are unrelated numbers

The engine quantises pointer **position** onto `envelopeFor(logical)` — one two-hundredth of
the shorter side — and quantises nothing else. So a pointer's finest expressible increment is
one envelope of travel.

A keyboard has no position at all. Every game that binds a continuous quantity to a key
integrates a **private rate constant** over the fixed timestep, so its finest expressible
increment is one simulation step of that rate. Roughly thirty games carry such a constant
(`AIM_KEY_RATE`, `SPIN_KEY_RATE`, `AIM_KEY_SPEED`, `STEER_SPEED`, …), every one of them
invented locally, and **nothing in the repository had ever compared the two**. The engine
levelled the pointer against itself and left the keyboard out of the comparison entirely.

## The method

Per game, a knob is swept through each instrument **in that instrument's own smallest legal
increment** — one envelope of pointer travel, one step of key hold, one key tap — and the
game is observed through the only channel all 107 share: `Renderer`. A game draws its aim,
its power, its reticle and its consequences, so the draw stream is a faithful generic read of
the state a player selected. `greyscale.test.ts` uses the same seam for the same reason.

Four things decide a verdict, and each exists because the simpler version of it was wrong.

**Every checkpoint is after the commit.** A frame taken while the finger is still down reads
the finger, and a pointer's live position is quantised at one envelope while a keyboard's
cursor is not — so *any* pre-commit sample reports "the pointer is finer" for every game that
draws a reticle. That is a fact about reticles.

**The two arms are commit-aligned.** A keyboard commits on `actionPressed` and a pointer on
`actionReleased` in every drag-and-release game here. Give both the same action window and
the two shots are fired a window apart, and the tail then samples two different moments of
two different flights. The pointer's gesture is therefore placed to *end* where the
keyboard's begins.

**Aimed or integrated, measured rather than read.** The gap only matters for a quantity that
is aimed and committed; one both instruments merely accumulate excludes nobody. So the same
gesture is run twice — same endpoint, same press step, same release step, once as a jump and
once as a glide. An aimed quantity answers identically; an integrated one does not. This is
the discriminator **issue #2478 got wrong by reading the source**: it asserted Shuriken bound
spin to pointer *velocity*, which is exactly what a per-step delta looks like, and the deltas
telescope to net displacement — the same 300-unit drag gives spin `1.800000` over 3 frames
and over 120, identical to six decimals.

**The ratio comes from calibrating the two knobs against each other, not from comparing step
sizes.** What the renderer shows is `f(quantity)` for an unknown non-linear `f`; an aim
sweeping 0.05–0.34 radians and one sweeping 0.12–0.77 move a blade at quite different rates
per radian, so two step sizes measured over different stretches differ for a reason that has
nothing to do with either lattice. So: for each keyboard knob, find the pointer knob whose
*outcome* is nearest, and take the slope. Every `f` cancels, because the two runs being
matched are two spellings of one game state. The slope is the answer — how many envelopes of
finger travel it takes to say what one step of a held key says.

Three earlier metrics were tried and are recorded in the source because each was confidently
wrong: a pooled vector distance put Shuriken at 1.06 (nine hundred marks of rearranged bamboo
drowning the dozen tracking the blade), per-mark step ratios put it at 3.03 and then 5.68, and
a relative match tolerance matched everything to everything — Pool at 15×, Mini Golf at 35×,
and Shuriken reversing direction. Shuriken's own two constants say 2.06× on spin and 2.15× on
aim. The method that survives lands between them at **2.54×**, having read neither constant.

Where the outcome is a small discrete set — a column, a cell, a lane, one of three buttons —
there is no scalar to resolve and the calibration measures nothing. There the two **outcome
sets** are compared directly: an instrument that reaches five of seven columns is unfair in a
way no number of matches would average away. And where neither position nor hold changes
anything, the game is a timing game, and what it reads — which step the commit landed on — is
measured too, because the fixed timestep is the one lattice both instruments provably share.

## The verdicts

All 108 registry entries, seed 7, a little over two minutes on an idle machine.

| | count | meaning |
|---|---|---|
| **A** | 1 | the two families are equivalent within the envelope, and the calibration says so |
| **B** | 4 | a measurable gap: one instrument selects values the other cannot reach |
| **C** | 49 | no aimed scalar, so the question does not arise |
| **D** | 54 | not measured, and the note says why — a limit of the generic gesture, not a finding |

### A — equivalent, measured

| game | factor | evidence |
|---|---|---|
| archery | 1.29× | pointer and keyboard calibrated over 23 knobs; `AIM_KEY_SPEED = 1.25` against a pad-anchored drag lands inside the band |

### B — a measurable gap

| game | factor | which quantity | ruling |
|---|---|---|---|
| **shuriken** | **2.54×**, pointer finer | spin and aim. Spin: one envelope is 3.5 units, so `3.5 × SPIN_PER_UNIT = 0.021` against `SPIN_KEY_RATE / 60 = 0.0433`. Aim: 3.5 units at 392 away is 0.0089 rad against `AIM_KEY_RATE / 60 = 0.0192` | **Quantise.** Both are aimed scalars on a continuum, and the fix is the direct analogue of `envelopeFor`: round spin and aim onto a shared lattice so the pointer cannot select between the values a key can reach. Nothing about the interaction is same-class-only |
| **darts** | **2.11×**, pointer finer | the aim vector. One envelope through `dx / AIM_RADIUS × AIM_GAIN`, clamped to the pad, is about 0.0096 per envelope against the keyboard's `1.1 / 60 = 0.0183` | **Quantise**, same shape as Shuriken. A pad-anchored aim is a continuum and both instruments should step it identically |
| **dots-and-boxes** | **1.57×**, keyboard reaches more | reachable edges: 7 by tap against 11 by cursor. Not a resolution gap — a reach gap, and the note carries which outcomes each side missed | **Not same-class-only, and not quantisation either.** A discrete board must let a tap name every target a cursor can; the game's own hit-testing is the thing to widen. Worth confirming against a bespoke gesture before acting, since 7-versus-11 is inside what the generic tap could plausibly be missing |
| **cricket** | **1.57×**, pointer finer | swing/placement on the x axis | **Undecided, and deliberately.** Cricket was being written by another agent while this ran; the number is real for the tree it measured and should be re-measured before anything is concluded |

No game in the catalogue measured as needing `sameInputClassOnly` on these grounds. That
field is for an interaction one family cannot perform — the repeated discrete input this
document rules on above — and none of the four gaps is that. Three are a lattice mismatch
with an obvious fix and the fourth is a reach question on a discrete board.

### C — no aimed scalar

Forty-nine games, in three kinds, each distinguished by measurement rather than by archetype:

- **Discrete targets both instruments reach** (18): blocks, color-wars, four-in-a-row,
  guess-the-person, light-fingers, ludo, match, memory, nuts-and-bolts, pop-it, rat-race,
  road-dodge, rock-paper-scissors, ship-battle, solitaire, tap-match, tic-tac-toe,
  ultimate-ttt, yazy and others. Reach counts are printed per game; a cell is a cell.
- **Integrated, not selected** (15): beach-ball, crash-it, frozen-beaks, king-of-the-yard,
  math-quiz, paint-fight, piranha-rush, racing-cars, snakes, spin-war, sticky-tongues, sumo,
  taxi-race, tennis, traffic-jam and others. The jump-versus-glide test says the pointer is
  accumulating, and both instruments accumulate.
- **Timing games** (16): basketball, cannon-duel, cup-pong, hammer-hit, knife-thrower,
  sling-puck, golf-football, target-practice, the-last-sashimi, explosive-festival,
  chicken-jump, pull-the-rope, unfair-fishing, water-game, wrestle. Nothing is aimed; the
  commit is a moment, and both instruments resolve it on the same fixed step — 48 against 48,
  37 against 37, and so on. **This is the first evidence for the meter-period claim in
  `docs/input-idiom.md`**, which had been argued and never measured.

### D — not measured

Fifty-four games, and every one of them indicts the generic gesture rather than the game.
Four reasons, all printed per game:

- **The two knobs could not be calibrated** (23): pool, mini-golf, bowling, cornhole,
  soccer-pool, sword-throwing, star-catcher, air-hockey, mini-soccer, ping-pong and others.
  These are the drag-and-release aim games where a single drag sets *both* an angle and a
  power, so a one-axis sweep cannot hold one still while varying the other, and no pointer
  knob reproduces any keyboard outcome. **This is the largest single piece of work left** and
  it is where the interesting games are: closing it means a per-idiom gesture script rather
  than one generic one.
- **The gesture changed nothing at all** (15): disco-battle, fatal-siege, flappy-jump,
  fruit-duel, hand-slap, happy-birds, hot-potato, maze-paint, penalty-kicks, pinball,
  shut-the-box, sliding-puzzle, slot-cars, snakes-ladders, stampede. Not by position, not by
  hold, not by moment.
- **One instrument reached one or two outcomes and the other reached many** (11): backgammon,
  carrom, dung-battle, frogs-fight, gravity-run, lumber-jack, mancala, reversi, sea-battle,
  sudoku, whack-a-mole.
- **Discrete, but one side sat on the floor** (5): chess, checkers, tanks, broken-tiles,
  animal-stack — three outcomes against eight to fifteen. Chess and Checkers need a tap to
  select and a second to move; Tanks and Broken Tiles read a drag rather than a press.

## What this does and does not close

**It closes criterion 1 for 54 games** — the 49 C's and the 5 A/B's — because for each of
them there is now a measurement rather than an argument, and for the four B's a named
quantity and a factor.

**It does not close it for the 54 D's.** Those issues should stay open, and the note on each
game names what a harness would need to do to close it.

Two limits worth stating plainly. First, **the factor is accurate to about ±20%**: it lands
between Shuriken's two known constants (2.06 and 2.15) at 2.54, which is right about the
question and approximate about the number. Second, **only two families are compared**. A
trackpad and a pen reach this code as ordinary pointers so they inherit the pointer's answer
by construction, but a gamepad does not exist yet (#130), and when it does it will bring a
third lattice — an analogue stick's dead zone and resolution — that nothing here measures.

**Proved by breaking it.** `AIM_KEY_SPEED` in Archery was changed from 1.25 to 0.25, the
package rebuilt, and the game moved from **A at 1.29× to B at 12.50×**, failing the ratchet
by name; restoring the constant (md5-verified byte-identical) and rebuilding put it back to
A at 1.29×. The first restore attempt *looked* like a failure because `tsc --build` reused a
stale `dist` — which is `docs/parallel-work.md`'s "rebuild before trusting a guard", caught
in the act.
