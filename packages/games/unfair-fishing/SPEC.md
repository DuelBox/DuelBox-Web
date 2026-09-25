# Unfair Fishing — specification

Written from the implementation. Every number here was measured on the code in this
directory; where a decision is ours rather than the catalogue row's it is marked **[ours]**.

| | |
|---|---|
| id | `unfair-fishing` |
| archetype | `rt-split` |
| logical box | 600 × 1000, portrait, horizontal split |
| modes | `friend`, `bot` |
| presentations | `shared-screen`, `single-seat` |
| win condition | SDK `first-to`, target 25 |
| clock | `MATCH_SECONDS = 180`, in `rules.ts` |
| seat one's share at equal skill | **50.0%**, exactly, by construction — see "Balance" |
| bot ladder, both seat orders | hard/easy 91.6% · hard/normal 78.0% · normal/easy 74.3% |

## Observed rules

The catalogue row is the whole of what we have:

> Throw the bait and rewind the reel! First to catch 25 fishes wins!

Two verbs, both of them moments, and a target. Everything below that is ours.

## The name, and what we did about it **[ours]**

"Unfair Fishing" is the reference's own name for an asymmetry gimmick. We do not know what
that gimmick is: the row describes none, we may not unpack the APK (CLAUDE.md rule 2), and
nobody here has played it. So the question was answered from first principles rather than
from research, and the answer has two halves.

**A per-seat advantage is refused.** CLAUDE.md rule 6 forbids giving one side information,
speed or physics the other cannot have, and `apps/web/src/data/balance-aggregate.test.ts`
asserts a 45–55% band on seat one's share. A catalogue that ships a game one chair wins
does not have a bot ladder, it has a seating plan. Whatever the reference does with the
name, we do not do it, and this paragraph is the departure being recorded.

**The unfairness we do ship is one both players hold in equal measure.** There is one pond,
not two, and a rod's reach is `MAX_REACH = 740` — from a boat all the way to the row
directly under the *other* boat. So the water you are fishing is the water your opponent is
fishing, the fish you are waiting for can be taken out from under you, and the forgiving
far rows are the ones nearest the person you are playing. Both seats have exactly that
reach and exactly that exposure. It is a mutual unfairness, which is another way of saying
it is a game.

Frozen Beaks, the other `rt-split` built this week, gives each seat its own floe and its
own fish precisely to avoid this. This one goes the other way on purpose: it is the
interaction the name asks for, and it is the only interaction the game has.

## Two moments, and nothing else

A rod has four phases and one button.

| phase | a press means |
|---|---|
| `ready` | **throw**: the bait leaves the boat at `CAST_SPEED` and decelerates |
| `flying` | **strike and rewind**: whatever is beside the bait right now is on the hook |
| `resting` | the same, from a bait that has come to rest on the far row |
| `reeling` | nothing at all |

That is the whole vocabulary. The `Command` the simulation reads is one boolean:

```ts
export interface Command {
  press: boolean;
}
```

### Why the reach is chosen by a moment and not by a meter **[ours]**

The obvious spelling of "throw the bait" is a power meter: hold, watch a bar fill, release.
We did not build it, for two reasons.

A meter's optimum sits at the top of its own range, so every player releases on a boundary
and thirty milliseconds of latency is a distance — Frozen Beaks records the same objection
and answered it with three discrete tiers. Here there is a better answer available: **the
flight itself is the meter**. One throw covers every reach in the game, passing each of the
six rows in turn, and which of them you take is settled by *when* you press the second time.
The two moments the row names do all the work, and there is no third.

It also collapses the two decisions into one press, which is the thing that makes the game
read: you are not choosing a distance and then a moment, you are watching a bait sail
toward a fish and deciding when it has arrived.

### Fairness across input families

Nothing in this package reads `pointer.x`, `pointer.y`, `move`, `holdSeconds`, or any
pointer velocity. The only field consulted is `actionPressed`, which the engine raises
identically for a key and a thumb — `held = keys.action || pointerDown`, and the edge is
true for exactly one step however many events arrived.

