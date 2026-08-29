# Target Practice — specification

**Archetype:** `turn-aim` · **Category:** Shooter · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions and
> distinguishes them from what the observed rule dictates. Every number below was measured
> against the compiled `dist/rules.js` and `dist/index.js` with the harness in
> `/tmp/…/scratchpad/tp.mjs`; none of them is remembered or hoped for.

A shooting range seen from above. Two belts cross the lane in front of you, carrying targets
that slide across and come round again behind the uprights. A marker runs up and down your
lane: press once to keep the distance, press again to shoot. The shot takes a quarter of a
second to get there, so the second press is a **lead** and not a poke. Big targets score one,
small ones score two, and the first to ten wins.

## Observed rules

> Shoot targets to score points. Small targets score double. First to 10 points wins. Tap to
> start, then tap to aim up, then tap to fire.

Four sentences, and three of them decide something: the scoring is two tiers with the smaller
worth double, the finish is first to ten, and — unusually for this catalogue — **the control
scheme is named, and it is already taps rather than a drag**.

Everything in that row is built. What the row leaves open is every number: how many targets,
how they move, what "aim up" is a dial _of_, what happens if nobody reaches ten, and what a
level score means.

## The two presses: a distance, then a moment **[ours]**

A drag hands a thumb a continuous quantity a key cannot match, and CLAUDE.md rule 10 says one
build serves every device. A press is one binary event with a timestamp on a phone, a
trackpad and a keyboard alike, and neither instrument can place it more finely than the other.
Cup Pong had to _give up_ the reference's swipe to get there. Here the observed rule hands us
two taps to begin with, so the fair idiom cost nothing — and the manifest is where that
promise is kept, with a test asserting the pointer line never says drag, swipe, flick or hold.

What is ours is the **second dial**. Cup Pong's two presses are both spatial needles — a line
and a distance along it — and a second game built the same way would be the same game twice.
Here only the _first_ press is spatial: it keeps a distance up the lane, and the shot always
lands on the lane's centre line. The second press is a moment. The only way to put a shot on a
target is to fire early enough that the target arrives as the shot does.

Three things follow, and all three are why it was worth doing:

- **Timing is the aim.** The lead is 51 units at the near belt and 78 at the far one, against
  a big target 68 across and a small one 26. Pressing when the target is already on the line
  is a miss, every time.
- **A moment is the most instrument-neutral quantity there is.** A spatial dial still has to
  be _read_ off a moving gauge; a moment is read off the board itself — the target is either
  nearly there or it is not.
- **The two dials are orthogonal and both cost a press error.** They meet in one Euclidean
  distance at the moment of impact, exactly as Cup Pong's two needles meet in one landing
  point, so the difficulty analysis below is in the same units and comparable.

## The ready pause is in the rules, not in the shell **[ours]**

The shell turns the board to face whoever is shooting and refuses a person's input for the
0.36 s that takes. **A bot does not go through the shell.** Cup Pong found this and fixed it
with a freeze in the simulation; the same hole is here, and it is worse.

The marker starts parked at the near end of the gauge and covers 0.8 of it a second, so it
reaches the near belt **0.375 s** after it starts moving. The flip is 0.36 s. A person who had
to wait the flip out would have **fifteen milliseconds — nine tenths of one frame** — to catch
the near belt on its first pass, and would then wait 1.75 s for the marker to come back. A bot
would have had all 0.375 s of it. `READY_SECONDS = 0.5` freezes the marker for both of them,
in the simulation, where a person and a bot are the same thing. A test asserts both the
inequality and the margin: `nearBeltAt - 0.36 < 1/60`.

It cannot live in `game.ts` instead. `seatView` reports **no rotation at all** in single-seat
play, so a freeze keyed off the flip would step one match on a shared phone and a different
one on two phones playing remotely. A test drives the same seed through both presentations and
compares.

## One gallery, read from two ends **[ours]**

