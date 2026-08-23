# Rat Race — specification

**Archetype:** `rt-race` · **Category:** Racing · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~75 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

An `rt-race` game, and the one whose finish is neither a line nor a last-one-standing:
Road Dodge is a survival contest and Racing Cars has a chequered flag, while this is a
*collection* race. The burrow itself has no end — the finish is a full belly.

Every number below is read out of `rules.ts` and `game.ts`, and every bot rate is measured
by the harness described in *The bot*.

## Observed rules

> "Press to run! Run away from the cats' paws and collect the pieces of cheese before your
> opponent!"

One sentence, and it fixes four things: the throttle is a **press**, not a tap or a swipe;
there are **paws** that must be avoided rather than survived; there is **cheese** to be
picked up; and the contest is against an opponent doing the same thing at the same time. It
leaves open how far you run, how a paw behaves, how much cheese wins, and what happens when
a paw lands. All of that is **[ours]**.

## The burrow

One number long, and both rats run the same one. **[ours]**

A rat is a **distance and a speed**. Every paw and every crumb of cheese is a fixed course
position drawn once from the match seed, and each seat carries its own progress along it.
Two windows on screen, one burrow underneath.

| | Value | Why |
|---|---|---|
| Rails | `RAILS` 3 | Enough that dodging is a *choice between two ways* rather than a reflex |
| Rat width | `RAT_HALF_RAIL` 0.34 rails | Caught between two rails it clips both, so a half-finished slide is not a free dodge |
| Speed | `RUN_SPEED` 285 u/s, `ACCEL` 640 u/s², `BRAKE` 980 u/s² | Braking is faster than accelerating, which is what makes waiting cheap and starting expensive |
| Stopping distance | 41.4 u at top speed | Under `PAW_REACH`, so there is always room to stop short of a gate — see *Termination* |
| Rail change | `RAIL_SECONDS` 0.16 s | Sideways movement costs time; two rails is a third of a second against a paw's open window of about one |
| Cheese reach | `CHEESE_REACH` 26 u along, `CHEESE_RAIL_REACH` 0.45 rails across | Generous along the burrow, tight across it, so the rail is the decision |
| Paw band | `PAW_REACH` 62 u either side | ~0.44 s to cross at top speed, against a down window of 0.72 s |
| Paw rhythm | down `PAW_DOWN_SECONDS` 0.72 s of a period drawn in [`PAW_PERIOD_MIN` 1.8, `PAW_PERIOD_MAX` 2.9] | A rhythm rather than a metronome, and each paw carries its own phase so they are not in step |
| Paw warning | `PAW_WARN_SECONDS` 0.32 s | Drawn as a growing block inside the outline; the rules only time it |
| Paw shape | `PAW_GATE_CHANCE` 0.30 all three rails, `PAW_PAIR_CHANCE` 0.34 two, else one | See below |
| Being caught | `STUN_SECONDS` 1.3 s, `KNOCKBACK` 150 u | The knockback is longer than a paw band, so the rat always comes to rest *outside* the paw that hit it |
| Paw spacing | `FIRST_PAW` 620, then 430–780 u apart | Wider than two paw bands plus a knockback, so a swat can never throw a rat into the paw behind |
| Cheese spacing | `FIRST_CHEESE` 170, then 185–330 u apart | About eighty pieces inside the reachable course, against a target of 16 |
| Window | `VIEW_AHEAD` 820 u, `VIEW_BACK` 130 u | Exactly what the band draws, and therefore the cap on what a bot may read |
| Course | `COURSE_LENGTH` 25 000 u | Longer than `RACE_SECONDS × RUN_SPEED` = 21 375, so the end is unreachable and no wrapping rule is needed |
| Clock | `RACE_SECONDS` 75 s | The fallback, not the mechanism |

### Why a third of the paws close the burrow completely **[ours]**

The first version gave every paw one rail or two, so there was always a free rail and the
whole game came out in the steering: over 360 bot matches a paw landed on a rat **0.3 times
a race**, every tier played the same, and the throttle — the one control the observed rule
names — did nothing at all.

A paw across all three rails puts "press to run" back in the middle of the game. It cannot
be dodged, only *timed*: brake, watch the rhythm, go the moment it lifts. It is never
unfair, because a rat sees one `VIEW_AHEAD` up the burrow and stops in 41 units, so there is
always somewhere to wait — waiting simply costs the race.

