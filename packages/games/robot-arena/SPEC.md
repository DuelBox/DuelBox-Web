# Robot Arena — specification

**Archetype:** `rt-arena` · **Category:** Survival · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 40 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Two robots on one round floor that is trying to kill both of them. Dodge the sweeping
blade, the lasers and the cannonballs; the last one still moving takes the round. First to
three rounds, nine at most.

## Observed rules

From the reference genre: _"Survive the obstacles in the deadly robot arena! Dodge lasers,
spinning blades and cannonballs!"_

## Everything rests on one property: the board is its own reflection **[ours]**

**Every hazard is point-symmetric about the centre of the arena.**

- The blade is a **bar through the middle**, so it is already its own reflection — the
  elegance that made it the first hazard rather than the third.
- Lasers and cannonballs are spawned in **pairs**, each the other turned half a turn about
  the centre.
- The two robots start at reflected positions.

This is not decoration. In a survival game the fairness question — "is this half as
dangerous as that half?" — cannot be answered by tuning, only by measuring, and a
measurement is only ever evidence. Point symmetry makes it a **theorem**: whatever
threatens one robot threatens the other identically, at the same instant, at the reflected
place. There is no safer half, no favoured seat, and no balance number to defend.

`rules.test.ts` asserts it directly, sampling the floor on a lattice at every stage of a
round across twelve seeds: `struck(x, y)` must equal `struck(reflect(x), reflect(y))`, at
every moment. It is the only test in this game whose failure would mean it is *unfair*
rather than merely wrong.

Two things fall out for free. The picture is identical from either side of the device, so
there is **no `SeatFlip` and the game never reads the presentation** — and two motionless
robots die to the same blade at the same instant, so a match nobody plays is a 0–0 draw.

## The arena

| | Value | Why |
|---|---|---|
| Arena | 900 × 900, floor radius 400 | Square, so the reflection is exact |
| Robot | radius 24, 300 u/s | |
| Blade | half-length 330, half-width 16 | A bar through the centre |
| Blade spin | 0.9 rad/s, +0.075 per second elapsed | Faster the longer the round runs |
| Laser | 0.85 s warning, then 0.45 s firing | Telegraphed, always |
| Cannonball | radius 15, 340 u/s | Aimed across the floor, never at anybody |
| Grace | 1.2 s | Long enough to find your robot |
| Rounds | first to 3, 9 maximum | |

**The rim holds a robot rather than killing it.** The arena is the safe place and the
hazards are the danger; a rim that killed would make the game about the rim.

**A diagonal is not faster than a straight line.** The oldest bug in eight-way movement,
and a keyboard makes it very easy to hit — the intent vector is normalised, and a test
compares the two distances.

**Cannonballs are not aimed at anybody.** A shot that tracked a robot would be information
a player cannot have, and — more importantly — it would not reflect.

## Termination is escalation, not a clock

Waves arrive at an interval that decays by 10% each time toward a floor of 0.34 s. At that
rate the floor is covered faster than a robot at 300 u/s can cross it, so a round ends
however well it is played. **There is no wall clock anywhere in the termination argument**:
a round between two players who never move and a round between two who never miss both
finish, for the same reason. A test runs twenty seeds and asserts each reaches a decision.

Rounds are capped at nine, so the match ends too.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W` `A` `S` `D` | `↑` `←` `↓` `→` |
| Pointer | hold anywhere in your own half and pull | same, in the far half |

The pointer reads the **direction of the drag**, not the position of the finger — the same
idiom as Snake Clash and for the same reason. The shell divides a shared board into two
pointer zones, so each player owns half the screen, and a robot in the far half could not
be pointed at. A relative drag works from anywhere in your own half, which is the only
place your thumb can be. Both families feed the same normalised intent, so neither is
faster.

## The bot

Three tiers, all of them seeing exactly the arena a player sees. They differ in how often
they look, how far ahead they check, and how finely they can pick a direction — never in
speed, size, or knowledge of what has not been announced yet. A laser that has not shown
its warning is not consulted, because nobody can see it.

| Tier | Looks every | Looks ahead | Headings |
|---|---|---|---|
| easy | 0.28 s | 0.30 s | 5 |
| normal | 0.13 s | 0.55 s | 9 |
| hard | 0.05 s | 0.95 s | 17 |

**Standing still is a real option**, scored alongside the headings. A bot that always moved
would walk into things nothing was pushing it into.

### Two findings

**A fixed sample count made the best tier the worst one.** Six samples over `hard`'s 0.95 s
lookahead are 158 ms apart, and a cannonball covers 54 units in that — about the width of
the collision being tested — so shots passed clean between two samples. Measured: `hard`
against `normal` lost **3–37**, with both beating `easy` by the same margin. Sampling at a
fixed *spacing* (75 ms) means a longer lookahead costs proportionally more work rather than
proportionally more blindness, which is what looking further ahead should mean. Afterwards
`hard` beats `normal` 29–11 and 30–10.

**The symmetry turned round and bit.** Because the board is its own reflection and the two
robots start reflected, two identical bots facing it play mirror-image games and die on the
same step — `hard` against `hard` finished 0–0 in **every one of forty matches**. The fan of
candidate headings is now turned by a random fraction of one slot before it is walked: the
smallest thing that breaks the mirror without breaking the fairness, since both seats draw
from the same distribution, one value each, alternately. It is also more like a person, who
does not choose from a fixed compass rose.

That draw is exactly **one** value per decision, unconditionally — the trap Fruit Duel was
caught by. Two bots sharing one `Rng`, where a seat's draw count depends on its decision,
is a seat bias made of arithmetic. `BOT_DRAWS_PER_DECISION` is asserted by a test that
counts them.

### Measured

40 matches a pairing, and the bot costs 0.66 ms in its worst step against a 22 ms budget:

| | p1 | p2 | draws | avg round |
|---|---|---|---|---|
| easy v easy | 24 | 16 | 0 | 3.0 s |
| normal v normal | 17 | 22 | 1 | 14.8 s |
| hard v hard | 24 | 16 | 0 | 16.1 s |
| hard v easy | 40 | 0 | 0 | |
| easy v hard | 0 | 40 | 0 | |
| normal v easy | 40 | 0 | 0 | |
| hard v normal | 29 | 11 | 0 | |
| normal v hard | 10 | 30 | 0 | |

Equal tiers land at 40–60% of decided matches; every tier beats the one below it from
either seat; round length rises with tier, which is what survival means here.

## Rule 7: never colour alone

- p1 is a **round** robot with one eye; p2 a **square** one with two. Two identical shapes
  running in a shared arena is where colour alone fails hardest, and a player who has just
  been hit needs to know at a glance whether it was them.
- A wrecked robot gets a cross through it.
- A laser's warning is a thin line and its firing a thick one — a width change, not only a
  colour one.
- Round pips are circles for p1 and squares for p2, each set on that player's own side of
  the rim.
- The floor is plated with concentric rings rather than radial ones, so the blade is always
  *across* the pattern and never hidden along it.
