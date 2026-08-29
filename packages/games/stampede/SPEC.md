# Stampede — specification

**Archetype:** `rt-split` · **Category:** Platform · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 38 s advertised, 36.9 s measured

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against `dist/rules.js` with harnesses in
> `/tmp/claude-*/scratchpad/st/`.

A lane each, stacked, one per seat. Beasts charge across your lane from the left or from the
right; your runner stands in the middle of it and never moves. One press puts it in the air.
A beast that passes under a runner in the air costs nothing; a beast that reaches a runner
standing on the ground bowls it over. Twenty waves, then the herd is gone and whoever kept
more of it has won.

## Observed rules

The catalogue row: _"Look for dangers coming from the left or right and jump to avoid them."_

Everything in that sentence is built. Two things are ours and are argued below: the runner
does not move (the row does not say it does, and giving it a position would have broken the
input-parity argument), and beasts are worth different amounts, which is what turns a dense
wave from a reflex test into a decision.

## The press is the whole vocabulary, and that is the fairness argument **[ours]**

`docs/input-parity.md` divides input families by two asymmetries: absolute versus relative
positioning, and occlusion. **Neither applies to a game whose entire input is one binary
event with a timestamp.** There is no position to point at, no direction to push, no
distance to drag and no duration to hold — a thumb, a trackpad, a mouse button and a key
cannot express a difference here, so there is nothing for the engine's precision envelope to
level. The Last Sashimi's SPEC makes the same argument for the same reason; this is the
strongest form rule 10 takes in the catalogue.

Two tests carry it rather than the prose. One drives an identical seeded match through
`tapKey` and through `tapFinger` and compares the whole simulation; the other taps at
(2, 999) and at (598, 502) and compares seat one's record. Both are byte-identical, because
the pointer's position never reaches this file at all.

A press is read on the step it is delivered and lands at the start of the next, for a bot and
for a person alike, because `game.ts` reads both at the same point in `update`. Neither kind
of player gains or loses a frame from it.

## The approach-time budget: 1.79 s, and why that is the number **[ours]**

Reaction games are where hardware advantage hides. If the outcome turns on *noticing* a
danger, then the player with the brighter, larger, lower-latency screen wins, and
`docs/input-parity.md` calls that unfair in a direction software cannot fix. The defence is
to make the danger readable far enough ahead that pressing is a **decision taken at leisure**
rather than a reflex race.

Every beast is announced by dust at the lane edge it will enter from, carrying its own
silhouette, and then runs across half the lane before it reaches you:

| | first wave (240 units/s) | last wave (380 units/s) |
|---|---|---|
| dust at the edge, before it enters | 0.85 s | 0.85 s |
| running across the lane to you | 1.375 s | 0.942 s |
| **total warning** | **2.225 s** | **1.792 s** |
| the window a press has to land in | 0.30 s (20 frames) | 0.30 s (20 frames) |

**The budget is 1.79 s at its tightest**, asserted by a test over 300 generated courses.
Against that:

- The largest honest disagreement two devices can have about *when* a press happened is the
  8 ms tolerance `resolveSimultaneous` uses — **0.4% of the budget**, and 2.7% of the press
  window.
- A 60 Hz display shows the dust 16.7 ms later than a 144 Hz one at worst: **0.9% of the
  budget**. A player who spends a whole extra frame noticing still has 19 frames of window.
- The silhouette is in the *dust*, not only in the beast, so the one thing a player has to
  read to make a decision — bull or goat — is legible for the whole 1.79 s rather than for
  the last third of it.

So the game is **fair cross-device and `sameInputClassOnly: false`**, which is also the
ruling `docs/input-parity.md` already gives `rt-split`. What would break it is shortening
`WARN_SECONDS` to make the game harder, and the difficulty section below explains why that
is not how this game gets harder.

## Difficulty is never a narrower window

Target Practice records a whole ladder collapsing into three spellings of "nearly perfect"
because the floor of its window was the frame rate. This game is built so that cannot happen,
and the mechanism is worth stating precisely.

**A beast is dangerous for a fixed length of time, not a fixed length of lane.**
`DANGER_SECONDS` is 0.4 s whatever the speed, and the drawn beast is *derived* from it —
`halfLength = DANGER_HALF · speed − RUNNER_HALF` — so a fast beast is drawn longer. A jump
covers a beast when the beast's whole danger interval sits inside the 0.7 s of air, so the
press window is `AIR − DANGER = 0.30 s` at every speed in the course.

