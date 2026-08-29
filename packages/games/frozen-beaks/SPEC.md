# Frozen Beaks — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 90 s advertised and enforced

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against the shipped `rules.ts` — the harness is described
> under "How the numbers were taken".

Two ice floes, one at each end of the device, with a bird on each. Walk and you go slowly
but you can steer; stop walking and the bird launches into a slide it cannot steer at all.
Fish are taken by touching them and holes in the ice swallow anything whose centre crosses
the rim. The two floes are half-turn images of one another, so both players race the
identical course. First to thirty fish wins.

## Observed rules

From the catalogue row: _"Collect 30 fish! Move your finger to walk and release it to slide
on the ice! Don't fall in the hole!"_

All four clauses are built: thirty fish through the SDK's `first-to`, a walk, a
release-to-slide, and a hole that costs you.

What is **not** built is the row's implied gesture. "Move your finger to walk" is an
*absolute position*, and a position is exactly the quantity `docs/input-parity.md` says a
thumb can name and a key cannot. The next section is the decision the whole design turns
on, and it is the same move Snowball Throw made for the same reason.

Two smaller departures, both marked below: the hole is a **cost** rather than an instant
loss, and there is **no action key at all**.

## Fairness across input families **[ours]**

**Verdict: cross-device fair.** `sameInputClassOnly` is false, and the manifest says why in
a comment.

### What the row asks for, and what this game asks for instead

The interaction carries **exactly two quantities**, and both are discrete:

| | Values | How a key names it | How a finger names it |
|---|---|---|---|
| **Heading** | one of nine | which of W A S D are down | the sign of the gap on each axis, with a deadzone |
| **Slide** | one of three | how long before letting go | how long before lifting |

Eight compass points and a standstill. `InputManager` hands a game `move`, which is
already `(right − left, down − up)` capped to unit length, so the keyboard's whole
vocabulary is those nine values; `game.ts` takes the sign of the pointer gap on each axis
and lands on the identical nine, normalised through the same `Math.SQRT1_2`. A test asserts
the bot's headings are drawn from that same set, and `game.test.ts` drives the same walk
through a real `InputManager` on both instruments and asserts **the slide that leaves is
the same object** — same tier, same heading, same launch point.

On top of the heading sits a position, and the position is rate-limited by the simulation:
a key says *which way* and a finger says *where*, and both feed the same `WALK_SPEED`.
Neither instrument can walk a bird faster than the other, and neither can name a heading
more finely, because the only quantity either one produces is the sign of a gap.

### The one continuous quantity there is, measured

Where a slide starts is continuous — it is wherever the bird happened to be when the player
let go — so the honest question is how much two input families can disagree about that.

A bird walks at **120 units a second**, and one precision envelope in this box is
`min(600, 1000) / 200 = 3` units. So **25 ms of latency is exactly one envelope**, and a
30 ms difference between a key and a thumb moves the launch point by 3.6 units: about one
and a fifth of the finest distinction the engine permits any device to make, against a
34-unit pickup radius and a 40-unit hole. That is the argument, and it is falsifiable: pick
a walk speed three times higher and it stops being true.

### Three sizes, so releasing near a boundary is worth nothing

A continuous power meter has its optimum at the top of the meter, so every player releases
at a boundary and every millisecond of latency is a distance. The three tiers have plateaus
of **0.45 s and 0.55 s**: you let go comfortably inside the tier you want, and 30 ms is
under 7% of the narrower one. `rules.test.ts` asserts the plateau widths rather than
leaving them to drift.

### No rapid pressing, and the number

`docs/input-idiom.md` promotes the real rule out of three manifest comments: a game is
same-input-class-only when winning requires more than about **two committing presses a
second**. A slide reads no input at all, so the fastest possible cycle is one wind-up plus
one whole slide — `0.30 + 1.0095 = 1.3095 s`, a ceiling of **0.764 releases a second**.
Measured, a bot releases **0.585 to 0.616 times a second** at every tier. `rules.test.ts`
asserts the ceiling.

