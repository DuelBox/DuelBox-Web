# Cornhole — specification

**Archetype:** `turn-aim` · **Category:** Sports · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~240 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Four bags each at a board with a hole near the top. In the hole is three, on the board is
one, on the ground is nothing — and a bag that lands on another **shoves it**, which is
where the game is.

## The board

| | Value |
|---|---|
| Board face | x 260–640, y 120–470 |
| Hole | centre (450, 210), radius 46 |
| Throw from | (450, 830) |
| Reach | 300 at no power, 820 at full |
| Drift | ±300 at full aim |
| Wobble | ±22 on both axes, seeded |
| Bags | 4 each per round, 4 rounds |
| Target | 21, which ends a match early |

The wobble is what makes this a game rather than a calibration exercise: two identical
throws are not identical. It is small enough that skill still decides.

## Scoring by cancellation

**Only the difference counts.** Eight against seven scores one, not eight. That stops a
runaway and means a throw that merely *matches* the opponent is worth as much as one that
beats them. Whoever did not throw first last round throws first next.

## Shoving

A landing bag pushes any bag it lands on directly away from itself, far enough to clear.
That can push a bag **into the hole** — the throw that wins a round without going in
itself — or off the board entirely.

**One shove per landing, no chain reaction** **[ours]**. A cascade would make a single
throw unpredictable in a way the player could not have planned for, and this game already
has its randomness in the wobble.

A bag landing exactly on another is pushed straight up the board rather than dividing by
zero.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Drag to aim and pull back for power, release to throw | Left and right to aim, hold Space or Enter for power, release to throw |

This is the archetype's second game, and the first place the aiming control had to be
designed rather than followed: Darts moves a reticle, and a throw here has a **power** as
well as a direction, so it is a pull-back rather than a point.

Power is shown as a **ladder of ticks** as well as the length of the aim line. Length alone
is hard to judge, and a player who liked a throw needs to be able to repeat it.

## Edge cases

- **A lift with no power behind it** does not throw. A tap that never pulled back is not a
  throw, and sending one would waste a bag. A flick faster than a single simulation step
  therefore does nothing — which is the same rule, and the right one.
- **A release with the pointer already gone** still throws: the aim is kept, not re-read.
- **A throw while one is in the air** is refused.
- **A throw by the seat that is not up**, or one with no bags left, is refused — and
  distinctly, so it is never mistaken for a throw that scored nothing.
- **A half-pulled aim when the game pauses** is dropped.
- **A touch during the seat flip** is ignored.

## Determinism

Every wobble and every bot error comes from the seeded RNG. The flight is timed in whole
simulation steps and decides nothing — the landing is settled the moment the bag is thrown,
so the flight is presentation and the result is not at the mercy of the frame rate.

## The bot

| Tier | Angle error | Power error | Holes |
|---|---|---|---|
| easy | 0.45 | 0.30 | ~9% |
| normal | 0.24 | 0.16 | ~28% |
| hard | 0.15 | 0.10 | ~62% |

Measured over two thousand throws each. Every tier aims at the hole and misses by its own
margin; it has no more information than a person, and **cannot see the wobble**, which is
drawn after it commits. A hard bot is a steady hand, not a cheat.

**The first hard tier holed 99%.** That is not a strong opponent but a wall — nothing the
other player did could matter. Rule 6 is about information rather than a licence to be
superhuman with it, and a bot that always succeeds is as bad as one that always fails. A
test now asserts the hard tier holes fewer than four throws in five.

## Presentations

Shared-screen turns the field to face whoever is throwing; single-seat never turns it.

## Rule 7

p1's bags are round and p2's are square. It matters more here than it looks: working out
whose bags are where **is** the scoring.

## Not specified here

Art, audio and haptics. Also unmodelled: bags sliding down the slant, and the second hole
some boards have. Both are deliberate — the slant is presentation here, and the throw is
already decided when it leaves the hand.