Sampled on the fixed step, that is **20 frames** — measured by scanning every frame a press
could land on, not asserted. Cup Pong's first geometry left 0.046–0.062 s, all of it inside
four frames.

The five course knobs, each swept alone against an untouched `normal` bot over 3000 courses:

| knob | range swept | effect on score | verdict |
|---|---|---|---|
| speed at the last wave | 240 → 560 | **54.88% → 54.88%**, bit-identical | flat *by construction*; a reading knob, not a timing one |
| gap between waves | 2.30 → 0.70 s | 54.92% → 55.51% | effectively flat; a pacing knob (course 48.5 s → 34.1 s) |
| share of waves that are a **choice** | 0.12 → 0.80 | **58.62% → 52.02%** | monotone; this is the ramp |
| share of waves that are a **pincer** | 0.10 → 0.70 | 55.04% → 54.51% | monotone, weakly |
| warning length | 0.20 → 2.50 s | 54.88% → 54.88%, bit-identical | flat for a bot that decides at a fixed lead |

The first and last rows are the point rather than a disappointment. **A speed ramp that
changed the bot's score would mean the press window had narrowed**, and the whole design is
that it cannot. A test asserts the clearing frames are the identical set at 240 and at 560.

So the in-match ramp is the wave mix — pincers 10% → 30% of waves, choices 12% → 45% — plus a
speed ramp aimed at a person's eyes and a gap ramp aimed at the pacing. Measured per fifth of
the course, that ramp is monotone at every tier:

| tier | 1st fifth | 2nd | 3rd | 4th | 5th |
|---|---|---|---|---|---|
| easy | 39.6% | 38.3% | 38.0% | 37.5% | 37.1% |
| normal | 56.5% | 53.3% | 52.6% | 51.4% | 49.9% |
| hard | 76.2% | 72.0% | 69.4% | 66.9% | 65.9% |

**The honest limitation.** The bot models timing, not reading: it commits at a fixed lead and
never has to see anything. So the speed ramp is exactly flat for it and is not flat for a
person. The bot ladder is therefore calibrated bot-against-bot, and a person will find the
last third of a course harder than the ladder implies. That is a known modelling gap, not a
measurement error, and the alternative — scaling the bot's error by how little time it had to
look — is a second, redundant spelling of `pressError` of the kind Cup Pong swept and deleted.

## The three kinds of wave

| | separation | what it asks | share of waves |
|---|---|---|---|
| **single** | — | one press | 51.4% |
| **pincer** | 0, 0.07, 0.13 s | one press takes both; the slack falls to `0.30 − separation` | 19.9% |
| **choice** | 0.34, 0.40, 0.46 s | one press cannot take both and two presses cannot either | 28.8% |

A choice is always **one bull and one goat**, in either order, so exactly one of the two is
worth saving and which one is drawn fresh. The separations are bounded on both sides and a
test asserts every generated pair falls in one class or the other:

- above `PRESS_WINDOW` = 0.30 s, so no single jump covers both — verified exhaustively over
  every frame a press could land on;
- below `DANGER_SECONDS + RECOVER_SECONDS` = 0.52 s, so a second jump cannot be got off in
  time either.

And the stagger is short enough that the half you *kept* is still reachable after the half you
gave up bowls you over: `STAGGER_SECONDS` is 0.18 s, which leaves 0.16 s — nine frames — on
the tightest separation the course draws. A test computes that for all three.

## The lane

| | Value | Why |
|---|---|---|
| Board | 600 × 1000 | two lanes of 600 × 500, stacked |
| Runner | at x = 300, half-width 18, radius 30 | never moves; there is nothing to steer |
| Ground line | 150 units in from the seat's own edge | |
| Jump | 0.7 s in the air, apex 210 units | apex at the beast's arrival is a *clean* clear |
| Danger | **0.4 s**, whatever the speed | the one number the geometry is derived from |
| Press window | 0.30 s = **20 frames** | measured, not derived |
| Recover | 0.12 s | |
| Stagger | 0.18 s | short on purpose: a choice must stay winnable |
| Clean band | 0.075 s either side of the apex = **9 frames** | the tie-break, never a point |
| Speed | 240 → 380 units/s across the course | reading difficulty only |
| Warning | 0.85 s of dust before it enters the lane | |
| Course | 20 waves, 23–36 beasts, 30–57 points | laid out before the first step |