### There is no action key, and that is the point **[ours]**

`actionHeld` is `keys.action || pointerDown` (`packages/engine/src/input.ts`), so a finger
on the glass *is* the action. A keyboard player can hold a direction without pressing
Space; a pointer player cannot walk without also raising the action, and cannot lower it
without stopping. Any rule bound to the action therefore costs one instrument something the
other gets free — the asymmetry Snowball Throw had to route around with a free-running pack
clock.

This game does not route around it. **It never reads the action.** Walking and stopping
walking are the entire vocabulary, both instruments spell them identically, and Space and
Enter do nothing at all. A test holds Space through a whole wind-up and asserts the charge
is bit-identical to the run without it.

The cost of that choice is that the game has no discrete second verb — no dig-your-claws-in
emergency stop — because a stop is the one thing a finger cannot signal without lifting,
and lifting is already the slide. The commitment is the game, so this was cheap.

### The heading is the one walked on the step *before* the release

`docs/input-idiom.md` lists this as fact 2 of the three every game rediscovers: **the
pointer is already null on the step that reports the lift**, so a heading read on the
release step is a standstill for a finger and a direction for a key — the same gesture, two
different slides. `Bird.lastDirX/lastDirY` carries the previous step's heading, which needs
no private flag and is identical for both instruments by construction.

### Resting a finger on your own bird is the release

The pointer deadzone is **12 units = 4 precision envelopes**, per `docs/input-idiom.md`
rule 2 rather than a twenty-third hand-picked constant. Inside it the answer is a
standstill — and a standstill in this game *is* the release, so a player who slides their
finger back onto their own bird launches exactly as one who lifts does. That is a second,
equally reachable spelling of the same command, and a test covers it.

### What is not fair, and is not fixable here

A trackpad re-clutch is a `pointerup`, and a `pointerup` is a slide. The engine cannot tell
a cancelled gesture from a deliberate lift — `docs/input-idiom.md` names `pointerCancelled`
as missing primitive 1 — so a re-clutch mid-walk launches a slide early.

Being straight about the size of it: the binding is absolute over a 516-unit-wide lane in a
600-unit box, which is wider than the third of the short side that document says a gesture
may ask for without a lift, so a trackpad player crossing the whole floe in one motion will
sometimes have to re-clutch. What it costs them is one slide taken at the wrong moment. It
is the same cost every drag-and-release game in the catalogue pays; it is a real cost and it
falls on one input family; and it is the first thing to re-measure when #1862's cross-device
harness exists.

The shell's pause is the same event and **is** handled. `onPause`/`onResume` both call
`plantFeet`, which forgets the wind-up without launching, because `InputManager.clear()`
delivers a standstill on the first step back and a standstill is a release. Without it,
opening the pause menu mid-walk slides the bird on the way out. A test covers both
directions.

## The field

| | Value | Why |
|---|---|---|
| Board | 600 × 1000, portrait | Each seat's floe is a full-width band, so an absolute pointer binding reaches every point of it |
| Floes | x ∈ [20, 580]; y ∈ [520, 980] and [20, 480] | Half-turn images about (300, 500) — the board is its own half-turn |
| Bird | radius 22, walks x ∈ [42, 558] | 516 units of lane, 4.3 s to cross at walking pace |
| Home | (300, 930) and (300, 70) | The middle of each player's own shore: always dry, and the same move for both seats |
| Hole | radius 40, five of them | You fall when your **centre** crosses the rim, so a beak over the edge is survivable |
| Fish | radius 12, six on the ice | Taken on contact at 34 units; a new one surfaces 0.9 s later |
| Walk | 120 units a second | Identical for a key and a finger, and the number the fairness argument rests on |
| Deadzone | 12 units = 4 precision envelopes | `docs/input-idiom.md` rule 2 |
| Clock | 90 s | The termination guarantee, and the same 90 the manifest advertises |
| Target | 30 fish | The catalogue row, through the SDK's `first-to` |

