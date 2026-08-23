# Frogs Fight — specification

**Archetype:** `rt-arena` · **Category:** Party · **Logical box:** 800 × 800 ·
**Zone split:** shared-board · **Round length:** 40 s advertised, ~20 s measured

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Two frogs share one pond of twenty-five lily pads. Bugs settle on the pads; a frog scores by
landing on the pad a bug is sitting on. A fly is worth one, a dragonfly five, and the first
frog to ten takes the match.

## Observed rules

From the reference genre: _"Jump among the water lilies and catch the bugs! The dragonfly is
worth 5 points and the first to reach 10 wins!"_

## Frogs hop between pads; they do not swim between them **[ours]**

The whole game is discrete. A frog is either sitting on one of twenty-five pads or in the air
between two of them, and a push chooses a **neighbour**, never a heading. Three things follow,
and they are why this is the game it is rather than a chase:

- **You commit.** A hop cannot be called back, so the interesting decision is which pad to be
  standing on in a third of a second, not where to point.
- **There are eight answers to a push**, so a thumb and a key express exactly the same thing
  and neither can aim finer than the other — the precision problem `docs/input-parity.md`
  exists for simply does not arise.
- **The pad graph is fixed for the life of the process**, so every distance in the game is a
  table lookup rather than a search. It is solved once at module load with Floyd–Warshall
  over hop times, which is why the hardest bot costs 0.4 ms in its worst step.

## Seat fairness is a property of the pond, not a number somebody tuned **[ours]**

**Pad `i` and pad `24 − i` sit at points reflected through the centre of the pond, exactly.**
The scatter that stops the pads looking like graph paper is stored for twelve pads and
*negated* for their reflections, so the symmetry survives any edit to the table. The two
frogs start on reflected home pads. Bugs settle uniformly over the free pads, and "the free
pads" is a set that reflects onto itself.

Put together: relabelling the two players and reflecting the pond maps a match onto an
equally likely match with the seats exchanged. So for any pair of strategies, p1's score
playing `A` against `B` has the same distribution as p2's score playing `A` from the other
seat. **Neither seat is better placed, and that is a consequence of the layout.**

What it is **not** is Robot Arena's guarantee, and the difference is worth being precise
about. There the hazards themselves came in reflected pairs, so both robots were threatened
identically at the same instant and the fairness was pointwise. Here a single bug lands on a
single pad and one frog really is nearer it — *that contest is the game*. The symmetry makes
the seats equal **in distribution**, not in each individual bug.

`rules.test.ts` asserts every link in that chain rather than only the conclusion: positions
reflect with `toBe` rather than a tolerance; the reach sets, the route table and the travel
times all reflect exactly; the two homes are reflections; the candidate set a bug is drawn
from is closed under reflection. The measured 50% is then a check that the code kept the
promise, not the argument itself.

### The route table needed one nudge to make that exact

Floyd–Warshall gave routes that reflected *perfectly* (`next` was exactly symmetric) but
times that disagreed by up to **4.4 × 10⁻¹⁶** — the same sum of the same distances added up
in a different order. Small enough to be invisible, large enough to be `!==`, and the
dragonfly's placement rule asks whether two arrival times are equal. Each route and its
reflection are now forced to the smaller of the pair, which costs nothing and turns "fair to
within a rounding error" into an equality a test can assert.

## The pond

| | Value | Why |
|---|---|---|
| Pond | 800 × 800, 5 × 5 pads at 140 spacing | Square and odd, so one pad is the centre of symmetry |
| Scatter | ≤ 12 units, antisymmetric | Enough to break the grid, small enough to keep the neighbourhood |
| Hop range | 244 units | Diagonals reach 214.5 at worst; the nearest non-neighbour is 258 |
| Hop arc | 70° | Nobody has to aim, and a push into the bank does nothing |
| Flight | 0.16 s + 1 ms per unit | 0.278 s to 0.374 s across the whole pond |
| Rest | 0.10 s after landing | A beat where a frog can be seen sitting |
| Frog | radius 26 | |
| Bugs | 2 live, one every 2.0 s, 6.5 s life | About ten a match, and the pond is bare half the time |
| Dragonfly | every 6th bug | A cadence, not a dice roll — see below |
| Target | 10 points; fly 1, dragonfly 5 | |
| Budget | 60 bugs served | What ends the match |

**The scatter is load-bearing, not decoration.** On a plain grid, a push straight up from a
pad sits *exactly* between two diagonals, and which one it took would come down to the order
the neighbours happened to be listed in — an order a reflection reverses, so it would be a
seat bias hiding inside a tie-break. With the scatter, the smallest gap between the best and
second-best bearing over all 25 pads × 8 keyboard pushes is **0.038** in cosine; a test
asserts it never falls below 10⁻³, so the tie-break never fires at all.

**The eight neighbours are the grid's eight neighbours**, verified pad by pad rather than
inferred from the hop range. That is the property the range was chosen for, and it is one bad
constant away from silently becoming something else.