Seat two's lane is seat one's turned half a turn about the middle of the board, expressed by
`toBoardX` / `toBoardY` and asserted on a grid of points. **Nothing is rotated at render
time and there is no text anywhere in the game**, so the picture is unchanged by turning the
device over and no glyph is upside down for anybody. A beast entering on your left enters on
your left, whichever side of the device you sit on.

### The drawn beast *is* the referee

`halfLength` is derived from `DANGER_HALF` and the speed, so the drawn beast overlaps the
drawn footprint for precisely the interval the rule calls dangerous. A test walks 480 sampled
moments at three speeds and requires "the pictures overlap" and "the rule says it is
dangerous" to be the same statement.

The consequence at the edges of the window is worth knowing, because it looks like a bug and
is not: the latest legal press is the frame on which the runner's toes leave the ground as the
beast's nose arrives, and the earliest is the frame on which it lands as the tail goes past.
That is what the last possible moment should look like.

## Scoring, and why a clean clear counts for something

A bull is worth 2, a goat 1. **More points wins; level on points, more clean clears; level on
both, a draw.**

The clean count is a tie-break and never a point, because a player who dodged more of the herd
has beaten one who dodged less however prettily. It exists for resolution — two players of the
same standard land on the same points total often:

| | draws on points alone | draws with the clean tie-break |
|---|---|---|
| easy v easy | 5.3% | **0.9%** |
| normal v normal | 6.6% | **0.6%** |
| hard v hard | 10.5% | **1.3%** |

1500 seeds a tier. `CLEAN_SECONDS` is set so a bit over half of what is cleared is cleared
clean — 51.9% at `easy`, 58.8% at `hard` — because a tie-break that almost never separates
anybody is not one.

**Nothing saturates.** The best tier takes 75.4% of the herd, not all of it, and the reason is
structural rather than tuned: every `choice` wave is a guaranteed loss of at least one goat, so
a flawless run still leaves points on the ground. Sudoku, Solitaire and Blocks all had to move
their score onto something that does not saturate; this one never had to.

## Termination

**Structural, and nothing a player does can touch it.** The course is laid out in `resetGame`
before the first step: 20 waves, arrival times fixed, no beast added or held back by anything
that happens afterwards. A runner settles a beast either when it bowls them over (its arrival
minus 0.2 s) or when it has gone by (plus 0.2 s), and the match ends when both runners have
settled all of them.

- A test plays three courses **with no frame cap in the loop at all** — a course that could
  fail to finish would hang the suite rather than pass quietly — with nobody pressing, with
  both seats pressing every step, and with one of each.
- Match length varies by at most `DANGER_SECONDS` = 0.4 s with how well it is played, which is
  the difference between being bowled over by the last beast and clearing it. Asserted.
- An empty course — the `destroy` path, and the state before `init` — is settled as a **draw
  immediately** rather than never, so a shell that steps a game it has not started steps
  nothing at all.
- Measured through the shell at every tier: 36.9 s, and 0 unfinished of 3000 matches.

`roundSeconds: 38` is advertising text on the catalogue card and ends nothing; a test ties it
to the longest course the generator actually lays out.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `Space` | `Enter` |
| Pointer | tap anywhere in your own half | tap anywhere in your own half |

One press, no holding, nothing to aim. A key held down repeats nothing — a test holds it for
ten seconds and counts one jump.

## The bot

Three tiers, and three knobs, all swept alone.

| Tier | Press error | Look-ahead | Blunder | Herd taken |
|---|---|---|---|---|
| easy | ±0.56 s | 0 — does not look past the beast in front of it | 16% | 38.0% |
| normal | ±0.38 s | 0.42 s — sees the near two thirds of a choice | 7% | 54.9% |
| hard | ±0.24 s | 0.60 s — sees all of it | 2% | 75.4% |

The press error is loose by the standards of the aiming games — Cup Pong's hardest tier is
0.11 s — and it should be: those games stop a needle against a gauge, and this one asks a
player to watch both edges of a lane at once and pick a moment out of the air with nothing to
read it against. Every tier is wider end to end (29, 46, 67 frames) than the 20-frame window
it aims at, so no tier picks a moment more finely than a person could. That is rule 6 by
construction rather than by tuning.

Four things about it are load-bearing.

**It counts down to a moment; it never watches for a position.** Cup Pong's SPEC records why
this is worth a paragraph: a bot that waits for the world to look right can wait for ever, and
two `easy` seats found exactly that on the second seed of its first harness run. A countdown
cannot fail to expire, and if the moment has already gone by when the runner's feet come free
it presses at once — a real way for a person to be late rather than a way for a bot to cheat.