### The ice is laid out on a jittered grid, not by rejection **[ours]**

Six cells — x centres 170, 300, 430 and y centres 650, 800 — and five of them get a hole,
jittered by ±22 across and ±28 along. Which cell is left empty is the only structural
variety a match has.

A grid rather than rejection sampling because the separation is then guaranteed by
arithmetic instead of by a loop that might not converge: cells are 130 apart across and 150
along, so **no two holes are ever closer than 86 units**, against the 80 at which two would
merge. `rules.test.ts` checks that over 200 seeds, along with the home clearance.

Fish spawn points *are* rejection-sampled — 64 of them, each wanting 90 units of clearance
from every hole — because the constraint is against an already-placed set and a grid cannot
express it. The loop is bounded at 40 attempts and **settles for the best candidate it saw**
rather than looping, so `resetGame` always terminates. A test records how often it has to
settle: **fewer than 2% of spawn points** over 60 seeds, and every one of them still leaves
a bird room to stand beside the fish and stay dry.

### Both players race the identical course **[ours]**

The layout is generated once, in seat one's frame, and seat two reads the same list through
the half-turn `(x, y) → (600 − x, 1000 − y)`. Every hole and every spawn point is therefore
a mirror image, and **neither seat can draw the easier board**.

That is not the only way to build it — two independent layouts would have been simpler —
but it is the only one that makes the seat-balance claim structural rather than statistical.
Random layouts would put luck in the result and the balance table below would be measuring
the layout generator as much as the game. The cost is that this is a race on one course
rather than a fight over one board: the two players never contest a fish. That is what the
catalogue row describes, and it is what the `rt-split` split makes reachable — see the next
section.

### Why the two floes are separate and not one shared pond

A shared pond would make fish contested and the game more of a duel. It is not available.
`GameHost` gives each seat only its own half of the glass to *start* a gesture in, so an
absolute binding over a shared pond has the reachability hole `docs/input-idiom.md`
describes for `rt-arena`: a player whose bird is in the far half cannot press on it at all.
The document's answer there is an anchored drag, which is a displacement — a continuous
quantity, and the thing this game is built to avoid. Two full-width bands and an absolute
binding is the `rt-split` idiom precisely because it reaches everything, and that is the
trade taken.

## Walking, sliding, and the shape of the decision

Walking is slow and steerable. Every step spent walking also **winds up** a slide, and
stopping spends it:

| Tier | Wind-up | Launch | Slide | Reach | Ground covered a second |
|---|---|---|---|---|---|
| glide | 0.30 s | 460 | 1.010 s | 180.2 | 165.1 |
| dash | 0.75 s | 760 | 1.228 s | 310.5 | 202.5 |
| bolt | 1.30 s | 1040 | 1.364 s | 432.1 | 220.8 |

against **120 units a second** for walking and never letting go. So sliding is 1.4 to 1.8
times as fast as walking, and the biggest slide is the fastest way across the ice — but a
bolt asks for a **wind-up of 1.30 s in one direction and then 432 units of clear ice**, on
a floe 516 by 416, and while it is away the bird cannot steer out of anything. The `dash` is
the workhorse and the `bolt` is situational, which is the decision the game exists to pose.

A walk that stops **before** the first tier launches nothing at all. That is what caps the
release cadence, and it is also a real move: a dab of a key or a finger repositions you by a
few units and commits you to nothing.

Turning while walking is free — the wind-up counts walking, not straightness. Winding up on
the spot by oscillating is therefore legal and is a genuine tactic rather than an exploit:
it buys you the launch heading you want at the price of going nowhere for a second and a
half, which is a fish and a half to somebody who kept moving.

The rim is packed snow: a slide into it stops dead rather than bouncing, so over-charging
wastes the difference. A test asserts it.

### The slide integrator and the bot's arithmetic are the same number