## Scoring and the win condition

**Score is cheese carried; the winner is the first rat to `TARGET_CHEESE` (16).** Resolved
by the SDK's `resolve()` with `{ kind: 'first-to', target: TARGET_CHEESE }`, with
`timeExpired` set once `race.elapsed` reaches `RACE_SECONDS`. So "first to sixteen", "both
on the same step is a draw" and "level at the bell is a draw" all mean exactly what they
mean in every other game in the collection. No comparison is written by hand anywhere.

Both rats are stepped from the same state before either is judged, so two rats filling a
belly on the same step is the dead heat it actually is rather than a win for whichever seat
`step()` happened to read first.

A piece of cheese is **there for both rats**: `p1Taken` and `p2Taken` are separate flag
arrays over one cheese array, so taking a piece does not take it from the opponent. This is
a race, not a scramble — the two rats are never in each other's way and cannot be.

There is no restart after a score: one race, one result, and the shell's rematch starts a
fresh one.

### How the match is guaranteed to end

A collection race has three ways to run for ever, and this closes all three:

1. **A definite length.** The race is `RACE_SECONDS` = 75 s and `race.elapsed` advances by
   the fixed delta on every step regardless of what either player does. Nothing can stop the
   clock; there is no pause inside the simulation.
2. **An explicit tiebreak at the bell.** At 75 s `resolve` settles on the fuller belly.
   Exactly level is a `'draw'` — a decided outcome the shell reports, never `null`. A race
   in which neither rat ever moved therefore ends as a draw at 75 s, which
   `rules.test.ts` plays out step by step.
3. **No permanent stop.** The only two things that stop a rat are a released throttle and a
   swat, and both are temporary. A stun counts down on its own and cannot be renewed while
   it lasts (`checkPaws` is skipped for a flattened rat), and `PAW_GAP_MIN` 430 exceeds
   `PAW_REACH × 2 + KNOCKBACK` = 274, so the knockback can never throw a rat into a paw that
   is already down. A bot stopped at a closed gate always gets through: its crossing from
   the brake point takes 0.735 s plus its caution, against a minimum open window of
   `PAW_PERIOD_MIN − PAW_DOWN_SECONDS` = 1.08 s.

**Measured.** Over 1 800 seeded bot matches (200 seeds × nine tier pairings) exactly **two**
reached the 75 s bell, both `easy` against `easy`; every other match was decided by a full
belly, and across the other eight pairings the slowest match ran 44.7 s.

`termination.test.ts` plays two `easy` bots and allows ten simulated minutes;
`rules.test.ts` runs twelve more `easy`-versus-`easy` duels and asserts each ends inside
the clock.

## Controls

| | Keyboard | Pointer |
|---|---|---|
| Player one | Hold `Space` to run; tap `A` / `D` to change rail | Hold a finger in the lower band; slide it across to pick a rail |
| Player two | Hold `Enter` to run; tap `←` / `→` to change rail | Hold a finger in the upper band; slide it across to pick a rail |

The two halves of the keyboard belong to two different people. `setBoardSeat` moves *pointer*
ownership when a turn changes and touches the keyboard not at all — and this game has no
turns anyway — so "W A S D **or** the arrow keys" would be false here in the simplest way:
the other half moves your opponent. The manifest names only the keys the game actually
reads, which is why it says *the left and right arrows* rather than "the arrow keys": up and
down do nothing, because a burrow runs one way.

**How the two sources combine.** The throttle is `actionHeld || pointer !== null` — a held
key and a finger resting on the glass are one signal with no repeat rate in it, so nothing
here can be won by whoever can drum fastest. The rail is the finger's when there is one and
the keys' when there is not: a finger names a *place*, which is more specific than a
direction. There is no mode to switch between them.

**The keys need no mirror.** `D` is player one's right and `→` is player two's right
whichever way up either of them is sitting, and the far band is drawn through a half turn,
so "field right" already means "this player's own right" in both seats. The *pointer* does
need the mirror and gets it from `toField`, the exact inverse of the map the drawing uses.