**It decides at a fixed lead, one second out, and that is what makes the ladder's second rung
exist.** The first version planned the instant a beast came over the horizon — 1.79 s to
2.23 s out — and at that moment the *next* beast is still `separation` seconds short of
visible, so the whole choice branch could not fire. `planHorizon` then swept **flat and not
monotone**: 92.5% against 94.1% across its entire range, and what little it did do depended on
how wide the gap between waves happened to be. Deciding at a fixed lead makes both beasts of a
pair visible whenever the decision is taken.

It is not a way to see further. `decideAt` takes the **later** of the fixed lead and the moment
the beast comes into view, so no value of `BOT_PLAN_LEAD` can break rule 6, and a test measures
the margin — 0.33 s at the tightest beast the course can generate, for the beast and for the
partner it might look at — rather than leaving it as an assurance.

**Its press error is triangular, not flat.** Two draws summed, `±pressError` at the extremes.
The same reason Cup Pong gives: a flat error either fits inside the window or it does not, with
almost nowhere for a ladder to stand.

**It draws exactly three values per plan, unconditionally, before anything branches**, from a
generator of its own. A test snapshots the generator either side of every step and requires
every move to be exactly three draws or none. A second test plays seat two against `easy` and
against `hard` and requires a step-by-step identical record, because the *number* of plans a
tier makes depends on how many beasts it decides to jump for.

### One knob was written, swept and deleted

`plannedPress` used to centre a jump on the **midpoint of a pincer pair**, which is the
midpoint of the interval that covers both and is therefore the obvious answer. It measured
worse at every separation and every error width, and the exact model says why:

| separation | aimed at the first (**shipped**) | aimed at the midpoint | best offset found |
|---|---|---|---|
| 0.00 s | 1.803 beasts | 1.803 | −0.367 s |
| 0.07 s | **1.699** | 1.656 | −0.350 s |
| 0.13 s | **1.570** | 1.481 | −0.333 s |

Expected beasts cleared per pincer, `hard`'s triangular ±0.24 s integrated over 800 offsets,
against a hand-built two-beast board. **The two ways of being wrong are not worth the same.**
A press that is too early still covers the first beast, so it costs one; a press that is too
late is swallowed by the stagger from the beast that has already bowled you over, so it costs
both. The optimum therefore sits early of the midpoint, and lands within one frame of the
plain centred press at every separation.

So the pincer case is now the same answer as the "did not look" case, every tier plays it the
same way, and `planHorizon` governs the `choice` branch and nothing else. That is also what
made it monotone.

### Every knob, swept alone

Solo against 6000 courses (95% confidence intervals shown) for the score, and win rate against
an untouched `normal` over 800 seeds in each seat order.

| `hard` press error | wins vs `normal` | herd taken | clean |
|---|---|---|---|
| 0.10 s | 99.9% / 100.0% | 84.5% | 19.64 |
| 0.16 s | 99.9% / 100.0% | 83.5% | 15.92 |
| 0.20 s | 99.6% / 99.1% | 80.2% | 13.82 |
| **0.24 s (shipped)** | **96.9% / 96.4%** | **75.5%** | 12.29 |
| 0.30 s | 84.7% / 83.5% | 67.9% | 10.56 |
| 0.40 s | 57.7% / 54.8% | 57.0% | 8.53 |
| 0.56 s | 23.1% / 21.6% | 45.3% | 6.61 |
| 0.80 s | 6.3% / 6.4% | 34.9% | 5.17 |

| `hard` blunder | wins vs `normal` | herd taken |
|---|---|---|
| 0 | 97.9% / 97.9% | 76.9% |
| **0.02 (shipped)** | **96.9% / 96.4%** | **75.5%** |
| 0.06 | 93.6% / 92.6% | 72.7% |
| 0.14 | 84.7% / 82.6% | 67.1% |
| 0.30 | 51.8% / 50.3% | 55.0% |
| 0.60 | 4.4% / 3.6% | 32.1% |

| `hard` look-ahead | herd taken (6000 courses, solo) | what it can see |
|---|---|---|
| 0 to 0.33 s | **70.45% ±0.21** | nothing; always saves the first |
| 0.36 s | 72.08% ±0.20 | the 0.34 s choice |
| 0.42 s | 73.74% ±0.19 | 0.34 and 0.40 |
| **0.50 s and above (shipped 0.60)** | **75.36% ±0.18** | all three |