`stepSlide` covers `(v_before − v_after) / GLIDE_RATE` in a step, which is the analytic
integral of `v(t) = v₀ · GLIDE^t`; the terms telescope, so a whole slide totals
`(v₀ − STOP_SPEED) / GLIDE_RATE` **however finely it is sliced**, and the last step coasts
the exact distance left to the stop line rather than overshooting whichever step happened to
cross it.

Forward Euler instead overshoots, and the size of it is why this matters:

| Step rate | Euler travel | Exact travel | Overshoot |
|---|---|---|---|
| 30 Hz | 322.856 | 310.521 | **+3.97%** |
| 60 Hz | 316.778 | 310.521 | **+2.02%** |
| 120 Hz | 313.768 | 310.521 | **+1.05%** |

That is the systematic bias commit b4af006 found in five games — the same slide would be a
different slide on a 120 Hz phone, and `REACH`, which the bot consults on **every** release
decision, would be permanently 2% out. No amount of tier tuning reaches a bias like that,
which is exactly what Cannon Duel's 7.6 units against a 52-unit target demonstrated.

Measured on the shipped code, the same launch run at four step rates:

| Tier | 60 Hz | 90 Hz | 120 Hz | 240 Hz | spread | vs `REACH` |
|---|---|---|---|---|---|---|
| glide | 180.232209989850 | 180.232209989850 | 180.232209989850 | 180.232209989849 | 2.0 × 10⁻¹³ | 0 |
| dash | 310.520554560825 | 310.520554560825 | 310.520554560825 | 310.520554560825 | 4.0 × 10⁻¹³ | 1.7 × 10⁻¹³ |
| bolt | 432.123009493735 | 432.123009493736 | 432.123009493735 | 432.123009493735 | 5.1 × 10⁻¹³ | 1.7 × 10⁻¹³ |

`rules.test.ts` asserts all of it to nine decimals. A separate test reconstructs the Euler
sum and asserts it is between 1.5% and 2.5% long, so the thing being avoided is on the
record rather than in a comment.

### Collision is swept, never sampled

A `bolt` covers 17 units in a 60 Hz step and a hole rim is a line with no thickness, so a
static test at the two ends of a step would let a bird skate over one. `sweptCircleCircle`
solves the whole step for the holes and for the fish, and the **earliest** contact wins, so
a fish on the near lip of a hole is eaten on the way in. A test fires a bird at 5000 units a
second — nearly five times the fastest tier — on a 30 Hz step, 167 units a step against an
80-unit hole, and asserts it still goes in.

## Falling in **[ours]**

The row says "don't fall in the hole", which reads as a loss condition. It is not one here:

- **An instant loss makes the fish decoration.** Two `easy` bots fall in about 9.7 times a
  match between them; a match decided by the first slip would be over in seconds and the
  thirty fish would never be reached, which is the trap `apps/web/src/data/termination.test.ts`
  and the catalogue row are on opposite sides of.
- **A pure time cost is trivially avoidable.** A player who never slides never falls in.

So a dunk costs **1.6 s in the water, two fish, and your position** — you climb out at the
middle of your own shore, which is the one square of ice guaranteed to be dry. Three costs
rather than one, and measured: `easy` gives up 9.7 dunks a match and still reaches thirty
fish 98% of the time, `hard` gives up 2.4 and reaches it every time. The score is allowed to
go down and is floored at nothing; a test covers the floor.

The score can therefore move backwards, so the match is not guaranteed to terminate by
monotone progress. The clock is the guarantee — see below.

## Scoring and the end of a match

Thirty fish, through the SDK's `first-to`. Both floes are stepped before either score is
read, so **two birds crossing thirty in the same step is a draw** rather than a win for
whichever seat the loop reached first, and a test covers it.

The whistle is settled in `judge` rather than by passing `timeExpired`, because this game
has a tiebreak the helper has no way to know about: level on fish, the bird that **fell in
fewer times** takes it. A score is one of thirty-one values and two players of the same
standard sit on the same one of them often. In practice it almost never has to arbitrate:
**draws are 0.07–0.13% of matches** across 1500 seeds a tier, because 98–100% of matches
reach thirty fish first.