**Rail changes are edge-triggered**, one rail per press rather than one per frame. That is
not a repeat rate: the rat still slides at `RAIL_SECONDS`, and with three rails no seat is
ever more than two presses from any rail. Which is why this game does **not** declare
`sameInputClassOnly` — nothing in it can be played faster on one instrument than another,
and `control-parity.test.ts` confirms the keyboard and the thumb win at the same rate.

Every clause of both control lines is driven through the game in `game.test.ts` and asserted
against what the rat actually did. Control strings that lie are a recurring defect in this
repository, so none of them is trusted here.

## Edge cases

- **Simultaneous input.** Both rats run at once; `getActiveSeat()` returns `null` for ever.
  `rt-*` games do not model turns, and this one has nothing that could be a turn.
- **No input at all.** Both rats stay at distance 0 on rail 1 and the clock decides it: a
  draw at 75 s. Nothing hangs and nothing needs a nudge.
- **Input in the other seat's zone.** Impossible by construction: the engine assigns a
  pointer to the seat it *started* in and a game only ever reads `input.seat(seat)`. A
  finger that strays more than half a rail outside its own band names no rail at all
  (`railUnder` returns −1) but still counts as the throttle.
- **A finger whose position is not a number.** `railUnder(NaN)` fails both bounds tests,
  falls through to `clampRail(Math.floor(NaN))`, and the guard `rail >= 0` rejects it, so the
  rat keeps the rail it had. Asserted rather than argued.
- **Boundaries of the win condition.** Both on 15 is undecided; the sixteenth piece decides
  it; both reaching 16 on one step is a draw; the bell one step early decides nothing even
  with a fifteen-piece lead. All four are pinned.
- **A knockback onto cheese already passed.** The window indices walk *backwards* as well as
  forwards, so a rat thrown 150 units back can pick up a piece it had already run over.
  Without that the index would step straight past it.
- **Stalemate.** There is none to have. The two rats never interact — no collisions, no
  shared cheese, no blocking — so no position exists that neither can leave. The clock is a
  fallback against slowness, not against deadlock.

## Determinism

Trivially deterministic, with three things that needed care:

- **The course is built once** from the seeded generator and never touched again. A step
  integrates two numbers per rat and reads a modulo; there is no randomness in the
  simulation at all after `resetRace`.
- **Three separate generators.** The course draws from one stream and each seat's bot from
  its own. A tier's *number of decisions* depends on its reaction — `hard` looks four times
  as often as `easy` — so on one shared stream the pairing would decide where the cheese
  lay, and every balance number measured against one opponent would be a fiction against
  another.
- **A bot draws exactly `BOT_DRAWS_PER_DECISION` = 3 values per decision**, all of them
  before any branch. A seat whose draw count depended on what it chose would shift its own
  stream by how it played, and a replay would not be a replay.
- **A paw's phase is read from the race clock**, not integrated per step, so it is identical
  at any step size. `race.elapsed` is a sum of fixed deltas and nothing reads a wall clock.
- **No per-frame allocation.** The step report, the `resolve` tally and its options record
  are module-level scratch; the course arrays and the taken-flags are pooled and refilled on
  reset. `bot-cost.test.ts` holds the line.

## The bot

**What it reads:** its own rat, and the paws and cheese inside `profile.lookahead` of it,
and the race clock. Every one of those is drawn on the screen its opponent is looking at,
and no tier's lookahead exceeds `VIEW_AHEAD` — the band draws exactly that window, so what
is drawn and what a bot may read cannot drift apart. That is CLAUDE.md rule 6 in full.

The decision is one question asked well or badly: *will this paw be down while I am under
it?* `canPass` works out when the rat would enter and leave the band and asks
`pawDownDuring`. Three levers separate the tiers, and none of them is information:

| | `easy` | `normal` | `hard` |
|---|---|---|---|
| `reaction` — seconds between decisions | 0.40 | 0.20 | 0.09 |
| `caution` — seconds of clearance demanded | **−0.14** | 0.04 | 0.08 |
| `windup` — how much of its own run-up it accounts for | 0 | 0.55 | 1 |
| `lookahead` — course units (cap 820) | 380 | 600 | 800 |
| `greed` — chance per decision it weaves for cheese | 0.20 | 0.60 | 0.90 |
| `slip` — seconds its read of a rhythm may be out | 0.30 | 0.14 | 0.05 |