Every belt, every target, every speed and every distance is stated in the **shooter's own
frame** — `lateral` across the lane with the shooter's right positive, `forward` down it. So
there is one gallery in `rules.ts` and both seats read it, and the two galleries drawn on the
board are one shape under the half-turn. At any instant the two seats face the bit-identical
problem, and a test asserts it:
`boardXOf('p1', ℓ) − 350 === 350 − boardXOf('p2', ℓ)` for every target at every clock.

**Nothing a shot does changes a target.** That is what keeps the property true for the whole
match rather than only at the start, and it is what makes the state trivially serialisable —
the gallery is one clock and one phase per target, and a JSON round trip of a finished match
is asserted equal (issue #747).

The two consequences worth stating plainly:

- **Depth is not available as a difficulty axis.** The board turns, so a belt that were near
  for one seat would be far for the other. Whatever separates the two belts has to be
  something symmetric under the half-turn.
- **The seats are coupled through the clock, and no arrangement of anything can undo it.**
  The belts run during the freeze, during the flip and during the other seat's turn, so an
  opponent who takes longer over their turns hands you a different phase of the gallery. See
  _Randomness_ below, where that is measured rather than assumed.

## The range

|               | Value                                             | Why                                                      |
| ------------- | ------------------------------------------------- | -------------------------------------------------------- |
| Board         | 700 × 1000                                        |                                                          |
| Muzzles       | y = 940 and y = 60, both at x = 350               | Symmetric under the half-turn                            |
| Belts         | forward 230 and 350, for both seats               | y = 710/590 for p1, 290/410 for p2                       |
| Belt travel   | ±300, wrapping                                    | 334 with a big target on it, against a half-width of 350 |
| Belt speed    | 200 units/s, **opposite ways**                    | Equal, so neither belt is the better shot                |
| Targets       | four a belt, alternating big and small            | A size comes round every 1.5 s                           |
| Big target    | radius 34, **1 point**                            |                                                          |
| Small target  | radius 13, **2 points**                           | The observed rule's double                               |
| Shot          | radius 4                                          | So what has to fit is `radius + 4`                       |
| Clean hit     | within 0.7 of the radius                          | The score's fine resolution                              |
| Range gauge   | 140 to 440 at 0.8 of the gauge a second           | 1.25 s a crossing; 240 units/s                           |
| Shot speed    | 900 units/s                                       | 0.256 s to the near belt, 0.389 s to the far             |
| Ready freeze  | 0.5 s                                             | Longer than the shell's 0.36 s flip                      |
| Turn deadline | 3.0 s once the marker is live                     | Nothing else forces either press                         |
| Settle        | 0.45 s                                            |                                                          |
| Match         | first to 10, capped at 22 rounds of one shot each |                                                          |

The far end of the gauge stops exactly on the centre line, so the two lanes meet and never
overlap. The 44 units of clear lane between the two belts is the gap a badly kept distance
falls into — 0.18 s of press error, wider than any tier's own.

### The whole difficulty ladder is two tolerances in seconds

A hit needs the marker inside `radius + 4` of the belt **and** the target inside the same
distance of the lane's centre line when the shot arrives. So what a target size is worth is a
pair of numbers in **seconds of press error**:

|                | range press `ρ / 240` | fire press `ρ / 200` |
| -------------- | --------------------- | -------------------- |
| big (ρ = 38)   | 0.158 s               | 0.190 s              |
| small (ρ = 17) | 0.071 s               | 0.085 s              |

A small target is a bit over twice the precision for exactly twice the points. **Which side of
that trade is worth taking is what separates the tiers**, and it is not a knob — the bot values
a target at its points times the chance its own hands would land it, and the two curves cross
at about **0.165 s**:

| press error | big is worth | small is worth | takes            |
| ----------- | ------------ | -------------- | ---------------- |
| 0.14        | 1.000        | 1.279          | small            |
| 0.15        | 1.000        | 1.172          | small            |
| 0.16        | 1.000        | 1.076          | small            |
| **0.165**   |              |                | **the crossing** |
| 0.17        | 0.995        | 0.990          | big              |
| 0.19        | 0.972        | 0.843          | big              |
| 0.21        | 0.931        | 0.724          | big              |
| 0.24        | 0.846        | 0.587          | big              |

`easy` (0.24) and `normal` (0.21) sit above it and shoot the big targets; `hard` (0.145) sits
below and shoots the small ones. **The radii were fitted to that crossing, not to the drawing.**
At radius 16 against 34 it sat at 0.245 s — above every tier worth shipping, so all three tiers
wanted the small targets and the choice did nothing. At 13 it sits between `normal` and `hard`,
which is a ladder with the rung in it. That is the same failure mode Cup Pong's first geometry
had, arriving from the other direction: there, three tiers of "nearly perfect"; here, three
tiers making the identical decision.

### The rates are a lattice

A press only ever lands on a whole frame, so a shot's distance and its moment both fall on a
grid: 4 units of lane a frame, 3.3 units of belt a frame. Against a small target's 34-unit hit
window that is 8.5 and 10.2 steps, and against a big one's 76-unit window 19 and 23. Cup Pong's
first version ran a needle whose grid was **coarser than its cup**, and two neighbouring mouth
radii gave the identical hit rate to three figures. A test asserts both windows are at least
eight frames across.

### Why the belts run at the same speed

The first version ran them at 190 and 240. Both belts are the same distance from _somebody_,
so a difference in speed makes one of them strictly the better shot — and the bot took the
slower belt in **100% of 400 sampled turns**. Half the gallery was scenery.

Equal speeds leave the two belts worth exactly the same, so which one a bot takes is decided
entirely by which has a target coming — and they are still different problems, because the far
belt is 0.389 s away against 0.256 and therefore wants half as much lead again. The marker
reaches the near belt half a second earlier, so it takes about three turns in four:

|                         | near belt | far belt  |
| ----------------------- | --------- | --------- |
| `easy` / `normal` (big) | 296 / 400 | 104 / 400 |
| `hard` (small)          | 310 / 400 | 90 / 400  |

Four targets a belt rather than three and four, for the same kind of reason. With three, only
one of them was small, so the class a `hard` bot wants came round every 3.0 s against a 3.0 s
turn — and a third of its plans were rejected as unreachable, which read as a preference for a
belt it was merely settling for.

## Scoring, the win condition, and why a clean hit counts for something

**The win condition is the SDK's shared helper**, called once at the end of every completed
round (issue #750):

```ts
resolve({ kind: 'first-to', target: 10 }, { p1, p2 }, { timeExpired: round >= 22 });
```

`first-to` with the round cap fed in as `timeExpired` is exactly what the helper's fall-through
is for: reach ten and win, and if nobody has after twenty-two rounds the higher score takes it.
Both seats crossing ten in the same round with the same total is a draw, and the helper says so
rather than handing it to whichever seat the code happened to test first.

**A match ends only on a completed round.** Reaching ten does not end it on the spot: the other
seat still gets the shot it is owed, and may reach ten too. Ending on the point would hand the
match to whoever happened to be leading that round — the trap every first-to-N game in this
repo has had to be dug out of — and here it would also make the round cap asymmetric, because
the seat shooting second would be the only one whose last shot could be cancelled.

The **clean-hit tiebreak** runs only on what the helper calls a draw, and it is not decoration
— it is the score's fine resolution. Points come in ones and twos, so two players of the same
standard land on the same total often:

| 2000 seeds a tier | draws on points alone | draws with the clean-hit tiebreak |
| ----------------- | --------------------- | --------------------------------- |
| easy v easy       | 10.6%                 | **1.9%**                          |
| normal v normal   | 15.1%                 | **3.5%**                          |
| hard v hard       | 9.2%                  | **2.0%**                          |

`CLEAN_SHARE = 0.7` is set so a bit over half of what is hit is hit clean — 56% at `easy`, 61%
at `normal`, 37% at `hard`, which is shooting at targets less than half the size. A tiebreak
that almost never separates anybody is not one.

It is deliberately a tiebreak and not points: a player who reaches ten first has won whatever
the other one's shooting looked like, because that is what the observed rule says the game is.

## Termination

Structural, and it needs two separate guarantees because **`first-to-N` on its own does not
terminate** — two players who never hit anything play for ever — and `roundSeconds` ends
nothing, it is text on a catalogue card.

1. **`TURN_SECONDS` bounds a turn.** Nothing else forces either press. When the deadline passes
   with a press still owed the turn is spent with no shot: no points, and the seat has used
   one of its twenty-two. Between 3% and 8% of bot turns end this way, which is a fumble large
   enough to have cost the shot rather than merely spoiled it.
2. **`MAX_ROUNDS` bounds the match.** At most twenty-two rounds of one shot each, so a match is
   at most forty-four shots whatever happens in them.

Together they cap a match at `22 × 2 × (0.5 + 3.0 + 0.45 + 3/60)` = **176 seconds** of simulated
play, and a test plays a match with **nobody pressing anything at all and no frame cap on the
loop** — a match that failed to terminate would hang the suite rather than pass quietly — then
asserts both seats took exactly twenty-two shots and the clock came in under that bound.

Twenty-two rather than eighteen because the cap has to clear the longest matches the _weakest_
pairing produces rather than the average one. Over 1500 seeds a tier:

|                 | mean rounds | longest | past 18 rounds | longest match |
| --------------- | ----------- | ------- | -------------- | ------------- |
| easy v easy     | 13.9        | 21      | 2.4%           | 124 s         |
| normal v normal | 11.8        | 17      | 0              | 100 s         |
| hard v hard     | 8.1         | 17      | 0              | 96 s          |

The cap fires in about one `easy` match in two thousand and never at the other tiers. It is
insurance, and the tests exercise it directly rather than waiting for it.

## Controls

|          | Seat one     | Seat two     |
| -------- | ------------ | ------------ |
| Keyboard | `Space`      | `Enter`      |
| Pointer  | tap anywhere | tap anywhere |

Only on your own turn, only twice per shot, and never during the ready freeze or while the
board is part-way through its half-turn. There is nothing to point _at_, so the whole surface
takes a tap — which is what `zoneSplit: 'shared-board'` tells the shell.

## The bot

Three tiers, expressed only as how accurately a tier hits the moment it meant to. Both dials
are a press against a clock, so that is the whole of the skill the game asks for and the whole
of what the tiers differ in.

| Tier   | Press error | Fumbles | Shoots at       |
| ------ | ----------- | ------- | --------------- |
| easy   | ±0.24 s     | 15%     | the big targets |
| normal | ±0.21 s     | 8%      | the big targets |
| hard   | ±0.145 s    | 2%      | the small ones  |

Every tier's error is several frames wide, so rule 6 holds by construction: none of them can
stop the marker or pick a moment more finely than a person can. Everything the bot reads is on
the board — where the targets are, how big they are, how fast the belt runs — plus one fact
about itself, which is how steady its hands are. A person has both. `bot-cost` measures its
worst step well inside a frame; it scans seven targets at O(1) each and searches nothing.

### What it shoots at, and the thirteen points that costs

`chooseQuarry` values a target at `points × P̂(range press) × P̂(fire press)`, where `P̂` is the
exact distribution function of the tier's own triangular error against the tolerance the target
allows. Deliberately a **rectangle** over the two presses rather than the ellipse the hit test
really is: the bot is choosing between shots, not predicting its own score, and the rectangle
preserves the ordering for two multiplications. Calling it a judgement rather than a probability
is the honest description.

**The measured cost of that rule is the most interesting number in this file.** At `hard`'s own
error the two classes are within a tenth of a point a turn of each other, and the model prefers
small by 12%. Forced onto the big targets instead, the same bot scores _fewer_ points a turn and
wins far more:

| `hard`, 500 seeds each seat order | points a turn | hits  | wins vs `normal`  |
| --------------------------------- | ------------- | ----- | ----------------- |
| shipped (takes the small targets) | 1.00          | 50.3% | 81.0% / 76.0%     |
| forced onto the big targets       | 0.96          | 95.6% | **92.9% / 93.2%** |

A race to a fixed score rewards consistency over expectation, and the value rule prices only
expectation. It is kept anyway, and not out of sentiment: **a variance-aware rule takes the big
targets at every tier, and then no bot in the game ever shoots at a small one** — the observed
rule's double-scoring targets would be decoration. Thirteen points of `hard`'s win rate is the
price of the catalogue row being true in play.

### Four other things are load-bearing

**It counts down to a moment; it does not watch for a position.** Watching for a position is
the obvious way to write this and it hangs: the error is added in whichever direction the marker
is currently going, so an error larger than the gauge is out of reach _both_ ways — the marker
turns round at the end of its travel and the wanted value turns round with it, and the two never
meet. A countdown cannot fail to expire, and it is the more honest model anyway: a person commits
to a moment, and pressing after the marker has turned round is a real way to miss.

**It recomputes the lead at the first press, from the distance actually kept.** The lead is
`range / 900`, so a marker stopped short needs a shorter lead — and where the marker stopped is
on the board in front of a player. Using the _wanted_ distance instead would tie the two presses'
errors together and quietly halve the ladder.

**Its press error is triangular, not flat.** Two draws a needle, summed. A flat error either fits
inside the tolerance or it does not, with almost nothing in between, and three tiers would have
nowhere to stand.

**It clears each press's answer when it presses.** `wantGauge` is a fraction of the range gauge
and `fireTimer` is a number of seconds. Leaving one standing in a field the other press reads is
how a shot ends up fired at a gauge fraction's worth of seconds. Two fields, a `stage`, and both
cleared on the press — a test asserts it.

### The one place analytic and numeric had to be made to agree

The bot solves for a crossing in closed form: `nextCrossing` inverts `lateralAt` exactly, and
the referee judges the shot against `lateralAt` at the moment it arrives. Two things make those
the same arithmetic rather than nearly the same, and both were deliberate (commit b4af006,
issue #2465):

- **The gallery is a function of the clock, never an integrated position.** `lateralAt` is
  `wrap(phase + speed × clock)`, evaluated fresh every time it is asked for. Nothing about a
  target's position accumulates, so a target asked for twice at the same moment answers the
  same thing however much play happened in between — asserted by a test that runs the match on
  twenty seconds and re-asks about a moment in the past.
- **The arrival is a closed-form number fixed at the press.** `impactClock = fireClock +
range / 900`, and `land` reads _that_, never the live clock. The flight is animated over whole
  frames, so the step it finishes on is up to a sixtieth of a second late; judging there would
  put the belt 3.3 units past where the bot solved for — a fifth of everything a small target
  forgives, **always in the same direction**. A test fires at exactly `crossing − flight` for
  every target in the gallery and asserts a dead-centre clean hit with `|lateral| < 1e-9`.

### Randomness

**A generator per seat**, derived in `init` from `context.rng` before anything else touches it,
and **exactly six values per turn**, drawn unconditionally before anything branches. Both are
asserted, the second over a whole match: `draws === p1Turns × 6`, whatever the turns did.

What that buys, precisely: seat two commits to the identical sequence of press errors whatever
tier is sitting opposite it. What it does **not** buy, and what nothing could:

| 500 matches, seat two vs an `easy` opponent and vs a `hard` one | identical shots |
| --------------------------------------------------------------- | --------------- |
| a stream each (**shipped**)                                     | **0 / 500**     |
| one shared stream                                               | 0 / 500         |

Cup Pong gets 500/500 here. It cannot be got in this game, because the gallery is one gallery on
one clock: an opponent who takes longer over their turns hands the next seat a different phase
of the belts. That coupling is symmetric, it is visible on the board — the belts are running
where both players can see them — and it produces no measurable seat bias:

| seat-one share of decided, 1200 seeds a tier | easy  | normal | hard  |
| -------------------------------------------- | ----- | ------ | ----- |
| a stream each (**shipped**)                  | 52.0% | 50.3%  | 50.5% |
| one shared stream                            | 47.9% | 50.4%  | 49.5% |

(`easy` re-measured at 4000 seeds: **50.5%**. The 52.0% above is a 1.4σ wobble at 1200.)

A reversed poll order gives a **bit-identical** match at every tier — 600/600 over twenty seeds
a tier in the suite — which is what the constant draw count and the per-seat streams are
structurally for.

### Every knob, swept alone

Both strictly monotone in points a turn with everything else left as shipped. Win rate is
against an untouched `normal` over 500 seeds in each seat order.

| `hard` press error    | wins vs `normal`  | points a turn | hits  | shoots  | match  |
| --------------------- | ----------------- | ------------- | ----- | ------- | ------ |
| 0.08 s                | 100.0% / 100.0%   | 1.83          | 91.5% | small   | 27.5 s |
| 0.10 s                | 99.6% / 99.2%     | 1.57          | 78.4% | small   | 30.5 s |
| 0.12 s                | 95.0% / 94.6%     | 1.28          | 63.9% | small   | 36.0 s |
| **0.145 s (shipped)** | **81.0% / 76.0%** | **1.00**      | 50.3% | small   | 44.6 s |
| 0.17 s                | 86.6% / 85.3%     | 0.92          | 92.2% | **big** | 55.6 s |
| 0.21 s                | 55.8% / 59.3%     | 0.81          | 81.1% | big     | 61.0 s |
| 0.28 s                | 15.4% / 13.4%     | 0.60          | 59.7% | big     | 79.9 s |

The bump at 0.17 s is the crossing being passed, and it is the same finding as the forced-big
table above rather than a separate one: points a turn falls straight through it, and the win
rate does not.

| `hard` fumble rate | wins vs `normal`  | points a turn | hits  |
| ------------------ | ----------------- | ------------- | ----- |
| 0                  | 81.4% / 77.0%     | 1.02          | 51.0% |
| **0.02 (shipped)** | **81.0% / 76.0%** | **1.00**      | 50.3% |
| 0.06               | 78.0% / 72.3%     | 0.97          | 49.1% |
| 0.14               | 71.2% / 65.1%     | 0.91          | 46.6% |
| 0.30               | 57.1% / 50.6%     | 0.80          | 42.2% |
| 0.60               | 23.6% / 23.4%     | 0.58          | 32.8% |

| `normal` press error | beats `easy`      | loses to `hard`   | points a turn | match  |
| -------------------- | ----------------- | ----------------- | ------------- | ------ |
| 0.17 s               | 91.1% / 92.6%     | 68.5% / 64.4%     | 0.88          | 57.2 s |
| 0.19 s               | 87.3% / 88.7%     | 73.3% / 69.8%     | 0.83          | 59.8 s |
| **0.21 s (shipped)** | **78.1% / 78.7%** | **81.0% / 76.0%** | **0.78**      | 63.5 s |
| 0.23 s               | 66.7% / 67.3%     | 86.8% / 81.0%     | 0.71          | 68.1 s |
| 0.26 s               | 46.1% / 44.9%     | 93.4% / 89.6%     | 0.63          | 76.5 s |

0.21 s is where the middle rung is equidistant from both its neighbours, which is the only
property asked of it.

| `easy` press error   | points a turn | match  | rounds | hit the 22-round cap | `normal` beats it |
| -------------------- | ------------- | ------ | ------ | -------------------- | ----------------- |
| **0.24 s (shipped)** | **0.65**      | 74.3 s | 13.9   | **0 / 400**          | 77.6% / 78.2%     |
| 0.26 s               | 0.59          | 80.5 s | 15.0   | 0 / 400              | 85.8% / 85.3%     |
| 0.28 s               | 0.54          | 87.2 s | 16.3   | 9 / 400              | 89.7% / 91.1%     |
| 0.30 s               | 0.50          | 93.3 s | 17.4   | 33 / 400             | 92.8% / 95.2%     |

`easy` is bounded from _below_ by the cap, not by taste. It shoots one-point targets, so ten
points is ten hits, and every step of extra clumsiness is a round and a half of extra match.
0.24 s is the loosest hand that still finishes on points essentially always.

### Balance, 2000 seeds a tier a seat

Equal tiers, each row a separate 2000-seed run with that opening seat:

|                 | opens | p1   | p2   | draws | **seat-one share of decided** | rounds | match  | points a turn | hits  | clean |
| --------------- | ----- | ---- | ---- | ----- | ----------------------------- | ------ | ------ | ------------- | ----- | ----- |
| easy v easy     | p1    | 1005 | 958  | 37    | **51.2%**                     | 13.9   | 74.8 s | 0.64          | 64.1% | 56.3% |
| easy v easy     | p2    | 984  | 975  | 41    | **50.2%**                     | 13.9   | 74.6 s | 0.65          | 64.2% | 56.1% |
| normal v normal | p1    | 954  | 975  | 71    | **49.5%**                     | 11.8   | 63.6 s | 0.77          | 77.1% | 60.5% |
| normal v normal | p2    | 930  | 1001 | 69    | **48.2%**                     | 11.9   | 63.8 s | 0.77          | 77.1% | 60.5% |
| hard v hard     | p1    | 997  | 962  | 41    | **50.9%**                     | 8.1    | 43.5 s | 1.02          | 51.3% | 36.9% |
| hard v hard     | p2    | 1000 | 953  | 47    | **51.2%**                     | 8.1    | 43.4 s | 1.02          | 51.4% | 37.1% |

Every share is inside 48.2–51.2%, comfortably inside the 45–55 band the fairness issues ask
for, and the two opening seats agree with each other within 1.3 points at every tier.

**The hit rate is not monotone in the tier, and that is the ladder working rather than failing.**
`easy` and `normal` shoot at the big targets and `hard` at the small ones, so `hard` hits _less_
often (51%) than `normal` does (77%) and scores a third more. Points a turn is the measure — the
tests assert that and say why, because a hit-rate assertion here would read as a regression.

Cross tier, 1500 seeds each, both seat orders:

|                     | p1   | p2   | draws | stronger tier's share of decided |
| ------------------- | ---- | ---- | ----- | -------------------------------- |
| hard as p1 v easy   | 1362 | 136  | 2     | 90.9%                            |
| easy as p1 v hard   | 158  | 1341 | 1     | 89.5%                            |
| normal as p1 v easy | 1172 | 300  | 28    | 79.6%                            |
| easy as p1 v normal | 321  | 1150 | 29    | 78.2%                            |
| hard as p1 v normal | 1208 | 288  | 4     | 80.7%                            |
| normal as p1 v hard | 309  | 1188 | 3     | 79.4%                            |

Monotone, and each pairing agrees with itself within 1.4 points across the two seat orders.

### Through the shell, not just the rules

The tables above drive `dist/rules.js` directly. Repeating the repo's own
`balance-aggregate.test.ts` protocol against `dist/index.js` — the whole `Game` contract, both
opening seats paired on each seed, driven through `InputManager`:

| tier   | seeds × 2 | seat one      | draws | unfinished | **opener swung** | mean match |
| ------ | --------- | ------------- | ----- | ---------- | ---------------- | ---------- |
| easy   | 500       | 51.9% of 971  | 2.9%  | 0          | 498 / 500        | 74.2 s     |
| normal | 500       | 50.2% of 973  | 2.7%  | 0          | 495 / 500        | 62.8 s     |
| hard   | 800       | 49.0% of 1556 | 2.8%  | 0          | 754 / 800        | 44.3 s     |

The **opener swung** column is worth pointing at. That file's own doc comment records that _no_
built game reads `context.openingSeat`, so its alternation "reaches nothing and the claim on
`GameContext.openingSeat` is false". This game reads it, and 495 seed pairs in 500 end
differently depending on which seat opened — the alternation now reaches something.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called through a whole match.

- **Seat one is round and seat two is square, everywhere.** The shooting line carries its
  owner's mark, the kept-distance marker carries the shooter's, and the score pips are circles
  for p1 and squares for p2.
- **A target's worth is told by two signals that are not colour.** It is smaller _and_ it wears
  an outer collar. A one-point target is a plain disc; a two-point target is a small disc inside
  a ring.
- A target's **inner ring is the clean zone**, drawn at its real radius, so what the tiebreak
  asks for is on the board rather than explained afterwards.
- The **uprights** are drawn at each end of every belt, wide enough to cover a big target, so a
  target leaving one side and returning at the other is a machine going round rather than
  something that teleported.
- A landing is a **double ring** for a clean hit, a **single ring** for one that caught the edge,
  and a **cross** for a miss: three outcomes told apart by shape, with colour confirming what the
  shape already said. A turn that ran out of time draws nothing, because nothing was fired.
- The opponent's gallery is drawn as **outlines only**, so which lane is live is a fill and not a
  hue.
- Points are ten pips — the number the match is played to — filled left to right, with the
  shooter's own mark inside every pip a clean hit paid for, and a ring on the last pip for a seat
  past ten. That is the tiebreak made visible: a player level on points can see which way it will
  go.
- Rounds left is a bar on the halfway line: one object, shared by both players.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the seat flip, the palette and the drawing, and reads the simulation without
adding to it — a test renders forty frames and asserts neither the marker nor the clock moved,
and another renders the same frame at two different alphas and asserts an identical stream of
draw calls, because this game interpolates nothing.

1045 lines of rules to 361 of game.

## What we did not build from the catalogue row

Nothing was dropped. Every clause of the observed rule is in the game: targets are shot for
points, small targets score double, the first to ten wins, and a shot is a tap to keep the
distance and a tap to fire.

Two clauses were _interpreted_, and both are flagged in the code:

- **"Tap to start"** is the shell's countdown and turn hand-over, which every game in this
  catalogue gets from the SDK. A bespoke start tap inside the package would be a bug, not a
  feature.
- **"Tap to aim up"** is a range marker running up the lane rather than an elevation angle. In
  a top-down board an elevation would have to be a number somewhere off to the side that a
  player translates into a distance; a marker sliding up the lane _is_ the distance, drawn where
  the shot will actually land. The dial is the same single dial the row describes.

The row is silent on what happens if nobody reaches ten, and on a level score. Both are ours:
the 22-round cap resolved through the SDK helper's `timeExpired`, and the clean-hit tiebreak.

## Two things for whoever picks this up

- **`target-practice` is still listed in `SCAFFOLDS` in `apps/web/src/data/balance-aggregate.test.ts`,
  so that harness skips it.** It is no longer a scaffold. Deleting the entry is safe: the table
  above is that harness's own protocol, run against this game, and it lands at 49.0–51.9%.
- **`apps/web/src/data/controls.ts` does not parse**, and it is nothing to do with this game:
  `scripts/register-game.mjs` generated `import { manifest as throw } from '@duelbox/game-throw'`
  for the game whose id is `throw`, and `throw` is a reserved word. It fails
  `tsc --noEmit -p tsconfig.lint.json` with four syntax errors and takes `controls.test.ts` and
  `routing.test.ts` down with it. The generator needs a reserved-word check on the identifier it
  derives from a game id.