The clock is 90 s and it is the only structural end. `roundSeconds` ends nothing — it is
text on a catalogue card — and a test asserts the two numbers are the same 90. A second test
plays a match in which **neither bird ever moves**, with **no step cap at all**, so a match
that could not finish would hang the suite rather than pass quietly; it ends drawn on the
step the clock says.

## The bot

Three knobs, and each is a different thing a person is better or worse at.

| Knob | `easy` | `normal` | `hard` | What it is |
|---|---|---|---|---|
| `think` | 0.38 | 0.26 | 0.18 | Seconds between decisions |
| `blunder` | 0.28 | 0.17 | 0.07 | Chance a decision sees nothing at all |
| `patience` | 0.15 | 0.32 | 0.60 | Seconds past the tier it wanted that it holds out for a good line |

Nothing in any of them is information a player does not have. Every fish, every hole and
both birds' wind-ups are on the board and drawn — the wind-up as three pips over the bird's
head, precisely so that reading an opponent's commitment is a skill and not a privilege.
What a weaker tier is denied is attention, care and patience, never sight. A test asserts
every heading a bot emits is one of the nine a person's keys or finger produce and that its
walk is the same `WALK_SPEED`.

The bot makes **one** choice — which of eight headings to walk — because a heading is walked
and then slid along, so one choice settles both. It scores each heading by the fish a walk
of one thinking-interval followed by a slide of the tier it is holding out for would sweep
up, with the distance to the nearest fish as the tie-break so an empty line still points
somewhere useful, and it refuses outright any heading with less than 46 units of clear ice
in front of it. Three values are drawn per decision — the gap to the next one, the blunder
roll, and the tier it is holding out for — unconditionally, before anything branches on the
board.

### Every knob, swept alone

`hard`'s value varied with everything else left as shipped, against an untouched `normal`,
**1000 seeds a row**, the varied bot in seat one. The shipped row of each block reads 74.5%,
within two tenths of the 74.7% the pairing table below gives for the same arm.

| `think` | win | fish | dunks | | `blunder` | win | fish | dunks |
|---|---|---|---|---|---|---|---|---|
| 0.10 | 77.8% | 28.9 | 1.56 | | 0 | 74.1% | 28.7 | 1.65 |
| 0.14 | 74.6% | 28.7 | 1.67 | | 0.03 | 74.3% | 28.7 | 1.66 |
| **0.18** | **74.5%** | **28.7** | **1.69** | | **0.07** | **74.5%** | **28.7** | **1.69** |
| 0.26 | 66.5% | 28.1 | 1.90 | | 0.15 | 68.3% | 28.3 | 1.86 |
| 0.38 | 59.8% | 27.6 | 2.12 | | 0.28 | 63.1% | 27.8 | 2.01 |
| 0.55 | 43.0% | 25.7 | 2.50 | | 0.50 | 44.0% | 25.7 | 2.52 |
| 0.80 | 21.0% | 21.6 | 3.22 | | 0.75 | 9.9% | 18.4 | 3.34 |

| `patience` | 0 | 0.10 | 0.25 | 0.45 | **0.60** | 1.0 | 2.0 |
|---|---|---|---|---|---|---|---|
| win | 35.7% | 46.9% | 56.9% | 65.7% | **74.5%** | 86.1% | 93.9% |

All three are monotone across the range that matters. Two of them invert by a fraction of a
point at the top — `think` by 0.1 between 0.14 and 0.18, `blunder` by 0.4 between 0 and 0.07
— and both are inside the 1.4-point standard error of a 1000-seed row. `blunder` is
genuinely **flat below about 0.07**, which is worth knowing: `hard` sits at the top of that
plateau and the tier separation on this knob comes from `normal` and `easy`, not from
`hard`.