`easy`'s caution is **negative on purpose**. It does not merely react slowly, it believes it
has more time than it has, which is how a person plays this before they have learned a paw's
rhythm. A bot that is only slower still waits for a genuinely safe gap and never gets hit.

`windup` had to be invented and is **the lever that separates the top two tiers**. A rat at
the edge of a closed gate needs about a fifth of a second longer to cross than one already
at full pelt. With caution alone, `hard` avoided four swats a race that `normal` took and
still finished no sooner, because the extra caution cost it at every gate exactly what the
swats cost `normal`. Being careful is not the same as being right about the arithmetic.

`slip` is drawn once per decision and **held** until the next one. A fresh error every step
would average to zero sixty times a second and every tier would play the same.

`REACTION_WANDER` = 0.18 wanders *when* a bot looks. Without it two equal bots dead-heat:
both rats run one burrow from one start, so two bots of the same tier take the same cheese
at the same instant. It is the smallest thing that separates them and the most honest — it
is what separates two people of the same ability — and it costs no tier any pace.

### Measured

Two bots, the full game through `RatRaceGame`, 200 seeds per pairing (seed = *n* × 977),
seat one's rate first:

| p1 \ p2 | `easy` | `normal` | `hard` |
|---|---|---|---|
| **`easy`** | 45 % / 54 % / 1 % drawn | 4.5 % | 3 % |
| **`normal`** | 96 % | 52 % / 45.5 % / 2.5 % | 29.5 % |
| **`hard`** | 99.5 % | 72 % | 46.5 % / 47 % / 6.5 % |

Combined over both seats — 400 matches per pairing, which is the number that matters,
because a tier that only wins from seat one is a seat bias wearing a difficulty's clothes:

- `normal` beats `easy` **95.8 %**
- `hard` beats `easy` **98.3 %**
- `hard` beats `normal` **70.3 %**

The gap between the top two is the narrower of the two, which is what makes `normal` worth
playing rather than a step on the way to `hard`.

One bot alone in the burrow, 200 seeds (seed = *n* × 613):

| | seconds to a full belly | slowest | swats per race | cheese | never filled |
|---|---|---|---|---|---|
| `easy` | 40.2 | 75.0 | 5.3 | 15.9 | 5 / 200 |
| `normal` | 23.3 | 46.5 | 1.8 | 16.0 | 0 |
| `hard` | 20.7 | 34.9 | 0.6 | 16.0 | 0 |

Three tiers that differ in three measurable ways at once: how long they take, how often a
paw lands on them, and whether they finish at all.

## Presentations

**Shared-screen.** Two bands, one above the other, symmetric about the halfway line to the
unit — `P2_TOP` 32 and `P1_TOP` = 1000 − 437 − 32 = 531, both 437 deep. The far seat's band
is drawn through a half turn about its own centre, exactly as that player is turned, so both
people read their own band upright and the renderer never rotates anything at draw time:
`pushSeatRotation` is never called. The two bands are exact point reflections of each other
about the centre of the box, which `game.test.ts` asserts shape for shape.

**Single-seat.** The same two bands; the far one simply is not turned, because nobody is
sitting opposite. Nothing else changes — no simulation value reads the presentation, which
is how rule 10 is kept here: there is no branch to get wrong rather than a branch that
happens to be right. The identical race runs under both presentations from the same seed,
whichever seat is local.

**Rule 9.** One mapping, `fieldYFor`, with no seat argument: there is nowhere for an
asymmetry in depth of view to live. Both bands draw `VIEW_AHEAD` + `VIEW_BACK` = 950 course
units into 437 field units at `SCALE` ≈ 0.46.

**Rule 7, colour is never the only signal.** Player one runs a round-eared rat with a
straight tail and keeps a row of round pips; player two a square-eared rat with a kinked
tail and square pips. A flattened rat is struck through, thicker for the first
`FLASH_STEPS`; a pickup puts a wedge above the rat's head. A paw's three states are three
shapes: an empty frame idle, a block growing out of the middle of it in the last 0.32 s, and
a filled pad with toes and claws once it is down.

## What is not specified here

- **Audio.** Nothing in this package makes a sound; the SDK owns that when it arrives.
- **The catalogue card's blurb and art.** Generated from `catalogue.generated.ts`.
- **Remote play.** The rules are already position-and-clock only, so a lockstep transport
  would need no change here, but nothing has been built or tested against one.
