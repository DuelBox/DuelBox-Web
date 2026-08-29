# Knife Thrower — specification

**Archetype:** `turn-aim` · **Category:** Shooter · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A log turns in the middle of the board. Take it in turns to throw; a knife that finds bare
wood sticks and scores, one that meets a knife already there splinters and costs you a
point. First to twenty, but only once both of you have thrown the same number of times.

## Observed rules

From the reference genre: _"Tap to throw knives. Land in the wood, avoiding other knives.
First to 20 wins."_ — one button, a shared log filling with knives, and a target of twenty.

## There is nothing to aim **[ours]**

The knife flies straight up the middle and meets the log at the bottom of the circle every
single time. What varies is not where the knife lands but **where the log has turned to**.
So the whole control is one press, and the whole skill is choosing a moment — which is also
why a keyboard and a thumb are exactly equivalent here, and the fairness question that
haunts most of this catalogue does not arise.

## The board

| | Value | Why |
|---|---|---|
| Board | 700 × 1000 | |
| Log | radius 150, at the exact centre | Symmetric under the half-turn the board makes |
| Throw line | y = 890 | Also symmetric: 110 from its own edge |
| Knife | length 92, flies at 1500 u/s | ~0.4 s in the air |
| Clearance | 0.315 rad | About 47 units at the surface |
| Window | 8 knives | See below |
| Spin | 1.15 rad/s bare, +0.14 a knife | Faster as the log fills |
| Target | 20 points | From the observed rule |
| Throws | 90, 45 each | The structural end |

## Three things were unfair, and each was measured

This game began with a **40–0** seat bias. Three separate causes, none of them visible by
reading the rules.

### 1. The log's parity

Knives arrive one a throw, so with a board that fills and then clears, one seat always threw
at an even count and the other always at an odd one — a whole knife fuller, every time.
Two `normal` bots: p1 landed **67%** of its throws, p2 **53%**, and p1 won 34 to 6. The
bonus for filling the log had the same problem pointing the other way — at `hard`, where
almost nothing splintered to break the parity, p2 collected every bonus and won 27 to 7.

**Fixed by a rolling window.** The log holds eight knives; a ninth pushes the oldest out.
Both seats face the same board.

### 2. The free opening throw

A bare log cannot be missed, and only p1 ever got one. p1 landed it, p2 threw at a board
with a knife in it, splintered more often — and a splinter knocks a knife out, handing p1
an easier board still. The loop compounded: **36 to 4**.

The same rules with two *random* players, throwing at uniformly chosen moments, gave
**28 to 31**. The game was fair; the opening was not.

**Fixed by dressing the log.** It starts with a full window of blunt old blades belonging
to nobody, placed by rejection sampling from the seeded rng. No free throw, no fill phase,
no parity.

### 3. The race to a target

With both players good, a race to twenty is won by whoever throws first. Two `hard` bots
landed essentially every knife and p1 arrived one throw sooner: **40 to 0**, with the
points 20.0 to 19.0.

**Fixed by equal turns.** A match ends only on a completed round — both seats having thrown
the same number of times — and only if one of them is then ahead. Level at the target is
not a finish: they throw again until somebody leads, or the ninety throws run out. It is
the answer darts and cricket reach, for the same reason.

## A splinter

Costs the thrower a point, floored at nothing, and knocks out the knife it hit.

The first version stripped the log bare, which sounds like a punishment and is the opposite
— see (2). Knocking out one knife reopens the log a little for *both* players, which is the
only symmetric thing a splinter can do.

## Termination

Structural, not a clock. A player who splinters every throw never scores and never loses,
and no amount of waiting changes that; ninety throws is a hard ceiling that arrives however
badly the match is going. Sixty was the first guess and left twenty out of reach — a
splinter costs a point as well as scoring none, so a `normal` player nets about six points
in ten throws. At forty-five throws each, the target is reached with rounds to spare, which
is what equal turns needs in order to have something to break the tie with.

Level at ninety throws is a **draw**, and a real one.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `Space` | `Enter` |
| Pointer | tap anywhere | tap anywhere |

Only on your own turn. Input is refused while the board is part-way through its half-turn,
because the log a player is reading is moving under them and a tap would name a moment they
did not mean.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and a game that
assumed seat one would leave that rotation reaching nothing (#2487). It is read in
`resetGame`. Measured at 50 seeds x both opening seats on `normal`, equal tiers: seat one
takes **50.0%** of 100 decided matches, and all 50 seed pairs end differently when only the
opening seat changes.

## The bot

Three tiers, expressed only as how much room a tier insists on and how accurately it hits
the moment it chose — never the knife, the spin, or anything a player cannot see (rule 6).

| Tier | Demands | Timing error | Blunders |
|---|---|---|---|
| easy | 0.8× clearance | ±0.115 s | 20% |
| normal | 1.1× | ±0.055 s | 9% |
| hard | 1.8× | ±0.016 s | 4.5% |

It releases **on the way out of a gap**, not the moment one appears: clearance rises to a
maximum at the middle of a gap and falls away either side, so "no wider than it was a step
ago" is the middle of the gap, found without searching. Without that the first version was
strictly worse the better the tier — a bot insisting on more room simply waited longer and
then let go at whatever it happened to be looking at, and `normal` landed 53.5% of its
throws against `easy`'s 54.3%: a difficulty setting pointing backwards.

Its demand decays to nothing over three seconds, which is not a nicety — **without it the
game deadlocks.** `hard` insisting on 1.8× clearance on a full log may simply never see it,
and the turn never ends. Before the fix, `hard` against `easy` finished none of twenty
matches. `termination.test.ts` would not have caught it either: it plays two `easy` bots,
on the reasoning that the weakest play is likeliest to wedge, and here it is the strongest.

`hard` blunders too, and has to. At a blunder rate of nothing it landed every knife, and so
did the identical bot opposite: forty-five throws each, forty-five points each, and thirteen
matches in forty ending 45–45. A flawless player cannot be separated from another one.

### Measured

Win rates over 40 matches a pairing, from both seats:

| | p1 | p2 | draws |
|---|---|---|---|
| hard v easy | 30 | 4 | 6 |
| easy v hard | 2 | 37 | 1 |
| normal v easy | 26 | 12 | 2 |
| easy v normal | 8 | 28 | 4 |
| hard v normal | 18 | 8 | 14 |
| normal v hard | 9 | 24 | 7 |

Equal tiers, over 200 matches each: p1 takes **49%** of decided matches at `easy`, **47%**
at `normal`, **41%** at `hard`. The residue at the top tier is real and is not yet
understood; it is small enough that a pair of people, who are never identical, will not meet
it, and it is stated here rather than papered over.

## Rule 7: never colour alone

- p1's knives carry a round pommel, p2's a square one, and the log's own old blades a short
  bare tang in weathered steel.
- Each seat's points run as pips up its own side of the board, and p2's are notched.
- The landing mark on the rim is drawn open when the spot under it is clear and filled when
  it is not — a shape change, not only a colour one.
- A splintered throw flashes the whole wall panel, which is position, not hue.

## Presentation

- **Shared-screen** — the board makes a half-turn to face whoever is to throw, driven by the
  engine's `SeatFlip`. Log, throw line and wall panel are all symmetric about the centre, so
  the turn moves nothing that matters.
- **Single-seat** — `seatView` reports no rotation, so the local player always reads it
  upright. `game.test.ts` asserts the two presentations produce an identical trace.