`patience` is the strongest and also the termination guarantee: a bot that waits for a line
that never comes is how a real-time bot deadlocks, so past `patience` it lets go whatever
the ice looks like. A forced release into a hole is a dunk, and a dunk puts the bird back on
its own shore, so even the failure mode escapes.

### A knob that was swept, found to be flat, and deleted **[ours]**

The first bot carried a fourth knob: `margin`, the daylight it demanded between the end of a
planned slide and the rim of a hole — the obvious "how careful is it" dial, and the one that
looked like it should own the dunk rate. Swept alone across its entire useful range it did
**nothing**:

| `margin` | −20 | 0 | 8 | 20 | 34 | 55 | 90 |
|---|---|---|---|---|---|---|---|
| win vs `normal` | 65.0% | 67.0% | 66.0% | 66.5% | 66.0% | 65.5% | 65.0% |
| dunks a match | 1.88 | 1.80 | 1.82 | 1.84 | 1.89 | 1.95 | 2.04 |

Two points of spread over 110 units, against a 2.3-point standard error — and the dunk
column runs the *wrong way*, because a larger margin refuses more slides and a refused slide
is eventually forced by `patience`, and a forced release does not consult the margin at all.

It was deleted, and the clearance it was padding became a plain rule: never slide further
than the first hole on that line. What actually separates the tiers on dunks turned out not
to be a dial at all — `easy` falls in 4.8 times a match to `hard`'s 1.2 — but `think` and
`blunder` leaving a bird walking on a stale plan. That is the third game this week to delete
a knob after measuring it, and the reason is always the same: the knob that reads in the
source as the main skill is not the one the score is listening to.

### The bot plans from the shore while it is in the water — and this is a bug fix

While a bird is dunked its position is the point at which its centre crossed a rim, so
`|bird − hole|` is **exactly** `HOLE_RADIUS` in exact arithmetic and `HOLE_RADIUS ± a few
ulps` in floating point. `holeAlong`'s inside-test is a hard threshold there. See the next
section for what that cost; the fix is that `chooseHeading` plans from the shore the bird
will climb out at, which removes the knife edge outright rather than nudging it — and is
also simply the better decision, because the heading it wants is the heading from the shore
rather than from the bottom of a hole.

## The half-turn, and the defect that hid in it

Neither seat may have a better game than the other, and in this game that is a statement
about the *code* rather than about the geometry: the two floes are half-turn images by
construction, so turning the board over and swapping the seats must produce the mirror image
of the same match. It did not.

**Measured: 24 of 60 mirrored `hard` matches parted company**, every one of them at a dunk.
The mechanism is above. Two mirror-image birds accumulate their impact point by adding
displacements from opposite ends of the board — one counts up from 70 and the other down
from 930 — and floating-point addition is not symmetric under `y → 1000 − y`, so the two
land on opposite sides of `c ≤ 0`. One read every one of its eight headings as blocked and
walked its default; the other read five of eight as clear and walked somewhere else. From
there the two matches were simply different games.

It is the same *shape* as Snowball Throw's reaction threshold and it is worth naming the
family: **a decision threshold that a state variable lands on exactly, by construction,
rather than by coincidence.** A ball's age landing exactly on a whole frame; a bird's
position landing exactly on a rim. Ordinary float comparisons are safe because they are
messy on both sides; these are not, because one side is exact.

After the fix: **0 of 60**. Deepened to 900 mirrored matches across all three tiers, **no
winner ever flipped and one scoreline in nine hundred differed** — a bird's position still
accumulates from opposite ends of the board and always will, so this will never be exactly
zero, and the test allows one in sixty rather than pretending otherwise.

### What guards it now

Three tests, and they are the most valuable in the package:

- `step()` is driven from **500 scrambled boards** with mirrored commands, and the **whole
  state** is compared to six decimals — both birds' positions, previous positions, phases,
  headings, wind-ups, slide speeds, dunk timers, scores, dunk counts, slide counts and flash
  timers, every hole, every fish with its respawn delay, both spawn cursors, the clock and
  the winner. Birds are scrambled onto the **two-unit lattice an axis-aligned walk actually
  produces**, so exact ties are everyday events in the sample rather than measure-zero ones.
