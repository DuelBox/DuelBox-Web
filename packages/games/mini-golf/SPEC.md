# Mini Golf — specification

**Archetype:** `turn-aim` · **Category:** Sports · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** ~150 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was read out of `src/rules.ts` rather than remembered.

## Observed rules

> **Mini Golf** — friend, bot — "Hole in one! The player with 2 points more than the other
> wins!"

That fixes exactly two things: a point is something you win by holing out, and the match is
decided by a lead of two. It says nothing about how many holes there are, what a hole looks
like, what a point is awarded *for*, what happens when neither player can hole out, or —
the important omission — what stops a match in which the lead never reaches two.

Everything from here down is **[ours]**.

## The round **[ours]**

Nine holes, played by both players on the same green. Strokes alternate. Whoever holes out
in fewer strokes takes the hole and one point; equal strokes halve it and nobody scores.

| | |
|---|---|
| Holes | 9 (total par 25) |
| Strokes at a hole | 6, then the ball is picked up |
| A pick-up scores | 7 — worse than any hole anybody could complete |
| Point for a hole | 1 to the fewer strokes; none if level |

Alternating strokes rather than playing one ball out at a time, because both balls stay on
the screen and each player can see how the other is getting on. **The two balls never
interact** — a ball at rest in another's line is marked and lifted, exactly as it is on a
real green — so nothing is gained by playing first, and the seats simply alternate the
honour hole by hole, starting from `context.openingSeat` rather than from a literal `p1`.
The SDK alternates that opener across the rounds of a best-of (#2466); a game that ignored
it would leave the rotation reaching nothing. Measured at 50 seeds x both opening seats on
`normal`, equal tiers: seat one takes **50.0%** of 100 decided matches, and all 50 seed
pairs play out differently when only the opening seat changes.

## Scoring and the win condition

`resolve({ kind: 'lead-by', margin: 2 }, points)`, from `@duelbox/game-sdk`. It is asked
after every hole and again, with `timeExpired`, when the holes run out.

**How the match is guaranteed to end.** "Win by two" is a lead condition, and a lead
condition on its own can run for ever — Pool and Air Hockey both shipped unable to finish
and were caught by `apps/web/src/data/termination.test.ts`. Three caps, each provable
rather than hopeful:

1. **A stroke settles.** The felt is a *constant deceleration*, so a ball is stopped after
   `PUTT_MAX_SPEED / GREEN_FRICTION` = **2.22 s** whatever it does in between; a bounce only
   ever removes energy. There is a `MAX_ROLL_SECONDS = 4` guard as well, which is not
   reachable through `putt` and exists because the turn order rests on this one property.
2. **A hole ends.** Six strokes each, then the ball is picked up and the hole is scored,
   holed out or not. So a hole costs at most twelve strokes.
3. **The round ends.** After the ninth hole the leader takes it — one point clear is enough
   once there are no holes left. Level on points, the player round in **fewer strokes** wins,
   which is what golf has always meant by the better round. Only an identical card is a draw.

Measured over 240 bot matches at each of nine pairings: a match takes **29–37 s of
simulated play on average and 80 s at its worst**, against the ten minutes the guard allows.
The theoretical ceiling is 9 × 12 strokes at roughly 3 s each, about 5½ minutes, and it is
unreachable because a player who is that bad has already lost two holes.

Draws, measured over 240 matches a tier against itself: **0.4% at easy, 1.7% at normal,
4.6% at hard**. Holes-won is a coarse score and two matched players halve a great many
holes; the strokes tiebreak is what keeps that in low single figures.

After a hole is scored the green clears, both balls go to the next tee, and the seat that
did not play first last time plays first now.

## The green

| | Value | Why |
|---|---|---|
| Green | x 40…660, y 90…880 | The band above is the hole card, the one below the scoreboard |
| Ball | radius 11 | |
| Cup | radius 21 | Forgiving enough for a thumb, small enough to miss |
| Putt speed | 0…820 units/s | Full power rolls 908 units, just over the longest hole |
| Green friction | 370 units/s² | Constant. `d = v² / 2a`, so power is learnable |
| Sand friction | 1500 units/s² | Four times the drag: sand has to be hit *through* |
| Wall bounce | 0.7 | Enough to bank a putt, little enough to punish one |
| Capture speed | 250 units/s | Faster than this and the ball rides the rim |
| Thinnest wall | 50 | See below |

**Friction is constant, not proportional.** Every other rolling game here (Pool, Bowling)
decays velocity by `pow(drag, dt)`, which only ever *approaches* zero and needs a crawl
threshold to cut off — and Bowling shipped with a ball that sailed on for eight seconds
after every delivery. A constant deceleration reaches zero at a time that can be written
down. It also has an exact per-step integral, `(v − ½at)·t`, so the total roll is identical
at 60, 90, 120 and 240 Hz rather than drifting by a per-step rounding. A test steps the same
putt at all four rates and compares where it stopped to six decimal places.

**The cup will not take a ball hit too hard.** A ball can be at most
`CAPTURE_SPEED² / 2·GREEN_FRICTION` = **84 units** past the cup and still drop. That single
number is what makes weight a skill rather than a slider held at maximum, and it is one of
the three things the bot tiers differ in.

**No wall is thin enough to tunnel through.** A ball crosses at most 820/60 = 13.7 units in
a step and would need 50 + 22 = 72 to skip a wall entirely — five times the margin. A test
holds every wall on the course to `MIN_WALL_THICKNESS`, so a new hole cannot quietly
introduce one.

**Water costs a stroke** and puts the ball back where it was played from, charged once in
`settleStroke` however many steps the ball spends in the hazard.

## The course

Fixed, not generated. A random course would rob both players of the one thing that makes a
shared hole fair — that they are playing the *same* hole — and would make the first stroke a
lottery. Par was set from the measured strongest-tier average, rounded.

| # | Par | What it is | easy | normal | hard |
|---|---|---|---|---|---|
| 1 | 2 | Straight, nothing in the way | 2.93 | 2.49 | 2.04 |
| 2 | 3 | A bar across the middle | 3.85 | 3.08 | 2.57 |
| 3 | 4 | Slalom: two offset bars | 4.40 | 4.11 | 3.63 |
| 4 | 2 | A gate to thread | 2.70 | 2.23 | 1.93 |
| 5 | 3 | Dogleg round a long post | 3.82 | 3.46 | 2.96 |
| 6 | 3 | A bunker straight across the line | 3.47 | 3.12 | 2.58 |
| 7 | 3 | Water down one side | 3.45 | 2.95 | 2.56 |
| 8 | 3 | Two posts, a double dogleg | 3.48 | 3.04 | 2.67 |
| 9 | 2 | Island cup with one way in | 2.49 | 2.20 | 1.83 |

Strokes to hole out, 240 seeded rounds a tier a hole. Every tier finishes every hole at
least 90% of the time; the strongest finishes all nine at 99% or better. **A hole nobody can
finish is a hole that is always halved**, which is a scoring resolution problem as well as a
design one, and a test asserts the strongest tier averages under five strokes on every hole.

The third hole is the one that had to be rebuilt. Its first draft was a slalom of two 380-unit
bars, and the strongest tier holed out on only **71%** of attempts at an average of 5.50 — a
hole that was, in practice, always halved at 7–7. Widening both gaps by 80 units took it to
99% and 3.63. The eighth was worse: a three-wall zigzag that **no tier ever finished**,
because getting from one gap to the next needed a stroke that threaded between two walls and
the corner planner had no candidate there. It became a two-post double dogleg.

## Controls

| | Keyboard | Pointer |
|---|---|---|
| Seat one | `A`/`D` swing the line, hold `Space` to build the stroke, release to play | Pull back from your ball and let go |
| Seat two | `←`/`→` swing the line, hold `Enter` to build the stroke, release to play | The same |

The two sources combine with no mode to switch between them: a pointer, while it is down,
owns both the line and the weight; the steering keys always add to the line; and the hold
only sets the weight when there is no finger on the glass. `actionReleased` plays the stroke
whichever produced it.

**The line starts pointed at the cup** at the beginning of every stroke. The keyboard has
four directions and an action key and nothing absolute about it, so an aim left wherever the
last stroke ended would make finding the hole again the whole game. Weight, and every
adjustment off the straight line, is still the player's.

`holdSeconds` is zero on the step the key comes up, so the weight is carried in a field
rather than read at the release. A game that read it there would play every keyboard putt
with no weight at all — there is a test for exactly that.

The board is `shared-board`: the whole pointer surface belongs to whoever is to play, and it
turns to face them. Both are the shell's, not this game's.

## Edge cases

- **Simultaneous input.** Impossible by construction: only the seat with the move is read,
  and the shell hands the whole surface to it.
- **No input.** Nothing happens and nothing times out. A turn game with a silent player is
  a game waiting, not a game stuck — and a test asserts the game never plays a stroke for a
  seat a person is sitting in.
- **Input in the other seat's zone.** There is no other zone. A finger anywhere on the board
  belongs to the player to play.
- **A pull too short to be a stroke.** Under 18 units it is a thumb resting on the ball and
  is ignored, or resting a thumb there would play the shot.
- **Nonsense.** A NaN angle, an infinite one, a power above one or below the floor: `putt`
  refuses all of them and returns false, so a refusal is never mistaken for a stroke that
  went nowhere. The input-fuzz guard sends exactly this for four simulated minutes.
- **A ball that will not stop.** Cannot happen through `putt`, and is stopped dead at four
  seconds if it ever does.
- **Neither player can hole out.** Both pick up, the hole is halved at 7–7, and the round
  moves on. Nine of those is a draw on the card, decided by nothing — and that is the state
  the strokes tiebreak was added to avoid, since two identical rounds are rare.
- **A stalemate.** There isn't one. Every hole ends after twelve strokes and the round ends
  after nine holes.

## Determinism

- All randomness is the bot's, two `Rng.float()` draws per stroke from the context's seeded
  generator. There is no randomness in the simulation itself: a putt of a given angle and
  power always rolls to the same place.
- Every delay — the bot's thinking time, the pause after a ball stops, the pause after a
  hole — is counted in **steps**, derived once from the first non-zero delta, not in seconds
  off a clock.
- The integration has the matching analytic form (see above), so the physics is identical at
  60, 90, 120 and 240 Hz rather than approximately so. This is the one place this game is
  stricter than its siblings, and it is stricter because it was cheap to be.
- Two matches from the same seed replay to identical ball positions to five decimal places,
  and the presentation — shared-screen or single-seat, either local seat — changes nothing
  but the picture.

## The bot

It reads the ball, the cup, the walls, the sand and the water: every one of them drawn on
the screen in front of a person, per rule 6. It does what a player does — if it can see the
cup it plays at the cup with the weight to die just past it, and if it cannot it plays wide
of the corner that opens the cup up, by `BALL_RADIUS + 22` units so it does not need a bounce
to get round. It hits harder through sand, by the exact ratio of the two frictions, because a
player learns that by leaving one short exactly once.

Its error is **two rolls drawn once for the stroke** — a line and a weight — never redrawn
per step. A per-step error averages to zero and every tier plays the same; that is the single
most repeated bug in this repository and `@duelbox/game-sdk`'s `misjudgement` exists for it.

| | Line | Weight | Aims to stop past the cup | v easy | v normal |
|---|---|---|---|---|---|
| easy | ±0.13 rad | ±24% | 100 units | — | — |
| normal | ±0.10 rad | ±20% | 88 units | **70%** | — |
| hard | ±0.078 rad | ±16% | 72 units | **91%** | **78%** |

240 matches a pairing, played from both seats and averaged; each tier is level against
itself (51%, 48%, 52% to seat one). The third column is the lever that reads as skill: a ball
can be at most 84 units past the cup and still drop, so `easy` is deliberately over that
line — it charges the hole and lips out, which is what a bad putter does.

**The ladder is steep, and had to be measured to find that out.** Six candidate profiles
were swept against each other over 80 matches each. Adjacent candidates gave 68/32; two
apart gave 90/10; three apart gave 98/2. The first ladder tried — spreads of 0.15, 0.06 and
0.022 — was three candidates apart and produced **120–0, 119–1 and 120–0**, which is not an
opponent but a wall, and `hard` played so perfectly that it halved every hole with itself
and drew **65%** of its own matches. The shipped ladder is three *adjacent* candidates.

**A fourth lever was written, measured and deleted.** `plans` decided whether a tier played
round an obstacle at all. It made a cliff rather than a ladder: without it a tier bangs into
the same wall six times and picks up, so `easy` holed out on **0%** of holes 2, 3 and 7 and
lost every match to both other tiers. Understanding the shape of a hole is not a difficulty
setting; how straight you hit it is. All three tiers now plan and differ only in execution.

## Presentations

Shared-screen turns the whole green half a turn to face whoever is to play — `SeatFlip`,
from the engine, with input suppressed for the 0.36 s it takes. Single-seat never rotates.
The simulation is identical in both, and a test plays the same seed through both to prove it.
See `docs/presentation.md`.

## Rule 7

Colour is never the only signal. Seat one's ball is a disc with a **ring** cut in it, seat
two's a disc with a **bar** across it, and the scoreboard repeats the same two markers beside
each row. The ball with the move wears a halo. Sand is hatched and water is ruled with wave
lines, so the two hazards are different things in greyscale. Whose turn it is reaches the
player three ways — the halo, the arrowhead on the scoreboard, and the board's own rotation —
and the game draws **no turn banner**, because the shell owns that one.

## What is not specified here

- Slopes, banked walls, windmills and moving obstacles. All are real mini golf; a flat green
  with fixed blocks is what the genre does on a phone, and every one of them would need its
  own answer to "does the ball still stop in 2.22 seconds".
- Backspin, and putting from off the green.
- A course longer than nine holes, or a choice of courses.
- The corner planner is one level deep: it plays to the corner that opens the cup, and
  re-plans from wherever the ball ends up. It cost the eighth hole its first design. A
  two-level version would let a bot see a stroke further ahead, and would be worth measuring
  before it is worth writing.
