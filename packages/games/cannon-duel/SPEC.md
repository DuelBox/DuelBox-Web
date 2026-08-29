# Cannon Duel — specification

**Archetype:** `turn-aim` · **Category:** Shooter · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Two cannons facing each other down the board, and a crosswind. A needle sweeps; press to
keep the angle. It sweeps again for the power; press again and the shot goes. Three hits
wins, and only at the end of a volley.

## Observed rules

From the reference genre: _"Use timing to aim and shoot your opponent's cannon. Watch out
for the wind! First to get 3 hits wins."_

## Aiming is a press, never a drag **[ours]**

A sweeping needle stopped by a button is the one aiming idiom where a key and a thumb are
**identical instruments**: both are a single binary event with a timestamp, and neither can
be aimed more finely than the other. Every other aiming game in this catalogue has to think
about whether a mouse out-points a thumb — Darts, Cornhole, Knife Thrower all do — and this
one cannot have that problem at all. It is why the reference genre's "use timing to aim" is
worth taking literally rather than translating into a drag.

## The wind changes between volleys, never between shots **[ours]**

Both players fire under the same wind, and only then does it change. A match is therefore a
sequence of **identical problems posed to two people**, rather than a sequence of different
problems handed out in turn — the same idea as the equal-turns rule below, applied to the
weather.

The two cannons sit on the **same vertical line**, equally far from the centre. A shot then
travels straight down the board and the crosswind pushes it sideways, so both players face
the same problem in the same wind. Offsetting them would make one shoot across the wind and
the other along it, and no amount of tuning would recover that.

## The board

| | Value | Why |
|---|---|---|
| Board | 700 × 1000 | |
| Cannons | y = 120 and y = 880, both at x = 350 | Symmetric under the half-turn the board makes |
| Hit | within 52 units | |
| Aim needle | ±0.72 rad at 1.35 rad/s | |
| Power needle | 700–1250 at 0.85 of the range per second | |
| Pull | 480 | See below |
| Wind | ±210 as a sideways acceleration | |
| Match | first to 3 hits, 12 volleys maximum | |

**The pull and the power range decide how much of the gauge is usable**, and the first
numbers made most of it dead. At a pull of 620 with a 520–1150 power range, a straight shot
needed a muzzle speed of 949 to reach the far cannon at all — so the bottom two thirds of
the power gauge could not cross the board under any angle. A gauge that is mostly a losing
move is not a decision, it is a formality with a needle on it. At 480 with 700–1250, a
straight shot reaches from about a quarter of the way up.

## Equal turns

**A match ends only on a completed volley** — both seats having fired the same number of
times — and only if one of them is then ahead. First-to-three would otherwise be won by
whoever fires first whenever both players are good: the trap Knife Thrower fell into, and
the answer darts and cricket reach. Level at three is not a finish; they fire again.

## Termination

Structural. Twelve volleys, and nothing about how the match is played can add one. Two
players who never hit anything finish a drawn match in about a hundred seconds; no clock is
involved.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `Space` | `Enter` |
| Pointer | tap anywhere | tap anywhere |

Only on your own turn, and only twice per shot. Input is refused while the board is
part-way through its half-turn, because the needle a player is reading is moving under them
and a tap would name a moment they did not mean — asserted by a test that presses on the
exact step the turn passes.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and a game that
assumed seat one would leave that rotation reaching nothing (#2487). It is read in
`resetGame`. Measured at 50 seeds x both opening seats on `normal`, equal tiers: seat one
takes **46.0%** of 100 decided matches, in from 40.0% with the break fixed to seat one, and
49 of the 50 seed pairs end differently when only the opening seat changes.

## The bot

Three tiers, expressed only as how accurately a tier hits the moment it meant to, which is
the whole of the skill this game asks for.

| Tier | Timing error | Blunders |
|---|---|---|
| easy | ±0.115 s | 16% |
| normal | ±0.05 s | 6% |
| hard | ±0.018 s | 2% |

It searches the same two dials a player is watching — 21 angles × 21 powers — for the pair
whose predicted landing is nearest the opposing cannon *in the wind on the board*. The
prediction is a closed form rather than a stepped simulation, which is exact and cheap; a
test fires real shots and checks the two agree, because a bot aiming with different physics
from the game is aiming at a different game.

Its error is in **seconds**, not in needle units. That is what makes a fast sweep genuinely
harder for every tier rather than only for the ones with a wide band.

It draws exactly three values per shot, unconditionally — the Fruit Duel trap, where two
bots sharing one `Rng` and drawing a variable number of values shift each other's stream.
`BOT_DRAWS_PER_SHOT` is asserted by a test that counts them.

### Measured, 40 matches a pairing

| | p1 | p2 | draws | hit rate |
|---|---|---|---|---|
| easy v easy | 18 | 13 | 9 | 30% |
| normal v normal | 21 | 19 | 0 | 53% |
| hard v hard | 22 | 18 | 0 | 66% |
| hard v easy | 35 | 3 | 2 | |
| easy v hard | 5 | 35 | 0 | |
| normal v easy | 34 | 4 | 2 | |
| hard v normal | 26 | 14 | 0 | |
| normal v hard | 14 | 26 | 0 | |

Equal tiers take 51–58% of decided matches from seat one; every tier beats the one below it
from either seat. `hard` against `normal` is deliberately the closest pairing — both can
find the shot and differ only in stopping the needle — so its test is held to a clear
majority rather than the 2:1 the easy pairings meet comfortably.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called.

- p1's cannon is round-barrelled with a ringed base, p2's square with a barred one — two
  cannons facing each other are the pair most likely to be confused once the board has
  turned.
- The wind is an **arrow whose length is its strength**, with a head so its direction
  survives being read upside down. Never a number.
- A hit is a double ring, a miss a cross.
- The power gauge fills behind its needle; the aim gauge does not, because a bigger angle is
  not a bigger anything. Two quantities, two shapes.
- Hit pips are circles for p1 and squares for p2, on each player's own side.