- `chooseHeading` and `wantsRelease` are mirror-checked directly over **1200 boards a tier**.
- Two mirror-image birds are asserted to have a bit-identical wind-up, frame by frame,
  because the wind-up is compared against thresholds written in hundredths of a second and a
  wind-up is a whole number of frames, so values land on them exactly. It is counted from
  zero, never derived.

Everything a decision reads is covariant by construction: the bot's eight headings are
written in the **seat's own frame** and multiplied by `seatAxisSign`, so an exact tie keeps
the lowest seat-relative index — which is the opposite board direction for the two seats,
and is the fix Snowball Throw's `dodgeSide` records.

## Balance

### Equal tiers, 1500 seeds, both stream orders

Seat one's share of decided matches. "A" and "B" are the same 1500 boards with the two
seats' generators exchanged:

| | A | B | mean | draws |
|---|---|---|---|---|
| easy v easy | 48.9% | 51.1% | **50.0%** | 0.13% |
| normal v normal | 50.1% | 49.9% | **50.0%** | 0.07% |
| hard v hard | 49.4% | 50.6% | **50.0%** | 0.13% |

The A and B rows are **exact complements** — 733/765 against 765/733, and 740/758 against
758/740 — which is the half-turn property showing up in the balance table rather than in a
unit test. Exchanging the generators produces the mirror image of the same match, so seat
order is not merely fair here, it is provably irrelevant.

And what those matches look like:

| | length | fish a seat | dunks a seat | slides a second | reached 30 |
|---|---|---|---|---|---|
| easy | 42.9 s | 24.6 | 4.84 | 0.585 | 98% |
| normal | 33.3 s | 26.1 | 2.46 | 0.595 | 100% |
| hard | 28.5 s | 27.0 | 1.22 | 0.616 | 100% |

The dunk column is the whole ladder in one number: the better tier is better at **not
falling in**, not at collecting faster — the slide cadence barely moves across the three.

### Cross tier, both seat orders, 500 seeds each

| | p1 | p2 | draws | stronger tier's share of decided |
|---|---|---|---|---|
| hard as p1 v easy | 466 | 34 | 0 | 93.2% |
| easy as p1 v hard | 35 | 465 | 0 | 93.0% |
| normal as p1 v easy | 392 | 108 | 0 | 78.4% |
| easy as p1 v normal | 96 | 404 | 0 | 80.8% |
| hard as p1 v normal | 372 | 126 | 2 | 74.7% |
| normal as p1 v hard | 112 | 387 | 1 | 77.6% |

Every pairing is monotone and every one agrees with itself within **2.9 points** across the
two seat orders.

### Against the repository's own harness

`apps/web/src/data/balance-aggregate.test.ts` measures every game at `normal` over 50 seed
pairs with a frozen idle input. Replicated exactly against this game: **42.0% of 100 decided
matches, no draws, none unfinished, 34.7 s a match**, `openerSwung` 0, `readsInput` false,
`distinct` 49.

42.0% is three points outside the flat 45–55% claim and well inside the 21.2-point allowance
that sample gets, so it passes — but it is worth being exact about why the reading is loose.
A real-time game ignores the opening seat, so the harness's two matches per seed are the
same match and the effective sample is **50, not 100**: three sigma is 21 points and a
reading anywhere from 30% to 70% would be indistinguishable from fair. Run on the same seed
family at 600 seeds the game reads **46.9% / 52.2% / 50.5%** at the three tiers, all inside
the flat band, which agrees with the 1500-seed table above. The 42.0% is the sample, not the
game.

`openerSwung` is 0 because a real-time game has no opener — the SDK contract says so
outright ("Real-time games have no opener and may ignore this"). Both birds start on
identical courses at identical points, so there is nothing for `context.openingSeat` to
name, and inventing something for it would manufacture the first-mover advantage the field's
symmetry exists to remove. `getActiveSeat` is not implemented at all, which
`apps/web/src/data/turn-seat.test.ts` requires of an `rt-*` game.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called through a whole match, and a
second one asserts the two seats' shapes never cross over.