Shuriken bound its throw to pointer velocity and is filed as a cross-device fairness bug
(#2478). The difference is not that this game is more careful about a continuous quantity;
it is that there is no continuous quantity to be careful about. `game.test.ts` plays the
same press schedule through the keyboard and through a finger and asserts the two traces
are **byte-identical**, phase for phase and position for position — not comparable,
identical. A second test holds W, holds the left arrow, and drags a finger across the pond
for six hundred steps, and asserts the match is the one nobody touched.

`sameInputClassOnly` is therefore `false`, and the manifest says why.

**What is still not fair, and is not fixable here.** A press is a moment, and a moment
travels: over a network, the two players' presses are resolved on source timestamps rather
than packet arrival, which is the shell's problem and is stated as such in CLAUDE.md. On one
device there is nothing left — the two seats read the identical clock.

### The tightest moment in the game, measured

The catch window is how long the bait and the fish stay within `catchRadius` of each other,
which is `2 · catchRadius / |relative velocity|`. The bait moves along the board and the
fish across it, so the relative speed is `√(v_bait² + v_fish²)`:

| row (out) | bait speed | window, drifter (36) | window, dart (31) |
|---|---|---|---|
| 140 | 925 | 78 ms | 67 ms |
| 260 | 792 | 90 ms | 78 ms |
| 380 | 659 | 108 ms | 92 ms |
| 500 | 526 | 134 ms | 115 ms |
| 620 | 393 | 178 ms | 148 ms |
| 740 (at rest) | 0 | 790 ms | 420 ms |

That table **is** the game's risk axis, and it is a trade rather than a ranking. The near
rows are quick to reach and quick to wind back — a full cycle in well under a second — and
demand a press good to a twelfth of a second. The far row is forgiving to the point of
being generous, and costs 1.29 s of flight and 1.23 s of reel to fish. Both players
choose freely between them on every cast; nothing in the rules pushes either way.

## The pond

```
             seat two's boat  (cy = -440, column +30)
   row -300  ──────────────────────────────────────▶     seat ONE rests here
   row -180  ◀──────────────────────────────────────
   row  -60  ──────────────────────────────────────▶
                    ·  ·  ·  the middle  ·  ·  ·
   row   60  ◀──────────────────────────────────────
   row  180  ──────────────────────────────────────▶
   row  300  ◀──────────────────────────────────────     seat TWO rests here
             seat one's boat  (cy = +440, column -30)
```

Eighteen fish, three to a row, swimming their own row at their own speed and turning at the
bank. Nothing else moves.

### Every coordinate is an offset from the middle of the board **[ours]**

This is the single most load-bearing decision in the package and it is invisible from the
outside. A fish is at `(cx, cy)` measured from `(300, 500)`, a bait is at `out` measured
from **its own boat**, and the half-turn that swaps the two seats is therefore the exact
negation of every stored number.

Written the usual way — a bait at `y = 940 - out` for one seat and `y = 60 + out` for the
other — the two are not negations of each other in floating point: `1000 - (940 - 0.1)` is
`60.099999999999994` and `60 + 0.1` is `60.1`. Both seats then accumulate toward the same
catch threshold from opposite ends of the board and disagree about a fish that lands on it.
That is exactly the family of defect Snowball Throw shipped (a reaction threshold on a knife
edge, seat one at 64.3%) and Frozen Beaks shipped (a dunked bird sitting *exactly* on a hole
rim by construction, 24 of 60 mirrored matches diverging).

Because of it, `rules.test.ts` asserts the half-turn **exactly**. There is no tolerance
anywhere in that suite. See "The half-turn" below.

### The rows come in mirrored pairs, and so do the fish

`ROW_OFFSETS` is `[-300, -180, -60, 60, 180, 300]` and `ROW_DIRS` is `[1, -1, 1, -1, 1, -1]`,
so a row's image is a row and the current in it runs the other way — which is what the
half-turn does to a current. The stock is generated nine times in one half of the pond and
mirrored: fish `2k+1` is at the negation of fish `2k`'s position, swimming the opposite way
at the same speed, of the same kind.

So **the pond is invariant under the half-turn on the first frame of every match**, whatever
the seed. It stops being invariant the moment somebody catches something, which is the game.

### There is no randomness in the pond after the layout

Speeds and starting positions are drawn once, from the match seed. After that fish move at
a constant speed, turn at the bank, and come back at the bank they entered from
`RESPAWN_SECONDS = 1.1` after being landed. Two humans play a match with no randomness in it
anywhere; only bots draw.

### The two columns are sixty units apart, and that number is chosen

Seat one's bait runs down the column at `cx = -30` and seat two's at `cx = +30`. Against a
widest catch of 36, that leaves a strip twelve units wide down the middle of the pond where
**a fish is inside both hooks at once**. `settleClaims` is the rule for it: both claims are
computed against the same water before either is settled, the nearer hook takes the fish,
and an exact tie breaks both lines and leaves the fish where it is.

The gap is a design constant rather than an inherited one. Wider and that rule is code
nobody can reach; narrower and the two baits are drawn on top of each other. `rules.test.ts`
asserts both bounds and drives the contest from both sides.

## The physics, and issue #2465

Two integrators, both of them the analytic integral of their own law, and both of them
exactly step-size invariant.

**The cast.** `v(t) = CAST_SPEED · CAST_DRAG^t`, so a bait covers `(v_before - v_after) /
CAST_RATE` in a step and those terms telescope: a whole cast totals `(CAST_SPEED -
CAST_STOP_SPEED) / CAST_RATE = MAX_REACH` however finely it is sliced. Forward Euler
overshoots by `dt · CAST_RATE / 2` — 0.92% at 60 Hz, 0.46% at 120 Hz — which puts the same
cast in a different place on a 120 Hz phone. The last step lands the bait on `MAX_REACH`
exactly, so the resting spot is the same spot at every rate and sits precisely on the far
row.

**The reel.** `v(t) = REEL_SPEED - (REEL_SPEED - v₀) · REEL_DRAG^t`, whose integral over a
step is `REEL_SPEED · dt - (v_after - v_before) / REEL_RATE`. Same telescoping, same
guarantee. The winch accelerates rather than snapping to speed, which is what makes a long
cast a real cost rather than a rounding one: 1.23 s home from `MAX_REACH` against 0.38 s
from the nearest row.

### Measured at four step rates

The same cast and the same reel, run for the same elapsed time at 60, 90, 120 and 240 Hz.
Spread across the four, in logical units:

| | 0.2 s | 0.5 s | 0.9 s | 1.2 s |
|---|---|---|---|---|
| cast | 1.6e-12 | 2.4e-12 | 2.3e-12 | 2.3e-12 |
| reel | 3.4e-13 | 5.7e-13 | 6.3e-13 | — |

Against a board 740 units deep, that is agreement to about fifteen significant figures. The
tests assert nine decimal places, which is the number the brief asks for and roughly a
thousand times looser than what the code actually does.

### The bot's arithmetic is the simulation's arithmetic

`flightTime(out)` and `flightOutAt(t)` are a closed-form inverse pair, and the bot consults
them on every decision. Measured against the stepped simulation at 240 Hz:

| t | `flightOutAt(t)` | stepped `out` | `flightTime(stepped)` |
|---|---|---|---|
| 0.2 | 193.8025264080 | 193.8025264080 | 0.2000000000 |
| 0.5 | 414.6995150142 | 414.6995150142 | 0.5000000000 |
| 0.9 | 615.2212123114 | 615.2212123114 | 0.9000000000 |
| 1.2 | 716.8810830776 | 716.8810830776 | 1.2000000000 |

This is CLAUDE.md rule 6 read the hard way. Cannon Duel's bot swept 441 closed-form
trajectories while the game stepped a different one and every tier was aiming at a board
the game was not playing — a systematic bias no amount of tuning the timing error could
reach. Here the two are the same function.

## Scoring and the end of a match

A fish counts when it is **landed**, not when it is hooked. That is a real rule and not a
formality: the wind back from where you struck is the price of having struck there, and a
match that ended on a hook would make the far row free.

`judge` runs the SDK's `first-to` at 25, so two rods landing their twenty-fifth in the same
step is a draw rather than a win for whichever seat the loop reached first. At the whistle:

1. more fish;
2. level on fish, **fewer empty strikes** — a strike that closed on nothing;
3. level on both, a draw.

Both tie-breaks are per-seat counters rather than anything read off the board, so a mirrored
match settles the opposite way round. A tie-break written in board coordinates cannot settle
a mirror position — it returns a mirror answer, which decides nothing — and that is Maze
Paint's finding, generalised.

## Termination

`roundSeconds` ends nothing anywhere in this repository; the clock in `rules.ts` does. The
two are both 180 and a test keeps them equal.

Three things guarantee an end, in order of how often they are what actually ends a match:

- **Twenty-five fish.** Every measured pairing gets there. Mean match length over 500
  matches a tier, both stream orders: **94.9 s at `easy`, 85.9 s at `normal`, 78.7 s at
  `hard`** — against 180 s of clock and against the ten simulated minutes
  `termination.test.ts` allows.
- **The bot's own limits.** `CAST_LIMIT = 1.5 s` throws whatever the water looks like,
  `ABORT_SECONDS = 0.4 s` winds in a cast that can catch nothing, and `STRIKE_LIMIT` is a
  backstop past the end of the flight. Together they bound a cycle under five seconds, so
  a bot cannot wait for a perfect interception that never comes — which is how Cup Pong's
  needle bot swept for ever on the second seed it was given. A test empties the pond
  completely and asserts the rod still throws.
- **The whistle.** With nobody pressing anything at all, the match is a draw at 180 s. A
  test runs exactly that.

## The bot

Three knobs, and each of them is a different thing a person is better or worse at. Nothing
it reads is hidden from a player: every fish's position, speed and heading is drawn, the
bait is drawn, and the flight curve is the one a player watches on every cast. What a weaker
tier is denied is how often it looks and how well it judges an instant.

```
easy    think 0.28   cast 0.16    snap 0.082
normal  think 0.22   cast 0.11    snap 0.062
hard    think 0.17   cast 0.075   snap 0.046
```

- **`think`** — seconds between looks at the pond. Between them the bot holds the plan it
  made.
- **`cast`** — signed seconds of error on the throw. Drawn once a cycle.
- **`snap`** — signed seconds of error on the strike. Drawn once a cycle.

It plans in two stages. `planCast` ranks every fish by how long the throw would have to be
held for the bait to reach its row as the fish reaches this seat's column, plus how long the
whole cycle would then take — the cycle term is what keeps it off the far row, and it is
where most of its rate comes from. `planStrike` then ranks whatever is still ahead of the
bait by **how close the pair would actually be** at the moment they are nearest, using the
same flight law the simulation steps.

### Two knobs measured backwards, and the two causes

Lesson 4 of the orchestrator brief says a knob you have not swept is a knob whose sign you
do not know. `think` was swept, measured **backwards**, was fixed, measured backwards
**again** for a different reason, and was fixed again. Both causes are worth writing down
because neither is about the knob.

**The first: an error resampled on a timer fires on the minimum of its draws.** A press
happens when a countdown reaches zero, and the countdown was `plan + error` with a fresh
`error` drawn at every look. A bot looking twelve times a second therefore fired at the
*earliest* of twelve perturbed times — biased early by roughly the full width of its own
error, and the faster it looked the worse it got. Measured: 10.0% won at `think = 0.08`
against 90.8% at 0.60, monotone the wrong way over the whole range. **A knob that is really
measuring how often another knob is resampled is not a knob.** The errors are now drawn once
at the first look of a cycle and held.

**The second: a deadline re-derived every look is a deadline that never arrives.**
`laneTime` steps by a whole lap of the pond the instant a fish crosses the column, so a bot
that re-derived its countdown fell off that cliff and simply never pressed; and re-running
the candidate search swapped target between near-ties and pushed the throw out in front of
itself. Measured after the first fix: still backwards, at 5.0% for
`think = 0.08` against 90.0% at 0.85. Plans are now committed to and re-derived only when they go stale — the rod has
nothing planned, or the fish it was for has left the water. That is also simply what a person
does: you pick your fish and you wait for it.

Both bugs were invisible to every other test in the package. The ladder was ordered
correctly the whole time, because all three tiers were being handicapped by the same
mechanism.

### Every knob, swept alone

Each value played against an untouched `normal`, 120 seeds, both seat orders, 240 matches a
row. Standard error about 4.6 points.

**`think`** — seconds between looks. Monotone across its useful range; a plateau below
0.16, where the bot is already re-planning faster than the pond changes.

| 0.08 | 0.12 | 0.16 | 0.22 | 0.30 | 0.42 | 0.60 | 0.85 |
|---|---|---|---|---|---|---|---|
| 58.3% | 51.0% | 54.6% | 50.0% | 37.9% | 34.6% | 25.0% | 11.7% |

**`cast`** — seconds of error on the throw. The weakest of the three, and it is weak for a
reason worth knowing: the strike re-plans from wherever the bait actually is, so a badly
timed throw is partly recoverable. Flat below 0.04.

| 0 | 0.04 | 0.08 | 0.11 | 0.16 | 0.24 | 0.36 | 0.55 |
|---|---|---|---|---|---|---|---|
| 59.6% | 60.4% | 51.9% | 50.0% | 42.1% | 41.3% | 31.7% | 26.7% |

**`snap`** — seconds of error on the strike. The strongest, which is the right answer for a
game whose whole content is a moment. Flat at 0–0.02, where the error is already inside the
tightest window on the board.

| 0 | 0.02 | 0.04 | 0.062 | 0.09 | 0.13 | 0.20 | 0.30 |
|---|---|---|---|---|---|---|---|
| 76.7% | 80.0% | 72.0% | 50.0% | 23.8% | 12.1% | 5.0% | 1.3% |

All three are monotone across the range that matters and none was deleted. The three
inversions above (`think` 0.12/0.16, `cast` 0.16/0.24, `snap` 0/0.02) are 1.6, 0.2 and 0.7
standard errors and all sit on a plateau.

### The tiers are deliberately close together

Every one of these is a strong knob on its own — `snap` alone runs from 77% to 1% — and
three strong knobs pulled apart by intuition compound into a ladder nobody can climb. The
shipped spread buys:

| pairing | stronger tier wins | decided |
|---|---|---|
| `hard` v `easy` | **91.6%** | 499 of 500 |
| `hard` v `normal` | **78.0%** | 500 |
| `normal` v `easy` | **74.3%** | 499 of 500 |

250 seeds each, played twice, once with each tier in each chair. A tier number measured from
one chair is a tier number plus a chair number.

Nothing saturates: `hard` still misses. Empty strikes per match, seat one, over 500 matches:
6.1 at `easy`, 4.2 at `normal`, 2.7 at `hard`, against about 27 casts. The hardest tier
throws away one cast in ten.

## The half-turn

The test the last two `rt-split` games each record as the most valuable one in their
package. Here it is exact.

**`step`.** 800 scrambled boards — arbitrary phases, baits on the lattice a real cast
produces, fish on a ten-unit lattice shared with both columns so that a fish sits *exactly*
on a hook, *exactly* between two hooks and *exactly* on a catch boundary as an everyday
event. Each board is mirrored, both are stepped with the presses swapped, and the two
results are compared as strings with no rounding. **0 mismatches of 800.**

**The bot.** Every decision, all three tiers, 150 boards a tier, 30 consecutive steps each:
the press, the chosen target, the cast countdown and the strike countdown must all be
identical. **0 mismatches of 1200 runs.**

**Whole matches.** Each seed played twice with the two generators in opposite chairs. The
winner, both scores and the step count must be exact mirrors. All three tiers, and it holds
board by board rather than on average.

A press is a boolean, so there is nothing about an input to turn over — which is the
clearest single statement of why this game is instrument-neutral.

## Balance

### Seat one takes exactly half, and it is a proof rather than a sample

The pond is invariant under the half-turn and every rule in `rules.ts` is covariant, so
swapping which generator sits in which chair produces the **exact mirror** of the same
match. Every seed therefore contributes one win to each seat, and seat one's share is 50.0%
by construction.

| tier | seeds | matches | seat one | draws |
|---|---|---|---|---|
| `easy` | 250 | 500 | **50.0%** | 0 |
| `normal` | 250 | 500 | **50.0%** | 0 |
| `hard` | 250 | 500 | **50.0%** | 0 |

`rules.test.ts` asserts this per board — the winner of the swapped match must be the mirror
of the winner of the forward one — rather than checking that an average landed in a band.
Maze Paint's SPEC makes the distinction and it is the right one: 50.0% because of the way
the game is built beats 49.4% because of how many seeds were run.

### Against the repository's own harness

`apps/web/src/data/balance-aggregate.test.ts`, `normal`, one opening seat per seed:

```
unfair-fishing   rt-split   52.3%   ±16.0   88 seeds   88 decided   0/12 opener   86.0 s   0 draws   88 distinct
```

Fifty distinct matches out of a hundred is what this line used to read, and it is the
signature of a game whose two halves are mirrors: every pair of that sample was one match seen
twice. #2494 stopped the harness paying for the second half — this game never reads
`context.openingSeat`, so the second arm is the first one again — and spent the saving on 88
seeds, which is why the distinct count is now the seed count and the allowance is 16.0 rather
than 21.2 points. The share moved from 50.0% to 52.3% because the sample is a different one,
not because the game changed.

## Rule 7: never colour alone, and no text at all

The two seat colours sit at 1.03:1 under deuteranopia
(`packages/engine/src/palette-vision.test.ts`), so for those players the shape is not a
layer over the colour — it is the only signal there is.

**Seat one is round everywhere and seat two is square everywhere.** The hull, the float on
the end of the line, the outline on both, and the three milestone marks on the tally. Seat
one draws `circle` and `strokeCircle` in its own colours; seat two draws `rect` and
`strokeRect`; neither ever draws the other's, on every frame of every match — including the
part of a cycle where a rod has nothing in the water, which is why the boat outlines are in
the seat's own darker shade rather than in ink.

**The two kinds of fish differ by shape too.** A `drifter` is a body with a forked tail
(`circle` plus two `line`s); a `dart` is a bare chevron (two `line`s, no body). They also
differ in size and in pace, so the difference is legible three ways.

Two boats are always moored, so there is never a frame with only one seat's material on it —
which is what makes the game judgeable by `greyscale.test.ts` at all rather than an entry on
its `NOT_YET_DRIVEN` list.

The game draws no text whatever. The clock is a bar that drains from both ends toward the
middle; the score is the length of a bar along each player's own shore.

## Rules 8, 9 and 10

**Rule 8, no pixels.** Every constant in `rules.ts` is in logical units and `game.ts` scales
nothing. A test renders three seeded matches at three alphas and asserts every drawn
coordinate is inside 600 × 1000.

**Rule 9, no extra field of view.** One pond, drawn once, read by both players. There is no
per-seat culling and no per-seat camera, so the question cannot arise.

**Rule 10, no branching on device type.** There is none. The game never reads
`context.presentation` or `context.localSeat`; a test plays shared-screen, single-seat from
seat one and single-seat from seat two and asserts the three traces are identical.

## What we did not build from the catalogue row

- **The asymmetry the name promises.** Refused under rule 6 and the 45–55% band. See "The
  name" above. **[ours]**
- **A power meter on the throw.** The row says "throw the bait", not "choose how hard". One
  throw serves every reach; the second press picks which. **[ours]**
- **Anything for the fish to do.** They swim their row at a constant speed and turn at the
  bank. Fleeing, schooling, or a fish that fights the line would each add a quantity the
  strike would have to predict, and the strike is the game.
- **Fish worth different amounts.** The row says "25 fishes", so a fish is a fish. The two
  kinds differ in how hard they are to hit, not in what they pay.

## How the numbers were taken

Every figure here came from `rules.ts` driven directly, at 1/60 s, with a separate
generator per seat. Balance and ladder figures play each seed twice with the seats or the
generators exchanged and pool the two, because the alternative measures a chair. The
step-rate figures step the identical elapsed time at four rates and compare positions.

## What is not verified

- **That a person can actually hit a 78 ms window on the near row.** The bot can; a human
  playing on a phone with a hundred milliseconds of touch latency may find the near rows
  unusable and live on the far ones. That would not make the game unfair — both seats face
  it — but it would make three of the six rows decoration. It needs QA on real hardware.
- **Legibility of two baits sixty units apart** when both rods happen to be at the same row.
  They never overlap and they are different shapes, but "does not overlap" is not the same
  claim as "reads instantly".
- **Whether the contested strip is wide enough to matter.** Twelve units of pond out of 540.
  It is reachable and tested, but no measurement here says how often two players actually
  race for the same fish in a real match.
