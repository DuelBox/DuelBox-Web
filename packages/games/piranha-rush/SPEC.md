# Piranha Rush — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 60 s advertised, and 59.82 s proved

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against the shipped `rules.ts` — the harness is described
> under "How the numbers were taken".

Two lagoons, one at each end of the device, with a swimmer in each. Four piranhas hunt you
from the first frame, slower than you can swim and getting faster every second, and six
coral heads stand in the water; swimming into one stops you dead for half a second while
the shoal does not wait. You score the distance you swim, and you stop scoring the moment
the shoal reaches you. When both swimmers have been taken, the one who covered more water
wins.

## Observed rules

From the catalogue row: _"Run from the piranhas! And watch out for corals!"_

Both clauses are built, and they are the whole row — it names no target, no collection and
no clock, which is exactly the shape `apps/web/src/data/termination.test.ts` exists to catch.
"Survive as long as you can" is not a win condition, so the two things this specification
spends most of its length on are **what makes the match end** and **what makes it a duel**.

Two departures, both marked below: a coral head is a **cost** rather than an instant loss
(`[ours]`, and for the same reason Frozen Beaks made a hole one), and the row's implied
gesture is not built — see the next section.

## Fairness across input families **[ours]**

**Verdict: cross-device fair.** `sameInputClassOnly` is false, and the manifest says why.

### "Run" is a position, and a position is the one thing a key cannot name

`docs/input-parity.md` rules `rt-split` "fair cross-device" on the grounds that touch's
absolute positioning and the mouse's precision cancel out, and adds that this is "exactly
the kind of claim that is comfortable and might be wrong". This game does not lean on it.
It asks less of an instrument than the archetype allows.

The interaction carries **exactly one quantity, and it is discrete**:

| | Values | How a key names it | How a finger names it |
|---|---|---|---|
| **Heading** | one of nine | which of W A S D are down | the sign of the gap on each axis, with a deadzone |

Eight compass points and a standstill. `InputManager` hands a game `move`, which is already
`(right − left, down − up)` capped to unit length, so the keyboard's whole vocabulary *is*
those nine values; `game.ts` takes the sign of the pointer gap on each axis and lands on the
identical nine, normalised through the same `Math.SQRT1_2`. There is no second verb, no
charge, and no aim.

The pointer therefore never contributes a continuous quantity at all, and the precision
envelope is not even load-bearing: quantising a number whose sign is all anybody reads
changes nothing. What the envelope is used for is the **deadzone**, which is 12 units — four
envelopes, per `docs/input-idiom.md` rule 2 rather than a hand-picked constant.

`game.test.ts` drives the identical walk along each of the eight headings through a real
`InputManager` **four ways** — keys and finger, seat one and seat two — and asserts all four
produce the same lagoon-local path to nine decimals. That is the strongest form of this
claim available to a game: not "the two instruments are comparable" but "the two
instruments and the two seats are the same twenty-four steps".

### The one continuous quantity there is, measured

Position is continuous, and it is rate-limited by the simulation rather than by the
instrument: a key says *which way* and a finger says *where*, and both feed the same
`SWIM_SPEED`. So the honest question is how much two input families can disagree about
*when* a heading changed.

A swimmer swims at **150 units a second**, and one precision envelope in this box is
`min(600, 1000) / 200 = 3` units. So **20 ms of latency is exactly one envelope**, and a
30 ms difference between a key and a thumb moves a swimmer by 4.5 units: one and a half of
the finest distinction the engine permits any device to make, against a 33-unit catch radius
and a 50-unit coral head. That is the argument, and it is falsifiable — pick a swim speed
three times higher and it stops being true.

### There is no action key, and that is the point **[ours]**

`actionHeld` is `keys.action || pointerDown` (`packages/engine/src/input.ts`), so a finger on
the glass *is* the action. A keyboard player can hold a direction without pressing Space; a
pointer player cannot steer without also raising the action, and cannot lower it without
stopping. Any rule bound to the action costs one instrument something the other gets free.