- **The near seat is round and the far seat is square, everywhere**: the bird's body, the
  splash it leaves when it goes in, and the three milestone markers on its tally. Two birds
  on one screen at once is the pair most likely to be confused, and the two seat colours sit
  at **1.03:1 under deuteranopia** (`packages/engine/src/palette-vision.test.ts`), so for
  those players the shape is not a layer over colour — it is the only signal there is.
- **One stripe of seat colour along the near seat's shore, two along the far seat's.** A
  fixed multiplicity, so it reads as a pattern rather than as a score.
- **A hole is a filled disc with a ring; a fish is a body and a forked tail.** A rectangle
  and two lines against a circle: the two things you must tell apart at a glance while
  sliding are different primitives, not two colours.
- **The wind-up is three pips over the bird's head, plus a ring closing around it** for the
  progress to the next tier. Both players can read both birds' pips, so committing to a bolt
  is visible to the person watching it happen — which is also why the bot is allowed to read
  its own.
- **The beak points the way the bird is going**, and while it is sliding it points along the
  slide, so a committed bird is readable without colour.
- **The clock is a bar down the left edge that drains from both ends toward the middle** —
  one object, shared, unchanged by the half-turn, so neither player reads a clock the other
  cannot.
- **The tally is a length, not a number**, with three seat-shaped milestone markers on it.

A local copy of `apps/web/src/data/greyscale.test.ts`'s question lives in `game.test.ts`, so
this package fails on its own before the shared guard does.

## Rule 8: no pixels, and rule 9: no extra field of view

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the input mapping, the palette and the drawing, and reads the simulation
without adding to it — a test plays nine hundred steps, renders the same frame at five
different alphas and asserts nothing moved, and another asserts a walking bird interpolates
by the alpha at 0, 0.5 and 1.

A test asserts **no seat-coloured mark is ever drawn in the other seat's half of the board**,
which is rule 9 in a picture: each player's own floe is a full-width band and nothing they
own strays over the middle. The wind-up pips are ink rather than seat colour so that test
does not reach them, but they obey the same rule for the same reason, and it is why they are
drawn *toward* the middle of the device rather than toward the player's own shore: the shore
side is where the tally bar is, and a bird pressed against it would push its pips onto the
bar.

Nothing here reads `presentation`, and a test asserts the same seed plays the identical
match in both.

## How the numbers were taken

Every figure comes from driving the shipped `rules.ts` directly — `botStep` against a
constructed profile for the sweeps, `botCommand` for the pairings — with a generator for the
ice and one per seat derived from one match seed, exactly as `game.ts` derives them. Match
lengths are simulated seconds, not wall clock. The harness lived in the package while the
game was being tuned and was deleted; `rules.test.ts` carries a cheap version of the ladder,
the seat balance and the mirror check that fails if any of them ever inverts, and the numbers
here are the ones a thousand-odd seeds gave.

The step-size and Euler figures were taken from the built `dist/rules.js`, so they are
measurements of the shipped code rather than of a test fixture.

## What is not verified

- **Anything on a trackpad, or across two real devices.** `docs/input-parity.md` and
  `docs/input-idiom.md` both record that gap; #1862's harness does not exist. The
  re-clutch argument above is the one that is comfortable and might be wrong.
- **Anything against a human.** Every balance number here is bot against bot. A bot never
  winds up on the spot to buy a heading and never deliberately takes a shorter slide to keep
  a hole on its outside, so a human match will look different from these tables — probably
  longer, and with more of the score decided by holes.
- **The size budget**, which needs `pnpm build` and belongs to the orchestrator. Minified and
  gzipped locally the chunk is 5418 bytes against a 12288-byte budget, measured the same way
  that puts Snowball Throw at 4827 and Happy Hippos at 4920.