## The dragonfly is placed, not dropped **[ours]**

A fly settles uniformly over the free pads. A dragonfly settles on the free pad the two frogs
can reach in **the most nearly equal time**, with a uniform draw among any that tie.

The asymmetry between the two rules is the point. A fly is worth a tenth of the match, so
luck in where it lands averages out over the ten or so a match serves — the reflection
argument says it averages to exactly nothing. **A dragonfly is worth half the match**, and
"fair on average over many matches" is no comfort at all in the one match you are playing:
dropping it two hops from one frog and five from the other would settle the match with a dice
roll neither player could answer. So the big prize is placed where it is a race, and both
frogs are told at the same moment.

The rule reflects like everything else — hop times are unchanged by reflecting the pond, so
the fairest pad for a reflected position is the reflection of the fairest pad — and the
minimum is found in one pass and the tied set collected in a second, so the answer cannot
depend on the order the pads were visited in.

Making the *cadence* fixed (every fifth bug) rather than random removes the last piece of
luck worth caring about: two matches from the same position serve the same number of
dragonflies.

## Two frogs, one bug, one step

**Landings inside one step are ordered by how far past zero the flight timer went**, not by
which frog the loop reads first. Two frogs can be in the air for the same bug and land on the
same step; resolving that by iteration order would hand the bug to p1 every time — a seat
bias made of nothing but code layout, and the same mistake Fruit Duel made when it settled a
round as each blade arrived rather than afterwards. The rest that follows a landing is
shortened by the overshoot too, so a frog is never made to wait for the fixed step's grid.

**An exact tie is a shared meal**: both frogs score the bug, dragonfly included. Two landings
a fixed step cannot separate are two landings that did not happen at different times, and
inventing an order for them would be a lie the game told every time it happened. It is rare —
**one drawn match in 4,500 measured** — and when it does fire it usually costs nothing,
because both frogs gain the same points and the match goes on.

Both frogs may stand on one pad. The alternative — a pad the other frog is on cannot be
landed on — needs a rule about who blocks whom, and any such rule has to be resolved in some
order, which is the bias this section exists to avoid.

## Termination is a budget, not a clock

The pond serves at most **60 bugs**. `served` only ever rises, the interval between servings
is a fixed positive number, and every bug leaves after a fixed life, so the budget is spent in
bounded simulated time however the match is played. There is no wall clock in the argument
anywhere.