This game never reads the action. Steering and stopping are the entire vocabulary, both
instruments spell them identically, and Space and Enter do nothing at all. A test holds both
through two hundred frames and asserts the match is byte-identical without them. It also
means `docs/input-idiom.md`'s "more than about two committing presses a second" test has
nothing to measure: there are no presses.

### Resting a finger on your own swimmer is how you tread water

Inside the 12-unit deadzone the answer is a standstill, which in this game means tread water
and score nothing — the same thing releasing every key means. Two equally reachable
spellings of one command, and a test covers both.

### What is not fair, and is not fixable here

A trackpad re-clutch is a `pointerup`, and a `pointerup` here is a standstill for as long as
the finger is off the glass. `docs/input-idiom.md` names `pointerCancelled` as a missing
primitive, and the engine cannot tell a cancelled gesture from a deliberate lift. The cost
is smaller than in every drag-and-release game in the catalogue — a standstill is one frame
of not moving rather than a shot taken at the wrong moment — but it is a real cost and it
falls on one input family. It is the first thing to re-measure when #1862's cross-device
harness exists.

## The field

| | Value | Why |
|---|---|---|
| Board | 600 × 1000, portrait | Each seat's lagoon is a full-width band, so an absolute pointer binding reaches every point of it |
| Lagoon | 560 × 470, at (20, 510) and its half-turn | One box in the simulation, placed twice on the device |
| Swimmer | radius 20, swims 150 units a second | The number the fairness argument rests on |
| Start | the middle of the lagoon, always clear of coral | The same opening move for both seats |
| Shoal | 4 piranhas, radius 13, one per corner | Taken when centres come within 33 |
| Reef | 6 coral heads, radius 30, snag radius 50 | Half a second stopped, and the shoal does not wait |
| Deadzone | 12 units = 4 precision envelopes | `docs/input-idiom.md` rule 2 |
| Score | one body length = 40 units swum | About 40 to 70 a match |
| Backstop clock | 90 s | Insurance. It has never fired — see "Termination" |

### One reef, read by both seats — not two reefs that agree **[ours]**

The whole simulation runs in **one lagoon-local frame**. A swimmer's position is a point in
a 560 × 470 box that starts at (0, 0) for *both* seats, and `toBoardX`/`toBoardY` place that
box into the device's half-turn only when something is drawn.

So "both seats face the same hazards" is not a property that had to be arranged and can
drift: `game.corals` is **one list**, and both seats read it. There is no second copy, and
no mirroring step that somebody could accidentally write in board coordinates. The four
piranha home corners and the swimmer's start are shared for the same reason.

The cost is that this is a race on one course rather than a fight over one board: the two
players never contest anything. That is what the catalogue row describes, and it is what the
`rt-split` split makes reachable — `GameHost` gives each seat only its own half of the glass
to start a gesture in, so a shared pond would leave a player unable to press on their own
swimmer at all (`docs/input-idiom.md`, `rt-arena`).

### The reef is a jittered grid, not rejection sampling **[ours]**

Nine cells — x centres 112 / 280 / 448 and y centres 110 / 235 / 360 — jittered by ±26
across and ±12 along. The middle cell is always empty, which is what keeps the swimmer's
start clear without a rejection test, and **two of the remaining eight are left empty**,
which is the only structural variety a match has. Both players get the same two.

A grid rather than rejection sampling because the clearance is then guaranteed by arithmetic
instead of by a loop that might not converge. Measured over **5000 seeds**:

| | Measured minimum | Needed | Slack |
|---|---|---|---|
| Gap between two heads' rims | **42.18** | 40 (a swimmer's width) | 2.18 |
| Nearest head centre to a rim | **86.01** | 70 (30 + a swimmer's width) | 16.01 |

So the reef never seals itself and the rim channel is never closed. `rules.test.ts` checks
both over 300 seeds on every run, along with the start clearance.

The generator draws the **same number of values whichever cells it skips** — a skipped cell
still costs its two draws. A generator whose consumption varies with the board is how two
seats stop being able to share one seed, and a test asserts the stream position after a
layout.

## Termination: the match ends by arithmetic, not by a clock

This is the section the catalogue row makes necessary. A chase game is the classic
non-terminating failure, `roundSeconds` ends nothing anywhere in this repository, and two
games have already shipped unable to finish.

### The argument, in four lines

Every piranha is a **pure pursuer** whose speed is a function of **elapsed time alone** —
never of the score, the board, or how well anybody is playing — and it swims straight at the
swimmer at `piranhaSpeed(t) = 60 + 3.4 t`, capped at the gap so it cannot overshoot. A
swimmer moves at most `SWIM_SPEED · dt` in a step. So by the triangle inequality, on every
step and whatever anybody does:

```
d(t + dt) ≤ d(t) + (SWIM_SPEED − piranhaSpeed(t)) · dt
```

Summing from zero and requiring the result to have fallen to the catch radius gives a
quadratic in `T` whose positive root is `terminationBoundSeconds(dt)`. The `dt` term is
there because the discrete sum under-counts the integral by `PIRANHA_RAMP · T · dt / 2`, so
the number is a bound on **the code** rather than on the calculus.

Nothing about how the match is played enters it. A swimmer that hides in a corner, one that
never moves, one that plays perfectly and one that is stuck on coral for the whole match are
all covered, because the only thing the inequality assumes is that nobody swims faster than
`SWIM_SPEED`.

### Three things are load-bearing, and each would be invisible in a normal test

- **Piranhas swim through coral and swimmers do not.** A pursuer that has to path around an
  obstacle is no longer a pure pursuer and the bound evaporates. It is also the honest
  reading of the row: the reef is what *you* have to watch out for. A test parks a coral head
  exactly between a piranha and its swimmer and asserts the piranha goes straight through it.
- **The speed ramp reads `elapsed` and nothing else.** A shoal that sped up when you were
  doing well would be a feedback loop, not a bound.
- **The pursuit is capped at the gap, never at a lead.** A test asserts a piranha 0.1 units
  away lands exactly on the swimmer rather than past it.

`rules.test.ts` asserts the inequality itself over 4000 randomly driven steps, which is the
premise checked against the code rather than argued.

### The numbers

| Step rate | `terminationBoundSeconds` |
|---|---|
| 15 Hz | 59.867 s |
| 30 Hz | 59.837 s |
| 60 Hz | 59.822 s |
| 120 Hz | 59.815 s |
| 240 Hz | 59.811 s |

**The bound is under the round length the catalogue card advertises**, at every step rate
tested. `roundSeconds: 60` still ends nothing — it is the "about 1 min" on the card — but for
once it is also a *proved ceiling* rather than a hope, and a test asserts the ordering.

The shoal matches a swimmer's own speed at **26.47 s** and is faster than one after that, so
the second half of any long match is unwinnable by running; the bound is where even the
longest possible retreat runs out.

### What actually happens, and the backstop

Two bots never get near the bound: matches run **15.1 s at `easy`, 19.6 s at `normal`,
18.8 s at `hard`**. The 90-second backstop clock has **never decided a match** — 180 matches
across the three tiers, zero — and a test counts that rather than asserting it. A separate
test removes the shoal entirely and drives the clock to zero with no step cap at all, so the
branch is exercised rather than trusted.

Two more tests take the same no-step-cap approach to the bound itself: five adversarial
drivers (never move, always north, hide in a corner, random, oscillate) × three step rates ×
eight seeds, with **no loop limit anywhere**, so a game that could not finish would hang the
suite rather than pass quietly.

## Deciding it: what a win is **[ours]**

Both taken is the end of the match. The score is the higher distance swum, through the SDK's
`highest-when-time-expires`, which is also what makes two swimmers finishing level a draw
rather than a win for whichever seat the loop reached first.

### The tie-break cannot be a position, and here that is certain rather than likely

Maze Paint's finding: on a symmetric board no tie-break written in board coordinates can
settle a level position, because a covariant rule returns the mirror answer. In this game it
is not merely likely to fail — it is **guaranteed** to, because the two lagoons are not
congruent copies, they are the same six coral heads at the same six coordinates. "The
swimmer further up the lagoon", "the swimmer nearer the middle", "the swimmer with more open
water" all return the same number for both seats by construction.

The tie is also an everyday event rather than a measure-zero one: the score is a whole number
of body lengths and two players of a standard land on the same one often. Measured over 600
seeds a tier on the shipped code, **7.3 %, 10.2 % and 15.0 % of matches at `easy`, `normal`
and `hard` end level on lengths** — every one of which a score-only rule would draw.

So the chain is two quantities that are not functions of the board, in order:

1. **The swimmer taken later wins.** A time, counted from the start of the match, and the
   honest reading of "run from the piranhas": the one who ran longer ran better.
2. **Level on that too, the swimmer that hit fewer coral heads wins.** A count of events.
   It catches the case the first cannot — both taken on the same step.

Level on all three is a genuine draw. Measured over 600 seeds a tier: **1, 3 and 7 draws**
out of 600 at `easy`, `normal` and `hard` — 0.2 %, 0.5 % and 1.2 % — and every one of them is
a pair taken on the same step with the same score and the same snag count, which is two
people who played the same match.

A test drives 200 scrambled boards into perfectly level positions, asserts a draw, then moves
**one event** — not one coordinate — and asserts it decides.

### Why the score is distance and not survival time

They are close cousins in a game with one speed, and either would work. Distance is the
primary because it is the one a player can *watch* — it is drawn as a bar along their own
shore, it never goes down, and treading water is worth exactly nothing, so a swimmer that
hides in a corner scores nothing and dies anyway. Survival time is the tie-break precisely
because it is the quantity distance rounds away.

The score does not saturate: `hard` averages 58.2 body lengths against `easy`'s 38.6 over the
same match length, and nothing caps it.

## Seat balance: 50.0 % by construction, and asserted board by board

The two seats do not run mirror-image simulations that have to be *shown* to agree. They run
the **identical arithmetic on the identical numbers** — same box, same reef list, same start,
same corners — so seat symmetry is a property of the type rather than a measurement.

### What the mirror test is, in a game with no mirror

The usual half-turn test does not apply here: there is no coordinate reflection to undo,
because both lagoons *are* the same coordinates. The corresponding transform is **swapping
the seats**, and a rule that failed to be covariant under it would have to be a rule that
reads the seat's name.

Four tests, written before the game was tuned, and they are the most valuable in the package:

- **`step()` on 800 scrambled boards.** Swap the two seats' whole state and their commands,
  step both, and require the results to be exact swaps — every position, previous position,
  heading, snag timer, distance, snag count, liveness, death time, flash timer and every
  piranha, to twelve decimals. Boards are scrambled onto the 2.5-unit lattice an axis-aligned
  swim actually produces, and **30 % of swimmers are pinned exactly on a rim in x, 30 % in y,
  and 12 % of piranhas placed at exactly the catch radius**, so the thresholds a state
  variable lands on by construction are everyday events in the sample rather than
  measure-zero ones.
- **One command stream, both seats, 4000 steps.** Their whole states must stay
  **bit-identical**. This is the strongest form of the check available to any game in the
  catalogue, and it is only available because of the shared frame.
- **Both seats pinned against a rim for 1200 steps.** The Frozen Beaks family aimed at
  directly: `clamp` puts a swimmer *exactly* on `MIN_X`, which is the value `rimAlong`
  divides against and the value the next step's clamp compares. Both seats reach it, and they
  must reach the same one.
- **`chooseHeading` on 1200 boards across three tiers**, asked of both seats, compared with
  `toBe` rather than `toBeCloseTo`.

The one place a knife edge could still have hidden is the **input mapping**, because that is
the only code that knows about board coordinates. The deadzone comparison is `<=` against a
threshold a quantised pointer can land on exactly: the swimmer starts at board x 300 for both
seats, and 312 and 288 are its mirror images and both on the 3-unit lattice. A test places a
finger on exactly that edge from both seats and asserts both tread water, and one envelope
past it and asserts both swim the identical distance.

### The one asymmetry there is, and what it costs

`game.ts` derives two bot generators from the match seed in a fixed order. That is a
**stream** asymmetry rather than a seat one, and the difference is testable: exchanging the
two generators produces the exact swap of the same match. Asserted over **300 matches across
three tiers: zero winners flipped and zero scorelines differed.**

So the two arms below are exact complements, which is the half-turn property showing up in
the balance table rather than in a unit test, and the mean is **50.0 % with no sample behind
it at all**:

| Equal tiers, 600 seeds | A | B | mean | draws |
|---|---|---|---|---|
| easy v easy | 269 / 330 = 44.9 % | 330 / 269 = 55.1 % | **50.0 %** | 1 (0.2 %) |
| normal v normal | 290 / 307 = 48.6 % | 307 / 290 = 51.4 % | **50.0 %** | 3 (0.5 %) |
| hard v hard | 293 / 300 = 49.4 % | 300 / 293 = 50.6 % | **50.0 %** | 7 (1.2 %) |

And what those matches look like:

| | length | body lengths a seat | coral hit a seat |
|---|---|---|---|
| easy | 15.1 s | 38.6 | 0.97 |
| normal | 19.6 s | 59.5 | 0.95 |
| hard | 18.8 s | 58.2 | 0.15 |

The coral column is the ladder in one number: the better tier is better at **not hitting the
reef**, not at swimming faster — every tier swims at exactly `SWIM_SPEED`.

### Against the repository's own harness

`apps/web/src/data/balance-aggregate.test.ts` measures every game over 50 seed pairs at a
frozen idle input, playing each seed once per opening seat. Replicated exactly against this
package's built `dist`, at all three tiers:

| tier | seat one | decided | draws | unfinished | mean match | `openerSwung` | `distinct` |
|---|---|---|---|---|---|---|---|
| easy | **52.0 %** | 100 | 0 | 0 | 16.9 s | 0 | 50 |
| normal | **54.0 %** | 100 | 0 | 0 | 22.0 s | 0 | 50 |
| hard | **52.0 %** | 100 | 0 | 0 | 19.6 s | 0 | 49 |

All three are inside the **flat 45–55 % band**, not merely inside the 21.2-point allowance
that sample gets. `openerSwung` is 0 because a real-time game has no opener — the SDK
contract says so outright — and both swimmers start at the same point of the same lagoon, so
there is nothing for `context.openingSeat` to name and inventing something would manufacture
the first-mover advantage the shell alternates it to remove. `getActiveSeat` is not
implemented at all, which `apps/web/src/data/turn-seat.test.ts` requires of an `rt-*` game.

## The bot

Three knobs, and each is a different thing a person is better or worse at.

| Knob | `easy` | `normal` | `hard` | What it is |
|---|---|---|---|---|
| `think` | 0.40 | 0.26 | 0.16 | Seconds between decisions |
| `blunder` | 0.26 | 0.14 | 0.04 | Chance a decision comes out as nothing at all |
| `lookAhead` | 0.55 | 1.00 | 1.50 | Seconds of swimming it projects before scoring a heading |

Nothing in any of them is information a player does not have. Every coral head, every piranha
and the shoal's own speed are on the board and drawn — the speed as a gauge down the middle
of the device, symmetric about the centre line, precisely so that "they are faster than me
now" is something a player reads rather than something a bot knows. What a weaker tier is
denied is attention, care and foresight, never sight. A test asserts every heading a bot
emits is one of the nine a person's keys or finger produce, and that its swim is the same
`SWIM_SPEED`; another asserts a bot's answer does not change when the *other* seat's whole
state is rewritten, because there is nothing across the divider for it to read.

The bot makes **one** choice — which of eight headings to swim — and scores each by the
daylight it buys: project along it for `lookAhead` seconds or up to whatever the reef and the
rim allow, and ask how close the shoal would be to the halfway point and to the far end,
allowing for how far a piranha travels in the same time. Two samples rather than one, because
a piranha sitting halfway along a line is not visible from its far end. Two values are drawn
per decision — the gap to the next one and the blunder roll — unconditionally, before
anything branches on the water, and a test asserts the count.

`coralAlong` is an analytic ray-to-circle and `crossesCoral` is a swept segment test, and
they must agree exactly or the bot is planning against a different reef from the one it is
standing on — issue #2465's shape. A test drives 2000 random headings through both.

### Every knob, swept alone

`hard`'s value varied with everything else as shipped, against an untouched `normal`, **300
seeds in each seat order (600 matches a row)**, and it is the varied bot's win rate:

| `think` | win | | `blunder` | win | | `lookAhead` | win |
|---|---|---|---|---|---|---|---|
| 0.08 | 58.8 % | | 0 | 63.3 % | | 0.1 | 38.6 % |
| 0.12 | 59.2 % | | **0.04** | **60.8 %** | | 0.3 | 40.8 % |
| **0.16** | **60.8 %** | | 0.10 | 55.6 % | | 0.55 | 55.2 % |
| 0.26 | 57.1 % | | 0.14 | 53.1 % | | 1.0 | 62.8 % |
| 0.40 | 42.1 % | | 0.26 | 41.7 % | | **1.5** | **60.8 %** |
| 0.60 | 21.0 % | | 0.45 | 30.3 % | | 2.2 | 60.8 % |
| 0.90 | 12.8 % | | 0.70 | 10.8 % | | 3.5 | 60.3 % |

Three sigma over 300 seeds is about **9 points**, and a seed is the independent unit even
though each is played twice. So:

- **`blunder` is monotone end to end** and is the strongest of the three: 63.3 % to 10.8 %.
  Only its top step (0 to 0.04, 2.5 points) is inside noise.
  It is a blunder rate rather than an aim error deliberately, because a blunder is not a
  direction and so cannot double as a tactic the way Snowball Throw's aim error did.
- **`think` is monotone over the shipped range and flat below about 0.16.** At 0.08 to 0.16
  the three readings sit inside noise of each other: a bot re-planning five times a second is
  already re-planning faster than the board changes. `hard` sits at the top of that plateau
  and the tier separation on this knob comes from `normal` and `easy`.
- **`lookAhead` is a strong knob up to about 1.0 and then saturates.** 0.1 to 1.0 is a
  24-point swing; 1.0 to 3.5 is flat. **`hard`'s 1.5 therefore buys nothing measurable over
  `normal`'s 1.0.** It is kept rather than deleted because the knob is doing real work at the
  bottom of the ladder and the plateau is wide, but it is doing two thirds of a job and that
  is recorded here rather than implied by the table.

### Two constants that were swept, found not to be difficulty knobs, and kept as shape **[ours]**

`ESCAPE_ROOM` (how much clear water a bot insists on before it will take a heading) and
`ROOM_WEIGHT` (what open water is worth against daylight from the shoal) both look like
"how careful is it" dials. Swept alone, with every tier sharing the value:

| `ESCAPE_ROOM` | 0 | 20 | **40** | 70 | 110 | 160 |
|---|---|---|---|---|---|---|
| `hard` v `normal` | 46.4 % | 70.0 % | **60.8 %** | 44.4 % | 25.5 % | 20.6 % |
| coral hit a match | 6.01 | 1.82 | **0.17** | 0.00 | 0.00 | 0.00 |

| `ROOM_WEIGHT` | 0 | 0.04 | **0.12** | 0.3 | 0.8 | 2.0 |
|---|---|---|---|---|---|---|
| `hard` v `normal` | 57.8 % | 56.7 % | **60.8 %** | 71.0 % | 44.7 % | 63.3 % |
| match length | 18.5 s | 19.7 s | **19.0 s** | 15.4 s | 3.9 s | 3.9 s |

Neither is monotone: both have an **interior optimum**, so one side of the peak would make
the *weaker* tier better, and a parameter like that cannot be a difficulty dial. Past
`ROOM_WEIGHT` 0.5 a bot chases open water instead of running from anything and the average
match collapses from 19 s to 3.9 s; at `ESCAPE_ROOM` 0 it simply swims through the reef.
Both are therefore shape constants with principled values — one body diameter, and a small
tie-break weight — rather than knobs, and this table is why.

### Cross tier, both seat orders, 300 seeds each

| | as seat one | as seat two | agreement |
|---|---|---|---|
| `hard` v `easy` | 75.3 % | 79.7 % | 4.4 points |
| `normal` v `easy` | 70.0 % | 75.3 % | 5.3 points |
| `hard` v `normal` | 61.0 % | 60.7 % | 0.3 points |

Monotone, and every pairing agrees with itself across the two seat orders well inside the
9-point three-sigma error of a 300-seed row. `rules.test.ts` carries a cheap version that
fails if any of them ever inverts.

## The shoal's numbers, and why they are those numbers **[ours]**

`piranhaSpeed(t) = 60 + 3.4 t`, and both halves were measured rather than chosen. The
constraint is two-sided: a shoal that opens fast has the pincer close before anybody has
swum anywhere, and one that ramps slowly pushes the termination bound past the advertised
round length.

| base, ramp | crossover | bound | `easy` match | `hard` match | `hard` v `normal`, seat one |
|---|---|---|---|---|---|
| 96, 2.2 | 24.5 s | 59.7 s | 7.6 s | 11.7 s | 66.3 % |
| 80, 2.6 | 26.9 s | 62.5 s | 12.6 s | 15.4 s | 63.1 % |
| 70, 3.0 | 26.7 s | 61.0 s | 14.3 s | 17.2 s | 66.5 % |
| **60, 3.4** | **26.5 s** | **59.8 s** | **15.1 s** | **18.8 s** | **61.0 %** |
| 80, 2.0 | 35.0 s | 78.9 s | 15.7 s | 19.9 s | 56.1 % |

Four piranhas rather than three, and the reason is the opposite of the obvious one. At three
the shoal *cannot* corner anybody in a straight line, so a swimmer runs until the ramp
catches it and the reef never has to be chosen through — measured, `normal` and `hard`
matches fall from 19.6 s and 18.8 s to **6.4 s and 5.5 s** and the score with them, because
the whole match becomes the last two seconds of the ramp. A pincer is what makes the reef
matter.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called through a whole match, and
another asserts the two seats' primitives never cross over.

- **Seat one is round and seat two is square, everywhere**: the swimmer's body, the ring it
  flashes when it hits coral, the marker where it was taken, and the three milestones on its
  tally. Two swimmers on one screen at once is the pair most likely to be confused, and the
  two seat colours sit at **1.03:1 under deuteranopia**
  (`packages/engine/src/palette-vision.test.ts`), so for those players the shape is not a
  layer over colour — it is the only signal there is.
- **One stripe of seat colour along seat one's shore, two along seat two's.** A fixed
  multiplicity, so it reads as a pattern rather than as a score, and it survives its swimmer
  being taken.
- **Three primitives for the three kinds of thing on the board.** A piranha is an arrowhead
  of three strokes pointing the way it is coming; a coral head is a six-spoked burst with a
  dark core; a swimmer is a filled body. None of them is a plain disc of another's size,
  which matters because the thing a player must tell apart at a glance while running is a
  coral head from their own swimmer.
- **A taken swimmer keeps its own primitive** and goes translucent, with two ink strokes
  through it. The picture after a lagoon has finished still says whose lagoon it was.
- **The nose points the way the swimmer is heading**, so a committed direction is readable
  without colour.
- **The shoal-speed gauge is symmetric about the centre line** — literally the same object
  from either side of the device, with a notch at the speed where the shoal matches a
  swimmer. Neither player is reading a gauge the other cannot.
- **The tally is a length, not a number**, with three seat-shaped milestones on it.

A local copy of `apps/web/src/data/greyscale.test.ts`'s question lives in `game.test.ts`, so
this package fails on its own before the shared guard does.

## Rule 8: no pixels, and rule 9: no extra field of view

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the input mapping, the palette and the drawing, and reads the simulation
without adding to it — a test renders forty frames at five different alphas and asserts
nothing moved, and another asserts a swimmer interpolates by the alpha at 0, 0.5 and 1.

A test asserts **no seat-coloured mark is ever drawn in the other seat's half of the board**,
over 75 sampled frames of a full match, which is rule 9 in a picture. Another asserts every
drawn point of every object, at its full radius, stays inside the declared 600 × 1000 box
over 3000 steps.

Nothing here reads `presentation`, and a test asserts the same seed plays the identical match
in both, from both local seats.

### The half-turn costs the two input channels differently, and it is easy to get backwards

The lagoon frame is already **each seat's own upright view** — local `+x` is the player's own
right and local `+y` is the water in front of their own shore, for both of them. So:

- **The keyboard needs no per-seat sign at all.** `InputManager` reports `move` in device
  orientation, and the far seat *means* the opposite of what the device saw; the two flips
  cancel.
- **The pointer needs exactly one.** A finger names a point on the glass, which is the same
  point from either side, so the board-space gap is turned into the seat's frame by
  `seatAxisSign`.

Frozen Beaks needs the mirror image of that — a sign on the keys and none on the pointer —
because its birds are stored in board coordinates. Same half-turn, one layer down. Both
directions are asserted.

## What is not built, and what is not verified

**Not built from the row.** Nothing in it is left out; what is *added* is the win condition,
because the row has none. A pure "survive as long as you can" is what
`termination.test.ts` exists to reject.

**Not built [ours]:** a coral head as an instant loss. The row says "watch out", which reads
as one. It is not one here for the same two reasons Frozen Beaks gives about its holes: an
instant loss makes a match end in the first few seconds and turns the whole reef into
decoration, and a pure time cost is trivially avoidable by never going near one. Half a
second stopped while a shoal that is still accelerating closes on you is three costs at once
— position, distance, and the gap you were about to take.

**Not built [ours]:** any second verb — a dash, a dive, a burst of speed. It would be the
obvious way to make the game deeper, and it is exactly the thing that would need an action,
which is the one input channel the fairness argument above says cannot be made even. The
depth is in the reef instead.

**Not verified:**

- **Anything on a trackpad, or across two real devices.** `docs/input-parity.md` and
  `docs/input-idiom.md` both record that gap; #1862's harness does not exist. The re-clutch
  argument above is the one that is comfortable and might be wrong.
- **Anything against a human.** Every balance number here is bot against bot. A bot never
  deliberately runs a long way round to keep a coral head between itself and the shoal, so a
  human match will look different from these tables — probably longer, and with more of the
  score decided by the reef.
- **The exact mirror of a quantised pointer.** `latticeSurvivesTurn` is false for a 600 × 1000
  box: 1000 is not a whole number of 3-unit envelopes, so a mirrored board point can quantise
  half a cell away from its twin. That is an engine asymmetry rather than anything this
  package can fix (quantise before the turn, not after it), and it is why the deadzone test
  above is written on the x axis, where 600 *is* a whole number of cells. It cannot reach the
  simulation, because the only thing the game reads from a pointer is a sign.
- **The size budget as CI measures it**, which needs `pnpm build` and belongs to the
  orchestrator. Minified and gzipped locally the chunk is **4831 bytes against the
  12288-byte budget** in `size-budget.json`, measured the same way that puts Frozen Beaks
  at 5418 and Snowball Throw at 4827.

## How the numbers were taken

Every figure comes from driving the shipped `rules.ts` directly — `botStep` against a
constructed profile for the sweeps, `botCommand` for the pairings — with a generator for the
reef and one per seat derived from one match seed, exactly as `game.ts` derives them. Match
lengths are simulated seconds, not wall clock. The harness lived in the package while the
game was being tuned and was deleted; `rules.test.ts` carries a cheap version of the ladder,
the seat balance and the swap check that fails if any of them ever inverts.

The `balance-aggregate` replication and the cross-viewport, bot-cost, fuzz and termination
figures were taken from the built `dist/index.js` through the shared guards' own code, so
they are measurements of the shipped module rather than of a test fixture.