A step function with exactly three rungs, monotone across all of them, flat below the smallest
separation it could possibly see. Its whole travel is 4.9 points of the herd, which is smaller
than the press error's and is meant to be: this is a timing game with a decision in it, not the
other way round.

| `normal` press error | beats `easy` | loses to `hard` | herd taken |
|---|---|---|---|
| 0.28 s | 98.3% / 98.5% | — | 65.6% |
| 0.33 s | 95.6% / 94.9% | — | 60.1% |
| **0.38 s (shipped)** | **90.2% / 89.2%** | **96.9% / 96.4%** | **54.9%** |
| 0.44 s | 80.2% / 80.1% | — | 50.3% |
| 0.50 s | 70.9% / 72.4% | — | 46.3% |

| `easy` press error | loses to `normal` | herd taken |
|---|---|---|
| 0.40 s | 28.7% / 28.6% won | 47.4% |
| 0.48 s | 18.0% / 17.3% | 42.1% |
| **0.56 s (shipped)** | **10.8% / 9.8%** | **38.0%** |
| 0.70 s | 5.3% / 4.3% | 32.8% |
| 0.90 s | 2.3% / 1.5% | 27.8% |

### Balance, 1500 seeds a pairing

Equal tiers:

| | p1 | p2 | draws | seat-one share of decided | points p1/p2 | match |
|---|---|---|---|---|---|---|
| easy v easy | 704 | 783 | 13 | 47.3% | 16.14 / 16.49 | 36.9 s |
| normal v normal | 725 | 766 | 9 | 48.6% | 23.43 / 23.49 | 36.9 s |
| hard v hard | 716 | 765 | 19 | 48.3% | 32.17 / 32.29 | 37.0 s |

Cross tier, both seat orders:

| | p1 | p2 | draws | stronger tier's share of decided |
|---|---|---|---|---|
| hard as p1 v easy | 1499 | 1 | 0 | 99.9% |
| easy as p1 v hard | 1 | 1499 | 0 | 99.9% |
| hard as p1 v normal | 1451 | 47 | 2 | 96.9% |
| normal as p1 v hard | 57 | 1441 | 2 | 96.2% |
| normal as p1 v easy | 1334 | 160 | 6 | 89.3% |
| easy as p1 v normal | 157 | 1340 | 3 | 89.5% |

Every pairing agrees with itself within 1.3 points across the two seat orders. `hard` against
`easy` is nearly total, and that is the herd's length rather than a tuning problem: 30 beasts
is a large enough sample that a 37-point gap in clear rate essentially never reverses.

### Seat one is 50.00%, and that is a proof rather than a measurement

**There is no per-seat geometry in `rules.ts` at all.** The course belongs to neither seat,
both runners settle against it with the same function, and nothing in `step`, `settle` or the
bot reads which seat it is holding. So the mirror of a board is the board with its two runners
swapped, and:

| | seat one's share |
|---|---|
| **paired** — every seed played twice with the two bots' generators exchanged | **50.00%** exactly: 5933 / 5933, 5951 / 5951, 5932 / 5932 |
| unpaired, 6000 seeds a tier | 49.71% / 48.85% / 50.10% |
| unpaired, 6000 seeds a tier, seeds from an unrelated source | 49.74% / 51.60% / 49.95% |
| through the shell, 500 seeds × both openings (the balance harness's own method) | 51.2% / 47.5% / 49.5% |
| through the shell at the harness's default 50 seeds | 48.0% / 46.9% / 54.0% |

The first row is the game; the rest are the samples. Four tests hold the property:

- **step a swapped board to the swap of the stepped board**, over 600 scrambled boards with
  the runners put on the frame lattice they actually visit, so exact ties are everyday events
  rather than measure-zero ones;
- **a bot wants the same thing from either seat** on a swapped board, over 900 boards across
  three tiers, comparing the press, the target, the moment and the blunder flag;
- **the two runners given the same presses stay bit-identical**, stepped to the end of 40 whole
  courses — this is the knife-edge check, and the family it is looking for is *a threshold a
  state variable lands on exactly by construction*, which is what Snowball Throw and Frozen
  Beaks both were;
- **a whole swapped match ends in the swapped result**, 300 matches across three tiers:
  **0 flipped winners and 0 differing scorelines**.

## Reading `openingSeat`, and what it is spent on **[ours]**

The contract lets a real-time game ignore `context.openingSeat`, and eighty-one of the
ninety-three measurable games do. This one uses it, because there is a better answer than
ignoring it: the alternation exists so first-mover advantage washes out across the rounds of a
best-of, and this game has no first mover for it to wash out. So the alternation is **spent on
the herd** — the two halves of a best-of get two different courses rather than the same one
twice.

It costs one line and it cannot introduce a seat bias, because what it changes is the course
*both* seats run rather than either seat's share of it. A test plays 2400 steps under both
openings feeding both seats the identical presses and requires the two runners to be in
identical states at every step.

## Rule 7: never colour alone, and no text at all

**Seat one is round and seat two is square, everywhere in this game.** Every seat-owned mark
goes through one of two helpers — `#dot` and `#ring` — so the shape cannot drift apart from the
colour when the next ornament is added. Bodies, outlines, eyes, shadows, dust plumes, seat
bands and tally pips all follow it.

A test collects every draw call made in one of a seat's four `SEAT_PALETTE` strings and
asserts the two vocabularies are disjoint in both directions: seat one draws `circle` and
`strokeCircle` and never `strokeRect`; seat two draws `rect` and `strokeRect` and never a
circle of any kind. That is the evidence `apps/web/src/data/greyscale.test.ts` looks for — a
primitive one seat draws steadily and the other never draws at all — and stampede passes it.

The herd is told apart the same way. **A bull carries two horn strokes and a goat one**, in the
lane and again in the dust that announces it, and the bull's body is half again as tall. A test
counts the horn strokes per visible beast per lane on every frame of a whole match. Nothing in
the herd is drawn in either seat's colour.

Everything else that has to be read is a position or a length:

- how high the runner is, which is the jump arc itself and a shadow that shrinks as it rises;
- a ring where a beast went by for a clear and a broken bar for a knock, both in the seat's own
  shape;
- three dust plumes at the lane edge, reaching further in as the beast nears;
- the runner's footprint marked on the ground line at exactly the 18 units the danger geometry
  uses, so "where a beast reaches you" is a thing on the board rather than a number in a spec;
- points as a bar along the seat's own outer edge with four fixed milestone pips in its shape;
- how much of the course is left, as one strip on the centre line growing from the middle
  toward both ends — one object, in neither seat's colour, unchanged by the half-turn.

**No text at all**, asserted over 2400 steps: a glyph would be upside down for one of the two
people looking at it, and nothing here needs saying in words.

## Rule 8: no pixels, and nothing integrated

`rules.ts` holds the whole simulation in logical units and in seconds, and imports nothing from
`game.ts`. It is also written so that **nothing is integrated**: a hazard is an arrival time and
a speed, and where it is drawn is `RUNNER_X + dir · (clock − arrival) · speed`, evaluated fresh
whenever anybody asks. There is therefore no accumulated numeric position for the bot's
analytic reasoning to disagree with — the referee and the bot ask the identical arithmetic the
identical question, which is what issue #2465 is about.

It also makes interpolation free and exactly right: `render` evaluates the same functions at
`clock + alpha · step` and stores nothing back. A test renders 120 frames at three alphas and
asserts nothing moved.

## What we did not build from the catalogue row

- **The runner does not move.** Nothing in the row says it does, and giving it a lateral
  position would have handed a thumb a continuous quantity a key cannot match — the exact trade
  Cup Pong refused for the same reason. Standing still and jumping is the whole game.
- **There is no lives or health counter.** A knock costs the beast's points and 0.18 s on the
  floor, and the course runs to its end regardless. A lives counter would have made the match
  length depend on how badly it was played, which is how "survive" games fail to terminate.
- **Beasts do not vary in speed within a wave.** A pincer whose two halves closed at different
  rates would make its answer arithmetic nobody can do in 1.79 s. Every beast in a wave shares a
  speed, so a pair is read as a shape rather than solved.

## Two things for whoever picks this up

- **The two-jump branch of `plannedPress` is inert against the shipped course.** The gap between
  waves never falls below 1.0 s, so no pair is ever 0.52 s to `planHorizon` apart. It is kept
  because it is the correct rule and a tightened course would need it, and it is covered by a
  test on a hand-built board so that tightening the course would not be relying on untested
  code.
- **The bot does not model reading.** It commits at a fixed lead and never has to see anything,
  so the speed ramp is exactly flat for it. If a future ladder wants to model a person losing
  the last third of a course, the honest place is a term that widens `pressError` as
  `visibleLead` shrinks — but sweep it against `pressError` first, because on the evidence here
  it is likely to be a second spelling of the same knob.