Measured: two frogs that never move at all reach a 0–0 draw in **243 s** at worst over twenty
seeds — the pond simply runs dry. Two `easy` bots finish in about 21 s. The cross-cutting
`termination.test.ts` allows ten minutes.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W` `A` `S` `D` | `↑` `←` `↓` `→` |
| Pointer | press anywhere in your own half and pull | same, in the far half |

The pointer reads the **direction of the drag**, not the position of the finger. The shell
divides a shared board into two pointer zones, so each player owns half the screen — and the
pad a frog wants is as likely as not in the *other* player's half, where an absolute pointer
simply cannot reach. A relative drag works from anywhere your own thumb can be, which is the
idiom Robot Arena and Snake Clash landed on for the same reason.

Holding keeps hopping. The direction is read afresh the moment the frog is ready, so a held
key or a held drag carries a frog across the pond, and letting go stops it on the pad it is
standing on rather than the one it was flying to.

Both families end up in the same `padTowards`, so neither can aim finer than the other.

## The bot

Three tiers, all of them seeing exactly the pond a player sees. They differ in how long they
take to choose, how often they fumble the push, and whether they notice the other frog is
nearer — never in hop speed, hop reach, rest, or knowledge of where the next bug will land.

| Tier | Chooses in | Fumbles | Concedes a contested bug |
|---|---|---|---|
| easy | 0.30 s | 30% | never |
| normal | 0.14 s | 12% | 60% |
| hard | 0.04 s | 3% | fully |

**Rule 6, precisely.** Every tier's only output is a *push*, and every push goes through the
same `padTowards` a thumb does, so no bot can reach a pad a person cannot reach. `hard`
chooses in 0.04 s, which is inside human reaction time and would be a rule 6 problem in a
game where reacting was the skill — it is not one here, because a person holding a direction
hops the instant the rest ends. The 0.10 s rest binds them both, so `hard` is exactly as quick
off a pad as a held thumb and no quicker. Bug lifetimes are drawn on the screen as a shrinking
ring, which is why the bot is allowed to read them.

### Finding: conceding on the bare comparison made the best tier the worst one

`hard` originally gave up on any bug the other frog was nearer to *at all* — which is most of
them, by a few hundredths of a second — so it spent the match hopping home while `normal`
contested everything and won. Measured on the shipped tuning, 200 matches a pairing, as the
strong tier's win rate from each seat:

| | no margin | with the 0.55 s margin |
|---|---|---|
| hard against normal | 57% / 51% | 89% / 90% |
| hard against easy | 67% / 70% | 100% / 99% |
| normal against easy | 96% / 96% | 96% / 96% |

Without a margin the best tier could barely separate itself from the middle one, and it beat
`easy` far *less* convincingly than the middle one did — a tier that is supposed to be better
at the game losing ground for being better informed about it. The fix is a margin: a bug is
discounted in proportion to how far behind the frog is, fully at 0.55 s, about one hop. A
photo finish is worth entering and a hopeless chase is not, which is the distinction "who is
nearer" cannot make. (On an earlier, denser tuning the same fault read even worse: `normal`
beat `hard` 61–39 as p1 and 52–48 as p2.)

### Finding: the split RNG streams are insurance, and the measurement says so

Each seat's bot draws from **its own generator**, seeded from the match seed at `init` with
two draws. The reasoning was that Fruit Duel's fix — a constant number of draws per decision —
removes the coupling between two seats sharing one stream only when both seats decide on the
same schedule, and here they do not: a frog decides when it lands and lands when its hop ends,
so the *number* of decisions a seat has made by any moment is a function of what that seat
chose. That looked like Fruit Duel's bug wearing a different hat.

**It measures as nothing.** 500 matches a tier, one shared generator against one per seat, as
p1's share of decided matches:

| | shared stream | split streams |
|---|---|---|
| easy v easy | 48.4% | 46.8% |
| normal v normal | 45.6% | 46.0% |
| hard v hard | 49.7% | 48.9% |

Both sit inside the noise (σ ≈ 2.2% at this sample size). The difference from Fruit Duel is
that there the *count* varied with the outcome, which correlates a seat's mistake with the
other seat's stream; here only the *timing* varies, and it shifts both seats alike. The split
is kept anyway — it costs two integers at `init` and it makes the independence structural
rather than something that happens to measure clean — but it is honest to record that it
fixed nothing observable.

The constant-draw rule is kept as well and asserted by a test that counts draws through
several hundred decisions at every tier: **exactly two, always**, both pulled before anything
branches on either of them.

### Measured

500 matches a pairing, seeds 1000 + 7919·n. The bot costs **0.19 ms** in its worst step
against the 22 ms reference ceiling.

| | p1 | p2 | draws | p1 share | avg match |
|---|---|---|---|---|---|
| easy v easy | 234 | 266 | 0 | 47% | 21.1 s |
| normal v normal | 230 | 270 | 0 | 46% | 19.8 s |
| hard v hard | 244 | 255 | 1 | 49% | 19.5 s |
| hard v easy | 499 | 1 | 0 | 100% | 16.4 s |
| easy v hard | 3 | 497 | 0 | 1% | 16.1 s |
| normal v easy | 480 | 20 | 0 | 96% | 17.5 s |
| easy v normal | 18 | 482 | 0 | 4% | 17.1 s |
| hard v normal | 444 | 56 | 0 | 89% | 18.9 s |
| normal v hard | 52 | 448 | 0 | 10% | 19.0 s |

Equal tiers land at 46–49% of decided matches; every tier beats the one below it from either
seat by the same margin either way round. Only one match in 4,500 was drawn.

A second, unrelated seed family (55 + 104729·n) gives 50.8%, 48.2% and 51.0% for the three
equal pairings, so the result is not a property of one arithmetic progression.

**A hundred matches is not enough to see this and it took a false alarm to learn it.** On an
earlier tuning, `easy v easy` over 100 matches read **62%** — 2.4σ, and it looked like a real
seat bias for about ten minutes of hunting for one. The same measurement at 500 matches was
50.8%. The honest reading of a 100-match equal-tier sample is "consistent with anything from
52% to 72%", so the sweep is run at 500 and the band in `rules.test.ts` (90 matches, 35–65%)
is set to catch a gross bias rather than to prove a fine one.

## Rule 7: never colour alone

- Seat one is a **spotted** frog with **round** eyes; seat two a **striped** frog with
  **square** ones. Two frogs of the same shape hopping about one pond is where colour alone
  fails hardest — a player glancing up mid-hop has to know which one is theirs. The two sets
  of markings are point reflections of each other, so each player reads their own frog the
  right way up from their own side.
- Each frog's **home pad wears its owner's mark** — a ring for seat one, a square for seat
  two — so a player can always find the pad they came from.
- A **fly** is one small body with two wings. A **dragonfly** is a long body with four wings,
  ringed by **five pips you can count**. No text: a number would be upside down for one of
  the two people reading it.
- A bug's remaining life is a **shrinking ring** around it.
- Score is **ten pips a side**, on that player's own edge of the pond: circles along the
  bottom for seat one, squares along the top for seat two. Countable rather than written, so
  both people read their own score upright.
- Height in a hop is drawn as **size**, not as an offset — an offset needs an "up" and this
  board is read from both ends. A frog swells towards whoever is watching and its shadow
  shrinks under it, which reads the same way round either way up.

There is no `SeatFlip` and the game never reads the presentation: the pond and everything
drawn on it is already its own reflection, so there is nothing to rotate. A test asserts the
renderer is never asked to.
